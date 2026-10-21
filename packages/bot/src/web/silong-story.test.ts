import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 🧊 Ang Silong's story bits against a throwaway database: Mang Ramon's box on B2 gives his note once (not while you hold
// it, never after Kuya Jun has it), Kuya Jun's Mid Repair Kit for it, and clearing the Silong putting Aling Conching's
// Atchara refill at half price.
const dir = mkdtempSync(join(tmpdir(), 'silong-story-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { PALENGKE, adventureOf, kindCountOf, ramonBoxFor, ramonGiveFor, silongClearedFor } = await import('./adventure.js');
const { closeDatabase } = await import('../db/db.js');
const { RAMON, SILONG_FLAGS, dishPrice } = await import('@mikazuki/shared');

test("Mang Ramon's box: his note once (not while you hold it); Kuya Jun takes it for a Mid Repair Kit, and the box is empty after", () => {
  assert.equal(ramonGiveFor('m1'), "You don't have Mang Ramon's note.");
  assert.equal(ramonBoxFor('m1'), 'given');
  assert.equal(kindCountOf('m1', RAMON.note), 1);
  assert.equal(ramonBoxFor('m1'), 'have', 'one at a time');
  assert.equal(ramonGiveFor('m1'), null);
  assert.equal(kindCountOf('m1', RAMON.note), 0);
  assert.equal(kindCountOf('m1', RAMON.reward), 1, 'a Mid Repair Kit');
  assert.equal(ramonBoxFor('m1'), 'done', 'never again');
  assert.equal(ramonGiveFor('m1'), 'He already has it.');
});

test("a clear: Aling Conching's Atchara refill at half price after", () => {
  const before = adventureOf('m2');
  const full = PALENGKE.dishes!.atchara.kusing;
  assert.equal(dishPrice(before, PALENGKE, 'atchara'), full);
  silongClearedFor('m2');
  silongClearedFor('m2');
  const after = adventureOf('m2');
  assert.deepEqual(after.quests.flags, [SILONG_FLAGS.cleared], 'once');
  assert.equal(dishPrice(after, PALENGKE, 'atchara'), Math.round(full / 2));
  assert.equal(dishPrice(after, PALENGKE, 'lugaw'), PALENGKE.dishes!.lugaw.kusing, 'the Atchara only');
});

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
