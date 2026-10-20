import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Members' synced keybinds against a throwaway database, with made-up config (never the real .env or data/).
const dir = mkdtempSync(join(tmpdir(), 'keybinds-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { cleanKeybinds, keybindsOf, saveKeybinds } = await import('./keybinds.js');
const { closeDatabase } = await import('../db/db.js');

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});

test('a keybind map is kept within bounds: action ids and key names as the game writes them, two keys each', () => {
  const clean = cleanKeybinds({ interact: ['KeyE', 'Space'], pickup: ['Ctrl+KeyF', null, 'KeyG'], 'bad id!': ['KeyA'], map: 'KeyM', top1: ['Alt+Digit1', 'no spaces here'] })!;
  assert.deepEqual(clean, { interact: ['KeyE', 'Space'], pickup: ['Ctrl+KeyF', null], top1: ['Alt+Digit1', null] });
  assert.deepEqual(cleanKeybinds({}), {});
  assert.equal(cleanKeybinds(null), null);
  assert.equal(cleanKeybinds(['KeyE']), null);
  assert.equal(cleanKeybinds('KeyE'), null);
  const many = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`a${i}`, ['KeyA']]));
  assert.equal(Object.keys(cleanKeybinds(many)!).length, 100);
});

test('saved per member; an empty map (a reset) is kept as empty; a refused save changes nothing', () => {
  assert.deepEqual(keybindsOf('ana'), {});
  saveKeybinds('ana', { interact: ['KeyF', null] });
  assert.deepEqual(keybindsOf('ana'), { interact: ['KeyF', null] });
  assert.deepEqual(keybindsOf('ben'), {});
  assert.equal(saveKeybinds('ana', 'nonsense'), null);
  assert.deepEqual(keybindsOf('ana'), { interact: ['KeyF', null] });
  saveKeybinds('ana', {});
  assert.deepEqual(keybindsOf('ana'), {});
});
