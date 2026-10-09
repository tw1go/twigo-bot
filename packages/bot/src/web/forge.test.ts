import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  type CombatItemDef,
  type EquipmentDef,
  type ForgeHolder,
  type Item,
  addToBag,
  auraFor,
  countOf,
  disassemblyYield,
  embedRefusal,
  enhanceRefusal,
  enhanceView,
  fragmentsFor,
  itemAura,
  itemName,
  itemTotals,
  lineValue,
  luckPerFail,
  newAgimat,
  newItem,
  trainingSellPrice,
  rarePerItem,
  rollGear,
} from '@mikazuki/shared';
import { loadItemData } from './stats-data.js';
import { combine, disassemble, embed, enhance, forge, parseForgeAction, repair } from './forge.js';
import { rollAgimatStat } from './loot.js';

// The forge (web/forge.ts, with @mikazuki/shared forge.ts's rules) against the game's real data: enhancing (stones per
// try, the odds with luck, luck per fail, breaking from +16, never a level lost), the whetstone's tier, training gear
// refused, repairs, accessories' +1% a level, agimat rules, disassembly (fragments, the slot-locked agimat, two slots'
// rare weight, agimats destroyed) and combining fragments.

const D = loadItemData();
const S = D.stats as unknown as { enhancement: { cost: { successPct: number[]; whetstonesPerTry: number[] } } };
const cost = S.enhancement.cost;
const gear = (id: string) => D.defs.get(id) as EquipmentDef;
const thing = (id: string) => D.defs.get(id) as CombatItemDef;
/** A seeded random (the same rolls every run). */
const lcg = (seed: number) => () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
let n = 0;
const uid = () => `f${++n}`;
const always = (v: number) => () => v;

/** A character holding these items in its bag (and `stones` Rough Whetstones). */
function holder(items: Item[], stones = 0): ForgeHolder {
  const s: ForgeHolder = { equipped: {}, bag: [] };
  for (const i of items) s.bag.push(i);
  if (stones) addToBag(D, s.bag, newItem(D.stats, thing('rough-whetstone'), uid(), stones), uid);
  return s;
}
const sling = (rarity: Item['rarity'] = 'grey', plus = 0) => ({ ...rollGear(D.stats, gear('weapon-sturdy-slingshot'), rarity, uid(), lcg(3)), plus });

test('enhance: one try uses whetstonesPerTry[target]; success +1 and luck back to 0', () => {
  const item = sling();
  const s = holder([item], 999);
  let used = 0;
  for (let target = 1; target <= 15; target++) {
    const before = countOf(s.bag, 'rough-whetstone');
    const r = enhance(D, s, item.uid, 'rough-whetstone', always(0)); // 0 < any chance: success
    assert.equal(r.outcome, 'success', `+${target}`);
    assert.equal(item.plus, target);
    assert.equal(item.luck, 0);
    assert.equal(before - countOf(s.bag, 'rough-whetstone'), cost.whetstonesPerTry[target]);
    used += cost.whetstonesPerTry[target];
  }
  assert.equal(999 - countOf(s.bag, 'rough-whetstone'), used);
});

test('enhance: a fail uses the stones, adds that bracket\'s luck, never loses a level; the next try\'s odds include it', () => {
  const item = sling('grey', 5);
  const s = holder([item], 999);
  const step = 6;
  enhance(D, s, item.uid, undefined, always(0.9999)); // fail
  assert.equal(item.plus, 5, 'never loses a level');
  assert.equal(item.broken, false);
  assert.equal(item.luck, luckPerFail(D.stats, step));
  assert.equal(luckPerFail(D.stats, 3), 0.1);
  assert.equal(luckPerFail(D.stats, 8), 0.08);
  assert.equal(luckPerFail(D.stats, 13), 0.05);
  assert.equal(luckPerFail(D.stats, 18), 0.03);
  enhance(D, s, item.uid, undefined, always(0.9999));
  assert.equal(item.luck, 0.16);
  const v = enhanceView(D, item, s.bag)!;
  assert.equal(v.target, step);
  assert.equal(v.chance, Math.min(1, Math.round((cost.successPct[step] + 0.16) * 1000) / 1000));
  // A roll just under the odds with luck succeeds, one just over doesn't.
  enhance(D, s, item.uid, undefined, always(v.chance - 0.001));
  assert.equal(item.plus, 6);
  assert.equal(item.luck, 0);
});

test('enhance: from +16 a fail breaks the item (keeps its +, taken off, gives nothing); broken can\'t be enhanced; repair fixes it', () => {
  const item = sling('grey', 15);
  const s = holder([], 999);
  s.equipped.weapon = item;
  const r = enhance(D, s, item.uid, undefined, always(0.9999));
  assert.equal(r.outcome, 'break');
  assert.equal(item.broken, true);
  assert.equal(item.plus, 15, 'keeps its +');
  assert.equal(item.luck, luckPerFail(D.stats, 16));
  assert.equal(s.equipped.weapon, undefined, 'taken off');
  assert.ok(s.bag.includes(item));
  assert.equal(itemTotals(D, [item], 'DEX').atk, 0, 'broken gives nothing');
  assert.match(itemName(D, item), /\(Broken\)$/);
  assert.equal(itemAura(D, item), null, 'no aura while broken');
  assert.match(enhance(D, s, item.uid, undefined, always(0)).message, /broken/i);
  // Repair: a Low Repair Kit (its tier).
  assert.match(repair(D, s, item.uid, 'low-repair-kit').message, /need/i);
  addToBag(D, s.bag, newItem(D.stats, thing('low-repair-kit'), uid(), 2), uid);
  const fixed = repair(D, s, item.uid, 'low-repair-kit');
  assert.equal(fixed.outcome, 'repaired');
  assert.equal(item.broken, false);
  assert.equal(item.plus, 15);
  assert.equal(countOf(s.bag, 'low-repair-kit'), 1);
  assert.match(repair(D, s, item.uid, 'low-repair-kit').message, /isn't broken/);
  // A fail at +1–15 never breaks (luck piles up until a try can't fail).
  const low = sling('grey', 10);
  const t = holder([low], 999);
  for (let i = 0; i < 20; i++) {
    const r = enhance(D, t, low.uid, undefined, always(0.9999));
    assert.notEqual(r.outcome, 'break');
    if (r.outcome === 'success') break;
  }
  assert.equal(low.broken, false);
  assert.equal(low.plus, 11, 'luck alone carried it through');
});

test('enhance: seeded runs to +20 never lose a level, break only from +16, and luck resets on success', () => {
  const random = lcg(42);
  const item = sling('darkOrange');
  const s = holder([], 0);
  s.bag.push(item);
  let breaks = 0;
  let tries = 0;
  while (item.plus < 20 && tries < 2000) {
    addToBag(D, s.bag, newItem(D.stats, thing('rough-whetstone'), uid(), 20), uid);
    if (item.broken) {
      addToBag(D, s.bag, newItem(D.stats, thing('low-repair-kit'), uid(), 1), uid);
      assert.equal(repair(D, s, item.uid, undefined).ok, true);
    }
    const before = item.plus;
    const luck = item.luck;
    const r = enhance(D, s, item.uid, undefined, random);
    tries++;
    assert.ok(item.plus >= before, 'never loses a level');
    if (r.outcome === 'success') assert.equal(item.luck, 0);
    else assert.ok(item.luck > luck);
    if (r.outcome === 'break') {
      breaks++;
      assert.ok(before + 1 >= 16);
    }
  }
  assert.equal(item.plus, 20);
  assert.ok(breaks > 0, 'some breaks on the way to +20');
  assert.match(enhanceRefusal(D, item) ?? '', /most/);
});

test('enhance: only its tier\'s whetstone ("Needs a … Whetstone"), not training gear, not without stones', () => {
  const training = newItem(D.stats, gear('weapon-training-slingshot'), uid());
  assert.match(enhanceRefusal(D, training, 'rough-whetstone') ?? '', /Training gear/);
  const s = holder([training], 99);
  assert.equal(enhance(D, s, training.uid, undefined, always(0)).ok, false);
  // A Lv 30 item (the Mid tier) with a Rough Whetstone.
  const mid = { ...sling(), level: 30 };
  assert.equal(enhanceRefusal(D, mid, 'rough-whetstone'), 'Needs a Polished Whetstone.');
  assert.equal(enhanceRefusal(D, sling(), 'low-hp-potion'), "That isn't a whetstone.");
  assert.equal(enhanceRefusal(D, newItem(D.stats, thing('low-hp-potion'), uid()), 'rough-whetstone'), 'Only weapons, armor and accessories can be enhanced.');
  const item = sling('grey', 4); // +5 takes 3
  const t = holder([item], 2);
  const r = enhance(D, t, item.uid, undefined, always(0));
  assert.equal(r.ok, false);
  assert.match(r.message, /Needs 3/);
  assert.equal(countOf(t.bag, 'rough-whetstone'), 2, 'nothing used');
  assert.equal(item.plus, 4);
});

test('accessories: each line +1% of itself a level (weapons and armor: base ATK / DEF)', () => {
  const ring = rollGear(D.stats, gear('acc-bone-ring'), 'darkOrange', uid(), lcg(9));
  const s = holder([ring], 999);
  const at0 = ring.lines.map((l) => lineValue(D.stats, gear('acc-bone-ring'), ring, l));
  const v = enhanceView(D, ring, s.bag)!;
  assert.equal(v.next.length, 3);
  for (let i = 0; i < 20; i++) enhance(D, s, ring.uid, undefined, always(0));
  // (+16–20 at a 0 roll never fail.)
  assert.equal(ring.plus, 20);
  ring.lines.forEach((l, i) => {
    const want = l.stat === 'hp' || l.stat === 'stat' || l.stat === 'atk' || l.stat === 'mp' || l.stat === 'def' || l.stat === 'hpRegen' ? Math.max(1, Math.round(at0[i] * 1.2)) : Math.round(at0[i] * 1.2 * 1000) / 1000;
    assert.equal(lineValue(D.stats, gear('acc-bone-ring'), ring, l), want, l.stat);
  });
  const w = sling('grey', 10);
  const view = enhanceView(D, w, [])!;
  assert.deepEqual(view.next.map((x) => x.stat), ['atk']);
  assert.equal(view.next[0].from, 48); // base 40 at +10 (+20%)
  assert.equal(view.next[0].to, 49);
});

test('agimats: gear level, slot lock, two different stats, rare ones up to rarePerItem; a full slot asks, then breaks the old one', () => {
  const item = rollGear(D.stats, gear('armor-copper-head'), 'darkBlue', uid(), lcg(5)); // Lv 20, 2 slots (crit agimats fit heads)
  assert.equal(item.agimats.length, 2);
  const ag = (id: string, level = 20, count = 1, lock?: Item['lock']) => ({ ...newAgimat(D.stats, thing(id), level, uid(), lock), count });
  const critDmg = ag('agimat-critdmg', 20, 3);
  const critRate = ag('agimat-critrate');
  const hp = ag('agimat-hp');
  const hp2 = ag('agimat-hp', 10);
  const high = ag('agimat-atk', 30);
  const handsOnly = ag('agimat-def', 20, 1, 'hands');
  const bodyOnly = ag('agimat-def', 20, 1, 'head');
  const s = holder([item, critDmg, critRate, hp, hp2, high, handsOnly, bodyOnly]);
  assert.equal(embed(D, s, item.uid, high.uid, 0, false).message, 'Needs gear of Lv 30 or higher.');
  assert.match(embed(D, s, item.uid, handsOnly.uid, 0, false).message, /hands gear only/);
  assert.equal(embed(D, s, item.uid, critDmg.uid, 0, false).outcome, 'embedded');
  assert.equal(critDmg.count, 2, 'one from the stack');
  assert.deepEqual(item.agimats[0], { stat: 'critDmg', level: 20 });
  // A second rare one (a different stat): fine, both slots may be rare (stats.json agimats.rarePerItem 2)…
  assert.equal(rarePerItem(D.stats), 2);
  assert.equal(embedRefusal(D, item, critRate, 1), null);
  const both = rollGear(D.stats, gear('armor-copper-head'), 'darkBlue', uid(), lcg(6));
  const t = holder([both, ag('agimat-critdmg'), ag('agimat-critrate')]);
  assert.equal(embed(D, t, both.uid, t.bag[1].uid, 0, false).outcome, 'embedded');
  assert.equal(embed(D, t, both.uid, t.bag[1].uid, 1, false).outcome, 'embedded');
  assert.deepEqual(both.agimats.map((a) => a?.stat), ['critDmg', 'critRate']);
  // …and with rarePerItem 1, the second is refused.
  const one = { ...D, stats: { ...D.stats, agimats: { ...(D.stats as never as { agimats: object }).agimats, rarePerItem: 1 } } } as typeof D;
  assert.match(embed(one, s, item.uid, critRate.uid, 1, false).message, /Only one rare agimat/);
  // The same stat twice: refused.
  assert.match(embed(D, s, item.uid, critDmg.uid, 1, false).message, /differ/);
  assert.equal(embed(D, s, item.uid, hp.uid, 1, false).outcome, 'embedded');
  assert.ok(!s.bag.includes(hp), 'the last of a stack goes');
  // Full slot: asks first, then breaks the old one.
  const ask = embed(D, s, item.uid, bodyOnly.uid, 1, false);
  assert.equal(ask.ok, false);
  assert.equal(ask.confirm, true);
  assert.deepEqual(item.agimats[1], { stat: 'hp', level: 20 });
  const done = embed(D, s, item.uid, bodyOnly.uid, 1, true);
  assert.equal(done.outcome, 'embedded');
  assert.deepEqual(item.agimats[1], { stat: 'def', level: 20, lock: 'head' });
  assert.match(done.message, /broke/);
  // Replacing the rare one with another rare one is fine (it's the only rare left).
  assert.equal(embedRefusal(D, item, critRate, 0), null);
  // No slots: refused.
  const brown = rollGear(D.stats, gear('armor-copper-body'), 'brown', uid(), lcg(1));
  assert.match(embedRefusal(D, brown, hp2) ?? '', /slots/);
  // Crit rate and crit damage fit weapons, heads and hands only, damage amp weapons, bodies and boots only (stats.json
  // agimats.onlyIn).
  const body = rollGear(D.stats, gear('armor-copper-body'), 'grey', uid(), lcg(2));
  const head = rollGear(D.stats, gear('armor-copper-head'), 'grey', uid(), lcg(2));
  const amp = ag('agimat-amp');
  assert.equal(embedRefusal(D, body, critDmg, 0), 'It fits weapon, head and hands gear only.');
  assert.equal(embedRefusal(D, body, critRate, 0), 'It fits weapon, head and hands gear only.');
  assert.equal(embedRefusal(D, head, amp, 0), 'It fits weapon, body and feet gear only.');
  assert.equal(embedRefusal(D, sling(), amp, 0), null);
  assert.equal(embedRefusal(D, sling(), critDmg, 0), null);
  assert.equal(embedRefusal(D, body, amp, 0), null);
  assert.equal(embedRefusal(D, rollGear(D.stats, gear('armor-copper-hands'), 'grey', uid(), lcg(2)), critRate, 0), null);
  // Disassembly never rolls an agimat for a slot it can't go in.
  for (let i = 0; i < 300; i++) assert.ok(!['critRate', 'critDmg'].includes(rollAgimatStat(D, lcg(i), 3, 'feet')));
  // Agimat stats count in the stats.
  assert.ok((itemTotals(D, [item], 'STR').critDamage ?? 0) > 0);
});

test('disassembly: fragments 2 + 3 × the stones to its +, a slot-locked agimat of its level from slotted gear, agimats destroyed', () => {
  assert.equal(fragmentsFor(D.stats, 0), 2);
  assert.equal(fragmentsFor(D.stats, 5), 29);
  assert.equal(fragmentsFor(D.stats, 10), 92);
  assert.equal(fragmentsFor(D.stats, 15), 212);
  assert.equal(fragmentsFor(D.stats, 20), 452);
  const item = { ...rollGear(D.stats, gear('armor-copper-hands'), 'darkOrange', uid(), lcg(2)), plus: 12, bound: true };
  item.agimats[0] = { stat: 'atk', level: 20 };
  const s = holder([item]);
  const y = disassemblyYield(D, item);
  assert.equal(y.fragments, 2 + 3 * (1 + 1 + 2 + 2 + 3 + 3 + 4 + 4 + 5 + 5 + 6 + 7));
  assert.deepEqual(y.agimat, { level: 20, lock: 'hands', rareTimes: 3 });
  assert.equal(y.destroys.length, 1);
  const r = disassemble(D, s, item.uid, lcg(7), uid);
  assert.equal(r.outcome, 'disassembled', r.message);
  assert.ok(!s.bag.includes(item), 'bound items can be taken apart');
  assert.equal(countOf(s.bag, 'rough-whetstone-fragment'), y.fragments);
  const got = s.bag.find((b) => thing(b.defId)?.kind === 'agimat')!;
  assert.equal(got.level, 20);
  assert.equal(got.lock, 'hands');
  assert.match(itemName(D, got), / Lv 20 \(Hands only\)$/);
  // Brown gear and accessories: fragments only.
  const brown = rollGear(D.stats, gear('armor-tin-head'), 'brown', uid(), lcg(1));
  const ring = rollGear(D.stats, gear('acc-shell-ring'), 'lightBlue', uid(), lcg(1));
  assert.equal(disassemblyYield(D, brown).agimat, null);
  assert.equal(disassemblyYield(D, ring).agimat, null);
  // Training gear can't; worn gear comes off first.
  const training = newItem(D.stats, gear('armor-training-light-body'), uid());
  const t = holder([training]);
  assert.match(disassemble(D, t, training.uid, lcg(1), uid).message, /Training gear/);
  const worn = sling('white');
  const w = holder([]);
  w.equipped.weapon = worn;
  assert.equal(disassemble(D, w, worn.uid, lcg(1), uid).message, 'Take it off first.');
});

test('disassembly: two slots make the rare three 3× as likely (about 1 in 7 against 1 in 20)', () => {
  const rare = new Set(['critRate', 'critDmg', 'amp']);
  const share = (times: number) => {
    const random = lcg(11);
    let hits = 0;
    for (let i = 0; i < 20000; i++) if (rare.has(rollAgimatStat(D, random, times))) hits++;
    return hits / 20000;
  };
  const one = share(1);
  const two = share(3);
  assert.ok(one > 0.035 && one < 0.07, `one slot ${one}`);
  assert.ok(two > 0.11 && two < 0.18, `two slots ${two}`);
});

test('disassembly: refused (nothing lost) when what comes back has no room', () => {
  const item = rollGear(D.stats, gear('armor-copper-feet'), 'grey', uid(), lcg(4)); // fragments + an agimat
  const s = holder([item]);
  while (s.bag.length < 40) s.bag.push(rollGear(D.stats, gear('armor-tin-head'), 'brown', uid(), lcg(1)));
  const r = disassemble(D, s, item.uid, lcg(1), uid);
  assert.equal(r.ok, false);
  assert.ok(s.bag.includes(item));
});

test('combine: every ten fragments of a tier into one of its whetstones', () => {
  const s = holder([newItem(D.stats, thing('rough-whetstone-fragment'), uid(), 37)]);
  const frag = s.bag[0];
  assert.match(combine(D, holder([newItem(D.stats, thing('rough-whetstone-fragment'), uid(), 9)]), 'x', uid).message, /Only whetstone fragments/);
  const few = holder([newItem(D.stats, thing('rough-whetstone-fragment'), uid(), 9)]);
  assert.match(combine(D, few, few.bag[0].uid, uid).message, /takes 10/);
  const r = combine(D, s, frag.uid, uid);
  assert.equal(r.outcome, 'combined');
  assert.equal(countOf(s.bag, 'rough-whetstone'), 3);
  assert.equal(countOf(s.bag, 'rough-whetstone-fragment'), 7);
  const notFrag = holder([], 20);
  assert.equal(combine(D, notFrag, notFrag.bag[0].uid, uid).ok, false);
});

test('auras: blue +15–17, gold +18–19 (2 glints), prismatic +20 (4 glints, every colour); weapons only, never broken', () => {
  assert.equal(auraFor(D.stats, 14, { weapon: true }), null);
  assert.equal(auraFor(D.stats, 15, { weapon: true })?.aura, 'blue');
  assert.deepEqual([auraFor(D.stats, 17, { weapon: true })?.long, auraFor(D.stats, 17, { weapon: true })?.short], [2, 2]);
  const gold = auraFor(D.stats, 18, { weapon: true })!;
  assert.equal(gold.aura, 'gold');
  assert.equal(gold.glints, 2);
  assert.equal(gold.short, 3);
  const prism = auraFor(D.stats, 20, { weapon: true })!;
  assert.equal(prism.aura, 'prismatic');
  assert.equal(prism.cycle?.length, 5);
  assert.equal(prism.glints, 4);
  assert.deepEqual([prism.long, prism.short], [3, 4]);
  assert.equal(itemAura(D, { ...newItem(D.stats, gear('armor-copper-body'), uid()), plus: 20 }), null, 'armor never glows');
  assert.equal(itemAura(D, { ...sling(), plus: 20, broken: true }), null);
});

test('forge actions: the body checked, then the action', () => {
  assert.equal(parseForgeAction({ action: 'enhance' }), null);
  assert.deepEqual(parseForgeAction({ action: 'enhance', item: 'a', tool: 'rough-whetstone' }), { action: 'enhance', item: 'a', tool: 'rough-whetstone' });
  assert.deepEqual(parseForgeAction({ action: 'embed', item: 'a', agimat: 'b', slot: 1, replace: true }), { action: 'embed', item: 'a', agimat: 'b', slot: 1, replace: true });
  assert.equal(parseForgeAction({ action: 'embed', item: 'a', agimat: 'b', slot: '1' }), null);
  assert.equal(parseForgeAction({ action: 'melt', item: 'a' }), null);
  const item = sling();
  const s = holder([item], 1);
  assert.equal(forge(D, s, { action: 'enhance', item: item.uid }, always(0), uid).outcome, 'success');
});

test('training gear sells from the bag for stats.json trainingGear.sellKusing; other gear and worn pieces don\'t', () => {
  const price = trainingSellPrice(D.stats)!;
  assert.equal(price, 25);
  const train = newItem(D.stats, D.defs.get('weapon-training-slingshot') as never, 't1');
  const crude = newItem(D.stats, D.defs.get('weapon-crude-slingshot') as never, 'c1');
  const worn = newItem(D.stats, D.defs.get('armor-training-light-head') as never, 'w1');
  const s = { equipped: { head: worn }, bag: [train, crude], kusing: 10 };
  assert.deepEqual(forge(D, s, { action: 'sell', item: 'c1' }, Math.random, () => 'x'), { ok: false, message: 'Only training gear and agimats sell here.' });
  assert.deepEqual(forge(D, s, { action: 'sell', item: 'w1' }, Math.random, () => 'x'), { ok: false, message: 'Take it off first.' });
  const r = forge(D, s, { action: 'sell', item: 't1' }, Math.random, () => 'x');
  assert.ok(r.ok && r.outcome === 'sold');
  assert.deepEqual([s.kusing, s.bag.map((i) => i.uid)], [10 + price, ['c1']]);
});

test('many at once (the bag\'s multi-select): disassembly and training gear sales, every one or none', () => {
  const price = trainingSellPrice(D.stats)!;
  // Three pieces taken apart: their fragments added up, one message; the bag keeps the rest.
  const a = sling('brown', 0);
  const b = sling('brown', 5);
  const c = sling('grey', 0); // slotted: an agimat too
  const keep = newItem(D.stats, thing('low-hp-potion'), 'pot', 3);
  const s = holder([a, b, c, keep]);
  const r = forge(D, s, { action: 'disassemble-many', items: [a.uid, b.uid, c.uid, a.uid] }, lcg(5), uid);
  assert.ok(r.ok && r.outcome === 'disassembled', r.message);
  assert.equal(countOf(s.bag, 'rough-whetstone-fragment'), fragmentsFor(D.stats, 0) * 2 + fragmentsFor(D.stats, 5));
  assert.equal(s.bag.filter((i) => thing(i.defId)?.kind === 'agimat').length, 1);
  assert.ok(!s.bag.some((i) => [a.uid, b.uid, c.uid].includes(i.uid)) && s.bag.some((i) => i.uid === 'pot'));
  assert.match(r.message, /^Took 3 items apart: \d+× Rough Whetstone Fragment, .*Agimat/);
  // One refused (training gear, a potion): nothing taken apart, the item named.
  const d = sling('brown', 0);
  const train = newItem(D.stats, D.defs.get('weapon-training-slingshot') as never, 'tr1');
  const t = holder([d, train]);
  const before = structuredClone(t.bag);
  const no = forge(D, t, { action: 'disassemble-many', items: [d.uid, 'tr1'] }, lcg(5), uid);
  assert.deepEqual(no, { ok: false, message: "Training Slingshot: Training gear can't be taken apart." });
  assert.deepEqual(t.bag, before, 'nothing changed');
  // Training gear sold together: the Kusing added up; anything else in the pick refuses them all.
  const t2 = newItem(D.stats, D.defs.get('armor-training-light-head') as never, 'tr2');
  const u = { ...holder([train, t2, d]), kusing: 5 };
  assert.equal(forge(D, u, { action: 'sell-many', items: ['tr1', d.uid] }, Math.random, uid).ok, false);
  assert.equal(u.kusing, 5);
  const sold = forge(D, u, { action: 'sell-many', items: ['tr1', 'tr2'] }, Math.random, uid);
  assert.deepEqual([sold.ok, sold.message, u.kusing, u.bag.map((i) => i.uid)], [true, `Sold 2 items for ${2 * price} Kusing.`, 5 + 2 * price, [d.uid]]);
  // Agimats sell too: 20 Kusing a level each (stats.json agimats.sellKusing), a rare stat 3×, a stack all at once.
  const mp = { ...newAgimat(D.stats, thing('agimat-mp'), 10, 'ag1'), count: 2 };
  const crit = newAgimat(D.stats, thing('agimat-critdmg'), 20, 'ag2', 'hands');
  const v = { ...holder([mp, crit]), kusing: 0 };
  const ag = forge(D, v, { action: 'sell-many', items: ['ag1', 'ag2'] }, Math.random, uid);
  assert.deepEqual([ag.ok, v.kusing, v.bag.length], [true, 2 * 20 * 10 + 20 * 20 * 3, 0]);
  assert.match(forge(D, { ...holder([{ ...mp, uid: 'ag3' }]), kusing: 0 }, { action: 'sell', item: 'ag3' }, Math.random, uid).message, /^Sold 2× Mana Agimat Lv 10 for 400 Kusing\.$/);
  assert.equal(forge(D, holder([newItem(D.stats, thing('low-hp-potion'), 'p1')]), { action: 'sell', item: 'p1' }, Math.random, uid).message, 'Only training gear and agimats sell here.');
  // The body: a list of ids.
  assert.deepEqual(parseForgeAction({ action: 'sell-many', items: ['a', 'b'] }), { action: 'sell-many', items: ['a', 'b'] });
  assert.equal(parseForgeAction({ action: 'disassemble-many', items: [] }), null);
  assert.equal(parseForgeAction({ action: 'disassemble-many', items: 'a' }), null);
});
