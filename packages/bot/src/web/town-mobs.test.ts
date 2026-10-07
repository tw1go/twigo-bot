import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MobRoom, loadMobMap } from './town-mobs.js';

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
    for (const h of room.tick(t)) {
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
  const hop = room.tick(10_000).find((h) => h.path.length >= 3)!;
  assert.ok(hop, 'a hop of 2+ tiles');
  const mid = room.snapshot(10_000 + 500).find((m) => m.id === hop.id)!; // 2.4 tiles/s: one tile in
  assert.deepEqual([mid.col, mid.row], hop.path[1]);
  assert.deepEqual(mid.path?.[mid.path.length - 1], hop.path[hop.path.length - 1]);
});
