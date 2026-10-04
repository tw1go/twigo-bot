import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { LeaderboardResponse, LeaderboardRow, MeResponse, PreregResponse, PreregStatus } from '@mikazuki/shared';
import type { Client } from 'discord.js';
import { config } from '../config.js';
import { balance, rankOf, topBalances, vaultBalance } from '../credits/store.js';
import { DIGS_PER_DAY, SHOVEL_COST, SHOVEL_USES, SHOVELS_PER_DAY, digsToday, inventory, shovelUses, shovelsBoughtToday } from '../dig/store.js';
import { ITEM_BY_ID } from '../dig/items.js';
import { getNickname, parseNickname, setNickname } from './nickname.js';
import { titleIsNew, titleOf, titleSeen } from './titles.js';
import { attachTown, loadTownMap } from './town.js';
import { bridgeTownChat } from './town-chat.js';
import { getOutfit, parseOutfit, saveOutfit } from './outfit.js';
import { LAUNCH_REWARD, isPreregistered, launched, preregCount, preregister } from '../prereg/prereg.js';
import { callback, clearSessionCookie, endSessions, isMember, login, loginEnabled, logout, sessionUser } from './auth.js';
import { roll } from './finds.js';

// A tiny HTTP API for twigo's room (tw1go.github.io). Read-only apart from
// the find roll, which only ever hands out a claim code — Kowens are
// credited in Discord by /claim, never over HTTP.
//
// Listens on localhost only. Caddy sits in front on the server and adds
// HTTPS (deploy/Caddyfile), which the site needs: a page served over HTTPS
// may not call a plain-HTTP address.
//
//   GET  /leaderboard   top 10 by Kowens, with display names and avatars
//   POST /find          { character, fairy? } -> { found, code?, expires? }
//   GET  /health        "ok"
//
// Web game (/play, same origin, so no CORS): Discord login (see auth.ts) and
//   GET  /me            the logged-in member: name, avatar, Kowens, items (401 if not logged in)
//   GET  /prereg        pre-registration status: open, count, reward (public)
//   POST /prereg        pre-register the logged-in member (from the game's page only)
//   PUT  /outfit        save the logged-in member's character look (from the game's page only)
//   PUT  /nickname      { nickname } -> 200 { nickname } | 400 invalid | 409 taken (from the game's page only)
//   POST /title/seen    the game showed the member their new title (from the game's page only)
//   WS   /ws            the live town: who else is there and where (see town.ts; from the game's page only)

const ALLOWED_ORIGINS = new Set([
  'https://tw1go.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
]);

/** Leaderboard responses are reused this long, so a burst of visitors is one lookup. */
const BOARD_TTL_MS = 30_000;
/** Names and avatars change rarely; looked up at most this often per member. */
const PROFILE_TTL_MS = 60 * 60_000;

interface Profile {
  name: string;
  avatar: string;
  at: number;
}

const profiles = new Map<string, Profile>();
let board: { at: number; body: string } | null = null;

async function profile(client: Client, id: string): Promise<Profile> {
  const cached = profiles.get(id);
  if (cached && Date.now() - cached.at < PROFILE_TTL_MS) return cached;
  // The server nickname if there is one, else their Discord display name.
  // Single-member fetches do not need the privileged members intent.
  const channel = await client.channels.fetch(config.gamesChannelId).catch(() => null);
  const guild = channel && 'guild' in channel ? channel.guild : null;
  const member = guild ? await guild.members.fetch(id).catch(() => null) : null;
  const user = member?.user ?? (await client.users.fetch(id).catch(() => null));
  const fresh = {
    name: member?.displayName ?? user?.globalName ?? user?.username ?? 'someone',
    avatar: (member ?? user)?.displayAvatarURL({ size: 64, extension: 'png' }) ?? '',
    at: Date.now(),
  };
  profiles.set(id, fresh);
  return fresh;
}

async function leaderboard(client: Client): Promise<string> {
  if (board && Date.now() - board.at < BOARD_TTL_MS) return board.body;
  const top = topBalances(10);
  const rows = await Promise.all(
    top.map(async ([id, kowens], i) => {
      const { name, avatar } = await profile(client, id);
      return { rank: i + 1, name, avatar, kowens } satisfies LeaderboardRow;
    }),
  );
  const body = JSON.stringify({ updated: Date.now(), rows } satisfies LeaderboardResponse);
  board = { at: Date.now(), body };
  return body;
}

/** The visitor's address. Behind Caddy the socket is always localhost, so
 *  the real one is the first hop of X-Forwarded-For — trusted only then. */
function clientIp(req: IncomingMessage): string {
  const socket = req.socket.remoteAddress ?? '';
  const forwarded = req.headers['x-forwarded-for'];
  if ((socket === '127.0.0.1' || socket === '::1' || socket === '::ffff:127.0.0.1') && typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return socket;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => {
      data += chunk;
      // Nothing legitimate is anywhere near this big.
      if (data.length > 1024) req.destroy();
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: string, type = 'application/json', headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

async function me(client: Client, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const userId = sessionUser(req);
  if (!userId) return send(res, 401, '{"error":"not logged in"}');
  if (!(await isMember(client, userId))) {
    endSessions(userId); // left the server
    return send(res, 401, '{"error":"not logged in"}', 'application/json', { 'Set-Cookie': clearSessionCookie() });
  }
  const { name, avatar } = await profile(client, userId);
  const items = inventory(userId).map(([id, count]) => {
    const item = ITEM_BY_ID.get(id)!;
    return { id, name: item.name, emoji: item.emoji, rarity: item.rarity, count };
  });
  const body: MeResponse = { id: userId, name, avatar, kowens: balance(userId), vault: vaultBalance(userId), rank: rankOf(userId), items, preregistered: isPreregistered(userId), outfit: getOutfit(userId), nickname: getNickname(userId), title: titleOf(userId), newTitle: titleIsNew(userId),
    dig: {
      shovel: shovelUses(userId),
      digsLeft: Math.max(0, DIGS_PER_DAY - digsToday(userId)),
      digsPerDay: DIGS_PER_DAY,
      shovelsLeft: Math.max(0, SHOVELS_PER_DAY - shovelsBoughtToday(userId)),
      shovelCost: SHOVEL_COST,
      shovelUses: SHOVEL_USES,
    } };
  send(res, 200, JSON.stringify(body));
}

/** Logout and pre-registration must come from the game's own page (SameSite=Lax already keeps other sites' POSTs cookie-less). */
const fromGame = (req: IncomingMessage) => !!config.publicUrl && req.headers.origin === config.publicUrl;

export function startWebServer(client: Client): void {
  const port = config.webPort;
  if (!port) {
    console.log('[web] WEB_PORT not set, room API disabled');
    return;
  }

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    try {
      if (req.method === 'OPTIONS') return void res.writeHead(204).end();
      if (req.method === 'GET' && path === '/health') return send(res, 200, 'ok', 'text/plain');
      if (req.method === 'GET' && path === '/leaderboard') return send(res, 200, await leaderboard(client));
      if (req.method === 'GET' && path === '/prereg') {
        return send(res, 200, JSON.stringify({ open: !launched(), count: preregCount(), reward: LAUNCH_REWARD } satisfies PreregStatus));
      }
      if (req.method === 'POST' && path === '/prereg') {
        if (!loginEnabled()) return send(res, 404, '{"error":"login is off"}');
        if (!fromGame(req)) return send(res, 403, '{"error":"forbidden"}');
        const userId = sessionUser(req);
        if (!userId) return send(res, 401, '{"error":"not logged in"}');
        const result = preregister(userId, 'web');
        return send(res, 200, JSON.stringify({ result, count: preregCount() } satisfies PreregResponse));
      }
      if (req.method === 'PUT' && path === '/outfit') {
        if (!loginEnabled()) return send(res, 404, '{"error":"login is off"}');
        if (!fromGame(req)) return send(res, 403, '{"error":"forbidden"}');
        const userId = sessionUser(req);
        if (!userId) return send(res, 401, '{"error":"not logged in"}');
        let body: unknown = null;
        try {
          body = JSON.parse((await readBody(req)) || 'null');
        } catch {
          // invalid JSON → rejected below
        }
        const outfit = parseOutfit(body);
        if (!outfit) return send(res, 400, '{"error":"invalid outfit"}');
        saveOutfit(userId, outfit);
        return send(res, 200, '{"ok":true}');
      }
      if (req.method === 'POST' && path === '/title/seen') {
        if (!loginEnabled()) return send(res, 404, '{"error":"login is off"}');
        if (!fromGame(req)) return send(res, 403, '{"error":"forbidden"}');
        const userId = sessionUser(req);
        if (!userId) return send(res, 401, '{"error":"not logged in"}');
        titleSeen(userId);
        return send(res, 200, '{"ok":true}');
      }
      if (req.method === 'PUT' && path === '/nickname') {
        if (!loginEnabled()) return send(res, 404, '{"error":"login is off"}');
        if (!fromGame(req)) return send(res, 403, '{"error":"forbidden"}');
        const userId = sessionUser(req);
        if (!userId) return send(res, 401, '{"error":"not logged in"}');
        let body: { nickname?: unknown } | null = null;
        try {
          body = JSON.parse((await readBody(req)) || 'null');
        } catch {
          // invalid JSON → rejected below
        }
        const nickname = parseNickname(body?.nickname);
        if (!nickname) return send(res, 400, '{"error":"invalid nickname"}');
        if (setNickname(userId, nickname) === 'taken') return send(res, 409, '{"error":"taken"}');
        return send(res, 200, JSON.stringify({ nickname }));
      }
      if (path.startsWith('/auth/') || path === '/me') {
        if (!loginEnabled()) return send(res, 404, '{"error":"login is off"}');
        if (req.method === 'GET' && path === '/auth/login') return login(res);
        if (req.method === 'GET' && path === '/auth/callback') return await callback(client, req, res, url.searchParams);
        if (req.method === 'POST' && path === '/auth/logout') return fromGame(req) ? logout(req, res) : send(res, 403, '{"error":"forbidden"}');
        if (req.method === 'GET' && path === '/me') return await me(client, req, res);
      }
      if (req.method === 'POST' && path === '/find') {
        // Only the room may roll: without an allowed Origin there is no find.
        if (!origin || !ALLOWED_ORIGINS.has(origin)) return send(res, 403, '{"found":false}');
        const body = JSON.parse((await readBody(req)) || '{}') as { character?: unknown; fairy?: unknown };
        const character = typeof body.character === 'string' ? body.character : 'someone';
        const result = roll(clientIp(req), character, body.fairy === true);
        if (result.found) console.log(`[web] find issued via ${character}`);
        return send(res, 200, JSON.stringify(result));
      }
      send(res, 404, '{"error":"not found"}');
    } catch (err) {
      console.error('[web] request failed:', err);
      send(res, 500, '{"error":"failed"}');
    }
  });

  // The live town (/ws): logged-in members who've made a character, from the game's own page.
  try {
    let toDiscord: (userId: string, nickname: string, text: string) => void = () => {};
    const town = attachTown(server, {
      onSay: (userId, nickname, text) => toDiscord(userId, nickname, text),
      map: loadTownMap(),
      authenticate: async (req) => {
        if (!loginEnabled() || !fromGame(req)) return null;
        const userId = sessionUser(req);
        return userId && (await isMember(client, userId)) ? userId : null;
      },
      profile: (userId) => {
        const nickname = getNickname(userId);
        const outfit = getOutfit(userId);
        return nickname && outfit ? { nickname, outfit, title: titleOf(userId) } : null;
      },
    });
    toDiscord = bridgeTownChat(client, town);
  } catch (err) {
    console.error('[web] town disabled, map not loaded:', err);
  }

  server.listen(port, '127.0.0.1', () => console.log(`[web] room API on 127.0.0.1:${port}`));
}
