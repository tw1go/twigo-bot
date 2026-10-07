import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type AttackResult, MobRoom, loadMobMap } from './town-mobs.js';

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

test('hops stay near the spawn, on the zone level, off ramps, blocked tiles and the safe zone', () => {
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
      for (const [col, row] of h.path.slice(1)) assert.ok(room.canStand(m, col, row), `${h.id} → ${col},${row}`);
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
  assert.ok(first.ok && (first.damage === 20 || first.damage === 25) && first.hp === 100 - first.damage);
  assert.deepEqual(room.attack('p1', at, 'stick', mob.id, 1100), { ok: false, reason: 'slow' });
  // Next to it: it attacks back.
  const events = room.tick(1200, (id) => (id === 'p1' ? at : null));
  assert.ok(events.some((e) => e.t === 'mob-attack' && e.id === mob.id && e.target === 'p1'));
  let t = 1000;
  let last: AttackResult = first;
  while (last.ok && !last.dead) last = room.attack('p1', at, 'stick', mob.id, (t += 500));
  assert.ok(last.ok && last.dead && last.hp === 0);
  assert.equal(room.snapshot(t)[0].dead, true);
  assert.deepEqual(room.attack('p1', at, 'stick', mob.id, t + 500), { ok: false, reason: 'gone' });
  const zone = active.find((z) => mob.id.startsWith(`${z.id}:`))!;
  const back = room.tick(t + (zone.respawnSec ?? 20) * 1000 + 1).find((e) => e.t === 'mob-spawn' && e.id === mob.id);
  assert.ok(back && back.t === 'mob-spawn' && back.hp === 100);
});
