import { readFileSync } from 'node:fs';
import type { TownMob } from '@mikazuki/shared';

// 🥫 The Slums' mobs, run on the server so every player sees the same ones in the same places (no combat yet). One per
// spawn tile of each zone that's on (`active` in the game's maps/slums.json): a level rolled once in its zone's range,
// and now and then a hop of a few tiles round its spawn: at most ROAM away, on its zone's level, on open tiles that
// aren't ramps or in the safe zone. A hop is sent to the room as a path; the game walks it at SPEED. Pure (no Discord),
// so it's tested on its own and the dev server runs it too.

const ROAM = 3;
const SPEED = 2.4; // tiles per second (the game walks them at the same pace)
const REST_MS: [number, number] = [2200, 6500];

export interface MobZoneData {
  id: string;
  mob: string;
  level: [number, number];
  height: number;
  active: boolean;
  spawns: [number, number][];
}

export interface MobMapData {
  size: [number, number];
  blocked: number[][];
  height?: number[][];
  ramps?: { col: number; row: number }[];
  safeZone?: [number, number, number, number];
  mobZones?: MobZoneData[];
}

interface Mob {
  id: string;
  zone: MobZoneData;
  level: number;
  spawn: [number, number];
  /** Where it is (or, mid-hop, where the hop started). */
  col: number;
  row: number;
  path: [number, number][];
  hopAt: number;
  restUntil: number;
}

/** The mobs' data from a map file (maps/<name>.json in the game's assets). */
export function loadMobMap(name: string): MobMapData {
  return JSON.parse(readFileSync(new URL(`../../../game/public/assets/maps/${name}.json`, import.meta.url), 'utf8')) as MobMapData;
}

/** A small seeded number (0–1) from a string, so a mob's level is the same on every restart. */
function seeded(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

export class MobRoom {
  private readonly mobs: Mob[] = [];
  private readonly ramps = new Set<string>();

  constructor(
    private readonly map: MobMapData,
    private readonly random: () => number = Math.random,
  ) {
    for (const r of map.ramps ?? []) this.ramps.add(`${r.col},${r.row}`);
    for (const zone of map.mobZones ?? []) {
      if (!zone.active) continue;
      zone.spawns.forEach(([col, row], i) => {
        const id = `${zone.id}:${i}`;
        const [lo, hi] = zone.level;
        this.mobs.push({ id, zone, level: lo + Math.floor(seeded(id) * (hi - lo + 1)), spawn: [col, row], col, row, path: [], hopAt: 0, restUntil: 0 });
      });
    }
  }

  get size(): number {
    return this.mobs.length;
  }

  /** Where a mob may stand: open, on its zone's level, not a ramp, outside the safe zone, close to its spawn. */
  canStand(m: { zone: MobZoneData; spawn: [number, number] }, col: number, row: number): boolean {
    const [cols, rows] = this.map.size;
    if (col < 0 || row < 0 || col >= cols || row >= rows || this.map.blocked[row]?.[col]) return false;
    if ((this.map.height?.[row]?.[col] ?? 0) !== m.zone.height || this.ramps.has(`${col},${row}`)) return false;
    const [c0, r0, c1, r1] = this.map.safeZone ?? [-1, -1, -2, -2];
    if (col >= c0 && col <= c1 && row >= r0 && row <= r1) return false;
    return Math.max(Math.abs(col - m.spawn[0]), Math.abs(row - m.spawn[1])) <= ROAM;
  }

  /** The shortest way (8 directions, no cut corners) over tiles it may stand on, or null. */
  private route(m: Mob, to: [number, number]): [number, number][] | null {
    const key = (c: number, r: number) => `${c},${r}`;
    const came = new Map<string, string | null>([[key(m.col, m.row), null]]);
    const queue: [number, number][] = [[m.col, m.row]];
    for (let i = 0; i < queue.length; i++) {
      const [c, r] = queue[i];
      if (c === to[0] && r === to[1]) {
        const path: [number, number][] = [];
        for (let k: string | null = key(c, r); k; k = came.get(k) ?? null) path.push(k.split(',').map(Number) as [number, number]);
        return path.reverse().slice(1);
      }
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nc = c + dc;
        const nr = r + dr;
        if (came.has(key(nc, nr)) || !this.canStand(m, nc, nr)) continue;
        if (dc && dr && (!this.canStand(m, c + dc, r) || !this.canStand(m, c, r + dr))) continue;
        came.set(key(nc, nr), key(c, r));
        queue.push([nc, nr]);
      }
    }
    return null;
  }

  /** Moves the clock on: mobs whose hop is over land, rested ones start a new hop (returned, to send to the room). */
  tick(now: number): { id: string; path: [number, number][] }[] {
    const hops: { id: string; path: [number, number][] }[] = [];
    for (const m of this.mobs) {
      if (m.path.length && now >= m.hopAt + (m.path.length / SPEED) * 1000) {
        [m.col, m.row] = m.path[m.path.length - 1];
        m.path = [];
        m.restUntil = now + REST_MS[0] + this.random() * (REST_MS[1] - REST_MS[0]);
      }
      if (m.path.length || now < m.restUntil) continue;
      for (let tries = 0; tries < 6; tries++) {
        const to: [number, number] = [m.spawn[0] + Math.round((this.random() * 2 - 1) * ROAM), m.spawn[1] + Math.round((this.random() * 2 - 1) * ROAM)];
        if ((to[0] === m.col && to[1] === m.row) || !this.canStand(m, to[0], to[1])) continue;
        const path = this.route(m, to);
        if (!path?.length) continue;
        m.path = path;
        m.hopAt = now;
        hops.push({ id: m.id, path: [[m.col, m.row], ...path] });
        break;
      }
      if (!m.path.length) m.restUntil = now + REST_MS[0];
    }
    return hops;
  }

  /** Every mob as a newcomer should see it: where it is and the rest of a hop under way. */
  snapshot(now: number): TownMob[] {
    return this.mobs.map((m) => {
      const done = Math.floor(((now - m.hopAt) / 1000) * SPEED);
      const left = m.path.length ? m.path.slice(Math.min(done, m.path.length - 1)) : [];
      const at = m.path.length && done > 0 ? m.path[Math.min(done, m.path.length) - 1] : [m.col, m.row];
      return { id: m.id, col: at[0], row: at[1], level: m.level, ...(left.length ? { path: left } : {}) };
    });
  }
}
