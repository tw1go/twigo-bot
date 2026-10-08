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

const { CLASSES, EQUIPMENT, QUESTS, adventureOf, equipStep, fighterOf, freshAdventure, gainXpFor, giveTrainingArmor, killFor, kitOf, levelFor, parseEquipAction, parsePointsAction, parseQuestAction, placesFor, questStep, resetAdventure, startQuests, townEquip, townPoints, townQuest, trainingArmorFor } =
  await import('./adventure.js');
const { usedSlots } = await import('../dig/bag.js');
const { sellInTown, sellManyInTown } = await import('./town-bag.js');
const { closeDatabase, db } = await import('../db/db.js');
const { loadStats } = await import('./stats-data.js');
const { baseStats, mobStats, skillPointsAt, xpForLevel, xpToNext } = await import('@mikazuki/shared');
const S = loadStats();

const Q = 'main-01-class';

/** A class's training armor, head to feet (items/equipment.json). */
const armorOf = (gear: string) => ['head', 'body', 'hands', 'bottoms', 'feet'].map((slot) => `armor-training-${gear}-${slot}`);

test('the data files: six classes, a training weapon for each, the first main quest', () => {
  assert.equal(CLASSES.length, 6);
  for (const c of CLASSES) assert.ok([...EQUIPMENT.values()].some((i) => i.training && i.slot === 'weapon' && i.class === c.id), `${c.id} has a training weapon`);
  // Training gear: Lv 1, brown, bound, no agimats; five armor pieces per gear type.
  for (const i of EQUIPMENT.values()) if (i.training) assert.deepEqual([i.level, i.rarity, i.bound, i.agimats], [1, 'brown', true, []], i.id);
  for (const g of ['heavy', 'light', 'household']) for (const id of armorOf(g)) assert.ok(EQUIPMENT.get(id)?.training, id);
  const q = QUESTS.find((x) => x.id === Q)!;
  assert.equal(q.type, 'main');
  assert.deepEqual(q.objectives.map((o) => o.type), ['talk', 'chooseClass']);
});

test('the class choice: armor into its place, else the bag; what has no room comes on a later visit', () => {
  const s = freshAdventure();
  startQuests(s);
  questStep(s, { quest: Q, action: 'talk', npc: 'tanod' }, 0);
  s.equipped.head = 'armor-training-light-head'; // something already on their head
  s.equipped.weapon = 'weapon-training-plank';
  const r = questStep(s, { quest: Q, action: 'chooseClass', cls: 'potlid' }, 1); // one free slot: the old weapon takes it
  assert.equal(r.given, 'weapon-training-potlid');
  assert.deepEqual(s.bag, ['weapon-training-plank']);
  assert.deepEqual(r.gear, armorOf('household').slice(1)); // no room for the headwrap
  assert.equal(s.trainingArmorGiven, false);
  assert.deepEqual(giveTrainingArmor(s, 0), []); // still no room
  assert.deepEqual(giveTrainingArmor(s, 2), ['armor-training-household-head']); // into the bag (the head is taken)
  assert.deepEqual(s.bag, ['weapon-training-plank', 'armor-training-household-head']);
  assert.equal(s.trainingArmorGiven, true);
  assert.deepEqual(giveTrainingArmor(s, 2), []); // once
});

test('the class quest: starts once, talk then choose, gives the weapon into the weapon slot', () => {
  const s = freshAdventure();
  assert.deepEqual(startQuests(s).map((q) => q.id), [Q]);
  assert.equal(startQuests(s).length, 0); // only once
  // Out of order or the wrong NPC: refused.
  assert.equal(questStep(s, { quest: Q, action: 'chooseClass', cls: 'stick' }, 5).ok, false);
  assert.equal(questStep(s, { quest: Q, action: 'talk', npc: 'marites' }, 5).ok, false);
  assert.deepEqual(questStep(s, { quest: Q, action: 'talk', npc: 'tanod' }, 5), { ok: true, completed: undefined });
  assert.equal(questStep(s, { quest: Q, action: 'talk', npc: 'tanod' }, 5).ok, false); // already past it
  assert.equal(questStep(s, { quest: Q, action: 'chooseClass', cls: 'wizard' }, 5).ok, false); // no such class
  const r = questStep(s, { quest: Q, action: 'chooseClass', cls: 'stick' }, 5);
  assert.deepEqual(r, { ok: true, given: 'weapon-training-stick', gear: armorOf('heavy'), completed: Q });
  assert.equal(s.cls, 'stick');
  // The weapon and the Heavy armor, all worn; given once.
  assert.deepEqual(s.equipped, { weapon: 'weapon-training-stick', ...Object.fromEntries(armorOf('heavy').map((id) => [EQUIPMENT.get(id)!.slot, id])) });
  assert.equal(s.trainingArmorGiven, true);
  assert.deepEqual(s.bag, []);
  assert.deepEqual(s.quests, { active: [], done: [Q] });
  assert.equal(startQuests(s).length, 0); // done: never again
  // Someone who already has a class never gets the class quest.
  const old = { ...freshAdventure(), cls: 'broom' };
  assert.equal(startQuests(old).length, 0);
});

test('equipment: only what your base stats meet, the old one back to the bag, taking off needs a free slot', () => {
  const s = { ...freshAdventure(), cls: 'stick', equipped: { weapon: 'weapon-training-stick' as string | undefined }, bag: ['weapon-training-broom', 'weapon-training-stick'] };
  assert.deepEqual(equipStep(s, { action: 'equip', item: 'weapon-training-broom' }, 5), { ok: false, message: 'Needs INT 8' });
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
  assert.equal(townQuest('m1', { quest: Q, action: 'talk', npc: 'tanod' }, 40).changed, false);
  const done = townQuest('m1', { quest: Q, action: 'chooseClass', cls: 'hilot' }, usedSlots('m1') + 40);
  assert.equal(done.changed, true);
  assert.equal(done.given, 'weapon-training-balm');
  assert.deepEqual(kitOf('m1'), { cls: 'hilot', weapon: 'weapon-training-balm', level: 1 });
  assert.equal(usedSlots('m1'), 0); // worn: no bag slot
  assert.equal(townEquip('m1', { action: 'unequip', place: 'weapon' }, 3).changed, true);
  assert.equal(usedSlots('m1'), 1);
  assert.deepEqual(kitOf('m1'), { cls: 'hilot', weapon: null, level: 1 });
  assert.equal(adventureOf('m1').quests.done[0], Q); // kept
  // The CMS can start it all over: no class, the class quest again, nothing carried.
  resetAdventure('m1');
  assert.deepEqual(kitOf('m1'), { cls: null, weapon: null, level: 1 });
  assert.deepEqual(adventureOf('m1').quests, { active: [{ id: Q, step: 0 }], done: [] });
  assert.equal(usedSlots('m1'), 0);
});

test('a row saved before levels (schema v10) reads as Lv 1, 0 XP, nothing earned or spent', () => {
  db.prepare('INSERT INTO adventurers (user_id, class, quests, equipped, bag, updated) VALUES (?, ?, ?, ?, ?, ?)').run(
    'old', 'stick', JSON.stringify({ active: [], done: [Q] }), JSON.stringify({ weapon: 'weapon-training-stick' }), '[]', Date.now(),
  );
  const s = adventureOf('old');
  assert.equal(s.cls, 'stick');
  assert.deepEqual(s.progress, { level: 1, xp: 0, next: xpToNext(S, 1), points: {}, statPoints: 0, skills: {}, skillPoints: 0 });
  assert.equal(s.trainingArmorGiven, false);
  assert.deepEqual(freshAdventure().progress, s.progress, 'the same as a new character');
});

test('levels are saved: XP and kills level them up (points earned), the fight sees them, a class reset keeps the level', () => {
  townQuest('lv', { quest: Q, action: 'talk', npc: 'tanod' }, 40);
  townQuest('lv', { quest: Q, action: 'chooseClass', cls: 'slingshot' }, 40);
  const can = mobStats(S, 'tin-can')!;
  const kill = killFor('lv', can);
  assert.deepEqual([kill.gained, kill.ups, kill.progress.level], [can.xp, 0, 1]);
  const up = gainXpFor('lv', xpForLevel(S, 4) - can.xp);
  assert.deepEqual([up.ups, up.progress.level, up.progress.xp], [3, 4, 0]);
  const saved = adventureOf('lv').progress;
  assert.deepEqual([saved.level, saved.xp, saved.statPoints, saved.skillPoints], [4, 0, 3 * S.growth.pointsPerLevelUp, skillPointsAt(S, 4)]);
  assert.equal(kitOf('lv').level, 4);
  // What the town passes into a fight: class, level, points, everything worn, the skills' levels (Lv 1 each so far).
  assert.deepEqual(fighterOf('lv'), { cls: 'slingshot', level: 4, points: {}, gear: ['weapon-training-slingshot', ...armorOf('light')], skills: Array(CLASSES.find((c) => c.id === 'slingshot')!.skills.length).fill(1) });
  // Far below them, a Tin Can gives less (the low-mob penalty).
  gainXpFor('lv', xpForLevel(S, 12) - xpForLevel(S, 4));
  assert.ok(killFor('lv', can).gained < can.xp);
  // Starting the class over keeps the level and XP; the points come back (none spent, all the skill points).
  const before = adventureOf('lv').progress;
  resetAdventure('lv');
  const after = adventureOf('lv').progress;
  assert.deepEqual([after.level, after.xp, after.skillPoints, after.points], [before.level, before.xp, skillPointsAt(S, before.level), {}]);
  assert.equal(adventureOf('lv').cls, null);
});

test('stat points: banked before a class, then only into its main or second stat; Reset gives them all back', () => {
  // No class: points bank.
  levelFor('sp', 4);
  assert.equal(adventureOf('sp').progress.statPoints, 3 * S.growth.pointsPerLevelUp);
  assert.deepEqual(townPoints('sp', { action: 'spend', stat: 'DEX' }), { ok: false, message: 'Choose a class to spend points.', adventure: adventureOf('sp') });
  // A Slingshot (DEX, INT; STR third): its growth at Lv 4 at once, and the banked points to spend.
  townQuest('sp', { quest: Q, action: 'talk', npc: 'tanod' }, 40);
  townQuest('sp', { quest: Q, action: 'chooseClass', cls: 'slingshot' }, 40);
  const g = S.growth;
  assert.deepEqual(baseStats(S, 'slingshot', 4), { DEX: g.main.base + g.main.perLevel * 4, INT: g.second.base + g.second.perLevel * 4, STR: g.third.base + g.third.perLevel * 4 });
  assert.equal(townPoints('sp', { action: 'spend', stat: 'STR' }).message, "Your class doesn't put points into STR.");
  assert.ok(townPoints('sp', { action: 'spend', stat: 'DEX' }).ok);
  assert.ok(townPoints('sp', { action: 'spend', stat: 'INT' }).ok);
  const r = townPoints('sp', { action: 'spend', stat: 'DEX' });
  assert.deepEqual([r.ok, r.adventure.progress.points, r.adventure.progress.statPoints], [true, { DEX: 2, INT: 1 }, 0]);
  assert.equal(townPoints('sp', { action: 'spend', stat: 'DEX' }).message, 'No stat points to spend.');
  assert.deepEqual(fighterOf('sp').points, { DEX: 2, INT: 1 }); // the fight sees them
  // Reset: free, all of them back; the level and skill points stay.
  const reset = townPoints('sp', { action: 'reset' });
  assert.deepEqual([reset.ok, reset.adventure.progress.points, reset.adventure.progress.statPoints, reset.adventure.progress.level], [true, {}, 3, 4]);
  assert.equal(townPoints('sp', { action: 'reset' }).ok, false); // nothing spent
  assert.deepEqual(parsePointsAction({ action: 'spend', stat: 'LUK' }), null);
  assert.deepEqual(parsePointsAction({ action: 'spend', stat: 'INT' }), { action: 'spend', stat: 'INT' });
  assert.deepEqual(parsePointsAction({ action: 'reset' }), { action: 'reset' });
});

test('wearing checks base stats on the server: another class\'s weapon and armor refused with the line, gear STR never counts', () => {
  townQuest('sl', { quest: Q, action: 'talk', npc: 'tanod' }, 40);
  townQuest('sl', { quest: Q, action: 'chooseClass', cls: 'slingshot' }, 40);
  // Into the bag to try them (a Slingshot: DEX 10, INT 6, STR 4 at Lv 1).
  const plank = EQUIPMENT.get('weapon-training-plank')!; // a Greatstick's: STR its main
  const need = S.requirements.weapon.main.perItemLevel * plank.level + S.requirements.weapon.main.plus;
  db.prepare('UPDATE adventurers SET bag = ? WHERE user_id = ?').run(JSON.stringify(['weapon-training-plank', 'armor-training-heavy-head', 'test-necklace']), 'sl');
  EQUIPMENT.set('test-necklace', { id: 'test-necklace', name: 'Test Necklace', slot: 'necklace', level: 1, rarity: 'lightBlue', bound: false, agimats: [], stats: { str: 50 } });
  assert.deepEqual(townEquip('sl', { action: 'equip', item: 'weapon-training-plank' }, 5).message, `Needs STR ${need}`);
  assert.deepEqual(townEquip('sl', { action: 'equip', item: 'armor-training-heavy-head' }, 5).message, `Needs STR ${S.requirements.armor.bothGearTypeStats.perItemLevel + S.requirements.armor.bothGearTypeStats.plus}`);
  // +50 STR from a necklace changes nothing.
  assert.ok(townEquip('sl', { action: 'equip', item: 'test-necklace' }, 5).ok);
  assert.equal(townEquip('sl', { action: 'equip', item: 'weapon-training-plank' }, 5).ok, false);
  assert.equal(townEquip('sl', { action: 'equip', item: 'armor-training-heavy-head' }, 5).ok, false);
  // Its own: fine (off, then on again).
  assert.ok(townEquip('sl', { action: 'unequip', place: 'weapon' }, 5).ok);
  assert.ok(townEquip('sl', { action: 'equip', item: 'weapon-training-slingshot' }, 5).ok);
  EQUIPMENT.delete('test-necklace');
});

test('a class from before training armor gets the set once, on a visit; the rest on a later one if the bag was full', () => {
  const row = (id: string, equipped: object) => db.prepare('INSERT INTO adventurers (user_id, class, quests, equipped, bag, updated) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, 'broom', JSON.stringify({ active: [], done: [Q] }), JSON.stringify(equipped), '[]', Date.now(),
  );
  row('vet', { weapon: 'weapon-training-broom' });
  assert.deepEqual(trainingArmorFor('vet', 10), armorOf('light'));
  assert.deepEqual(trainingArmorFor('vet', 10), []); // once
  assert.equal(adventureOf('vet').trainingArmorGiven, true);
  assert.deepEqual(adventureOf('vet').bag, []); // all worn
  // Their feet taken and no room in the bag: the boots wait for a later visit.
  row('vet2', { weapon: 'weapon-training-broom', feet: 'armor-training-heavy-feet' });
  assert.deepEqual(trainingArmorFor('vet2', 0), armorOf('light').slice(0, 4));
  assert.equal(adventureOf('vet2').trainingArmorGiven, false);
  assert.deepEqual(trainingArmorFor('vet2', 1), ['armor-training-light-feet']);
  assert.deepEqual(adventureOf('vet2').bag, ['armor-training-light-feet']);
  assert.deepEqual(trainingArmorFor('vet2', 1), []);
  // No class: nothing.
  assert.deepEqual(trainingArmorFor('nobody', 10), []);
});

test("training gear can't be sold", () => {
  townQuest('ts', { quest: Q, action: 'talk', npc: 'tanod' }, 40);
  townQuest('ts', { quest: Q, action: 'chooseClass', cls: 'stick' }, 40);
  townEquip('ts', { action: 'unequip', place: 'weapon' }, 5);
  assert.deepEqual([sellInTown('ts', 'weapon-training-stick', 1).ok, sellInTown('ts', 'weapon-training-stick', 1).message], [false, "Training gear can't be sold."]);
  assert.equal(sellManyInTown('ts', [{ id: 'weapon-training-stick', quantity: 1 }]).ok, false);
  assert.deepEqual(adventureOf('ts').bag, ['weapon-training-stick']);
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
