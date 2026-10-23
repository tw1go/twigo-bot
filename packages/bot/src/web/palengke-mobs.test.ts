import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type Target, mobStats } from '@mikazuki/shared';
import { loadPalengkeLeveling, loadStats } from './stats-data.js';
import { type MobEvent, MobRoom, facing8, loadMobKinds, loadMobMap, loadSkillShapes } from './town-mobs.js';

// The Lumang Palengke's mobs on the real map (maps/palengke.json, mobs/mobs.json, stats.json): how many, where, and each
// kind's trait as the server runs it (the game only draws them).

const map = loadMobMap('palengke');
const kinds = loadMobKinds();
const stats = loadStats();
/** A room whose rolls never miss or crit (the same damage every time). */
const room = () => new MobRoom(map, () => 0.99, {}, loadSkillShapes(), kinds, undefined, undefined, loadPalengkeLeveling(), { area: 'palengke' });
const zoneOf = (id: string) => id.split(':')[0];
const first = (r: MobRoom, zone: string) => r.snapshot(0).find((m) => zoneOf(m.id) === zone && !m.mini)!;
const guard = (level: number, hpShare = 1): Target => ({ def: 50, level, hpShare });
const attacks = (events: MobEvent[]) => events.filter((e): e is Extract<MobEvent, { t: 'mob-attack' }> => e.t === 'mob-attack');

test('40 alive in each zone (stats.json aliveperZoneIn), 20 packs of 3 jars, 28 Lurkers on the floodwater, none on the Great Scale\'s arena', () => {
  const r = room();
  const all = r.snapshot(0).filter((m) => !m.mini);
  const count = (zone: string) => all.filter((m) => zoneOf(m.id) === zone).length;
  assert.equal(stats.mobBehaviour.aliveperZone, 10, 'the Slums keep theirs');
  for (const z of ['tarp-row', 'gulayan', 'dry-goods-sako', 'karinderya', 'karnehan', 'hall']) assert.equal(count(z), 40, z);
  assert.equal(count('dry-goods-garapon'), 60, '20 packs of 3');
  assert.ok(all.filter((m) => zoneOf(m.id) === 'dry-goods-garapon').every((m) => /:\d+:[0-2]$/.test(m.id)));
  const lurkers = all.filter((m) => zoneOf(m.id) === 'isdaan');
  assert.equal(lurkers.length, 28);
  assert.ok(lurkers.every((m) => map.ground?.[m.row]?.[m.col] === 'baha' && m.hidden && m.untargetable), 'hidden in the floodwater');
  const [c0, r0, c1, r1] = map.boss!.arena;
  assert.ok(all.every((m) => !(m.col >= c0 && m.col <= c1 && m.row >= r0 && m.row <= r1)), 'off the arena');
  // Each with its kind's level and HP; the mini bosses in their kind's look.
  assert.equal(first(r, 'karnehan').maxHp, mobStats(stats, 'sangkalan-chomper')!.hp);
  assert.deepEqual(r.snapshot(0).filter((m) => m.mini).map((m) => [m.mini, m.variant]).sort(), [['monobloc-stack-chairman-mono', 'green'], ['sangkalan-chomper-butch-block', 'mossy'], ['sibuyas-sobber-shallot-holmes', 'red']]);
  // Eight facings.
  assert.ok(all.some((m) => ['s', 'e', 'n', 'w'].includes(m.dir)));
});

test('eight facings: a grid step\'s screen direction', () => {
  assert.deepEqual([[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, -1], [-1, 1]].map(([c, r]) => facing8(c, r)), ['se', 'sw', 'nw', 'ne', 's', 'e', 'n', 'w']);
  assert.equal(facing8(0, 0), null);
});

test('the Chomper blocks half of a hit from the quarter it faces, none from behind', () => {
  const r = room();
  const m = first(r, 'karnehan');
  const front: [number, number] = [m.col + 1, m.row];
  const back: [number, number] = [m.col - 1, m.row];
  // It goes for the player in front (aggressive) and turns to them.
  r.tick(1000, new Map([['A', front]]), new Map([['A', guard(31)]]));
  assert.equal(r.mobInfo(m.id, 1000)!.facing, 'se');
  const a = r.attack('A', front, { cls: 'stick', level: 31 }, m.id, 1100);
  const b = r.attack('B', back, { cls: 'stick', level: 31 }, m.id, 1100);
  assert.ok(a.ok && b.ok);
  const [hitA, hitB] = [a.hits[0], b.hits[0]];
  assert.ok(hitA.reduced && !hitB.reduced);
  assert.equal(hitA.damage, Math.round(hitB.damage * 0.5));
});

test('the Payong blocks only while its umbrella opens (its attack\'s first frames)', () => {
  const r = room();
  const m = first(r, 'tarp-row');
  const front: [number, number] = [m.col + 1, m.row];
  // Passive: hit it, and it turns to fight back.
  const a = r.attack('A', front, { cls: 'stick', level: 21 }, m.id, 1000);
  assert.ok(a.ok && !a.hits[0].reduced, 'not opening: all of it');
  const ev = r.tick(1100, new Map([['A', front]]), new Map([['A', guard(21)]]));
  assert.equal(attacks(ev).length, 1, 'it swings');
  const b = r.attack('B', front, { cls: 'stick', level: 21 }, m.id, 1200);
  assert.ok(b.ok && b.hits[0].reduced, 'opening: half');
  const c = r.attack('C', front, { cls: 'stick', level: 21 }, m.id, 1500);
  assert.ok(c.ok && !c.hits[0].reduced, 'open: all of it again');
});

test('a Lurker lies hidden until a player comes within 2 tiles, then rises; its first hit from hiding is x1.5', () => {
  const r = room();
  const m = first(r, 'isdaan');
  assert.equal(r.attack('A', [m.col + 1, m.row], { cls: 'stick', level: 33 }, m.id, 500).ok, false, 'not targetable');
  const g = new Map([['A', guard(33)]]);
  let ev = r.tick(1000, new Map([['A', [m.col + 3, m.row] as [number, number]]]), g);
  assert.ok(!ev.some((e) => e.t === 'mob-flag' && e.id === m.id), 'three tiles: still hidden');
  const near: [number, number] = [m.col + 1, m.row];
  ev = r.tick(2000, new Map([['A', near]]), g);
  assert.ok(ev.some((e) => e.t === 'mob-flag' && e.id === m.id && e.hidden === false), 'risen');
  // Its swings: the first (after it's up) x1.5, the next plain.
  const swings: number[] = [];
  for (let t = 2000; t < 8000 && swings.length < 2; t += 250) for (const e of attacks(r.tick(t, new Map([['A', near]]), g))) if (e.id === m.id) swings.push(e.hit!.damage);
  assert.equal(swings.length, 2);
  assert.ok(Math.abs(swings[0] / swings[1] - 1.5) < 0.05, `${swings}`);
});

test("the Sentinel's Weigh: x1.5 on a player at full HP, x1 at none; shown as its multiplier", () => {
  const swingOn = (share: number) => {
    const r = room();
    const m = first(r, 'hall');
    const at: [number, number] = [m.col + 1, m.row];
    for (let t = 1000; t < 6000; t += 250) {
      const a = attacks(r.tick(t, new Map([['A', at]]), new Map([['A', guard(35, share)]])));
      if (a.length) return a[0].hit!;
    }
    throw new Error('no swing');
  };
  const full = swingOn(1);
  const none = swingOn(0);
  assert.equal(full.mult, 1.5);
  assert.equal(none.mult, 1);
  assert.ok(Math.abs(full.damage / none.damage - 1.5) < 0.05);
});

test('the Sobber leaves a tear cloud; the Sako spills rice where it lands', () => {
  const r = room();
  const s = first(r, 'gulayan');
  const at: [number, number] = [s.col + 1, s.row];
  let tear = false;
  for (let t = 1000; t < 8000 && !tear; t += 250) {
    r.tick(t, new Map([['A', at]]), new Map([['A', guard(23)]]));
    tear = r.landed(t).some((l) => l.tear === kinds['sibuyas-sobber'].tear!.ms && l.tearAccuracy === kinds['sibuyas-sobber'].tear!.accuracy);
  }
  assert.ok(tear);
  const r2 = room();
  const k = first(r2, 'dry-goods-sako');
  const tile: [number, number] = [k.col + 1, k.row];
  let rice: Extract<MobEvent, { t: 'mob-fx' }> | undefined;
  let when = 0;
  for (let t = 1000; t < 8000 && !rice; t += 250) {
    rice = r2.tick(t, new Map([['A', tile]]), new Map([['A', guard(27)]])).find((e): e is Extract<MobEvent, { t: 'mob-fx' }> => e.t === 'mob-fx' && e.fx === 'rice');
    when = t;
  }
  assert.ok(rice && rice.fx === 'rice');
  assert.deepEqual(rice.at, tile);
  assert.equal(r2.slowAt(...tile, when + rice.in + 10), kinds['sako-slammer'].rice!.slow);
  assert.equal(r2.slowAt(...tile, when + rice.in + rice.ms + 10), 1, 'gone after its time');
  assert.equal(r2.slowAt(tile[0] + 1, tile[1], when + rice.in + 10), 1, 'only its tile');
});

test("the Monobloc's chair hits only a player still near where it was thrown; it loses chairs as its HP falls", () => {
  const throwAt = (move: boolean) => {
    const r = room();
    const m = first(r, 'karinderya');
    const at: [number, number] = [m.col + 3, m.row];
    const g = new Map([['A', guard(29)]]);
    for (let t = 1000; t < 6000; t += 100) {
      const a = attacks(r.tick(t, new Map([['A', at]]), g));
      if (!a.length) continue;
      assert.deepEqual(a[0].to, at, 'thrown at their tile');
      // Then they stay, or step three tiles away before it lands.
      const where: [number, number] = move ? [at[0], at[1] + 3] : at;
      for (let u = t + 100; u < t + 3000; u += 100) {
        r.tick(u, new Map([['A', where]]), g);
        const l = r.landed(u);
        if (l.length) return l[0];
      }
    }
    throw new Error('no chair');
  };
  assert.ok(!throwAt(false).miss && throwAt(false).damage > 0, 'stayed: hit');
  assert.ok(throwAt(true).miss, 'moved: missed');
  // Down past 60% of its HP: a chair lost (a flash for the room).
  const r = room();
  const m = first(r, 'karinderya');
  r.devWound(m.id, Math.round(m.maxHp * 0.61));
  r.attack('A', [m.col + 1, m.row], { cls: 'stick', level: 29 }, m.id, 1000);
  assert.ok(r.flush().some((e) => e.t === 'mob-fx' && e.fx === 'chair-lost' && e.id === m.id));
});
