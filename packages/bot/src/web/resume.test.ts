import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { type ResumeArea, resumeAreaOf, resumeStart } from '@mikazuki/shared';

// The resume spot (CONTEXT.md Resume spot; shared resume.ts, web/last-area.ts): the area a member was last in, kept as
// they arrive in a room, sent with /me; a fresh visit starts there. Against a throwaway database.
const dir = mkdtempSync(join(tmpdir(), 'resume-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { lastAreaOf, resumeFor, saveLastArea } = await import('./last-area.js');
const { attachTown, loadTownMap } = await import('./town.js');

test('the area a room is kept as: the town and the neighbourhood as one, a run by its dungeon; anything else not at all', () => {
  assert.deepEqual(
    ['town', 'hood', 'slums', 'palengke', 'warrens:ab12', 'silong:cd34:b2', 'arena', ''].map(resumeAreaOf),
    ['hood', 'hood', 'slums', 'palengke', 'warrens', 'silong', null, null],
  );
});

test('where a fresh visit starts, by the last area (the table in CONTEXT.md Resume spot)', () => {
  const start = (lastArea: ResumeArea | undefined, o: { house?: boolean; guided?: boolean; palengkeOpen?: boolean } = {}) =>
    resumeStart({ lastArea, house: o.house ?? false, guided: o.guided ?? false, palengkeOpen: o.palengkeOpen ?? true });
  // The town or the neighbourhood: the neighbourhood with a house (at the door), the town without one.
  assert.deepEqual(start('hood', { house: true }), { area: 'hood' });
  assert.deepEqual(start('hood'), { area: 'town' }, 'no house: the neighbourhood would send them to build one');
  // A guided quest under way: the town, where its guide runs.
  assert.deepEqual(start('hood', { house: true, guided: true }), { area: 'town' });
  // The battle maps: their spawns (their way in); out of a dungeon: by its way out.
  assert.deepEqual(start('slums', { guided: true }), { area: 'slums' });
  assert.deepEqual(start('palengke'), { area: 'palengke' });
  assert.deepEqual(start('warrens'), { area: 'slums', from: 'warrens' });
  assert.deepEqual(start('silong'), { area: 'palengke', from: 'silong-b1' });
  // The Old Market not open to them yet: the Slums.
  assert.deepEqual(start('palengke', { palengkeOpen: false }), { area: 'slums' });
  assert.deepEqual(start('silong', { palengkeOpen: false }), { area: 'slums' });
  // Nothing kept: as before (house: the neighbourhood, else the town), whatever else.
  assert.deepEqual(start(undefined, { house: true, guided: true }), { area: 'hood' });
  assert.deepEqual(start(undefined), { area: 'town' });
});

test('kept per member (saved as it changes), and /me carries it with what bends it; nothing kept: nothing sent', () => {
  assert.equal(lastAreaOf('m1'), undefined);
  assert.deepEqual(resumeFor('m1', { guided: true, palengkeClosed: true }), {});
  saveLastArea('m1', 'warrens', 1000);
  assert.equal(lastAreaOf('m1'), 'warrens');
  assert.deepEqual(resumeFor('m1', { guided: false, palengkeClosed: false }), { lastArea: 'warrens' });
  assert.deepEqual(resumeFor('m1', { guided: true, palengkeClosed: true }), { lastArea: 'warrens', guided: true, palengkeClosed: true });
  saveLastArea('m1', 'slums', 2000);
  assert.equal(lastAreaOf('m1'), 'slums');
});

test('over the town\'s socket: each arrival keeps its area (the town as the neighbourhood), the latest winning', async () => {
  const saved: [string, ResumeArea][] = [];
  const server = createServer();
  attachTown(server, {
    map: loadTownMap(),
    rooms: { slums: () => loadTownMap('slums'), palengke: () => loadTownMap('palengke') },
    resume: { save: (u, a) => void saved.push([u, a]) },
    authenticate: async (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('as'),
    profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} as never }),
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  const open = (as: string, room: string) =>
    new Promise<WebSocket>((ok, no) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?as=${as}&room=${room}`);
      ws.on('message', (d) => JSON.parse(String(d)).t === 'welcome' && ok(ws));
      ws.on('error', no);
    });
  try {
    const town = await open('alice', 'town');
    town.close();
    (await open('alice', 'slums')).close();
    (await open('bob', 'palengke')).close();
    assert.deepEqual(saved, [['alice', 'hood'], ['alice', 'slums'], ['bob', 'palengke']]);
  } finally {
    server.close();
  }
});
