import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { type AttackResult, MobRoom, loadMobKinds, loadMobMap } from './town-mobs.js';

// The Slums' mobs on the real map (the game's maps/slums.json): where they stand, how they hop, what newcomers see.

const map = loadMobMap('slums');
const active = (map.mobZones ?? []).filter((z) => z.active);

test('one mob per spawn of each zone that is on, with a level in its range that is the same every time', () => {
  const a = new MobRoom(map);
  const b = new MobRoom(map);
  assert.equal(a.size, active.reduce((n, z) => n + z.spawns.length, 0));
  const now = Date.now();
  const sa = a.snapshot(now);
  assert.deepEqual(sa.map((m) => m.level), b.snapshot(now).map((m) => m.level));
  for (const m of sa) {
    const zone = active.find((z) => m.id.startsWith(`${z.id}:`))!;
    assert.ok(m.level >= zone.level[0] && m.level <= zone.level[1], `${m.id} level ${m.level}`);
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

test('a hit takes 20 (25 on a crit) from 100, the mob goes after its foe, dies at 0 and comes back after respawnSec', () => {
  let n = 0;
  const room = new MobRoom(map, () => ((n = (n * 9301 + 49297) % 233280) / 233280));
  const mob = room.snapshot(0)[0];
  const at: [number, number] = [mob.col + 1, mob.row];
  const far: [number, number] = [mob.col + 9, mob.row];
  assert.deepEqual(room.attack('p1', far, 'stick', mob.id, 1000), { ok: false, reason: 'range' });
  assert.equal(room.attack('p1', far, 'slingshot', mob.id, 1000).ok, false, '9 tiles is past the slingshot too');
  const first = room.attack('p1', at, 'stick', mob.id, 1000);
  assert.ok(first.ok && (first.hits[0].damage === 20 || first.hits[0].damage === 25) && first.hits[0].hp === 100 - first.hits[0].damage);
  assert.deepEqual(room.attack('p1', at, 'stick', mob.id, 1100), { ok: false, reason: 'slow' });
  // Next to it: it attacks back.
  const events = room.tick(1200, (id) => (id === 'p1' ? at : null));
  assert.ok(events.some((e) => e.t === 'mob-attack' && e.id === mob.id && e.target === 'p1'));
  let t = 1000;
  let last: AttackResult = first;
  while (last.ok && !last.hits[0].dead) last = room.attack("p1", at, "stick", mob.id, (t += 1000));
  assert.ok(last.ok && last.hits[0].dead && last.hits[0].hp === 0);
  assert.equal(room.snapshot(t)[0].dead, true);
  assert.deepEqual(room.attack('p1', at, 'stick', mob.id, t + 500), { ok: false, reason: 'gone' });
  const zone = active.find((z) => mob.id.startsWith(`${z.id}:`))!;
  const back = room.tick(t + (zone.respawnSec ?? 20) * 1000 + 1).find((e) => e.t === 'mob-spawn' && e.id === mob.id);
  assert.ok(back && back.t === 'mob-spawn' && back.hp === 100);
});

test('each skill has its own cooldown by its level (Lv 1 the quickest)', () => {
  const room = new MobRoom(map, () => 0.5, { stick: [1, 3, 6, 9, 12, 15, 18] });
  const mob = room.snapshot(0)[0];
  const at: [number, number] = [mob.col + 1, mob.row];
  assert.ok(room.attack('p1', at, 'stick', mob.id, 0, 6).ok, 'the Lv 18 skill');
  assert.deepEqual(room.attack('p1', at, 'stick', mob.id, 1000, 6), { ok: false, reason: 'slow' }, '3.5 s: not yet');
  assert.ok(room.attack('p1', at, 'stick', mob.id, 1000, 0).ok, 'another skill is ready');
  assert.ok(room.attack('p1', at, 'stick', mob.id, 2050, 0).ok, 'Lv 1: 1 s');
  assert.ok(room.attack('p1', at, 'stick', mob.id, 3500, 6).ok, 'the Lv 18 one after 3.5 s');
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
  const shapes = { shapes: { slingshot: ['single', 'single', 'single', 'single', 'single', 'single'], hilot: ['single', 'single', 'single', 'single', 'single'] }, effects: { slingshot: [null, null, null, null, null, 'slow:0.5:2500'], hilot: [null, null, null, null, 'root:2000'] } };
  const room = new MobRoom(map, () => 0.3, {}, shapes);
  const [a, b] = room.snapshot(0);
  const near = (m: { col: number; row: number }): [number, number] => [m.col + 2, m.row];
  const slowed = room.attack('p1', near(a), 'slingshot', a.id, 0, 5);
  assert.ok(slowed.ok && slowed.hits[0].slow?.factor === 0.5);
  // It goes after p1 (who has moved off), at half pace.
  const moves = room.tick(100, (id) => (id === 'p1' ? [a.col + 6, a.row] : null)).filter((e) => e.t === 'mob-move' && e.id === a.id);
  assert.ok(moves.length && moves.every((e) => e.t === 'mob-move' && e.speed === 1.2), 'half of 2.4');
  const rooted = room.attack('p2', [b.col + 1, b.row], 'hilot', b.id, 0, 4); // (the Hilot is melee)
  assert.ok(rooted.ok && rooted.hits[0].slow?.factor === 0);
  for (let t = 100; t < 1900; t += 250) assert.ok(!room.tick(t, (id) => (id === 'p2' ? [b.col + 6, b.row] : null)).some((e) => e.t === 'mob-move' && e.id === b.id), 'rooted: no hop');
  let freed = false;
  for (let t = 2100; t < 6000 && !freed; t += 250) freed = room.tick(t, (id) => (id === 'p2' ? [b.col + 6, b.row] : null)).some((e) => e.t === 'mob-move' && e.id === b.id && !('speed' in e && e.speed));
  assert.ok(freed, 'moving again at its own pace');
});
