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

// ── The mini bosses' moves (town-silong-bosses.ts) ──

type Ev = import('./town-mobs.js').MobEvent;
const of = <T extends Ev['t']>(events: Ev[], t: T) => events.filter((e): e is Extract<Ev, { t: T }> => e.t === t);
/** A floor's room ticked from `from` to `to` (every 250 ms) with these players standing still; every event. */
function play(run: SilongRun, floor: 'b1' | 'b2' | 'b3', from: number, to: number, players: Record<string, [number, number]>): Ev[] {
  const f = run.floors[floor];
  const where = new Map(Object.entries(players));
  const guards = new Map(Object.keys(players).map((id) => [id, { def: 80, level: 40 }]));
  const out: Ev[] = [];
  for (let t = from; t <= to; t += 250) out.push(...f.mobs.tick(t, where, guards), ...f.mobs.flush());
  return out;
}
const tileOf = (run: SilongRun, floor: 'b1' | 'b2' | 'b3', boss: string) => run.floors[floor].mobs.mobInfo(`boss:${boss}`, 0)!.at;
const near = (t: [number, number], dc = 2, dr = 0): [number, number] => [t[0] + dc, t[1] + dr];

test("Atsarah: Brine Splash round her (its hit slows 30%), Lid Spin out and back, her jars at 66% and 33%", () => {
  const run = open(silong());
  const at = tileOf(run, 'b1', 'atsarah');
  const ev = play(run, 'b1', 0, 14_000, { A: near(at, 1), B: near(at, -3, 0) });
  const moves = of(ev, 'boss-move').filter((m) => m.id === 'boss:atsarah');
  assert.ok(moves.some((m) => m.move === 'brineSplash' && m.shape?.kind === 'circle'));
  const lid = moves.find((m) => m.move === 'lidSpin')!;
  assert.equal(lid?.shape?.kind, 'line');
  assert.ok(of(ev, 'boss-hit').some((h) => h.key === `${lid.key}:back`), 'the lid comes back');
  assert.ok(run.floors.b1.mobs.landed(14_000).some((l) => l.slowFactor === 0.7 && l.slow === 2000), 'Brine Splash slows to 70% for 2 s');
  // Her jars at 66%.
  const f = run.floors.b1;
  const info = f.mobs.mobInfo('boss:atsarah', 15_000)!;
  f.mobs.devWound(info.id, Math.round(info.maxHp * 0.66) + 10);
  f.mobs.attack('t-x', near(info.at, 1), { cls: 'stick', level: 40 }, info.id, 15_000);
  const calls = of(f.mobs.flush(), 'boss-move').filter((m) => m.move === 'jarCall');
  assert.equal((calls[0]?.data?.spots as unknown[])?.length, 3);
});

test('Sakristan: Rice Rain leaves spilled rice; Belly Flop lands him on the farthest player', () => {
  const run = open(silong());
  const at = tileOf(run, 'b1', 'sakristan');
  const far = near(at, 0, 5);
  const ev = play(run, 'b1', 0, 15_000, { A: near(at, 1), B: far });
  const fx = of(ev, 'mob-fx').filter((e) => e.fx === 'rice');
  assert.ok(fx.length >= 5, 'a patch under each');
  const flop = of(ev, 'boss-move').find((m) => m.move === 'bellyFlop')!;
  assert.deepEqual(flop.shape?.kind === 'circle' && flop.shape.at, far);
  assert.ok(of(ev, 'mob-spawn').some((e) => e.id === 'boss:sakristan' && e.col === far[0] && e.row === far[1]), 'he lands there');
});

test('Mono Lisa: Chair Barrage lands where they stood; at 60% she splits: two fakes, every hit on them blocked, gone after 6 s', () => {
  const run = open(silong());
  run.skipTo('b2');
  const at = tileOf(run, 'b2', 'mono-lisa');
  const ev = play(run, 'b2', 0, 10_000, { A: near(at, 2), B: near(at, -2) });
  const barrage = of(ev, 'boss-move').find((m) => m.move === 'chairBarrage')!;
  assert.equal((barrage.data?.chairs as unknown[]).length, 4);
  const f = run.floors.b2;
  const info = f.mobs.mobInfo('boss:mono-lisa', 11_000)!;
  f.mobs.devWound(info.id, Math.round(info.maxHp * 0.6) + 10);
  f.mobs.attack('t-x', near(info.at, 1), { cls: 'stick', level: 40 }, info.id, 11_000);
  const split = of(f.mobs.flush(), 'boss-move').find((m) => m.move === 'split')!;
  const fakes = split.data!.fakes as string[];
  assert.equal(fakes.length, 2);
  const fake = f.mobs.mobInfo(fakes[0], 11_000)!;
  const r = f.mobs.attack('t-y', near(fake.at, 1), { cls: 'stick', level: 40 }, fakes[0], 11_500);
  assert.ok(r.ok && r.hits[0].blocked, 'only the real one takes damage');
  const later = play(run, 'b2', 11_250, 17_500, { A: near(at, 2) });
  assert.ok(of(later, 'mob-remove').some((e) => fakes.every((id) => e.ids.includes(id))));
});

test("Sangkalancelot: his shell blocks every hit from his front, except just after a Cleaver Charge; his hooks from 50%", () => {
  const run = open(silong());
  run.skipTo('b2');
  const f = run.floors.b2;
  const at = tileOf(run, 'b2', 'sangkalancelot');
  // He faces whoever he fights: from his front, blocked.
  play(run, 'b2', 0, 1000, { A: near(at, 1) });
  const facing = f.mobs.mobInfo('boss:sangkalancelot', 1000)!;
  const front = near(facing.at, facing.facing === 'se' ? 1 : facing.facing === 'nw' ? -1 : 0, facing.facing === 'sw' ? 1 : facing.facing === 'ne' ? -1 : 0);
  const blocked = f.mobs.attack('t-a', front, { cls: 'stick', level: 40 }, 'boss:sangkalancelot', 1100);
  assert.ok(blocked.ok && blocked.hits[0].blocked, 'his front: blocked');
  // A Cleaver Charge: open for a moment after.
  const ev = play(run, 'b2', 1250, 12_000, { A: near(at, 1), B: near(at, 0, 6) });
  const charge = of(ev, 'boss-hit').find((h) => h.move === 'cleaverCharge')!;
  assert.ok(charge && (charge.data?.openMs as number) > 1200);
  // At half: his Chompers, then hook shadows every 6 s.
  const info = f.mobs.mobInfo('boss:sangkalancelot', 13_000)!;
  f.mobs.devWound(info.id, Math.round(info.maxHp * 0.5));
  f.mobs.attack('t-z', near(info.at, -1), { cls: 'stick', level: 40 }, info.id, 13_000);
  assert.ok(of(f.mobs.flush(), 'boss-move').some((m) => m.move === 'hookSwing'));
  const hooks = play(run, 'b2', 13_250, 26_000, { A: near(at, 1) });
  assert.ok(of(hooks, 'boss-move').some((m) => m.move === 'hookShadows' && m.shape?.kind === 'circles'));
});

test('Frosty Tubbs: Ambush (under the ice, up under the circle), Ice Slick (a cone of ice for 5 s), his Lurkers out of the tanks', () => {
  const run = open(silong());
  run.skipTo('b3');
  const f = run.floors.b3;
  const at = tileOf(run, 'b3', 'frosty-tubbs');
  const ev = play(run, 'b3', 0, 16_000, { A: near(at, 1), B: near(at, -3) });
  const ambush = of(ev, 'boss-move').find((m) => m.move === 'ambush')!;
  assert.ok(of(ev, 'mob-flag').some((e) => e.id === 'boss:frosty-tubbs' && e.hidden === true), 'under the ice');
  const to = ambush.data!.to as [number, number];
  assert.ok(of(ev, 'mob-spawn').some((e) => e.id === 'boss:frosty-tubbs' && e.col === to[0] && e.row === to[1]), 'up under the circle');
  const slick = of(ev, 'boss-hit').find((h) => h.move === 'iceSlick')!;
  assert.ok((slick.data?.ice as unknown[]).length > 3 && slick.data?.ms === 5000);
  const info = f.mobs.mobInfo('boss:frosty-tubbs', 17_000)!;
  f.mobs.devWound(info.id, Math.round(info.maxHp * 0.5));
  f.mobs.attack('t-z', near(info.at, 1), { cls: 'stick', level: 40 }, info.id, 17_000);
  const call = of(f.mobs.flush(), 'boss-move').find((m) => m.move === 'tubCall')!;
  const spots = call.data!.spots as [number, number][];
  assert.ok(spots.length === 2 && spots.every(([c, r]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => f.map.ground?.[r + dr]?.[c + dc] === 'tank')), 'beside the tanks');
});

// ── Ang Makinang Yelo (the last boss, B3's Ice Plant) ──

/** Players round the Ice Plant: A and D in the Freezer Breath's cone (down-left of its fan), B and C away from it. */
const PLANT: Record<string, [number, number]> = { A: [50, 33], D: [56, 33], B: [40, 40], C: [35, 25] };

test('Ang Makinang Yelo: on its body, still, its two Frost Scales by the fan; Ice Block Drop leaves walls for 12 s', () => {
  const run = open(silong());
  run.skipTo('b3');
  const f = run.floors.b3;
  const info = f.mobs.mobInfo('boss:makinang-yelo', 0)!;
  assert.deepEqual(info.at, [56, 22], "its body's middle");
  const guards = [0, 1].map((k) => f.mobs.mobInfo(`guard:makinang-yelo:${k}`, 0));
  assert.ok(guards.every((g) => g && g.kind === 'frost-scale'), 'two Frost Scales');
  const ev = play(run, 'b3', 0, 6000, PLANT);
  assert.ok(!of(ev, 'mob-move').some((e) => e.id === info.id), 'never moves');
  const drop = of(ev, 'boss-hit').find((h) => h.move === 'iceBlockDrop')!;
  const blocks = drop.data!.blocks as [number, number][];
  assert.equal(blocks.length, 3);
  assert.ok(blocks.every(([c, r]) => f.map.blocked[r][c] === 1), 'walls');
  // (Everyone a step on: the next drop falls elsewhere.)
  const moved = Object.fromEntries(Object.entries(PLANT).map(([k, [c, r]]) => [k, [c, r + 1] as [number, number]]));
  play(run, 'b3', 6250, 18_000, moved);
  assert.ok(blocks.every(([c, r]) => f.map.blocked[r][c] === 0), 'gone after 12 s');
});

test("Freezer Breath: a 120° cone down-left of its fan, 2 Chill; nothing for whoever an ice block stands between", () => {
  const run = open(silong());
  run.skipTo('b3');
  const f = run.floors.b3;
  // (Blocks on the line from the fan [53,28] to A.)
  for (const t of ['52,30', '52,31', '51,31', '51,32']) f.bosses.iceBlocks.set(t, 60_000);
  const ev = play(run, 'b3', 0, 10_000, PLANT);
  const warn = of(ev, 'boss-move').find((m) => m.move === 'freezerBreath')!;
  assert.equal(warn.shape?.kind, 'cone');
  const breath = of(ev, 'boss-hit').find((h) => h.move === 'freezerBreath')!;
  const hit = new Set(breath.hits.map((h) => h.id));
  assert.ok(hit.has('D') && !hit.has('A') && !hit.has('B'), 'D in the open, A behind the ice, B out of it');
  assert.equal(breath.data?.chill, 2);
});

test('Belt Rush: a line down one belt; Brine Flood only from 70%, every Ice Plant floor tile but the pallets', () => {
  const run = open(silong());
  run.skipTo('b3');
  const f = run.floors.b3;
  const ev = play(run, 'b3', 0, 16_000, PLANT);
  const rush = of(ev, 'boss-move').find((m) => m.move === 'beltRush')!;
  const belt = f.map.silong.belts[rush.data!.belt as 'e' | 'w'];
  assert.ok(rush.shape?.kind === 'line' && belt.some((t) => t[0] === (rush.shape as { from: number[] }).from[0]));
  assert.equal(rush.data?.speed, 5);
  assert.ok(!of(ev, 'boss-move').some((m) => m.move === 'brineFlood'), 'not above 70%');
  const info = f.mobs.mobInfo('boss:makinang-yelo', 16_000)!;
  f.mobs.devWound(info.id, Math.round(info.maxHp * 0.65));
  const flood = of(play(run, 'b3', 16_250, 20_000, PLANT), 'boss-hit').find((h) => h.move === 'brineFlood')!;
  const tiles = new Set((flood.data!.flood as [number, number][]).map((t) => t.join()));
  assert.ok(tiles.size > 100 && tiles.has('40,40') && f.map.silong.belts.e.every((t) => tiles.has(t.join())), 'under the blocks and the belts too');
  for (const [c, r] of f.map.silong.pallets) for (const t of [[c, r], [c + 1, r], [c, r + 1], [c + 1, r + 1]]) assert.ok(!tiles.has(t.join()), `pallet ${t}`);
});

test('Call the Frost at 75%, 50%, 25% (two Frost Scales from the tanks side); its enrage at 25%: five blocks a drop; down = cleared, the frost melts', () => {
  const run = open(silong());
  run.skipTo('b3');
  const f = run.floors.b3;
  play(run, 'b3', 0, 1000, PLANT);
  const info = f.mobs.mobInfo('boss:makinang-yelo', 1000)!;
  f.mobs.devWound(info.id, Math.round(info.maxHp * 0.2));
  assert.ok(f.mobs.attack('t-z', [53, 28], { cls: 'stick', level: 40 }, info.id, 1000).ok, 'in reach from the fan');
  const moves = of(f.mobs.flush(), 'boss-move');
  assert.equal(moves.filter((m) => m.move === 'callTheFrost').length, 3);
  const spots = moves.find((m) => m.move === 'callTheFrost')!.data!.spots as [number, number][];
  assert.ok(spots.length === 2 && spots.every(([c]) => c <= 31), 'the west side');
  assert.ok(moves.some((m) => m.move === 'enrage'));
  const drop = of(play(run, 'b3', 1250, 9000, PLANT), 'boss-hit').find((h) => h.move === 'iceBlockDrop')!;
  assert.equal((drop.data!.blocks as unknown[]).length, 5);
  const out = run.onKill('b3', fell(run, 'b3', 'makinang-yelo', 10_000), 10_000);
  assert.equal(run.phase, 'cleared');
  const rooms = new Set(out.room.filter(([, e]) => e.t === 'boss-move' && e.move === 'melt').map(([r]) => r));
  assert.equal(rooms.size, 3, 'every floor');
  assert.ok(f.bosses.iceBlocks.size === 0 && !f.bosses.flood);
});

// ── Loot (silong.loot) ──

test('loot: a mini boss its pile and a roll a player; the Ice Machine Lv 40 gear, 50,000 Kusing, Polished Whetstones, a key now and then; a practice run Kusing only', () => {
  let n = 0;
  const uid = () => `u${++n}`;
  const run = open(silong());
  const f = run.floors.b1;
  const kill = fell(run, 'b1', 'atsarah', 0);
  const mini = run.lootFor('b1', kill, ['stick'], uid, () => 0.99);
  const pile = L.data.floors[0].rooms.find((r) => r.miniBoss?.id === 'atsarah')!.miniBoss!.kusingPile;
  assert.ok(mini.contents.some((c) => 'kusing' in c && c.kusing === pile), 'its pile');
  assert.ok(mini.contents.some((c) => 'item' in c && c.item.defId === 'polished-whetstone'), 'unlucky: Polished Whetstones');
  void f;
  run.skipToPlant();
  const boss = run.floors.b3.mobs.mobInfo('boss:makinang-yelo', 0)!;
  const last = run.lootFor('b3', { ...kill, id: boss.id, kind: 'makinang-yelo', at: boss.at }, ['stick'], uid, () => 0);
  const items = last.contents.flatMap((c) => ('item' in c ? [c.item] : []));
  assert.ok(last.contents.some((c) => 'kusing' in c && c.kusing === 50_000));
  assert.ok(items.some((i) => i.defId === L.data.key.id), 'a Susi ng Silong (1 in 10)');
  assert.ok(items.filter((i) => L.deps.fightData.defs.get(i.defId) && 'slot' in L.deps.fightData.defs.get(i.defId)!).every((i) => i.level === 40), 'Lv 40 gear');
  assert.ok(!items.some((i) => i.defId.includes('hat')), 'no cosmetic');
  const s = silong();
  const p = s.openPractice('z', 'Z', 40, () => true, 0);
  assert.ok(p.ok);
  const only = p.run.lootFor('b1', fell(p.run, 'b1', 'atsarah', 0), ['stick'], uid, () => 0);
  assert.ok(only.contents.length && only.contents.every((c) => 'kusing' in c), 'Kusing only');
});

// ── Chill (floorRules.chill) ──

/** The run's clock from `from` to `to` (each second) with these inside; every chill change. */
function chillPlay(run: SilongRun, from: number, to: number, who: SilongInside[]): { id: string; stacks: number }[] {
  const out: { id: string; stacks: number }[] = [];
  for (let t = from; t <= to; t += 1000) {
    run.setInside(who, t);
    for (const [, m] of run.step(t, () => true).room) if (m.t === 'chill') out.push({ id: m.id, stacks: m.stacks });
  }
  return out;
}

test('Chill: a stack every 5 s standing still on B2 (up to 4), none on B1, cleared by walking 1 s or a work lamp; a Sinigang or Lugaw: none', () => {
  const run = open(silong());
  run.skipTo('b2');
  const lamp = run.floors.b2.map.silong.lamps[0];
  const far = run.floors.b2.map.silong.arriveMark;
  const still = chillPlay(run, 0, 30_000, [me('a', 'b2', far)]);
  assert.deepEqual(still.map((c) => c.stacks), [1, 2, 3, 4], 'a stack every 5 s, up to 4');
  assert.equal(run.chillOf('a'), 4);
  for (let t = 30_100; t <= 31_300; t += 200) run.stepped('a', t);
  chillPlay(run, 31_400, 31_400, [me('a', 'b2', far)]);
  assert.equal(run.chillOf('a'), 0, 'walked 1 s: gone');
  chillPlay(run, 32_000, 45_000, [me('a', 'b2', far)]);
  assert.ok(run.chillOf('a') > 0);
  chillPlay(run, 46_000, 46_000, [me('a', 'b2', [lamp[0] + 1, lamp[1]])]);
  assert.equal(run.chillOf('a'), 0, 'by a work lamp');
  chillPlay(run, 47_000, 70_000, [{ ...me('a', 'b2', far), immune: true }]);
  assert.equal(run.chillOf('a'), 0, 'a Sinigang or Lugaw on');
  chillPlay(run, 71_000, 90_000, [me('a', 'b1', run.floors.b1.map.silong.arriveMark)]);
  assert.equal(run.chillOf('a'), 0, 'B1 is warm');
});

test("Chill: the Freezer Breath's 2, the Brine Flood's 1 a second; none once the Ice Machine is down", () => {
  const run = open(silong());
  run.skipToPlant();
  const f = run.floors.b3;
  f.bosses.chilled.push(['t-a', 2]);
  chillPlay(run, 0, 0, [me('a', 'b3', [40, 40])]);
  assert.equal(run.chillOf('a'), 2);
  f.bosses.flood = { tiles: new Set(['40,40']), until: 10_000 };
  for (let t = 1000; t <= 2000; t += 1000) {
    run.stepped('a', t - 100);
    chillPlay(run, t, t, [me('a', 'b3', [40, 40])]);
  }
  assert.equal(run.chillOf('a'), 4, 'a stack a second in the brine (walking or not), up to 4');
  run.onKill('b3', fell(run, 'b3', 'makinang-yelo', 3000), 3000);
  chillPlay(run, 4000, 4000, [me('a', 'b3', [40, 40])]);
  assert.equal(run.chillOf('a'), 0, 'the frost melts');
});

test('belts carry the mobs standing on them (2 tiles a second, Belt Rush 5); a step along a belt costs a player nothing', () => {
  const run = open(silong());
  run.skipToPlant();
  const f = run.floors.b3;
  const [c, r] = f.map.silong.belts.e[3];
  f.mobs.addMobs([{ id: 'test-crate', kind: 'frost-scale', zone: 'plant', tile: [c, r], stats: { level: 39, hp: 100, atk: 1, def: 1, xp: 1 } }], 0);
  const moved = f.tick(10, new Map()).filter((e) => e.t === 'mob-move' && e.id === 'test-crate');
  assert.equal(moved.length, 1);
  assert.deepEqual((moved[0] as { path: number[][] }).path.at(-1), [c + 1, r], 'east, a tile');
  assert.equal(f.beltSpeed(10), 2);
  f.bosses.rush = { until: 5000, speed: 5 };
  assert.equal(f.beltSpeed(10), 5);
  assert.ok(f.alongBelt([c, r], [c + 1, r]) && !f.alongBelt([c, r], [c - 1, r]) && !f.alongBelt([c, r - 2], [c + 1, r - 2]));
});
