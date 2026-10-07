import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Rename Cards against a throwaway database (never the real .env or data/).
const dir = mkdtempSync(join(tmpdir(), 'rename-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { addRenameCards, renameCards, renameWithCard } = await import('./rename-card.js');
const { getNickname, setNickname } = await import('../web/nickname.js');
const { usedSlots } = await import('../dig/bag.js');
const { closeDatabase } = await import('../db/db.js');

test('a Rename Card changes the nickname, and is only used when it works', () => {
  setNickname('a', 'Moon');
  setNickname('b', 'Sunny Day');
  assert.equal(renameWithCard('a', 'Star').ok, false); // no card
  addRenameCards('a', 2);
  assert.equal(usedSlots('a'), 1); // both cards share one slot
  assert.deepEqual(renameWithCard('a', 'x'), { ok: false, error: '3-16 letters or numbers; spaces, _ - . only in between.', cards: 2 });
  assert.equal(renameWithCard('a', 'sunny_day').ok, false); // taken (folded)
  assert.equal(renameWithCard('a', 'Moon').ok, false); // already theirs
  assert.equal(renameCards('a'), 2);
  assert.deepEqual(renameWithCard('a', '  Star  Gazer '), { ok: true, nickname: 'Star Gazer', cards: 1 });
  assert.equal(getNickname('a'), 'Star Gazer');
  assert.deepEqual(renameWithCard('a', 'MOON'), { ok: true, nickname: 'MOON', cards: 0 }); // the old name is free again
  assert.equal(usedSlots('a'), 0);
});

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
