import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// /gift item's catalog against a throwaway database, with made-up config (never the real .env or data/).
const dir = mkdtempSync(join(tmpdir(), 'gift-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { GIFTABLE, giftableById } = await import('./gift.js');
const { megaphones } = await import('./megaphone.js');
const { inventory, masterKeys, shovelUses, shovelsBoughtToday, SHOVEL_USES } = await import('../dig/store.js');
const { potionCount } = await import('../potions/potions.js');
const { usedSlots } = await import('../dig/bag.js');
const { closeDatabase } = await import('../db/db.js');
const { combatOf } = await import('../web/adventure.js');

test('gifts go straight in: shop items first, then dug-up items', () => {
  assert.deepEqual(GIFTABLE.slice(0, 3).map((g) => g.id), ['shovel', 'master-key', 'megaphone']);
  giftableById.get('megaphone')!.give('u', 3);
  giftableById.get('master-key')!.give('u', 2);
  giftableById.get('potion-tago')!.give('u', 1);
  giftableById.get('shovel')!.give('u', 2);
  giftableById.get('rock')!.give('u', 4);
  assert.equal(megaphones('u'), 3);
  assert.equal(masterKeys('u'), 2);
  assert.equal(potionCount('u', 'tago'), 1);
  assert.equal(shovelUses('u'), 2 * SHOVEL_USES);
  assert.equal(shovelsBoughtToday('u'), 0); // not counted as bought
  assert.deepEqual(inventory('u'), [['rock', 4]]);
  assert.equal(usedSlots('u'), 4 + 2 + 1 + 1); // rocks, keys, the potion, one slot for the megaphones
});

test('Warren Tickets go into the combat bag, stacked (/gift item warren-ticket, for everyone)', () => {
  const ticket = giftableById.get('warren-ticket');
  assert.ok(ticket?.combat, 'giftable, into the combat bag');
  assert.equal(ticket.give('w', 5), true);
  assert.equal(ticket.give('w', 5), true);
  const held = combatOf('w').bag.filter((i) => i?.defId === 'warren-ticket');
  assert.deepEqual(held.map((i) => i!.count), [10], 'one stack');
});

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
