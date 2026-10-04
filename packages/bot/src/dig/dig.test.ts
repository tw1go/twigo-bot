import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// digFor against a throwaway database, with made-up config (never the real .env or data/).
const dir = mkdtempSync(join(tmpdir(), 'dig-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { digFor } = await import('./dig.js');
const { BASE_SLOTS, DIGS_PER_DAY, addShovel, itemCount, recordDig, shovelUses } = await import('./store.js');
const { jail } = await import('../games/jail.js');
const { closeDatabase } = await import('../db/db.js');

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});

test('digs up an item and uses the shovel', () => {
  addShovel('digger');
  const uses = shovelUses('digger');
  const r = digFor('digger');
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.ok(r.item.id && r.item.name);
  assert.equal(r.shovel, uses - 1);
  assert.equal(r.left, DIGS_PER_DAY - 1);
  assert.equal(r.items, 1);
  assert.equal(itemCount('digger'), 1);
});

test('refuses with no shovel', () => {
  assert.deepEqual(digFor('no-shovel'), { ok: false, reason: 'no-shovel' });
});

test('refuses when the bag is full', () => {
  addShovel('full');
  for (let i = 0; i < BASE_SLOTS; i++) recordDig('full', 'rock');
  const r = digFor('full');
  assert.deepEqual(r, { ok: false, reason: 'bag-full', items: BASE_SLOTS, slots: BASE_SLOTS });
});

test('refuses when there are no digs left today', () => {
  for (let i = 0; i < 4; i++) addShovel('tired');
  for (let i = 0; i < DIGS_PER_DAY; i++) recordDig('tired', 'rock'); // fewer than the bag holds
  assert.ok(DIGS_PER_DAY < BASE_SLOTS);
  assert.deepEqual(digFor('tired'), { ok: false, reason: 'no-digs' });
});

test('refuses from jail', async () => {
  addShovel('jailed');
  await jail('jailed', 5, 'test');
  const r = digFor('jailed');
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, 'jailed');
});

test('Master Keys and potions take bag slots: a bag of keys stops digging, and keys that won\'t fit are refused', async () => {
  const { addMasterKey } = await import('./store.js');
  const { addPotions } = await import('../potions/potions.js');
  const { usedSlots, freeSlots } = await import('./bag.js');
  const { add } = await import('../credits/store.js');
  const { redeemReward } = await import('../games/redeem.js');
  const { rewards } = await import('../games/rewards.js');

  addShovel('holder');
  for (let i = 0; i < BASE_SLOTS - 2; i++) addMasterKey('holder');
  addPotions('holder', 'tago', 2);
  assert.equal(usedSlots('holder'), BASE_SLOTS);
  assert.equal(freeSlots('holder'), 0);
  assert.deepEqual(digFor('holder'), { ok: false, reason: 'bag-full', items: BASE_SLOTS, slots: BASE_SLOTS });

  add('holder', 100);
  const key = rewards.find((r) => r.id === 'master-key')!;
  const refused = redeemReward('holder', key, 1);
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.reason, 'bag-full');
});
