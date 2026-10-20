import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boosted, cascade, cascadeChances } from '@mikazuki/shared';
import { loadItemData } from './stats-data.js';
import { dropBoost, dropPlus, golemLoot, mobDrops } from './loot.js';

// Cascades (CONTEXT.md Cascade): the best tier first with the table's own odds, the floor always; Drop rate as the boost.

const D = loadItemData();
/** A seeded random (mulberry32): even enough for the small chances here. */
const lcg = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const uid = () => Math.random().toString(16).slice(2);
const close = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) < tol, `${what}: ${a} vs ${b}`);

test("each tier's own chance is its weight over what's left from it down; the floor always lands", () => {
  const chances = cascadeChances([['+3', 5], ['+2', 10], ['+1', 25], ['+0', 60]]);
  assert.deepEqual(chances.map(([t]) => t), ['+3', '+2', '+1', '+0']);
  close(chances[0][1], 0.05, 1e-9, '+3');
  close(chances[1][1], 10 / 95, 1e-9, '+2');
  close(chances[2][1], 25 / 85, 1e-9, '+1');
  assert.equal(chances[3][1], 1);
  assert.equal(cascadeChances([['only', 0]])[0][1], 0);
});

test('a cascade picks like one weighted roll, and a boost favours the better tiers (never the floor)', () => {
  const tiers: [string, number][] = [['legendary', 0.0005], ['mythical', 0.002], ['epic', 0.0075], ['rare', 0.02], ['uncommon', 0.05], ['common', 0.32], ['junk', 0.6]];
  const N = 200_000;
  const count = (boost: number, seed: number) => {
    const random = lcg(seed);
    const n: Record<string, number> = {};
    for (let i = 0; i < N; i++) {
      const t = cascade(tiers, random, boost);
      n[t] = (n[t] ?? 0) + 1;
    }
    return n;
  };
  const plain = count(0, 7);
  for (const [t, w] of tiers) close((plain[t] ?? 0) / N, w, Math.max(0.003, w * 0.15), t);
  const lucky = count(0.5, 8);
  // Junk only when every tier above it misses, each at 1.5 × its own chance: about 42% (60% without the boost).
  const junkAt = cascadeChances(tiers).slice(0, -1).reduce((p, [, c]) => p * (1 - Math.min(1, c * 1.5)), 1);
  close((lucky.junk ?? 0) / N, junkAt, 0.01, 'junk with +50%');
  assert.ok((lucky.common ?? 0) > (plain.common ?? 0) && (lucky.uncommon ?? 0) > (plain.uncommon ?? 0) && (lucky.rare ?? 0) > (plain.rare ?? 0));
  // A single tier is always it; a zero-weight tier never.
  assert.equal(cascade([['one', 1]], () => 0.99), 'one');
  assert.equal(cascade([['never', 0], ['always', 1]], () => 0), 'always');
});

test('boosted: a yes-or-no chance × (1 + boost), never over 1; dropBoost reads stats.json rarity.cascade', () => {
  close(boosted(0.03, 0.5), 0.045, 1e-12, '3% at +50%');
  assert.equal(boosted(0.9, 0.5), 1);
  assert.equal(boosted(0.03), 0.03);
  assert.equal(boosted(0.03, -1), 0.03);
  close(dropBoost(D, 0.023), 0.023, 1e-12, 'perChance 1');
  assert.equal(dropBoost(D, -0.1), 0);
});

test('Drop rate raises a kill\'s chances of gear and a potion and favours the better rarities and pluses; amounts stay', () => {
  const N = 30_000;
  const tally = (boost: number, seed: number) => {
    const random = lcg(seed);
    let gear = 0;
    let potions = 0;
    let grey = 0;
    let plus3 = 0;
    for (let i = 0; i < N; i++) {
      for (const x of mobDrops(D, 'tin-can', 1, random, uid, random, boost).slice(1)) {
        if (!('item' in x)) continue;
        if ('slot' in D.defs.get(x.item.defId)!) {
          gear++;
          if (x.item.rarity === 'grey') grey++;
          if (x.item.plus === 3) plus3++;
        } else potions++;
      }
    }
    return { gear: gear / N, potions: potions / N, grey: grey / gear, plus3: plus3 / gear };
  };
  const plain = tally(0, 3);
  const lucky = tally(0.5, 4);
  close(plain.gear, 0.03, 0.004, 'gear');
  close(lucky.gear, 0.045, 0.005, 'gear at +50%');
  close(plain.potions, 0.05, 0.005, 'potions');
  close(lucky.potions, 0.075, 0.006, 'potions at +50%');
  close(plain.grey, 0.45, 0.05, 'grey');
  close(lucky.grey, 0.675, 0.05, 'grey at +50%');
  assert.ok(lucky.plus3 > plain.plus3, `+3 more often (${plain.plus3} → ${lucky.plus3})`);
  // The plus on its own: +3 first; a boost at the cap never passes +3.
  const seen = new Set<number>();
  const random = lcg(5);
  for (let i = 0; i < 2000; i++) seen.add(dropPlus(D, random, 0.5));
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3]);
});

test("the golem's extras (accessory, agimat, the hat) come more often with Drop rate; its Kusing and stones don't change", () => {
  const N = 4000;
  const hats = (boost: number, seed: number) => {
    const random = lcg(seed);
    let n = 0;
    let stones = 0;
    for (let i = 0; i < N; i++) {
      const loot = golemLoot(D, random, uid, random, 0, boost);
      assert.deepEqual(loot[0], { kusing: 20_000 });
      const s = loot.find((x) => 'item' in x && x.item.defId === 'rough-whetstone');
      if (s && 'item' in s) stones += s.item.count;
      if (loot.some((x) => 'item' in x && x.item.defId === 'lamp-hat')) n++;
    }
    return { hat: n / N, stones: stones / N };
  };
  const plain = hats(0, 9);
  const lucky = hats(0.5, 10);
  close(plain.hat, 0.02, 0.008, 'hat');
  close(lucky.hat, 0.03, 0.009, 'hat at +50%');
  close(plain.stones, 15, 0.5, 'stones');
  close(lucky.stones, 15, 0.5, 'stones at +50%');
});
