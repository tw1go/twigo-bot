import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { LeaderboardResponse, LeaderboardRow, MeResponse } from '@mikazuki/shared';
import type { Client } from 'discord.js';
import { config } from '../config.js';
import { balance, rankOf, topBalances, vaultBalance } from '../credits/store.js';
import { inventory } from '../dig/store.js';
import { ITEM_BY_ID } from '../dig/items.js';
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
  const body: MeResponse = { id: userId, name, avatar, kowens: balance(userId), vault: vaultBalance(userId), rank: rankOf(userId), items };
  send(res, 200, JSON.stringify(body));
}

/** Logout must come from the game's own page (SameSite=Lax already keeps other sites' POSTs cookie-less). */
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

  server.listen(port, '127.0.0.1', () => console.log(`[web] room API on 127.0.0.1:${port}`));
}
