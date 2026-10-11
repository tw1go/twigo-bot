import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Logging in (web/auth.ts) against a throwaway database (never the real data/), Discord's API stubbed: the website's
// cookie as ever; the desktop app's code at mikazuki://auth and its token (Bearer, or the WebSocket subprotocol); the
// iPhone home screen app's waiting login, which only the phone the login finished from can collect.
const dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { callback, exchange, login, loginClient, logout, sessionUser, waitForLogin } = await import('./auth.js');
const { closeDatabase } = await import('../db/db.js');

const MEMBER = '123456789';
// Discord's token and user endpoints (and the revoke) answer as for a member.
globalThis.fetch = (async (url: string | URL) => {
  const u = String(url);
  if (u.endsWith('/oauth2/token')) return new Response(JSON.stringify({ access_token: 'discord-token' }));
  if (u.endsWith('/users/@me')) return new Response(JSON.stringify({ id: MEMBER }));
  return new Response('{}');
}) as typeof fetch;
const guild = { members: { fetch: async () => ({ id: MEMBER }) } };
const client = { guilds: { cache: { get: () => guild, first: () => guild } } } as never;

/** A response that remembers what was written. */
function reply() {
  const r = { status: 0, headers: {} as Record<string, unknown>, body: '' };
  const res = { writeHead: (status: number, headers: Record<string, unknown> = {}) => Object.assign(r, { status, headers }) && res, end: (b = '') => void (r.body = String(b)) } as unknown as ServerResponse;
  return { r, res };
}
const req = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;
const cookie = (setCookies: unknown, name: string) => ([] as string[]).concat(setCookies as string[]).map((c) => new RegExp(`^${name}=([^;]*)`).exec(c)?.[1]).find((v) => v !== undefined);

/** A login started (its state cookie) and finished on Discord, for `app` (null: the website), from `ip`. */
async function finish(app: ReturnType<typeof loginClient>, ip = '1.2.3.4') {
  const start = reply();
  login(start.res, null, app);
  const state = cookie(start.r.headers['Set-Cookie'], 'mk_oauth_state')!;
  const cookies = [`mk_oauth_state=${state}`, ...(app ? [`mk_oauth_client=${app}`] : [])].join('; ');
  const end = reply();
  await callback(client, req({ cookie: cookies }), end.res, new URLSearchParams({ state, code: 'discord-code' }), ip);
  return end.r;
}

test('the website: back to /play/ with the session cookie, as ever', async () => {
  const r = await finish(null);
  assert.equal(r.status, 302);
  assert.equal(r.headers.Location, '/play/');
  const token = cookie(r.headers['Set-Cookie'], 'mk_session')!;
  assert.ok(token);
  assert.equal(sessionUser(req({ cookie: `mk_session=${token}` })), MEMBER);
});

test('the desktop app: a one-time code at mikazuki://auth, swapped once for a token it sends as Bearer or the subprotocol', async () => {
  const r = await finish(loginClient('desktop', null));
  assert.equal(r.status, 302);
  const location = String(r.headers.Location);
  assert.match(location, /^mikazuki:\/\/auth\?code=/);
  assert.equal(cookie(r.headers['Set-Cookie'], 'mk_session'), undefined, 'no cookie for the browser it finished in');
  const code = new URL(location).searchParams.get('code')!;
  const x = reply();
  exchange(x.res, code);
  assert.equal(x.r.status, 200);
  const { token } = JSON.parse(x.r.body) as { token: string };
  assert.ok(token);
  assert.equal(sessionUser(req({ authorization: `Bearer ${token}` })), MEMBER);
  assert.equal(sessionUser(req({ 'sec-websocket-protocol': `mikazuki, mk-token.${token}` })), MEMBER);
  const again = reply();
  exchange(again.res, code);
  assert.equal(again.r.status, 400, 'a code works once');
  // Logging out ends that session.
  logout(req({ authorization: `Bearer ${token}` }), reply().res);
  assert.equal(sessionUser(req({ authorization: `Bearer ${token}` })), null);
});

test('the desktop app: a cancelled login comes back to the app with the problem', async () => {
  const start = reply();
  login(start.res, null, 'desktop');
  const end = reply();
  await callback(client, req({ cookie: 'mk_oauth_client=desktop' }), end.res, new URLSearchParams({ error: 'access_denied' }));
  assert.equal(end.r.headers.Location, 'mikazuki://auth?error=cancelled');
});

test('the iPhone home screen app: its waiting login gives the code only to the phone it finished on, once; the code is the cookie', async () => {
  const nonce = 'n'.repeat(32);
  const app = loginClient('wait', nonce);
  const early = reply();
  waitForLogin(early.res, nonce, '1.2.3.4');
  assert.deepEqual(JSON.parse(early.r.body), { ok: false }, 'nothing before it starts');
  const r = await finish(app, '1.2.3.4');
  assert.equal(r.status, 200);
  assert.match(r.body, /logged in/);
  const elsewhere = reply();
  waitForLogin(elsewhere.res, nonce, '9.9.9.9');
  assert.deepEqual(JSON.parse(elsewhere.r.body), { ok: false }, 'another address gets nothing');
  const here = reply();
  waitForLogin(here.res, nonce, '1.2.3.4');
  const { ok, code } = JSON.parse(here.r.body) as { ok: boolean; code: string };
  assert.ok(ok && code);
  const twice = reply();
  waitForLogin(twice.res, nonce, '1.2.3.4');
  assert.deepEqual(JSON.parse(twice.r.body), { ok: false }, 'once');
  const x = reply();
  exchange(x.res, code);
  assert.equal(x.r.status, 200);
  const token = cookie(x.r.headers['Set-Cookie'], 'mk_session')!;
  assert.equal(sessionUser(req({ cookie: `mk_session=${token}` })), MEMBER);
  assert.equal(loginClient('wait', 'short'), null, 'a nonce must be long and plain');
});

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
