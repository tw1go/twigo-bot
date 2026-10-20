import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Drinking sari-sari potions (/potion use and the town's bag share `drink`) against a throwaway database, with made-up
// config (never the real .env or data/).
const dir = mkdtempSync(join(tmpdir(), 'potions-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { MARITES_HINTS, SWERTE_DIGS, TAGO_MINUTES, addPotions, drink, hintsLeft, potionCount, swerteLeft, tagoUntil } = await import('./potions.js');
const { drinkInTown, townInventory } = await import('../web/town-bag.js');
const { closeDatabase } = await import('../db/db.js');

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});

test('a Tago Tonic hides you for 30 minutes, and a second adds 30 more', () => {
  addPotions('tago', 'tago', 2);
  const before = Date.now();
  const a = drink('tago', 'tago');
  assert.equal(a.ok && a.id === 'tago', true);
  const until = a.ok && a.id === 'tago' ? a.until : 0;
  assert.ok(until >= before + TAGO_MINUTES * 60_000 && until <= Date.now() + TAGO_MINUTES * 60_000);
  const b = drink('tago', 'tago');
  assert.equal(b.ok && b.id === 'tago' && b.until, until + TAGO_MINUTES * 60_000);
  assert.equal(tagoUntil('tago'), until + TAGO_MINUTES * 60_000);
  assert.equal(potionCount('tago', 'tago'), 0);
  assert.deepEqual(drink('tago', 'tago'), { ok: false, reason: 'none' });
});

test('a Swerte Elixir adds its digs on top of any left', () => {
  addPotions('swerte', 'swerte', 2);
  drink('swerte', 'swerte');
  const r = drink('swerte', 'swerte');
  assert.equal(r.ok && r.id === 'swerte' && r.digs, SWERTE_DIGS * 2);
  assert.equal(swerteLeft('swerte'), SWERTE_DIGS * 2);
});

test('Marites Tea tells a new hint each cup, and is kept once she has nothing new', () => {
  addPotions('chismis', 'marites', MARITES_HINTS.length + 1);
  const heard = new Set<string>();
  for (let i = 0; i < MARITES_HINTS.length; i++) {
    const r = drink('chismis', 'marites');
    assert.equal(r.ok && r.id === 'marites', true);
    if (r.ok && r.id === 'marites') heard.add(r.hint);
  }
  assert.equal(heard.size, MARITES_HINTS.length);
  assert.equal(hintsLeft('chismis'), 0);
  assert.deepEqual(drink('chismis', 'marites'), { ok: false, reason: 'no-hints' });
  assert.equal(potionCount('chismis', 'marites'), 1); // not used up
});

test('the town bag: drinkable potions are marked, the Kalawang Potion is thrown elsewhere', () => {
  addPotions('bag', 'tago', 1);
  addPotions('bag', 'kalawang', 1);
  const items = townInventory('bag').items;
  assert.equal(items.find((i) => i.id === 'potion-tago')?.drink, true);
  assert.equal(items.find((i) => i.id === 'potion-kalawang')?.drink, undefined);
  assert.match(items.find((i) => i.id === 'potion-kalawang')?.about ?? '', /Bakod from its menu in the neighbourhood/);
  assert.deepEqual(townInventory('bag').effects, { tagoUntil: null, swerte: 0 });

  const thrown = drinkInTown('bag', 'potion-kalawang');
  assert.equal(thrown.ok, false);
  assert.equal(potionCount('bag', 'kalawang'), 1);
  assert.equal(drinkInTown('bag', 'rock').ok, false);

  const r = drinkInTown('bag', 'potion-tago');
  assert.equal(r.ok, true);
  assert.ok(r.effects.tagoUntil && r.effects.tagoUntil > Date.now());
  assert.equal(r.items.some((i) => i.id === 'potion-tago'), false);
  assert.equal(drinkInTown('bag', 'potion-tago').ok, false);
});

test("the town bag: Marites Tea's hint comes back as plain text for her dialog box", () => {
  addPotions('town-chismis', 'marites', MARITES_HINTS.length);
  for (let i = 0; i < MARITES_HINTS.length; i++) {
    const r = drinkInTown('town-chismis', 'potion-marites');
    assert.equal(r.ok, true);
    assert.ok(r.hint);
    assert.doesNotMatch(r.hint!, /\*|\p{Extended_Pictographic}|⃣/u);
  }
});
