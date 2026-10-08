import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { type Hitter, type TownServerMessage, baseCooldown, baseStats, derivedStats, hitDamage, levelGap, mobStats, skillCooldown, skillPct } from '@mikazuki/shared';
import { type SavedProgress, freshProgress, killXp } from './progress.js';
import { loadGear, loadStats } from './stats-data.js';
import { type AttackResult, MobRoom, facingTo, loadMobKinds, loadMobMap, packSize } from './town-mobs.js';
import { attachTown } from './town.js';

// The Slums' mobs on the real map (the game's maps/slums.json): where they stand, how they hop, what newcomers see.

const map = loadMobMap('slums');
const active = (map.mobZones ?? []).filter((z) => z.active);
const stats = loadStats();
const kindOf = (id: string) => mobStats(stats, active.find((z) => id.startsWith(`${z.id}:`))!.mob)!;
/** A class's hitter (the stats rules) at a level, with nothing spent, wearing `atk` of weapon. */
const hitter = (cls: string, level = 1, atk = 0): Hitter => ({ ...derivedStats(stats, cls, level, baseStats(stats, cls, level), { atk }), level });
/** A skill's first-level hit (and crit) on a mob of a kind, from a hitter. */
const hits = (by: Hitter, id: string, skill = 0) => [false, true].map((crit) => hitDamage(stats, by, kindOf(id), skillPct(stats, skill + 1), crit));

test('one mob per spawn of each zone that is on, at its kind\'s one level with its HP (the mob table), the same every time', () => {
  const a = new MobRoom(map);
  const b = new MobRoom(map);
  assert.equal(a.size, active.reduce((n, z) => n + z.spawns.length, 0));
  const now = Date.now();
  const sa = a.snapshot(now);
  assert.deepEqual(sa.map((m) => m.level), b.snapshot(now).map((m) => m.level));
  for (const m of sa) {
    const zone = active.find((z) => m.id.startsWith(`${z.id}:`))!;
    assert.deepEqual([m.level, m.maxHp, m.hp], [kindOf(m.id).level, kindOf(m.id).hp, kindOf(m.id).hp], m.id);
    assert.equal(m.level, zone.level, `${m.id}: the map says the same`);
  }
});

test('each mob has one of its kind\'s variants, picked the same every time, and a varied kind shows several', () => {
  const kinds = loadMobKinds();
  const a = new MobRoom(map, Math.random, {}, { shapes: {} }, kinds).snapshot(0);
  const b = new MobRoom(map, Math.random, {}, { shapes: {} }, kinds).snapshot(0);
  assert.deepEqual(a.map((m) => m.variant), b.map((m) => m.variant));
  for (const z of active) {
    const variants = kinds[z.mob]?.variants ?? [];
    const seen = new Set(a.filter((m) => m.id.startsWith(`${z.id}:`)).map((m) => m.variant));
    if (!variants.length) assert.deepEqual([...seen], [undefined], `${z.id}: one look`);
    else {
      for (const v of seen) assert.ok(variants.includes(v!), `${z.id}: ${v}`);
      assert.ok(seen.size > 1, `${z.id}: ${[...seen].join(', ')}`);
    }
  }
});

test('every mob kind\'s rules (mobs.json) match its art (manifest): the same variants, and every sheet is there', () => {
  const assets = new URL('../../../game/public/assets/', import.meta.url);
  const mobs = JSON.parse(readFileSync(new URL('manifest.json', assets), 'utf8')).mobs as Record<string, { file: string; variants?: Record<string, unknown>; directions: string[]; animations: Record<string, unknown>; enraged?: { file: string; animations: string[] } } | string>;
  const kinds = loadMobKinds();
  for (const [id, def] of Object.entries(mobs)) {
    if (typeof def === 'string') continue;
    assert.ok(kinds[id], `${id} in mobs.json`);
    assert.deepEqual(Object.keys(def.variants ?? {}), kinds[id].variants ?? [], `${id} variants`);
    for (const v of Object.keys(def.variants ?? { '': 0 }))
      for (const anim of [...Object.keys(def.animations), ...(def.enraged?.animations.map((a) => `enraged:${a}`) ?? [])])
        for (const dir of def.directions) {
          const file: string = (anim.startsWith('enraged:') ? def.enraged!.file : def.file).replace('{variant}', v).replace('{anim}', anim.replace('enraged:', '')).replace('{dir}', dir);
          assert.ok(existsSync(new URL(file, assets)), file);
        }
  }
  for (const z of map.mobZones ?? []) assert.ok(typeof mobs[z.mob] === 'object', `${z.id}: ${z.mob} has art`);
});

test('hops stay near the spawn, in the zone, on its level, off ramps, blocked tiles and the safe zone', () => {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const room = new MobRoom(map, random);
  const spawnOf = new Map(room.snapshot(0).map((m) => [m.id, [m.col, m.row] as [number, number]]));
  const zoneOf = (id: string) => active.find((z) => id.startsWith(`${z.id}:`))!;
  let hops = 0;
  for (let t = 0; t < 120_000; t += 250) {
    for (const h of room.tick(t).filter((e) => e.t === 'mob-move')) {
      hops++;
      const m = { zone: zoneOf(h.id), spawn: spawnOf.get(h.id)! };
      for (const [col, row] of h.path.slice(1)) {
        assert.ok(room.canStand(m, col, row), `${h.id} → ${col},${row}`);
        const [c0, r0, c1, r1] = m.zone.rect!;
        assert.ok(col >= c0 && col <= c1 && row >= r0 && row <= r1, `${h.id} stays in its zone`);
      }
      for (let i = 1; i < h.path.length; i++) {
        const [a, b] = [h.path[i - 1], h.path[i]];
        assert.ok(Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1, 'one tile a step');
      }
    }
  }
  assert.ok(hops > room.size, `they move (${hops} hops)`);
});

test('a newcomer sees a hop under way as where the mob has got to and the rest of the way', () => {
  const room = new MobRoom(map, () => 0.9);
  const hop = room.tick(10_000).find((h) => h.t === 'mob-move' && h.path.length >= 3) as { id: string; path: [number, number][] };
  assert.ok(hop, 'a hop of 2+ tiles');
  const mid = room.snapshot(10_000 + 500).find((m) => m.id === hop.id)!; // 2.4 tiles/s: one tile in
  assert.deepEqual([mid.col, mid.row], hop.path[1]);
  assert.deepEqual(mid.path?.[mid.path.length - 1], hop.path[hop.path.length - 1]);
});

test('a hit takes the stats rules\' damage from its HP, the mob goes after its foe, dies at 0 and comes back after respawnSec', () => {
  let n = 0;
  const room = new MobRoom(map, () => ((n = (n * 9301 + 49297) % 233280) / 233280));
  const mob = room.snapshot(0)[0];
  const at: [number, number] = [mob.col + 1, mob.row];
  const far: [number, number] = [mob.col + 9, mob.row];
  assert.deepEqual(room.attack('p1', far, 'stick', mob.id, 1000), { ok: false, reason: 'range' });
  assert.equal(room.attack('p1', far, 'slingshot', mob.id, 1000).ok, false, '9 tiles is past the slingshot too');
  const first = room.attack('p1', at, 'stick', mob.id, 1000);
  assert.equal(levelGap(stats, 1, mob.level).miss, 0, 'a Lv 1 mob: no misses');
  assert.ok(first.ok && hits(hitter('stick'), mob.id).includes(first.hits[0].damage) && first.hits[0].hp === mob.maxHp - first.hits[0].damage, JSON.stringify(first));
  assert.deepEqual(room.attack('p1', at, 'stick', mob.id, 1100), { ok: false, reason: 'slow' });
  // Next to it: it attacks back.
  const events = room.tick(1200, new Map([['p1', at]]));
  assert.ok(events.some((e) => e.t === 'mob-attack' && e.id === mob.id && e.target === 'p1'));
  assert.ok(first.ok && !first.kills.length, 'no kill yet');
  let t = 1000;
  let last: AttackResult = first;
  while (last.ok && !last.hits[0].dead) last = room.attack("p1", at, "stick", mob.id, (t += 1000));
  assert.ok(last.ok && last.hits[0].dead && last.hits[0].hp === 0);
  // Its XP (the mob table's) goes to its killer.
  assert.deepEqual(last.kills, [{ id: mob.id, level: mob.level, xp: kindOf(mob.id).xp, to: ['p1'] }]);
  assert.equal(room.snapshot(t)[0].dead, true);
  assert.deepEqual(room.attack('p1', at, 'stick', mob.id, t + 500), { ok: false, reason: 'gone' });
  const zone = active.find((z) => mob.id.startsWith(`${z.id}:`))!;
  const back = room.tick(t + (zone.respawnSec ?? 20) * 1000 + 1).find((e) => e.t === 'mob-spawn' && e.id === mob.id);
  assert.ok(back && back.t === 'mob-spawn' && back.hp === mob.maxHp);
});

test('each skill has its own cooldown by its unlock level (Lv 1 the quickest)', () => {
  const room = new MobRoom(map, () => 0.5, { stick: [1, 3, 6, 9, 12, 15, 18] }, { shapes: {} }, loadMobKinds());
  const mob = room.snapshot(0).find((m) => m.id.startsWith('crab-basin:'))!; // (a sturdy one: its shell takes the hits)
  const at: [number, number] = [mob.col + 1, mob.row];
  const lv18 = { cls: 'stick', level: 18 };
  assert.ok(room.attack('p1', at, lv18, mob.id, 0, 6).ok, 'the Lv 18 skill');
  assert.deepEqual(room.attack('p1', at, lv18, mob.id, 1000, 6), { ok: false, reason: 'slow' }, '3.5 s: not yet');
  assert.ok(room.attack('p1', at, lv18, mob.id, 1000, 0).ok, 'another skill is ready');
  assert.ok(room.attack('p1', at, lv18, mob.id, 2050, 0).ok, 'Lv 1: 1 s');
  assert.ok(room.attack('p1', at, lv18, mob.id, 3500, 6).ok, 'the Lv 18 one after 3.5 s');
});

test('a skill is locked until its unlock level', () => {
  const room = new MobRoom(map, () => 0.5, { slingshot: [1, 3, 6, 9, 12, 15, 18] });
  const mob = room.snapshot(0).find((m) => m.id.startsWith('crab-basin:'))!;
  const at: [number, number] = [mob.col + 2, mob.row];
  assert.deepEqual(room.attack('p1', at, 'slingshot', mob.id, 0, 1), { ok: false, reason: 'locked' }, 'Double Tap is Lv 3');
  assert.deepEqual(room.attack('p1', at, { cls: 'slingshot', level: 17 }, mob.id, 0, 6), { ok: false, reason: 'locked' }, 'Volley is Lv 18');
  assert.ok(room.attack('p1', at, { cls: 'slingshot', level: 3 }, mob.id, 0, 1).ok, 'Lv 3: Double Tap');
  assert.ok(room.attack('p2', at, { cls: 'slingshot', level: 18 }, mob.id, 0, 6).ok, 'Lv 18: Volley');
});

test('skill levels: +2% damage and 1% less cooldown a level past 1; slows and roots 5% longer', () => {
  const room = () => new MobRoom(map, () => 0.9, { slingshot: [1, 3, 6, 9, 12, 15, 18] }, { shapes: {}, effects: { slingshot: ['slow:0.5:2500'] } });
  const [a, b] = [room(), room()];
  const wire = a.snapshot(0).find((m) => m.id.startsWith('wire-ridge:'))!; // (sturdy: one hit doesn't kill it)
  const at: [number, number] = [wire.col + 2, wire.row];
  const who = (skill: number) => ({ cls: 'slingshot', level: 11, skills: [skill] });
  const one = a.attack('p1', at, who(1), wire.id, 0, 0);
  const eleven = b.attack('p1', at, who(11), wire.id, 0, 0);
  assert.ok(one.ok && eleven.ok);
  // The same hit at 120% of the skill's % (rounded once, at the end).
  const by = { ...derivedStats(stats, 'slingshot', 11, baseStats(stats, 'slingshot', 11)), level: 11 };
  assert.equal(one.hits[0].damage, hitDamage(stats, by, kindOf(wire.id), skillPct(stats, 1, 1)));
  assert.equal(eleven.hits[0].damage, hitDamage(stats, by, kindOf(wire.id), skillPct(stats, 1) * 1.2));
  assert.ok(eleven.hits[0].damage > one.hits[0].damage);
  // Its slow: 2.5 s at Lv 1, 50% longer at Lv 11.
  assert.deepEqual(one.hits[0].slow, { factor: 0.5, ms: 2500 });
  assert.deepEqual(eleven.hits[0].slow, { factor: 0.5, ms: 3750 });
  // Quick Shot's 1 s cooldown: 0.9 s at Lv 11 (the server's 150 ms of slack either way).
  assert.equal(skillCooldown(stats, baseCooldown(1), 11), 0.9);
  assert.deepEqual(b.attack('p1', at, who(11), wire.id, 700, 0), { ok: false, reason: 'slow' });
  assert.ok(b.attack('p1', at, who(11), wire.id, 760, 0).ok, 'Lv 11: ready after 0.9 s');
  assert.deepEqual(a.attack('p1', at, who(1), wire.id, 760, 0), { ok: false, reason: 'slow' }, 'Lv 1: still 1 s');
});

test('a skill hits the mobs its shape reaches: a chain hops to the nearest, around hits those next to you', () => {
  const room = new MobRoom(map, () => 0.5, {}, { shapes: { slingshot: ['single', 'chain:3'], stick: ['around:4'] } });
  const mobs = room.snapshot(0);
  // A target with another mob within 3 tiles.
  const [a, b] = mobs.flatMap((x) => mobs.filter((y) => y !== x && Math.max(Math.abs(x.col - y.col), Math.abs(x.row - y.row)) <= 3).map((y) => [x, y]))[0];
  const near: [number, number] = [a.col + 1, a.row];
  const single = room.attack('p1', near, 'slingshot', a.id, 0, 0);
  assert.ok(single.ok && single.hits.length === 1 && single.hits[0].id === a.id);
  const chain = room.attack('p1', near, 'slingshot', a.id, 5000, 1);
  assert.ok(chain.ok && chain.hits[0].id === a.id && chain.hits.some((h) => h.id === b.id), 'it hops to the other one');
  assert.ok(chain.ok && chain.hits.length <= 3);
});

test('a slow halves a mob\'s pace for a while; a root keeps it still; both wear off', () => {
  // (On their first skill: a Lv 1's first skill leaves a Tin Can standing.)
  const shapes = { shapes: { slingshot: ['single'], hilot: ['single'] }, effects: { slingshot: ['slow:0.5:2500'], hilot: ['root:2000'] } };
  const room = new MobRoom(map, () => 0.3, {}, shapes);
  const [a, b] = room.snapshot(0);
  const near = (m: { col: number; row: number }): [number, number] => [m.col + 2, m.row];
  const slowed = room.attack('p1', near(a), 'slingshot', a.id, 0, 0);
  assert.ok(slowed.ok && slowed.hits[0].slow?.factor === 0.5);
  // It goes after p1 (who has moved off), at half pace.
  const moves = room.tick(100, new Map([['p1', [a.col + 6, a.row] as [number, number]]])).filter((e) => e.t === 'mob-move' && e.id === a.id);
  assert.ok(moves.length && moves.every((e) => e.t === 'mob-move' && e.speed === 1.2), 'half of 2.4');
  const rooted = room.attack('p2', [b.col + 1, b.row], 'hilot', b.id, 0, 0); // (the Hilot is melee)
  assert.ok(rooted.ok && rooted.hits[0].slow?.factor === 0);
  for (let t = 100; t < 1900; t += 250) assert.ok(!room.tick(t, new Map([['p2', [b.col + 6, b.row] as [number, number]]])).some((e) => e.t === 'mob-move' && e.id === b.id), 'rooted: no hop');
  let freed = false;
  for (let t = 2100; t < 6000 && !freed; t += 250) freed = room.tick(t, new Map([['p2', [b.col + 6, b.row] as [number, number]]])).some((e) => e.t === 'mob-move' && e.id === b.id && !('speed' in e && e.speed));
  assert.ok(freed, 'moving again at its own pace');
});

// ── The kinds' own rules (mobs.json): aggressive zones, packs, the crab's shell, the roller's roll, the bag's drift ──

const kinds = loadMobKinds();
const lcg = (seed = 11) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const zoneOf = (id: string) => active.find((z) => id.startsWith(`${z.id}:`))!;
/** An open tile on a mob's zone level `d` tiles from it (east first). */
function near(room: MobRoom, m: { id: string; col: number; row: number }, d: number): [number, number] {
  const zone = zoneOf(m.id);
  for (const [dc, dr] of [[d, 0], [0, d], [-d, 0], [0, -d], [d, d], [-d, -d], [d, -d], [-d, d]])
    if (room.canStand({ zone, spawn: [m.col, m.row] }, m.col + dc, m.row + dr, 10)) return [m.col + dc, m.row + dr];
  throw new Error(`no tile ${d} from ${m.id}`);
}

test('damage: Power from the class, level, points and worn weapon; the skill\'s tier; a miss now and then against a mob above you', () => {
  const room = new MobRoom(map, () => 0.5, { slingshot: [1, 3, 6, 9, 12, 15, 18] }, { shapes: {} }, kinds);
  const snap = room.snapshot(0);
  const can = snap.find((m) => m.id.startsWith('tin-can-alley:'))!;
  assert.deepEqual(room.attack('p1', [can.col + 2, can.row], 'slingshot', can.id, 0, 7), { ok: false, reason: 'skill' }, 'no 8th skill (no made-up tier)');
  assert.deepEqual(room.attack('p1', [can.col + 2, can.row], 'slingshot', can.id, 0, -1), { ok: false, reason: 'skill' });
  const weapon = [...loadGear().values()].find((i) => i.slot === 'weapon' && i.class === 'slingshot')!;
  // A Lv 1 Slingshot with its training weapon: about 30 a Quick Shot on a Tin Can (two to kill it).
  const r = room.attack('p1', [can.col + 2, can.row], { cls: 'slingshot', gear: [weapon.id] }, can.id, 0, 0);
  assert.ok(r.ok && r.hits[0].damage === hits(hitter('slingshot', 1, weapon.stats.atk), can.id)[0] && !r.hits[0].crit, JSON.stringify(r));
  assert.ok(r.ok && r.hits[0].damage === 30);
  // A higher tier hits harder (from its unlock level: Pebble Spray's 6); so do levels and points.
  assert.deepEqual(room.attack('p1', [can.col + 2, can.row], { cls: 'slingshot', gear: [weapon.id] }, can.id, 5000, 2), { ok: false, reason: 'locked' });
  const t3 = room.attack('p1', [can.col + 2, can.row], { cls: 'slingshot', level: 6, gear: [weapon.id] }, can.id, 5000, 2);
  assert.ok(t3.ok && t3.hits[0].dead, 'tier 3 (169%) finishes it');
  const wire = snap.find((m) => m.id.startsWith('wire-ridge:'))!;
  const lv11 = room.attack('p2', [wire.col + 2, wire.row], { cls: 'slingshot', level: 11, points: { DEX: 10 }, gear: [weapon.id] }, wire.id, 0, 0);
  const by = { ...derivedStats(stats, 'slingshot', 11, baseStats(stats, 'slingshot', 11, { DEX: 10 }), { atk: weapon.stats.atk }), level: 11 };
  assert.ok(lv11.ok && lv11.hits[0].damage === hits(by, wire.id)[0], JSON.stringify(lv11));
  // Lv 1 against the Lv 11 Wire Tangle: 50% to miss (0.3 misses, 0.9 hits for 40% of the damage).
  const miss = new MobRoom(map, () => 0.3, {}, { shapes: {} }, kinds).attack('p3', [wire.col + 2, wire.row], 'slingshot', wire.id, 0, 0);
  assert.ok(miss.ok);
  assert.deepEqual(miss.hits[0], { id: wire.id, damage: 0, crit: false, hp: wire.maxHp, dead: false, miss: true });
  const land = new MobRoom(map, () => 0.9, {}, { shapes: {} }, kinds).attack('p3', [wire.col + 2, wire.row], 'slingshot', wire.id, 0, 0);
  assert.ok(land.ok && !land.hits[0].miss && land.hits[0].damage === hits(hitter('slingshot'), wire.id)[0]);
  assert.equal(levelGap(stats, 1, wire.level).mult, stats.damage.levelGap.minMult);
});

test('an aggressive zone\'s mob comes for a player within its aggroRange, attacks next to them, and walks home past its leash', () => {
  const room = new MobRoom(map, lcg(), {}, { shapes: {} }, kinds);
  const tire = room.snapshot(0).find((m) => m.id.startsWith('tire-yard:'))!;
  const zone = zoneOf(tire.id);
  assert.equal(zone.aggro, 'aggressive');
  // Out of its range: left alone.
  const far = near(room, tire, (zone.aggroRange ?? 4) + 2);
  for (let t = 0; t < 3000; t += 250) assert.ok(!room.tick(t, new Map([['p1', far]])).some((e) => e.t === 'mob-attack' && e.id === tire.id));
  // Within it: after them, then an attack.
  let p = near(room, room.snapshot(3000).find((m) => m.id === tire.id)!, 3);
  let attacked = false;
  let t = 3000;
  for (; t < 15_000 && !attacked; t += 250) attacked = room.tick(t, new Map([['p1', p]])).some((e) => e.t === 'mob-attack' && e.id === tire.id && e.target === 'p1');
  assert.ok(attacked, 'it came and attacked');
  // Past its leash: home.
  const home = tire;
  p = [home.col + (zone.leash ?? 10) + 1, home.row];
  const moves = [];
  for (let k = 0; k < 12; k++, t += 250) moves.push(...room.tick(t, new Map([['p1', p]])).filter((e) => e.t === 'mob-move' && e.id === tire.id));
  const back = moves[0];
  assert.ok(back && back.t === 'mob-move' && back.path.at(-1)![0] === home.col && back.path.at(-1)![1] === home.row, 'walked home');
});

test('a passive zone\'s mob leaves a player next to it alone', () => {
  const room = new MobRoom(map, lcg(), {}, { shapes: {} }, kinds);
  const can = room.snapshot(0).find((m) => m.id.startsWith('tin-can-alley:'))!;
  const p = near(room, can, 1);
  for (let t = 0; t < 6000; t += 250) assert.ok(!room.tick(t, new Map([['p1', p]])).some((e) => e.t === 'mob-attack'));
});

test('a Bottle Caps spawn point is a pack of 3–5, each cap its own mob with an id of its own, the same every time', () => {
  const a = new MobRoom(map, Math.random, {}, { shapes: {} }, kinds).snapshot(0);
  const b = new MobRoom(map, Math.random, {}, { shapes: {} }, kinds).snapshot(0);
  assert.deepEqual(a.map((m) => [m.id, m.col, m.row, m.variant]), b.map((m) => [m.id, m.col, m.row, m.variant]));
  assert.equal(new Set(a.map((m) => m.id)).size, a.length, 'ids unique');
  const lot = (map.mobZones ?? []).find((z) => z.id === 'bottle-cap-lot')!;
  const sizes = lot.spawns.map((_, i) => a.filter((m) => m.id.startsWith(`bottle-cap-lot:${i}:`)).length);
  assert.deepEqual(sizes, lot.spawns.map((_, i) => packSize(`bottle-cap-lot:${i}`, kinds['bottle-caps'].pack!)));
  assert.ok(sizes.every((n) => n >= 3 && n <= 5) && new Set(sizes).size > 1, sizes.join(','));
  for (let i = 0; i < lot.spawns.length; i++) {
    const caps = a.filter((m) => m.id.startsWith(`bottle-cap-lot:${i}:`));
    assert.equal(new Set(caps.map((m) => `${m.col},${m.row}`)).size, caps.length, 'a tile each');
    for (const c of caps) assert.ok(Math.max(Math.abs(c.col - lot.spawns[i][0]), Math.abs(c.row - lot.spawns[i][1])) <= 1, 'round the point');
  }
  assert.ok(a.length > 220 && a.length < 280, `${a.length} mobs`);
});

test('a pack\'s followers keep near their leader; with the leader dead the next cap leads', () => {
  const room = new MobRoom(map, lcg(5), {}, { shapes: {} }, kinds);
  const caps = (now: number) => room.snapshot(now).filter((m) => m.id.startsWith('bottle-cap-lot:0:'));
  const endOf = (m: { col: number; row: number; path?: [number, number][] }): [number, number] => m.path?.at(-1) ?? [m.col, m.row];
  let far = 0;
  let checks = 0;
  for (let t = 0; t < 120_000; t += 250) {
    room.tick(t);
    if (t % 5000) continue;
    const [lead, ...rest] = caps(t);
    for (const f of rest) {
      checks++;
      if (Math.max(Math.abs(endOf(f)[0] - endOf(lead)[0]), Math.abs(endOf(f)[1] - endOf(lead)[1])) > 3) far++;
    }
  }
  assert.ok(far / checks < 0.15, `${far}/${checks} away from the leader`);
  // The leader dies: the others follow the next.
  let t = 120_000;
  const leader = caps(t)[0];
  while (true) {
    const r = room.attack('p1', [leader.col, leader.row], 'slingshot', leader.id, (t += 1000));
    if (r.ok && r.hits[0].dead) break;
  }
  room.forget('p1');
  far = 0;
  checks = 0;
  for (t += 250; t < 240_000; t += 250) {
    room.tick(t);
    if (t % 5000) continue;
    const live = caps(t).filter((m) => !m.dead);
    if (live[0].id === leader.id) break; // back
    assert.notEqual(live[0].id, leader.id);
    for (const f of live.slice(1)) {
      checks++;
      if (Math.max(Math.abs(endOf(f)[0] - endOf(live[0])[0]), Math.abs(endOf(f)[1] - endOf(live[0])[1])) > 3) far++;
    }
  }
  assert.ok(checks && far / checks < 0.2, `${far}/${checks} away from the new leader`);
});

test('hitting one cap makes the whole pack fight that player', () => {
  const room = new MobRoom(map, lcg(3), {}, { shapes: {} }, kinds);
  const caps = room.snapshot(0).filter((m) => m.id.startsWith('bottle-cap-lot:1:'));
  const p = near(room, caps[0], 2);
  assert.ok(room.attack('p1', p, 'slingshot', caps[caps.length - 1].id, 0).ok);
  const fought = new Set<string>();
  for (let t = 250; t < 8000; t += 250) for (const e of room.tick(t, new Map([['p1', p]]))) if (e.t === 'mob-attack' && e.target === 'p1') fought.add(e.id);
  assert.deepEqual([...fought].sort(), caps.map((c) => c.id).sort());
  // Not all on one tile next to them.
  const at = room.snapshot(8000).filter((m) => m.id.startsWith('bottle-cap-lot:1:')).map((m) => `${m.col},${m.row}`);
  assert.ok(new Set(at).size >= Math.min(3, caps.length), at.join(' '));
});

test('facing: the art\'s four ways, the diagonals between as the game shows a step', () => {
  assert.equal(facingTo(1, 0), 'se');
  assert.equal(facingTo(0, 1), 'sw');
  assert.equal(facingTo(-1, 0), 'nw');
  assert.equal(facingTo(0, -1), 'ne');
  assert.equal(facingTo(1, 1), 'se'); // S → SE
  assert.equal(facingTo(1, -1), 'se'); // E → SE
  assert.equal(facingTo(-1, 1), 'sw'); // W → SW
  assert.equal(facingTo(-1, -1), 'ne'); // N → NE
  assert.equal(facingTo(5, 2), 'se');
  assert.equal(facingTo(0, 0), null);
});

test('a Scrap Crab\'s shell blocks every hit, from any side, except for a moment after each of its own attacks', () => {
  const room = new MobRoom(map, () => 0.5, {}, { shapes: {} }, kinds);
  const crab = room.snapshot(0).find((m) => m.id.startsWith('crab-basin:'))!;
  const open = kinds['scrap-crab'].shellOpenMs!;
  assert.ok(open >= 1000, 'long enough to land a hit or two');
  // Shell up: blocked from the front, behind, a side; area skills too.
  for (const [dc, dr] of [[2, 0], [-2, 0], [0, 2], [1, 1]]) {
    const r = room.attack(`p${dc}${dr}`, [crab.col + dc, crab.row + dr], 'slingshot', crab.id, 0);
    assert.ok(r.ok);
    assert.deepEqual(r.hits[0], { id: crab.id, damage: 0, crit: false, hp: crab.maxHp, dead: false, blocked: true });
  }
  // It comes for the last of them and swings: its shell is down for `open` ms from that swing.
  const me = near(room, crab, 1);
  const players = new Map([['p1-1', me]]);
  let swing = -1;
  for (let t = 250; t < 20_000 && swing < 0; t += 250)
    for (const e of room.tick(t, players)) if (e.t === 'mob-attack' && e.id === crab.id) swing = t;
  assert.ok(swing > 0, 'it swung');
  const now = room.snapshot(swing).find((m) => m.id === crab.id)!;
  // (A Lv 13 Slingshot: no misses against the Lv 13 crab.)
  const down = room.attack('p1-1', [now.col + 1, now.row], { cls: 'slingshot', level: 13 }, crab.id, swing + 100);
  assert.ok(down.ok && down.hits[0].damage > 0 && !down.hits[0].blocked, 'shell down');
  const up = room.attack('p1-1', [now.col + 1, now.row], 'slingshot', crab.id, swing + open + 1);
  assert.ok(up.ok && up.hits[0].blocked, 'shell back up');
});

test('mobs face the way they last stepped (a newcomer sees it)', () => {
  const room = new MobRoom(map, lcg(9), {}, { shapes: {} }, kinds);
  const ends = new Map<string, [number, number][]>();
  for (let t = 0; t < 20_000; t += 250) for (const e of room.tick(t)) if (e.t === 'mob-move') ends.set(e.id, e.path);
  const snap = new Map(room.snapshot(60_000).map((m) => [m.id, m]));
  let checked = 0;
  for (const [id, path] of ends) {
    const m = snap.get(id)!;
    if (m.path || path.length < 2) continue;
    const [a, b] = [path.at(-2)!, path.at(-1)!];
    if (m.col !== b[0] || m.row !== b[1]) continue;
    assert.equal(m.dir, facingTo(b[0] - a[0], b[1] - a[1]), id);
    checked++;
  }
  assert.ok(checked > 50, `${checked}`);
});

test('a Tire Roller sometimes rolls a tile or two straight on, quicker; a Plastic Bag Spook drifts at its own pace', () => {
  const room = new MobRoom(map, lcg(2), {}, { shapes: {} }, kinds);
  let rolls = 0;
  let drifts = 0;
  for (let t = 0; t < 60_000; t += 250)
    for (const e of room.tick(t)) {
      if (e.t !== 'mob-move') continue;
      if (e.id.startsWith('tire-yard:') && e.speed === kinds['tire-roller'].roll!.speed) {
        rolls++;
        assert.ok(e.path.length >= 2 && e.path.length <= 3, 'a tile or two');
        const [dc, dr] = [e.path[1][0] - e.path[0][0], e.path[1][1] - e.path[0][1]];
        assert.ok(Math.abs(dc) + Math.abs(dr) === 1, 'along one way');
        for (let i = 1; i < e.path.length; i++) assert.deepEqual([e.path[i][0] - e.path[i - 1][0], e.path[i][1] - e.path[i - 1][1]], [dc, dr], 'straight');
      }
      if (e.id.startsWith('bag-flats:')) {
        drifts++;
        assert.equal(e.speed, kinds['plastic-bag-spook'].drift!.speed);
      }
    }
  assert.ok(rolls > 5, `${rolls} rolls`);
  assert.ok(drifts > 28 * 3, `${drifts} drifts (short rests)`);
});

test('mob attacks: the Wire Tangle zaps from its reach, the Bag slows (for show), each turned to face the player', () => {
  const room = new MobRoom(map, lcg(4), {}, { shapes: {} }, kinds);
  const snap = room.snapshot(0);
  const wire = snap.find((m) => m.id.startsWith('wire-ridge:'))!;
  const p = near(room, wire, 3);
  const zaps = [];
  for (let t = 0; t < 3000; t += 250) zaps.push(...room.tick(t, new Map([['p1', p]])).filter((e) => e.t === 'mob-attack' && e.id === wire.id));
  assert.ok(zaps.length, 'it zaps from 3 tiles');
  assert.equal(room.snapshot(3000).find((m) => m.id === wire.id)!.col, wire.col, 'without coming closer');
  const z = zaps[0];
  assert.ok(z.t === 'mob-attack' && z.dir === facingTo(p[0] - wire.col, p[1] - wire.row));
  const bag = snap.find((m) => m.id.startsWith('bag-flats:'))!;
  const q = near(room, bag, 1);
  let slow: number | undefined;
  for (let t = 3000; t < 8000 && slow === undefined; t += 250) {
    const e = room.tick(t, new Map([['p2', q]])).find((x) => x.t === 'mob-attack' && x.id === bag.id);
    if (e && e.t === 'mob-attack') slow = e.slow;
  }
  assert.equal(slow, kinds['plastic-bag-spook'].slowMs);
});

test('a quarter-second tick with every mob and a few players fighting stays cheap', () => {
  const room = new MobRoom(map, lcg(8), {}, { shapes: {} }, kinds);
  const snap = room.snapshot(0);
  // Five players: in the Tire Yard, the Bag Flats, the Crab Basin, by a pack (hit), on the Wire Ridge.
  const players = new Map<string, [number, number]>();
  for (const [i, z] of ['tire-yard:3', 'bag-flats:5', 'crab-basin:2', 'bottle-cap-lot:4:0', 'wire-ridge:7'].entries()) players.set(`p${i}`, near(room, snap.find((m) => m.id === z)!, 2));
  room.attack('p3', players.get('p3')!, 'slingshot', 'bottle-cap-lot:4:0', 0);
  for (let t = 0; t < 10_000; t += 250) room.tick(t, players); // warm up
  const t0 = performance.now();
  let n = 0;
  for (let t = 10_000; t < 70_000; t += 250, n++) room.tick(t, players);
  const ms = (performance.now() - t0) / n;
  console.log(`  tick: ${ms.toFixed(3)} ms with ${room.size} mobs and ${players.size} players`);
  assert.ok(ms < 5, `${ms} ms`);
});

test('over the town\'s socket: a kill\'s XP goes to the killer; a level-up shows to everyone in the room, the progress to them only', async () => {
  const room = new MobRoom(map, lcg(9), {}, { shapes: {} }, kinds);
  const can = room.snapshot(0).find((m) => m.id.startsWith('tin-can-alley:'))!;
  // Mara is one Tin Can short of Lv 2, and strong enough to finish it in one hit.
  const fresh = freshProgress(stats, 'slingshot');
  let mara: SavedProgress = { ...fresh, xp: fresh.next - 1 };
  const server = createServer();
  attachTown(server, {
    map: { size: [4, 4], spawn: [1, 1], blocked: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
    rooms: { slums: () => ({ size: map.size, spawn: [can.col + 1, can.row], blocked: map.blocked }) },
    mobs: { slums: room },
    authenticate: async (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('as'),
    profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} as never, cls: 'slingshot' }),
    progress: {
      fighter: (name) => ({ cls: 'slingshot', level: name === 'Mara' ? stats.levelCap : 1, points: name === 'Mara' ? { DEX: 100_000 } : {} }),
      kill: (_name, mob) => {
        const r = killXp(stats, 'slingshot', mara, mob);
        mara = r.progress;
        return r;
      },
    },
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  const open = (as: string) =>
    new Promise<{ ws: WebSocket; got: TownServerMessage[] }>((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?as=${as}&room=slums`);
      const got: TownServerMessage[] = [];
      ws.on('message', (d) => got.push(JSON.parse(String(d))));
      ws.on('open', () => ok({ ws, got }));
    });
  const a = await open('Mara');
  const b = await open('Bob');
  await new Promise((ok) => setTimeout(ok, 100));
  const maraId = (a.got.find((m) => m.t === 'welcome') as Extract<TownServerMessage, { t: 'welcome' }>).you;
  a.ws.send(JSON.stringify({ t: 'attack', mob: can.id, skill: 0 }));
  await new Promise((ok) => setTimeout(ok, 200));
  const hit = a.got.find((m) => m.t === 'mob-hit');
  assert.ok(hit && hit.t === 'mob-hit' && hit.hits[0].dead, JSON.stringify(a.got.filter((m) => m.t !== 'welcome' && m.t !== 'mobs')));
  const progress = a.got.find((m) => m.t === 'progress');
  assert.ok(progress && progress.t === 'progress' && progress.progress.level === 2 && progress.progress.skillPoints === stats.skills.skillPointsPerLevelUp);
  assert.ok((progress.gained ?? 0) >= 1);
  for (const c of [a, b]) assert.deepEqual(c.got.filter((m) => m.t === 'level-up'), [{ t: 'level-up', id: maraId, level: 2 }]);
  assert.ok(!b.got.some((m) => m.t === 'progress'), 'Bob only sees the level-up');
  for (const c of [a, b]) c.ws.close();
  await new Promise((ok) => server.close(ok));
});

test('the town passes on a movement skill only from its unlock level, and only the class\'s own', async () => {
  const server = createServer();
  const open6 = Array.from({ length: 6 }, () => Array(6).fill(0));
  const level: Record<string, number> = { Ann: 4, Mara: 5, Bob: 1 };
  attachTown(server, {
    map: { size: [6, 6], spawn: [1, 1], blocked: open6 },
    authenticate: async (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('as'),
    profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} as never, cls: 'slingshot', level: level[name] }),
    moveLevel: (cls, move) => (cls === 'slingshot' ? ({ dash: 5, 'step-back': 8 } as Record<string, number>)[move] ?? null : null),
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  const open = (as: string) =>
    new Promise<{ ws: WebSocket; got: TownServerMessage[] }>((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?as=${as}`);
      const got: TownServerMessage[] = [];
      ws.on('message', (d) => got.push(JSON.parse(String(d))));
      ws.on('open', () => ok({ ws, got }));
    });
  const [ann, mara, bob] = [await open('Ann'), await open('Mara'), await open('Bob')];
  await new Promise((ok) => setTimeout(ok, 100));
  const idOf = (c: { got: TownServerMessage[] }) => (c.got.find((m) => m.t === 'welcome') as Extract<TownServerMessage, { t: 'welcome' }>).you;
  const to = { col: 2, row: 2 }; // (anywhere near: the 6 × 6 map)
  ann.ws.send(JSON.stringify({ t: 'move', move: 'dash', ...to })); // Lv 4: Dash is Lv 5
  mara.ws.send(JSON.stringify({ t: 'move', move: 'blink', ...to })); // not the Slingshot's
  mara.ws.send(JSON.stringify({ t: 'move', move: 'step-back', ...to })); // Lv 8
  mara.ws.send(JSON.stringify({ t: 'move', move: 'dash', ...to }));
  await new Promise((ok) => setTimeout(ok, 200));
  const seen = bob.got.filter((m) => m.t === 'move');
  assert.deepEqual(seen.map((m) => m.t === 'move' && [m.id, m.move]), [[idOf(mara), 'dash']]);
  for (const c of [ann, mara, bob]) c.ws.close();
  await new Promise((ok) => server.close(ok));
});
