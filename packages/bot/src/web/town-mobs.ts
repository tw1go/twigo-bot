import { readFileSync } from 'node:fs';
import type { TownMob } from '@mikazuki/shared';

// 🥫 The Slums' mobs, run on the server so every player sees the same ones in the same places, and fought there. One per
// spawn tile of each zone that's on (`active` in the game's maps/slums.json): a level rolled once in its zone's range,
// and now and then a hop of a few tiles round its spawn: at most ROAM away, on its zone's level, on open tiles that
// aren't ramps or in the safe zone. A hop is sent to the room as a path; the game walks it at SPEED. Pure (no Discord),
// so it's tested on its own and the dev server runs it too.
//
// Battle (for now): every mob has MOB_HP; any class hits for HIT (CRIT on a crit, CRIT_CHANCE), from the next tile with
// a melee class or up to RANGED tiles with a ranged one. A mob that's hit fights back: it goes after whoever hit it last
// (within its zone's leash from its spawn), and next to them attacks every ATTACK_MS (shown only: players have no HP
// yet); it gives up and walks home when they're gone, out of its leash, or haven't hit it for GIVE_UP_MS. At 0 HP it
// dies and comes back at its spawn after its zone's respawnSec. Each skill has its own cooldown by the level it's learnt
// at (skillCooldown: Lv 1 the quickest; the game shows the same, combat/cooldowns.ts).

const ROAM = 3;
const SPEED = 2.4; // tiles per second (the game walks them at the same pace)
const REST_MS: [number, number] = [2200, 6500];
export const MOB_HP = 100;
const HIT = 20;
const CRIT = 25;
const CRIT_CHANCE = 0.15;
const RANGED = 5;
/** The classes that fight from afar; the rest hit from the next tile. */
const RANGED_CLASSES = new Set(['slingshot', 'broom', 'hilot']);
const ATTACK_MS = 1600;
const GIVE_UP_MS = 12_000;
const SWING_MS = 400; // a player's attacks: no faster than this

/** A skill's cooldown (s) by the level it's learnt at: 0.8 + 0.15 a level, to a tenth (Lv 1: 1 s … Lv 18: 3.5 s). Keep in
 *  step with the game's combat/cooldowns.ts. */
export const skillCooldown = (level: number) => Math.round((0.8 + 0.15 * Math.max(1, level)) * 10) / 10;

export type MobEvent =
  | { t: 'mob-move'; id: string; path: [number, number][] }
  | { t: 'mob-attack'; id: string; target: string }
  | { t: 'mob-spawn'; id: string; col: number; row: number; hp: number };

export type AttackResult =
  | { ok: true; id: string; damage: number; crit: boolean; hp: number; dead: boolean }
  | { ok: false; reason: 'range' | 'slow' | 'gone' };

/** Each class's damage skills' levels, in their order (classes.json). */
export type SkillLevels = Record<string, number[]>;

export interface MobZoneData {
  id: string;
  mob: string;
  level: [number, number];
  height: number;
  active: boolean;
  spawns: [number, number][];
  leash?: number;
  respawnSec?: number;
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
  hp: number;
  /** Dead until then (ms), or 0. */
  respawnAt: number;
  /** Who it's after, and when they last hit it. */
  foe: { id: string; at: number } | null;
  nextAttack: number;
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
    private readonly levels: SkillLevels = {},
  ) {
    for (const r of map.ramps ?? []) this.ramps.add(`${r.col},${r.row}`);
    for (const zone of map.mobZones ?? []) {
      if (!zone.active) continue;
      zone.spawns.forEach(([col, row], i) => {
        const id = `${zone.id}:${i}`;
        const [lo, hi] = zone.level;
        this.mobs.push({ id, zone, level: lo + Math.floor(seeded(id) * (hi - lo + 1)), spawn: [col, row], col, row, path: [], hopAt: 0, restUntil: 0, hp: MOB_HP, respawnAt: 0, foe: null, nextAttack: 0 });
      });
    }
  }

  get size(): number {
    return this.mobs.length;
  }

  /** Where a mob may stand: open, on its zone's level, not a ramp, outside the safe zone, close to its spawn. */
  canStand(m: { zone: MobZoneData; spawn: [number, number] }, col: number, row: number, reach = ROAM): boolean {
    const [cols, rows] = this.map.size;
    if (col < 0 || row < 0 || col >= cols || row >= rows || this.map.blocked[row]?.[col]) return false;
    if ((this.map.height?.[row]?.[col] ?? 0) !== m.zone.height || this.ramps.has(`${col},${row}`)) return false;
    const [c0, r0, c1, r1] = this.map.safeZone ?? [-1, -1, -2, -2];
    if (col >= c0 && col <= c1 && row >= r0 && row <= r1) return false;
    return Math.max(Math.abs(col - m.spawn[0]), Math.abs(row - m.spawn[1])) <= reach;
  }

  /** The shortest way (8 directions, no cut corners) over tiles it may stand on, or null. */
  private route(m: Mob, to: [number, number], reach = ROAM): [number, number][] | null {
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
        if (came.has(key(nc, nr)) || !this.canStand(m, nc, nr, reach)) continue;
        if (dc && dr && (!this.canStand(m, c + dc, r, reach) || !this.canStand(m, c, r + dr, reach))) continue;
        came.set(key(nc, nr), key(c, r));
        queue.push([nc, nr]);
      }
    }
    return null;
  }

  /** Where a mob is now: the tile it stands on, or how far it has got along a hop. */
  private at(m: Mob, now: number): [number, number] {
    if (!m.path.length) return [m.col, m.row];
    const done = Math.floor(((now - m.hopAt) / 1000) * SPEED);
    return done > 0 ? m.path[Math.min(done, m.path.length) - 1] : [m.col, m.row];
  }

  private startHop(m: Mob, path: [number, number][], now: number, events: MobEvent[]): void {
    m.path = path;
    m.hopAt = now;
    events.push({ t: 'mob-move', id: m.id, path: [[m.col, m.row], ...path] });
  }

  /**
   * Moves the clock on: hops that are over land; the dead come back; a mob with a foe goes after them and attacks
   * next to them (or gives up and walks home); the rest, rested, start a new hop. `players`: where each player in the
   * room is (by town id). Returns what to send to the room.
   */
  tick(now: number, players: (id: string) => [number, number] | null = () => null): MobEvent[] {
    const events: MobEvent[] = [];
    for (const m of this.mobs) {
      if (m.respawnAt) {
        if (now < m.respawnAt) continue;
        Object.assign(m, { respawnAt: 0, hp: MOB_HP, col: m.spawn[0], row: m.spawn[1], path: [], foe: null, restUntil: now + REST_MS[0] });
        events.push({ t: 'mob-spawn', id: m.id, col: m.col, row: m.row, hp: m.hp });
        continue;
      }
      if (m.path.length && now >= m.hopAt + (m.path.length / SPEED) * 1000) {
        [m.col, m.row] = m.path[m.path.length - 1];
        m.path = [];
        m.restUntil = now + REST_MS[0] + this.random() * (REST_MS[1] - REST_MS[0]);
      }
      if (m.path.length) continue;
      if (m.foe) {
        const leash = m.zone.leash ?? 10;
        const p = players(m.foe.id);
        const far = (t: [number, number]) => Math.max(Math.abs(t[0] - m.spawn[0]), Math.abs(t[1] - m.spawn[1])) > leash;
        if (!p || far(p) || now - m.foe.at > GIVE_UP_MS) {
          // Gone, out of reach, or done with it: home.
          m.foe = null;
          const home = this.route(m, m.spawn, leash);
          if (home?.length) this.startHop(m, home, now, events);
          continue;
        }
        const d = Math.max(Math.abs(p[0] - m.col), Math.abs(p[1] - m.row));
        if (d <= 1) {
          if (now >= m.nextAttack) {
            m.nextAttack = now + ATTACK_MS;
            events.push({ t: 'mob-attack', id: m.id, target: m.foe.id });
          }
          continue;
        }
        // After them: the free tile next to them that's closest, two steps at a time.
        let best: [number, number][] | null = null;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const to: [number, number] = [p[0] + dc, p[1] + dr];
          if (!this.canStand(m, to[0], to[1], leash)) continue;
          const way = this.route(m, to, leash);
          if (way?.length && (!best || way.length < best.length)) best = way;
        }
        if (best) this.startHop(m, best.slice(0, 2), now, events);
        continue;
      }
      if (now < m.restUntil) continue;
      for (let tries = 0; tries < 6; tries++) {
        const to: [number, number] = [m.spawn[0] + Math.round((this.random() * 2 - 1) * ROAM), m.spawn[1] + Math.round((this.random() * 2 - 1) * ROAM)];
        if ((to[0] === m.col && to[1] === m.row) || !this.canStand(m, to[0], to[1])) continue;
        const path = this.route(m, to);
        if (!path?.length) continue;
        this.startHop(m, path, now, events);
        break;
      }
      if (!m.path.length) m.restUntil = now + REST_MS[0];
    }
    return events;
  }

  private swings = new Map<string, number>();

  /** A player's attack on a mob: in range for their class (from where they stand), not too fast, the mob alive. */
  attack(player: string, from: [number, number], cls: string | null | undefined, id: string, now: number, skill = 0): AttackResult {
    const m = this.mobs.find((x) => x.id === id);
    if (!m || m.respawnAt) return { ok: false, reason: 'gone' };
    const ready = `${player}:${skill}`;
    if (now < (this.swings.get(player) ?? 0) || now < (this.swings.get(ready) ?? 0)) return { ok: false, reason: 'slow' };
    const [mc, mr] = this.at(m, now);
    const reach = cls && RANGED_CLASSES.has(cls) ? RANGED : 1;
    // (A tile of slack: the mob may be mid-hop.)
    if (Math.max(Math.abs(from[0] - mc), Math.abs(from[1] - mr)) > reach + 1) return { ok: false, reason: 'range' };
    this.swings.set(player, now + SWING_MS);
    // (A little slack: the game's clock and the message's trip.)
    const level = (cls && this.levels[cls]?.[skill]) || 1;
    this.swings.set(ready, now + skillCooldown(level) * 1000 - 150);
    const crit = this.random() < CRIT_CHANCE;
    const damage = crit ? CRIT : HIT;
    m.hp = Math.max(0, m.hp - damage);
    m.foe = { id: player, at: now };
    if (m.hp === 0) {
      m.respawnAt = now + (m.zone.respawnSec ?? 20) * 1000;
      m.foe = null;
      [m.col, m.row] = [mc, mr];
      m.path = [];
    }
    return { ok: true, id, damage, crit, hp: m.hp, dead: m.hp === 0 };
  }

  /** A player left the room: no mob is after them any more. */
  forget(player: string): void {
    for (const m of this.mobs) if (m.foe?.id === player) m.foe.at = -Infinity;
    for (const k of [...this.swings.keys()]) if (k === player || k.startsWith(`${player}:`)) this.swings.delete(k);
  }

  /** Every mob as a newcomer should see it: where it is and the rest of a hop under way. */
  snapshot(now: number): TownMob[] {
    return this.mobs.map((m) => {
      const done = Math.floor(((now - m.hopAt) / 1000) * SPEED);
      const left = m.path.length ? m.path.slice(Math.min(done, m.path.length - 1)) : [];
      const at = m.path.length && done > 0 ? m.path[Math.min(done, m.path.length) - 1] : [m.col, m.row];
      return { id: m.id, col: at[0], row: at[1], level: m.level, hp: m.hp, ...(m.respawnAt ? { dead: true } : {}), ...(left.length ? { path: left } : {}) };
    });
  }
}
