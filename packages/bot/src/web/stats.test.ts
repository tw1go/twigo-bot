import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  type ClassesFile,
  type GearItem,
  STAT_NAMES,
  baseStats,
  canEquip,
  derivedStats,
  gainXp,
  hitDamage,
  levelFromXp,
  levelGap,
  mobStats,
  mobTone,
  mobXp,
  needsLine,
  pointStats,
  requirements,
  rollHit,
  skillBasePct,
  skillLevelBonus,
  skillLevelCap,
  skillPct,
  skillMpCost,
  skillPointsAt,
  statPointsAt,
  unspentStatPoints,
  xpForLevel,
  xpToNext,
} from '@mikazuki/shared';
import { loadGear, loadStats } from './stats-data.js';
import { loadMobMap } from './town-mobs.js';

// The shared stats rules (@mikazuki/shared stats.ts) on the game's real classes/stats.json, against the combat guide's
// tables ("Stats, levels and scaling").

const data = loadStats();
const CLASSES = (JSON.parse(readFileSync(new URL('../../../game/public/assets/classes/classes.json', import.meta.url), 'utf8')) as ClassesFile).classes;
const ids = Object.keys(data.classes);
const weaponOf = (cls: string) => [...loadGear().values()].find((i) => i.slot === 'weapon' && i.class === cls)!;

test('classes.json and stats.json agree: each class\'s main and second stat and gear type', () => {
  assert.deepEqual(ids.sort(), CLASSES.map((c) => c.id).sort());
  for (const c of CLASSES) {
    const s = data.classes[c.id];
    assert.deepEqual([c.mainStat, c.secondStat, c.gear.toLowerCase()], [s.main, s.second, s.gearType], c.id);
    assert.deepEqual(new Set([s.main, s.second, s.third]), new Set(STAT_NAMES), `${c.id}: each stat once`);
  }
  assert.equal(data.classes.greatstick.second, 'DEX');
  assert.equal(data.classes.broom.second, 'DEX');
});

test('XP to the next level: 25 × level^1.75 rounded; MAX (0) at the cap; about 32,000 from 1 to 20', () => {
  assert.deepEqual([1, 2, 10, 19].map((l) => xpToNext(data, l)), [25, 84, 1406, 4323]);
  assert.equal(xpToNext(data, data.levelCap), 0);
  assert.equal(xpForLevel(data, 1), 0);
  assert.equal(xpForLevel(data, 3), 25 + 84);
  const all = xpForLevel(data, 20);
  assert.ok(all > 31_000 && all < 33_000, `${all}`);
});

test('level from XP and gaining XP: level-ups carry the rest over, several at once, and XP stops at the cap', () => {
  assert.deepEqual(levelFromXp(data, 0), { level: 1, xp: 0, next: 25 });
  assert.deepEqual(levelFromXp(data, 24), { level: 1, xp: 24, next: 25 });
  assert.deepEqual(levelFromXp(data, 25), { level: 2, xp: 0, next: 84 });
  assert.deepEqual(levelFromXp(data, 25 + 84 + 10), { level: 3, xp: 10, next: xpToNext(data, 3) });
  assert.deepEqual(levelFromXp(data, 10 ** 9), { level: 20, xp: 0, next: 0 });
  assert.deepEqual(gainXp(data, 1, 20, 8), { level: 2, xp: 3, ups: 1 });
  assert.deepEqual(gainXp(data, 1, 0, 25 + 84 + 1), { level: 3, xp: 1, ups: 2 });
  assert.deepEqual(gainXp(data, 19, 4000, 1000), { level: 20, xp: 0, ups: 1 });
  assert.deepEqual(gainXp(data, 20, 0, 500), { level: 20, xp: 0, ups: 0 });
});

test('base stats by level for every class (the guide\'s table, no points spent); classless 4 / 4 / 4', () => {
  const table: [number, number, number, number, number][] = [
    // level, main, second, third, points
    [1, 10, 6, 4, 0],
    [5, 18, 10, 4, 4],
    [10, 28, 15, 4, 9],
    [15, 38, 20, 4, 14],
    [20, 48, 25, 4, 19],
  ];
  for (const cls of ids) {
    const c = data.classes[cls];
    for (const [L, main, second, third, points] of table) {
      const b = baseStats(data, cls, L);
      assert.deepEqual([b[c.main], b[c.second], b[c.third], statPointsAt(data, L)], [main, second, third, points], `${cls} Lv ${L}`);
    }
  }
  for (const L of [1, 10, 20]) assert.deepEqual(baseStats(data, null, L, { STR: 5 }), { STR: 4, DEX: 4, INT: 4 }, 'classless: points are banked');
});

test('stat points go into the class\'s main or second stat only; unspent ones are counted', () => {
  assert.deepEqual(pointStats(data, 'slingshot'), ['DEX', 'INT']);
  assert.deepEqual(pointStats(data, null), []);
  const b = baseStats(data, 'slingshot', 10, { DEX: 3, INT: 2, STR: 4 });
  assert.deepEqual(b, { DEX: 31, INT: 17, STR: 4 }, 'the STR points don\'t count: the third stays at 4');
  assert.equal(unspentStatPoints(data, 'slingshot', 10, { DEX: 3, INT: 2, STR: 4 }), 4);
  assert.equal(unspentStatPoints(data, null, 10), 9, 'classless: banked');
});

test('derived stats: HP, MP, MP regen, Power with the weapon\'s ATK, DEF, crit (capped) — the guide\'s Power and HP table', () => {
  // Power with all points in the main stat, a weapon of the character's level (ATK 2 × its level; the training weapon 5).
  const power = (cls: string, L: number, atk: number) => {
    const c = data.classes[cls];
    return derivedStats(data, cls, L, baseStats(data, cls, L, { [c.main]: statPointsAt(data, L) }), { atk }).power;
  };
  for (const cls of ids) assert.deepEqual([power(cls, 1, weaponOf(cls).stats.atk!), power(cls, 10, 20), power(cls, 20, 40)], [31, 109, 199], cls);
  const hp = (cls: string, L: number) => {
    const c = data.classes[cls];
    return derivedStats(data, cls, L, baseStats(data, cls, L, { [c.main]: statPointsAt(data, L) })).hp;
  };
  assert.deepEqual([1, 10, 20].map((L) => hp('slingshot', L)), [119, 254, 404], 'third stat STR');
  assert.deepEqual([1, 10, 20].map((L) => hp('greatstick', L)), [155, 452, 782], 'STR main');
  const d = derivedStats(data, 'potlid', 1, baseStats(data, 'potlid', 1), { def: 2 });
  assert.equal(d.def, Math.floor(0.5 * 10) + 2);
  const h = derivedStats(data, 'hilot', 1, baseStats(data, 'hilot', 1));
  assert.equal(h.def, 3, 'STR 6 × 0.5, rounded down');
  assert.equal(h.mp, 30 + 5 + 4 * 10);
  assert.ok(Math.abs(h.mpRegen - (1 + 0.05 * 10)) < 1e-9);
  const s = derivedStats(data, 'slingshot', 1, baseStats(data, 'slingshot', 1));
  assert.ok(Math.abs(s.critRate - 0.06) < 1e-9 && s.critDamage === 1.5);
  assert.equal(derivedStats(data, 'slingshot', 1, baseStats(data, 'slingshot', 1), { critRate: 0.9 }).critRate, data.caps.critRate, 'capped');
  // Gear's stats count here (a necklace's STR is HP), never for requirements (below).
  assert.equal(derivedStats(data, 'slingshot', 1, baseStats(data, 'slingshot', 1), { STR: 5 }).hp, 119 + 6 * 5);
});

test('requirements: weapons main ≥ 2R + 6 (and the highest) and second ≥ R + 4; armor both gear-type stats ≥ R + 4; accessories level only', () => {
  const weapon = (cls: string, level: number): GearItem => ({ slot: 'weapon', class: cls, level });
  assert.deepEqual(requirements(data, weapon('slingshot', 1)), [{ stat: 'level', value: 1 }, { stat: 'DEX', value: 8, main: true }, { stat: 'INT', value: 5 }]);
  assert.deepEqual(requirements(data, weapon('slingshot', 10)).slice(1), [{ stat: 'DEX', value: 26, main: true }, { stat: 'INT', value: 14 }], 'Crude Slingshot');
  assert.deepEqual(requirements(data, weapon('greatstick', 20)).slice(1), [{ stat: 'STR', value: 46, main: true }, { stat: 'DEX', value: 24 }]);
  assert.deepEqual(requirements(data, { slot: 'body', gear: 'Heavy', level: 10 }).slice(1), [{ stat: 'STR', value: 14 }, { stat: 'DEX', value: 14 }], 'Tin Armor');
  assert.deepEqual(requirements(data, { slot: 'ring', level: 7 }), [{ stat: 'level', value: 7 }]);
  // The six training weapons (Lv 1): each class meets its own at Lv 1.
  const lv1: Record<string, string> = { slingshot: 'DEX 8 INT 5', stick: 'DEX 8 STR 5', greatstick: 'STR 8 DEX 5', broom: 'INT 8 DEX 5', potlid: 'STR 8 INT 5', hilot: 'INT 8 STR 5' };
  for (const cls of ids) {
    const w = weaponOf(cls);
    assert.equal(requirements(data, w).slice(1).map((r) => `${r.stat} ${r.value}`).join(' '), lv1[cls], w.id);
    assert.ok(canEquip(data, baseStats(data, cls, 1), 1, w).ok, `${cls} wears ${w.id}`);
  }
});

test('every class can wear exactly its own weapon and gear type, at every level and however its points are spent', () => {
  for (const cls of ids) {
    const c = data.classes[cls];
    for (let L = 1; L <= data.levelCap; L++) {
      const points = statPointsAt(data, L);
      for (let k = 0; k <= points; k++) {
        const base = baseStats(data, cls, L, { [c.main]: k, [c.second]: points - k });
        for (const R of new Set([1, L])) {
          for (const other of ids) assert.equal(canEquip(data, base, L, { slot: 'weapon', class: other, level: R }).ok, other === cls, `${cls} Lv ${L} (${k} in main): ${other} weapon Lv ${R}`);
          for (const gear of Object.keys(data.gearTypeStats)) assert.equal(canEquip(data, base, L, { slot: 'feet', gear, level: R }).ok, gear === c.gearType, `${cls} Lv ${L}: ${gear} armor Lv ${R}`);
        }
      }
    }
  }
});

test('canEquip says what\'s missing (base stats only: gear never counts) and the line says it short', () => {
  const sling = baseStats(data, 'slingshot', 1);
  const r = canEquip(data, sling, 1, weaponOf('stick'));
  assert.deepEqual(r, { ok: false, missing: [{ stat: 'STR', need: 5, have: 4 }] });
  assert.equal(needsLine(r.missing), 'Needs STR 5');
  assert.equal(needsLine(canEquip(data, sling, 1, weaponOf('broom')).missing), 'Needs INT 8');
  // Every point in INT: high enough for a Broom's weapon, but DEX is still the highest.
  const intSling = baseStats(data, 'slingshot', 20, { INT: 19 });
  assert.equal(needsLine(canEquip(data, intSling, 20, weaponOf('broom')).missing), 'Needs INT as your highest stat');
  const big = canEquip(data, sling, 1, { slot: 'weapon', class: 'slingshot', level: 10 });
  assert.equal(needsLine(big.missing), 'Needs Lv 10, DEX 26 and INT 14');
  assert.equal(canEquip(data, baseStats(data, 'slingshot', 9), 9, { slot: 'necklace', level: 10 }).ok, false, 'an accessory: level only');
  assert.equal(canEquip(data, baseStats(data, 'slingshot', 10), 10, { slot: 'necklace', level: 10 }).ok, true);
  assert.equal(needsLine([]), '');
});

test('skills: tiers 100% × 1.3 a tier (rounded), +2% a skill level; a higher tier at Lv 5 beats any lower one at Lv 20', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((t) => skillBasePct(data, t)), [100, 130, 169, 220, 286, 371, 483]);
  assert.equal(Math.round(skillPct(data, 1, 5) * 100), 108);
  assert.equal(Math.round(skillPct(data, 2, 5) * 100), 140);
  assert.equal(Math.round(skillPct(data, 7, 20) * 100), 667);
  assert.equal(skillPct(data, 1), 1);
  for (let t = 2; t <= 7; t++) assert.ok(skillPct(data, t, 5) > skillPct(data, t - 1, 20), `tier ${t} Lv 5 over tier ${t - 1} Lv 20`);
  const b = skillLevelBonus(data, 11);
  for (const [k, v] of Object.entries({ damage: 1.2, buff: 1.5, mpCost: 1.3, cooldown: 0.9 })) assert.ok(Math.abs(b[k as keyof typeof b] - v) < 1e-9, k);
});

test('skill points (3 a level-up) and skill level caps (level − unlock + 1, at most 20)', () => {
  assert.equal(skillPointsAt(data, 1), 0);
  assert.equal(skillPointsAt(data, 10), 27);
  assert.equal(skillPointsAt(data, 20), 57);
  assert.equal(skillLevelCap(data, 10, 1), 10, 'Quick Shot at Lv 10');
  assert.equal(skillLevelCap(data, 10, 6), 5, 'Pebble Spray (unlock 6) at Lv 10');
  assert.equal(skillLevelCap(data, 5, 6), 0, 'not unlocked yet');
  assert.deepEqual([1, 3, 6, 9, 12, 15, 18].map((u) => skillLevelCap(data, 20, u)), [20, 18, 15, 12, 9, 6, 3]);
  assert.equal(skillLevelCap(data, 25, 1), 20);
});

test('damage: a Lv 1 Slingshot hits a Tin Can for about 30 (twice to kill it); crits, DEF, its cap and the level gap', () => {
  const sling = derivedStats(data, 'slingshot', 1, baseStats(data, 'slingshot', 1), { atk: weaponOf('slingshot').stats.atk });
  const me = { ...sling, level: 1 };
  const can = mobStats(data, 'tin-can')!;
  const hit = hitDamage(data, me, can, skillPct(data, 1));
  assert.equal(hit, Math.round((31 * 100) / (100 + can.def)));
  assert.equal(hit, 30);
  assert.equal(Math.ceil(can.hp / hit), 2);
  assert.equal(hitDamage(data, me, can, skillPct(data, 1), true), Math.round((31 * 1.5 * 100) / (100 + can.def)));
  assert.equal(hitDamage(data, { power: 100, level: 1 }, { def: 10_000, level: 1 }, 1), 100 * (1 - data.caps.damageReduction), 'DEF takes at most 75%');
  assert.equal(hitDamage(data, { power: 1, level: 1 }, { def: 50, level: 1 }, 1), 1, 'at least 1');
  // The level gap: -8% a level above you (never under 40%) and +5% miss; nothing for lower ones.
  assert.deepEqual(levelGap(data, 1, 1), { mult: 1, miss: 0 });
  assert.deepEqual(levelGap(data, 10, 1), { mult: 1, miss: 0 });
  const g = levelGap(data, 1, 3);
  assert.ok(Math.abs(g.mult - 0.84) < 1e-9 && Math.abs(g.miss - 0.1) < 1e-9);
  const crab = mobStats(data, 'scrap-crab')!;
  const c = levelGap(data, 1, crab.level);
  assert.ok(c.mult === data.damage.levelGap.minMult && Math.abs(c.miss - 0.6) < 1e-9);
  // Rolls: the miss first, then the crit.
  assert.deepEqual(rollHit(data, me, crab, 1, () => 0.59), { damage: 0, crit: false, miss: true });
  const seq = [0.7, 0.01];
  assert.deepEqual(rollHit(data, me, crab, 1, () => seq.shift()!), { damage: hitDamage(data, me, crab, 1, true), crit: true, miss: false });
  assert.deepEqual(rollHit(data, me, can, 1, () => 0.5), { damage: 30, crit: false, miss: false }, 'no gap: no miss roll');
});

test('mob XP: the table\'s, less for a mob more than 5 levels below (20% a level, never under 20%)', () => {
  const can = mobStats(data, 'tin-can')!;
  assert.equal(mobXp(data, can, 1), can.xp);
  assert.equal(mobXp(data, can, 6), can.xp, '5 below: full');
  assert.equal(mobXp(data, can, 7), Math.round(can.xp * 0.8));
  assert.equal(mobXp(data, can, 20), Math.max(1, Math.round(can.xp * 0.2)));
  const golem = mobStats(data, 'scrapheap-golem')!;
  assert.equal(mobXp(data, golem, 1), golem.xp);
});

test('the mob table: one fixed level each, as on the Slums map; the golem Lv 15 with 10,800 HP', () => {
  const table: Record<string, number> = { 'tin-can': 1, 'bottle-caps': 3, 'tire-roller': 5, 'plastic-bag-spook': 8, 'wire-tangle': 11, 'scrap-crab': 13, 'scrapheap-golem': 15 };
  for (const [kind, level] of Object.entries(table)) assert.equal(mobStats(data, kind)?.level, level, kind);
  assert.equal(mobStats(data, 'scrapheap-golem')!.hp, 10_800);
  const map = loadMobMap('slums');
  for (const z of map.mobZones ?? []) assert.equal(z.level, mobStats(data, z.mob)!.level, `${z.id}: one level, the table's`);
  assert.equal(map.boss!.level, 15);
});

test('mob name colours: grey 5+ levels below you, red 3+ above, white between', () => {
  const tone = (me: number, mob: number) => mobTone(data, me, mob);
  assert.deepEqual([tone(1, 1), tone(1, 3), tone(1, 4), tone(1, 13)], ['white', 'white', 'red', 'red']);
  assert.deepEqual([tone(5, 1), tone(6, 1), tone(10, 1)], ['white', 'grey', 'grey']);
});

test('MP costs: the table by class (T1 free), Dash and the Lv 8 move, +3% a skill level rounded; every class has one', () => {
  const T = data.skills.mpCost!;
  for (const c of CLASSES) assert.ok(T.damageByTier[c.id] && T.dash[c.id] !== undefined && T.mobilityLv8[c.id] !== undefined, `${c.id} has MP costs`);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((i) => skillMpCost(data, 'broom', String(i))), [0, 2, 8, 14, 20, 27, 36]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((i) => skillMpCost(data, 'potlid', String(i))), [0, 1, 4, 8, 11, 15, 20]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((i) => skillMpCost(data, 'greatstick', String(i))), [0, 1, 3, 5, 7, 9, 12]);
  assert.deepEqual([skillMpCost(data, 'hilot', 'dash'), skillMpCost(data, 'hilot', 'blink'), skillMpCost(data, 'slingshot', 'step-back'), skillMpCost(data, 'stick', 'dash')], [6, 10, 6, 2]);
  assert.equal(skillMpCost(data, 'broom', '6', 20), Math.round(36 * 1.57)); // 57
  assert.equal(skillMpCost(data, 'broom', '0', 20), 0);
  assert.equal(skillMpCost(data, null, '3'), 0); // no class: free
});
