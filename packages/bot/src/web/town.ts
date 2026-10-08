import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { Arena, type ArenaBets, type ArenaSeat, arenaLine } from './town-arena.js';
import type { LevelGain } from './progress.js';
import type { Attacker, MobRoom } from './town-mobs.js';
import { PARTY_MAX, type PartyChange, Parties } from './town-party.js';
import type { CharacterProgress, HoodHouse, HoodMap, OutfitData, PartyState, TownRace, TitleData, TownAnnouncement, TownChatLine, TownClientMessage, TownDir, TownEmote, TownMove, TownPlayer, TownServerMessage, TownStayInfo, TownSystemLine } from '@mikazuki/shared';

// 🏘️ Who's in the web town, and where: a WebSocket at /ws for logged-in members (see room-api's town.ts for the
// messages). The server keeps everyone's tile and checks each step — on the map, not blocked, next to the last
// one, no faster than walking — and passes it on to everyone else; chat goes to everyone, tidied and rate-limited.
// Nothing here is saved (positions or chat): leave and you're gone.
// The Arena's jack en poy against another player is played here too (town-arena.ts decides it; the messages are
// arena-*).
// One connection per member (a second tab takes over). Login and profiles come from the caller (server.ts), so
// this file has no Discord in it.
// Rooms: the town, and others the caller adds (the neighbourhood), picked with ?room= on the socket's address (going
// from one to the other is a new connection). Walking, benches and who you see are per room; chat, the system feed,
// banners and everything about a member (gifts, looks, jail) reach everyone. Parties (town-party.ts) span every room.

const DIRS = new Set<TownDir>(['s', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw']);
const MOVES = new Set<TownMove>(['dash', 'step-back', 'charge', 'blink']);
const EMOTES = new Set<TownEmote>(['heart', 'laugh', 'exclaim', 'question', 'kowen', 'sleep', 'angry', 'wave']);
/** Emotes: a burst of 3, then one a second. */
const EMOTES_PER_SECOND = 1;
const EMOTE_BURST = 3;
/** Walking is 4 tiles a second; allow a little more, in bursts (messages bunch up on a bad connection). */
const STEPS_PER_SECOND = 6;
const STEP_BURST = 6;
const HEARTBEAT_MS = 30_000;
/** Arrivals spread over the free tiles this far (in tiles, each way) around the map's spawn point. */
const SPAWN_SPREAD = 3;
/** Chat: up to 120 characters; a burst of 3, then one every 2 s. */
const SAY_MAX = 120;
const SAYS_PER_SECOND = 0.5;
const SAY_BURST = 3;
/** Lines kept for people arriving (in memory only, gone on restart). */
const RECENT = 20;
/** How long a notice is also shown to people arriving. */
const NOTICE_MS = 30 * 60_000;
/** System feed lines kept for people arriving (in memory only). */
const SYSTEM_RECENT = 10;
/** Messages from the Discord channel can be longer, up to this. */
const DISCORD_MAX = 200;
/** A party member who disconnects stays in it this long (a reload, a gate to another area). */
const PARTY_AWAY_MS = 60_000;
/** Party invites: one a second. */
const INVITE_GAP_MS = 1000;

/** A chat message tidied up: no control characters, single spaces, trimmed; null if empty or too long. */
function tidy(text: unknown, max = SAY_MAX): string | null {
  if (typeof text !== 'string') return null;
  const t = text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return t && [...t].length <= max ? t : null;
}

export interface TownMap {
  size: [number, number]; // [cols, rows]
  spawn: [number, number]; // [col, row]
  blocked: number[][]; // [row][col], 1 = blocked
  /** Tiles nobody arrives on (the gates to other areas: stepping on one there would take you straight back). */
  avoid?: [number, number][];
}

export interface TownProfile {
  nickname: string;
  title: TitleData;
  outfit: OutfitData;
  jailed?: boolean;
  /** Their class and worn weapon (web/adventure.ts), if any, and level. */
  cls?: string | null;
  weapon?: string | null;
  level?: number;
}

export interface TownOptions {
  /** The Arena's bets (Kowens): where stakes are held and paid; without it, matches have no bets. */
  arenaBets?: ArenaBets;
  /** The member behind an upgrade request, or null to refuse it. */
  authenticate: (req: IncomingMessage) => Promise<string | null>;
  /** Their nickname, title and look; null if they haven't made a character yet. */
  profile: (userId: string) => TownProfile | null;
  map: TownMap;
  /** Other rooms by name (e.g. 'hood'), each with its map (asked for again on each arrival, so it can grow). */
  rooms?: Record<string, () => TownMap>;
  /** Rooms with mobs (the Slums: web/town-mobs.ts), run here so everyone there sees the same ones. */
  mobs?: Record<string, MobRoom>;
  /** Characters' levels (web/adventure.ts in the bot; in memory on the game's dev server, web/progress.ts either way):
   *  who someone is in a fight, and a kill's XP for them (saved; the level-ups it brought). Without it everyone fights as
   *  their class at Lv 1 and gains nothing. */
  progress?: {
    fighter(userId: string): Attacker;
    kill(userId: string, mob: { level: number; xp: number }): LevelGain;
  };
  /** Whether a member may join a room (the Slums: testers only); every room when left out. */
  mayEnter?: (room: string, userId: string) => Promise<boolean>;
  /** Leave upgrades to other paths alone (the game's dev server shares its HTTP server with Vite's own socket). */
  shared?: boolean;
  /** Someone said something in town (the Discord bridge passes it on). */
  onSay?: (userId: string, nickname: string, text: string, megaphone: boolean) => void;
  /** Uses one of a member's megaphones (`/m` in the chat): how many are left, or null if they have none. Without it
   *  (the game's dev server) megaphones are free. */
  megaphone?: (userId: string) => number | null;
  /** What to start with after a restart, and where to keep it (web/town-memory.ts in the bot): the last chat lines and
   *  the system feed's. Without it they live in memory only. */
  memory?: { chat: TownChatLine[]; system: TownSystemLine[]; save(chat: TownChatLine[], system: TownSystemLine[]): void };
  /** Chat moderation (web/town-mod.ts in the bot; none in the game's dev server). */
  moderation?: {
    mutedUntil(userId: string): number | null;
    kickedUntil(userId: string): number | null;
    filter(text: string): string;
  };
}

/** Close code for a moderator's kick (the reason is when they may come back, in ms). */
export const KICKED = 4001;

/** What the rest of the bot can do with the town. */
export interface Town {
  /** A message from the town's Discord channel: to everyone in town, with a Discord mark. */
  fromDiscord(name: string, text: string): void;
  /** A line for the system feed (digs, bets): to everyone in town, and kept for people arriving. `userId` (a dig's
   *  digger) becomes their town player id on the live line, if they're here. */
  system(line: TownSystemLine, userId?: string): void;
  /** A banner for everyone in town; a notice is also shown to people arriving in the next 30 minutes. */
  announce(a: TownAnnouncement): void;
  /** Removes a member from the town now (they're kept out by moderation.kickedUntil). */
  kick(userId: string, until: number): boolean;
  /** The member behind a town player id, if they're here (ids are random per visit: Discord ids never reach the page). */
  memberOf(playerId: string): string | null;
  /** Tells a member, if they're in town, that someone gave them Kowens. */
  gifted(userId: string, from: string, amount: number): void;
  /** Tells a member, if they're in town, that the gifter gave them an item. */
  giftedItem(userId: string, from: string, item: { id: string; name: string; rarity: string }, quantity: number): void;
  /** Tells a member, if they're in town, that their Kowens changed (the HUD reloads them). */
  wallet(userId: string): void;
  /** The members in town right now. */
  here(): string[];
  /** Tells a member, if they're in town, where their stay reward is (a Kowen ready to claim). */
  stay(userId: string, stay: TownStayInfo): void;
  /** A member was jailed or released: everyone in town sees it under their name (them included). */
  setJailed(userId: string, on: boolean): void;
  /** A member has a new title: the reward pop-up, if they're in town. */
  newTitle(userId: string, id: string, title: TitleData): void;
  /** A member changed their look or title at the Parlor: everyone in town sees it (them included). */
  restyle(userId: string, outfit: OutfitData, title: TitleData): void;
  /** A member changed their nickname (a Rename Card): everyone in town sees the new name (them included). */
  renamed(userId: string, nickname: string): void;
  /** A member chose a class or changed their weapon: everyone in town sees it (the resting weapon, the chat's badge). */
  kit(userId: string, cls: string | null, weapon: string | null): void;
  /** A member's level, XP or points changed outside a fight (points refunded, dev's ?xp=): theirs to them, and with
   *  `ups` levels gained "Level up!" over them for their room. */
  progress(userId: string, progress: CharacterProgress, ups?: number, gained?: number): void;
  /** A house built, given a new look, or its Bakod up or down: everyone in the neighbourhood sees it at once (it rises,
   *  puffs into its new look, or its fence goes up or comes down). */
  /** The Mosang race (games/race.ts) changed: to everyone in town and the neighbourhood, and to arrivals while it's on. */
  race(state: TownRace | null): void;
  house(change: 'built' | 'look' | 'fence', house: HoodHouse, at: { col: number; row: number; door: [number, number]; fence: HoodMap['fence'] }): void;
  /** A member (if in town) flexed an item from their bag: to everyone, them included (chat line + bubble). */
  flexed(userId: string, item: { id: string; name: string; rarity: string }): void;
  /** A member (if in town) says a diss, praise or judge line: to everyone, the speaker included. */
  verdict(userId: string, kind: 'roast' | 'praise', judged: boolean, text: string): void;
}

/** The game's map (packages/game/public/assets/maps/town.json), from the monorepo next to the bot. */
/** A map from the game's assets (maps/<name>.json: the town, the Slums), as far as the server needs it. (Raised ground
 *  isn't checked here, like fences: the game keeps to its ramps.) */
export function loadTownMap(name = 'town'): TownMap {
  const json = JSON.parse(readFileSync(new URL(`../../../game/public/assets/maps/${name}.json`, import.meta.url), 'utf8')) as TownMap & { gates?: Record<string, [number, number][]> };
  return { size: json.size, spawn: json.spawn, blocked: json.blocked, avoid: Object.values(json.gates ?? {}).flat() };
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
  /** 'town', or one of TownOptions.rooms. */
  room: string;
  player: TownPlayer;
  tokens: number;
  refilled: number;
  says: number;
  saidAt: number;
  emotes: number;
  emotedAt: number;
  /** The last mobility move shown (ms). */
  movedAt?: number;
  alive: boolean;
  /** Still at the spawn point, so 'here' is accepted (once). */
  fresh: boolean;
  /** This connection as the Arena sees it (made on first use). */
  seat?: ArenaSeat;
  /** The last party invite sent (ms). */
  invitedAt?: number;
}

export function attachTown(server: Server, opts: TownOptions): Town {
  const { map } = opts;
  const [cols, rows] = map.size;
  const conns = new Map<string, Conn>(); // by member
  const recent: TownChatLine[] = (opts.memory?.chat ?? []).slice(-RECENT);
  const systemLines: TownSystemLine[] = (opts.memory?.system ?? []).slice(-SYSTEM_RECENT);
  const keep = () => opts.memory?.save(recent, systemLines);
  const remember = (line: TownChatLine) => {
    recent.push(line);
    if (recent.length > RECENT) recent.shift();
    keep();
  };
  let notice: { a: TownAnnouncement; until: number } | null = null;
  let raceNow: TownRace | null = null;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const arena = new Arena(undefined, undefined, opts.arenaBets ?? null, (r) => postSystem({ kind: 'arena', text: arenaLine(r, Math.random()), tone: r.bot === 'loser' ? 'win' : 'lose' })); // mocking the loser (in the loss colour; beating the bot in the win colour)

  const send = (c: Conn, m: TownServerMessage) => c.ws.readyState === WebSocket.OPEN && c.ws.send(JSON.stringify(m));
  /** To everyone in `c`'s room but `c` (the message is turned into text once). */
  const others = (c: Conn, m: TownServerMessage) => {
    const text = JSON.stringify(m);
    for (const o of conns.values()) if (o !== c && o.room === c.room && o.ws.readyState === WebSocket.OPEN) o.ws.send(text);
  };
  /** To everyone, in every room. */
  const everyone = (m: TownServerMessage) => {
    const text = JSON.stringify(m);
    for (const o of conns.values()) if (o.ws.readyState === WebSocket.OPEN) o.ws.send(text);
  };
  // Parties (town-party.ts): kept by member; what the page sees is each member's party key, town id (while here) and
  // where they are. Last-known names and looks, so a member who stepped away still shows.
  const known = new Map<string, { nickname: string; outfit: OutfitData; cls?: string | null }>();
  const parties = new Parties((u) => known.get(u)?.nickname ?? 'Someone');
  const away = new Map<string, NodeJS.Timeout>();
  const partyFor = (user: string): PartyState | null => {
    const party = parties.of(user);
    if (!party) return null;
    return {
      leader: parties.key(party.leader),
      you: parties.key(user),
      max: PARTY_MAX,
      members: party.members.map((m) => {
        const o = conns.get(m);
        const k = known.get(m);
        return { key: parties.key(m), id: o?.player.id ?? null, nickname: k?.nickname ?? 'Someone', outfit: k!.outfit, cls: k?.cls ?? null, area: o?.room ?? null };
      }),
    };
  };
  /** Sends the party (and a note) to everyone in it. */
  const tellParty = (user: string, note?: string) => {
    for (const m of parties.of(user)?.members ?? []) {
      const o = conns.get(m);
      if (o) send(o, { t: 'party', party: partyFor(m), ...(note ? { note } : {}) });
    }
  };
  const partyChanged = (change: PartyChange | null) => {
    if (!change) return;
    for (const { user, note } of change.out) {
      const o = conns.get(user);
      if (o) send(o, { t: 'party', party: null, note });
    }
    if (change.party) tellParty(change.party.leader, change.note);
  };
  /** A member disconnected: still in their party for a minute (shown away), then out. */
  const stepAway = (user: string) => {
    if (!parties.of(user)) return;
    tellParty(user);
    clearTimeout(away.get(user));
    away.set(user, setTimeout(() => {
      away.delete(user);
      if (!conns.has(user)) partyChanged(parties.leave(user));
    }, PARTY_AWAY_MS));
  };
  const mapOf = (room: string): TownMap => (room === 'town' ? map : opts.rooms?.[room]?.() ?? map);
  const inside = (m: TownMap, col: unknown, row: unknown): col is number =>
    Number.isInteger(col) && Number.isInteger(row) && (col as number) >= 0 && (row as number) >= 0 && (col as number) < m.size[0] && (row as number) < m.size[1];
  const walkable = (m: TownMap, col: number, row: number) => !m.blocked[row]?.[col];

  /** A system feed line: to everyone in town, and kept for people arriving (`userId`: tagged with their town id). */
  const postSystem = (line: TownSystemLine, userId?: string) => {
    systemLines.push(line);
    if (systemLines.length > SYSTEM_RECENT) systemLines.shift();
    keep();
    const playerId = userId ? conns.get(userId)?.player.id : undefined;
    everyone({ t: 'system', line: playerId ? { ...line, playerId } : line });
  };

  /** A member's level, XP and points to them; each level-up "Level up!" over them for their room (them included). */
  const progressed = (c: Conn, g: Pick<LevelGain, 'progress' | 'ups' | 'gained'>) => {
    c.player.level = g.progress.level;
    send(c, { t: 'progress', progress: g.progress, ...(g.gained ? { gained: g.gained } : {}) });
    if (g.ups > 0) {
      const up: TownServerMessage = { t: 'level-up', id: c.player.id, level: g.progress.level };
      others(c, up);
      send(c, up);
    }
  };

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
    const here = mapOf(c.room);
    const inside_ = (col: unknown, row: unknown): col is number => inside(here, col, row);
    const walkable_ = (col: number, row: number) => walkable(here, col, row);
    const fresh = c.fresh;
    c.fresh = false;
    switch (m.t) {
      case 'here':
        if (!fresh || !inside_(m.col, m.row) || !walkable_(m.col, m.row) || !DIRS.has(m.dir)) return send(c, { t: 'snap', col: p.col, row: p.row });
        Object.assign(p, { col: m.col, row: m.row, dir: m.dir });
        return others(c, { t: 'join', player: p }); // seen at the spawn point so far: show them where they are
      case 'step': {
        const dc = (m.col as number) - p.col;
        const dr = (m.row as number) - p.row;
        const ok = inside_(m.col, m.row) && walkable_(m.col, m.row) && Math.abs(dc) <= 1 && Math.abs(dr) <= 1 && (dc || dr) && spend(c);
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
        const near = inside_(m.col, m.row) && Math.abs((m.col as number) - p.col) <= 1 && Math.abs((m.row as number) - p.row) <= 1;
        if (!near || !DIRS.has(m.dir) || !spend(c)) return send(c, { t: 'snap', col: p.col, row: p.row });
        // One person per bench.
        for (const o of conns.values()) {
          if (o !== c && o.room === c.room && o.player.sit && o.player.col === m.col && o.player.row === m.row) {
            send(c, { t: 'seat-taken' });
            return send(c, { t: 'snap', col: p.col, row: p.row });
          }
        }
        Object.assign(p, { col: m.col, row: m.row, dir: m.dir, sit: true });
        return others(c, { t: 'sit', id: p.id, col: p.col, row: p.row, dir: p.dir });
      }
      case 'stand':
        if (!p.sit) return;
        p.sit = false;
        return others(c, { t: 'stand', id: p.id });
      case 'emote': {
        if (!EMOTES.has(m.emote)) return;
        const now = Date.now();
        c.emotes = Math.min(EMOTE_BURST, c.emotes + ((now - c.emotedAt) / 1000) * EMOTES_PER_SECOND);
        c.emotedAt = now;
        if (c.emotes < 1) return;
        c.emotes -= 1;
        return others(c, { t: 'emote', id: p.id, emote: m.emote });
      }
      case 'move': {
        // A mobility move: just shown to the others (the steps after it move them, checked as ever). Ends near
        // where they are, one at a time.
        const near = inside_(m.col, m.row) && Math.abs((m.col as number) - p.col) <= 6 && Math.abs((m.row as number) - p.row) <= 6;
        const now = Date.now();
        if (!MOVES.has(m.move) || !near || now - (c.movedAt ?? 0) < 800) return;
        c.movedAt = now;
        return others(c, { t: 'move', id: p.id, move: m.move, col: m.col, row: m.row });
      }
      case 'attack': {
        // A damage skill on a mob (battle maps only): the mob room decides; everyone there sees the hit.
        const mobs = opts.mobs?.[c.room];
        if (!mobs || typeof m.mob !== 'string' || !Number.isInteger(m.skill)) return;
        // Their class, level, points, everything worn and skill levels (the class and weapon alone without saved levels).
        const who = opts.progress?.fighter(c.userId) ?? { cls: p.cls, gear: [p.weapon] };
        const r = mobs.attack(p.id, [p.col, p.row], who, m.mob, Date.now(), m.skill as number, p.nickname);
        if (!r.ok) return send(c, { t: 'attack-refused', reason: r.reason });
        // The hit, then what it set off (the golem calling the Junk, enraging, falling: its line too, to this room only).
        for (const e of [{ t: 'mob-hit', by: p.id, skill: m.skill as number, hits: r.hits } satisfies TownServerMessage, ...mobs.flush()]) {
          others(c, e);
          send(c, e);
        }
        // What it killed: its XP for whoever earns it (the killer; the golem's for everyone who did enough), if still here.
        for (const k of r.kills) {
          for (const id of k.to) {
            const o = [...conns.values()].find((x) => x.player.id === id);
            if (o && opts.progress) progressed(o, opts.progress.kill(o.userId, k));
          }
        }
        return;
      }
      case 'party-invite': {
        const now = Date.now();
        if (now - (c.invitedAt ?? 0) < INVITE_GAP_MS) return send(c, { t: 'party-refused', reason: 'slow' });
        c.invitedAt = now;
        const to = typeof m.to === 'string' ? town.memberOf(m.to) : null;
        const them = to ? conns.get(to) : undefined;
        if (!to || !them) return send(c, { t: 'party-refused', reason: 'gone' });
        const r = parties.invite(c.userId, to, now);
        if (!r.ok) return send(c, { t: 'party-refused', reason: r.reason, name: them.player.nickname });
        return send(them, { t: 'party-invited', invite: r.invite, from: p.id, name: p.nickname, members: r.members });
      }
      case 'party-answer': {
        if (typeof m.invite !== 'string') return;
        const r = parties.answer(c.userId, m.invite, m.accept === true, Date.now());
        if (!r.ok) return send(c, { t: 'party-refused', reason: r.reason });
        if (!r.change) {
          const inviter = conns.get(r.from);
          return inviter && send(inviter, { t: 'party-declined', name: p.nickname });
        }
        return partyChanged(r.change);
      }
      case 'party-leave':
        return partyChanged(parties.leave(c.userId));
      case 'party-disband': {
        const r = parties.disband(c.userId);
        return r.ok ? partyChanged(r.change) : send(c, { t: 'party-refused', reason: r.reason });
      }
      case 'party-kick': {
        const r = typeof m.member === 'string' ? parties.kick(c.userId, m.member) : null;
        if (!r) return;
        return r.ok ? partyChanged(r.change) : send(c, { t: 'party-refused', reason: r.reason });
      }
      case 'arena-queue':
        if (p.jailed) return; // no games from jail
        c.seat ??= { key: c.userId, player: p, send: (msg) => send(c, msg) };
        return arena.join(c.seat, m.bet);
      case 'arena-bot':
        if (p.jailed) return;
        c.seat ??= { key: c.userId, player: p, send: (msg) => send(c, msg) };
        return arena.playBot(c.seat, m.bet);
      case 'arena-cancel':
        return arena.cancel(c.userId);
      case 'arena-pick':
        return arena.pick(c.userId, m.hand);
      case 'arena-rematch':
        return arena.rematch(c.userId, m.bet);
      case 'arena-decline':
        return arena.decline(c.userId);
      case 'arena-leave':
        return arena.leave(c.userId);
      case 'say': {
        const muted = opts.moderation?.mutedUntil(c.userId);
        if (muted) return send(c, { t: 'say-refused', reason: 'muted', until: muted });
        const tidied = tidy(m.text);
        if (!tidied) return send(c, { t: 'say-refused', reason: 'invalid' });
        const text = opts.moderation ? opts.moderation.filter(tidied) : tidied;
        const now = Date.now();
        c.says = Math.min(SAY_BURST, c.says + ((now - c.saidAt) / 1000) * SAYS_PER_SECOND);
        c.saidAt = now;
        if (c.says < 1) return send(c, { t: 'say-refused', reason: 'slow' });
        // To the party only: its members, wherever they are (not kept, not to Discord).
        if (m.party === true) {
          const party = parties.of(c.userId);
          if (!party) return send(c, { t: 'say-refused', reason: 'party' });
          c.says -= 1;
          for (const member of party.members) {
            const o = conns.get(member);
            if (o) send(o, { t: 'party-say', id: p.id, name: p.nickname, text });
          }
          return;
        }
        const megaphone = m.megaphone === true;
        if (megaphone && opts.megaphone && opts.megaphone(c.userId) === null) return send(c, { t: 'say-refused', reason: 'megaphone' });
        c.says -= 1;
        // To everyone, the speaker included (their own words come back this way), and on to Discord. Not saved.
        remember({ name: p.nickname, text, ...(megaphone ? { megaphone } : {}) });
        opts.onSay?.(c.userId, p.nickname, text, megaphone);
        return everyone({ t: 'say', id: p.id, name: p.nickname, text, ...(megaphone ? { megaphone } : {}) });
      }
    }
  };

  /** A walkable tile near the room's spawn point that nobody's standing on (any walkable one if they're all taken). */
  const arrival = (room: string): [number, number] => {
    const m = mapOf(room);
    const [sc, sr] = m.spawn;
    const taken = new Set([...conns.values()].filter((o) => o.room === room).map((o) => `${o.player.col},${o.player.row}`));
    const avoid = new Set((m.avoid ?? []).map(([c, r]) => `${c},${r}`));
    const free: [number, number][] = [];
    const open: [number, number][] = [];
    for (let r = sr - SPAWN_SPREAD; r <= sr + SPAWN_SPREAD; r++) {
      for (let c = sc - SPAWN_SPREAD; c <= sc + SPAWN_SPREAD; c++) {
        if (!inside(m, c, r) || !walkable(m, c, r) || avoid.has(`${c},${r}`)) continue;
        open.push([c, r]);
        if (!taken.has(`${c},${r}`)) free.push([c, r]);
      }
    }
    const pool = free.length ? free : open.length ? open : [m.spawn];
    return pool[Math.floor(Math.random() * pool.length)];
  };

  const join = (ws: WebSocket, userId: string, profile: TownProfile, room: string) => {
    // Kicked by a moderator: told when they may come back, and closed.
    const kicked = opts.moderation?.kickedUntil(userId);
    if (kicked) return ws.close(KICKED, String(kicked));
    // A second tab takes over: the first one is told and closed.
    const old = conns.get(userId);
    if (old) {
      conns.delete(userId);
      arena.leave(userId);
      others(old, { t: 'leave', id: old.player.id });
      old.ws.close(4000, 'opened elsewhere');
    }
    const [col, row] = arrival(room);
    const player: TownPlayer = { id: randomBytes(6).toString('hex'), ...profile, col, row, dir: 's', sit: false };
    const c: Conn = { ws, userId, room, player, tokens: STEP_BURST, refilled: Date.now(), says: SAY_BURST, saidAt: Date.now(), emotes: EMOTE_BURST, emotedAt: Date.now(), alive: true, fresh: true };
    const mobRoom = opts.mobs?.[room];
    queueMicrotask(() => mobRoom && send(c, { t: 'mobs', mobs: mobRoom.snapshot(Date.now()), golem: mobRoom.golemState(Date.now()) })); // after the welcome
    send(c, { t: 'welcome', you: player.id, players: [...conns.values()].filter((o) => o.room === room).map((o) => o.player), recent, system: systemLines, spawn: [col, row], notice: notice && notice.until > Date.now() ? notice.a : undefined });
    conns.set(userId, c);
    others(c, { t: 'join', player });
    known.set(userId, { nickname: player.nickname, outfit: player.outfit, cls: player.cls });
    clearTimeout(away.get(userId));
    away.delete(userId);
    tellParty(userId); // back (or in another area): their new id and where they are
    if (raceNow) send(c, { t: 'race', race: { ...raceNow, now: Date.now() } });

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
      arena.leave(userId); // mid-match, the other player wins
      others(c, { t: 'leave', id: player.id });
      opts.mobs?.[room]?.forget(player.id); // no mob goes after someone who left
      stepAway(userId);
    });
  };

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') return void (opts.shared || socket.destroy());
    const room = url.searchParams.get('room') ?? 'town';
    if (room !== 'town' && !opts.rooms?.[room]) return void socket.destroy();
    void (async () => {
      const userId = await opts.authenticate(req).catch(() => null);
      const profile = userId ? opts.profile(userId) : null;
      if (!userId || !profile) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        return;
      }
      if (opts.mayEnter && !(await opts.mayEnter(room, userId).catch(() => false))) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => join(ws, userId, profile, room));
    })();
  });

  const town: Town = {
    fromDiscord(name, raw) {
      const tidied = tidy(raw.length > DISCORD_MAX ? `${[...raw].slice(0, DISCORD_MAX - 1).join('')}…` : raw, DISCORD_MAX);
      const text = tidied && opts.moderation ? opts.moderation.filter(tidied) : tidied;
      const who = tidy(name, 32);
      if (!text || !who) return;
      remember({ name: who, text, discord: true });
      everyone({ t: 'say-discord', name: who, text });
    },
    system: postSystem,
    kick(userId, until) {
      const c = conns.get(userId);
      if (!c) return false;
      conns.delete(userId);
      arena.leave(userId);
      others(c, { t: 'leave', id: c.player.id });
      c.ws.close(KICKED, String(until));
      stepAway(userId);
      return true;
    },
    memberOf(playerId) {
      for (const c of conns.values()) if (c.player.id === playerId) return c.userId;
      return null;
    },
    gifted(userId, from, amount) {
      const c = conns.get(userId);
      if (c) send(c, { t: 'gift', from, amount });
    },
    giftedItem(userId, from, item, quantity) {
      const c = conns.get(userId);
      if (c) send(c, { t: 'gift-item', from, item, quantity });
    },
    wallet(userId) {
      const c = conns.get(userId);
      if (c) send(c, { t: 'wallet' });
    },
    here() {
      return [...conns.keys()];
    },
    stay(userId, stay) {
      const c = conns.get(userId);
      if (c) send(c, { t: 'stay', stay });
    },
    newTitle(userId, id, title) {
      const c = conns.get(userId);
      if (c) send(c, { t: 'new-title', id, title });
    },
    race(state) {
      raceNow = state;
      everyone({ t: 'race', race: state });
    },
    house(change, house, at) {
      const text = JSON.stringify({ t: 'house', change, house, ...at } satisfies TownServerMessage);
      for (const o of conns.values()) if (o.room === 'hood' && o.ws.readyState === WebSocket.OPEN) o.ws.send(text);
    },
    restyle(userId, outfit, title) {
      const c = conns.get(userId);
      if (!c) return;
      Object.assign(c.player, { outfit, title });
      everyone({ t: 'look', id: c.player.id, outfit, title });
      known.set(userId, { ...known.get(userId)!, outfit });
      tellParty(userId);
    },
    renamed(userId, nickname) {
      const c = conns.get(userId);
      if (!c) return;
      c.player.nickname = nickname;
      everyone({ t: 'rename', id: c.player.id, nickname });
      known.set(userId, { ...known.get(userId)!, nickname });
      tellParty(userId);
    },
    kit(userId, cls, weapon) {
      const c = conns.get(userId);
      if (!c) return;
      Object.assign(c.player, { cls, weapon });
      everyone({ t: 'kit', id: c.player.id, cls, weapon });
      known.set(userId, { ...known.get(userId)!, cls });
      tellParty(userId);
    },
    progress(userId, progress, ups = 0, gained = 0) {
      const c = conns.get(userId);
      if (c) progressed(c, { progress, ups, gained });
    },
    setJailed(userId, on) {
      const c = conns.get(userId);
      if (!c || !!c.player.jailed === on) return;
      c.player.jailed = on || undefined;
      everyone({ t: 'jailed', id: c.player.id, on });
    },
    flexed(userId, item) {
      const c = conns.get(userId);
      if (c) everyone({ t: 'flex', id: c.player.id, itemId: item.id, itemName: item.name, rarity: item.rarity });
    },
    verdict(userId, kind, judged, text) {
      const c = conns.get(userId);
      if (c) everyone({ t: 'verdict', id: c.player.id, kind, judged, text });
    },
    announce(a) {
      if (a.kind === 'notice') notice = { a, until: Date.now() + NOTICE_MS };
      everyone({ t: 'announce', announcement: a });
    },
  };

  // The mobs: each room's clock, every quarter second; their hops go to whoever is in that room. So do the golem's lines
  // (`system`, kind 'golem': its warning, rise and fall), which are only for that room: never kept for arrivals like
  // postSystem's, and never passed to the bot's Discord feed (that only hears town.system).
  if (opts.mobs) {
    setInterval(() => {
      const now = Date.now();
      for (const [room, mobs] of Object.entries(opts.mobs ?? {})) {
        const here = [...conns.values()].filter((o) => o.room === room);
        const where = new Map(here.map((o) => [o.player.id, [o.player.col, o.player.row] as [number, number]]));
        const events = mobs.tick(now, where);
        if (!events.length) continue;
        const listeners = here.filter((o) => o.ws.readyState === WebSocket.OPEN);
        for (const e of events) {
          const text = JSON.stringify(e satisfies TownServerMessage);
          for (const o of listeners) o.ws.send(text);
        }
      }
    }, 250).unref?.();
  }

  // Party invites nobody answered in time: the inviter hears no.
  setInterval(() => {
    for (const i of parties.prune(Date.now())) {
      const from = conns.get(i.from);
      if (from) send(from, { t: 'party-declined', name: known.get(i.to)?.nickname ?? 'They' });
    }
  }, 5000).unref();

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
  return town;
}
