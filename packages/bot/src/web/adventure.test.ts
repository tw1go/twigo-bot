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

const { CLASSES, EQUIPMENT, QUESTS, adventureOf, equipStep, fighterOf, freshAdventure, gainXpFor, giveTrainingArmor, killFor, kitOf, levelFor, parseEquipAction, parsePointsAction, parseQuestAction, parseSkillsAction, placesFor, questStep, resetAdventure, startQuests, townEquip, townPoints, townQuest, townSkills, moveLevel, trainingArmorFor, questRewardsFor } =
  await import('./adventure.js');
const { usedSlots } = await import('../dig/bag.js');
const { sellInTown, sellManyInTown } = await import('./town-bag.js');
const { closeDatabase, db } = await import('../db/db.js');
const { loadItemData, loadStats } = await import('./stats-data.js');
const { baseStats, mobStats, newItem, skillPointsAt, xpForLevel, xpToNext, giveQuestRewards } = await import('@mikazuki/shared');
const S = loadStats();
type Item = import('@mikazuki/shared').Item;

/** Items' kinds (what tests compare), and what's worn by place. */
const kinds = (items: Item[]) => items.map((i) => i.defId);
const worn = (s: { equipped: Partial<Record<string, Item>> }) => Object.fromEntries(Object.entries(s.equipped).map(([p, i]) => [p, i!.defId]));
let n = 0;
/** A plain item of a kind. */
const item = (id: string) => newItem(S, EQUIPMENT.get(id)!, `t${++n}`);
/** A combat bag with only `free` slots left (filled with plain whetstones… no: training sticks, which don't stack). */
const fullBag = (free: number) => Array.from({ length: 40 - free }, () => item('weapon-training-stick'));

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
  questStep(s, { quest: Q, action: 'talk', npc: 'tanod' });
  s.equipped.head = item('armor-training-light-head'); // something already on their head
  s.equipped.weapon = item('weapon-training-plank');
  s.bag = fullBag(1); // one free slot: the old weapon takes it
  const r = questStep(s, { quest: Q, action: 'chooseClass', cls: 'potlid' });
  assert.equal(r.given, 'weapon-training-potlid');
  assert.deepEqual(s.bag.at(-1)!.defId, 'weapon-training-plank');
  assert.deepEqual(r.gear, armorOf('household').slice(1)); // no room for the headwrap
  assert.equal(s.trainingArmorGiven, false);
  assert.deepEqual(giveTrainingArmor(s), []); // still no room
  s.bag.splice(0, 2);
  assert.deepEqual(giveTrainingArmor(s), ['armor-training-household-head']); // into the bag (the head is taken)
  assert.deepEqual(kinds(s.bag).slice(-2), ['weapon-training-plank', 'armor-training-household-head']);
  assert.equal(s.trainingArmorGiven, true);
  assert.deepEqual(giveTrainingArmor(s), []); // once
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
  const rewards = QUESTS.find((q) => q.id === Q)!.rewards!;
  assert.deepEqual(r, { ok: true, given: 'weapon-training-stick', gear: armorOf('heavy'), completed: Q, rewards });
  assert.equal(s.cls, 'stick');
  // The weapon and the Heavy armor, all worn; given once.
  assert.deepEqual(worn(s), { weapon: 'weapon-training-stick', ...Object.fromEntries(armorOf('heavy').map((id) => [EQUIPMENT.get(id)!.slot, id])) });
  assert.ok(Object.values(s.equipped).every((i) => i!.bound && i!.rarity === 'brown' && i!.level === 1 && !i!.lines.length && !i!.agimats.length), 'training gear: bound, brown, no rolls');
  assert.equal(s.trainingArmorGiven, true);
  // Its rewards in the combat bag (a stack each).
  assert.deepEqual(s.bag.map((i) => [i.defId, i.count]), rewards.map((x) => [x.item, x.count]));
  assert.deepEqual(s.quests, { active: [{ id: 'tanod-01', step: 0 }], done: [Q], rewarded: [Q] }); // the Tanod's leveling chain next
  assert.equal(startQuests(s).length, 0); // done: never again
  // Someone who already has a class never gets the class quest.
  const old = { ...freshAdventure(), cls: 'broom' };
  assert.equal(startQuests(old).length, 0);
});

test('quest rewards: HP and MP Potions with the class quest; one finished before rewards gets them once; no room, later', () => {
  const D = loadItemData();
  const q = QUESTS.find((x) => x.id === Q)!;
  assert.deepEqual(q.rewards, [{ item: 'low-hp-potion', count: 20 }, { item: 'low-mp-potion', count: 20 }]);
  // Finished before the quest had rewards: given on a later visit, once.
  const old = { ...freshAdventure(), cls: 'broom', quests: { active: [], done: [Q] } };
  assert.deepEqual(giveQuestRewards(D, old, QUESTS, () => `u${n++}`), q.rewards);
  assert.deepEqual(old.bag.map((i) => [i.defId, i.count]), [['low-hp-potion', 20], ['low-mp-potion', 20]]);
  assert.deepEqual(giveQuestRewards(D, old, QUESTS, () => `u${n++}`), []);
  // Onto a stack they already have.
  const some = { ...freshAdventure(), quests: { active: [], done: [Q] }, bag: [newItem(S, D.defs.get('low-hp-potion')!, 'p', 5)] };
  giveQuestRewards(D, some, QUESTS, () => `u${n++}`);
  assert.deepEqual(some.bag.map((i) => [i.defId, i.count]), [['low-hp-potion', 25], ['low-mp-potion', 20]]);
  // No room for all of it: none of it, tried again once there's room.
  const full: import('@mikazuki/shared').AdventureState = { ...freshAdventure(), quests: { active: [], done: [Q] }, bag: fullBag(1) };
  assert.deepEqual(giveQuestRewards(D, full, QUESTS, () => `u${n++}`), []);
  assert.equal(full.quests.rewarded, undefined);
  full.bag.splice(0, 1);
  assert.deepEqual(giveQuestRewards(D, full, QUESTS, () => `u${n++}`), q.rewards);
  // Saved: questRewardsFor gives and keeps them.
  const id = `quest-rewards-${n++}`;
  townQuest(id, { quest: Q, action: 'talk', npc: 'tanod' });
  townQuest(id, { quest: Q, action: 'chooseClass', cls: 'slingshot' });
  assert.deepEqual(adventureOf(id).bag.filter((i) => i.defId.startsWith('low-')).map((i) => i.count), [20, 20]);
  assert.deepEqual(questRewardsFor(id), []);
});

test('equipment: only what your base stats meet, the old one back to the bag, taking off needs a free slot', () => {
  const [broom, stick, worn1] = [item('weapon-training-broom'), item('weapon-training-stick'), item('weapon-training-stick')];
  const s = { ...freshAdventure(), cls: 'stick', equipped: { weapon: worn1 }, bag: [broom, stick] };
  assert.deepEqual(equipStep(s, { action: 'equip', item: broom.uid }), { ok: false, message: 'Needs INT 8' });
  assert.equal(equipStep(s, { action: 'equip', item: 'nope' }).ok, false); // not in the bag
  assert.equal(equipStep(s, { action: 'equip', item: stick.uid, place: 'ring1' }).message, 'Wrong slot.');
  assert.equal(equipStep(s, { action: 'equip', item: stick.uid }).ok, true); // a second stick: swaps (by uid)
  assert.equal(s.equipped.weapon!.uid, stick.uid);
  assert.deepEqual(s.bag.map((i) => i.uid), [broom.uid, worn1.uid]); // where it was
  s.bag.push(...fullBag(2)); // 40 in the bag
  assert.equal(equipStep(s, { action: 'unequip', place: 'weapon' }).message, 'Your bag is full.');
  s.bag.pop();
  assert.equal(equipStep(s, { action: 'unequip', place: 'weapon' }).ok, true);
  assert.equal(s.equipped.weapon, undefined);
  assert.equal(equipStep(s, { action: 'unequip', place: 'weapon' }).ok, false); // nothing there
});

test('saved per member: /me starts the quest, the routes save, unworn gear goes in the combat bag (not the old bag)', () => {
  assert.deepEqual(adventureOf('m1').quests.active, [{ id: Q, step: 0 }]);
  assert.equal(townQuest('m1', { quest: Q, action: 'talk', npc: 'tanod' }).changed, false);
  const done = townQuest('m1', { quest: Q, action: 'chooseClass', cls: 'hilot' });
  assert.equal(done.changed, true);
  assert.equal(done.given, 'weapon-training-balm');
  assert.deepEqual(kitOf('m1'), { cls: 'hilot', weapon: 'weapon-training-balm', weaponPlus: 0, level: 1 });
  const uid = adventureOf('m1').equipped.weapon!.uid;
  assert.equal(townEquip('m1', { action: 'unequip', place: 'weapon' }).changed, true);
  assert.equal(usedSlots('m1'), 0); // the old bag never counts gear
  assert.deepEqual(adventureOf('m1').bag.map((i) => i.uid).slice(2), [uid]); // the same item, saved (after the quest's potions)
  assert.deepEqual(kitOf('m1'), { cls: 'hilot', weapon: null, weaponPlus: 0, level: 1 });
  assert.equal(adventureOf('m1').quests.done[0], Q); // kept
  // The CMS can start it all over: no class, the class quest again, the training gear gone (other items kept).
  resetAdventure('m1');
  assert.deepEqual(kitOf('m1'), { cls: null, weapon: null, weaponPlus: 0, level: 1 });
  assert.deepEqual(adventureOf('m1').quests, { active: [{ id: Q, step: 0 }], done: [], rewarded: [Q] }); // its rewards not again
  assert.deepEqual(kinds(adventureOf('m1').bag), ['low-hp-potion', 'low-mp-potion']);
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
  townQuest('lv', { quest: Q, action: 'talk', npc: 'tanod' });
  townQuest('lv', { quest: Q, action: 'chooseClass', cls: 'slingshot' });
  const can = mobStats(S, 'tin-can')!;
  const kill = killFor('lv', can);
  assert.deepEqual([kill.gained, kill.ups, kill.progress.level], [can.xp, 0, 1]);
  const up = gainXpFor('lv', xpForLevel(S, 4) - can.xp);
  assert.deepEqual([up.ups, up.progress.level, up.progress.xp], [3, 4, 0]);
  const saved = adventureOf('lv').progress;
  assert.deepEqual([saved.level, saved.xp, saved.statPoints, saved.skillPoints], [4, 0, 3 * S.growth.pointsPerLevelUp, skillPointsAt(S, 4)]);
  assert.equal(kitOf('lv').level, 4);
  // What the town passes into a fight: class, level, points, everything worn, the skills' levels (Lv 1 each so far).
  const f = fighterOf('lv');
  assert.deepEqual({ ...f, gear: kinds(f.gear as Item[]) }, { cls: 'slingshot', level: 4, points: {}, gear: ['weapon-training-slingshot', ...armorOf('light')], skills: Array(CLASSES.find((c) => c.id === 'slingshot')!.skills.length).fill(1), moves: { dash: 1, 'step-back': 1 } });
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
  townQuest('sp', { quest: Q, action: 'talk', npc: 'tanod' });
  townQuest('sp', { quest: Q, action: 'chooseClass', cls: 'slingshot' });
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
  townQuest('sl', { quest: Q, action: 'talk', npc: 'tanod' });
  townQuest('sl', { quest: Q, action: 'chooseClass', cls: 'slingshot' });
  // Into the bag to try them (a Slingshot: DEX 10, INT 6, STR 4 at Lv 1).
  const plank = EQUIPMENT.get('weapon-training-plank')!; // a Greatstick's: STR its main
  const need = S.requirements.weapon.main.perItemLevel * plank.level + S.requirements.weapon.main.plus;
  const necklace = { id: 'test-necklace', name: 'Test Necklace', slot: 'necklace' as const, level: 1, rarity: 'lightBlue' as const, bound: false, agimats: [], stats: { str: 50 } };
  EQUIPMENT.set(necklace.id, necklace);
  loadItemData().defs.set(necklace.id, necklace);
  const [p, h, nk] = [item('weapon-training-plank'), item('armor-training-heavy-head'), item('test-necklace')];
  const put = db.prepare('INSERT INTO items (uid, owner, def_id, level, rarity, slot, created) VALUES (?, ?, ?, 1, ?, ?, 0)');
  for (const [i, x] of [p, h, nk].entries()) put.run(x.uid, 'sl', x.defId, x.rarity, 100 + i); // into the bag to try them
  assert.deepEqual(townEquip('sl', { action: 'equip', item: p.uid }).message, `Needs STR ${need}`);
  assert.deepEqual(townEquip('sl', { action: 'equip', item: h.uid }).message, `Needs STR ${S.requirements.armor.bothGearTypeStats.perItemLevel + S.requirements.armor.bothGearTypeStats.plus}`);
  // +50 STR from a necklace changes nothing.
  assert.ok(townEquip('sl', { action: 'equip', item: nk.uid }).ok);
  assert.equal(townEquip('sl', { action: 'equip', item: p.uid }).ok, false);
  assert.equal(townEquip('sl', { action: 'equip', item: h.uid }).ok, false);
  // Its own: fine (off, then on again).
  assert.ok(townEquip('sl', { action: 'unequip', place: 'weapon' }).ok);
  const own = adventureOf('sl').bag.find((i) => i.defId === 'weapon-training-slingshot')!;
  assert.ok(townEquip('sl', { action: 'equip', item: own.uid }).ok);
  EQUIPMENT.delete(necklace.id);
  loadItemData().defs.delete(necklace.id);
});

test('a class from before training armor gets the set once, on a visit; the rest on a later one if the bag was full', () => {
  const row = (id: string, equipped: Record<string, string>, bag: string[] = []) => {
    db.prepare('INSERT INTO adventurers (user_id, class, quests, equipped, bag, updated) VALUES (?, ?, ?, ?, ?, ?)').run(id, 'broom', JSON.stringify({ active: [], done: [Q] }), '{}', '[]', Date.now());
    for (const [place, def] of Object.entries(equipped)) db.prepare("INSERT INTO items (uid, owner, def_id, level, rarity, bound, place, created) VALUES (?, ?, ?, 1, 'brown', 1, ?, 0)").run(`${id}-${place}`, id, def, place);
    bag.forEach((def, i) => db.prepare("INSERT INTO items (uid, owner, def_id, level, rarity, bound, slot, created) VALUES (?, ?, ?, 1, 'brown', 1, ?, 0)").run(`${id}-bag${i}`, id, def, i));
  };
  row('vet', { weapon: 'weapon-training-broom' });
  assert.deepEqual(trainingArmorFor('vet'), armorOf('light'));
  assert.deepEqual(trainingArmorFor('vet'), []); // once
  assert.equal(adventureOf('vet').trainingArmorGiven, true);
  assert.deepEqual(adventureOf('vet').bag, []); // all worn
  // Their feet taken and no room in the combat bag: the boots wait for a later visit.
  row('vet2', { weapon: 'weapon-training-broom', feet: 'armor-training-heavy-feet' }, Array(40).fill('weapon-training-stick'));
  assert.deepEqual(trainingArmorFor('vet2'), armorOf('light').slice(0, 4));
  assert.equal(adventureOf('vet2').trainingArmorGiven, false);
  db.prepare("DELETE FROM items WHERE uid = 'vet2-bag0'").run();
  assert.deepEqual(trainingArmorFor('vet2'), ['armor-training-light-feet']);
  assert.deepEqual(adventureOf('vet2').bag.at(-1)!.defId, 'armor-training-light-feet');
  assert.deepEqual(trainingArmorFor('vet2'), []);
  // No class: nothing.
  assert.deepEqual(trainingArmorFor('nobody'), []);
});

test("training gear can't be sold", () => {
  townQuest('ts', { quest: Q, action: 'talk', npc: 'tanod' });
  townQuest('ts', { quest: Q, action: 'chooseClass', cls: 'stick' });
  townEquip('ts', { action: 'unequip', place: 'weapon' });
  assert.deepEqual([sellInTown('ts', 'weapon-training-stick', 1).ok, sellInTown('ts', 'weapon-training-stick', 1).message], [false, "Training gear can't be sold."]);
  assert.equal(sellManyInTown('ts', [{ id: 'weapon-training-stick', quantity: 1 }]).ok, false);
  assert.deepEqual(kinds(adventureOf('ts').bag), ['low-hp-potion', 'low-mp-potion', 'weapon-training-stick']);
});

test('two places for bracers and two for rings', () => {
  assert.deepEqual(placesFor('ring'), ['ring1', 'ring2']);
  assert.deepEqual(placesFor('bracers'), ['bracers1', 'bracers2']);
  assert.deepEqual(placesFor('weapon'), ['weapon']);
});

test('skill points: banked before a class; then into unlocked skills up to their cap; Reset gives them all back', () => {
  // No class at Lv 10: 27 skill points, banked.
  levelFor('sk', 10);
  assert.equal(adventureOf('sk').progress.skillPoints, 9 * S.skills.skillPointsPerLevelUp);
  assert.equal(townSkills('sk', { action: 'raise', skill: '0' }).message, 'Choose a class to raise skills.');
  townQuest('sk', { quest: Q, action: 'talk', npc: 'tanod' });
  townQuest('sk', { quest: Q, action: 'chooseClass', cls: 'slingshot' });
  assert.equal(adventureOf('sk').progress.skillPoints, 27);
  // Quick Shot (unlock Lv 1): up to Lv 10 at character Lv 10, not 11.
  for (let i = 0; i < 9; i++) assert.ok(townSkills('sk', { action: 'raise', skill: '0' }).ok);
  assert.equal(townSkills('sk', { action: 'raise', skill: '0' }).message, 'Quick Shot is at Lv 10, its cap for now.');
  // Pebble Spray (unlock Lv 6): to 5, not 6. Volley (Lv 18): locked. The mobility moves stay at Lv 1.
  for (let i = 0; i < 4; i++) assert.ok(townSkills('sk', { action: 'raise', skill: '2' }).ok);
  assert.equal(townSkills('sk', { action: 'raise', skill: '2' }).ok, false);
  assert.equal(townSkills('sk', { action: 'raise', skill: '6' }).message, 'Volley unlocks at Lv 18.');
  assert.equal(townSkills('sk', { action: 'raise', skill: 'dash' }).message, 'Dash is at Lv 1, its cap for now.');
  assert.equal(townSkills('sk', { action: 'raise', skill: 'step-back' }).ok, false);
  assert.equal(townSkills('sk', { action: 'raise', skill: 'blink' }).message, 'No such skill.'); // the Broom's and Hilot's
  const p = adventureOf('sk').progress;
  assert.deepEqual([p.skills, p.skillPoints], [{ '0': 10, '2': 5 }, 27 - 9 - 4]);
  // The fight sees the damage skills' levels, in order.
  assert.deepEqual(fighterOf('sk').skills, [10, 1, 5, 1, 1, 1, 1]);
  // (Double Tap to its cap 8: 7; Ricochet, Lv 9, to 2: 1.)
  for (const [skill, n] of [['1', 7], ['3', 1]] as const) for (let i = 0; i < n; i++) assert.ok(townSkills('sk', { action: 'raise', skill }).ok, skill);
  assert.equal(adventureOf('sk').progress.skillPoints, 27 - 9 - 4 - 7 - 1);
  // Reset: free, all 27 back, every skill at Lv 1; stat points stay.
  townPoints('sk', { action: 'spend', stat: 'DEX' });
  const reset = townSkills('sk', { action: 'reset' });
  assert.deepEqual([reset.ok, reset.adventure.progress.skills, reset.adventure.progress.skillPoints, reset.adventure.progress.points], [true, {}, 27, { DEX: 1 }]);
  assert.equal(townSkills('sk', { action: 'reset' }).ok, false); // nothing spent
  // Movement skills unlock at their level, and only a class's own.
  assert.deepEqual([moveLevel('slingshot', 'dash'), moveLevel('slingshot', 'step-back'), moveLevel('slingshot', 'blink'), moveLevel(null, 'dash')], [5, 8, null, null]);
});

test('request bodies are checked', () => {
  assert.deepEqual(parseSkillsAction({ action: 'raise', skill: 'dash' }), { action: 'raise', skill: 'dash' });
  assert.deepEqual(parseSkillsAction({ action: 'reset' }), { action: 'reset' });
  assert.equal(parseSkillsAction({ action: 'raise', skill: 3 }), null);
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
