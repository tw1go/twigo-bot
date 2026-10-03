import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Client } from 'discord.js';
import { config } from '../config.js';
import { db } from '../db/db.js';

// Discord login for the web game (/play), over OAuth2 with the `identify` scope only (no email, no server list).
// Discord's access token is used once to learn who is logging in, then revoked. The browser gets a random session
// token in an httpOnly cookie; the database keeps only its SHA-256, so a copy of the database can't log anyone in.
// Only members of the server can log in, and a session ends if they leave.
//
//   GET  /auth/login     -> Discord's consent screen
//   GET  /auth/callback  -> checks state, exchanges the code, checks membership, sets the session cookie
//   POST /auth/logout    -> ends the session
// (GET /me is in server.ts.)

const DISCORD_API = 'https://discord.com/api/v10';
const SESSION_COOKIE = 'mk_session';
const STATE_COOKIE = 'mk_oauth_state';
const SESSION_MS = 30 * 86_400_000;
const STATE_SECONDS = 10 * 60;
export const GAME_PATH = '/play/';

export const loginEnabled = () => !!(config.clientSecret && config.publicUrl);
const redirectUri = () => `${config.publicUrl}/auth/callback`;
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

const insertSession = db.prepare('INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)');
const findSession = db.prepare<[string, number], { user_id: string }>('SELECT user_id FROM sessions WHERE token_hash = ? AND expires > ?');
const deleteSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
const deleteUserSessions = db.prepare('DELETE FROM sessions WHERE user_id = ?');
const pruneSessions = db.prepare('DELETE FROM sessions WHERE expires <= ?');

function readCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // a malformed cookie is ignored
    }
  }
  return out;
}

const setCookie = (name: string, value: string, maxAgeSeconds: number, path = '/') =>
  `${name}=${value}; Path=${path}; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
export const clearSessionCookie = () => setCookie(SESSION_COOKIE, '', 0);

function redirect(res: ServerResponse, location: string, cookies: string[] = []): void {
  res.writeHead(302, { Location: location, 'Set-Cookie': cookies, 'Cache-Control': 'no-store' });
  res.end();
}

const sameText = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Whether this Discord user is in the server. Single-member fetches don't need the privileged members intent. */
export async function isMember(client: Client, userId: string): Promise<boolean> {
  const guild = client.guilds.cache.get(config.guildId ?? '') ?? client.guilds.cache.first();
  return !!(guild && (await guild.members.fetch(userId).catch(() => null)));
}

/** The logged-in member's ID, or null. */
export function sessionUser(req: IncomingMessage): string | null {
  const token = readCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  return findSession.get(sha256(token), Date.now())?.user_id ?? null;
}

/** Ends every session of a member (e.g. they left the server). */
export function endSessions(userId: string): void {
  deleteUserSessions.run(userId);
}

export function login(res: ServerResponse): void {
  const state = randomBytes(16).toString('hex');
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: 'identify',
    state,
    prompt: 'none', // skip the consent screen for members who already allowed it
  }).toString();
  redirect(res, url.toString(), [setCookie(STATE_COOKIE, state, STATE_SECONDS, '/auth')]);
}

export async function callback(client: Client, req: IncomingMessage, res: ServerResponse, query: URLSearchParams): Promise<void> {
  const clearState = setCookie(STATE_COOKIE, '', 0, '/auth');
  const back = (problem: 'cancelled' | 'failed' | 'not-member') => redirect(res, `${GAME_PATH}?login=${problem}`, [clearState]);

  if (query.get('error')) return back('cancelled'); // they pressed Cancel on Discord's screen
  const state = query.get('state') ?? '';
  const expected = readCookies(req)[STATE_COOKIE] ?? '';
  const code = query.get('code');
  if (!state || !expected || !sameText(state, expected) || !code) return back('failed');

  const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret!,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
    }),
  });
  if (!tokenRes.ok) {
    console.error(`[auth] code exchange failed: HTTP ${tokenRes.status}`);
    return back('failed');
  }
  const { access_token: accessToken } = (await tokenRes.json()) as { access_token: string };
  const userRes = await fetch(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  // We only needed their ID: revoke Discord's token right away (best effort).
  void fetch(`${DISCORD_API}/oauth2/token/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret!, token: accessToken, token_type_hint: 'access_token' }),
  }).catch(() => {});
  if (!userRes.ok) {
    console.error(`[auth] user lookup failed: HTTP ${userRes.status}`);
    return back('failed');
  }
  const { id } = (await userRes.json()) as { id: string };
  if (!(await isMember(client, id))) return back('not-member');

  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  pruneSessions.run(now);
  insertSession.run(sha256(token), id, now, now + SESSION_MS);
  console.log(`[auth] ${id} logged in to the web game`);
  redirect(res, GAME_PATH, [clearState, setCookie(SESSION_COOKIE, token, SESSION_MS / 1000)]);
}

export function logout(req: IncomingMessage, res: ServerResponse): void {
  const token = readCookies(req)[SESSION_COOKIE];
  if (token) deleteSession.run(sha256(token));
  res.writeHead(204, { 'Set-Cookie': clearSessionCookie(), 'Cache-Control': 'no-store' });
  res.end();
}
