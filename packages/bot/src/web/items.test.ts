import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';

// Items as instances (@mikazuki/shared items.ts), drops and loot (loot.ts, town-loot.ts), the combat bag and the store
// (combat-bag.ts), against the game's real data files; the schema v12 migration on a throwaway database; loot and potions
// over the town's socket.
const dir = mkdtempSync(join(tmpdir(), 'items-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const shared = await import('@mikazuki/shared');
const { LOOT_REACH, PLAIN_COLOUR, addToBag, affixTier, agimatValue, bagRoom, enhancedBase, equipFromBag, itemName, itemTotals, kusingFor, kusingRange, lineMax, lineValue, nameColour, newAgimat, newItem, pickupLine, rarityColour, rollGear, rollLines, stackLimit } = shared;
type Item = import('@mikazuki/shared').Item;
type EquipmentDef = import('@mikazuki/shared').EquipmentDef;
type CombatItemDef = import('@mikazuki/shared').CombatItemDef;
type TownServerMessage = import('@mikazuki/shared').TownServerMessage;
const { loadItemData } = await import('./stats-data.js');
const { buyCombat, devGive, takeLoot, usePotion } = await import('./combat-bag.js');
const { dropPlus, golemLoot, mobDrops, rollAgimatStat } = await import('./loot.js');
const { LOOT_MS, LootRoom } = await import('./town-loot.js');
const { MIGRATIONS } = await import('../db/db.js');
const { MobRoom, loadMobKinds, loadMobMap } = await import('./town-mobs.js');
const { attachTown } = await import('./town.js');
const { freshAdventure } = await import('./adventure.js');
const { freshProgress } = await import('./progress.js');

const D = loadItemData();
const S = D.stats;
const gear = (id: string) => D.defs.get(id) as EquipmentDef;
const thing = (id: string) => D.defs.get(id) as CombatItemDef;
/** A seeded random (the same rolls every run). */
const lcg = (seed: number) => () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
let n = 0;
const uid = () => `u${++n}`;

test('affix lines: three (the slot\'s own, HP, one from its pool), never a stat twice but a ring\'s two crits, 80–100% of the most', () => {
  const random = lcg(1);
  const pools = S as unknown as { affixes: { slots: Record<string, [string, string[]]> } };
  let ringBoth = 0;
  for (const slot of ['weapon', 'head', 'body', 'hands', 'bottoms', 'feet', 'ring', 'necklace', 'earrings', 'bracers'] as const) {
    for (const tier of ['blue', 'orange'] as const) {
      for (let i = 0; i < 300; i++) {
        const lines = rollLines(S, slot, tier, 20, random);
        assert.equal(lines.length, 3);
        const [fixed, pool] = pools.affixes.slots[slot];
        assert.ok(fixed.split('|').includes(lines[0].stat), `${slot} line 1`);
        assert.equal(lines[1].stat, 'hp');
        assert.ok(pool.some((p) => p.split(/[|\s]/).includes(lines[2].stat)), `${slot} line 3 ${lines[2].stat}`);
        assert.equal(new Set(lines.map((l) => l.stat)).size, 3, `${slot}: no stat twice`);
        if (slot === 'ring' && lines[2].stat.startsWith('crit')) ringBoth++;
        for (const l of lines) {
          const most = lineMax(S, l.stat, tier, 20);
          const rate = l.value < 1;
          // (Whole numbers round; rates to a tenth of a percent.)
          assert.ok(l.value >= (rate ? Math.round(most * 0.8 * 1000) / 1000 : Math.max(1, Math.round(most * 0.8))) && l.value <= (rate ? Math.round(most * 1000) / 1000 : Math.round(most)), `${slot} ${l.stat} ${l.value} of ${most}`);
        }
      }
    }
  }
  assert.ok(ringBoth > 0, 'a ring can roll both crit stats');
});

test('line 3\'s rare stats (crit rate, crit damage, damage amp) roll about 1 in 10 against a common one', () => {
  const random = lcg(2);
  const counts: Record<string, number> = {};
  const N = 20_000;
  for (let i = 0; i < N; i++) {
    const s = rollLines(S, 'weapon', 'orange', 20, random)[2].stat;
    counts[s] = (counts[s] ?? 0) + 1;
  }
  // A weapon's pool: three rare at 0.1, three common at 1 → the rare ones 0.3 / 3.3 ≈ 9%.
  const rare = (counts.critRate ?? 0) + (counts.critDmg ?? 0) + (counts.amp ?? 0);
  assert.ok(Math.abs(rare / N - 0.3 / 3.3) < 0.01, `${rare / N}`);
  assert.ok(Math.abs((counts.lifesteal ?? 0) / N - 1 / 3.3) < 0.02);
});

test('rolled gear: slots by rarity (weapons and armor only), lines only on blue and orange, never bound until worn', () => {
  const random = lcg(3);
  const sling = gear('weapon-sturdy-slingshot');
  for (const [rarity, slots, lines] of [['brown', 0, 0], ['white', 1, 0], ['grey', 2, 0], ['lightBlue', 1, 3], ['darkBlue', 2, 3], ['lightOrange', 1, 3], ['darkOrange', 2, 3]] as const) {
    const it = rollGear(S, sling, rarity, uid(), random);
    assert.deepEqual([it.agimats.length, it.lines.length, it.bound, it.level, it.plus], [slots, lines, false, 20, 0], rarity);
  }
  assert.equal(rollGear(S, gear('acc-bone-ring'), 'darkOrange', uid(), random).agimats.length, 0, 'accessories never have slots');
  assert.equal(affixTier(S, 'grey'), null);
});

test('names: material + slot + line 3\'s affix, the plus after the name, (Broken) after that; agimats with their level and lock', () => {
  const it = rollGear(S, gear('weapon-sturdy-slingshot'), 'darkOrange', uid(), lcg(4));
  it.lines[2] = { stat: 'critRate', value: 0.012 };
  assert.equal(itemName(D, it), 'Sturdy Slingshot of Calamity');
  it.plus = 7;
  assert.equal(itemName(D, it), 'Sturdy Slingshot of Calamity +7');
  it.broken = true;
  assert.equal(itemName(D, it), 'Sturdy Slingshot of Calamity +7 (Broken)');
  it.rarity = 'lightBlue';
  it.broken = false;
  it.plus = 0;
  it.lines[2] = { stat: 'amp', value: 0.006 };
  assert.equal(itemName(D, it), 'Sturdy Slingshot of Flair');
  // A `stat` line takes the viewer's main stat's name.
  const pants = rollGear(S, gear('armor-cotton-bottoms'), 'darkOrange', uid(), lcg(5));
  pants.lines[2] = { stat: 'stat', value: 3 };
  assert.equal(itemName(D, pants, 'DEX'), 'Cotton Pants of the Tempest');
  assert.equal(itemName(D, newItem(S, gear('armor-training-heavy-head'), uid())), 'Training Hard Hat');
  const ag = newAgimat(S, thing('agimat-critdmg'), 20, uid());
  assert.equal(itemName(D, ag), 'Crit Damage Agimat Lv 20');
  assert.equal(itemName(D, newAgimat(S, thing('agimat-atk'), 20, uid(), 'body')), 'ATK Agimat Lv 20 (Body only)');
});

test('the pickup line: "Gained ", the name (plus after it) in its colour, its slot count, a stack\'s ×N, Kusing; plain things white', () => {
  const W = PLAIN_COLOUR;
  const sling = rollGear(S, gear('weapon-sturdy-slingshot'), 'lightOrange', uid(), lcg(6));
  sling.lines[2] = { stat: 'critRate', value: 0.012 };
  sling.plus = 1;
  assert.deepEqual(pickupLine(D, { item: sling }), {
    text: 'Gained Sturdy Slingshot of Calamity +1 (1 slot)',
    parts: [{ text: 'Gained ', colour: W }, { text: 'Sturdy Slingshot of Calamity +1', colour: rarityColour(S, 'lightOrange') }, { text: ' (1 slot)', colour: W }],
  });
  sling.plus = 0;
  sling.rarity = 'darkOrange';
  sling.agimats = [null, null];
  assert.equal(pickupLine(D, { item: sling }).text, 'Gained Sturdy Slingshot of Calamity (2 slots)', 'no +0');
  const stick = rollGear(S, gear('weapon-crude-stick'), 'brown', uid(), lcg(7));
  stick.plus = 3;
  assert.deepEqual(pickupLine(D, { item: stick }).parts, [{ text: 'Gained ', colour: W }, { text: 'Crude Stick +3', colour: rarityColour(S, 'brown') }], 'no slot part without slots');
  assert.deepEqual(pickupLine(D, { item: newItem(S, thing('rough-whetstone'), uid(), 3) }).parts, [{ text: 'Gained ', colour: W }, { text: 'Rough Whetstone', colour: W }, { text: ' ×3', colour: W }]);
  assert.deepEqual(pickupLine(D, { kusing: 1200 }), { text: 'Gained 1,200 Kusing', parts: [{ text: 'Gained 1,200 Kusing', colour: W }] });
  // Plain things are white; gear, agimats and cosmetics keep their rarity's colour.
  for (const id of ['rough-whetstone', 'rough-whetstone-fragment', 'low-repair-kit', 'low-hp-potion', 'low-mp-potion']) assert.equal(nameColour(D, newItem(S, thing(id), uid())), PLAIN_COLOUR, id);
  assert.equal(nameColour(D, newAgimat(S, thing('agimat-critdmg'), 20, uid())), rarityColour(S, 'lightOrange'));
  assert.equal(nameColour(D, newItem(S, thing('lamp-hat'), uid())), rarityColour(S, 'darkOrange'));
});

test('what an item gives: base ATK/DEF by its level with its plus (the guide\'s table), accessories +1% a plus on their lines, agimats fixed', () => {
  const w = gear('weapon-sturdy-stick');
  const at = (plus: number) => enhancedBase(S, w, { level: 20, plus }).atk;
  assert.deepEqual([at(0), at(1), at(3), at(10), at(15), at(20)], [40, 41, 42, 48, 54, 64]);
  assert.deepEqual([0, 20].map((plus) => enhancedBase(S, gear('armor-copper-body'), { level: 20, plus }).def), [12, 19]);
  assert.equal(enhancedBase(S, gear('weapon-training-stick'), { level: 1, plus: 0 }).atk, 5, 'training: its own');
  assert.equal(lineValue(S, gear('acc-bone-ring'), { plus: 20 }, { stat: 'critDmg', value: 0.05 }), 0.06);
  assert.deepEqual([agimatValue(S, 'hp', 10), agimatValue(S, 'STR', 10), agimatValue(S, 'critDmg', 20), agimatValue(S, 'def', 20)], [5, 2, 0.04, 6]);
});

test('stats: worn items add base (+plus), lines (a stat line to the main stat) and agimats; a broken one gives nothing; caps hold', () => {
  const sword = rollGear(S, gear('weapon-sturdy-stick'), 'darkOrange', uid(), lcg(6));
  sword.lines = [{ stat: 'atk', value: 4 }, { stat: 'hp', value: 10 }, { stat: 'critRate', value: 0.014 }];
  sword.agimats = [{ stat: 'atk', level: 20 }, { stat: 'critDmg', level: 20 }];
  sword.plus = 10;
  const pants = rollGear(S, gear('armor-copper-bottoms'), 'lightBlue', uid(), lcg(7));
  pants.lines = [{ stat: 'mp', value: 4 }, { stat: 'hp', value: 5 }, { stat: 'stat', value: 2 }];
  const t = itemTotals(D, [sword, pants], 'STR');
  assert.deepEqual([t.atk, t.def, t.hp, t.mp, t.STR, t.critRate, t.critDamage], [48 + 4 + 3, 12, 15, 4, 2, 0.014, 0.04]);
  sword.broken = true;
  assert.equal(itemTotals(D, [sword], 'STR').atk, 0, 'broken: nothing');
  // Lifesteal past its cap is held there.
  const ring = rollGear(S, gear('acc-bone-ring'), 'darkOrange', uid(), lcg(8));
  ring.lines = [{ stat: 'lifesteal', value: 5 }];
  const d = shared.derivedStats(S, 'stick', 20, shared.baseStats(S, 'stick', 20), itemTotals(D, [ring], 'DEX'));
  assert.equal(d.lifesteal, S.caps.lifesteal);
});

test('wearing: an orange item binds the first time; a broken one or a cosmetic can\'t be worn', () => {
  const s = { ...freshAdventure(), cls: 'stick', progress: { ...freshAdventure().progress, level: 20 } };
  s.progress.points = { DEX: 30, STR: 30 };
  const orange = rollGear(S, gear('weapon-crude-stick'), 'lightOrange', uid(), lcg(9));
  const blue = rollGear(S, gear('armor-tin-head'), 'darkBlue', uid(), lcg(10));
  const broken = rollGear(S, gear('armor-tin-body'), 'grey', uid(), lcg(11));
  broken.broken = true;
  const hat = newItem(S, thing('lamp-hat'), uid());
  s.bag = [orange, blue, broken, hat];
  assert.ok(equipFromBag(D, s, orange.uid).ok);
  assert.equal(s.equipped.weapon!.bound, true, 'orange binds on wear');
  assert.ok(equipFromBag(D, s, blue.uid).ok);
  assert.equal(s.equipped.head!.bound, false, 'blue stays tradeable');
  assert.deepEqual(equipFromBag(D, s, broken.uid), { ok: false, message: "It's broken: repair it first." });
  assert.deepEqual(equipFromBag(D, s, hat.uid), { ok: false, message: "Can't be worn yet." });
});

test('the combat bag: 40 slots; potions stack to 99, whetstones and agimats (same stat, level, lock) to 999, gear never', () => {
  assert.deepEqual([stackLimit(S, thing('low-hp-potion')), stackLimit(S, thing('rough-whetstone')), stackLimit(S, thing('agimat-atk')), stackLimit(S, thing('lamp-hat')), stackLimit(S, gear('weapon-crude-stick'))], [99, 999, 999, 1, 1]);
  const bag: Item[] = [];
  assert.ok(addToBag(D, bag, newItem(S, thing('low-hp-potion'), uid(), 150), uid));
  assert.deepEqual(bag.map((i) => i.count), [99, 51]); // split over two slots
  assert.ok(addToBag(D, bag, newItem(S, thing('low-hp-potion'), uid(), 48), uid));
  assert.deepEqual(bag.map((i) => i.count), [99, 99]);
  // Agimats only stack with the same stat, level and lock.
  addToBag(D, bag, newAgimat(S, thing('agimat-atk'), 10, uid()), uid);
  addToBag(D, bag, newAgimat(S, thing('agimat-atk'), 10, uid()), uid);
  addToBag(D, bag, newAgimat(S, thing('agimat-atk'), 20, uid()), uid);
  addToBag(D, bag, newAgimat(S, thing('agimat-atk'), 10, uid(), 'hands'), uid);
  assert.deepEqual(bag.slice(2).map((i) => [i.level, i.lock ?? null, i.count]), [[10, null, 2], [20, null, 1], [10, 'hands', 1]]);
  while (bag.length < 40) assert.ok(addToBag(D, bag, newItem(S, gear('weapon-crude-stick'), uid()), uid));
  assert.equal(addToBag(D, bag, newItem(S, gear('weapon-crude-stick'), uid()), uid), false, 'full: refused');
  assert.equal(bagRoom(D, bag, newItem(S, thing('low-hp-potion'), uid())), 0);
  assert.equal(addToBag(D, bag, newAgimat(S, thing('agimat-atk'), 10, uid()), uid), true, 'onto its stack still');
  assert.equal(bag.length, 40);
});

test('drops: Kusing every kill, a random 0.6–1.2 × its level\'s (Tin Can 60–120); gear about 3% (brown 20 / white 35 / grey 45, map level, Wire and Crab Lv 20 30%); potions about 5%', () => {
  assert.deepEqual([kusingFor(S, 1), kusingFor(S, 11), kusingFor(S, 13)], [100, 216, 252]);
  assert.deepEqual([kusingRange(S, 1), kusingRange(S, 3), kusingRange(S, 5)], [[60, 120], [70, 140], [82, 163]]);
  const coins: number[] = [];
  const random = lcg(12);
  const N = 30_000;
  let gearN = 0;
  let potions = 0;
  const rarity: Record<string, number> = {};
  const plus: number[] = [];
  for (let i = 0; i < N; i++) {
    const d = mobDrops(D, 'tin-can', 1, random, uid);
    const k = 'kusing' in d[0] ? d[0].kusing : NaN;
    assert.ok(Number.isInteger(k) && k >= 60 && k <= 120, `Kusing ${k}`);
    coins.push(k);
    for (const x of d.slice(1)) {
      if (!('item' in x)) continue;
      const def = D.defs.get(x.item.defId)!;
      if ('slot' in def) {
        gearN++;
        rarity[x.item.rarity] = (rarity[x.item.rarity] ?? 0) + 1;
        assert.equal(x.item.level, 10, 'the Slums\' gear level');
        plus[x.item.plus] = (plus[x.item.plus] ?? 0) + 1;
        assert.ok(!def.training && !x.item.lines.length);
      } else {
        potions++;
        assert.ok(['low-hp-potion', 'low-mp-potion'].includes(def.id));
      }
    }
  }
  assert.ok(Math.abs(gearN / N - 0.03) < 0.004, `gear ${gearN / N}`);
  assert.ok(Math.abs(potions / N - 0.05) < 0.005, `potions ${potions / N}`);
  for (const [r, p] of [['brown', 0.2], ['white', 0.35], ['grey', 0.45]] as const) assert.ok(Math.abs(rarity[r] / gearN - p) < 0.05, `${r} ${rarity[r] / gearN}`);
  assert.ok(coins.includes(60) && coins.includes(120), 'both ends');
  const mean = coins.reduce((a, b) => a + b, 0) / coins.length;
  assert.ok(Math.abs(mean - 90) < 1, `Kusing evenly spread (mean ${mean})`);
  assert.equal(plus.length, 4, `dropped gear: +0 to +3 only (${plus})`);
  assert.ok([0, 1, 2, 3].every((k) => plus[k] > 0), `each plus drops (${plus})`);
  let lv20 = 0;
  let wire = 0;
  for (let i = 0; i < N; i++) for (const x of mobDrops(D, 'wire-tangle', 11, random, uid)) if ('item' in x && 'slot' in D.defs.get(x.item.defId)!) (wire++, x.item.level === 20 && lv20++);
  assert.ok(Math.abs(lv20 / wire - 0.3) < 0.08, `Lv 20 ${lv20 / wire}`);
});

test('dropped gear\'s plus: +0 to +3 by stats.json rarity.dropPlus (60 / 25 / 10 / 5), never more; mob drops and golem loot alike', () => {
  const random = lcg(21);
  const N = 40_000;
  const seen = [0, 0, 0, 0];
  for (let i = 0; i < N; i++) seen[dropPlus(D, random)]++;
  assert.equal(seen.reduce((a, b) => a + b), N, 'nothing over +3');
  for (const [k, p] of [[0, 0.6], [1, 0.25], [2, 0.1], [3, 0.05]] as const) assert.ok(Math.abs(seen[k] / N - p) < 0.01, `+${k} ${seen[k] / N}`);
  // The golem's pieces too (its own random for the plus: the rest of the loot as ever).
  const pluses = new Set<number>();
  const always3 = () => 0.999;
  for (let i = 0; i < 200; i++) {
    for (const x of golemLoot(D, random, uid, always3)) {
      if ('item' in x && 'slot' in D.defs.get(x.item.defId)!) pluses.add(x.item.plus);
    }
  }
  assert.deepEqual([...pluses], [3]);
  const gearOnly = mobDrops(D, 'tin-can', 1, () => 0.001, uid, () => 0.7).find((x) => 'item' in x && 'slot' in D.defs.get(x.item.defId)!);
  assert.ok(gearOnly && 'item' in gearOnly && gearOnly.item.plus === 1, 'a mob\'s gear: 0.7 falls in +1');
});

test('golem loot: its Kusing, 10–20 Rough Whetstones, 1–2 blue or orange gear pieces with lines; an accessory, agimat and the hat now and then', () => {
  const random = lcg(13);
  let accessories = 0;
  let agimats = 0;
  let hats = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) {
    const loot = golemLoot(D, random, uid);
    assert.deepEqual(loot[0], { kusing: 20_000 });
    const stones = loot.find((x) => 'item' in x && x.item.defId === 'rough-whetstone');
    assert.ok(stones && 'item' in stones && stones.item.count >= 10 && stones.item.count <= 20);
    const pieces = loot.filter((x) => 'item' in x && 'slot' in D.defs.get(x.item.defId)! && shared.gearKind((D.defs.get(x.item.defId) as EquipmentDef).slot) !== 'accessory');
    assert.ok(pieces.length >= 1 && pieces.length <= 2);
    for (const p of pieces) if ('item' in p) assert.ok(affixTier(S, p.item.rarity) && p.item.lines.length === 3 && [10, 20].includes(p.item.level));
    for (const x of loot) {
      if (!('item' in x)) continue;
      const def = D.defs.get(x.item.defId)!;
      if ('slot' in def && shared.gearKind(def.slot) === 'accessory') accessories++;
      if (!('slot' in def) && def.kind === 'agimat') (agimats++, assert.ok([10, 20].includes(x.item.level) && !x.item.lock));
      if (x.item.defId === 'lamp-hat') hats++;
    }
  }
  assert.ok(Math.abs(accessories / N - 0.33) < 0.04 && Math.abs(agimats / N - 0.5) < 0.04 && hats / N < 0.04 && hats > 0, `${accessories / N} ${agimats / N} ${hats / N}`);
  // Agimat stats: the rare three seldom.
  const counts: Record<string, number> = {};
  for (let i = 0; i < 20_000; i++) {
    const s = rollAgimatStat(D, random);
    counts[s] = (counts[s] ?? 0) + 1;
  }
  assert.ok((counts.critRate ?? 0) < (counts.atk ?? 0) / 5);
});

test('loot on the ground: a solo kill\'s for its killer 10 s, a party\'s for its members first, the golem\'s only ever its owner\'s; gone after 2 minutes', () => {
  const room = new LootRoom(D, lcg(14), uid);
  const spots = (at: [number, number], k: number) => Array.from({ length: k }, (_, i): [number, number] => [at[0] + i, at[1]]);
  const [coin] = room.drop({ kind: 'tin-can', level: 1, at: [5, 5], to: ['ann'] }, [], spots, 0);
  const k = 'kusing' in coin.content ? coin.content.kusing : 0;
  assert.ok(k >= 60 && k <= 120);
  assert.deepEqual(room.view(coin, 'ann', 0), { id: coin.id, col: 5, row: 5, kusing: k, mine: true });
  assert.deepEqual(room.view(coin, 'bob', 2000), { id: coin.id, col: 5, row: 5, kusing: k, mine: false, opensIn: 8000 }); // faint for Bob
  assert.equal(room.mayTake(coin, 'bob', 9999), false);
  assert.equal(room.mayTake(coin, 'bob', 10_000), true, 'anyone\'s after 10 s');
  // Picked up within LOOT_REACH (a click, F or Space), Kusing and items alike; never from further.
  assert.equal(LOOT_REACH, 1);
  assert.equal(room.pickable('ann', 6, 6, 0, coin.id)?.id, coin.id, 'from the next tile');
  assert.equal(room.pickable('ann', 5, 5, 0)?.id, coin.id, 'no id: the nearest');
  assert.equal(room.pickable('ann', 7, 5, 0, coin.id), null, 'two tiles away: no');
  assert.equal(room.pickable('ann', 7, 5, 0), null);
  assert.equal(room.pickable('bob', 5, 5, 0, coin.id), null, 'not Bob\'s yet');
  assert.equal(room.pickable('bob', 5, 5, 10_000, coin.id)?.id, coin.id);
  const [, ...things] = room.drop({ kind: 'wire-tangle', level: 11, at: [30, 30], to: ['ann'] }, [], spots, 0);
  for (const th of things) {
    assert.equal(room.pickable('ann', th.col + 1, th.row + 1, 0, th.id)?.id, th.id, 'an item: from the next tile too');
    assert.equal(room.pickable('ann', th.col + 2, th.row, 0, th.id), null);
  }
  // Without an id, the nearest of several.
  const near = new LootRoom(D, lcg(15), uid);
  const line = (at: [number, number], k: number) => Array.from({ length: k }, (_, i): [number, number] => [at[0] + i, at[1]]);
  const a = near.drop({ kind: 'tin-can', level: 1, at: [10, 10], to: ['ann'] }, [], line, 0)[0];
  const b = near.drop({ kind: 'tin-can', level: 1, at: [11, 10], to: ['ann'] }, [], line, 0)[0];
  assert.equal(near.pickable('ann', 11, 11, 0)?.id, b.id);
  assert.equal(near.pickable('ann', 10, 11, 0)?.id, a.id);
  // A party's: any member in the room first.
  const [p] = room.drop({ kind: 'tin-can', level: 1, at: [9, 9], to: ['ann'] }, ['ann', 'cy'], spots, 0);
  assert.deepEqual([room.mayTake(p, 'cy', 1), room.mayTake(p, 'bob', 1), room.mayTake(p, 'bob', 10_000)], [true, false, true]);
  // The golem's: each player's own, never shown to anyone else.
  const boss = room.drop({ kind: 'scrapheap-golem', level: 15, at: [20, 20], to: ['ann', 'bob'], boss: true }, ['cy'], spots, 0);
  const anns = boss.filter((l) => l.owners[0] === 'ann');
  assert.ok(anns.length >= 3 && boss.length > anns.length);
  assert.equal(room.view(anns[0], 'bob', 0), null);
  assert.equal(room.view(anns[0], 'cy', 0), null, 'not even their party');
  assert.equal(room.mayTake(anns[0], 'bob', LOOT_MS - 1), false, 'never opens');
  assert.ok(room.viewAll('bob', 0).every((l) => l.mine || l.opensIn !== undefined));
  // Two minutes on: all gone.
  const all = room.viewAll('ann', 0).length + boss.filter((l) => l.owners[0] === 'bob').length;
  assert.equal(room.tick(LOOT_MS - 1).length, 0);
  assert.equal(room.tick(LOOT_MS).length, all);
  assert.equal(room.viewAll('ann', LOOT_MS).length, 0);
});

test('the sari-sari store: HP/MP Potions for Kusing, whetstones and Repair Kits for Kowens; refused without the money or room', () => {
  const c = { equipped: {}, bag: [] as Item[], kusing: 120 };
  let kowens = 10;
  const wallet = () => ({ have: kowens, spend: (k: number) => (kowens >= k ? ((kowens -= k), true) : false) });
  assert.deepEqual(buyCombat(D, c, 1, 'low-hp-potion', 3, wallet(), uid).message, 'You need 150 Kusing but have 120 Kusing. You can afford 2.');
  const ok = buyCombat(D, c, 1, 'low-hp-potion', 2, wallet(), uid);
  assert.deepEqual([ok.ok, ok.message, c.kusing, c.bag.map((i) => [i.defId, i.count])], [true, 'Bought 2× Low HP Potion!', 20, [['low-hp-potion', 2]]]);
  assert.ok(buyCombat(D, c, 1, 'rough-whetstone', 3, wallet(), uid).ok);
  assert.equal(kowens, 1);
  assert.equal(buyCombat(D, c, 1, 'low-repair-kit', 1, wallet(), uid).message, 'You need 15 Kowens but have 1 Kowen.');
  assert.equal(buyCombat(D, c, 1, 'rough-whetstone-fragment', 1, wallet(), uid).message, "That isn't for sale.");
  assert.equal(buyCombat(D, c, 1, 'low-hp-potion', 100, wallet(), uid).message, 'Buy 1 to 99 at a time.');
  // A full bag: only onto its stack.
  while (c.bag.length < 40) c.bag.push(newItem(S, gear('weapon-crude-stick'), uid()));
  c.kusing = 10_000;
  assert.equal(buyCombat(D, c, 1, 'low-mp-potion', 1, wallet(), uid).message, 'Your combat bag is full.');
  assert.ok(buyCombat(D, c, 1, 'low-hp-potion', 5, wallet(), uid).ok, 'onto the stack it has');
  assert.equal(c.bag.find((i) => i.defId === 'low-hp-potion')!.count, 7);
  // Using one: the shared tier's heal, one fewer.
  assert.deepEqual(usePotion(D, c, 'low-hp-potion'), { heals: 'hp', amount: 150 });
  assert.equal(c.bag.find((i) => i.defId === 'low-hp-potion')!.count, 6);
  assert.equal(usePotion(D, c, 'low-mp-potion'), null);
  // Loot: Kusing always fits, an item not.
  assert.ok(takeLoot(D, c, { kusing: 216 }, uid));
  assert.equal(takeLoot(D, c, { item: newItem(S, gear('weapon-crude-stick'), uid()) }, uid), false);
});

test('dev ?give=: gear rolled at its rarity and plus, into the bag', () => {
  const c = { equipped: {}, bag: [] as Item[], kusing: 0 };
  const it = devGive(D, c, 'weapon-sturdy-slingshot', { rarity: 'darkOrange', plus: 7 }, uid, lcg(15))!;
  assert.deepEqual([it.rarity, it.plus, it.lines.length, it.agimats.length, c.bag.length], ['darkOrange', 7, 3, 2, 1]);
  assert.ok(/^Sturdy Slingshot of \w+ \+7$/.test(itemName(D, it)));
});

test('schema v12: every worn and carried training piece becomes an item in the same place, nothing else changed', () => {
  const mem = new Database(':memory:');
  for (const sql of MIGRATIONS.slice(0, 11)) mem.exec(sql);
  mem.prepare('INSERT INTO adventurers (user_id, class, quests, equipped, bag, updated) VALUES (?, ?, ?, ?, ?, ?)').run(
    'm', 'stick', '{"active":[],"done":[]}', JSON.stringify({ weapon: 'weapon-training-stick', head: 'armor-training-heavy-head' }), JSON.stringify(['armor-training-heavy-hands', 'weapon-training-broom']), 5,
  );
  mem.prepare('INSERT INTO adventurers (user_id, class, quests, equipped, bag, updated) VALUES (?, ?, ?, ?, ?, ?)').run('empty', null, '{"active":[],"done":[]}', '{}', '[]', 6);
  mem.exec(MIGRATIONS[11]);
  const rows = mem.prepare('SELECT owner, def_id, level, rarity, plus, broken, bound, agimats, lines, count, place, slot FROM items ORDER BY place, slot').all();
  assert.deepEqual(rows, [
    { owner: 'm', def_id: 'armor-training-heavy-hands', level: 1, rarity: 'brown', plus: 0, broken: 0, bound: 1, agimats: '[]', lines: '[]', count: 1, place: null, slot: 0 },
    { owner: 'm', def_id: 'weapon-training-broom', level: 1, rarity: 'brown', plus: 0, broken: 0, bound: 1, agimats: '[]', lines: '[]', count: 1, place: null, slot: 1 },
    { owner: 'm', def_id: 'armor-training-heavy-head', level: 1, rarity: 'brown', plus: 0, broken: 0, bound: 1, agimats: '[]', lines: '[]', count: 1, place: 'head', slot: null },
    { owner: 'm', def_id: 'weapon-training-stick', level: 1, rarity: 'brown', plus: 0, broken: 0, bound: 1, agimats: '[]', lines: '[]', count: 1, place: 'weapon', slot: null },
  ]);
  assert.equal(new Set((mem.prepare('SELECT uid FROM items').all() as { uid: string }[]).map((r) => r.uid)).size, 4, 'each its own uid');
  assert.deepEqual(mem.prepare('SELECT kusing FROM adventurers').all(), [{ kusing: 0 }, { kusing: 0 }]);
  mem.close();
});

test('over the town\'s socket: a kill drops Kusing (faint for others), nothing picks itself up (not even walking onto it), `pick` takes it within reach; a potion heals, then waits out its shared cooldown', async () => {
  const map = loadMobMap('slums');
  const room = new MobRoom(map, lcg(16), {}, { shapes: {} }, loadMobKinds());
  const can = room.snapshot(0).find((m) => m.id.startsWith('tin-can-alley:'))!;
  const bags = new Map<string, { equipped: Record<string, never>; bag: Item[]; kusing: number }>();
  const bagOf = (name: string) => bags.get(name) ?? bags.set(name, { equipped: {}, bag: [newItem(S, thing('low-hp-potion'), uid(), 3)], kusing: 0 }).get(name)!;
  let maraLevel = 1;
  const server = createServer();
  const town = attachTown(server, {
    map: { size: [4, 4], spawn: [1, 1], blocked: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
    rooms: { slums: () => ({ size: map.size, spawn: [can.col + 1, can.row], blocked: map.blocked }) },
    mobs: { slums: room },
    authenticate: async (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('as'),
    profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} as never, cls: 'slingshot' }),
    progress: {
      fighter: (name) => ({ cls: 'slingshot', level: name === 'Mara' ? maraLevel : 1, points: name === 'Mara' ? { DEX: 100_000 } : {} }),
      kill: () => ({ progress: freshProgress(S, 'slingshot'), gained: 0, ups: 0 }),
    },
    items: {
      take: (name, loot) => takeLoot(D, bagOf(name), loot, uid),
      usePotion: (name, defId) => usePotion(D, bagOf(name), defId),
      state: (name) => bagOf(name),
    },
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  const open = (as: string) =>
    new Promise<{ ws: WebSocket; got: TownServerMessage[] }>((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?as=${as}&room=slums`);
      const got: TownServerMessage[] = [];
      ws.on('message', (d) => got.push(JSON.parse(String(d))));
      ws.on('open', () => ok({ ws, got }));
    });
  const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
  const a = await open('Mara');
  const b = await open('Bob');
  await wait(100);
  const welcome = a.got.find((m) => m.t === 'welcome') as Extract<TownServerMessage, { t: 'welcome' }>;
  const [sc, sr] = welcome.spawn;
  a.ws.send(JSON.stringify({ t: 'attack', mob: can.id, skill: 0 }));
  await wait(200);
  const mine = a.got.find((m) => m.t === 'loot-drop') as Extract<TownServerMessage, { t: 'loot-drop' }>;
  const theirs = b.got.find((m) => m.t === 'loot-drop') as Extract<TownServerMessage, { t: 'loot-drop' }>;
  assert.ok(mine && theirs, 'both see it fall');
  const coin = mine.loot.find((l) => l.kusing)!;
  assert.ok(coin.mine && coin.kusing! >= 60 && coin.kusing! <= 120);
  assert.equal(theirs.loot.find((l) => l.id === coin.id)!.mine, false);
  // Kusing no longer picks itself up (it used to after 0.7 s within 5 tiles).
  await wait(900);
  assert.ok(!a.got.some((m) => m.t === 'items'), 'nothing picked up on its own');
  // Two tiles away: `pick` is refused (silently); walking onto it picks nothing up either.
  const walkTo = async (to: [number, number], [col, row]: [number, number]) => {
    while (col !== to[0] || row !== to[1]) {
      col += Math.sign(to[0] - col);
      row += Math.sign(to[1] - row);
      a.ws.send(JSON.stringify({ t: 'step', col, row }));
      await wait(180);
    }
    return [col, row] as [number, number];
  };
  const blocked = (c: number, r: number) => c < 0 || r < 0 || !!map.blocked[r]?.[c];
  const away = ([[2, 0], [-2, 0], [0, 2], [0, -2]] as const).map(([dc, dr]): [number, number] => [coin.col + dc, coin.row + dr]).find(([c, r]) => !blocked(c, r));
  assert.ok(away, 'a free tile two away');
  let at = await walkTo(away, [sc, sr]);
  a.ws.send(JSON.stringify({ t: 'pick', id: coin.id }));
  a.ws.send(JSON.stringify({ t: 'pick' }));
  await wait(100);
  assert.ok(!a.got.some((m) => m.t === 'items'), 'out of reach');
  at = await walkTo([coin.col, coin.row], at);
  await wait(100);
  assert.ok(!a.got.some((m) => m.t === 'snap'), 'walked there');
  assert.ok(!a.got.some((m) => m.t === 'items'), 'walking onto it picks nothing up');
  a.ws.send(JSON.stringify({ t: 'pick' })); // F / Space: the nearest within reach
  await wait(100);
  const got = a.got.find((m) => m.t === 'items' && m.got?.kusing) as Extract<TownServerMessage, { t: 'items' }>;
  assert.ok(got, JSON.stringify(a.got.filter((m) => m.t === 'snap')));
  assert.equal(got.items.kusing, coin.kusing);
  assert.ok(b.got.some((m) => m.t === 'loot-gone' && m.ids.includes(coin.id)), 'gone for Bob too');
  // A potion at full HP: refused, none used.
  a.ws.send(JSON.stringify({ t: 'potion', item: 'low-hp-potion' }));
  await wait(100);
  assert.ok(a.got.some((m) => m.t === 'potion-refused' && m.reason === 'full'));
  // Hurt (her most HP grows with a level, what she has stays), then two potions: one heals, the next waits.
  maraLevel = 10;
  town.kit('Mara', 'slingshot', null);
  await wait(50);
  const hurt = a.got.filter((m) => m.t === 'vitals' && m.id === welcome.you).at(-1) as Extract<TownServerMessage, { t: 'vitals' }>;
  assert.ok(hurt.hp < hurt.maxHp);
  a.ws.send(JSON.stringify({ t: 'potion', item: 'low-hp-potion' }));
  a.ws.send(JSON.stringify({ t: 'potion', item: 'low-hp-potion' }));
  await wait(150);
  const drank = a.got.find((m) => m.t === 'potion') as Extract<TownServerMessage, { t: 'potion' }>;
  assert.deepEqual([drank.heals, drank.amount, drank.cooldown], ['hp', Math.min(150, hurt.maxHp - hurt.hp), 10_000]); // what it restored
  const cd = a.got.find((m) => m.t === 'potion-refused' && m.reason === 'cooldown') as Extract<TownServerMessage, { t: 'potion-refused' }>;
  assert.ok(cd && (cd.ms ?? 0) > 9000);
  assert.equal(bagOf('Mara').bag.find((i) => i.defId === 'low-hp-potion')!.count, 2, 'one used');
  assert.ok(b.got.some((m) => m.t === 'potion' && m.id === welcome.you), 'Bob sees her heal');
  for (const c of [a, b]) c.ws.close();
  await new Promise((ok) => server.close(ok));
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
