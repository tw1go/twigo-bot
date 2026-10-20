import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { type EquipmentDef, isGearDef, kusingFor, miniBossRules, skillLevelCap, xpToNext } from '@mikazuki/shared';
import { type LootContent, combatWares } from './combat-bag.js';
import { fieldBossLoot, fieldBossTable, golemLoot, mobDrops } from './loot.js';
import { loadItemData, loadPalengkeLeveling } from './stats-data.js';

// The Lumang Palengke's numbers (the art folder's palengke-stats-delta.json merged into stats.json, its
// palengke-leveling.json): Lv 21-40, its mobs, the Mid gear tier, its drops and the Great Scale's loot.

const D = loadItemData();
const S = D.stats as typeof D.stats & {
  xp: { toNextByLevel: Record<string, number>; mobXpAbove20: { killsPerLevel: number } };
  mobs: { list: Record<string, { level: number; xp: number; xpMult: number; kusing?: number }> };
};
const palengke = JSON.parse(readFileSync(new URL('../../../game/public/assets/maps/palengke.json', import.meta.url), 'utf8'));
const PALENGKE_MOBS = ['payong-flapper', 'sibuyas-sobber', 'garapon-jars', 'sako-slammer', 'monobloc-stack', 'sangkalan-chomper', 'banyera-lurker', 'timbangan-sentinel'];
/** A seeded random (mulberry32). */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
let n = 0;
const uid = () => `u${++n}`;
const items = (loot: LootContent[]) => loot.flatMap((l) => ('item' in l ? [l.item] : []));

test('the cap is 40: the XP to each next level from 20 on is the delta\'s table (25 × L^1.75), and skills stay capped at 20', () => {
  assert.equal(S.levelCap, 40);
  for (const [L, xp] of Object.entries(S.xp.toNextByLevel)) assert.equal(xpToNext(S, Number(L)), xp, `Lv ${L}`);
  assert.equal(xpToNext(S, 40), 0, 'MAX at 40');
  // A skill unlocked at Lv 1 or 18 tops out at 20 whatever the character's level.
  assert.equal(skillLevelCap(S, 40, 1), 20);
  assert.equal(skillLevelCap(S, 25, 18), 8);
});

test("the Palengke's mobs: XP from the Lv 21+ rule (a level's XP / 50 × xpMult), Kusing from the usual formula", () => {
  for (const id of PALENGKE_MOBS) {
    const m = S.mobs.list[id];
    assert.ok(m && m.level >= 21, id);
    assert.equal(m.xp, Math.round((xpToNext(S, m.level) / S.xp.mobXpAbove20.killsPerLevel) * m.xpMult), `${id} XP`);
    assert.equal(m.kusing, kusingFor(S, m.level), `${id} Kusing`);
  }
  // The map's zones name them, all off until their art comes; the Great Scale too.
  assert.deepEqual(palengke.mobZones.map((z: { mob: string }) => z.mob), PALENGKE_MOBS);
  assert.ok(palengke.mobZones.every((z: { active: boolean }) => !z.active) && palengke.boss.active === false);
  assert.ok(S.mobs.list['great-scale']);
});

test('the Mid tier: Lv 30 and 40 gear for every class, gear type and accessory slot; its whetstone and kit sold from Lv 30', () => {
  const at = (lv: number) => [...D.defs.values()].filter((d): d is EquipmentDef => isGearDef(d) && d.level === lv && !d.training);
  for (const lv of [30, 40]) {
    const gear = at(lv);
    assert.equal(gear.length, at(20).length, `Lv ${lv}: as many kinds as Lv 20`);
    for (const cls of Object.keys(S.classes)) assert.ok(gear.some((d) => d.slot === 'weapon' && d.class === cls), `Lv ${lv} ${cls} weapon`);
    for (const type of ['Heavy', 'Light', 'Household']) for (const slot of ['head', 'body', 'hands', 'bottoms', 'feet']) assert.ok(gear.some((d) => d.slot === slot && d.gear === type), `Lv ${lv} ${type} ${slot}`);
    for (const slot of ['ring', 'bracers', 'necklace', 'earrings']) assert.ok(gear.some((d) => d.slot === slot), `Lv ${lv} ${slot}`);
  }
  assert.deepEqual(at(30).map((d) => d.name).filter((x) => x.startsWith('Fine ')).length, 6);
  const ware = (level: number, id: string) => combatWares(D, level).find((w) => w.def.id === id);
  assert.equal(ware(29, 'polished-whetstone'), undefined, 'not before Lv 30');
  assert.deepEqual(ware(30, 'polished-whetstone') && { tab: ware(30, 'polished-whetstone')!.tab, cost: ware(30, 'polished-whetstone')!.cost, currency: ware(30, 'polished-whetstone')!.currency }, { tab: 'smithing', cost: 5, currency: 'kowens' });
  assert.equal(ware(30, 'mid-repair-kit')?.cost, 20);
  assert.equal(ware(10, 'rough-whetstone')?.cost, 3, 'the Low tier as ever');
});

test("the Palengke's drops: Lv 30 no-affix gear 3% (the Lurker and the Sentinel Lv 40 30% of theirs), Medium potions 5%", () => {
  const N = 40_000;
  const tally = (kind: string, area: string | undefined, seed: number) => {
    const random = seeded(seed);
    const out = { gear: 0, lv40: 0, levels: new Set<number>(), potions: 0, tiers: new Set<string>() };
    for (let i = 0; i < N; i++) {
      for (const it of items(mobDrops(D, kind, 30, random, uid, random, 0, area))) {
        const def = D.defs.get(it.defId)!;
        if (isGearDef(def)) {
          out.gear++;
          out.levels.add(it.level);
          if (it.level === 40) out.lv40++;
          assert.equal(it.lines.length, 0, 'no affix');
        } else if (def.kind === 'potion') {
          out.potions++;
          out.tiers.add(def.tier ?? '');
        }
      }
    }
    return out;
  };
  const flapper = tally('payong-flapper', 'palengke', 1);
  assert.ok(Math.abs(flapper.gear / N - 0.03) < 0.004, `gear ${flapper.gear / N}`);
  assert.deepEqual([...flapper.levels], [30]);
  assert.ok(Math.abs(flapper.potions / N - 0.05) < 0.005, `potions ${flapper.potions / N}`);
  assert.deepEqual([...flapper.tiers], ['mid']);
  const lurker = tally('banyera-lurker', 'palengke', 2);
  assert.ok(Math.abs(lurker.lv40 / lurker.gear - 0.3) < 0.06, `Lv 40 ${lurker.lv40 / lurker.gear}`);
  // The Slums' as ever: its own gear level, Low potions.
  const tin = tally('tin-can', undefined, 3);
  assert.deepEqual([...tin.levels], [10]);
  assert.deepEqual([...tin.tiers], ['low']);
});

test("the Great Scale's loot: 60,000 Kusing, 10-20 Polished Whetstones, Lv 30/40 affix pieces, a Mid Repair Kit now and then, no hat", () => {
  const P = fieldBossTable(D, 'great-scale');
  assert.equal(P, (S as unknown as { bossLoot: { greatScale: { perEligiblePlayer: unknown } } }).bossLoot.greatScale.perEligiblePlayer);
  const random = seeded(4);
  let kits = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) {
    const loot = fieldBossLoot(D, P, random, uid);
    assert.deepEqual(loot[0], { kusing: 60_000 });
    const got = items(loot);
    const stones = got.find((it) => it.defId === 'polished-whetstone');
    assert.ok(stones && stones.count >= 10 && stones.count <= 20);
    for (const it of got) {
      const def = D.defs.get(it.defId)!;
      if (isGearDef(def)) assert.ok([30, 40].includes(it.level) && it.lines.length === 3, `${it.defId} Lv ${it.level}`);
    }
    assert.ok(!got.some((it) => it.defId === 'lamp-hat' || it.defId === 'rough-whetstone'));
    if (got.some((it) => it.defId === 'mid-repair-kit')) kits++;
  }
  assert.ok(Math.abs(kits / N - 0.25) < 0.04, `kits ${kits / N}`);
  // The golem's own table is untouched: Rough Whetstones and its Kusing.
  const golem = golemLoot(D, seeded(5), uid);
  assert.deepEqual(golem[0], { kusing: 20_000 });
  assert.ok(items(golem).some((it) => it.defId === 'rough-whetstone'));
});

test("the Palengke's mini bosses: each on a walkable spot in its mob's zone, its rules and stats from palengke-leveling.json", () => {
  const L = loadPalengkeLeveling();
  const rules = miniBossRules(L);
  assert.equal(rules.respawnMs, 180_000);
  assert.equal(rules.fragmentChance, 1 / 3);
  const placed = palengke.mobZones.flatMap((z: { mob: string; rect: number[]; miniBosses?: { id: string; tile: [number, number] }[] }) =>
    (z.miniBosses ?? []).map((b) => ({ ...b, zone: z })),
  );
  assert.deepEqual(placed.map((b: { id: string }) => b.id).sort(), Object.values(L.miniBosses).flat().map((b) => b.id).sort());
  for (const b of placed) {
    const [c, r] = b.tile;
    const [c0, r0, c1, r1] = b.zone.rect;
    assert.ok(c >= c0 && c <= c1 && r >= r0 && r <= r1, `${b.id} in its zone`);
    assert.equal(palengke.blocked[r][c], 0, `${b.id} walkable`);
    assert.ok(L.miniBosses[b.zone.mob].some((m) => m.id === b.id), `${b.id} is its mob's`);
  }
});
