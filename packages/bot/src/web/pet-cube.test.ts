import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The Pet Selection Cube (@mikazuki/shared pets.ts openPetCube, against the game's real stats.json pets.petCube and
// items.json): bound from the start (never traded, dropped or sold), opened only into one of its six common pets (never
// Fairy Cha or an unknown id), the cube spent and the pet given in one save, refused with a full bag and in a fight.
const dir = mkdtempSync(join(tmpdir(), 'pet-cube-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const shared = await import('@mikazuki/shared');
const { bagSlots, cubeOf, cubeRefusal, dropRefusal, newItem, openPetCube, parsePetAction, petAction, petRules, sellPrice, stackLimit, tradeRefusal, CUBE_IN_FIGHT } = shared;
type Item = import('@mikazuki/shared').Item;
type AdventureState = import('@mikazuki/shared').AdventureState;
type CombatItemDef = import('@mikazuki/shared').CombatItemDef;
const { loadItemData } = await import('./stats-data.js');
const { freshAdventure, combatOf, townPet, withItems } = await import('./adventure.js');
const { closeDatabase } = await import('../db/db.js');

const D = loadItemData();
const S = D.stats;
const R = petRules(S)!;
let n = 0;
const uid = () => `u${++n}`;
const COMMON = ['fork-of-jord', 'croakyangs', 'wonwuu', 'pittuki', 'tamtam', 'kislap'];
const cube = (count = 1) => newItem(S, D.defs.get('pet-cube-common') as CombatItemDef, uid(), count);
const potion = () => newItem(S, D.defs.get('low-hp-potion') as CombatItemDef, uid());
const bagWith = (...items: Item[]): AdventureState => ({ ...freshAdventure(), bag: items });
/** A bag with every slot taken: `first`, then a potion a slot (each its own level, so none stack). */
const fullBag = (first: Item): AdventureState => bagWith(first, ...Array.from({ length: bagSlots(S) - 1 }, (_, i) => ({ ...potion(), level: 2 + i })));

test('the common cube: its six common pets in the picker\'s order, never Fairy Cha; bound, stacks to 99, never traded, dropped or sold', () => {
  const c = cubeOf(D, { defId: 'pet-cube-common' })!;
  assert.deepEqual(c.choices, COMMON);
  for (const id of c.choices) assert.equal(R.list[id].rarity, 'common', id);
  assert.ok(!c.choices.includes('fairy-cha'));
  assert.equal(cubeOf(D, { defId: 'pet-box-croakyangs' }), null, 'a box is no cube');
  const it = cube();
  assert.equal(it.bound, true, 'bound as soon as it is made');
  assert.equal(stackLimit(S, D.defs.get('pet-cube-common')), 99);
  assert.equal(tradeRefusal(D, it), "Bound items can't be traded.");
  assert.equal(dropRefusal(D, it), "Bound items can't be dropped.");
  assert.equal(sellPrice(D, it), null, 'never sold');
});

test('opening: one cube of the stack goes, a bound Lv 1 pet of the choice comes (no XP, no points), as a box gives', () => {
  for (const id of COMMON) {
    const s = bagWith(cube(3));
    const r = openPetCube(D, s, s.bag[0].uid, id, uid);
    assert.ok(r.ok, id);
    assert.equal(r.message, `${D.defs.get(`pet-${id}`)!.name} joined you!`);
    assert.equal(s.bag[0].count, 2, 'one cube spent');
    const pet = s.bag[1];
    assert.equal(pet.defId, `pet-${id}`);
    assert.deepEqual([pet.bound, pet.level, pet.xp, pet.points], [true, 1, 0, {}]);
    assert.equal(tradeRefusal(D, pet), "Bound items can't be traded.");
  }
  // The last cube: the pet takes its slot.
  const s = bagWith(potion(), cube());
  assert.ok(openPetCube(D, s, s.bag[1].uid, 'kislap', uid).ok);
  assert.deepEqual(s.bag.map((b) => b.defId), ['low-hp-potion', 'pet-kislap']);
});

test('only its own choices: Fairy Cha, an unknown id and a non-cube are refused, the bag untouched', () => {
  for (const id of ['fairy-cha', 'dragon', '', 'cube-common', '__proto__']) {
    const s = bagWith(cube(2));
    const before = JSON.stringify(s.bag);
    const r = openPetCube(D, s, s.bag[0].uid, id, uid);
    assert.deepEqual(r, { ok: false, message: "That pet isn't in this cube." }, id);
    assert.equal(JSON.stringify(s.bag), before);
  }
  const s = bagWith(potion());
  assert.equal(openPetCube(D, s, s.bag[0].uid, 'croakyangs', uid).ok, false);
  assert.equal(openPetCube(D, s, 'nope', 'croakyangs', uid).ok, false);
});

test('a full bag: a stack of cubes is refused ("Your bag is full."), before the popup too; a lone cube\'s slot is the pet\'s', () => {
  const s = fullBag(cube(2));
  assert.equal(s.bag.length, bagSlots(S));
  assert.equal(cubeRefusal(D, s.bag, s.bag[0].uid), 'Your bag is full.');
  const before = JSON.stringify(s.bag);
  assert.deepEqual(openPetCube(D, s, s.bag[0].uid, 'croakyangs', uid), { ok: false, message: 'Your bag is full.' });
  assert.equal(JSON.stringify(s.bag), before, 'nothing spent');
  const lone = fullBag(cube());
  assert.equal(cubeRefusal(D, lone.bag, lone.bag[0].uid), null);
  assert.ok(openPetCube(D, lone, lone.bag[0].uid, 'tamtam', uid).ok);
  assert.equal(lone.bag[0].defId, 'pet-tamtam');
});

test('never in a fight (the pet swap\'s rule), and no swap cooldown', () => {
  const s = bagWith(cube());
  assert.deepEqual(petAction(D, s, { action: 'cube', item: s.bag[0].uid, pet: 'croakyangs' }, { now: 0, inCombat: true, newUid: uid }), { ok: false, message: CUBE_IN_FIGHT });
  assert.equal(s.bag[0].defId, 'pet-cube-common');
  const r = petAction(D, s, { action: 'cube', item: s.bag[0].uid, pet: 'croakyangs' }, { lastChange: 0, now: 1, inCombat: false, newUid: uid });
  assert.ok(r.ok);
  assert.ok(!r.changed, 'no pet out changed');
});

test('POST /town/pet: the cube\'s body; saved in one step: the cube gone and the pet there, or neither, however often it is sent', () => {
  assert.deepEqual(parsePetAction({ action: 'cube', item: 'abc', pet: 'croakyangs' }), { action: 'cube', item: 'abc', pet: 'croakyangs' });
  assert.equal(parsePetAction({ action: 'cube', item: 'abc' }), null);
  assert.equal(parsePetAction({ action: 'cube', pet: 'croakyangs' }), null);
  assert.equal(parsePetAction({ action: 'cube', item: 'abc', pet: 7 }), null);

  const who = 'cube-member';
  const c = cube();
  withItems(who, (s) => s.bag.push(c));
  const forged = townPet(who, { action: 'cube', item: c.uid, pet: 'fairy-cha' }, false);
  assert.equal(forged.ok, false);
  assert.deepEqual(combatOf(who).bag.map((b) => b.defId), ['pet-cube-common'], 'a forged Fairy Cha: the cube stays');
  assert.equal(townPet(who, { action: 'cube', item: c.uid, pet: 'wonwuu' }, true).ok, false, 'in a fight');
  const r = townPet(who, { action: 'cube', item: c.uid, pet: 'wonwuu' }, false);
  assert.ok(r.ok);
  // Sent again (a double-click): the cube is gone, so nothing more comes.
  assert.equal(townPet(who, { action: 'cube', item: c.uid, pet: 'wonwuu' }, false).ok, false);
  const saved = combatOf(who).bag;
  assert.deepEqual(saved.map((b) => [b.defId, b.bound, b.level]), [['pet-wonwuu', true, 1]]);
});

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
