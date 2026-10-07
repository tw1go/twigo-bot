import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Classes, quests and equipment against the game's real data files and a throwaway database (never the real .env or
// data/).
const dir = mkdtempSync(join(tmpdir(), 'adventure-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { CLASSES, EQUIPMENT, QUESTS, adventureOf, equipStep, freshAdventure, kitOf, parseEquipAction, parseQuestAction, placesFor, questStep, resetAdventure, startQuests, townEquip, townQuest } =
  await import('./adventure.js');
const { usedSlots } = await import('../dig/bag.js');
const { closeDatabase } = await import('../db/db.js');

const Q = 'main-01-class';

test('the data files: six classes, a training weapon for each, the first main quest', () => {
  assert.equal(CLASSES.length, 6);
  for (const c of CLASSES) assert.ok([...EQUIPMENT.values()].some((i) => i.starter && i.slot === 'weapon' && i.class === c.id), `${c.id} has a training weapon`);
  const q = QUESTS.find((x) => x.id === Q)!;
  assert.equal(q.type, 'main');
  assert.deepEqual(q.objectives.map((o) => o.type), ['talk', 'chooseClass']);
});

test('the class quest: starts once, talk then choose, gives the weapon into the weapon slot', () => {
  const s = freshAdventure();
  assert.deepEqual(startQuests(s).map((q) => q.id), [Q]);
  assert.equal(startQuests(s).length, 0); // only once
  // Out of order or the wrong NPC: refused.
  assert.equal(questStep(s, { quest: Q, action: 'chooseClass', cls: 'stick' }).ok, false);
  assert.equal(questStep(s, { quest: Q, action: 'talk', npc: 'marites' }).ok, false);
  assert.deepEqual(questStep(s, { quest: Q, action: 'talk', npc: 'tanod' }), { ok: true, completed: undefined });
  assert.equal(questStep(s, { quest: Q, action: 'talk', npc: 'tanod' }).ok, false); // already past it
  assert.equal(questStep(s, { quest: Q, action: 'chooseClass', cls: 'wizard' }).ok, false); // no such class
  const r = questStep(s, { quest: Q, action: 'chooseClass', cls: 'stick' });
  assert.deepEqual(r, { ok: true, given: 'weapon-training-stick', completed: Q });
  assert.equal(s.cls, 'stick');
  assert.equal(s.equipped.weapon, 'weapon-training-stick');
  assert.deepEqual(s.quests, { active: [], done: [Q] });
  assert.equal(startQuests(s).length, 0); // done: never again
  // Someone who already has a class never gets the class quest.
  const old = { ...freshAdventure(), cls: 'broom' };
  assert.equal(startQuests(old).length, 0);
});

test('equipment: only your class, the old one back to the bag, taking off needs a free slot', () => {
  const s = { ...freshAdventure(), cls: 'stick', equipped: { weapon: 'weapon-training-stick' as string | undefined }, bag: ['weapon-training-broom', 'weapon-training-stick'] };
  assert.deepEqual(equipStep(s, { action: 'equip', item: 'weapon-training-broom' }, 5), { ok: false, message: "Your class can't use this." });
  assert.equal(equipStep(s, { action: 'equip', item: 'weapon-training-plank' }, 5).ok, false); // not in the bag
  assert.equal(equipStep(s, { action: 'equip', item: 'weapon-training-stick', place: 'ring1' }, 5).message, 'Wrong slot.');
  assert.equal(equipStep(s, { action: 'equip', item: 'weapon-training-stick' }, 5).ok, true); // a second stick: swaps
  assert.deepEqual(s.bag.sort(), ['weapon-training-broom', 'weapon-training-stick']);
  assert.equal(equipStep(s, { action: 'unequip', place: 'weapon' }, 0).message, 'Your bag is full.');
  assert.equal(equipStep(s, { action: 'unequip', place: 'weapon' }, 1).ok, true);
  assert.equal(s.equipped.weapon, undefined);
  assert.equal(equipStep(s, { action: 'unequip', place: 'weapon' }, 1).ok, false); // nothing there
});

test('saved per member: /me starts the quest, the routes save, the bag counts unworn equipment', () => {
  assert.deepEqual(adventureOf('m1').quests.active, [{ id: Q, step: 0 }]);
  assert.equal(townQuest('m1', { quest: Q, action: 'talk', npc: 'tanod' }).changed, false);
  const done = townQuest('m1', { quest: Q, action: 'chooseClass', cls: 'hilot' });
  assert.equal(done.changed, true);
  assert.equal(done.given, 'weapon-training-balm');
  assert.deepEqual(kitOf('m1'), { cls: 'hilot', weapon: 'weapon-training-balm' });
  assert.equal(usedSlots('m1'), 0); // worn: no bag slot
  assert.equal(townEquip('m1', { action: 'unequip', place: 'weapon' }, 3).changed, true);
  assert.equal(usedSlots('m1'), 1);
  assert.deepEqual(kitOf('m1'), { cls: 'hilot', weapon: null });
  assert.equal(adventureOf('m1').quests.done[0], Q); // kept
  // The CMS can start it all over: no class, the class quest again, nothing carried.
  resetAdventure('m1');
  assert.deepEqual(kitOf('m1'), { cls: null, weapon: null });
  assert.deepEqual(adventureOf('m1').quests, { active: [{ id: Q, step: 0 }], done: [] });
  assert.equal(usedSlots('m1'), 0);
});

test('two places for bracers and two for rings', () => {
  assert.deepEqual(placesFor('ring'), ['ring1', 'ring2']);
  assert.deepEqual(placesFor('bracers'), ['bracers1', 'bracers2']);
  assert.deepEqual(placesFor('weapon'), ['weapon']);
});

test('request bodies are checked', () => {
  assert.equal(parseQuestAction({ quest: Q, action: 'talk' }), null);
  assert.deepEqual(parseQuestAction({ quest: Q, action: 'chooseClass', cls: 'stick' }), { quest: Q, action: 'chooseClass', cls: 'stick' });
  assert.equal(parseEquipAction({ action: 'unequip', place: 'cape' }), null);
  assert.equal(parseEquipAction({ action: 'unequip', place: 'ring' }), null); // a kind, not a place
  assert.deepEqual(parseEquipAction({ action: 'unequip', place: 'ring2' }), { action: 'unequip', place: 'ring2' });
  assert.deepEqual(parseEquipAction({ action: 'equip', item: 'x' }), { action: 'equip', item: 'x' });
});

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
