import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import type { Target, TelegraphShape, TownServerMessage } from '@mikazuki/shared';
import { type SavedProgress, freshProgress, killXp } from './progress.js';
import { loadDungeons, loadItemData, loadStats } from './stats-data.js';
import { type MobEvent, type MobKill, MobRoom, loadMobKinds, loadMobMap } from './town-mobs.js';
import { type Inside, type RunDeps, Run, Warrens, inShape, loadWarrensMap } from './town-warrens.js';
import { attachTown, loadTownMap } from './town.js';

const W = loadDungeons().warrens;
const map = loadWarrensMap();
const deps = (random = () => 0.5): RunDeps => ({ kinds: loadMobKinds(), levels: {}, shapes: { shapes: {} }, fightData: loadItemData(), leveling: null, slamMs: 500, random });
const area = (id: string) => map.dungeon.areas.find((a) => a.id === id)!;
const guard: Target = { def: 10, level: 18 };
const guards = (...ids: string[]) => new Map(ids.map((id) => [id, guard]));
const me = (member: string, at: [number, number], out = false): Inside => ({ member, id: `t-${member}`, at, out });
/** A run that has started (one player, `a`, in the start room). */
function started(now = 0, random = () => 0.5): Run {
  const run = new Run('r1', W, map, deps(random), { member: 'a', name: 'Ana' }, null, now);
  run.setInside([me('a', map.arrive.slums)], now);
  run.step(now, () => true);
  assert.equal(run.phase, 'running');
  return run;
}
/** Sets a mob's HP (the room keeps it private). */
const setHp = (run: Run, id: string, hp: number) => {
  (run.mobs as unknown as { byId: Map<string, { hp: number }> }).byId.get(id)!.hp = hp;
};
const of = <T extends MobEvent['t']>(events: MobEvent[], t: T) => events.filter((e): e is Extract<MobEvent, { t: T }> => e.t === t);

test('opening: Lv 15, a ticket, one run per party, at most ten at once', () => {
  const parties: Record<string, string> = { b: 'p1', c: 'p1' };
  const w = new Warrens(W, map, deps(), (m) => parties[m] ?? null);
  let used = 0;
  const ticket = () => (used++, true);
  assert.deepEqual(w.open('a', 'Ana', 14, ticket, 0), { ok: false, reason: 'level', message: 'The Scrap Warrens are for Lv 15 and up.' });
  assert.equal(w.open('a', 'Ana', 15, () => false, 0).ok, false);
  assert.equal(used, 0);
  const solo = w.open('a', 'Ana', 15, ticket, 0);
  assert.ok(solo.ok);
  assert.equal(solo.run.party, null);
  assert.equal(w.open('a', 'Ana', 15, ticket, 0).ok, false, 'one at a time');
  const party = w.open('b', 'Ben', 16, ticket, 0);
  assert.ok(party.ok);
  assert.equal(w.open('c', 'Cy', 16, ticket, 0).ok, false, "the party's run is open: join it");
  assert.equal(used, 2);
  // Joining needs no ticket; a party member's run, not someone else's.
  assert.ok(w.join('c', 15).ok);
  assert.ok(party.run.expected.has('c'));
  assert.equal(w.join('a', 15, party.run.id).ok, false);
  assert.equal(w.join('c', 12).ok, false);
  assert.ok(w.allowed(solo.run, 'a') && !w.allowed(solo.run, 'b'));
  for (let k = 0; k < 8; k++) assert.ok(w.open(`x${k}`, 'X', 20, ticket, 0).ok);
  const full = w.open('y', 'Yo', 20, ticket, 0);
  assert.equal(full.ok, false);
  assert.equal(!full.ok && full.reason, 'full');
  assert.equal(used, 10, 'no ticket used when full');
  assert.equal(w.gate('y', 20, 1).blocked, 'full');
  assert.equal(w.gate('c', 20, 0).partyRun?.id, party.run.id);
  assert.equal(w.gate('c', 20, 0).blocked, undefined, 'joining needs no ticket');
});

test('gathering: sealed and still until everyone it waits for is in, the wait is up, or the opener starts it', () => {
  const seal = map.dungeon.seal[0];
  const run = new Run('g', W, map, deps(), { member: 'a', name: 'Ana' }, 'p', 0);
  run.expected.add('b');
  assert.equal(run.map.blocked[seal[1]][seal[0]], 1);
  assert.equal(map.blocked[seal[1]][seal[0]], 0, "the map's own copy is untouched");
  run.setInside([me('a', map.arrive.slums)], 1000);
  run.step(1000, () => true);
  assert.equal(run.phase, 'gathering');
  assert.deepEqual(run.view(1000, 'a', (m) => m.toUpperCase()).waiting, ['B']);
  assert.equal(run.requestStart('b'), false);
  assert.ok(run.requestStart('a'));
  const news = run.step(1100, () => true);
  assert.equal(run.phase, 'running');
  assert.equal(run.map.blocked[seal[1]][seal[0]], 0);
  assert.ok(news.room.some((m) => m.t === 'system'));
  assert.equal(run.endsAt, 1100 + 20 * 60_000);

  const late = new Run('h', W, map, deps(), { member: 'a', name: 'Ana' }, 'p', 0);
  late.expected.add('b');
  late.setInside([me('a', map.arrive.slums)], 0);
  late.step(59_000, () => true);
  assert.equal(late.phase, 'gathering');
  late.step(60_000, () => true);
  assert.equal(late.phase, 'running', 'at most 60 s');

  const all = new Run('i', W, map, deps(), { member: 'a', name: 'Ana' }, 'p', 0);
  all.expected.add('b');
  all.setInside([me('a', map.arrive.slums), me('b', map.arrive.slums)], 0);
  all.step(0, () => true);
  assert.equal(all.phase, 'running');
});

test('gathering waits for party members invited until they answer or the invite lapses; Not now stops waiting', () => {
  const run = new Run('w', W, map, deps(), { member: 'a', name: 'Ana' }, 'p', 0);
  run.invite('b', 20_000);
  run.invite('c', 20_000);
  run.setInside([me('a', map.arrive.slums)], 0);
  run.step(1000, () => true);
  assert.equal(run.phase, 'gathering');
  assert.deepEqual(run.view(1000, 'a').waiting, ['b', 'c']);
  run.answer('c', false);
  run.answer('b', true); // (b joined: waited for past the invite's end, until they're in or the minute's up)
  run.step(25_000, () => true);
  assert.equal(run.phase, 'gathering');
  assert.deepEqual(run.view(25_000, 'a').waiting, ['b']);
  run.setInside([me('a', map.arrive.slums), me('b', map.arrive.slums)], 26_000);
  run.step(26_000, () => true);
  assert.equal(run.phase, 'running');
  // An invite nobody answers: it starts once it lapses.
  const lapse = new Run('x', W, map, deps(), { member: 'a', name: 'Ana' }, 'p', 0);
  lapse.invite('b', 20_000);
  lapse.setInside([me('a', map.arrive.slums)], 0);
  lapse.step(19_000, () => true);
  assert.equal(lapse.phase, 'gathering');
  lapse.step(20_000, () => true);
  assert.equal(lapse.phase, 'running');
});

test('bosses: five mini bosses with two guards each, Barong-Barong still in its corner with two Scraplings', () => {
  const run = started();
  const snap = run.mobs.snapshot(0);
  for (const a of W.areas) {
    const boss = snap.find((m) => m.id === `boss:${a.miniBoss.id}`);
    assert.ok(boss, a.miniBoss.id);
    assert.equal(boss.boss, 'mini');
    assert.equal(boss.maxHp, a.miniBoss.hp);
    assert.equal(boss.scale, 2.5);
    assert.equal(snap.filter((m) => m.id.startsWith(`guard:${a.miniBoss.id}:`)).length, 2);
  }
  const king = snap.find((m) => m.id === 'boss:barong-barong')!;
  assert.deepEqual([king.col, king.row], map.dungeon.boss.tile); // (the map's: below the gap)
  assert.equal(king.boss, 'last');
  assert.equal(king.title, 'the Shanty Titan');
  assert.equal(snap.filter((m) => m.id.startsWith('guard:barong-barong:')).length, 2);
});

test("the map: the bottom half (Barong-Barong's hall) is far below the start room, down the tunnel from Bag Hollow", () => {
  const hall = area('king');
  assert.ok(hall.rect[1] - map.arrive.slums[1] >= 50, `${hall.rect[1]}`);
  assert.ok(map.dungeon.boss.tile[1] > hall.rect[1] && map.blocked[map.dungeon.boss.tile[1]][map.dungeon.boss.tile[0]] === 1, 'its body is blocked');
  // Bag Hollow's shutter opens onto the tunnel: open floor down to Live Coils.
  const s = map.dungeon.shutters.find((x) => x.area === 'bag')!;
  const [c] = s.passage[0];
  const below = Math.max(...s.passage.map((t) => t[1])) + 1;
  for (let r = below; r < area('wire').checkpoint[1]; r++) assert.equal(map.blocked[r][c], 0, `${c},${r}`);
});

test('a mini boss down opens its shutter for good and moves the checkpoint on', () => {
  const run = started();
  const shutter = map.dungeon.shutters.find((s) => s.area === 'tin')!;
  const [c, r] = shutter.passage[0];
  assert.equal(run.map.blocked[r][c], 1);
  assert.deepEqual(run.checkpoint(), area('tin').checkpoint);
  const kill: MobKill = { id: 'boss:celes-tin', kind: 'tin-can', at: area('tin').bossTile, level: 16, xp: 0, to: ['a'], warrens: { id: 'celes-tin', boss: 'mini' } };
  const news = run.onKill(kill, 5000);
  assert.equal(run.map.blocked[r][c], 0);
  assert.deepEqual(run.checkpoint(), area('tire').checkpoint);
  assert.ok(run.opened.has('tin'));
  const line = news.room.find((m) => m.t === 'system') as { line: { text: string } };
  assert.equal(line.line.text, 'Celes Tin is down. The way to Skid Row is open.');
  assert.equal(run.onKill(kill, 6000).room.length, 0, 'once');
  // Someone coming in for the first time lands in the start room; again later, at the checkpoint.
  assert.deepEqual(run.arrivalFor('z'), map.arrive.slums);
  assert.deepEqual(run.arrivalFor('a'), area('tire').checkpoint);
});

test('Barong-Barong down: cleared, its Scraplings fall apart, closed 3 minutes later with everyone sent out', () => {
  const run = started();
  const news = run.onKill({ id: 'boss:barong-barong', kind: 'barong-barong', at: [8, 40], level: 20, xp: 0, to: ['a'], warrens: { id: 'barong-barong', boss: 'last' } }, 10_000);
  assert.equal(run.phase, 'cleared');
  assert.ok(news.room.some((m) => m.t === 'mob-remove'));
  assert.ok(!run.mobs.snapshot(10_000).some((m) => m.id.startsWith('guard:barong-barong')));
  assert.equal(run.step(10_000 + 179_000, () => true).closed, undefined);
  const end = run.step(10_000 + 180_000, () => true);
  assert.ok(end.closed);
  assert.deepEqual(end.out, [{ member: 'a', reason: 'closed' }]);
});

test('the clock: a minute’s warning, closed at the time limit; closed after 2 minutes empty', () => {
  const run = started();
  const warn = run.step(run.endsAt - 60_000, () => true);
  assert.match((warn.room.find((m) => m.t === 'system') as { line: { text: string } }).line.text, /One minute left/);
  assert.ok(run.step(run.endsAt, () => true).closed);

  const empty = started();
  empty.setInside([], 1000);
  assert.equal(empty.step(120_000, () => true).closed, undefined);
  assert.ok(empty.step(121_000, () => true).closed);
});

test('leaving the party while inside: a 10 s warning, then out', () => {
  const run = started();
  const first = run.step(1000, () => false);
  assert.deepEqual(first.to, [['a', { t: 'warrens-kick', ms: 10_000 }]]);
  assert.deepEqual(run.step(10_000, () => false).out, []);
  assert.deepEqual(run.step(11_000, () => false).out, [{ member: 'a', reason: 'party' }]);
  // Back in the party in time: no kick.
  const back = started();
  back.step(1000, () => false);
  back.step(5000, () => true);
  assert.deepEqual(back.step(12_000, () => false).out, [], 'a fresh 10 s');
});

test('a party, once over, keeps whoever was in it; a solo run stays solo', () => {
  let party: string | null = 'p';
  const w = new Warrens(W, map, deps(), () => party);
  const opened = w.open('a', 'Ana', 15, () => true, 0);
  assert.ok(opened.ok);
  assert.ok(w.allowed(opened.run, 'a'));
  party = null;
  assert.ok(w.allowed(opened.run, 'a'), 'the party ended: kicks nobody');
  assert.ok(!w.allowed(opened.run, 'stranger'));
});

test('party scaling: HP by the players inside, its share kept', () => {
  const run = started();
  setHp(run, 'boss:celes-tin', W.areas[0].miniBoss.hp / 2);
  run.setInside([me('a', map.arrive.slums), me('b', map.arrive.slums)], 1000);
  const news = run.step(1000, () => true);
  const scale = news.room.find((m) => m.t === 'mob-scale') as { mobs: { id: string; hp: number; maxHp: number }[] };
  const boss = scale.mobs.find((m) => m.id === 'boss:celes-tin')!;
  assert.equal(boss.maxHp, Math.round(W.areas[0].miniBoss.hp * 1.6));
  assert.equal(boss.hp, Math.round(boss.maxHp / 2));
  const mob = scale.mobs.find((m) => m.id.startsWith('guard:celes-tin'))!;
  assert.equal(mob.maxHp, Math.round(W.areas[0].mobs.hp * 1.4));
});

test("Lid Slam: a circle round it, then hits whoever's still in it when it lands", () => {
  const run = started();
  const tin = area('tin');
  const inside: [number, number] = [tin.bossTile[0] + 1, tin.bossTile[1]];
  const players = new Map<string, [number, number]>([['t-a', inside], ['t-b', inside]]);
  run.setInside([me('a', inside), me('b', inside)], 1000);
  run.step(1000, () => true);
  const start = of(run.mobs.tick(5000, players, guards('t-a', 't-b')), 'boss-move').find((e) => e.move === 'lidSlam');
  assert.ok(start, 'half its interval in');
  assert.equal(start.ms, 1200);
  const shape = start.shape as Extract<TelegraphShape, { kind: 'circle' }>;
  assert.equal(shape.radius, 2);
  // b steps out of it.
  players.set('t-b', [shape.at[0] + 4, shape.at[1]]);
  const hit = of(run.mobs.tick(6200, players, guards('t-a', 't-b')), 'boss-hit').find((e) => e.move === 'lidSlam')!;
  assert.deepEqual(hit.hits.map((h) => h.id), ['t-a']);
  assert.equal(hit.key, start.key);
  assert.ok(run.mobs.landed(6200).some((l) => l.player === 't-a'));
});

test('thresholds: Celes Tin calls Tin Cans at 66% and 33% (once each); they vanish when it resets', () => {
  const run = started();
  const tin = area('tin');
  const hp = W.areas[0].miniBoss.hp;
  setHp(run, 'boss:celes-tin', Math.floor(hp * 0.6));
  const call = of(run.hurt('boss:celes-tin', 1000), 'boss-move');
  assert.equal(call.length, 1, '66% only');
  assert.equal(call[0].move, 'call');
  const spots = (call[0].data as { spots: [number, number][] }).spots;
  assert.equal(spots.length, 3);
  for (const s of spots) assert.ok(tin.arenaTiles.some((t) => t[0] === s[0] && t[1] === s[1]));
  assert.equal(of(run.hurt('boss:celes-tin', 1100), 'boss-move').length, 0);
  // They appear as the call lands.
  const added = of(run.mobs.tick(1700, new Map(), new Map()), 'mob-add');
  assert.equal(added[0]?.mobs.length, 3);
  assert.equal(run.mobs.calledBy('boss:celes-tin').length, 3);
  // Nobody in its arena for 10 s: full HP, its called mobs gone, its guards still there.
  run.setInside([me('a', tin.bossTile)], 2000);
  run.step(2000, () => true);
  run.setInside([me('a', map.arrive.slums)], 3000);
  run.step(11_000, () => true);
  const reset = run.step(12_000, () => true);
  assert.ok(reset.room.some((m) => m.t === 'mob-heal'));
  assert.ok(reset.room.some((m) => m.t === 'mob-remove'));
  assert.equal(run.mobs.mobInfo('boss:celes-tin', 12_000)!.hp, run.mobs.mobInfo('boss:celes-tin', 12_000)!.maxHp);
  assert.equal(run.mobs.snapshot(12_000).filter((m) => m.id.startsWith('guard:celes-tin')).length, 2);
  // Re-armed: 66% calls again.
  setHp(run, 'boss:celes-tin', Math.floor(hp * 0.6));
  assert.equal(of(run.hurt('boss:celes-tin', 13_000), 'boss-move').length, 1);
});

test("Bag Yani's Vanish: untargetable for 4 s, Bag Spooks about, back on an arena tile", () => {
  const run = started();
  setHp(run, 'boss:bag-yani', Math.floor(W.areas[2].miniBoss.hp * 0.55));
  const events = run.hurt('boss:bag-yani', 1000);
  assert.ok(of(events, 'mob-flag').some((e) => e.untargetable));
  const moves = of(events, 'boss-move').map((e) => e.move);
  assert.deepEqual(moves, ['vanish', 'vanishCall']);
  const back = run.mobs.tick(5000, new Map(), new Map());
  assert.ok(of(back, 'mob-flag').some((e) => e.untargetable === false));
  assert.ok(of(back, 'mob-spawn').some((e) => e.id === 'boss:bag-yani'));
  assert.equal(run.mobs.calledBy('boss:bag-yani').length, 4);
});

test("Crab Tain's Hunker blocks every hit for 5 s; Barong-Barong's Shanty Call and enrage", () => {
  const run = started();
  setHp(run, 'boss:crab-tain', Math.floor(W.areas[4].miniBoss.hp * 0.5));
  const hunker = run.hurt('boss:crab-tain', 1000);
  assert.ok(of(hunker, 'mob-flag').some((e) => e.blockAll));
  assert.ok(of(run.mobs.tick(6000, new Map(), new Map()), 'mob-flag').some((e) => e.id === 'boss:crab-tain' && e.blockAll === false));

  setHp(run, 'boss:barong-barong', Math.floor(W.lastBoss.hp * 0.2));
  const all = of(run.hurt('boss:barong-barong', 7000), 'boss-move').map((e) => e.move);
  assert.deepEqual(all, ['shantyCall', 'shantyCall', 'shantyCall', 'enrage']);
});

test("Burnout Charge: a line at the farthest player, stopped by walls; it rolls down it and hits who's on it", () => {
  const run = started();
  const tire = area('tire');
  const near: [number, number] = [tire.bossTile[0] + 1, tire.bossTile[1]];
  const far: [number, number] = [tire.bossTile[0] - 4, tire.bossTile[1]];
  const players = new Map<string, [number, number]>([['t-a', near], ['t-b', far]]);
  run.setInside([me('a', near), me('b', far)], 1000);
  run.step(1000, () => true);
  const start = of(run.mobs.tick(6000, players, guards('t-a', 't-b')), 'boss-move').find((e) => e.move === 'burnoutCharge')!;
  assert.ok(start);
  const shape = start.shape as Extract<TelegraphShape, { kind: 'line' }>;
  const path = (start.data as { path: [number, number][] }).path;
  assert.ok(path.length >= 1 && path.length <= 8);
  for (const t of path) assert.equal(run.map.blocked[t[1]][t[0]], 0);
  assert.ok(Math.atan2(shape.to[1] - shape.from[1], shape.to[0] - shape.from[0]) !== 0 || shape.to[0] < shape.from[0], 'toward the far player');
  const done = run.mobs.tick(7000, players, guards('t-a', 't-b'));
  assert.ok(of(done, 'mob-move').some((e) => e.id === 'boss:tire-ranny'));
  assert.ok(of(done, 'boss-hit').some((e) => e.move === 'burnoutCharge'));
});

test('Wire Wolf: Chain Zap jumps between players close together; Live Floor stuns', () => {
  const run = started();
  const wire = area('wire');
  const [c, r] = wire.bossTile;
  const players = new Map<string, [number, number]>([['t-a', [c + 1, r]], ['t-b', [c + 2, r + 1]], ['t-c', [c + 3, r + 2]]]);
  run.setInside([me('a', [c + 1, r]), me('b', [c + 2, r + 1]), me('c', [c + 3, r + 2])], 1000);
  run.step(1000, () => true);
  const zap = of(run.mobs.tick(4000, players, guards('t-a', 't-b', 't-c')), 'boss-move').find((e) => e.move === 'chainZap')!;
  assert.ok(zap);
  assert.equal((zap.data as { chain: string[] }).chain.length, 3);
  const hits = of(run.mobs.tick(5000, players, guards('t-a', 't-b', 't-c')), 'boss-hit').find((e) => e.move === 'chainZap')!;
  assert.equal(hits.hits.length, 3);
  const floor = of(run.mobs.tick(8500, players, guards('t-a', 't-b', 't-c')), 'boss-move').find((e) => e.move === 'liveFloor')!;
  const tiles = (floor.shape as Extract<TelegraphShape, { kind: 'tiles' }>).tiles;
  assert.equal(tiles.length, 6);
  assert.equal((floor.shape as { colour?: string }).colour, 'yellow');
  run.mobs.tick(10_000, players, guards('t-a', 't-b', 't-c'));
  const stunned = run.mobs.landed(10_000).filter((l) => l.stun);
  assert.ok(stunned.every((l) => l.stun === 500));
});

test('shapes: circles, cones (the angle and length), tiles', () => {
  assert.ok(inShape({ kind: 'circle', at: [10, 10], radius: 2 }, [12, 10]));
  assert.ok(!inShape({ kind: 'circle', at: [10, 10], radius: 2 }, [12, 12]));
  const cone: TelegraphShape = { kind: 'cone', origin: [0, 0], facing: 0, angle: 90, length: 3 };
  assert.ok(inShape(cone, [3, 0]));
  assert.ok(inShape(cone, [2, 2]));
  assert.ok(!inShape(cone, [0, 3]));
  assert.ok(!inShape(cone, [4, 0]));
  assert.ok(!inShape(cone, [-2, 0]));
  assert.ok(inShape({ kind: 'tiles', tiles: [[1, 2]] }, [1, 2]));
});

test('loot: a mini boss leaves its Kusing pile and a roll a player; Barong-Barong a heap for each player', () => {
  const run = started(0, Math.random);
  let n = 0;
  const uid = () => `u${n++}`;
  const mini = run.lootFor({ id: 'boss:celes-tin', kind: 'tin-can', at: [23, 8], level: 16, xp: 0, to: ['a'] }, ['slingshot'], uid, Math.random);
  assert.ok(mini.contents.some((c) => 'kusing' in c && c.kusing === W.areas[0].miniBoss.kusingPile));
  const last = run.lootFor({ id: 'boss:barong-barong', kind: 'barong-barong', at: [8, 40], level: 20, xp: 0, to: ['a'] }, ['slingshot'], uid, Math.random);
  assert.ok(last.contents.some((c) => 'kusing' in c && c.kusing === 10_000));
  const [b0, b1, b2, b3] = map.dungeon.boss.body;
  assert.ok(!(last.at[0] >= b0 && last.at[0] <= b2 && last.at[1] >= b1 && last.at[1] <= b3), 'never on its body');
  const mob = run.lootFor({ id: 'tin:0:0', kind: 'tin-can', at: [10, 10], level: 15, xp: 0, to: ['a'] }, ['slingshot'], uid, () => 0.99);
  assert.ok(mob.contents.length >= 1);
});

// ── Over the town's socket ──

type Msg = TownServerMessage;
const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
/** Waits (2 s at most) for a client to have heard a message of type `t`. */
const heard = async (c: { last: (t: never) => unknown }, t: string) => {
  for (let k = 0; k < 80 && !c.last(t as never); k++) await wait(25);
};
async function town(opts: { tickets: Record<string, number>; party?: boolean; level?: Record<string, number>; kill?: (name: string, mob: { level: number; xp: number }) => void }) {
  const stats = loadStats();
  const slums = loadMobMap('slums');
  const saved: { id: string; opener: string; cleared: boolean }[][] = [];
  const progress: Record<string, SavedProgress> = {};
  const server = createServer();
  attachTown(server, {
    map: { size: [4, 4], spawn: [1, 1], blocked: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
    rooms: { slums: () => loadTownMap('slums') },
    mobs: { slums: new MobRoom(slums, () => 0.5, {}, { shapes: {} }, loadMobKinds()) },
    authenticate: async (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('as'),
    profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} as never, cls: 'slingshot' }),
    progress: {
      fighter: (name) => ({ cls: 'slingshot', level: opts.level?.[name] ?? 15, points: name === 'Mara' ? { DEX: 100_000 } : {} }),
      kill: (name, mob) => {
        opts.kill?.(name, mob);
        const r = killXp(stats, 'slingshot', progress[name] ?? freshProgress(stats, 'slingshot'), mob);
        progress[name] = r.progress;
        return r;
      },
    },
    warrens: {
      data: W, map, deps: deps(), gate: W.entry.warp.tile,
      tickets: { count: (u) => opts.tickets[u] ?? 0, use: (u) => (opts.tickets[u] ?? 0) > 0 && !!(opts.tickets[u]--, true) },
      saved: (runs) => saved.push(runs),
    },
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  const open = (as: string, room: string) =>
    new Promise<{ ws: WebSocket; got: Msg[]; closed: () => boolean; send: (m: object) => void; id: () => string; last: <T extends Msg['t']>(t: T) => Extract<Msg, { t: T }> | undefined }>((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?as=${as}&room=${room}`);
      const got: Msg[] = [];
      let shut = false;
      ws.on('message', (d) => got.push(JSON.parse(String(d))));
      ws.on('close', () => (shut = true));
      const c = {
        ws, got, closed: () => shut, send: (m: object) => ws.send(JSON.stringify(m)),
        id: () => (got.find((m) => m.t === 'welcome') as Extract<Msg, { t: 'welcome' }>).you,
        last: <T extends Msg['t']>(t: T) => got.filter((m): m is Extract<Msg, { t: T }> => m.t === t).at(-1),
      };
      ws.on('open', () => ok(c));
      ws.on('unexpected-response', () => ok(c));
    });
  return { open, saved, close: () => new Promise((ok) => server.close(ok)) };
}

test("over the town's socket: open at the Warren Gate (a ticket, Lv 15), in the run, back in after a reload; others are sent back out", async () => {
  const T = await town({ tickets: { Ana: 1 }, level: { Low: 14 } });
  const [gc, gr] = W.entry.warp.arrive;
  const far = await T.open('Far', 'slums');
  await wait(80);
  far.send({ t: 'warrens-open' });
  await wait(80);
  await heard(far, 'warrens-refused');
  assert.equal(far.last('warrens-refused')?.reason, 'gone', 'only at the gate');
  far.ws.close();
  const ana = await T.open('Ana', 'slums');
  await wait(80);
  ana.send({ t: 'here', col: gc, row: gr, dir: 's' });
  ana.send({ t: 'warrens-gate' });
  await wait(80);
  await heard(ana, 'warrens-gate');
  assert.deepEqual(ana.last('warrens-gate')?.gate, { minLevel: 15, level: 15, tickets: 1, inParty: false, partyRun: null });
  ana.send({ t: 'warrens-open' });
  await wait(80);
  await heard(ana, 'warrens-go');
  const go = ana.last('warrens-go');
  assert.ok(go);
  assert.equal(go.ticket, true, 'her ticket went (the game plays its sound)');
  assert.equal(T.saved.at(-1)?.[0]?.opener, 'Ana');
  ana.ws.close();
  // In the run: its start room, its tracker, and once she's in, it starts (alone: no waiting).
  const inside = await T.open('Ana', 'warrens');
  await wait(1300);
  const welcome = inside.got.find((m) => m.t === 'welcome') as Extract<Msg, { t: 'welcome' }>;
  assert.ok(Math.abs(welcome.spawn[0] - map.arrive.slums[0]) <= 1 && Math.abs(welcome.spawn[1] - map.arrive.slums[1]) <= 1);
  await heard(inside, 'warrens');
  assert.equal(inside.last('warrens')?.run.id, go.run);
  await heard(inside, 'warrens');
  assert.equal(inside.last('warrens')?.run.phase, 'running');
  assert.ok(inside.got.some((m) => m.t === 'mobs' && m.mobs.some((x) => x.id === 'boss:celes-tin')));
  // A reload: back in the same run.
  inside.ws.close();
  await wait(50);
  const again = await T.open('Ana', 'warrens');
  await wait(80);
  await heard(again, 'warrens');
  assert.equal(again.last('warrens')?.run.id, go.run);
  // Someone else: straight back out.
  const bob = await T.open('Bob', 'warrens');
  await wait(80);
  await heard(bob, 'warrens-out');
  assert.equal(bob.last('warrens-out')?.reason, 'closed');
  assert.ok(bob.closed());
  // Leave: told to go.
  again.send({ t: 'warrens-leave' });
  await wait(80);
  await heard(again, 'warrens-out');
  assert.equal(again.last('warrens-out')?.reason, 'left');
  // Under Lv 15, or no ticket: why not.
  const low = await T.open('Low', 'slums');
  low.send({ t: 'here', col: gc, row: gr, dir: 's' });
  low.send({ t: 'warrens-open' });
  await wait(80);
  await heard(low, 'warrens-refused');
  assert.equal(low.last('warrens-refused')?.reason, 'level');
  for (const c of [again, low]) c.ws.close();
  await T.close();
});

test("over the town's socket: a party's run invites its members in the Slums; they join without a ticket", async () => {
  const T = await town({ tickets: { Ana: 1 } });
  const [gc, gr] = W.entry.warp.arrive;
  const ana = await T.open('Ana', 'slums');
  const bob = await T.open('Bob', 'slums');
  await wait(80);
  ana.send({ t: 'here', col: gc, row: gr, dir: 's' });
  ana.send({ t: 'party-invite', to: bob.id() });
  await wait(80);
  await heard(bob, 'party-invited');
  bob.send({ t: 'party-answer', invite: bob.last('party-invited')!.invite, accept: true });
  await wait(80);
  ana.send({ t: 'warrens-open' });
  await wait(100);
  await heard(bob, 'warrens-invite');
  const invite = bob.last('warrens-invite');
  assert.equal(invite?.from, 'Ana');
  assert.equal(invite?.ms, W.entry.partyInviteSeconds * 1000);
  bob.send({ t: 'warrens-join', run: invite!.run });
  await wait(80);
  await heard(bob, 'warrens-go');
  assert.equal(bob.last('warrens-go')?.run, invite!.run);
  assert.equal(bob.last('warrens-go')?.ticket, undefined, 'joining uses no ticket');
  // Ana in first: it waits for Bob.
  const a = await T.open('Ana', 'warrens');
  await wait(1200);
  await heard(a, 'warrens');
  const view = a.last('warrens')!.run;
  assert.equal(view.phase, 'gathering');
  assert.deepEqual(view.waiting, ['Bob']);
  const b = await T.open('Bob', 'warrens');
  await wait(1200);
  await heard(b, 'warrens');
  assert.equal(b.last('warrens')?.run.phase, 'running');
  for (const c of [ana, bob, a, b]) c.ws.close();
  await T.close();
});

test("over the town's socket: a kill's XP is shared with party members nearby, raised 10% a member", async () => {
  const xp: Record<string, number> = {};
  const T = await town({ tickets: {}, kill: (name, mob) => (xp[name] = mob.xp) });
  const slums = loadMobMap('slums');
  const room = new MobRoom(slums, () => 0.5, {}, { shapes: {} }, loadMobKinds());
  const can = room.snapshot(0).find((m) => m.id.startsWith('tin-can-alley:'))!;
  const mara = await T.open('Mara', 'slums');
  const bob = await T.open('Bob', 'slums');
  await wait(80);
  const spot = [can.col + 1, can.row];
  mara.send({ t: 'here', col: spot[0], row: spot[1], dir: 's' });
  bob.send({ t: 'here', col: spot[0], row: spot[1], dir: 's' });
  mara.send({ t: 'party-invite', to: bob.id() });
  await heard(bob, 'party-invited');
  for (let k = 0; k < 20 && !bob.last('party-invited'); k++) await wait(50);
  await heard(bob, 'party-invited');
  bob.send({ t: 'party-answer', invite: bob.last('party-invited')!.invite, accept: true });
  await wait(80);
  mara.send({ t: 'attack', mob: can.id, skill: 0 });
  await wait(200);
  await heard(mara, 'mob-hit');
  const hit = mara.last('mob-hit');
  assert.ok(hit?.hits[0].dead, JSON.stringify(mara.got.filter((m) => m.t === 'attack-refused')));
  const base = loadStats().mobs.list['tin-can'].xp;
  assert.deepEqual(xp, { Mara: Math.round((base * 1.1) / 2), Bob: Math.round((base * 1.1) / 2) });
  for (const c of [mara, bob]) c.ws.close();
  await T.close();
});
