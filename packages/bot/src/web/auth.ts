import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type Client, PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';
import { db } from '../db/db.js';

// Discord login for the web game (/play), over OAuth2 with the `identify` scope only (no email, no server list).
// Discord's access token is used once to learn who is logging in, then revoked. The browser gets a random session
// token in an httpOnly cookie; the database keeps only its SHA-256, so a copy of the database can't log anyone in.
// Only members of the server can log in, and a session ends if they leave.
//
//   GET  /auth/login     -> Discord's consent screen (?next=cms: back to the CMS afterwards; ?client=desktop: the
//                           desktop app, which gets a one-time code at mikazuki://auth?code=…; ?client=wait&nonce=…:
//                           the iPhone home screen app, whose login finishes in a browser sheet while the app waits)
//   GET  /auth/callback  -> checks state, exchanges the code, checks membership, sets the session cookie (or, for the
//                           apps above, hands a one-time code over instead)
//   GET  /auth/wait      -> ?nonce=…: the waiting home screen app's one-time code, once its login has finished
//   POST /auth/exchange  -> { code }: a one-time code for a session: the cookie (the home screen app) or a token in the
//                           answer (the desktop app, which sends it back as Authorization: Bearer, or as the WebSocket
//                           subprotocol `mk-token.<token>`; stored like the cookie, its SHA-256 only)
//   POST /auth/logout    -> ends the session
// (GET /me is in server.ts.)

const DISCORD_API = 'https://discord.com/api/v10';
const SESSION_COOKIE = 'mk_session';
const STATE_COOKIE = 'mk_oauth_state';
const NEXT_COOKIE = 'mk_oauth_next'; // 'cms': back to the CMS after logging in, not the game
const CLIENT_COOKIE = 'mk_oauth_client'; // 'desktop', or 'wait.<nonce>' (the iPhone home screen app)
/** One-time codes and waiting logins live this long (a restart forgets them: log in again). */
const CODE_MS = 2 * 60_000;
const WAIT_MS = 10 * 60_000;
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

/** Whether this Discord user is in the server: everyone in it may play the web town. Single-member fetches don't need
 *  the privileged members intent. */
export async function isMember(client: Client, userId: string): Promise<boolean> {
  const guild = client.guilds.cache.get(config.guildId ?? '') ?? client.guilds.cache.first();
  return !!(guild && (await guild.members.fetch(userId).catch(() => null)));
}

/** Discord permissions that count as a mod or an admin (/town moderation). */
export const STAFF = [PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.ManageMessages];

/** The session token a request carries: the desktop app's (Authorization: Bearer, or on /ws the subprotocol
 *  `mk-token.<token>`), else the cookie. */
function sessionToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim() || null;
  for (const p of String(req.headers['sec-websocket-protocol'] ?? '').split(',')) {
    const t = p.trim();
    if (t.startsWith('mk-token.')) return t.slice('mk-token.'.length) || null;
  }
  return readCookies(req)[SESSION_COOKIE] ?? null;
}

/** The logged-in member's ID, or null. */
export function sessionUser(req: IncomingMessage): string | null {
  const token = sessionToken(req);
  if (!token) return null;
  return findSession.get(sha256(token), Date.now())?.user_id ?? null;
}

// ── One-time codes: the apps' way to end a login (the desktop app, the iPhone home screen app) ──

/** Codes handed over after a login, for POST /auth/exchange: who, for which app, until when (ms). In memory only. */
const codes = new Map<string, { user: string; app: 'web' | 'desktop'; until: number }>();
/** The iPhone home screen app's logins it waits for (by its nonce): the code once ready, and the address the login
 *  finished from. Only a wait from that same address gets the code: someone who sent a member a login link with their own
 *  nonce can't collect that member's session from elsewhere (the app and its browser sheet are on the same phone). */
const waiting = new Map<string, { code: string | null; ip: string | null; until: number }>();

function issueCode(user: string, app: 'web' | 'desktop', now: number): string {
  for (const [c, v] of codes) if (v.until <= now) codes.delete(c);
  const code = randomBytes(24).toString('base64url');
  codes.set(code, { user, app, until: now + CODE_MS });
  return code;
}

const NONCE = /^[A-Za-z0-9_-]{24,64}$/;

/** GET /auth/wait?nonce=…: the code once the login it waits for has finished ({ ok: true, code }), else { ok: false }.
 *  `ip`: who asks (only the address the login finished from gets it). */
export function waitForLogin(res: ServerResponse, nonce: string | null, ip: string): void {
  const now = Date.now();
  for (const [n, v] of waiting) if (v.until <= now) waiting.delete(n);
  const w = nonce && NONCE.test(nonce) ? waiting.get(nonce) : undefined;
  const ready = !!w?.code && w.ip === ip;
  const body = ready ? { ok: true, code: w!.code } : { ok: false };
  if (ready) waiting.delete(nonce!);
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** POST /auth/exchange { code }: a session for a one-time code: the cookie for the home screen app, a token in the answer
 *  for the desktop app. 400 for a used, unknown or old code. */
export function exchange(res: ServerResponse, code: unknown): void {
  const now = Date.now();
  const c = typeof code === 'string' ? codes.get(code) : undefined;
  if (typeof code === 'string') codes.delete(code);
  if (!c || c.until <= now) {
    res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return void res.end('{"ok":false,"error":"That login has expired. Log in again."}');
  }
  const token = newSession(c.user, now);
  console.log(`[auth] ${c.user} logged in to the ${c.app === 'desktop' ? 'desktop app' : 'home screen app'}`);
  if (c.app === 'desktop') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return void res.end(JSON.stringify({ ok: true, token }));
  }
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': setCookie(SESSION_COOKIE, token, SESSION_MS / 1000) });
  res.end('{"ok":true}');
}

/** A new session for a member: its token (the database keeps only its SHA-256). */
function newSession(user: string, now: number): string {
  const token = randomBytes(32).toString('base64url');
  pruneSessions.run(now);
  insertSession.run(sha256(token), user, now, now + SESSION_MS);
  return token;
}

/** A plain page for the browser sheet or window an app's login ended in (nothing to come back to there). */
function donePage(res: ServerResponse, title: string, text: string, cookies: string[] = []): void {
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': cookies });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#1a1b26;color:#F1EEFB;font:18px/1.4 system-ui,sans-serif;text-align:center"><div style="padding:24px"><h1 style="font-size:24px;color:#FCDA4A">${esc(title)}</h1><p>${esc(text)}</p></div></body>`);
}

/** Ends every session of a member (e.g. they left the server). */
export function endSessions(userId: string): void {
  deleteUserSessions.run(userId);
}

/** Whether this member may use the CMS: the gifter and CMS_USER_IDS. */
export const isCmsUser = (userId: string) => userId === config.rewardOwnerId || config.cmsUserIds.includes(userId);

/** Which app a login is for (GET /auth/login's ?client=…&nonce=…), or null: the website. */
export function loginClient(client: string | null, nonce: string | null): 'desktop' | `wait.${string}` | null {
  if (client === 'desktop') return 'desktop';
  if (client === 'wait' && nonce && NONCE.test(nonce)) return `wait.${nonce}`;
  return null;
}

export function login(res: ServerResponse, next?: string | null, app: 'desktop' | `wait.${string}` | null = null): void {
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
  const cookies = [setCookie(STATE_COOKIE, state, STATE_SECONDS, '/auth')];
  if (next === 'cms' && config.cmsPath) cookies.push(setCookie(NEXT_COOKIE, 'cms', STATE_SECONDS, '/auth'));
  if (app) cookies.push(setCookie(CLIENT_COOKIE, app, STATE_SECONDS, '/auth'));
  // The iPhone home screen app waits for this login (it asks GET /auth/wait every couple of seconds).
  if (app?.startsWith('wait.')) waiting.set(app.slice(5), { code: null, ip: null, until: Date.now() + WAIT_MS });
  redirect(res, url.toString(), cookies);
}

export async function callback(client: Client, req: IncomingMessage, res: ServerResponse, query: URLSearchParams, ip = ''): Promise<void> {
  const clearState = [setCookie(STATE_COOKIE, '', 0, '/auth'), setCookie(NEXT_COOKIE, '', 0, '/auth'), setCookie(CLIENT_COOKIE, '', 0, '/auth')];
  const home = readCookies(req)[NEXT_COOKIE] === 'cms' && config.cmsPath ? `${config.cmsPath}/` : GAME_PATH;
  // An app's login: the desktop app gets its code (or the problem) at mikazuki://auth; the iPhone home screen app's waits.
  const app = readCookies(req)[CLIENT_COOKIE] ?? '';
  const nonce = app.startsWith('wait.') && waiting.has(app.slice(5)) ? app.slice(5) : null;
  const PROBLEM = { cancelled: 'You cancelled the login.', failed: "The login didn't work. Try again.", 'not-member': 'Only members of the Mikazuki server can play.' };
  const back = (problem: 'cancelled' | 'failed' | 'not-member') => {
    if (app === 'desktop') return redirect(res, `mikazuki://auth?error=${problem}`, clearState);
    if (nonce) return donePage(res, 'Not logged in', `${PROBLEM[problem]} Go back to Mikazuki.`, clearState);
    redirect(res, `${home}?login=${problem}`, clearState);
  };

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

  const now = Date.now();
  if (app === 'desktop') return redirect(res, `mikazuki://auth?code=${issueCode(id, 'desktop', now)}`, clearState);
  if (nonce) {
    waiting.set(nonce, { code: issueCode(id, 'web', now), ip, until: now + WAIT_MS });
    return donePage(res, "You're logged in", 'Go back to Mikazuki: it will carry on by itself.', clearState);
  }
  const token = newSession(id, now);
  console.log(`[auth] ${id} logged in to the web game`);
  redirect(res, home, [...clearState, setCookie(SESSION_COOKIE, token, SESSION_MS / 1000)]);
}

export function logout(req: IncomingMessage, res: ServerResponse): void {
  const token = sessionToken(req);
  if (token) deleteSession.run(sha256(token));
  res.writeHead(204, { 'Set-Cookie': clearSessionCookie(), 'Cache-Control': 'no-store' });
  res.end();
}
