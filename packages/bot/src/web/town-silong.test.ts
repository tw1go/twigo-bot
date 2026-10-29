import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type PalengkeData, type QuestDef, mobName, palengkeQuests } from '@mikazuki/shared';
import type { MobKill } from './town-mobs.js';
import { loadPalengkeLeveling } from './stats-data.js';
import { Silong, type SilongInside, type SilongRun, loadSilong } from './town-silong.js';
import { silongMobDrops } from './loot.js';

// Ang Silong's runs (classes/dungeons.json silong, maps/silong-b1..b3.json) on the real data: opening (a key, the
// quest, a practice run alone), the floors' mobs and mini bosses, the elevator down opening as a floor's mini bosses
// fall and riding (all in, or 20 s after the first; "Going down?"), riding up, the Ice Tanks door, the close.

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

test('opening: Lv 37, "Now\'s the Time" done, a key; a party\'s for its party; a practice run alone at 40% HP and 35% ATK', () => {
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
  assert.equal(prac.maxHp, Math.round(real.maxHp * 0.4));
  assert.deepEqual(p.run.weaker({ hp: 1000, atk: 100 }), { hp: 400, atk: 35 });
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

test('"Now\'s the Time" (palengke-15): Mang Pido, after the finale, at Lv 37: a talk that gives the Practice Susi ng Silong', () => {
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

test("Delemon: Brine Splash round her (its hit slows 30%), Lid Spin out and back, her jars at 66% and 33%", () => {
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

test("Sangkalancelot: his shell takes half off every hit from his front (never all of it, nor the Chomper's half on top), none for 3 s after a Cleaver Charge; his hooks from 50%", () => {
  const run = open(silong());
  run.skipTo('b2');
  const f = run.floors.b2;
  const at = tileOf(run, 'b2', 'sangkalancelot');
  // He faces whoever he fights: from his front, blocked.
  play(run, 'b2', 0, 1000, { A: near(at, 1) });
  const facing = f.mobs.mobInfo('boss:sangkalancelot', 1000)!;
  const front = near(facing.at, facing.facing === 'se' ? 1 : facing.facing === 'nw' ? -1 : 0, facing.facing === 'sw' ? 1 : facing.facing === 'ne' ? -1 : 0);
  const halved = f.mobs.attack('t-a', front, { cls: 'stick', level: 40 }, 'boss:sangkalancelot', 1100);
  const h = halved.ok ? halved.hits[0] : null;
  assert.ok(h && !h.blocked && h.reduced && h.damage > 0, 'his front: half off, never blocked');
  // (Half, not a quarter: 20 hits from his front come to about half of 20 with his shell open.)
  const sum = (who: string) => Array.from({ length: 20 }, (_, k) => f.mobs.attack(`${who}${k}`, front, { cls: 'stick', level: 40 }, 'boss:sangkalancelot', 1100)).reduce((n, r) => n + (r.ok ? r.hits[0].damage : 0), 0);
  const shut = sum('t-s');
  f.mobs.frontBlock('boss:sangkalancelot', 0.5, Infinity);
  const opened = sum('t-o');
  f.mobs.frontBlock('boss:sangkalancelot', 0.5);
  assert.ok(shut / opened > 0.35 && shut / opened < 0.65, `${shut} of ${opened}`);
  // A Cleaver Charge: open for 3 s after.
  const ev = play(run, 'b2', 2100, 12_000, { A: near(at, 1), B: near(at, 0, 6) });
  const charge = of(ev, 'boss-hit').find((h) => h.move === 'cleaverCharge')!;
  assert.ok(charge && (charge.data?.openMs as number) > 3000);
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

/** Players round the Ice Plant: A and D down-left of its fan, B and C away from it. */
const PLANT: Record<string, [number, number]> = { A: [44, 34], D: [48, 34], B: [30, 30], C: [35, 25] };
/** The Ice Plant's south-west corner (the first drop's blocks fall under whoever stands there). */
const CORNER: Record<string, [number, number]> = { A: [29, 44], B: [33, 44], C: [29, 42], D: [31, 44] };

test('Ang Makinang Yelo: on its body, still, its two Frost Scales by the fan; Ice Block Drop leaves walls for 12 s', () => {
  const run = open(silong());
  run.skipTo('b3');
  const f = run.floors.b3;
  const info = f.mobs.mobInfo('boss:makinang-yelo', 0)!;
  assert.deepEqual(info.at, [44, 22], "its body's middle (the middle of the Ice Plant's north wall)");
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

test('Ice Block Drop: a player a block lands on takes its hit and is shoved out beside it (a boss-pull); one a tile away stays', () => {
  const run = open(silong());
  run.skipTo('b3');
  const f = run.floors.b3;
  // (Four in the corner: three blocks fall under three of them.)
  const ev = play(run, 'b3', 0, 6000, CORNER);
  const drop = of(ev, 'boss-hit').find((h) => h.move === 'iceBlockDrop')!;
  const blocks = new Set((drop.data!.blocks as [number, number][]).map((t) => t.join()));
  assert.equal(blocks.size, 3);
  const under = Object.entries(CORNER).filter(([, t]) => blocks.has(t.join())).map(([id]) => id);
  const aside = Object.keys(CORNER).find((id) => !under.includes(id))!;
  assert.equal(under.length, 3);
  assert.ok(under.every((id) => drop.hits.some((h) => h.id === id)), 'they took its hit: they were under it');
  const pull = of(ev, 'boss-pull').find((p) => p.id === 'boss:makinang-yelo')!;
  assert.ok(pull && pull.ms === 250 && ev.indexOf(pull) > ev.indexOf(drop), 'one boss-pull, right after the hit');
  assert.deepEqual(pull.players.map((p) => p.id).sort(), under.sort(), 'everyone under a block, nobody else');
  assert.ok(!pull.players.some((p) => p.id === aside), `${aside} a tile away stays`);
  for (const p of pull.players) {
    const from = CORNER[p.id];
    assert.ok(Math.max(Math.abs(p.to[0] - from[0]), Math.abs(p.to[1] - from[1])) === 1, `${p.id} beside its block`);
    assert.ok(f.map.blocked[p.to[1]][p.to[0]] === 0 && !blocks.has(p.to.join()), `${p.id} on an open tile`);
  }
  const tos = new Set(pull.players.map((p) => p.to.join()));
  assert.equal(tos.size, pull.players.length, 'each on a tile of their own');
});

test('Cold Vents: every floor tile vents but the 8 round each ice block (its pocket); a player beside a block takes nothing, one two tiles off and one on a belt are hit, 2 Chill', () => {
  const run = open(silong());
  run.skipTo('b3');
  const f = run.floors.b3;
  // (The first drop out of the way in the corner, then two blocks standing in the open: A in a pocket, B two tiles from
  // a block, C on the east belt.)
  play(run, 'b3', 0, 5500, CORNER);
  const mine: [number, number][] = [[36, 27], [52, 24]];
  for (const [c, r] of mine) {
    f.bosses.iceBlocks.set(`${c},${r}`, 60_000);
    f.map.blocked[r][c] = 1;
  }
  const belt = f.map.silong.belts.e.find(([c]) => c === 45)!;
  const who = { A: [37, 28] as [number, number], B: [38, 29] as [number, number], C: belt };
  const ev = play(run, 'b3', 5750, 12_000, who);
  const warn = of(ev, 'boss-move').find((m) => m.move === 'coldVents')!;
  assert.equal(warn.shape?.kind, 'tiles');
  assert.equal(warn.ms, 2500);
  const tiles = new Set((warn.shape as { tiles: [number, number][] }).tiles.map((t) => t.join()));
  const pockets = (warn.data!.pockets as [number, number][]).map((t) => t.join());
  const round = (c: number, r: number) => [-1, 0, 1].flatMap((dr) => [-1, 0, 1].filter((dc) => dc || dr).map((dc) => [c + dc, r + dr] as [number, number])).filter(([x, y]) => !f.map.blocked[y][x]);
  const expected = mine.flatMap(([c, r]) => round(c, r)).map((t) => t.join());
  assert.equal(expected.length, 16, 'both blocks stand in the open');
  for (const t of expected) assert.ok(pockets.includes(t) && !tiles.has(t), `pocket ${t}`);
  for (const t of pockets) assert.ok(!tiles.has(t) && [...f.bosses.iceBlocks.keys()].some((k) => { const [c, r] = k.split(',').map(Number); const [x, y] = t.split(',').map(Number); return Math.max(Math.abs(x - c), Math.abs(y - r)) === 1; }), `${t} beside a block`);
  assert.ok(tiles.size > 700 && tiles.has(belt.join()) && tiles.has('38,29') && !tiles.has('36,27'), 'the room vents, belts too, never a block');
  assert.equal(warn.data?.chill, 2);
  const vent = of(ev, 'boss-hit').find((h) => h.move === 'coldVents')!;
  const hit = new Set(vent.hits.map((h) => h.id));
  assert.ok(!hit.has('A') && hit.has('B') && hit.has('C'), 'A in a pocket, B in the open, C on the belt');
  assert.equal(vent.data?.chill, 2);
  assert.deepEqual((vent.data?.vented as unknown[]).length, tiles.size);
  assert.deepEqual(f.bosses.chilled.filter(([id]) => id === 'B' || id === 'C').map(([, n]) => n), [2, 2]);
});

test("Cold Vents with no ice block standing: two blocks drop first, and it vents 2 s after they land (the drop's own timer untouched)", () => {
  const run = open(silong());
  run.skipTo('b3');
  const f = run.floors.b3;
  // (The first drop lands at 5.2 s; its blocks gone before the vents are due at 7.5 s.)
  play(run, 'b3', 0, 7250, PLANT);
  for (const k of [...f.bosses.iceBlocks.keys()]) {
    const [c, r] = k.split(',').map(Number);
    f.map.blocked[r][c] = 0;
  }
  f.bosses.iceBlocks.clear();
  // (Its other moves come between: the window is long.)
  const ev = play(run, 'b3', 7500, 26_000, PLANT);
  const moves = of(ev, 'boss-move').filter((m) => m.id === 'boss:makinang-yelo');
  const first = moves.find((m) => m.move === 'iceBlockDrop')!;
  assert.equal((first.shape as { tiles: unknown[] }).tiles.length, 2, 'two blocks first');
  const vents = moves.find((m) => m.move === 'coldVents')!;
  assert.ok(vents, 'then the vents');
  const at = (m: { key: string }) => ev.indexOf(ev.find((e) => e.t === 'boss-move' && e.key === m.key)!);
  assert.ok(at(vents) > at(first));
  const landed = of(ev, 'boss-hit').find((h) => h.key === first.key)!;
  assert.ok(landed && (landed.data!.blocks as unknown[]).length === 2);
  assert.ok(ev.indexOf(vents) > ev.indexOf(landed), 'the vents once they stand');
  assert.ok((vents.data!.pockets as unknown[]).length >= 10, 'pockets round the two new blocks');
  // (The regular drop still comes on its own clock: 12 s after the first, three blocks.)
  assert.ok(moves.some((m) => m.move === 'iceBlockDrop' && (m.shape as { tiles: unknown[] }).tiles.length === 3), "the drop's own timer");
});

/** A floor's room ticked with players who move: `at(t)` says where everyone stands at each tick (every 250 ms). */
function playMoving(run: SilongRun, floor: 'b1' | 'b2' | 'b3', from: number, to: number, at: (t: number, sofar: Ev[]) => Record<string, [number, number]>): Ev[] {
  const f = run.floors[floor];
  const out: Ev[] = [];
  for (let t = from; t <= to; t += 250) {
    const players = at(t, out);
    const guards = new Map(Object.keys(players).map((id) => [id, { def: 80, level: 40 }]));
    out.push(...f.mobs.tick(t, new Map(Object.entries(players)), guards), ...f.mobs.flush());
  }
  return out;
}

test("Frost Sweep: bands of 3 rows from the machine's wall covering the room between them, landing in order 0.7 s apart; a player stepping behind a band once it has landed is safe", () => {
  const run = open(silong());
  run.skipTo('b3');
  const f = run.floors.b3;
  const [c0, r0, c1, r1] = f.map.silong.rooms.find((r) => r.id === 'plant')!.rect;
  // (The first drop out of the way in the corner; then P in the third band, Q in the first, both clear of the blocks.)
  play(run, 'b3', 0, 6000, CORNER);
  const open_ = (c: number, r: number) => !f.map.blocked[r][c] && !f.bosses.iceBlocks.has(`${c},${r}`);
  const spot = (row: number): [number, number] => { for (let c = c0; c <= c1; c++) if (open_(c, row)) return [c, row]; throw new Error(`no open tile on row ${row}`); };
  // (P in the third band, Q in the first, each on the first open tile of its row as the ticks go: a block the drops
  // land under them moves them a tile along.)
  let prow = r0 + 7; // band 2 (rows r0+6..r0+8)
  const qrow = r0 + 1; // band 0
  let standable = -1; // (the room's standable tiles as the sweep starts: the blocks standing then are out of it)
  const count = () => { let n = 0; for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (open_(c, r)) n++; return n; };
  let moved = false;
  // An ice block standing through the sweep, in band 1's rows on the room's east side (clear of P's and Q's spots), and R
  // beside it in its pocket: the shelter, as from Cold Vents.
  const brow = r0 + 4;
  let block: [number, number] | null = null;
  for (let c = c1 - 2; c > c0; c--) if (open_(c, brow) && open_(c + 1, brow)) { block = [c, brow]; break; }
  assert.ok(block, 'an open pair of tiles for the block and R');
  f.bosses.iceBlocks.set(`${block![0]},${block![1]}`, Number.MAX_SAFE_INTEGER);
  f.map.blocked[brow][block![0]] = 1;
  const R: [number, number] = [block![0] + 1, brow];
  let pocketOpen = -1; // (the pockets as the sweep starts, the open ones: out of the bands)
  const ev = playMoving(run, 'b3', 6250, 22_000, (_t, sofar) => {
    const first = of(sofar, 'boss-move').find((m) => m.move === 'frostSweep');
    if (standable < 0 && first) {
      standable = count();
      pocketOpen = ((first.data?.pockets as [number, number][] | undefined) ?? []).filter(([c, r]) => open_(c, r)).length;
    }
    // P steps up into band 1 right after band 1 has landed.
    const landed = of(sofar, 'boss-hit').find((h) => h.move === 'frostSweep' && h.data?.band === 1);
    if (landed && !moved) {
      moved = true;
      prow = r0 + 4;
    }
    return { P: spot(prow), Q: spot(qrow), R };
  });
  const bands = of(ev, 'boss-move').filter((m) => m.move === 'frostSweep');
  assert.ok(bands.length >= 9, `${bands.length} bands`);
  assert.equal(bands[0].data?.anim, 'rush');
  assert.ok(bands.every((m, k) => m.data?.band === k && m.data?.of === bands.length && m.key.endsWith(`:${k}`)));
  for (let k = 1; k < bands.length; k++) assert.equal(bands[k].ms - bands[k - 1].ms, 700);
  // Between them every standable tile of the room once but the pockets, none shared.
  const seen = new Map<string, number>();
  for (const m of bands) for (const t of (m.shape as { tiles: [number, number][] }).tiles) seen.set(t.join(), (seen.get(t.join()) ?? 0) + 1);
  assert.ok([...seen.values()].every((n) => n === 1), 'none shared');
  assert.ok(pocketOpen > 0, 'pockets as it started');
  assert.equal(seen.size + pocketOpen, standable, 'the whole room but the pockets');
  // R's tile beside the block: in the first band's pockets, in no band, and R is never hit.
  const pockets = (bands[0].data?.pockets as [number, number][]).map((t) => t.join());
  assert.ok(pockets.includes(R.join()), 'the pocket tile is in the first band\'s data');
  assert.ok(!seen.has(R.join()), 'in no band');
  assert.ok(bands.slice(1).every((m) => m.data?.pockets === undefined), 'the pockets ride on the first band only');
  const rowsOf = (m: (typeof bands)[number]) => new Set((m.shape as { tiles: [number, number][] }).tiles.map((t) => t[1]));
  assert.ok([...rowsOf(bands[0])].every((r) => r < r0 + 3) && [...rowsOf(bands[bands.length - 1])].every((r) => r >= r0 + 3 * (bands.length - 1)), 'from the north wall down, the last taking what is left');
  // They land in order, 0.7 s apart.
  const hits = of(ev, 'boss-hit').filter((h) => h.move === 'frostSweep');
  assert.equal(hits.length, bands.length);
  assert.ok(hits.every((h, k) => h.key === bands[k].key));
  assert.ok(hits.find((h) => h.data?.band === 0)!.hits.some((h) => h.id === 'Q'), 'Q in the first band, hit once');
  assert.equal(hits.filter((h) => h.hits.some((x) => x.id === 'Q')).length, 1);
  assert.ok(hits.filter((h) => h.hits.some((x) => x.id === 'P')).length <= 1, 'P stepped behind band 1 after it landed: a hit at most');
  assert.ok(hits.every((h) => !h.hits.some((x) => x.id === 'R')), 'R in the pocket beside the block: never hit');
  assert.ok(moved);
});

test('Icicle Chase: three icicles on where each player stands, one after another; a player who keeps walking is never hit, one who stands still is hit three times', () => {
  const run = open(silong());
  run.skipTo('b3');
  const f = run.floors.b3;
  play(run, 'b3', 0, 5500, CORNER);
  const S: [number, number] = [40, 40];
  let M: [number, number] = [50, 40];
  let n = 0;
  const walk = (): [number, number] => {
    n++;
    const c = 46 + (n % 12); // (along row 40, a tile a tick, round again every 3 s)
    return f.map.blocked[40][c] ? M : [c, 40];
  };
  const ev = playMoving(run, 'b3', 5750, 12_000, () => ({ S, M: (M = walk()) }));
  const circles = of(ev, 'boss-move').filter((m) => m.move === 'icicleChase');
  const forS = circles.filter((m) => m.data?.player === 'S');
  const forM = circles.filter((m) => m.data?.player === 'M');
  assert.equal(forS.length, 3);
  assert.equal(forM.length, 3);
  assert.ok(circles.every((m) => m.shape?.kind === 'circle' && m.shape.radius === 1 && m.ms === 900));
  assert.equal(circles.filter((m) => m.data?.anim === 'drop').length, 1, 'the pose on the first only');
  assert.ok(forS.every((m) => (m.shape as { at: number[] }).at.join() === S.join()), 'on the still player, every time');
  const ats = forM.map((m) => (m.shape as { at: number[] }).at.join());
  assert.equal(new Set(ats).size, 3, 'the circles follow the walker');
  const hits = of(ev, 'boss-hit').filter((h) => h.move === 'icicleChase');
  assert.equal(hits.filter((h) => h.hits.some((x) => x.id === 'S')).length, 3, 'standing still: hit three times');
  assert.equal(hits.filter((h) => h.hits.some((x) => x.id === 'M')).length, 0, 'walking: never');
});

test('Intake (from 90%): five pulls a tile toward the fan, a boss-pull each, then the Fist Slam on radius 3; an ice block on the line holds you; walking out as fast as it pulls keeps you clear', () => {
  const run = open(silong());
  run.skipTo('b3');
  const f = run.floors.b3;
  const fan = f.map.silong.bossTile!;
  const info = f.mobs.mobInfo('boss:makinang-yelo', 0)!;
  f.mobs.devWound(info.id, Math.round(info.maxHp * 0.85));
  // Parked in the room's far corner while its other moves take their turns; as Intake starts, placed for it: A six
  // tiles straight out from the fan in the open, S with an ice block on the line between it and the fan, W eight
  // tiles off, stepping a tile farther out after every pull. Every boss-pull moves them as the server would.
  const pos: Record<string, [number, number]> = { A: [57, 43], S: [59, 43], W: [57, 41] };
  const dist = (t: [number, number]) => Math.max(Math.abs(t[0] - fan[0]), Math.abs(t[1] - fan[1]));
  let seen = 0;
  let placed = false;
  let pulledW = false;
  let nearest = Infinity;
  const ev = playMoving(run, 'b3', 0, 40_000, (_t, sofar) => {
    for (; seen < sofar.length; seen++) {
      const e = sofar[seen];
      if (e.t === 'boss-pull') for (const mv of e.players) {
        pos[mv.id] = mv.to;
        if (mv.id === 'W' && placed) pulledW = true;
      }
      if (e.t === 'boss-move' && e.move === 'intake' && !placed) {
        placed = true;
        pos.A = [fan[0], fan[1] + 6];
        pos.S = [fan[0] + 6, fan[1] + 6];
        f.bosses.iceBlocks.set(`${fan[0] + 3},${fan[1] + 3}`, 60_000);
        f.map.blocked[fan[1] + 3][fan[0] + 3] = 1;
        pos.W = [fan[0] - 8, fan[1] + 8];
      }
    }
    if (pulledW) {
      pulledW = false;
      pos.W = [pos.W[0], pos.W[1] + 1]; // (a tile out again)
    }
    if (placed) nearest = Math.min(nearest, dist(pos.W));
    return { ...pos };
  });
  const move = of(ev, 'boss-move').find((m) => m.move === 'intake')!;
  assert.ok(move, 'Intake came');
  assert.deepEqual(move.shape, { kind: 'circle', at: fan, radius: 3 });
  assert.equal(move.ms, 2500);
  assert.deepEqual(move.data, { anim: 'call', pulls: 5, stepMs: 500 });
  const i0 = ev.indexOf(move);
  const slam = of(ev, 'boss-hit').find((h) => h.move === 'intake')!;
  assert.ok(slam && slam.data?.slam === true, 'then the slam');
  const pulls = ev.slice(i0, ev.indexOf(slam)).filter((e): e is Extract<Ev, { t: 'boss-pull' }> => e.t === 'boss-pull' && e.ms === 400);
  assert.equal(pulls.length, 5, 'five pulls between');
  assert.ok(pulls.every((p) => p.players.some((x) => x.id === 'A')), 'A drawn in by every pull');
  assert.ok(dist(pos.A) >= 1 && dist(pos.A) <= 2, `A ends ${dist(pos.A)} from the fan`);
  assert.ok(slam.hits.some((h) => h.id === 'A'), 'A under the slam');
  assert.ok(!pulls.some((p) => p.players.some((x) => x.id === 'S')), 'S behind the ice never moves');
  assert.ok(!slam.hits.some((h) => h.id === 'S'));
  assert.ok(nearest > 3, `W never within 3 (${nearest})`);
  assert.ok(!slam.hits.some((h) => h.id === 'W'));
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
  const flood = of(play(run, 'b3', 16_250, 50_000, PLANT), 'boss-hit').find((h) => h.move === 'brineFlood')!; // (its other moves take their turns first)
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
  assert.ok(f.mobs.attack('t-z', [44, 28], { cls: 'stick', level: 40 }, info.id, 1000).ok, 'in reach from the fan');
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

test('loot: a mini boss its pile and a roll a player; the Ice Machine Lv 40 gear, 50,000 Kusing, Polished Whetstones, a key now and then; a practice run the same with half its Kusing', () => {
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
  const prac = p.run.lootFor('b1', fell(p.run, 'b1', 'atsarah', 0), ['stick'], uid, () => 0);
  assert.ok(prac.contents.some((c) => 'item' in c && 'slot' in (L.deps.fightData.defs.get(c.item.defId) ?? {})), 'gear too');
  assert.ok(prac.contents.some((c) => 'kusing' in c && c.kusing === Math.round(pile / 2)), 'half its pile');
  assert.ok(items.some((i) => 'slot' in (L.deps.fightData.defs.get(i.defId) ?? {})), 'the Ice Machine drops gear');
});

test("a real run needs a practice run cleared: the hatch says so, opening and joining refuse; a practice run still opens", () => {
  const s = silong();
  const no = { done: true, practiceKeys: 1, practiced: false };
  const g = s.gate('a', 40, 1, no);
  assert.equal(g.blocked, 'practice');
  assert.match(g.questLine ?? '', /practice run first/);
  assert.ok(g.practice && !g.practice.blocked, 'the practice run on offer');
  const o = s.open('a', 'A', 40, () => true, 0, no);
  assert.ok(!o.ok && o.reason === 'practice');
  const run = open(s, 'b');
  const j = s.join('c', 40, run.id, no);
  assert.ok(!j.ok && j.reason === 'practice', 'nor join a party run');
  assert.ok(s.openPractice('a', 'A', 40, () => true, 0).ok);
  assert.ok(s.open('d', 'D', 40, () => true, 0, { ...no, practiced: true }).ok, 'practiced: in');
});

test("the Cellar's room mobs: a Lv 40 gear piece at silong.loot.mobGearChance (12%), never the Old Market's 3% on top", () => {
  let n = 0;
  const uid = () => `u${++n}`;
  const data = L.deps.fightData;
  const gear = (r: number) => silongMobDrops(data, L.data, 'garapon-jars', 39, 1000, () => r, uid).filter((c) => 'item' in c && 'slot' in (data.defs.get(c.item.defId) ?? {}));
  assert.equal(L.data.loot.mobGearChance, 0.12);
  const hit = gear(0.1);
  assert.equal(hit.length, 1);
  assert.ok(hit.every((c) => 'item' in c && c.item.level === 40));
  assert.equal(gear(0.2).length, 0, 'over 12%: none');
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

test("Chill: the Cold Vents' 2, the Brine Flood's 1 a second; none once the Ice Machine is down", () => {
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
