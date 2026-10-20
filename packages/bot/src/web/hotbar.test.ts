import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Members' synced hotbars against a throwaway database, with made-up config (never the real .env or data/).
const dir = mkdtempSync(join(tmpdir(), 'hotbar-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { HOTBAR_ROWS, cleanHotbar, hotbarsOf, isClassId, saveHotbar } = await import('./hotbar.js');
const { closeDatabase } = await import('../db/db.js');

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});

test('a layout is kept within bounds: each row its size, every entry a skill, an item or empty, strings short', () => {
  const skill = { t: 'skill', name: 'Quick Shot' };
  const potion = { t: 'item', id: 'low-hp-potion', name: 'Low HP Potion', emoji: '🧪', rarity: 'common', cooldown: 'potion-hp' };
  const clean = cleanHotbar({ main: [skill, null, { t: 'skill' }, 'junk', { t: 'item', id: 'x' }, potion], util: [potion], top: Array(20).fill(skill), extra: 1 })!;
  assert.equal(clean.main.length, HOTBAR_ROWS.main);
  assert.deepEqual(clean.main.slice(0, 6), [skill, null, null, null, null, potion]);
  assert.deepEqual(clean.util, [potion, null, null]);
  assert.equal(clean.top.length, HOTBAR_ROWS.top);
  assert.ok(clean.top.every((e) => e?.t === 'skill'));
  assert.equal('extra' in clean, false);
  assert.equal(cleanHotbar({ main: [{ t: 'skill', name: 'x'.repeat(61) }] })!.main[0], null);
  assert.equal(cleanHotbar({ main: [{ t: 'item', id: 'p', name: 'P', emoji: 'way too long emoji', rarity: 'common' }] })!.main[0]!.t === 'item' && (cleanHotbar({ main: [{ t: 'item', id: 'p', name: 'P', emoji: 'way too long emoji', rarity: 'common' }] })!.main[0] as { emoji: string }).emoji, '');
  assert.equal(cleanHotbar(null), null);
  assert.equal(cleanHotbar('slingshot'), null);
  assert.deepEqual(cleanHotbar({}), { top: Array(13).fill(null), main: Array(10).fill(null), util: Array(3).fill(null) });
});

test('class ids as the game names them', () => {
  assert.ok(isClassId('slingshot') && isClassId('potlid') && isClassId('step-back'));
  assert.ok(!isClassId('Slingshot') && !isClassId('') && !isClassId('a'.repeat(41)) && !isClassId(3));
});

test('saved per member and class, the same back from hotbarsOf; another class or member untouched', () => {
  assert.deepEqual(hotbarsOf('ana'), {});
  const kept = saveHotbar('ana', 'slingshot', { main: [{ t: 'skill', name: 'Quick Shot' }] })!;
  assert.equal(kept.main[0]!.t, 'skill');
  saveHotbar('ana', 'broom', { util: [{ t: 'item', id: 'low-mp-potion', name: 'Low MP Potion', emoji: '🧪', rarity: 'common' }] });
  assert.deepEqual(Object.keys(hotbarsOf('ana')).sort(), ['broom', 'slingshot']);
  assert.deepEqual(hotbarsOf('ana').slingshot.main[0], { t: 'skill', name: 'Quick Shot' });
  assert.deepEqual(hotbarsOf('ben'), {});
  assert.equal(saveHotbar('ana', 'slingshot', 'nonsense'), null);
  assert.deepEqual(hotbarsOf('ana').slingshot.main[0], { t: 'skill', name: 'Quick Shot' }); // (a refused save changes nothing)
});
