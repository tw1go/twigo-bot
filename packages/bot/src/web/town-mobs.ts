import { readFileSync } from 'node:fs';
import type { TownGolem, TownMob, TownMobFacing } from '@mikazuki/shared';
import { Golem, type GolemArt, type GolemBoss, type GolemEvent } from './town-golem.js';

// 🥫 The Slums' mobs, run on the server so every player sees the same ones in the same places, and fought there. One per
// spawn tile of each zone that's on (`active` in the game's maps/slums.json), or a pack of a few round a leader for a
// kind with `pack` (the Bottle Caps: a seeded 3–5, ids `<zone>:<spawn>:<n>`); a level rolled once in its zone's range, a
// variant (its look) picked once from its kind's (the game's mobs/mobs.json), and now and then a hop of a few tiles round
// its spawn: at most ROAM away, on its zone's level and in its rect, on open tiles that aren't ramps or in the safe zone
// (a pack's followers hop to within FOLLOW of their leader instead; a Tire Roller sometimes rolls a tile or two straight
// on; a Plastic Bag Spook drifts, slower, with short rests). A hop is sent to the room as a path; the game walks it at
// its pace. Each mob faces the way it last stepped (or turned to attack), on the art's four diagonals. Pure (no
// Discord), so it's tested on its own and the dev server runs it too.
//
// Battle: a mob has mobHp(level) HP; any class hits for HIT (CRIT on a crit, CRIT_CHANCE), from the next tile with a
// melee class or up to RANGED tiles with a ranged one (each skill's own reach: skill-hits.json range). A Scrap Crab's
// shell blocks every hit from a player standing in its front quarter (0, `blocked`). A mob that's hit fights back (a
// pack all together): it goes after whoever hit it last, and within its reach of them attacks every ATTACK_MS (shown
// only: players have no HP yet; the Bag's slows them for show, `slow`). A mob of an aggressive zone goes after a player
// who comes within its zone's aggroRange (in its zone, on its level) the same way. It gives up and walks home when they're
// gone, out of its zone or its leash, or (a passive one) haven't hit it for GIVE_UP_MS. At 0 HP it dies and comes back
// where it started after its zone's respawnSec (a pack's caps each on their own). Each skill has its own cooldown by the
// level it's learnt at (skillCooldown: Lv 1 the quickest; the game shows the same, combat/cooldowns.ts).
//
// The field boss (the map's `boss`, given its art): town-golem.ts runs it on this room's clock; hits on it come through
// attack() like any mob's (reach to its body's edge; area skills reach it too), and its Adds are mobs of this room (ids
// `golem-add:<n>`, sent with their `kind` in `mob-add`; aggressive toward the nearest player within its leash, never
// coming back once dead, all removed with `mob-remove` when the fight ends).

const ROAM = 3;
const SPEED = 2.4; // tiles per second (the game walks them at the same pace)
const REST_MS: [number, number] = [2200, 6500];
const FOLLOW = 2; // a pack's followers keep within this of their leader
const HIT = 20;
const CRIT = 25;
const CRIT_CHANCE = 0.15;
const RANGED = 5;
/** The classes that fight from afar; the rest hit from the next tile. */
const RANGED_CLASSES = new Set(['slingshot', 'broom']);
const ATTACK_MS = 1600;
const GIVE_UP_MS = 12_000;
const SWING_MS = 400; // a player's attacks: no faster than this

/** A mob's HP by its level: 100 at Lv 1, 25 more a level. */
export const mobHp = (level: number) => 100 + 25 * (Math.max(1, level) - 1);

/** A skill's cooldown (s) by the level it's learnt at: 0.8 + 0.15 a level, to a tenth (Lv 1: 1 s … Lv 18: 3.5 s). Keep in
 *  step with the game's combat/cooldowns.ts. */
export const skillCooldown = (level: number) => Math.round((0.8 + 0.15 * Math.max(1, level)) * 10) / 10;

export type MobEvent =
  | { t: 'mob-move'; id: string; path: [number, number][]; speed?: number }
  | { t: 'mob-attack'; id: string; target: string; dir: TownMobFacing; slow?: number }
  | { t: 'mob-spawn'; id: string; col: number; row: number; hp: number }
  | GolemEvent;

export interface MobHit {
  id: string;
  damage: number;
  crit: boolean;
  hp: number;
  dead: boolean;
  /** Its shell took it (a Scrap Crab hit from the front): no damage. */
  blocked?: boolean;
  /** Slowed (to `factor` of its speed; 0 = rooted) for `ms`. */
  slow?: { factor: number; ms: number };
}

/** `hits`: the target first, then any other mobs the skill's shape reached (skill-hits.json). */
export type AttackResult = { ok: true; hits: MobHit[] } | { ok: false; reason: 'range' | 'slow' | 'gone' };

/** Each class's skills' target shapes, in their order (the game's classes/skill-hits.json), and their effects. */
export interface SkillShapes {
  shapes: Record<string, string[]>;
  effects?: Record<string, (string | null)[]>;
  /** Tiles each skill reaches (else the class's: RANGED or the next tile). */
  range?: Record<string, number[]>;
}

/** The game's classes/skill-hits.json. */
export function loadSkillShapes(): SkillShapes {
  const json = JSON.parse(readFileSync(new URL('../../../game/public/assets/classes/skill-hits.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  const arrays = (o: Record<string, unknown> | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => Array.isArray(v)));
  return {
    shapes: arrays(json) as Record<string, string[]>,
    effects: arrays(json.effects as Record<string, unknown> | undefined) as Record<string, (string | null)[]>,
    range: arrays(json.range as Record<string, unknown> | undefined) as Record<string, number[]>,
  };
}

/** A skill effect string (skill-hits.json effects): slow:F:MS or root:MS. */
function parseEffect(e: string | null | undefined): { factor: number; ms: number } | null {
  if (!e) return null;
  const [kind, a, b] = e.split(':');
  if (kind === 'slow') return { factor: Math.max(0, Math.min(1, Number(a) || 0.5)), ms: Number(b) || 2000 };
  if (kind === 'root') return { factor: 0, ms: Number(a) || 2000 };
  return null;
}

/** Each class's damage skills' levels, in their order (classes.json). */
export type SkillLevels = Record<string, number[]>;

export interface MobZoneData {
  id: string;
  mob: string;
  level: [number, number];
  /** [col0, row0, col1, row1]: its mobs never leave it. */
  rect?: [number, number, number, number];
  height: number;
  active: boolean;
  spawns: [number, number][];
  /** Aggressive: its mobs go after a player within aggroRange; passive: they only fight back. */
  aggro?: 'passive' | 'aggressive';
  aggroRange?: number;
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
  /** The field boss (the Scrapheap Golem): town-golem.ts. */
  boss?: GolemBoss;
}

/** Each kind's rules (the game's mobs/mobs.json): its looks, and what sets it apart. */
export interface MobKind {
  variants?: string[];
  /** A spawn point is a pack of this many (lowest, highest). */
  pack?: [number, number];
  /** Tiles it attacks from (else the next tile). */
  reach?: number;
  /** Its attack slows the player hit for this long (shown only). */
  slowMs?: number;
  /** Its front quarter blocks hits. */
  shell?: boolean;
  /** Now and then, rested, a short straight roll along its facing. */
  roll?: { chance: number; tiles: [number, number]; speed: number };
  /** It drifts: its own pace and short rests. */
  drift?: { speed: number; rest: [number, number] };
}
export type MobKinds = Record<string, MobKind>;

interface Mob {
  id: string;
  zone: MobZoneData;
  kind: MobKind;
  level: number;
  maxHp: number;
  /** Its look ('' for a kind with one). */
  variant: string;
  /** Its spawn point (how far it may roam is measured from here) and where it starts and comes back (a pack's caps
   *  round the point). */
  spawn: [number, number];
  home: [number, number];
  /** Where it is (or, mid-hop, where the hop started). */
  col: number;
  row: number;
  /** The way it faces (its last step, or toward whoever it attacked). */
  facing: TownMobFacing;
  path: [number, number][];
  hopAt: number;
  restUntil: number;
  hp: number;
  /** Dead until then (ms), or 0. */
  respawnAt: number;
  /** Who it's after, and when they last hit it. */
  foe: { id: string; at: number } | null;
  nextAttack: number;
  /** Slowed to `factor` of its speed until then (0: rooted). */
  slow: { factor: number; until: number } | null;
  /** The pace of the hop under way (tiles a second). */
  hopSpeed: number;
  /** Its pack (the caps of one spawn point, the leader the first alive), or null. */
  pack: Mob[] | null;
  /** One of the golem's Adds: no spawn point, never back once dead, gone when the fight ends. */
  add?: boolean;
}

/** The game's mobs/mobs.json. */
export function loadMobKinds(): MobKinds {
  const json = JSON.parse(readFileSync(new URL('../../../game/public/assets/mobs/mobs.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(json).filter(([, v]) => typeof v === 'object' && v)) as MobKinds;
}

/** The mobs' data from a map file (maps/<name>.json in the game's assets). */
export function loadMobMap(name: string): MobMapData {
  return JSON.parse(readFileSync(new URL(`../../../game/public/assets/maps/${name}.json`, import.meta.url), 'utf8')) as MobMapData;
}

/** A small seeded number (0–1) from a string, so a mob's level, look and pack are the same on every restart (the game
 *  picks the same with its copy in world/mobs.ts until the server answers: keep them in step). */
export function seeded(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

/** How many caps a pack of `[lo, hi]` at spawn `id` has (seeded; the game's world/mobs.ts the same). */
export const packSize = (id: string, [lo, hi]: [number, number]) => lo + Math.floor(seeded(`${id}:pack`) * (hi - lo + 1));

/** Each facing's step on the grid: the art's SE is +col, SW +row, NW −col, NE −row. */
const AXIS: Record<TownMobFacing, [number, number]> = { se: [1, 0], sw: [0, 1], nw: [-1, 0], ne: [0, -1] };
const FACINGS: TownMobFacing[] = ['se', 'sw', 'ne', 'nw'];

/** The way to face for something `dc, dr` away: along the bigger of the two; on a diagonal as the game shows a step
 *  that way (SE for S and E, SW for W, NE for N). Null for no way at all. */
export function facingTo(dc: number, dr: number): TownMobFacing | null {
  if (Math.abs(dc) > Math.abs(dr)) return dc > 0 ? 'se' : 'nw';
  if (Math.abs(dr) > Math.abs(dc)) return dr > 0 ? 'sw' : 'ne';
  if (!dc) return null;
  return dc > 0 ? 'se' : dr > 0 ? 'sw' : 'ne';
}

/** Whether something `dc, dr` from a mob facing `f` is in its front quarter (a 90° wedge round its facing; the
 *  diagonals between are its sides). */
export function inFront(f: TownMobFacing, dc: number, dr: number): boolean {
  const [fx, fy] = AXIS[f];
  const along = dc * fx + dr * fy;
  return along > 0 && Math.abs(dc * fy - dr * fx) < along;
}

const cheb = (a: [number, number], b: [number, number]) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
const STEPS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export class MobRoom {
  private readonly mobs: Mob[] = [];
  private readonly byId = new Map<string, Mob>();
  private readonly ramps = new Set<string>();
  /** This tick's tiles each mob stands on or is hopping to (so they don't pile up on one): col × 4096 + row. */
  private claimed: Map<number, Mob> | null = null;

  /** The field boss, if the map has one (and its art was given). */
  private readonly golem: Golem | null = null;
  /** Its Adds' zones (one per kind: the golem's leash, aggressive), and how many Adds it has called so far (their ids). */
  private readonly addZones = new Map<string, MobZoneData>();
  private adds = 0;

  constructor(
    private readonly map: MobMapData,
    private readonly random: () => number = Math.random,
    private readonly levels: SkillLevels = {},
    private readonly shapes: SkillShapes = { shapes: {} },
    private readonly kinds: MobKinds = {},
    golem?: GolemArt,
  ) {
    for (const r of map.ramps ?? []) this.ramps.add(`${r.col},${r.row}`);
    for (const zone of map.mobZones ?? []) {
      if (!zone.active) continue;
      const kind = kinds[zone.mob] ?? {};
      zone.spawns.forEach(([col, row], i) => this.place(zone, kind, `${zone.id}:${i}`, [col, row]));
    }
    const boss = map.boss;
    if (boss && golem) {
      const level = this.map.height?.[boss.tile[1]]?.[boss.tile[0]] ?? 0;
      this.golem = new Golem(boss, golem, {
        open: (c, r) => c >= 0 && r >= 0 && c < map.size[0] && r < map.size[1] && !map.blocked[r]?.[c] && (map.height?.[r]?.[c] ?? 0) === level && !this.ramps.has(`${c},${r}`),
        callAdds: (spots, now) => this.callAdds(boss, level, spots, now),
        dropAdds: () => this.dropAdds(),
      }, random);
    }
  }

  /** A spawn point's mob (or pack: `point:<n>` each), its level and look seeded from its id; the Adds' too. */
  private place(zone: MobZoneData, kind: MobKind, point: string, [col, row]: [number, number], add = false): Mob[] {
    const variants = kind.variants ?? [];
    const n = kind.pack ? packSize(point, kind.pack) : 1;
    const pack: Mob[] = [];
    for (let k = 0; k < n; k++) {
      const id = kind.pack ? `${point}:${k}` : point;
      const [lo, hi] = zone.level;
      const level = lo + Math.floor(seeded(id) * (hi - lo + 1));
      const variant = variants[Math.floor(seeded(`${id}:variant`) * variants.length)] ?? '';
      const m: Mob = {
        id, zone, kind, level, maxHp: mobHp(level), variant, spawn: [col, row], home: [col, row], col, row, facing: FACINGS[Math.floor(seeded(`${id}:dir`) * 4)], path: [], hopAt: 0, restUntil: 0,
        hp: mobHp(level), respawnAt: 0, foe: null, nextAttack: 0, slow: null, hopSpeed: SPEED, pack: kind.pack ? pack : null, ...(add ? { add } : {}),
      };
      // A pack's caps start round the point, each on a tile of its own (seeded: the same every time).
      if (k) m.home = this.besideSpawn(m, pack, id);
      [m.col, m.row] = m.home;
      pack.push(m);
      this.mobs.push(m);
      this.byId.set(id, m);
    }
    return pack;
  }

  /** The golem's Adds at its spots: two Tin Cans, then a Bottle Caps pack (round the third spot, and a fourth if there
   *  is one); each kind's level from its zone in the map. They come for the nearest player within the golem's leash. */
  private callAdds(boss: GolemBoss, level: number, spots: [number, number][], now: number): GolemEvent[] {
    const made: Mob[] = [];
    const zoneFor = (mob: string) => {
      let z = this.addZones.get(mob);
      if (!z) {
        const [hc, hr] = boss.tile;
        const L = boss.leash;
        z = {
          id: 'golem-add', mob, level: this.map.mobZones?.find((x) => x.mob === mob)?.level ?? [1, 1], rect: [hc - L, hr - L, hc + L, hr + L], height: level,
          active: true, spawns: [], aggro: 'aggressive', aggroRange: 2 * L + 1, leash: 2 * L,
        };
        this.addZones.set(mob, z);
      }
      return z;
    };
    const at = (i: number) => spots[Math.min(i, spots.length - 1)];
    for (const [i, mob] of ['tin-can', 'tin-can', 'bottle-caps'].entries()) {
      const caps = this.place(zoneFor(mob), this.kinds[mob] ?? {}, `golem-add:${this.adds++}`, at(i), true);
      // A fourth spot: half the pack crawls out there.
      if (caps.length > 1 && spots.length > 3)
        caps.forEach((m, k) => {
          if (k === 1 && this.canStand({ zone: m.zone, spawn: spots[3] }, ...spots[3], 0)) [m.col, m.row] = m.home = m.spawn = spots[3];
        });
      made.push(...caps);
    }
    for (const m of made) m.restUntil = now;
    return [{ t: 'mob-add', mobs: made.map((m) => this.view(m, now)) }];
  }

  /** The fight is over: every Add goes (alive or not). */
  private dropAdds(): GolemEvent[] {
    const gone = this.mobs.filter((m) => m.add);
    if (!gone.length) return [];
    for (const m of gone) this.byId.delete(m.id);
    this.mobs.splice(0, this.mobs.length, ...this.mobs.filter((m) => !m.add));
    this.claimed = null;
    return [{ t: 'mob-remove', ids: gone.map((m) => m.id) }];
  }

  get size(): number {
    return this.mobs.length;
  }

  /** A free tile next to the spawn point for a pack's cap (its own spot, or the point if there's none). */
  private besideSpawn(m: Mob, pack: Mob[], id: string): [number, number] {
    const taken = new Set(pack.map((x) => `${x.home[0]},${x.home[1]}`));
    const first = Math.floor(seeded(`${id}:spot`) * STEPS.length);
    for (let i = 0; i < STEPS.length; i++) {
      const [dc, dr] = STEPS[(first + i) % STEPS.length];
      const t: [number, number] = [m.spawn[0] + dc, m.spawn[1] + dr];
      if (!taken.has(`${t[0]},${t[1]}`) && this.canStand(m, t[0], t[1], 1)) return t;
    }
    return m.spawn;
  }

  /** Where a mob may stand: open, on its zone's level and in its rect, not a ramp, outside the safe zone, close to its
   *  spawn. */
  canStand(m: { zone: MobZoneData; spawn: [number, number] }, col: number, row: number, reach = ROAM): boolean {
    const [cols, rows] = this.map.size;
    if (col < 0 || row < 0 || col >= cols || row >= rows || this.map.blocked[row]?.[col]) return false;
    if ((this.map.height?.[row]?.[col] ?? 0) !== m.zone.height || this.ramps.has(`${col},${row}`)) return false;
    if (!this.inRect(m.zone, col, row)) return false;
    const [c0, r0, c1, r1] = this.map.safeZone ?? [-1, -1, -2, -2];
    if (col >= c0 && col <= c1 && row >= r0 && row <= r1) return false;
    return Math.max(Math.abs(col - m.spawn[0]), Math.abs(row - m.spawn[1])) <= reach;
  }

  private inRect(zone: MobZoneData, col: number, row: number): boolean {
    const [z0, y0, z1, y1] = zone.rect ?? [0, 0, this.map.size[0], this.map.size[1]];
    return col >= z0 && col <= z1 && row >= y0 && row <= y1;
  }

  /** A player its zone's mobs can get at: in its rect, on its level, outside the safe zone. */
  private inZone(zone: MobZoneData, [col, row]: [number, number]): boolean {
    if (!this.inRect(zone, col, row) || (this.map.height?.[row]?.[col] ?? 0) !== zone.height) return false;
    const [c0, r0, c1, r1] = this.map.safeZone ?? [-1, -1, -2, -2];
    return !(col >= c0 && col <= c1 && row >= r0 && row <= r1);
  }

  /** The shortest way (8 directions, no cut corners) over tiles it may stand on to the nearest tile `goal` likes, or
   *  null. */
  private route(m: Mob, goal: (c: number, r: number) => boolean, reach = ROAM): [number, number][] | null {
    const key = (c: number, r: number) => c * 4096 + r;
    const came = new Map<number, number>([[key(m.col, m.row), -1]]);
    const queue: [number, number][] = [[m.col, m.row]];
    for (let i = 0; i < queue.length; i++) {
      const [c, r] = queue[i];
      if (i && goal(c, r)) {
        const path: [number, number][] = [];
        for (let k = key(c, r); k !== -1; k = came.get(k)!) path.push([Math.floor(k / 4096), k % 4096]);
        return path.reverse().slice(1);
      }
      for (const [dc, dr] of STEPS) {
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
    const done = Math.floor(((now - m.hopAt) / 1000) * m.hopSpeed);
    return done > 0 ? m.path[Math.min(done, m.path.length) - 1] : [m.col, m.row];
  }

  /** The way it faces now: mid-hop, the step it's on. */
  private facingAt(m: Mob, now: number): TownMobFacing {
    if (!m.path.length) return m.facing;
    const done = Math.min(Math.floor(((now - m.hopAt) / 1000) * m.hopSpeed), m.path.length - 1);
    const from = done > 0 ? m.path[done - 1] : [m.col, m.row];
    const to = m.path[done];
    return facingTo(to[0] - from[0], to[1] - from[1]) ?? m.facing;
  }

  /** Its pace now: its kind's (a drifter's own), slowed (or rooted: 0) for a while after a skill's effect. */
  private speedOf(m: Mob, now: number, pace = m.kind.drift?.speed ?? SPEED): number {
    if (m.slow && now >= m.slow.until) m.slow = null;
    return pace * (m.slow ? m.slow.factor : 1);
  }

  /** Where it's headed (or stands): its hop's last tile. */
  private dest(m: Mob): [number, number] {
    return m.path.length ? m.path[m.path.length - 1] : [m.col, m.row];
  }

  /** Whether another living mob stands on (or is hopping to) a tile. */
  private taken(m: Mob, col: number, row: number): boolean {
    if (!this.claimed) {
      this.claimed = new Map();
      for (const x of this.mobs) if (!x.respawnAt) {
        const [c, r] = this.dest(x);
        this.claimed.set(c * 4096 + r, x);
      }
    }
    const o = this.claimed.get(col * 4096 + row);
    return !!o && o !== m;
  }

  /** It's headed for col,row now (its old tile is free for the others). */
  private claim(m: Mob, col: number, row: number): void {
    if (!this.claimed) return;
    const [c, r] = this.dest(m);
    if (this.claimed.get(c * 4096 + r) === m) this.claimed.delete(c * 4096 + r);
    this.claimed.set(col * 4096 + row, m);
  }

  private startHop(m: Mob, path: [number, number][], now: number, events: MobEvent[], pace?: number): void {
    const speed = this.speedOf(m, now, pace);
    if (!speed || !path.length) return; // rooted
    this.claim(m, ...path[path.length - 1]);
    m.path = path;
    m.hopAt = now;
    m.hopSpeed = speed;
    events.push({ t: 'mob-move', id: m.id, path: [[m.col, m.row], ...path], ...(speed !== SPEED ? { speed } : {}) });
    // A pack's leader on the move: the others follow shortly.
    if (m.pack && this.leader(m) === m && !m.foe)
      for (const x of m.pack) if (x !== m && !x.respawnAt && !x.foe && !x.path.length) x.restUntil = Math.min(x.restUntil, now + 300 + this.random() * 700);
  }

  /** A pack's leader: the first cap alive. */
  private leader(m: Mob): Mob | null {
    return m.pack?.find((x) => !x.respawnAt) ?? null;
  }

  /** Someone it should fight: it (and its whole pack) goes after them. */
  private rally(m: Mob, player: string, now: number): void {
    for (const x of m.pack ?? [m]) if (!x.respawnAt) x.foe = { id: player, at: now };
  }

  /**
   * Moves the clock on: hops that are over land; the dead come back; an aggressive mob notices a player near it; a mob
   * with a foe goes after them and attacks within its reach (or gives up and walks home); the rest, rested, start a new
   * hop. `players`: where each player in the room is (by town id). Returns what to send to the room.
   */
  tick(now: number, players: ReadonlyMap<string, [number, number]> = new Map()): MobEvent[] {
    this.claimed = null;
    const events: MobEvent[] = this.golem ? this.golem.tick(now, players) : [];
    // Who each aggressive zone's mobs could notice (a few players at most: looked up once a tick, not per mob).
    const watched = new Map<MobZoneData, [string, [number, number]][]>();
    for (const zone of [...(this.map.mobZones ?? []), ...this.addZones.values()]) {
      if (!zone.active || zone.aggro !== 'aggressive' || !zone.aggroRange) continue;
      const here = [...players].filter(([, p]) => this.inZone(zone, p));
      if (here.length) watched.set(zone, here);
    }
    for (const m of this.mobs) {
      if (m.respawnAt) {
        if (now < m.respawnAt) continue;
        Object.assign(m, { respawnAt: 0, hp: m.maxHp, col: m.home[0], row: m.home[1], path: [], foe: null, restUntil: now + REST_MS[0] });
        this.claim(m, m.col, m.row);
        events.push({ t: 'mob-spawn', id: m.id, col: m.col, row: m.row, hp: m.hp });
        continue;
      }
      if (m.path.length && now >= m.hopAt + (m.path.length / m.hopSpeed) * 1000) {
        const [a, b] = [m.path.length > 1 ? m.path[m.path.length - 2] : [m.col, m.row], m.path[m.path.length - 1]];
        m.facing = facingTo(b[0] - a[0], b[1] - a[1]) ?? m.facing;
        [m.col, m.row] = b;
        m.path = [];
        const rest = m.kind.drift?.rest ?? REST_MS;
        m.restUntil = now + rest[0] + this.random() * (rest[1] - rest[0]);
      }
      if (m.path.length) continue;
      if (!m.foe) {
        // The nearest player within its aggroRange.
        let near: string | null = null;
        let best = m.zone.aggroRange! + 1;
        for (const [id, p] of watched.get(m.zone) ?? []) {
          const d = cheb(p, [m.col, m.row]);
          if (d < best) [near, best] = [id, d];
        }
        if (near) this.rally(m, near, now);
      }
      if (m.foe) {
        this.fight(m, now, players, events);
        continue;
      }
      if (now < m.restUntil) continue;
      this.wander(m, now, events);
    }
    return events;
  }

  /** After its foe: next to them (within its reach), it attacks; else closer, two steps at a time; or home. */
  private fight(m: Mob, now: number, players: ReadonlyMap<string, [number, number]>, events: MobEvent[]): void {
    const foe = m.foe!;
    const leash = m.zone.leash ?? 10;
    const p = players.get(foe.id);
    const bored = m.zone.aggro !== 'aggressive' && now - foe.at > GIVE_UP_MS;
    if (!p || cheb(p, m.spawn) > leash || !this.inZone(m.zone, p) || bored) {
      // Gone, out of reach, or done with it: home.
      m.foe = null;
      const [hc, hr] = m.home;
      const home = this.route(m, (c, r) => c === hc && r === hr, leash);
      if (home?.length) this.startHop(m, home, now, events);
      return;
    }
    const reach = m.kind.reach ?? 1;
    if (cheb(p, [m.col, m.row]) <= reach) {
      if (now >= m.nextAttack) {
        m.nextAttack = now + ATTACK_MS;
        m.facing = facingTo(p[0] - m.col, p[1] - m.row) ?? m.facing;
        events.push({ t: 'mob-attack', id: m.id, target: foe.id, dir: m.facing, ...(m.kind.slowMs ? { slow: m.kind.slowMs } : {}) });
      }
      return;
    }
    // After them: the nearest free tile within its reach of them (any, if the others have taken those), two steps at a time.
    const near = (c: number, r: number) => cheb([c, r], p) <= reach;
    const way = this.route(m, (c, r) => near(c, r) && !this.taken(m, c, r), leash) ?? this.route(m, near, leash);
    if (way?.length) this.startHop(m, way.slice(0, 2), now, events);
  }

  /** Rested: a hop somewhere near its spawn (a follower: near its leader; a roller: sometimes a short roll). */
  private wander(m: Mob, now: number, events: MobEvent[]): void {
    const lead = m.pack ? this.leader(m) : null;
    if (lead && lead !== m) return this.follow(m, lead, now, events);
    const roll = m.kind.roll;
    if (roll && this.random() < roll.chance) {
      // Straight on along its facing (or the way back if that's shut), a tile or two.
      const n = roll.tiles[0] + Math.floor(this.random() * (roll.tiles[1] - roll.tiles[0] + 1));
      for (const f of [m.facing, ({ se: 'nw', nw: 'se', sw: 'ne', ne: 'sw' } as const)[m.facing]]) {
        const [dc, dr] = AXIS[f];
        const path: [number, number][] = [];
        for (let k = 1; k <= n; k++) {
          const t: [number, number] = [m.col + dc * k, m.row + dr * k];
          if (!this.canStand(m, t[0], t[1]) || this.taken(m, t[0], t[1])) break;
          path.push(t);
        }
        if (path.length) return this.startHop(m, path, now, events, roll.speed);
      }
    }
    for (let tries = 0; tries < 6; tries++) {
      const to: [number, number] = [m.spawn[0] + Math.round((this.random() * 2 - 1) * ROAM), m.spawn[1] + Math.round((this.random() * 2 - 1) * ROAM)];
      if ((to[0] === m.col && to[1] === m.row) || !this.canStand(m, to[0], to[1]) || this.taken(m, to[0], to[1])) continue;
      const path = this.route(m, (c, r) => c === to[0] && r === to[1]);
      if (!path?.length) continue;
      this.startHop(m, path, now, events);
      break;
    }
    if (!m.path.length) m.restUntil = now + REST_MS[0];
  }

  /** A follower: back to within FOLLOW of where its leader is headed (and now and then a shuffle while near it). */
  private follow(m: Mob, lead: Mob, now: number, events: MobEvent[]): void {
    const to = this.dest(lead);
    const reach = ROAM + FOLLOW;
    if (cheb(to, [m.col, m.row]) <= FOLLOW && this.random() < 0.6) {
      m.restUntil = now + REST_MS[0] + this.random() * (REST_MS[1] - REST_MS[0]);
      return;
    }
    for (let tries = 0; tries < 6; tries++) {
      const t: [number, number] = [to[0] + Math.round((this.random() * 2 - 1) * FOLLOW), to[1] + Math.round((this.random() * 2 - 1) * FOLLOW)];
      if (cheb(t, to) < 1 || (t[0] === m.col && t[1] === m.row) || !this.canStand(m, t[0], t[1], reach) || this.taken(m, t[0], t[1])) continue;
      const path = this.route(m, (c, r) => c === t[0] && r === t[1], reach);
      if (!path?.length || path.length > 2 * reach) continue;
      return this.startHop(m, path, now, events);
    }
    m.restUntil = now + REST_MS[0];
  }

  private swings = new Map<string, number>();

  /** A player's attack on a mob (or the golem): in range for their class (from where they stand; to the golem's body's
   *  edge), not too fast, the mob alive. `name`: theirs, for the golem's line when it falls. */
  attack(player: string, from: [number, number], cls: string | null | undefined, id: string, now: number, skill = 0, name = player): AttackResult {
    const boss = this.golem?.id === id ? this.golem : null;
    const m = boss ? null : this.byId.get(id);
    if (boss ? !boss.hittable : !m || m.respawnAt) return { ok: false, reason: 'gone' };
    const ready = `${player}:${skill}`;
    if (now < (this.swings.get(player) ?? 0) || now < (this.swings.get(ready) ?? 0)) return { ok: false, reason: 'slow' };
    const [mc, mr] = boss ? boss.at(now) : this.at(m!, now);
    const reach = (cls && this.shapes.range?.[cls]?.[skill]) || (cls && RANGED_CLASSES.has(cls) ? RANGED : 1);
    // (A tile of slack: the mob may be mid-hop.)
    const far = boss ? boss.edge(from, now) : Math.max(Math.abs(from[0] - mc), Math.abs(from[1] - mr));
    if (far > reach + 1) return { ok: false, reason: 'range' };
    this.swings.set(player, now + SWING_MS);
    // (A little slack: the game's clock and the message's trip.)
    const level = (cls && this.levels[cls]?.[skill]) || 1;
    this.swings.set(ready, now + skillCooldown(level) * 1000 - 150);
    const effect = parseEffect(cls ? this.shapes.effects?.[cls]?.[skill] : null);
    const hits = this.reached(m ?? 'golem', [mc, mr], from, (cls && this.shapes.shapes[cls]?.[skill]) || 'single', now).map((x) => {
      if (x === 'golem') return this.hitGolem(player, name, now); // (no slowing it)
      const hit = this.damage(x, player, from, now);
      if (effect && !hit.dead && !hit.blocked) {
        x.slow = { factor: effect.factor, until: now + effect.ms };
        hit.slow = effect;
      }
      return hit;
    });
    return { ok: true, hits };
  }

  /** One hit on a mob from a player at `from`: HIT (or CRIT), none through a shell's front; it (and its pack) goes after
   *  the player; at 0 it dies. */
  private damage(m: Mob, player: string, from: [number, number], now: number): MobHit {
    const [mc, mr] = this.at(m, now);
    this.rally(m, player, now);
    if (m.kind.shell && inFront(this.facingAt(m, now), from[0] - mc, from[1] - mr)) return { id: m.id, damage: 0, crit: false, hp: m.hp, dead: false, blocked: true };
    const crit = this.random() < CRIT_CHANCE;
    const damage = crit ? CRIT : HIT;
    m.hp = Math.max(0, m.hp - damage);
    if (m.hp === 0) {
      [m.col, m.row] = [mc, mr];
      m.respawnAt = m.add ? Infinity : now + (m.zone.respawnSec ?? 20) * 1000;
      m.foe = null;
      m.path = [];
    }
    return { id: m.id, damage, crit, hp: m.hp, dead: m.hp === 0 };
  }

  /** A hit on the golem: HIT (or CRIT), never blocked. */
  private hitGolem(player: string, name: string, now: number): MobHit {
    const crit = this.random() < CRIT_CHANCE;
    const damage = crit ? CRIT : HIT;
    const r = this.golem!.hit(player, name, damage, now)!;
    return { id: this.golem!.id, damage, crit, hp: r.hp, dead: r.dead };
  }

  /** The mobs a skill's shape reaches (the golem too, by its body's edge): the target first (see skill-hits.json). */
  private reached(target: Mob | 'golem', at: [number, number], from: [number, number], shape: string, now: number): (Mob | 'golem')[] {
    const [kind, n] = shape.split(':');
    const most = Number(n) || 1;
    const out: (Mob | 'golem')[] = [target];
    if (most < 2) return out;
    // Each other one alive, where it is and its body's radius (0 but the golem's).
    const live: { m: Mob | 'golem'; at: [number, number]; r: number }[] = this.mobs.filter((x) => !x.respawnAt && x !== target).map((x) => ({ m: x, at: this.at(x, now), r: 0 }));
    if (this.golem?.hittable && target !== 'golem') live.push({ m: 'golem', at: this.golem.at(now), r: this.golem.radius });
    const dist = (x: { at: [number, number]; r: number }, p: [number, number]) => (x.r ? Math.max(0, Math.hypot(x.at[0] - p[0], x.at[1] - p[1]) - x.r) : cheb(x.at, p));
    if (kind === 'chain') {
      let last = at;
      while (out.length < most) {
        const next = live.filter((x) => !out.includes(x.m) && dist(x, last) <= 3).sort((a, b) => dist(a, last) - dist(b, last))[0];
        if (!next) break;
        out.push(next.m);
        last = next.at;
      }
    } else if (kind === 'cone' || kind === 'area') {
      out.push(...live.filter((x) => dist(x, at) <= 2).sort((a, b) => dist(a, at) - dist(b, at)).slice(0, most - 1).map((x) => x.m));
    } else if (kind === 'around') {
      const radius = Number(shape.split(':')[2]) || 1;
      out.push(...live.filter((x) => dist(x, from) <= radius).sort((a, b) => dist(a, from) - dist(b, from)).slice(0, most - 1).map((x) => x.m));
    } else if (kind === 'line') {
      // Along the line from the caster through the target, out to RANGED tiles (the golem's body widens it).
      const dx = at[0] - from[0];
      const dy = at[1] - from[1];
      const len = Math.hypot(dx, dy) || 1;
      const [ux, uy] = [dx / len, dy / len];
      const on = live
        .map((x) => {
          const px = x.at[0] - from[0];
          const py = x.at[1] - from[1];
          const along = px * ux + py * uy;
          return { m: x.m, r: x.r, along, off: Math.abs(px * uy - py * ux) };
        })
        .filter((x) => x.along > -x.r && x.along <= RANGED + x.r && x.off <= 0.8 + x.r)
        .sort((a, b) => a.along - b.along);
      out.push(...on.slice(0, most - 1).map((x) => x.m));
    }
    return out;
  }

  /** A player left the room: no mob (nor the golem) is after them any more. */
  forget(player: string): void {
    for (const m of this.mobs) if (m.foe?.id === player) m.foe.at = -Infinity;
    for (const k of [...this.swings.keys()]) if (k === player || k.startsWith(`${player}:`)) this.swings.delete(k);
    this.golem?.forget(player);
  }

  /** A mob as the room sees it: where it is, which way it faces and the rest of a hop under way (an Add's kind too). */
  private view(m: Mob, now: number): TownMob {
    const done = Math.floor(((now - m.hopAt) / 1000) * m.hopSpeed);
    const left = m.path.length ? m.path.slice(Math.min(done, m.path.length - 1)) : [];
    const at = m.path.length && done > 0 ? m.path[Math.min(done, m.path.length) - 1] : [m.col, m.row];
    return {
      id: m.id, col: at[0], row: at[1], level: m.level, ...(m.variant ? { variant: m.variant } : {}), hp: m.hp, maxHp: m.maxHp, dir: this.facingAt(m, now),
      ...(m.respawnAt ? { dead: true } : {}), ...(left.length ? { path: left, speed: m.hopSpeed } : {}), ...(m.add ? { kind: m.zone.mob } : {}),
    };
  }

  /** Every mob as a newcomer should see it (Adds that died are gone for good: left out). */
  snapshot(now: number): TownMob[] {
    return this.mobs.filter((m) => !(m.add && m.respawnAt)).map((m) => this.view(m, now));
  }

  /** The golem as a newcomer should see it (null: not up, or no golem here). */
  golemState(now: number): TownGolem | null {
    return this.golem?.state(now) ?? null;
  }

  /** What happened outside the clock (a hit that called the Junk, enraged the golem or brought it down): send it now. */
  flush(): MobEvent[] {
    return this.golem?.flush() ?? [];
  }

  /** Dev: the golem rises now (?golem=now); plays its whole fight (?golemdemo=1, `name` = who asked). */
  riseGolem(now: number): boolean {
    return this.golem?.riseNow(now) ?? false;
  }

  golemDemo(now: number, name: string): void {
    this.golem?.demo(now, name);
  }
}
