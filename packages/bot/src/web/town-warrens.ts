import {
  type DungeonBossDef,
  type DungeonMapArea,
  type DungeonMapBlock,
  type DungeonMechanic,
  type ItemData,
  type LevelingData,
  type TelegraphShape,
  type TownServerMessage,
  type TownWarrensGate,
  type TownWarrensRun,
  type WarrensData,
  inRect,
  partyHpScale,
} from '@mikazuki/shared';
import type { LootContent } from './combat-bag.js';
import { warrensBossLoot, warrensMiniLoot, warrensMobDrops } from './loot.js';
import { loadDungeons, loadItemData, loadLeveling } from './stats-data.js';
import { loadGolemArt } from './town-golem.js';
import { type MobDirector, type MobEvent, type MobKill, type MobKinds, type MobMapData, type MobSpec, MobRoom, type SkillLevels, type SkillShapes, loadMobKinds, loadMobMap, loadSkillShapes } from './town-mobs.js';

// 🕳️ The Scrap Warrens (classes/dungeons.json warrens; combat-guide-dungeon.md in the art folder): a walled junk maze
// under the Slums, played as runs. A run is one copy of it for one player or one party (room `warrens:<id>`), with its
// own mobs (a MobRoom on its own copy of maps/warrens.json, whose blocked tiles the run changes), its own loot (the town's
// LootRoom for the room) and this controller: it gathers in the start room (its way out shut) until the opener and
// everyone who said Join are in (at most run.gatherSeconds, or the opener's Start now), then runs for the time limit;
// each area's mini boss keeps its shutter shut until it dies (then it opens for good and the checkpoint moves on);
// mobs never respawn; a boss with no living player in its arena for bossResetSeconds heals to full and its called mobs
// go; mob and boss HP follow the players inside (scaling); it closes 3 minutes after Barong-Barong falls, when the time
// is up, or when nobody has been inside for closeWhenEmptySeconds (everyone left inside goes back to the Slums).
//
// Bosses (each area's mini boss at 2.5×, Barong-Barong, its Scraplings) attack through their moves here, as the run is
// the mob room's director: a timed move sends `boss-move` with its telegraph's shape and when it hits, and at that time
// the run looks at who stands in the shape then (moving out of it works), rolls their hits and lands them (`boss-hit`
// for the game's numbers). HP thresholds (calls, Vanish, Hunker, Shanty Call, enrage) come through `hurt`.
//
// Who may come in: the opener, and (a party's run) anyone in that party while it lives, joining later too; one who
// leaves the party while inside is sent out after leavePartyKickSeconds. A solo run stays the opener's. Pure (the host
// gives the clock, who's where and the party), tested in town-warrens.test.ts.

type Tile = [number, number];
export type RunPhase = TownWarrensRun['phase'];

/** The map a run plays on (maps/warrens.json): the mobs' data and its dungeon block. */
export interface WarrensMap extends MobMapData {
  dungeon: DungeonMapBlock;
  arrive: Record<string, Tile>;
  spawn: Tile;
  /** Tiles nobody arrives on (the exit warp). */
  avoid?: Tile[];
}

/** maps/warrens.json as a run's template (its exit warp's tiles to avoid on arrival). */
export function loadWarrensMap(): WarrensMap {
  const m = loadMobMap('warrens') as WarrensMap & { gates?: Record<string, Tile[]> };
  return { ...m, avoid: Object.values(m.gates ?? {}).flat() };
}

/** What a run needs to make its mob room. */
export interface RunDeps {
  kinds: MobKinds;
  levels: SkillLevels;
  shapes: SkillShapes;
  fightData: ItemData;
  leveling: LevelingData | null;
  /** When a Scrapling's Tire Slam lands after it starts (ms: the golem's slam frame). */
  slamMs: number;
  random: () => number;
}

/** The Warrens as the town takes them (TownOptions.warrens, the tickets aside): the data, the map, the Warren Gate's
 *  tile and what a run's mob room needs (classes' skill unlock levels: `levels`). */
export function loadWarrens(levels: SkillLevels, random: () => number = Math.random) {
  const data = loadDungeons().warrens;
  const deps: RunDeps = { kinds: loadMobKinds(), levels, shapes: loadSkillShapes(), fightData: loadItemData(), leveling: loadLeveling(), slamMs: loadGolemArt().hitMs?.slam ?? 500, random };
  return { data, map: loadWarrensMap(), gate: data.entry.warp.tile, deps };
}

/** Someone inside: their member id, town id, tile and whether they're knocked out. */
export interface Inside {
  member: string;
  id: string;
  at: Tile;
  out: boolean;
}

/** What a run's tick or a kill sets off: messages for the room, for members wherever they are, and who goes out. */
export interface RunNews {
  room: TownServerMessage[];
  to: [string, TownServerMessage][];
  out: { member: string; reason: 'closed' | 'party' }[];
  closed?: boolean;
}

const news = (): RunNews => ({ room: [], to: [], out: [] });
const hyp = (a: Tile, b: Tile) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
/** A tile inside a circle of tiles (a little slack: a player on its edge counts). */
const inCircle = (p: Tile, c: Tile, r: number) => hyp(p, c) <= r + 0.35;
const key = (t: Tile) => `${t[0]},${t[1]}`;
/** The angle between two directions (radians, 0..π). */
const angleOff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** Whether a tile is in a telegraph's shape (the hit's test: where they stand when it lands). */
export function inShape(shape: TelegraphShape, p: Tile, lineTiles?: Set<string>): boolean {
  switch (shape.kind) {
    case 'circle':
      return inCircle(p, shape.at, shape.radius);
    case 'circles':
      return shape.circles.some((c) => inCircle(p, c.at, c.radius));
    case 'tiles':
      return shape.tiles.some((t) => t[0] === p[0] && t[1] === p[1]);
    case 'line':
      return lineTiles ? lineTiles.has(key(p)) : false;
    case 'cone': {
      const d = hyp(p, shape.origin);
      if (d > shape.length + 0.35) return false;
      if (d < 0.75) return true;
      return angleOff(Math.atan2(p[1] - shape.origin[1], p[0] - shape.origin[0]), shape.facing) <= ((shape.angle / 2) * Math.PI) / 180 + 0.08;
    }
  }
}

/** A boss in a run: its definition, its mob, its area and arena, what it's done. */
interface BossState {
  def: DungeonBossDef;
  mob: string;
  last: boolean;
  area: DungeonMapArea;
  /** When a living player was last in its arena, and whether its fight has begun (someone came in). */
  lastInside: number;
  engaged: boolean;
  /** When each timed move goes next. */
  next: Map<string, number>;
  /** HP thresholds already crossed (`<move>:<share>`). */
  crossed: Set<string>;
  enraged: boolean;
  hand: 'l' | 'r';
  dead: boolean;
}

/** A move under way: what it does when it lands. */
interface Pending {
  boss: string;
  at: number;
  land: (now: number, players: ReadonlyMap<string, Tile>) => MobEvent[];
}

let runSeq = 0;

export class Run implements MobDirector {
  readonly room: string;
  readonly map: WarrensMap;
  readonly mobs: MobRoom;
  phase: RunPhase = 'gathering';
  /** Everyone who may come in (the opener; a party's members as they come and go), and who it waits for while it
   *  gathers (the opener and those who said Join). */
  readonly members = new Set<string>();
  readonly expected = new Set<string>();
  /** Who's inside now (member → their town id), and who has been in at all (a late arrival lands at the checkpoint). */
  private inside = new Map<string, Inside>();
  readonly arrived = new Set<string>();
  readonly gatherUntil: number;
  startedAt = 0;
  endsAt = 0;
  clearedAt = 0;
  private emptySince: number;
  private warned = false;
  private startNow = false;
  /** The areas whose shutter is open, and the bosses. */
  readonly opened = new Set<string>();
  private readonly bosses = new Map<string, BossState>();
  private pending: Pending[] = [];
  private moveSeq = 0;
  /** Kicks under way (member → when), for someone who left the party while inside. */
  private kicks = new Map<string, number>();
  private scaledFor = 0;
  private lastScraplingSlam = new Map<string, number>();
  /** Dev (?warrensboss=): where the opener lands the first time. */
  private devArrival: Tile | null = null;

  constructor(
    readonly id: string,
    readonly W: WarrensData,
    template: WarrensMap,
    private readonly deps: RunDeps,
    readonly opener: { member: string; name: string },
    /** The opener's party (the host's own key for it), or null: a solo run. */
    readonly party: unknown,
    now: number,
  ) {
    this.room = `warrens:${id}`;
    // Its own copy of the map: the shutters' passages and (while it gathers) the start room's seal are blocked here.
    this.map = { ...template, blocked: template.blocked.map((row) => [...row]) };
    for (const [c, r] of template.dungeon.seal) this.map.blocked[r][c] = 1;
    const zoneStats: Record<string, { level: number; hp: number; atk: number; def: number; xp: number }> = {};
    for (const a of W.areas) zoneStats[a.id] = { level: a.mobs.level, hp: a.mobs.hp, atk: a.mobs.atk, def: a.mobs.def, xp: a.mobs.xp };
    const last = template.dungeon.areas.find((a) => inRect(a.rect, ...W.lastBoss.tile));
    if (last) zoneStats[last.id] = this.scraplingStats();
    this.mobs = new MobRoom(this.map, deps.random, deps.levels, deps.shapes, deps.kinds, undefined, deps.fightData, deps.leveling, { zoneStats, director: this, dungeonAggro: 4 });
    this.members.add(opener.member);
    this.expected.add(opener.member);
    this.gatherUntil = now + (W.run.gatherSeconds ?? 60) * 1000;
    this.emptySince = now;
    this.placeBosses(now);
  }

  private scraplingStats() {
    const s = this.W.scrapling;
    return { level: s.level, hp: s.hp, atk: s.atk, def: s.def, xp: s.xp };
  }

  /** Each area's mini boss on its boss tile with its two guards, and Barong-Barong in its hall with its Scraplings. */
  private placeBosses(now: number): void {
    const look = this.W.miniBossLook;
    const specs: MobSpec[] = [];
    for (const a of this.map.dungeon.areas) {
      const def = this.W.areas.find((x) => x.id === a.id)?.miniBoss;
      const last = !def;
      const boss = last ? this.W.lastBoss : def;
      const mob = `boss:${boss.id}`;
      const stats = { level: boss.level, hp: boss.hp, atk: boss.atk, def: boss.def, xp: boss.xp };
      if (last) {
        specs.push({ id: mob, kind: boss.id, zone: a.id, tile: this.W.lastBoss.tile, stats, boss: 'last', name: boss.name, title: boss.title, radius: this.W.lastBoss.reachRadius, still: true, silent: true });
        a.guards.forEach((t, k) => specs.push(this.scrapling(`guard:${boss.id}:${k}`, a.id, t)));
      } else {
        specs.push({ id: mob, kind: def.kind ?? a.mob, zone: a.id, tile: a.bossTile, stats, boss: 'mini', name: def.name, scale: look.drawScale });
        const area = this.W.areas.find((x) => x.id === a.id)!;
        a.guards.forEach((t, k) => specs.push({ id: `guard:${def.id}:${k}`, kind: a.mob, zone: a.id, tile: t, stats: { level: area.mobs.level, hp: area.mobs.hp, atk: area.mobs.atk, def: area.mobs.def, xp: area.mobs.xp } }));
      }
      this.bosses.set(mob, { def: boss, mob, last, area: a, lastInside: 0, engaged: false, next: new Map(), crossed: new Set(), enraged: false, hand: 'l', dead: false });
    }
    this.mobs.addMobs(specs, now);
  }

  /** A Scrapling: the golem's art at 0.6, its Tire Slam only (the run's). */
  private scrapling(id: string, zone: string, tile: Tile, calledBy?: string): MobSpec {
    const s = this.W.scrapling;
    return { id, kind: 'scrapling', zone, tile, stats: this.scraplingStats(), name: s.name, scale: s.drawScale, silent: true, ...(calledBy ? { calledBy } : {}) };
  }

  // ── Who's in ──

  /** Where someone lands coming in: the start room the first time (and while it gathers), the checkpoint after. */
  arrivalFor(member: string): Tile {
    if (this.devArrival && !this.arrived.has(member)) return this.devArrival;
    if (this.phase === 'gathering' || !this.arrived.has(member)) return this.map.arrive.slums ?? this.map.spawn;
    return this.checkpoint();
  }

  /** Where someone comes back after dying: the checkpoint of the furthest area opened. */
  checkpoint(): Tile {
    const areas = this.map.dungeon.areas;
    let at = areas[0].checkpoint;
    for (const s of this.map.dungeon.shutters) if (this.opened.has(s.area)) at = areas.find((a) => a.id === s.opensTo)?.checkpoint ?? at;
    return at;
  }

  /** Someone came in (or left): who's inside now. */
  setInside(list: Inside[], now: number): void {
    if (list.length || this.inside.size) this.emptySince = now;
    this.inside = new Map(list.map((x) => [x.member, x]));
    for (const x of list) this.arrived.add(x.member);
  }

  get insideCount(): number {
    return this.inside.size;
  }

  /** The opener asks to start now (while it gathers). */
  requestStart(member: string): boolean {
    if (this.phase !== 'gathering' || member !== this.opener.member) return false;
    this.startNow = true;
    return true;
  }

  /** The tracker's state for a member. */
  view(now: number, member?: string, names?: (member: string) => string): TownWarrensRun {
    const bosses = [...this.bosses.values()].map((b) => ({ id: b.def.id, name: b.def.name, dead: b.dead }));
    const left = this.phase === 'running' ? Math.max(0, this.endsAt - now) : this.phase === 'cleared' ? Math.max(0, Math.min(this.endsAt, this.clearedAt + this.W.run.closeAfterLastBossMinutes * 60_000) - now) : 0;
    const waiting = this.phase === 'gathering' ? [...this.expected].filter((m) => !this.inside.has(m)).map((m) => names?.(m) ?? m) : undefined;
    return {
      id: this.id, phase: this.phase, left, ...(this.phase === 'gathering' ? { gatherLeft: Math.max(0, this.gatherUntil - now) } : {}),
      bosses, opened: [...this.opened], checkpoint: this.checkpoint(), opener: this.opener.name, ...(member === this.opener.member ? { yours: true } : {}),
      ...(waiting ? { waiting } : {}), inside: this.inside.size,
    };
  }

  // ── The clock (each second or so, from the host) ──

  /** Moves the run on: the start, the scaling, boss resets, the time limit, the close, party kicks. `allowed`: whether a
   *  member may still be inside (their party). */
  step(now: number, allowed: (member: string) => boolean): RunNews {
    const out = news();
    if (this.phase === 'closed') return out;
    // Gathering: start once everyone it waits for is in (or the wait's up, or the opener says so).
    if (this.phase === 'gathering') {
      const all = [...this.expected].every((m) => this.inside.has(m));
      if (this.inside.size && (all || now >= this.gatherUntil || this.startNow)) this.start(now, out);
    }
    // Party scaling: HP for the players inside now (their share kept).
    const n = Math.max(1, this.inside.size);
    if (n !== this.scaledFor) {
      this.scaledFor = n;
      out.room.push(...(this.mobs.scaleHp(partyHpScale(this.W.scaling.mobHp, n), partyHpScale(this.W.scaling.bossHp, n)) as TownServerMessage[]));
    }
    if (this.phase === 'running' || this.phase === 'cleared') out.room.push(...(this.resets(now) as TownServerMessage[]));
    // Someone who left the party while inside: out after the wait (told once).
    for (const [member] of this.inside) {
      if (allowed(member)) {
        this.kicks.delete(member);
        continue;
      }
      if (!this.kicks.has(member)) {
        const ms = this.W.run.leavePartyKickSeconds * 1000;
        this.kicks.set(member, now + ms);
        out.to.push([member, { t: 'warrens-kick', ms }]);
      } else if (now >= this.kicks.get(member)!) {
        this.kicks.delete(member);
        out.out.push({ member, reason: 'party' });
      }
    }
    // The time limit (a minute's warning), the close after Barong-Barong, an empty run.
    if (this.phase === 'running' && !this.warned && now >= this.endsAt - 60_000) {
      this.warned = true;
      out.room.push(this.line('One minute left in the Scrap Warrens!', 'stir'));
    }
    const timeUp = (this.phase === 'running' || this.phase === 'cleared') && now >= this.endsAt;
    const cleared = this.phase === 'cleared' && now >= this.clearedAt + this.W.run.closeAfterLastBossMinutes * 60_000;
    const empty = !this.inside.size && now - this.emptySince >= this.W.run.closeWhenEmptySeconds * 1000;
    if (timeUp || cleared || empty) this.close(out);
    return out;
  }

  private start(now: number, out: RunNews): void {
    this.phase = 'running';
    this.startedAt = now;
    this.endsAt = now + this.W.run.timeLimitMinutes * 60_000;
    for (const [c, r] of this.map.dungeon.seal) this.map.blocked[r][c] = 0;
    out.room.push(this.line('The Scrap Warrens wake up. Good luck!', 'rise'));
  }

  private close(out: RunNews): void {
    this.phase = 'closed';
    this.pending = [];
    for (const member of this.inside.keys()) out.out.push({ member, reason: 'closed' });
    out.closed = true;
  }

  /** A line in the run's system feed (only its room). */
  private line(text: string, tone: string): TownServerMessage {
    return { t: 'system', line: { kind: 'warrens', text, tone } };
  }

  /** Bosses with no living player in their arena for bossResetSeconds: full HP, their called mobs gone, their moves
   *  stopped (their guards stay as they are). */
  private resets(now: number): MobEvent[] {
    const events: MobEvent[] = [];
    const ms = this.W.run.bossResetSeconds * 1000;
    for (const b of this.bosses.values()) {
      if (b.dead) continue;
      const here = [...this.inside.values()].some((p) => !p.out && inRect(b.area.arena, ...p.at));
      if (here) {
        b.lastInside = now;
        if (!b.engaged) {
          b.engaged = true;
          // Its timed moves start counting from now (the first comes half its interval in).
          for (const m of b.def.mechanics) if (m.every) b.next.set(m.id, now + (m.every * 1000) / 2);
        }
        continue;
      }
      if (!b.engaged || now - b.lastInside < ms) continue;
      events.push(...this.reset(b));
    }
    return events;
  }

  private reset(b: BossState): MobEvent[] {
    b.engaged = false;
    b.crossed.clear();
    b.enraged = false;
    b.next.clear();
    this.pending = this.pending.filter((p) => p.boss !== b.mob);
    const events: MobEvent[] = [{ t: 'boss-cancel', id: b.mob }];
    events.push(...this.mobs.removeMobs(this.mobs.calledBy(b.mob)));
    events.push(...this.mobs.setFlags(b.mob, { untargetable: false, blockAll: false }));
    events.push(...this.mobs.healFull(b.mob));
    return events;
  }

  /** Dev (?warrensboss=<id>): every area before that boss's cleared (their bosses gone, shutters open), the run
   *  started, and the first arrival at the edge of its arena nearest its area's checkpoint. False: no such boss. */
  skipTo(bossId: string, now: number): boolean {
    const list = [...this.bosses.values()];
    const at = list.findIndex((b) => b.def.id === bossId);
    if (at < 0) return false;
    for (const b of list.slice(0, at)) {
      b.dead = true;
      this.mobs.removeMobs([b.mob]);
      const shutter = this.map.dungeon.shutters.find((x) => x.area === b.area.id);
      if (!shutter) continue;
      this.opened.add(shutter.area);
      for (const [c, r] of shutter.passage) this.map.blocked[r][c] = 0;
    }
    const area = list[at].area;
    // (A tile with arena all round it, so the arrival's spread stays inside.)
    const arena = new Set(area.arenaTiles.map(key));
    const inner = area.arenaTiles.filter(([c, r]) => this.mobs.open(c, r) && [-1, 0, 1].every((dc) => [-1, 0, 1].every((dr) => arena.has(key([c + dc, r + dr])))));
    this.devArrival = inner.sort((a, b) => hyp(a, area.checkpoint) - hyp(b, area.checkpoint))[0] ?? area.checkpoint;
    if (this.phase === 'gathering') this.start(now, news());
    return true;
  }

  // ── Kills ──

  /** A kill in the run: a mini boss opens its shutter (the checkpoint moves on), Barong-Barong clears the run. */
  onKill(kill: MobKill, now: number): RunNews {
    const out = news();
    const b = this.bosses.get(kill.id);
    if (!b || b.dead) return out;
    b.dead = true;
    this.pending = this.pending.filter((p) => p.boss !== b.mob);
    out.room.push({ t: 'boss-cancel', id: b.mob });
    out.room.push(...(this.mobs.setFlags(b.mob, { untargetable: false, blockAll: false }) as TownServerMessage[]));
    if (b.last) {
      // Its Scraplings fall apart with it.
      const scrap = [...this.mobs.calledBy(b.mob), ...[0, 1].map((k) => `guard:${b.def.id}:${k}`)];
      out.room.push(this.moveEvent(b.mob, 'fallApart', 0, undefined, { ids: scrap }) as TownServerMessage);
      out.room.push(...(this.mobs.removeMobs(scrap) as TownServerMessage[]));
      this.phase = 'cleared';
      this.clearedAt = now;
      out.room.push(this.line(`${b.def.name} has fallen! The Warrens close in ${this.W.run.closeAfterLastBossMinutes} minutes.`, 'down'));
      return out;
    }
    const shutter = this.map.dungeon.shutters.find((s) => s.area === b.area.id);
    if (shutter && !this.opened.has(shutter.area)) {
      this.opened.add(shutter.area);
      for (const [c, r] of shutter.passage) this.map.blocked[r][c] = 0;
      const to = this.map.dungeon.areas.find((a) => a.id === shutter.opensTo);
      out.room.push(this.line(`${b.def.name} is down. The way to ${to?.name ?? 'the next area'} is open.`, 'down'));
    }
    return out;
  }

  /** A kill's loot (everything on the floor for the run, first come): a mini boss's pile, Barong-Barong's for each player
   *  inside, or a mob's drops. `classes`: the classes of the players inside. */
  lootFor(kill: MobKill, classes: (string | null)[], uid: () => string, random: () => number, plusRandom = random): { contents: LootContent[]; at: Tile } {
    const data = this.deps.fightData;
    const n = Math.max(1, this.inside.size);
    const b = this.bosses.get(kill.id);
    if (b?.last) return { contents: warrensBossLoot(data, this.W, classes, n, random, uid, plusRandom), at: this.lootSpot() };
    if (b) return { contents: warrensMiniLoot(data, this.W, b.def, classes, n, random, uid, plusRandom), at: kill.at };
    const area = this.W.areas.find((a) => a.mobs.kind === kill.kind);
    const kusing = area?.mobs.kusing ?? this.W.scrapling.kusing;
    return { contents: warrensMobDrops(data, this.W, kill.kind, kill.level, kusing, random, uid, plusRandom), at: kill.at };
  }

  /** In front of Barong-Barong (south of its body, on open floor). */
  private lootSpot(): Tile {
    const [, , c1, r1] = this.W.lastBoss.body;
    return [c1 + 1, r1 + 1];
  }

  // ── The director: the bosses' moves ──

  tick(now: number, players: ReadonlyMap<string, Tile>): MobEvent[] {
    if (this.phase !== 'running' && this.phase !== 'cleared') return [];
    const events: MobEvent[] = [];
    // Moves landing now.
    const due = this.pending.filter((p) => p.at <= now);
    if (due.length) {
      this.pending = this.pending.filter((p) => p.at > now);
      for (const p of due) events.push(...p.land(now, players));
    }
    for (const b of this.bosses.values()) {
      if (b.dead || !b.engaged) continue;
      const info = this.mobs.mobInfo(b.mob, now);
      if (!info || info.dead) continue;
      const near = [...players].filter(([, p]) => inRect(b.area.arena, ...p));
      if (!near.length) continue;
      for (const m of b.def.mechanics) {
        if (!m.every || (m.fromHp !== undefined && info.hp / info.maxHp > m.fromHp)) continue;
        const next = b.next.get(m.id) ?? now;
        if (now < next) continue;
        const every = (b.enraged && m.id === 'roofRain' ? (this.lastBoss('enrage')?.roofRainEvery ?? m.every) : m.every) * 1000 / (b.enraged ? this.enrageSpeed() : 1);
        b.next.set(m.id, now + every);
        // It stops where it is and holds still till the move lands (Lid Slam's circle stays round it; a cone stays aimed).
        const hold = this.mobs.hold(b.mob, now + (m.id === 'chainZap' ? (this.deps.kinds[b.def.kind ?? '']?.hitMs ?? 400) : (m.telegraphMs ?? 800)), now);
        events.push(...hold, ...this.startMove(b, m, this.mobs.mobInfo(b.mob, now)!.at, near, now));
      }
    }
    events.push(...this.scraplings(now, players));
    return events;
  }

  private lastBoss(id: string): DungeonMechanic | undefined {
    return this.W.lastBoss.mechanics.find((m) => m.id === id);
  }

  private enrageSpeed(): number {
    return this.lastBoss('enrage')?.attackSpeed ?? 1;
  }

  private moveEvent(boss: string, move: string, ms: number, shape?: TelegraphShape, data?: Record<string, unknown>): MobEvent {
    return { t: 'boss-move', id: boss, move, key: `${boss}:${++this.moveSeq}`, ms, ...(shape ? { shape } : {}), ...(data ? { data } : {}) };
  }

  /** Hits on everyone in a shape when it lands (where they stand then): rolled, landed now, sent as `boss-hit`. */
  private landHits(boss: string, move: string, key: string, players: ReadonlyMap<string, Tile>, test: (p: Tile) => boolean, mult: number, now: number, extra: { slow?: number; stun?: number } = {}, data?: Record<string, unknown>): MobEvent[] {
    const hits: { id: string; damage: number; miss?: boolean }[] = [];
    for (const [id, p] of players) {
      if (!test(p)) continue;
      const hit = this.mobs.rollFor(id, boss, mult);
      if (!hit) continue;
      this.mobs.land(id, boss, hit, now, extra);
      hits.push({ id, damage: hit.damage, ...(hit.miss ? { miss: true } : {}) });
    }
    return [{ t: 'boss-hit', id: boss, move, key, hits, ...(data ? { data } : {}) }];
  }

  /** A timed move starts: its telegraph now, its hit later (a Pending). */
  private startMove(b: BossState, m: DungeonMechanic, at: Tile, near: [string, Tile][], now: number): MobEvent[] {
    const ms = m.telegraphMs ?? 800;
    const mult = m.atkMult ?? 1;
    const random = this.deps.random;
    const pickPlayer = (list: [string, Tile][]) => list[Math.floor(random() * list.length)];
    const queue = (ev: MobEvent, land: Pending['land'], when = now + ms) => {
      this.pending.push({ boss: b.mob, at: when, land });
      return [ev];
    };
    switch (m.id) {
      case 'lidSlam': {
        const shape: TelegraphShape = { kind: 'circle', at, radius: m.radius ?? 2 };
        const ev = this.moveEvent(b.mob, m.id, ms, shape);
        return queue(ev, (t, players) => this.landHits(b.mob, m.id, (ev as { key: string }).key, players, (p) => inShape(shape, p), mult, t));
      }
      case 'burnoutCharge': {
        // At the farthest player in its arena: a line `length` long (it stops at walls), then it rolls down it.
        const target = [...near].sort((x, y) => hyp(y[1], at) - hyp(x[1], at))[0];
        const dir = Math.atan2(target[1][1] - at[1], target[1][0] - at[0]);
        const path: Tile[] = [];
        for (let k = 1; k <= (m.length ?? 8); k++) {
          const t: Tile = [Math.round(at[0] + Math.cos(dir) * k), Math.round(at[1] + Math.sin(dir) * k)];
          if (!this.mobs.open(...t) || !inRect(b.area.rect, ...t)) break;
          if (!path.length || key(path[path.length - 1]) !== key(t)) path.push(t);
        }
        const end = path[path.length - 1] ?? at;
        const shape: TelegraphShape = { kind: 'line', from: at, to: end, width: m.width ?? 1 };
        const tiles = new Set([key(at), ...path.map(key)]);
        const speed = m.speedTilesPerSec ?? 12;
        const ev = this.moveEvent(b.mob, m.id, ms, shape, { path, speed, wall: path.length < (m.length ?? 8) });
        return queue(ev, (t, players) => [
          ...this.mobs.moveMob(b.mob, path, t, speed),
          ...this.landHits(b.mob, m.id, (ev as { key: string }).key, players, (p) => tiles.has(key(p)), mult, t),
        ]);
      }
      case 'smotherFog': {
        const picked = [...near].sort(() => random() - 0.5).slice(0, 3);
        const shape: TelegraphShape = { kind: 'circles', circles: picked.map(([, p]) => ({ at: p, radius: m.radius ?? 1.5 })) };
        const ev = this.moveEvent(b.mob, m.id, ms, shape);
        return queue(ev, (t, players) => this.landHits(b.mob, m.id, (ev as { key: string }).key, players, (p) => inShape(shape, p), mult, t, { slow: m.slow?.ms ?? 3000 }));
      }
      case 'chainZap': {
        // Its zap at its foe (else the nearest) within range, jumping on to up to `jumps` more players within jumpRange.
        const info = this.mobs.mobInfo(b.mob, now)!;
        const first = near.find(([id]) => id === info.foe) ?? [...near].sort((x, y) => hyp(x[1], at) - hyp(y[1], at))[0];
        if (!first || cheb(first[1], at) > (m.range ?? 4)) return [];
        const chain: [string, Tile][] = [first];
        while (chain.length < 1 + (m.jumps ?? 2)) {
          const last = chain[chain.length - 1][1];
          const next = near.filter(([id, p]) => !chain.some(([c]) => c === id) && hyp(p, last) <= (m.jumpRange ?? 3)).sort((x, y) => hyp(x[1], last) - hyp(y[1], last))[0];
          if (!next) break;
          chain.push(next);
        }
        const zapMs = this.deps.kinds[b.def.kind ?? 'wire-tangle']?.hitMs ?? 400;
        const ev = this.moveEvent(b.mob, m.id, zapMs, undefined, { chain: chain.map(([id]) => id), from: at });
        return queue(
          ev,
          (t, players) => {
            const hits: { id: string; damage: number; miss?: boolean }[] = [];
            chain.forEach(([id], i) => {
              if (!players.has(id)) return;
              const hit = this.mobs.rollFor(id, b.mob, mult * (i ? (m.jumpMult ?? 0.7) : 1));
              if (!hit) return;
              this.mobs.land(id, b.mob, hit, t + i * 80);
              hits.push({ id, damage: hit.damage, ...(hit.miss ? { miss: true } : {}) });
            });
            return [{ t: 'boss-hit', id: b.mob, move: m.id, key: (ev as { key: string }).key, hits }];
          },
          now + zapMs,
        );
      }
      case 'liveFloor': {
        const floor = b.area.arenaTiles;
        const under = [...near].sort(() => random() - 0.5).slice(0, 2).map(([, p]) => p);
        const tiles: Tile[] = [...under, ...this.draw(floor, (m.count ?? 6) - under.length, (t) => !under.some((x) => key(x) === key(t)))];
        const shape: TelegraphShape = { kind: 'tiles', tiles, colour: 'yellow' };
        const ev = this.moveEvent(b.mob, m.id, ms, shape);
        return queue(ev, (t, players) => this.landHits(b.mob, m.id, (ev as { key: string }).key, players, (p) => inShape(shape, p), mult, t, { stun: m.stunMs ?? 500 }));
      }
      case 'pincerSweep': {
        const info = this.mobs.mobInfo(b.mob, now)!;
        const foe = near.find(([id]) => id === info.foe) ?? [...near].sort((x, y) => hyp(x[1], at) - hyp(y[1], at))[0];
        const facing = Math.atan2(foe[1][1] - at[1], foe[1][0] - at[0]);
        const shape: TelegraphShape = { kind: 'cone', origin: at, facing, angle: m.angleDeg ?? 90, length: m.length ?? 3 };
        const ev = this.moveEvent(b.mob, m.id, ms, shape);
        return queue(ev, (t, players) => this.landHits(b.mob, m.id, (ev as { key: string }).key, players, (p) => inShape(shape, p), mult, t));
      }
      case 'fistSlam': {
        // Under a random player within 10 tiles; the hands take turns.
        const within = near.filter(([, p]) => hyp(p, this.W.lastBoss.tile) <= 10);
        if (!within.length) return [];
        const target = pickPlayer(within);
        const shape: TelegraphShape = { kind: 'circle', at: target[1], radius: m.radius ?? 3 };
        b.hand = b.hand === 'l' ? 'r' : 'l';
        const ev = this.moveEvent(b.mob, m.id, ms, shape, { hand: b.hand, enraged: b.enraged });
        return queue(ev, (t, players) => this.landHits(b.mob, m.id, (ev as { key: string }).key, players, (p) => inShape(shape, p), mult, t));
      }
      case 'roofRain': {
        const floor = b.area.arenaTiles;
        const under = [...near].sort(() => random() - 0.5).slice(0, 2).map(([, p]) => p);
        const rest = this.draw(floor, (m.count ?? 8) - under.length, (t, drawn) => [...under, ...drawn].every((c) => hyp(c, t) >= 2));
        const circles = [...under, ...rest].map((t) => ({ at: t, radius: m.radius ?? 1.5 }));
        const shape: TelegraphShape = { kind: 'circles', circles };
        const ev = this.moveEvent(b.mob, m.id, ms, shape, { enraged: b.enraged, offsets: circles.map(() => Math.round(random() * 200)), poses: circles.map(() => Math.floor(random() * 16)) });
        return queue(ev, (t, players) => this.landHits(b.mob, m.id, (ev as { key: string }).key, players, (p) => inShape(shape, p), mult, t));
      }
      case 'gutterSweep': {
        // In front of it (S on the screen: +col +row on the grid).
        const shape: TelegraphShape = { kind: 'cone', origin: this.W.lastBoss.tile, facing: Math.PI / 4, angle: m.angleDeg ?? 140, length: m.length ?? 6 };
        const ev = this.moveEvent(b.mob, m.id, ms, shape, { enraged: b.enraged });
        return queue(ev, (t, players) => this.landHits(b.mob, m.id, (ev as { key: string }).key, players, (p) => inShape(shape, p), mult, t));
      }
    }
    return [];
  }

  /** Scraplings (Barong-Barong's): each one next to its foe slams (the golem's Tire Slam, small): its hit when the slam
   *  lands, on everyone within a tile of where it lands. */
  private scraplings(now: number, players: ReadonlyMap<string, Tile>): MobEvent[] {
    const events: MobEvent[] = [];
    const ids = [...this.mobs.calledBy(`boss:${this.W.lastBoss.id}`), ...[0, 1].map((k) => `guard:${this.W.lastBoss.id}:${k}`)];
    for (const id of ids) {
      const info = this.mobs.mobInfo(id, now);
      if (!info || info.dead || !info.foe) continue;
      const foe = players.get(info.foe);
      if (!foe || cheb(foe, info.at) > 2 || now < (this.lastScraplingSlam.get(id) ?? 0)) continue;
      this.lastScraplingSlam.set(id, now + 2400);
      const at: Tile = [...foe];
      const ev = this.moveEvent(id, 'scrapSlam', this.deps.slamMs, undefined, { at, from: info.at });
      events.push(ev);
      this.pending.push({ boss: id, at: now + this.deps.slamMs, land: (t, ps) => this.landHits(id, 'scrapSlam', (ev as { key: string }).key, ps, (p) => cheb(p, at) <= 1, this.W.scrapling.attacks.tireSlam, t) });
    }
    return events;
  }

  /** A mob's HP fell: a boss's thresholds (calls, Vanish, Hunker, Shanty Call, enrage). */
  hurt(id: string, now: number): MobEvent[] {
    const b = this.bosses.get(id);
    if (!b || b.dead) return [];
    const info = this.mobs.mobInfo(id, now);
    if (!info || info.dead) return [];
    if (!b.engaged) {
      b.engaged = true;
      b.lastInside = now;
      for (const m of b.def.mechanics) if (m.every) b.next.set(m.id, now + (m.every * 1000) / 2);
    }
    const share = info.hp / info.maxHp;
    const events: MobEvent[] = [];
    for (const m of b.def.mechanics) {
      const marks = Array.isArray(m.atHp) ? m.atHp : m.atHp !== undefined ? [m.atHp] : [];
      for (const t of marks) {
        const mark = `${m.id}:${t}`;
        if (share > t || b.crossed.has(mark)) continue;
        b.crossed.add(mark);
        events.push(...this.threshold(b, m, info.at, now));
      }
    }
    return events;
  }

  /** Open floor tiles of a boss's arena with nobody on them, near its edge (`edge`) or anywhere. */
  private spots(b: BossState, n: number, edge: boolean): Tile[] {
    const floor = b.area.arenaTiles;
    const set = new Set(floor.map(key));
    const ring = edge ? floor.filter(([c, r]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => !set.has(key([c + dc, r + dr])))) : floor;
    return this.draw(ring, n, (t) => this.mobs.open(...t) && !this.mobs.occupied(...t));
  }

  /** Up to `n` of `list` drawn at random, no repeats, each passing `ok` (given those drawn so far). */
  private draw<T>(list: T[], n: number, ok: (t: T, drawn: T[]) => boolean = () => true): T[] {
    const left = [...list];
    const out: T[] = [];
    while (out.length < n && left.length) {
      const [t] = left.splice(Math.floor(this.deps.random() * left.length), 1);
      if (ok(t, out)) out.push(t);
    }
    return out;
  }

  private callCount = 0;

  /** Mobs a boss calls: the golem's call-junk on each spot first, then they appear (`ms` later). */
  private call(b: BossState, kind: string, spots: Tile[], now: number, ms = 600, move = 'call'): MobEvent[] {
    const area = this.W.areas.find((a) => a.mobs.kind === kind);
    const stats = area ? { level: area.mobs.level, hp: area.mobs.hp, atk: area.mobs.atk, def: area.mobs.def, xp: area.mobs.xp } : this.scraplingStats();
    const specs: MobSpec[] = spots.map((t) => (kind === 'scrapling' ? this.scrapling(`called:${b.def.id}:${++this.callCount}`, b.area.id, t, b.mob) : { id: `called:${b.def.id}:${++this.callCount}`, kind, zone: b.area.id, tile: t, stats, calledBy: b.mob }));
    const ev = this.moveEvent(b.mob, move, ms, undefined, { spots, kind });
    this.pending.push({ boss: b.mob, at: now + ms, land: (t) => this.mobs.addMobs(specs, t) });
    return [ev];
  }

  private threshold(b: BossState, m: DungeonMechanic, at: Tile, now: number): MobEvent[] {
    switch (m.id) {
      case 'canRally':
      case 'pitCrew':
      case 'sparkCall':
        return m.calls ? this.call(b, m.calls.kind, this.spots(b, m.calls.count, true), now) : [];
      case 'vanish': {
        // Gone for a while (can't be targeted or hit), its Bag Spooks about, then back on a random arena tile.
        const ms = m.untargetableMs ?? 4000;
        const to = this.spots(b, 1, false)[0] ?? at;
        const events: MobEvent[] = [...this.mobs.setFlags(b.mob, { untargetable: true }), this.moveEvent(b.mob, 'vanish', ms, undefined, { from: at, to, alpha: m.alpha ?? 0.3 })];
        if (m.calls) events.push(...this.call(b, m.calls.kind, this.spots(b, m.calls.count, false), now, 300, 'vanishCall'));
        this.pending.push({ boss: b.mob, at: now + ms, land: (t) => [...this.mobs.moveMob(b.mob, [to], t, undefined, true), ...this.mobs.setFlags(b.mob, { untargetable: false })] });
        return events;
      }
      case 'hunker': {
        const ms = m.blockAllMs ?? 5000;
        const events: MobEvent[] = [...this.mobs.setFlags(b.mob, { blockAll: true }), this.moveEvent(b.mob, 'hunker', ms)];
        if (m.calls) events.push(...this.call(b, m.calls.kind, this.spots(b, m.calls.count, true), now));
        this.pending.push({ boss: b.mob, at: now + ms, land: () => this.mobs.setFlags(b.mob, { blockAll: false }) });
        return events;
      }
      case 'shantyCall': {
        // Out of its doors onto open hall floor in front of it (the call anim's frame 3, then a hop).
        const front = b.area.arenaTiles.filter((t) => t[0] + t[1] > this.W.lastBoss.tile[0] + this.W.lastBoss.tile[1] + 3 && hyp(t, this.W.lastBoss.tile) <= 8 && this.mobs.open(...t) && !this.mobs.occupied(...t));
        const spots = this.draw(front, m.calls?.count ?? 2, (t, drawn) => drawn.every((x) => hyp(x, t) >= 2));
        return this.call(b, 'scrapling', spots, now, 750, 'shantyCall');
      }
      case 'enrage':
        b.enraged = true;
        return [this.moveEvent(b.mob, 'enrage', 0)];
    }
    return [];
  }
}

/** All the runs: opening, joining, who may come in, the clock, closing. */
export class Warrens {
  private readonly runs = new Map<string, Run>();
  /** The most open at once. */
  static readonly MAX_RUNS = 10;

  constructor(
    readonly W: WarrensData,
    private readonly template: WarrensMap,
    private readonly deps: RunDeps,
    /** The host's party key for a member (any value that's the same for the whole party), or null. */
    private readonly partyOf: (member: string) => unknown,
    private readonly newId: () => string = () => `${Date.now().toString(36).slice(-4)}${(++runSeq).toString(36)}${Math.floor(deps.random() * 1296).toString(36)}`,
  ) {}

  /** A run by its room (`warrens:<id>`) or id. */
  get(roomOrId: string): Run | undefined {
    return this.runs.get(roomOrId.startsWith('warrens:') ? roomOrId.slice(8) : roomOrId);
  }

  all(): Run[] {
    return [...this.runs.values()];
  }

  /** The run a member may be in now (see `allowed`), if any: where a reload or the gate takes them. */
  runOf(member: string): Run | undefined {
    return this.all().find((r) => r.phase !== 'closed' && this.allowed(r, member));
  }

  /** The run a member may go into (their party's, or their own solo one), if any. */
  runFor(member: string): Run | undefined {
    const party = this.partyOf(member);
    return this.all().find((r) => r.phase !== 'closed' && (party ? r.party === party : !r.party && r.opener.member === member));
  }

  /** Whether a member may be in a run now: the opener of a solo run; anyone in its party (while it lives; once it's
   *  gone, those who were in it). */
  allowed(run: Run, member: string): boolean {
    if (!run.party) return member === run.opener.member;
    const party = this.partyOf(member);
    if (party === run.party) {
      run.members.add(member);
      return true;
    }
    const alive = [...run.members].some((m) => this.partyOf(m) === run.party);
    return !alive && run.members.has(member);
  }

  /** What the Warren Gate offers a member. */
  gate(member: string, level: number, tickets: number): TownWarrensGate {
    const run = this.runFor(member);
    const blocked = level < this.W.entry.minLevel ? 'level' : !run && this.runs.size >= Warrens.MAX_RUNS ? 'full' : !run && tickets < 1 ? 'ticket' : undefined;
    return {
      minLevel: this.W.entry.minLevel, level, tickets, inParty: !!this.partyOf(member),
      partyRun: run ? { id: run.id, phase: run.phase, inside: run.insideCount, opener: run.opener.name } : null,
      ...(blocked ? { blocked } : {}),
    };
  }

  /** Opens a run (a ticket: `useTicket` takes it, false if they have none), or says why not. */
  open(member: string, name: string, level: number, useTicket: () => boolean, now: number): { ok: true; run: Run } | { ok: false; reason: 'level' | 'full' | 'ticket' | 'party'; message: string } {
    if (level < this.W.entry.minLevel) return { ok: false, reason: 'level', message: `The Scrap Warrens are for Lv ${this.W.entry.minLevel} and up.` };
    if (this.runFor(member)) return { ok: false, reason: 'party', message: 'Your party already has a run open: join it instead.' };
    if (this.runs.size >= Warrens.MAX_RUNS) return { ok: false, reason: 'full', message: 'The Warrens are full. Try again in a few minutes.' };
    if (!useTicket()) return { ok: false, reason: 'ticket', message: 'You need a Warren Ticket to open the Scrap Warrens.' };
    const party = this.partyOf(member) ?? null;
    const run = new Run(this.newId(), this.W, this.template, this.deps, { member, name }, party, now);
    this.runs.set(run.id, run);
    return { ok: true, run };
  }

  /** A party member joins their party's run (an invite's Join, or later at the gate): no ticket; it waits for them while
   *  it gathers. */
  join(member: string, level: number, runId?: string): { ok: true; run: Run } | { ok: false; reason: 'level' | 'gone' | 'party'; message: string } {
    if (level < this.W.entry.minLevel) return { ok: false, reason: 'level', message: `The Scrap Warrens are for Lv ${this.W.entry.minLevel} and up.` };
    const run = runId ? this.get(runId) : this.runFor(member);
    if (!run || run.phase === 'closed') return { ok: false, reason: 'gone', message: 'That run has closed.' };
    if (!this.allowed(run, member)) return { ok: false, reason: 'party', message: "That isn't your party's run." };
    if (run.phase === 'gathering') run.expected.add(member);
    return { ok: true, run };
  }

  /** Every run's clock; closed ones are dropped (their news says who goes out). */
  tick(now: number, insideOf: (run: Run) => Inside[]): { run: Run; news: RunNews }[] {
    const out: { run: Run; news: RunNews }[] = [];
    for (const run of this.runs.values()) {
      run.setInside(insideOf(run), now);
      const n = run.step(now, (m) => this.allowed(run, m));
      out.push({ run, news: n });
      if (n.closed) this.runs.delete(run.id);
    }
    return out;
  }

  /** The open runs (to refund their openers' tickets if a restart ends them before Barong-Barong falls). */
  openRuns(): { id: string; opener: string; cleared: boolean }[] {
    return this.all().map((r) => ({ id: r.id, opener: r.opener.member, cleared: r.phase === 'cleared' }));
  }
}
