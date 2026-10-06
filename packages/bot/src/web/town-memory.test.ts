import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The town's memory against a throwaway database, with made-up config (never the real .env or data/).
const dir = mkdtempSync(join(tmpdir(), 'memory-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { flushTownMemory, townMemory } = await import('./town-memory.js');
const { kvLoad, closeDatabase } = await import('../db/db.js');

test('the last chat and feed lines outlive a restart; the chat only in its own file', () => {
  const first = townMemory();
  assert.deepEqual([first.chat, first.system], [[], []]);
  first.save([{ name: 'Ana', text: 'hi' }], [{ kind: 'dig', text: 'Ana dug up a rock', tone: 'junk' }]);
  first.save([{ name: 'Ana', text: 'hi' }, { name: 'Ben', text: 'hello', discord: true }], [{ kind: 'dig', text: 'Ana dug up a rock', tone: 'junk' }]);
  flushTownMemory(); // as at shutdown
  const after = townMemory(); // the next start
  assert.deepEqual(after.chat.map((l) => l.text), ['hi', 'hello']);
  assert.equal(after.system[0].text, 'Ana dug up a rock');
  assert.ok(existsSync(join(dir, 'town-chat.json')));
  assert.ok(!readFileSync(join(dir, 'mikazuki.db')).includes(Buffer.from('hello'))); // never in the database
  assert.equal(kvLoad<unknown[]>('town-feed-recent', []).length, 1);
});

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
