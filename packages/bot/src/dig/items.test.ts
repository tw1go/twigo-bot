import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The CMS's dig item changes against a throwaway database, with made-up config (never the real .env or data/).
const dir = mkdtempSync(join(tmpdir(), 'items-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { ITEMS, ITEM_BY_ID, itemChances, rollOfRarity, setDigItem } = await import('./items.js');
const { giftableById } = await import('../items/gift.js');
const { closeDatabase } = await import('../db/db.js');

const rollMany = (rarity: Parameters<typeof rollOfRarity>[0]) => new Set(Array.from({ length: 2000 }, (_, i) => rollOfRarity(rarity, () => (i + 0.5) / 2000).id));

test('edits apply at once; out of the ground stops drops but keeps the item; the chances still add up to 1', () => {
  const rock = ITEM_BY_ID.get('rock')!;
  assert.equal(setDigItem('rock', { ...rock, name: 'Big Rock', value: 2 }), 'ok');
  assert.equal(ITEM_BY_ID.get('rock')!.name, 'Big Rock');
  assert.ok(rollMany('junk').has('rock'));
  setDigItem('rock', { ...ITEM_BY_ID.get('rock')!, off: true });
  assert.ok(!rollMany('junk').has('rock'));
  assert.ok(ITEM_BY_ID.has('rock')); // still in bags, still sells
  const total = [...itemChances().values()].reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `chances add to ${total}`);
});

test('new items join the ground and /gift item; the last item of a rarity stays in', () => {
  assert.equal(setDigItem('golden-tabo', { name: 'Golden Tabo', emoji: '🪣', value: 9, rarity: 'legendary' }), 'ok');
  assert.ok(ITEMS.some((i) => i.id === 'golden-tabo' && i.custom));
  assert.ok(rollMany('legendary').has('golden-tabo'));
  assert.ok(giftableById.has('golden-tabo'));
  // Legendary now has twigo's treasure and the tabo: one can go, the other can't.
  const treasure = ITEM_BY_ID.get('twigo-treasure')!;
  assert.equal(setDigItem('twigo-treasure', { ...treasure, off: true }), 'ok');
  const tabo = ITEM_BY_ID.get('golden-tabo')!;
  assert.equal(setDigItem('golden-tabo', { ...tabo, off: true }), 'last-of-rarity');
  assert.equal(setDigItem('golden-tabo', { ...tabo, rarity: 'epic' }), 'last-of-rarity');
});

test("the Mine's tier list: rarest first, no secrets, nothing out of the ground, the tiers' odds adding up", async () => {
  const { townDigItems } = await import('../web/town-mine.js');
  const { SECRET_CHANCE } = await import('./items.js');
  const list = townDigItems();
  assert.equal(list.tiers[0].rarity, 'legendary'); // the rarest listed first
  assert.equal(list.tiers.at(-1)!.rarity, 'junk');
  const ids = list.tiers.flatMap((t) => t.items.map((i) => i.id));
  assert.ok(!ids.includes('twigo-tsinelas')); // 🤫
  assert.ok(!ids.includes('rock')); // taken out of the ground above
  const total = list.tiers.reduce((n, t) => n + t.chance, 0);
  assert.ok(Math.abs(total - (1 - SECRET_CHANCE)) < 1e-9, `tiers add to ${total}`);
});

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
