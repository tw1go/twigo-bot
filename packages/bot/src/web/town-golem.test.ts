import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { type TownServerMessage, baseStats, derivedStats, golemResetMs, hitDamage, mobStats, xpEarners, xpShare } from '@mikazuki/shared';
import { Golem, type GolemEvent, type GolemHost, downLine, inCone, inShape, loadGolemArt, nextRiseAfter, pitTiles } from './town-golem.js';
import { loadStats } from './stats-data.js';
import { type Attacker, MobRoom, loadMobKinds, loadMobMap } from './town-mobs.js';
import { attachTown } from './town.js';

// The Scrapheap Golem (the Slums' field boss) on the real map and art: its schedule, its fight, its phases, its Adds,
// reset, sink, death, and the lines only the Slums hear.

const map = loadMobMap('slums');
const boss = map.boss!;
const art = { ...loadGolemArt(), hpPerPlayer: 1 }; // (its HP the mob table's: the scaling with players has its own test)
const kinds = loadMobKinds();
const HOUR = 3_600_000;
const lcg = (seed = 11) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const at = (dc: number, dr: number): [number, number] => [boss.tile[0] + dc, boss.tile[1] + dr];
const stats = loadStats();
const golemStats = mobStats(stats, boss.id)!;
/** A player of the golem's level (no misses, full damage), with nothing spent or worn. */
const hero = (cls: string): Attacker => ({ cls, level: golemStats.level });
/** Their skill's first-level hit on it, and its crit. */
const heroHits = (cls: string) => {
  const by = { ...derivedStats(stats, cls, golemStats.level, baseStats(stats, cls, golemStats.level)), level: golemStats.level };
  return [false, true].map((crit) => hitDamage(stats, by, golemStats, 1, crit));
};
/** The most a hero's hit takes (a crit). */
const MOST = Math.max(heroHits('stick')[1], heroHits('slingshot')[1]);

/** A golem on its own, with a pretend room (every tile open) that counts its Adds. */
function lone(random = lcg()) {
  const host = { called: [] as [number, number][][], dropped: 0 } as GolemHost & { called: [number, number][][]; dropped: number };
  host.open = () => true;
  host.callAdds = (spots) => (host.called.push(spots), [{ t: 'mob-add', mobs: [] }]);
  host.dropAdds = () => (host.dropped++, [{ t: 'mob-remove', ids: [] }]);
  return { golem: new Golem(boss, art, host, random), host };
}

/** Ticks a quarter second at a time from `from` to `to`, gathering what's sent. */
function run(g: { tick(now: number, p: ReadonlyMap<string, [number, number]>): GolemEvent[] | unknown[] }, from: number, to: number, players: ReadonlyMap<string, [number, number]> = new Map()) {
  const out: { at: number; e: GolemEvent }[] = [];
  for (let t = from; t <= to; t += 250) for (const e of g.tick(t, players) as GolemEvent[]) out.push({ at: t, e });
  return out;
}

const attacks = (evs: { at: number; e: GolemEvent }[]) => evs.filter((x) => x.e.t === 'golem-attack') as { at: number; e: Extract<GolemEvent, { t: 'golem-attack' }> }[];
const changes = (evs: { at: number; e: GolemEvent }[]) => evs.flatMap((x) => (x.e.t === 'golem' ? [x.e.change] : []));
const lines = (evs: { at: number; e: GolemEvent }[]) => evs.flatMap((x) => (x.e.t === 'system' ? [x.e.line] : []));

test('the art and rules: its HP and level from the mob table (Lv 15, 10,800), a body of radius 3 (drawn 1.5× its art), its rise as long as its death anim, the Junk as long as its fx', () => {
  assert.equal(art.hp, golemStats.hp);
  assert.deepEqual([golemStats.level, golemStats.hp, boss.level], [15, 10_800, 15]);
  assert.equal(art.radius, 3);
  assert.equal(art.riseMs, 1000); // death: 8 frames at 8 fps
  assert.deepEqual(art.attackMs, { slam: 900, toss: 800, glare: 800 });
  assert.equal(art.callMs, 1000);
  assert.equal(boss.leash, 11);
});

test('with nothing kept it first rises on the next even hour (UTC and Manila alike), a line 5 minutes before and one as it rises; then 2 hours after it sinks back', () => {
  const { golem } = lone();
  const day = Date.UTC(2026, 9, 8, 0, 30); // starts at 00:30: the first rise is 02:00
  const evs: { at: number; e: GolemEvent }[] = [];
  for (let t = day; t <= day + 24 * HOUR; t += 15_000) for (const e of golem.tick(t, new Map())) evs.push({ at: t, e });
  const rises = evs.filter((x) => x.e.t === 'golem' && x.e.change === 'rise').map((x) => x.at);
  const d = new Date(rises[0]);
  assert.deepEqual([d.getUTCHours(), d.getUTCMinutes()], [2, 0]);
  assert.equal((d.getUTCHours() + 8) % 2, 0, 'an even hour in Manila too');
  // Untouched, each sinks 30 min after it rose (plus its sink anim), and rises again 2 hours after that.
  const cycle = 30 * 60_000 + art.riseMs + 2 * HOUR;
  for (let k = 1; k < rises.length; k++) assert.ok(Math.abs(rises[k] - rises[k - 1] - cycle) <= 15_000, `${(rises[k] - rises[k - 1]) / 60_000} min`);
  assert.equal(rises.length, 1 + Math.floor((day + 24 * HOUR - rises[0]) / cycle));
  const stirs = evs.filter((x) => x.e.t === 'system' && x.e.line.tone === 'stir');
  assert.ok(stirs.length === rises.length || stirs.length === rises.length + 1, 'a warning before each (the last maybe still to rise)');
  for (const [i, s] of stirs.slice(0, rises.length).entries()) assert.ok(Math.abs(rises[i] - s.at - 5 * 60_000) <= 15_000);
  assert.deepEqual(lines(evs.filter((x) => x.at === rises[0])).map((l) => [l.kind, l.text]), [['golem', 'The Scrapheap Golem has risen in the junkyard!']]);
  assert.equal(lines(evs.filter((x) => x.at === stirs[0].at))[0].text, 'The junk in the golem pit is stirring...');
  const sinks = changes(evs).filter((c) => c === 'sink').length;
  assert.ok(sinks === rises.length || sinks === rises.length - 1, `${sinks} sinks, ${rises.length} rises`); // (the last may still be up)
  assert.equal(nextRiseAfter(Date.UTC(2026, 9, 8, 2, 0), 120), Date.UTC(2026, 9, 8, 4, 0), 'on the hour: the next one');
});

test('after a restart it waits for the next even hour; while rising it can\'t be hit', () => {
  const room = new MobRoom(map, lcg(), {}, { shapes: {} }, kinds, art);
  const t0 = Date.UTC(2026, 9, 8, 3, 10);
  room.tick(t0);
  assert.equal(room.golemState(t0), null, 'not up after a start at 03:10');
  const evs = run(room, t0, Date.UTC(2026, 9, 8, 4, 0));
  const rise = evs.find((x) => x.e.t === 'golem' && x.e.change === 'rise')!;
  assert.equal(rise.at, Date.UTC(2026, 9, 8, 4, 0));
  const t = rise.at;
  const s = room.golemState(t)!;
  assert.deepEqual([s.state, s.left, s.hp, s.maxHp, s.level, s.col, s.row], ['rising', art.riseMs, art.hp, art.hp, golemStats.level, ...boss.tile]);
  assert.deepEqual(room.attack('p1', at(3, 0), 'stick', boss.id, t + 500), { ok: false, reason: 'gone' }, 'rising');
  room.tick(t + art.riseMs);
  assert.equal(room.golemState(t + art.riseMs)!.state, 'idle');
  assert.ok(room.attack('p1', at(3, 0), 'stick', boss.id, t + art.riseMs + 10).ok, 'risen');
});

test('spawned now (the CMS\'s Spawn now): it rises at once, only when it isn\'t up; no rise is due while it\'s up', () => {
  const room = new MobRoom(map, lcg(), {}, { shapes: {} }, kinds, art);
  const t0 = Date.UTC(2026, 9, 8, 3, 10);
  room.tick(t0);
  assert.deepEqual(room.golemPlan(t0), { name: boss.name, nextRise: Date.UTC(2026, 9, 8, 4, 0), everyMinutes: 120 });
  assert.equal(room.riseGolem(t0), true);
  const rise = room.flush().find((e) => e.t === 'golem' && e.change === 'rise');
  assert.ok(rise, 'the rise goes to the room');
  assert.equal(room.golemState(t0)!.state, 'rising');
  assert.equal(room.riseGolem(t0 + 1000), false, 'up already');
  assert.equal(room.golemPlan(t0 + 1000)!.nextRise, null, 'up: its next rise comes once it is gone');
});

test('it rises again 2 hours (everyMinutes) after it is killed, or after it sinks back unbeaten; kept for a restart', () => {
  const H2 = boss.everyMinutes * 60_000;
  assert.equal(H2, 2 * 60 * 60_000);
  const saved: (number | null)[] = [];
  const room = new MobRoom(map, lcg(7), {}, { shapes: {} }, kinds, art);
  room.golemSchedule(null, (t) => saved.push(t));
  room.riseGolem(0);
  room.tick(art.riseMs);
  assert.equal(saved.at(-1), 0, 'up: saved as due now (a restart brings it straight back)');
  // Killed at 10 s: back at 10 s + 2 h, not before; its warning warnMinutes before.
  const huge: Attacker = { cls: 'stick', level: 20, points: { STR: 100_000 } };
  let killedAt = art.riseMs + 1000;
  for (let i = 0; i < 50; i++) {
    const r = room.attack('huge', at(3, 0), huge, boss.id, killedAt);
    if (r.ok && r.hits[0].dead) break;
    killedAt += 1000;
  }
  assert.equal(room.golemState(killedAt + 1)?.state ?? 'gone', 'gone');
  assert.equal(room.golemPlan(killedAt)!.nextRise, killedAt + H2);
  assert.equal(saved.at(-1), killedAt + H2);
  room.flush();
  const warn = room.tick(killedAt + H2 - boss.warnMinutes * 60_000);
  assert.ok(warn.some((e) => e.t === 'system' && /stirring/.test(e.line.text)), 'the warning');
  room.tick(killedAt + H2 - 1);
  assert.equal(room.golemState(killedAt + H2 - 1), null, 'not yet');
  room.tick(killedAt + H2);
  assert.equal(room.golemState(killedAt + H2)!.state, 'rising');
  // Left alone 30 min: it sinks back; 2 h after it's gone, up again.
  const up = killedAt + H2 + art.riseMs;
  room.tick(up);
  const sinkAt = up + 30 * 60_000;
  room.tick(sinkAt);
  assert.equal(room.golemState(sinkAt)!.state, 'sinking');
  room.tick(sinkAt + art.riseMs);
  assert.equal(room.golemPlan(sinkAt + art.riseMs)!.nextRise, sinkAt + art.riseMs + H2);
  // A restart: the kept time is picked up (a past one: it rises at once).
  const again = new MobRoom(map, lcg(7), {}, { shapes: {} }, kinds, art);
  again.golemSchedule(5_000);
  again.tick(4_999);
  assert.equal(again.golemState(4_999), null);
  again.tick(5_000);
  assert.equal(again.golemState(5_000)!.state, 'rising');
});

test('its HP grows with the players in the Slums: the mob table\'s × 1.5 ^ players (stats.json hpPerPlayer), keeping its share as they come and go', () => {
  const room = new MobRoom(map, lcg(), {}, { shapes: {} }, kinds, { ...art, hpPerPlayer: 1.5 });
  const t0 = Date.UTC(2026, 9, 8, 3, 10);
  room.tick(t0, new Map(), new Map(), 2);
  room.riseGolem(t0);
  assert.equal(room.golemState(t0)!.maxHp, Math.round(art.hp * 1.5 ** 2), 'risen for the two here');
  room.flush();
  // A third arrives: up again, a 'scale' to the room; still full.
  const evs = room.tick(t0 + 250, new Map(), new Map(), 3);
  const scale = evs.find((e) => e.t === 'golem' && e.change === 'scale') as { golem: { hp: number; maxHp: number } } | undefined;
  assert.deepEqual([scale?.golem.maxHp, scale?.golem.hp], [Math.round(art.hp * 1.5 ** 3), Math.round(art.hp * 1.5 ** 3)]);
  // Nobody new: nothing sent.
  assert.ok(!room.tick(t0 + 500, new Map(), new Map(), 3).some((e) => e.t === 'golem' && e.change === 'scale'));
  // Without the setting: the mob table's HP whoever's here.
  const plain = new MobRoom(map, lcg(), {}, { shapes: {} }, kinds, { ...art, hpPerPlayer: undefined });
  plain.tick(t0, new Map(), new Map(), 5);
  plain.riseGolem(t0);
  assert.equal(plain.golemState(t0)!.maxHp, art.hp);
});

test('reach to it is measured to its body\'s edge: a melee player a tile past its edge hits, three past doesn\'t', () => {
  const R = art.radius;
  const room = new MobRoom(map, lcg(), {}, { shapes: {} }, kinds, art);
  room.riseGolem(0);
  room.tick(art.riseMs);
  let t = 2000;
  const hit = (from: [number, number], cls: string) => room.attack(`p${t}`, from, hero(cls), boss.id, (t += 1000));
  const r = hit(at(R + 1, 0), 'stick');
  assert.ok(r.ok && r.hits[0].id === boss.id && heroHits('stick').includes(r.hits[0].damage) && !r.hits[0].blocked, JSON.stringify(r));
  assert.ok(hit(at(R + 1, 2), 'stick').ok, 'off its axis: about 1.5 from its edge (with the tile of slack)');
  assert.deepEqual(hit(at(R + 1, 4), 'stick'), { ok: false, reason: 'range' }, 'about 2.7 from its edge');
  assert.ok(hit(at(0, 0), 'stick').ok, 'standing inside it');
  assert.deepEqual(hit(at(R + 3, 0), 'stick'), { ok: false, reason: 'range' });
  assert.ok(hit(at(R + 6, 0), 'slingshot').ok, 'a slingshot from 6 of its edge (5 + slack)');
  assert.deepEqual(hit(at(R + 7, 0), 'slingshot'), { ok: false, reason: 'range' });
});

test('it waits to be hit; then it goes after whoever hit it last within its leash, else the nearest there', () => {
  const { golem } = lone();
  golem.riseNow(0);
  const p1 = at(3, 0);
  const p2 = at(0, -3);
  const both = new Map([['p1', p1], ['p2', p2]]);
  assert.equal(attacks(run(golem, 0, 20_000, both)).length, 0, 'not aggressive');
  golem.hit('p1', 'Mara', 20, 20_000);
  golem.hit('p2', 'Bob', 20, 20_100);
  const first = attacks(run(golem, 20_250, 24_000, both));
  assert.ok(first.length && first.every((a) => a.e.target === 'p2'), 'the last to hit it');
  // p2 leaves its leash: the nearest one left (p1).
  const away = new Map([['p1', p1], ['p2', at(boss.leash + 1, 0)]]);
  const next = attacks(run(golem, 24_250, 30_000, away));
  assert.ok(next.length && next.every((a) => a.e.target === 'p1'));
});

test('the golem goes for the one it wants most in its fight (a Pot lid over whoever hit it last), then the last to hit it', () => {
  const { golem, host } = lone();
  const want: Record<string, number> = { sling: 1, pot: 4 };
  host.priority = (id) => want[id] ?? 0;
  golem.riseNow(0);
  const both = new Map([['sling', at(3, 0)], ['pot', at(0, -3)]]);
  run(golem, 0, 20_000, both);
  golem.hit('pot', 'Pia', 20, 20_000);
  golem.hit('sling', 'Sam', 20, 20_100); // the Slingshot hit it last
  const evs = attacks(run(golem, 20_250, 26_000, both));
  assert.ok(evs.length && evs.every((a) => a.e.target === 'pot'), 'the tank');
  want.pot = 1; // all the same: the last to hit it
  const then = attacks(run(golem, 26_250, 32_000, both));
  assert.ok(then.length && then.every((a) => a.e.target === 'sling'));
});

test('attacks: Tire Slam close, Scrap Toss far, a Lamp Glare every 4th at whoever is in its cone; 1.5 s apart, 1 s enraged', () => {
  const { golem } = lone();
  golem.riseNow(0);
  const R = art.radius;
  const close = at(R + 1, 0); // 1 from its edge, SE of it
  const blindToo = at(R + 2, 1); // in the cone as well
  const behind = at(-R - 1, 0); // NW: not
  run(golem, 0, 1750);
  golem.hit('p1', 'Mara', 20, 2000);
  const evs = attacks(run(golem, 2000, 9000, new Map([['p1', close], ['p2', blindToo], ['p3', behind]])));
  assert.deepEqual(evs.slice(0, 4).map((a) => a.e.attack), ['slam', 'slam', 'slam', 'glare']);
  assert.ok(evs.every((a) => a.e.dir === 'se' && a.e.target === 'p1'), 'turned to face it first');
  assert.deepEqual(evs.slice(1, 4).map((a, i) => a.at - evs[i].at), [1500, 1500, 1500]);
  const slam = evs[0].e;
  assert.deepEqual(slam.at, at(R + 1, 0), 'the fist lands a tile past its body, toward the target');
  assert.equal(slam.enraged, false);
  const glare = evs[3].e;
  assert.deepEqual(glare.blinded, ['p1', 'p2']);
  assert.deepEqual([glare.cone, glare.blindMs, glare.at], [[R + 5, 60], 3000, at(R + 5, 0)], '5 tiles past its body');
  assert.ok(inCone(boss.tile, 'se', at(4, 2)) && !inCone(boss.tile, 'se', at(2, 4)) && !inCone(boss.tile, 'se', at(6, 0)), '60° wide, 5 long (as given)');
  // Far off: Scrap Toss at their tile.
  const far = at(R + 5, 0); // 5 from its edge
  const toss = attacks(run(golem, 9250, 11_000, new Map([['p1', far]])))[0];
  assert.deepEqual([toss.e.attack, toss.e.at], ['toss', far]);
  // Enraged (a quarter left): 1 s apart, slams flagged for the rubble ring.
  golem.hit('p1', 'Mara', Math.ceil((art.hp * 3) / 4), 11_000);
  const fast = attacks(run(golem, 11_250, 16_000, new Map([['p1', close]]))).filter((a) => a.e.attack === 'slam');
  assert.ok(fast.length >= 3 && fast.every((a) => a.e.enraged));
  assert.ok(fast.slice(1).some((a, i) => a.at - fast[i].at === 1000), fast.map((a) => a.at).join());
});

// ── Junk Drop and the Shockwave: decided where everyone stands as they land ──

const moves = (evs: { at: number; e: GolemEvent }[], move: string) =>
  evs.filter((x) => x.e.t === 'boss-move' && x.e.move === move) as { at: number; e: Extract<GolemEvent, { t: 'boss-move' }> }[];
const landings = (evs: { at: number; e: GolemEvent }[], move: string) =>
  evs.filter((x) => x.e.t === 'boss-hit' && x.e.move === move) as { at: number; e: Extract<GolemEvent, { t: 'boss-hit' }> }[];
/** A golem whose every hit on a player is 10 (or a miss for `missing`). */
function hitting(missing = new Set<string>()) {
  const l = lone();
  l.host.roll = (id) => (missing.has(id) ? { damage: 0, miss: true } : { damage: 10 });
  return l;
}

test('Junk Drop: 5 s into a fight, then every 9 s (6 s enraged), a 1.5-tile circle under up to 2 players it isn\'t fighting; it lands 1.5 s later on whoever is still inside', () => {
  const { golem } = hitting();
  golem.riseNow(0);
  const R = art.radius;
  const pit = pitTiles(boss)!;
  const tank = at(R + 1, 0);
  const [a, b, c] = [at(0, R + 2), at(-(R + 2), 0), at(0, -(R + 2))];
  for (const t of [tank, a, b, c]) assert.ok(pit.floor.has(`${t[0]},${t[1]}`), 'on the pit floor');
  run(golem, 0, 1750);
  golem.hit('p1', 'Tank', 20, 2000);
  const where = new Map([['p1', tank], ['p2', a], ['p3', b], ['p4', c]]);
  const evs = run(golem, 2000, 6750, where);
  assert.equal(moves(evs, 'junkDrop').length, 0, 'not in its first 5 s');
  const first = moves(run(golem, 7000, 7000, where), 'junkDrop')[0];
  assert.ok(first, 'at 5 s');
  assert.deepEqual([first.e.ms, first.e.shape?.kind], [1500, 'circles']);
  const circles = first.e.shape?.kind === 'circles' ? first.e.shape.circles : [];
  assert.equal(circles.length, 2);
  assert.ok(circles.every((x) => x.radius === 1.5 && [a, b, c].some((p) => p[0] === x.at[0] && p[1] === x.at[1])), 'under two of the others, never its target');
  // One of the two walks out of their circle, the other stays: only the one who stayed is hit.
  const [stays, walks] = [...where].filter(([, p]) => circles.some((x) => x.at[0] === p[0] && x.at[1] === p[1])).map(([id]) => id);
  const moved = new Map(where);
  moved.set(walks, [where.get(walks)![0] + 3, where.get(walks)![1]]);
  const land = landings(run(golem, 7250, 8500, moved), 'junkDrop');
  assert.equal(land.length, 1);
  assert.deepEqual([land[0].at, land[0].e.key, land[0].e.hits], [8500, first.e.key, [{ id: stays, damage: 10 }]]);
  // The next 9 s after the first.
  const next = moves(run(golem, 8750, 16_000, where), 'junkDrop');
  assert.deepEqual(next.map((x) => x.at), [16_000]);
  // Enraged: 6 s apart (from the one already due, 9 s after the last).
  golem.hit('p1', 'Tank', Math.ceil((art.hp * 3) / 4), 16_100);
  const fast = moves(run(golem, 16_250, 38_000, where), 'junkDrop');
  assert.deepEqual(fast.map((x) => x.at), [25_000, 31_000, 37_000]);
});

test('Junk Drop with nobody else in its fight falls under its target', () => {
  const { golem } = hitting();
  golem.riseNow(0);
  const tank = at(art.radius + 1, 0);
  run(golem, 0, 1750);
  golem.hit('p1', 'Tank', 20, 2000);
  const drop = moves(run(golem, 2000, 7000, new Map([['p1', tank]])), 'junkDrop')[0];
  assert.deepEqual(drop.e.shape, { kind: 'circles', circles: [{ at: tank, radius: 1.5 }] });
});

test('Shockwave: from half HP each Tire Slam rings out round where its fist landed (2.5 to 5.5 tiles), 1.1 s after the fist; close to the fist or well clear is safe', () => {
  const { golem } = hitting();
  golem.riseNow(0);
  const R = art.radius;
  const tank = at(R + 1, 0);
  run(golem, 0, 1750);
  golem.hit('p1', 'Tank', 20, 2000);
  const early = run(golem, 2000, 6000, new Map([['p1', tank]]));
  assert.ok(attacks(early).some((a) => a.e.attack === 'slam'));
  assert.equal(moves(early, 'shockwave').length, 0, 'not above half HP');
  golem.hit('p1', 'Tank', Math.ceil(art.hp / 2), 6100);
  const evs = run(golem, 6250, 12_000, new Map([['p1', tank]]));
  const slam = attacks(evs).find((a) => a.e.attack === 'slam')!;
  const wave = moves(evs, 'shockwave')[0];
  assert.ok(slam && wave);
  assert.ok(wave.at - slam.at >= golem.hitMs('slam') && wave.at - slam.at < golem.hitMs('slam') + 250, 'as the fist lands');
  assert.deepEqual([wave.e.ms, wave.e.shape], [1100, { kind: 'ring', at: slam.e.at, inner: 2.5, outer: 5.5 }]);
  // Who's where as it ripples out: next to the fist, in the ring, well clear.
  const fist = slam.e.at;
  const spots = new Map([['p1', fist], ['p2', [fist[0], fist[1] + 4] as [number, number]], ['p3', [fist[0], fist[1] - 7] as [number, number]]]);
  assert.deepEqual([...spots.values()].map((p) => inShape(wave.e.shape!, p)), [false, true, false]);
  assert.ok(!inShape(wave.e.shape!, [fist[0] + 2, fist[1] + 1]), 'a little over 2 tiles from the fist is still safe (no slack inward)');
  const hit = landings(evs, 'shockwave').find((x) => x.e.key === wave.e.key);
  assert.ok(hit && hit.at - wave.at >= 1100 && hit.at - wave.at < 1350);
  assert.deepEqual(hit.e.hits, [], 'p1 stood by the fist');
});

test('a reset or its death calls off its moves on their way (boss-cancel): nothing lands after', () => {
  const { golem } = hitting();
  golem.riseNow(0);
  run(golem, 0, 1750);
  golem.hit('p1', 'Tank', 20, 2000);
  const where = new Map([['p1', at(art.radius + 1, 0)], ['p2', at(0, art.radius + 2)]]);
  const evs = run(golem, 2000, 7000, where);
  assert.equal(moves(evs, 'junkDrop').length, 1);
  golem.hit('p1', 'Tank', art.hp, 7100); // its death, with the drop still falling
  const after = [...golem.flush().map((e) => ({ at: 7100, e })), ...run(golem, 7250, 10_000, where)];
  assert.ok(after.some((x) => x.e.t === 'boss-cancel' && x.e.id === boss.id));
  assert.equal(landings(after, 'junkDrop').length, 0);
});

test('its moves\' hits come off HP in the room as they land (MobRoom.landed), rolled against each player\'s DEF', () => {
  const room = new MobRoom(map, lcg(4), {}, { shapes: {} }, kinds, art);
  room.riseGolem(0);
  room.tick(1000);
  const tank = at(art.radius + 1, 0);
  const other = at(0, art.radius + 2);
  const players = new Map([['p1', tank], ['p2', other]]);
  const guards = new Map([['p1', { def: 10, level: 15 }], ['p2', { def: 10, level: 15 }]]);
  room.attack('p1', tank, hero('stick'), boss.id, 2000);
  room.flush();
  type BossHit = Extract<TownServerMessage, { t: 'boss-hit' }>;
  let found: { hit: BossHit; t: number } | null = null;
  for (let t = 2250; t <= 10_000 && !found; t += 250) {
    const hit = room.tick(t, players, guards).find((e): e is BossHit => e.t === 'boss-hit' && e.move === 'junkDrop');
    if (hit) found = { hit, t };
  }
  assert.ok(found, 'a drop landed');
  assert.deepEqual(found.hit.hits.map((h) => h.id), ['p2'], 'under the one it wasn\'t fighting');
  const landed = room.landed(found.t).filter((l) => l.by === boss.id && l.player === 'p2');
  assert.equal(landed.length, 1);
  assert.equal(landed[0].damage, found.hit.hits[0].damage);
});

test('between 2 and 3 tiles of its edge it steps closer (inside its leash), then slams', () => {
  const { golem } = lone();
  golem.riseNow(0);
  const p = at(art.radius + 3, 0); // 3 from its edge
  run(golem, 0, 1750);
  golem.hit('p1', 'Mara', 20, 2000);
  const evs = run(golem, 2000, 8000, new Map([['p1', p]]));
  const move = evs.find((x) => x.e.t === 'mob-move')!;
  assert.ok(move && move.e.t === 'mob-move' && move.e.path.length === 2 && move.e.speed === 1.5);
  assert.equal(attacks(evs)[0].e.attack, 'slam');
});

test('at half HP it calls the Junk once: 3–4 spots on the pit floor round it, 2 Tin Cans and a Bottle Caps pack as Adds that come for the nearest player', () => {
  const room = new MobRoom(map, lcg(5), {}, { shapes: {} }, kinds, art);
  room.riseGolem(0);
  room.tick(1000);
  const players = new Map([['p1', at(3, 0)]]);
  let t = 2000;
  let call: Extract<TownServerMessage, { t: 'golem' }> | undefined;
  const all: GolemEvent[] = [];
  // Hits until it calls (each a second apart, a Lv 1 skill).
  while (!call) {
    assert.ok(room.attack('p1', at(3, 0), hero('stick'), boss.id, (t += 1000)).ok);
    const evs = [...room.flush(), ...room.tick(t, players)] as GolemEvent[];
    all.push(...evs);
    call = evs.find((e) => e.t === 'golem' && e.change === 'call') as typeof call;
  }
  assert.ok(call!.golem.hp <= art.hp / 2 && call!.golem.hp > art.hp / 2 - MOST, `${call!.golem.hp}`);
  const spots = call!.spots!;
  assert.ok(spots.length === 3 || spots.length === 4, `${spots.length}`);
  const pit = pitTiles(boss)!;
  const g = room.golemState(t)!;
  for (const [c, r] of spots) {
    assert.ok(pit.floor.has(`${c},${r}`) && !map.blocked[r][c], 'on the pit floor, open');
    assert.ok(Math.hypot(c - g.col, r - g.row) >= art.radius + 2, 'clear of its body');
  }
  assert.equal(call!.ms, art.callMs);
  // The Adds after the fx.
  let added: Extract<TownServerMessage, { t: 'mob-add' }> | undefined;
  for (const end = t + 3000; !added && t < end; t += 250) added = room.tick(t, players).find((e) => e.t === 'mob-add') as typeof added;
  assert.ok(added);
  const byKind = (k: string) => added!.mobs.filter((m) => m.kind === k);
  assert.equal(byKind('tin-can').length, 2);
  assert.ok(byKind('bottle-caps').length >= 3 && byKind('bottle-caps').length <= 5);
  assert.ok(added!.mobs.every((m) => m.id.startsWith('golem-add:') && m.hp === m.maxHp));
  assert.ok(room.snapshot(t).some((m) => m.kind === 'tin-can'), 'arrivals see them');
  // They come for the player straight away.
  const ids = new Set(added!.mobs.map((m) => m.id));
  let hit = false;
  for (let k = 0; k < 60 && !hit; k++, t += 250) hit = room.tick(t, players).some((e) => e.t === 'mob-attack' && ids.has(e.id) && e.target === 'p1');
  assert.ok(hit, 'an Add attacked');
  // Down past a quarter: no second call (an enrage instead).
  const later: GolemEvent[] = [];
  while (room.golemState(t)!.hp > art.hp / 4 - MOST) {
    if (!room.attack('p1', at(3, 0), hero('stick'), boss.id, (t += 1000)).ok) continue;
    later.push(...(room.flush() as GolemEvent[]), ...(room.tick(t, players) as GolemEvent[]));
  }
  assert.ok(!later.some((e) => e.t === 'golem' && e.change === 'call'));
  const enrage = later.filter((e) => e.t === 'golem' && e.change === 'enrage') as Extract<GolemEvent, { t: 'golem' }>[];
  assert.equal(enrage.length, 1);
  assert.ok(enrage[0].golem.enraged && enrage[0].golem.hp <= art.hp / 4 && enrage[0].golem.hp > art.hp / 4 - MOST);
});

test('reset: nobody in its fight for mobBehaviour.golem.resetAfterSecondsEmpty (30 s), it heals to full, its Adds go, it walks home, and both phases can come again', () => {
  const RESET = golemResetMs(stats);
  assert.equal(RESET, stats.mobBehaviour.golem.resetAfterSecondsEmpty * 1000);
  assert.equal(art.resetMs, RESET);
  const room = new MobRoom(map, lcg(9), {}, { shapes: {} }, kinds, art);
  room.riseGolem(0);
  room.tick(1000);
  const far = at(art.radius + 3, 0);
  const players = new Map([['p1', far]]); // 3 from its edge: it steps closer to slam
  let t = 2000;
  while (room.golemState(t)!.hp > art.hp / 2 - MOST) {
    room.attack('p1', far, hero('slingshot'), boss.id, (t += 1000));
    room.flush();
    room.tick(t, players);
  }
  for (const end = t + 2000; t < end; t += 250) room.tick(t, players); // the Adds are out
  assert.ok(room.snapshot(t).some((m) => m.id.startsWith('golem-add:')));
  // Gone (out of the room): RESET, then the reset (not before).
  const evs = run(room, t + 250, t + RESET + 2000);
  const reset = evs.find((x) => x.e.t === 'golem' && x.e.change === 'reset')!;
  assert.ok(reset.at - t >= RESET && reset.at - t <= RESET + 500, `${reset.at - t}`);
  assert.ok(reset.e.t === 'golem' && reset.e.golem.hp === art.hp && !reset.e.golem.enraged && reset.e.golem.state === 'home');
  const removed = evs.find((x) => x.e.t === 'mob-remove')!;
  assert.ok(removed.e.t === 'mob-remove' && removed.e.ids.length >= 5 && removed.e.ids.every((id) => id.startsWith('golem-add:')));
  assert.ok(!room.snapshot(t + RESET + 2000).some((m) => m.id.startsWith('golem-add:')));
  const back = evs.find((x) => x.e.t === 'mob-move' && x.e.id === boss.id && x.at === reset.at)!;
  assert.ok(back.e.t === 'mob-move' && back.e.path.at(-1)![0] === boss.tile[0] && back.e.path.at(-1)![1] === boss.tile[1], 'walks home');
  t = reset.at + (back.e.t === 'mob-move' ? back.e.path.length - 1 : 0) * 1000; // 1.5 tiles a second
  run(room, reset.at + 250, t);
  const home = room.golemState(t)!;
  assert.deepEqual([home.col, home.row, home.state], [...boss.tile, 'idle']);
  // A new fight: the Junk again at half.
  let again = false;
  while (!again) {
    room.attack('p1', far, hero('slingshot'), boss.id, (t += 1000));
    again = [...room.flush(), ...room.tick(t, players)].some((e) => e.t === 'golem' && e.change === 'call');
  }
});

test('it sinks after 30 minutes untouched, never mid-fight', () => {
  const { golem } = lone();
  golem.riseNow(0);
  const quiet = run(golem, 0, 31 * 60_000);
  const sink = quiet.find((x) => x.e.t === 'golem' && x.e.change === 'sink')!;
  assert.equal(sink.at, 30 * 60_000);
  assert.ok(sink.e.t === 'golem' && sink.e.golem.state === 'sinking' && sink.e.golem.left === art.riseMs);
  assert.equal(golem.state(30 * 60_000 + art.riseMs + 250), null, 'gone once sunk');
  // Hit at 10 min and fought on until 45: no sink; then left alone: a reset, home, and a sink 30 min after the last hit.
  const b = lone().golem;
  b.riseNow(0);
  run(b, 0, 10 * 60_000);
  const p = new Map([['p1', at(3, 0)]]);
  const fight: { at: number; e: GolemEvent }[] = [];
  for (let t = 10 * 60_000; t <= 45 * 60_000; t += 250) {
    if (t % 60_000 === 0) b.hit('p1', 'Mara', 1, t);
    for (const e of b.tick(t, p)) fight.push({ at: t, e });
  }
  assert.ok(!changes(fight).includes('sink'));
  const after = run(b, 45 * 60_000 + 250, 80 * 60_000);
  assert.deepEqual(changes(after), ['reset', 'sink']);
  assert.equal(after.find((x) => x.e.t === 'golem' && x.e.change === 'sink')!.at, 75 * 60_000);
});

test('at 0 it dies: a line names everyone who hit it in that fight, its Adds go, it can\'t be hit, and 2 hours later it rises again', () => {
  assert.equal(downLine(['Mara', 'Bob', 'Lito']), 'Mara, Bob and Lito brought down the Scrapheap Golem!');
  assert.equal(downLine(['Mara', 'Bob']), 'Mara and Bob brought down the Scrapheap Golem!');
  assert.equal(downLine(['Mara']), 'Mara brought down the Scrapheap Golem!');
  const { golem, host } = lone();
  const t0 = Date.UTC(2026, 9, 8, 6, 0);
  run(golem, t0 - 250, t0 + 2000);
  const quarter = Math.ceil(art.hp / 4);
  golem.hit('a', 'Mara', quarter, t0 + 3000);
  golem.hit('b', 'Bob', quarter, t0 + 3100);
  golem.hit('a', 'Mara', quarter, t0 + 3200);
  const last = golem.hit('c', 'Lito', quarter, t0 + 3300);
  assert.deepEqual(last, { hp: 0, dead: true, dealt: new Map([['a', 2 * quarter], ['b', quarter], ['c', art.hp - 3 * quarter]]) }, 'the damage each did (none past 0)');
  const evs = golem.flush();
  const death = evs.find((e) => e.t === 'golem' && e.change === 'death');
  assert.ok(death && death.t === 'golem' && death.golem.state === 'dead' && death.golem.hp === 0);
  assert.deepEqual(evs.filter((e) => e.t === 'system').map((e) => e.t === 'system' && [e.line.kind, e.line.text, e.line.tone]), [['golem', 'Mara, Bob and Lito brought down the Scrapheap Golem!', 'down']]);
  assert.ok(host.dropped >= 1 && evs.some((e) => e.t === 'mob-remove'));
  assert.equal(golem.hit('a', 'Mara', 20, t0 + 3400), null);
  assert.equal(golem.state(t0 + 3400), null);
  const next = run(golem, t0 + 3500, t0 + 3300 + 2 * HOUR + 500);
  const back = next.find((x) => x.e.t === 'golem' && x.e.change === 'rise')!.at;
  assert.ok(back >= t0 + 3300 + 2 * HOUR && back <= t0 + 3300 + 2 * HOUR + 250, `${back - t0}`);
});

test('its XP goes to everyone who did at least 5% of its HP in the fight (stats.json xpTo), the killer or not', () => {
  assert.equal(xpShare(golemStats), 0.05);
  const room = new MobRoom(map, lcg(7), {}, { shapes: {} }, kinds, art);
  room.riseGolem(0);
  room.tick(art.riseMs);
  const from = at(3, 0);
  // A Lv 15 player chips at it (well under 5%), a stronger one does more than 5%, a very strong one finishes it.
  const weak = hero('stick');
  const strong: Attacker = { cls: 'stick', level: golemStats.level, points: { STR: 1000 } };
  const huge: Attacker = { cls: 'stick', level: 20, points: { STR: 100_000 } };
  const dealt = new Map<string, number>();
  let t = art.riseMs + 1000;
  const swing = (who: string, a: Attacker) => {
    const r = room.attack(who, from, a, boss.id, (t += 1000));
    assert.ok(r.ok, JSON.stringify(r));
    dealt.set(who, (dealt.get(who) ?? 0) + r.hits[0].damage);
    return r;
  };
  swing('weak', weak);
  swing('weak', weak);
  swing('strong', strong);
  assert.ok(dealt.get('weak')! < 0.05 * golemStats.hp && dealt.get('strong')! >= 0.05 * golemStats.hp && dealt.get('strong')! < golemStats.hp / 2, JSON.stringify([...dealt]));
  const last = swing('huge', huge);
  assert.ok(last.ok && last.hits[0].dead);
  assert.deepEqual(last.kills.map(({ at: _at, ...k }) => k), [{ id: boss.id, kind: boss.id, level: golemStats.level, xp: golemStats.xp, to: ['strong', 'huge'], boss: true }]);
  assert.deepEqual(xpEarners(golemStats, new Map([['a', 539], ['b', 540]]), 'a'), ['b'], 'the killer only if they did enough');
});

test('the dev demo: it rises, slams, tosses and glares at the nearest player, calls the Junk at a pretend half, enrages at a pretend quarter, dies', () => {
  const room = new MobRoom(map, lcg(3), {}, { shapes: {} }, kinds, art);
  room.golemDemo(0, 'Alice');
  const evs = run(room, 0, 40_000, new Map([['p1', at(6, 2)]]));
  const seen = evs.flatMap((x) => (x.e.t === 'golem' ? [x.e.change] : x.e.t === 'golem-attack' ? [x.e.attack] : x.e.t === 'boss-move' ? [x.e.move] : x.e.t === 'mob-add' ? ['adds'] : []));
  assert.deepEqual(seen, [
    'rise', 'fight', 'slam', 'toss', 'glare', 'junkDrop', 'call', 'adds', 'slam', 'shockwave', 'toss', 'glare', 'junkDrop', 'enrage', 'slam', 'shockwave', 'junkDrop', 'death',
  ]);
  assert.ok(evs.some((x) => x.e.t === 'system' && x.e.line.text === 'Alice brought down the Scrapheap Golem!'));
  assert.ok(evs.some((x) => x.e.t === 'mob-remove'));
});

test('a quarter-second tick with every mob, the golem fighting 5 players and its Adds out stays cheap', () => {
  const room = new MobRoom(map, lcg(8), {}, { shapes: {} }, kinds, art);
  room.riseGolem(0);
  room.tick(1000);
  const players = new Map<string, [number, number]>([['p0', at(3, 0)], ['p1', at(-3, 1)], ['p2', at(0, 4)], ['p3', at(6, -2)], ['p4', at(2, 3)]]);
  let t = 1000;
  // Down to the Junk (the Adds come for them), then a minute of fighting.
  while (room.golemState(t)!.hp > art.hp / 2) {
    for (const [id, p] of players) room.attack(id, p, hero('slingshot'), boss.id, t);
    room.flush();
    room.tick((t += 500), players);
  }
  for (const end = t + 3000; t < end; t += 250) room.tick(t, players);
  assert.ok(room.snapshot(t).filter((m) => m.kind).length >= 5, 'the Adds are out');
  const t0 = performance.now();
  let n = 0;
  for (const end = t + 60_000; t < end; t += 250, n++) {
    if (n % 4 === 0) room.attack(`p${(n / 4) % 5}`, players.get(`p${(n / 4) % 5}`)!, 'slingshot', boss.id, t); // ~20 a second
    room.flush();
    room.tick(t, players);
  }
  const ms = (performance.now() - t0) / n;
  console.log(`  tick: ${ms.toFixed(3)} ms with ${room.size} mobs, the golem and ${players.size} players fighting it`);
  assert.ok(room.golemState(t)?.state === 'fight');
  assert.ok(ms < 5, `${ms} ms`);
});

test('its lines reach only those in the Slums: not the town, not the feed kept for arrivals', async () => {
  const room = new MobRoom(map, lcg(), {}, { shapes: {} }, kinds, art);
  const server = createServer();
  const town = attachTown(server, {
    map: { size: [4, 4], spawn: [1, 1], blocked: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
    rooms: { slums: () => ({ size: map.size, spawn: at(3, 0), blocked: map.blocked }) },
    mobs: { slums: room },
    authenticate: async (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('as'),
    profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} as never }),
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  const open = (as: string, roomName?: string) =>
    new Promise<{ ws: WebSocket; got: TownServerMessage[] }>((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?as=${as}${roomName ? `&room=${roomName}` : ''}`);
      const got: TownServerMessage[] = [];
      ws.on('message', (d) => got.push(JSON.parse(String(d))));
      ws.on('open', () => ok({ ws, got }));
    });
  const inTown = await open('Bob');
  const inSlums = await open('Mara', 'slums');
  await new Promise((ok) => setTimeout(ok, 100));
  const snap = inSlums.got.find((m) => m.t === 'mobs');
  assert.ok(snap && snap.t === 'mobs' && snap.golem === null, 'arrivals hear it is not up');
  room.riseGolem(Date.now());
  await new Promise((ok) => setTimeout(ok, 400));
  const said = (c: { got: TownServerMessage[] }) => c.got.flatMap((m) => (m.t === 'system' ? [m.line.text] : []));
  assert.deepEqual(said(inSlums), ['The Scrapheap Golem has risen in the junkyard!']);
  assert.deepEqual(said(inTown), []);
  assert.ok(inSlums.got.some((m) => m.t === 'golem' && m.change === 'rise'));
  assert.ok(!inTown.got.some((m) => m.t === 'golem'));
  // Someone arriving later: the golem in their snapshot, and no golem line in their welcome.
  const later = await open('Lito', 'slums');
  await new Promise((ok) => setTimeout(ok, 100));
  const welcome = later.got.find((m) => m.t === 'welcome');
  assert.ok(welcome && welcome.t === 'welcome' && !welcome.system.some((l) => l.kind === 'golem'));
  const snap2 = later.got.find((m) => m.t === 'mobs');
  assert.ok(snap2 && snap2.t === 'mobs' && snap2.golem && ['rising', 'idle'].includes(snap2.golem.state));
  for (const c of [inTown, inSlums, later]) c.ws.close();
  void town;
  await new Promise((ok) => server.close(ok));
});

// ── The Golem Pit (v3): its ring, pit floor and way in on the map ──

/** Walking as the game does (8 ways, no cut corners) from `a` to `b` over open tiles; the path, or null. */
function walk(a: [number, number], b: [number, number], blocked = map.blocked): [number, number][] | null {
  const [cols, rows] = map.size;
  const open = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && !blocked[r][c] && (map.height?.[r]?.[c] ?? 0) === map.height![b[1]][b[0]];
  const key = (c: number, r: number) => c * 4096 + r;
  const came = new Map<number, number>([[key(...a), -1]]);
  const queue = [a];
  for (let i = 0; i < queue.length; i++) {
    const [c, r] = queue[i];
    if (c === b[0] && r === b[1]) {
      const path: [number, number][] = [];
      for (let k = key(c, r); k !== -1; k = came.get(k)!) path.push([Math.floor(k / 4096), k % 4096]);
      return path.reverse();
    }
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const [nc, nr] = [c + dc, r + dr];
      if (came.has(key(nc, nr)) || !open(nc, nr) || (dc && dr && (!open(c + dc, r) || !open(c, r + dr)))) continue;
      came.set(key(nc, nr), key(c, r));
      queue.push([nc, nr]);
    }
  }
  return null;
}

test('the pit on the map: its ring blocked, its floor and way in open and flat, nothing else standing on it', () => {
  const pit = pitTiles(boss)!;
  assert.deepEqual([pit.ring.size, pit.floor.size, pit.gap.size], [323, 399, 8]); // the art's, with one corner tile of the way in opened (it met the floor only corner to corner)
  assert.deepEqual(boss.tile, [21, 96]);
  const tile = (k: string) => k.split(',').map(Number) as [number, number];
  for (const k of pit.ring) assert.equal(map.blocked[tile(k)[1]][tile(k)[0]], 1, `ring ${k}`);
  for (const k of pit.fight) assert.equal(map.blocked[tile(k)[1]][tile(k)[0]], 0, `open ${k}`);
  for (const k of pit.all) assert.equal(map.height![tile(k)[1]][tile(k)[0]], 1, `flat ${k}`);
});

test('the only way onto the pit floor is its way in, from the safe zone, and it is 2 tiles wide out to the east', () => {
  const pit = pitTiles(boss)!;
  const [c0, r0] = map.safeZone!;
  const start: [number, number] = [c0, r0 + 30];
  const way = walk(start, boss.tile);
  assert.ok(way, 'a way in from the safe zone');
  assert.ok(way.some(([c, r]) => pit.gap.has(`${c},${r}`)), 'through the way in');
  // With the way in blocked, no way at all.
  const shut = map.blocked.map((row) => [...row]);
  for (const k of pit.gap) {
    const [c, r] = k.split(',').map(Number);
    shut[r][c] = 1;
  }
  assert.equal(walk(start, boss.tile, shut), null, 'the ring is closed all round');
  // Two tiles wide just outside it: the next column east of its last tiles is open on two rows.
  assert.ok(!map.blocked[103][37] && !map.blocked[104][37] && !map.blocked[103][38] && !map.blocked[104][38]);
});

test('the golem is hit only from its pit floor or way in, and stands where its body clears the ring', () => {
  const room = new MobRoom(map, lcg(), {}, { shapes: {} }, kinds, art);
  room.riseGolem(0);
  room.tick(art.riseMs);
  const pit = pitTiles(boss)!;
  // A slingshot just outside the ring, within its range of the golem's edge: refused.
  const outside: [number, number] = [boss.tile[0] - 12, boss.tile[1]]; // ring or beyond, west
  assert.ok(!pit.fight.has(`${outside[0]},${outside[1]}`));
  assert.deepEqual(room.attack('p1', outside, 'slingshot', boss.id, 2000), { ok: false, reason: 'range' });
  assert.ok(room.attack('p2', at(art.radius + 2, 0), 'slingshot', boss.id, 3000).ok, 'from the floor');
  // A long fight: it never stands where its body would reach past the floor.
  const players = new Map([['p2', at(art.radius + 4, 0)]]);
  for (let t = 3250; t < 40_000; t += 250) {
    room.tick(t, players);
    const g = room.golemState(t)!;
    for (let dr = -3; dr <= 3; dr++)
      for (let dc = -3; dc <= 3; dc++)
        if (Math.hypot(dc, dr) <= art.radius) assert.ok(pit.floor.has(`${g.col + dc},${g.row + dr}`), `body on the floor at ${g.col},${g.row}`);
  }
});

test('no zone mob stands on any pit tile', () => {
  const pit = pitTiles(boss)!;
  const room = new MobRoom(map, lcg(3), {}, { shapes: {} }, kinds);
  for (let t = 0; t < 60_000; t += 250) room.tick(t, new Map());
  for (const m of room.snapshot(60_000)) assert.ok(!pit.all.has(`${m.col},${m.row}`), m.id);
});
