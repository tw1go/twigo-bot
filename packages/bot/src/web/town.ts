import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { OutfitData, TitleData, TownClientMessage, TownDir, TownPlayer, TownServerMessage } from '@mikazuki/shared';

// 🏘️ Who's in the web town, and where: a WebSocket at /ws for logged-in members (see room-api's town.ts for the
// messages). The server keeps everyone's tile and checks each step — on the map, not blocked, next to the last
// one, no faster than walking — and passes it on to everyone else; chat goes to everyone, tidied and rate-limited.
// Nothing here is saved (positions or chat): leave and you're gone.
// One connection per member (a second tab takes over). Login and profiles come from the caller (server.ts), so
// this file has no Discord in it.

const DIRS = new Set<TownDir>(['s', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw']);
/** Walking is 4 tiles a second; allow a little more, in bursts (messages bunch up on a bad connection). */
const STEPS_PER_SECOND = 6;
const STEP_BURST = 6;
const HEARTBEAT_MS = 30_000;
/** Chat: up to 120 characters; a burst of 3, then one every 2 s. */
const SAY_MAX = 120;
const SAYS_PER_SECOND = 0.5;
const SAY_BURST = 3;

/** A chat message tidied up: no control characters, single spaces, trimmed; null if empty or too long. */
function tidy(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const t = text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return t && [...t].length <= SAY_MAX ? t : null;
}

export interface TownMap {
  size: [number, number]; // [cols, rows]
  spawn: [number, number]; // [col, row]
  blocked: number[][]; // [row][col], 1 = blocked
}

export interface TownProfile {
  nickname: string;
  title: TitleData;
  outfit: OutfitData;
}

export interface TownOptions {
  /** The member behind an upgrade request, or null to refuse it. */
  authenticate: (req: IncomingMessage) => Promise<string | null>;
  /** Their nickname, title and look; null if they haven't made a character yet. */
  profile: (userId: string) => TownProfile | null;
  map: TownMap;
}

/** The game's map (packages/game/public/assets/maps/town.json), from the monorepo next to the bot. */
export function loadTownMap(): TownMap {
  const json = JSON.parse(readFileSync(new URL('../../../game/public/assets/maps/town.json', import.meta.url), 'utf8')) as TownMap;
  return { size: json.size, spawn: json.spawn, blocked: json.blocked };
}

/** Facing for one grid step (as the game's dirForStep: col runs screen right-down, row runs screen left-down). */
function dirForStep(dc: number, dr: number): TownDir {
  const table: Record<string, TownDir> = {
    '1,0': 'se', '0,1': 'sw', '1,1': 's', '-1,-1': 'n',
    '1,-1': 'e', '-1,1': 'w', '-1,0': 'nw', '0,-1': 'ne',
  };
  return table[`${dc},${dr}`] ?? 's';
}

interface Conn {
  ws: WebSocket;
  userId: string;
  player: TownPlayer;
  tokens: number;
  refilled: number;
  says: number;
  saidAt: number;
  alive: boolean;
  /** Still at the spawn point, so 'here' is accepted (once). */
  fresh: boolean;
}

export function attachTown(server: Server, opts: TownOptions): void {
  const { map } = opts;
  const [cols, rows] = map.size;
  const conns = new Map<string, Conn>(); // by member
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });

  const send = (c: Conn, m: TownServerMessage) => c.ws.readyState === WebSocket.OPEN && c.ws.send(JSON.stringify(m));
  /** To everyone but `c` (the message is turned into text once). */
  const others = (c: Conn | null, m: TownServerMessage) => {
    const text = JSON.stringify(m);
    for (const o of conns.values()) if (o !== c && o.ws.readyState === WebSocket.OPEN) o.ws.send(text);
  };
  const everyone = (m: TownServerMessage) => others(null, m);
  const inside = (col: unknown, row: unknown): col is number =>
    Number.isInteger(col) && Number.isInteger(row) && (col as number) >= 0 && (row as number) >= 0 && (col as number) < cols && (row as number) < rows;
  const walkable = (col: number, row: number) => !map.blocked[row]?.[col];

  /** Token bucket: true if this message may go through. */
  const spend = (c: Conn) => {
    const now = Date.now();
    c.tokens = Math.min(STEP_BURST, c.tokens + ((now - c.refilled) / 1000) * STEPS_PER_SECOND);
    c.refilled = now;
    if (c.tokens < 1) return false;
    c.tokens -= 1;
    return true;
  };

  const handle = (c: Conn, m: TownClientMessage) => {
    const p = c.player;
    const fresh = c.fresh;
    c.fresh = false;
    switch (m.t) {
      case 'here':
        if (!fresh || !inside(m.col, m.row) || !walkable(m.col, m.row) || !DIRS.has(m.dir)) return send(c, { t: 'snap', col: p.col, row: p.row });
        Object.assign(p, { col: m.col, row: m.row, dir: m.dir });
        return others(c, { t: 'join', player: p }); // seen at the spawn point so far: show them where they are
      case 'step': {
        const dc = (m.col as number) - p.col;
        const dr = (m.row as number) - p.row;
        const ok = inside(m.col, m.row) && walkable(m.col, m.row) && Math.abs(dc) <= 1 && Math.abs(dr) <= 1 && (dc || dr) && spend(c);
        if (!ok) return send(c, { t: 'snap', col: p.col, row: p.row });
        Object.assign(p, { col: m.col, row: m.row, dir: dirForStep(dc, dr), sit: false });
        return others(c, { t: 'step', id: p.id, col: p.col, row: p.row });
      }
      case 'face':
        if (!DIRS.has(m.dir) || !spend(c)) return;
        p.dir = m.dir;
        return others(c, { t: 'face', id: p.id, dir: p.dir });
      case 'sit': {
        // Benches are blocked tiles next to where you stand.
        const near = inside(m.col, m.row) && Math.abs((m.col as number) - p.col) <= 1 && Math.abs((m.row as number) - p.row) <= 1;
        if (!near || !DIRS.has(m.dir) || !spend(c)) return send(c, { t: 'snap', col: p.col, row: p.row });
        Object.assign(p, { col: m.col, row: m.row, dir: m.dir, sit: true });
        return others(c, { t: 'sit', id: p.id, col: p.col, row: p.row, dir: p.dir });
      }
      case 'stand':
        if (!p.sit) return;
        p.sit = false;
        return others(c, { t: 'stand', id: p.id });
      case 'say': {
        const text = tidy(m.text);
        if (!text) return send(c, { t: 'say-refused', reason: 'invalid' });
        const now = Date.now();
        c.says = Math.min(SAY_BURST, c.says + ((now - c.saidAt) / 1000) * SAYS_PER_SECOND);
        c.saidAt = now;
        if (c.says < 1) return send(c, { t: 'say-refused', reason: 'slow' });
        c.says -= 1;
        // To everyone, the speaker included (their own words come back this way). Not saved anywhere.
        return everyone({ t: 'say', id: p.id, text });
      }
    }
  };

  const join = (ws: WebSocket, userId: string, profile: TownProfile) => {
    // A second tab takes over: the first one is told and closed.
    const old = conns.get(userId);
    if (old) {
      conns.delete(userId);
      others(old, { t: 'leave', id: old.player.id });
      old.ws.close(4000, 'opened elsewhere');
    }
    const [col, row] = map.spawn;
    const player: TownPlayer = { id: randomBytes(6).toString('hex'), ...profile, col, row, dir: 's', sit: false };
    const c: Conn = { ws, userId, player, tokens: STEP_BURST, refilled: Date.now(), says: SAY_BURST, saidAt: Date.now(), alive: true, fresh: true };
    send(c, { t: 'welcome', you: player.id, players: [...conns.values()].map((o) => o.player) });
    conns.set(userId, c);
    others(c, { t: 'join', player });

    ws.on('pong', () => (c.alive = true));
    ws.on('message', (data) => {
      let m: TownClientMessage;
      try {
        m = JSON.parse(String(data));
      } catch {
        return;
      }
      if (m && typeof m === 'object') handle(c, m);
    });
    ws.on('close', () => {
      if (conns.get(userId) !== c) return; // already replaced by a newer tab
      conns.delete(userId);
      others(c, { t: 'leave', id: player.id });
    });
  };

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/ws') return void socket.destroy();
    void (async () => {
      const userId = await opts.authenticate(req).catch(() => null);
      const profile = userId ? opts.profile(userId) : null;
      if (!userId || !profile) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => join(ws, userId, profile));
    })();
  });

  // Drop connections that stopped answering pings (closed laptops, lost Wi-Fi).
  setInterval(() => {
    for (const c of conns.values()) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }, HEARTBEAT_MS).unref();
}
