import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Who can see (CONTEXT.md Who can see; web/privacy.ts), against a throwaway database (never the real .env or data/):
// the settings kept and read back, everyone / friends / only me for a viewer, the public (only 'everyone'), your own
// and Game Masters' always; the player menu's info with what's hidden as nothing; Discord's private answers.
const dir = mkdtempSync(join(tmpdir(), 'privacy-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.REWARD_OWNER_ID = 'gm'; // (the gifter: a Game Master)
process.env.TIMEZONE = 'Asia/Manila';

const { hiddenLine, maySee, privacyOf, seeFriendsBy, setPrivacy } = await import('./privacy.js');
const { playerInfo } = await import('./town-player.js');
const { add } = await import('../credits/store.js');
const { closeDatabase } = await import('../db/db.js');
const { DEFAULT_PRIVACY } = await import('@mikazuki/shared');

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});

test('settings: the default, a change kept (only what changed), read back', () => {
  assert.deepEqual(privacyOf('mara'), DEFAULT_PRIVACY);
  assert.deepEqual(setPrivacy('mara', { balance: 'friends' }), { whispers: 'everyone', balance: 'friends', status: 'everyone' });
  assert.deepEqual(setPrivacy('mara', { status: 'me', whispers: 'friends' }), { whispers: 'friends', balance: 'friends', status: 'me' });
  assert.deepEqual(privacyOf('mara'), { whispers: 'friends', balance: 'friends', status: 'me' });
});

test('who may see: everyone; friends (and only friends); only me; your own and Game Masters always; the public only everyone', () => {
  seeFriendsBy((a, b) => [a, b].sort().join() === 'bob,cleo');
  setPrivacy('bob', { balance: 'friends', status: 'me' });
  assert.ok(maySee('dan', 'eve', 'balance') && maySee(null, 'eve', 'balance'), 'everyone (the default), the public too');
  assert.ok(maySee('cleo', 'bob', 'balance'), 'a friend');
  assert.ok(!maySee('dan', 'bob', 'balance'), 'not a friend');
  assert.ok(!maySee(null, 'bob', 'balance'), 'the public');
  assert.ok(!maySee('cleo', 'bob', 'status'), 'only me: not even friends');
  assert.ok(maySee('bob', 'bob', 'status'), 'your own');
  assert.ok(maySee('gm', 'bob', 'status') && maySee('gm', 'bob', 'balance'), 'a Game Master');
  assert.equal(hiddenLine('dan', 'bob', 'Bob', 'balance'), "🔒 Bob's balance is only shown to their friends.");
  assert.equal(hiddenLine('cleo', 'bob', 'Bob', 'status'), '🔒 Bob keeps their status to themselves.');
  assert.equal(hiddenLine('cleo', 'bob', 'Bob', 'balance'), null);
});

test("the player menu's info: what's hidden comes as nothing, and says so", async () => {
  add('fay', 300);
  setPrivacy('fay', { balance: 'me' });
  const deps = { nameOf: async (id: string) => id, statusOf: async () => 'online' as const, gifted: () => {}, verdict: () => {} };
  const seen = await playerInfo('dan', 'fay', deps);
  assert.deepEqual([seen.wallet, seen.vault, seen.rank, seen.hidden], [0, null, null, { balance: true }]);
  const own = await playerInfo('fay', 'fay', deps);
  assert.equal(own.wallet, 300);
  assert.equal(own.hidden, undefined);
});
