import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';

// 🚧 Maintenance mode against a throwaway database (never the real data/): the state (on with a tidied note, off), and
// over the town's socket: turning it on sends everyone but the allowed out with MAINTENANCE and the note, a newcomer
// is refused the same way, the allowed stay and come in, and off opens the door again.
const dir = mkdtempSync(join(tmpdir(), 'maintenance-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { DEFAULT_NOTE, NOTE_MAX, maintenance, maintenanceNote, setMaintenance } = await import('./maintenance.js');
const { MAINTENANCE, attachTown } = await import('./town.js');

const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

test('the state: on with a tidied note (or the plain line), on again only changes the note, off clears it', () => {
  assert.deepEqual(maintenance(), { on: false, note: '' });
  assert.equal(maintenanceNote(), DEFAULT_NOTE);
  const on = setMaintenance(true, '  Back   in 10\n minutes ', 'twigo');
  assert.equal(on.on, true);
  assert.equal(on.note, 'Back in 10 minutes');
  assert.equal(on.by, 'twigo');
  assert.ok(on.since && on.since <= Date.now());
  assert.equal(maintenanceNote(), 'Back in 10 minutes');
  const since = on.since;
  setMaintenance(true, 'x'.repeat(NOTE_MAX + 50), 'ana');
  assert.equal(maintenance().note.length, NOTE_MAX, 'cut to its most');
  assert.equal(maintenance().since, since, 'still since the first time');
  assert.equal(maintenance().by, 'ana');
  setMaintenance(true, '', 'ana');
  assert.equal(maintenanceNote(), DEFAULT_NOTE, 'an empty note: the plain line');
  assert.deepEqual(setMaintenance(false, 'ignored', 'ana'), { on: false, note: '' });
});

test("over the town's socket: on sends everyone but the allowed out and keeps them out, with the note; off lets them back", async () => {
  const server = createServer();
  const T = attachTown(server, {
    map: { size: [4, 4], spawn: [1, 1], blocked: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
    authenticate: async (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('as'),
    profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} as never }),
    maintenance: { on: () => maintenance().on, allowed: (userId) => userId === 'GM', note: maintenanceNote },
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  /** Opens a socket as `as`; resolves with how it ended (null while open). */
  const open = (as: string) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?as=${as}`);
    const ended: { code: number; reason: string }[] = [];
    ws.on('close', (code, reason) => ended.push({ code, reason: String(reason) }));
    return new Promise<{ ws: WebSocket; ended: typeof ended }>((ok) => ws.on('open', () => ok({ ws, ended })));
  };
  const mara = await open('Mara');
  const gm = await open('GM');
  await wait(60);
  assert.deepEqual(T.here().sort(), ['GM', 'Mara']);
  // On: Mara is out with the note, the GM stays.
  setMaintenance(true, 'Deploying, 5 minutes', 'twigo');
  assert.equal(T.closeForMaintenance(), 1);
  await wait(80);
  assert.deepEqual(mara.ended, [{ code: MAINTENANCE, reason: 'Deploying, 5 minutes' }]);
  assert.deepEqual(gm.ended, []);
  assert.deepEqual(T.here(), ['GM']);
  // A newcomer is refused the same way; another GM comes in.
  const bob = await open('Bob');
  await wait(80);
  assert.deepEqual(bob.ended, [{ code: MAINTENANCE, reason: 'Deploying, 5 minutes' }]);
  assert.equal(T.closeForMaintenance(), 0, 'nobody left to send out');
  // Off: the door opens.
  setMaintenance(false, '', 'twigo');
  const back = await open('Mara');
  await wait(80);
  assert.deepEqual(back.ended, []);
  assert.deepEqual(T.here().sort(), ['GM', 'Mara']);
  assert.equal(T.closeForMaintenance(), 0, 'off: nothing happens');
  for (const c of [gm, back]) c.ws.close();
  await new Promise((ok) => server.close(ok));
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
