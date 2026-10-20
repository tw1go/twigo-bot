import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type PalengkeData, type QuestDef, mobName, palengkeQuests } from '@mikazuki/shared';
import type { MobKill } from './town-mobs.js';
import { loadPalengkeLeveling } from './stats-data.js';
import { Silong, type SilongInside, type SilongRun, loadSilong } from './town-silong.js';

// Ang Silong's runs (classes/dungeons.json silong, maps/silong-b1..b3.json) on the real data: opening (a key, the
// quest, a practice run alone), the floors' mobs and mini bosses, the elevator down opening as a floor's mini bosses
// fall and riding (all in, or 20 s after the first; "Bumaba na kayo?"), riding up, the Ice Tanks door, the close.

const L = loadSilong({}, () => 0.5);
const parties: Record<string, string> = { b: 'p1', c: 'p1' };
const silong = () => new Silong(L.data, L.maps, L.deps, (m) => parties[m] ?? null);
const open = (s: Silong, member = 'a', now = 0) => {
  const r = s.open(member, member.toUpperCase(), 40, () => true, now);
  assert.ok(r.ok);
  return r.run;
};
const me = (member: string, floor: 'b1' | 'b2' | 'b3', at: [number, number], out = false): SilongInside => ({ member, id: `t-${member}`, at, out, floor });

/** A mini boss down by a hit (to 1 HP first). */
function fell(run: SilongRun, floor: 'b1' | 'b2' | 'b3', boss: string, now: number): MobKill {
  const f = run.floors[floor];
  const info = f.mobs.mobInfo(`boss:${boss}`, now)!;
  const at: [number, number] = [info.at[0] + 1, info.at[1]];
  const who = `t-${boss}`;
  // (A Frosty Tubbs lies in wait like its Lurkers: someone beside it brings it up.)
  f.mobs.tick(now - 1, new Map([[who, at]]), new Map([[who, { def: 80, level: 40 }]]));
  f.mobs.devWound(info.id, 1);
  const r = f.mobs.attack(who, at, { cls: 'stick', level: 40 }, info.id, now);
  assert.ok(r.ok && r.kills.length, `${boss} down`);
  return r.kills.find((k) => k.id === info.id)!;
}

test('opening: Lv 37, "Ngayon Na" done, a key; a party\'s for its party; a practice run alone at 60%', () => {
  const s = silong();
  assert.equal(s.open('a', 'A', 36, () => true, 0).ok, false);
  const q = s.open('a', 'A', 40, () => true, 0, { done: false });
  assert.ok(!q.ok && q.reason === 'quest');
  assert.ok(!s.open('a', 'A', 40, () => false, 0).ok, 'no key');
  const run = open(s, 'b');
  assert.equal(run.party, 'p1');
  const j = s.join('c', 40);
  assert.ok(j.ok && j.run === run, 'the party joins, no key');
  assert.equal(s.join('a', 40).ok, false, 'not theirs');
  const p = s.openPractice('a', 'A', 40, () => true, 0);
  assert.ok(p.ok && p.run.practice && !p.run.party);
  const real = run.floors.b1.mobs.mobInfo('boss:atsarah', 0)!;
  const prac = p.run.floors.b1.mobs.mobInfo('boss:atsarah', 0)!;
  assert.equal(prac.maxHp, Math.round(real.maxHp * 0.6));
  assert.equal(s.join('b', 40, p.run.id).ok, false, 'practice runs are solo');
});

test("each floor: its rooms' mobs (packs, never respawning), its mini bosses with their guards; B1 reached", () => {
  const run = open(silong());
  assert.deepEqual([...run.reached], ['b1']);
  for (const f of L.data.floors) {
    const snap = run.floors[f.id].mobs.snapshot(0);
    for (const r of f.rooms) {
      const mobs = snap.filter((m) => m.id.startsWith(`${r.id}:`));
      assert.equal(mobs.length, r.packs.flat().length, `${f.id} ${r.id}`);
      if (r.miniBoss) {
        assert.ok(snap.some((m) => m.id === `boss:${r.miniBoss!.id}` && m.boss === 'mini' && m.scale === L.data.miniBossLook.drawScale));
        assert.equal(snap.filter((m) => m.id.startsWith(`guard:${r.miniBoss!.id}:`)).length, r.miniBoss.guards);
      }
    }
  }
});

test("both of a floor's mini bosses down: its elevator opens (the key's spent); it rides when all are in, or 20 s after the first", () => {
  const s = silong();
  const run = open(s);
  const b1 = run.floors.b1;
  const k1 = fell(run, 'b1', 'atsarah', 100);
  const n1 = run.onKill('b1', k1, 100);
  assert.ok(run.keySpent);
  assert.ok(!b1.open, 'one of two');
  assert.ok(n1.room.some(([, m]) => m.t === 'system'));
  run.onKill('b1', fell(run, 'b1', 'sakristan', 200), 200);
  assert.ok(b1.open);
  const [x0] = b1.map.silong.down;
  assert.equal(b1.map.blocked[x0[1]][x0[0]], 0, 'its tiles open');
  // a in it, c elsewhere on B1: c is asked; nothing goes yet.
  const away: [number, number] = b1.map.silong.arriveMark;
  run.setInside([me('a', 'b1', x0), me('c', 'b1', away)], 1000);
  let n = run.step(1000, () => true);
  assert.ok(n.to.some(([m, msg]) => m === 'c' && msg.t === 'silong-ride-ask'));
  assert.equal(n.go.length, 0);
  // 20 s on: down it goes with a alone.
  run.setInside([me('a', 'b1', x0), me('c', 'b1', away)], 21_000);
  n = run.step(21_000, () => true);
  assert.deepEqual(n.go, [{ member: 'a', floor: 'b2', ride: 'down' }]);
  assert.ok(run.reached.has('b2'));
  // Again with c saying yes: both go at once.
  run.setInside([me('a', 'b1', x0), me('c', 'b1', away)], 30_000);
  run.step(30_000, () => true);
  run.answerRide('c', true);
  n = run.step(30_500, () => true);
  assert.deepEqual(n.go.map((g) => g.member).sort(), ['a', 'c']);
});

test('riding up: only from the arrival elevator, only to a floor above the run has reached', () => {
  const run = open(silong());
  run.skipTo('b2');
  const E = run.floors.b2.map.silong.arrive[0];
  run.setInside([me('a', 'b2', E)], 0);
  assert.equal(run.rideUp('a', 'b1'), null);
  assert.ok(run.rideUp('a', 'b3'), 'not above');
  run.setInside([me('a', 'b2', run.floors.b2.map.silong.down[0])], 0);
  assert.ok(run.rideUp('a', 'b1'), 'not in the arrival elevator');
});

test('B3: the Ice Tanks door opens with Frosty Tubbs (its tiles walkable); the Ice Plant reached through it', () => {
  const run = open(silong());
  run.skipTo('b3');
  const b3 = run.floors.b3;
  const door = b3.map.silong.doors[0].tiles;
  assert.ok(door.every(([c, r]) => b3.map.blocked[r][c]));
  run.onKill('b3', fell(run, 'b3', 'frosty-tubbs', 100), 100);
  assert.ok(run.doorOpen);
  assert.ok(door.every(([c, r]) => !b3.map.blocked[r][c]));
  assert.ok(run.view(100).door);
});

test("the close: 2 minutes with nobody inside (the opener's key back if no mini boss fell: the host), the time limit", () => {
  const s = silong();
  const run = open(s);
  run.setInside([], 0);
  assert.ok(!run.step(60_000, () => true).closed);
  const ticks = s.tick(121_000, () => []);
  assert.ok(ticks[0].news.closed && !run.keySpent);
  assert.equal(s.all().length, 0);
  const run2 = open(s, 'a', 0);
  run2.setInside([me('a', 'b1', run2.arrivalFor('b1'))], 0);
  const n = run2.step(L.data.run.timeLimitMinutes * 60_000, () => true);
  assert.ok(n.closed && n.out.some((o) => o.member === 'a' && o.reason === 'closed'));
});

test('"Ngayon Na" (palengke-15): Mang Pido, after the finale, at Lv 37: a talk that gives the Practice Susi ng Silong', () => {
  const P = loadPalengkeLeveling() as unknown as PalengkeData;
  const quests: QuestDef[] = palengkeQuests(P, mobName);
  const q = quests.find((x) => x.id === 'palengke-15')!;
  assert.equal(q.giver, 'mang-pido');
  assert.deepEqual(q.rewards, [{ item: 'practice-susi-ng-silong', count: 1 }]);
  assert.equal(q.rewardKusing, 250001);
  assert.equal(q.objectives[0].type, 'talk');
});
