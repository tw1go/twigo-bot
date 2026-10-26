import { type ChillRules, type SilongBlock, type SilongData, chillRules, type SilongFloor, type SilongFloorData, type SilongMapRoom, type TownServerMessage, type TownSilongGate, type TownSilongRun, SILONG_FLOORS, floorBelow, inRect, partyHpScale } from '@mikazuki/shared';
import type { LootContent } from './combat-bag.js';
import { dropBoost, silongBossLoot, silongMiniLoot, silongMobDrops } from './loot.js';
import { loadDungeons, loadItemData, loadPalengkeLeveling } from './stats-data.js';
import { type MobDirector, type MobEvent, type MobKill, type MobMapData, type MobSpec, MobRoom, loadMobKinds, loadMobMap, loadSkillShapes } from './town-mobs.js';
import type { Inside, RunDeps } from './town-warrens.js';
import { FloorBosses } from './town-silong-bosses.js';

// 🧊 Ang Silong (classes/dungeons.json `silong`; CONTEXT.md Silong, Floor, Freight elevator, Susi ng Silong): the
// Lumang Palengke's dungeon, three frozen floors under the Market Hall, played as runs like the Scrap Warrens. A run is
// one copy of all three floors for one player or one party: each floor a room of its own (`silong:<id>:<floor>`, the
// page's area `silong-b1`…), with its own mobs (a MobRoom on its own copy of maps/silong-<floor>.json, whose blocked
// tiles the run changes) and loot room. It starts at once (no gathering: joiners come in through the Silong Hatch) and
// runs for the time limit.
// • Floors: B1 and B2 each keep their freight elevator down (X) shut until both their mini bosses are down; it then rides
//   when every living player on that floor stands in it, or 20 s after the first steps in (the others on that floor are
//   asked "Going down?": yes rides them along), to the next floor's arrival elevator (E). From any E you ride back up
//   alone to a floor the run has reached. B3's Ice Tanks door (G) stays shut until Frosty Tubbs falls.
// • Mobs never respawn, all aggressive at 4 tiles, packs assist, kept to their room; HP follows the players inside
//   (scaling); a mini boss with no living player in its room for bossResetSeconds heals to full. Death: back after 3 s
//   at the arrival elevator of the deepest floor reached (the host's respawn).
// • The opener's key (a Susi ng Silong; a practice run's Practice Susi) counts as spent only once a mini boss falls:
//   until then the run's mobs give nothing, and a run that ends gives it back. A practice run (40% HP, 35% ATK) is solo.
// • It closes when time's up, 3 minutes after the last boss falls, or after 2 minutes with nobody inside; everyone still
//   in goes back up to the Market Hall beside the hatch.
// Pure (the host gives the clock, who's where, the party and the quest), tested in town-silong.test.ts.

type Tile = [number, number];
const key = (t: Tile) => `${t[0]},${t[1]}`;
const RIDE_AFTER_MS = 20_000; // the elevator down goes this long after the first player steps in (floorRules.elevator.ride)

/** A floor's map (maps/silong-<floor>.json): the mobs' data and its `silong` block. */
export interface SilongMap extends MobMapData {
  silong: SilongBlock;
  arrive: Record<string, Tile>;
  spawn: Tile;
  avoid?: Tile[];
}

export function loadSilongMaps(): Record<SilongFloor, SilongMap> {
  const out = {} as Record<SilongFloor, SilongMap>;
  for (const f of SILONG_FLOORS) {
    const m = loadMobMap(`silong-${f}`) as SilongMap & { gates?: Record<string, Tile[]> };
    // (The last boss's room has no packs, so no zone of its own on the map: one, for it and the Frost Scales it calls.)
    const zones = [...(m.mobZones ?? [])];
    for (const r of m.silong.rooms) {
      if (!r.boss?.last || zones.some((z) => z.id === r.id)) continue;
      zones.push({ id: r.id, mob: r.mob, level: m.silong.level, rect: r.rect, height: 0, active: true, dungeon: true, spawns: [], groups: [] });
    }
    out[f] = { ...m, mobZones: zones, avoid: Object.values(m.gates ?? {}).flat() };
  }
  return out;
}

/** The Silong as the town takes it: the data, the floors' maps and what a run's mob rooms need. */
export function loadSilong(levels: RunDeps['levels'], random: () => number = Math.random, dropRate?: (member: string) => number) {
  const data = loadDungeons().silong!;
  const deps: RunDeps = { kinds: loadMobKinds(), levels, shapes: loadSkillShapes(), fightData: loadItemData(), leveling: loadPalengkeLeveling(), slamMs: 500, random, ...(dropRate ? { dropRate } : {}) };
  return { data, maps: loadSilongMaps(), deps };
}

/** What a run's clock or a kill sets off: messages for a floor's room or for members wherever they are, who goes out,
 *  and who goes to another floor (`ride`: by the elevator). */
export interface SilongNews {
  room: [string, TownServerMessage][];
  to: [string, TownServerMessage][];
  out: { member: string; reason: 'closed' | 'party' }[];
  go: { member: string; floor: SilongFloor; ride?: 'down' | 'up' }[];
  closed?: boolean;
}
const news = (): SilongNews => ({ room: [], to: [], out: [], go: [] });

/** Someone inside a run: on which floor; `immune` to Chill (a Sinigang or Lugaw on). */
export interface SilongInside extends Inside {
  floor: SilongFloor;
  immune?: boolean;
}

/** One player's Chill: its stacks, since when they stood still (or last took a stack), their last step and since when
 *  they've been walking. */
interface Chilly {
  stacks: number;
  stillSince: number;
  lastStep: number;
  movingSince: number;
}
/** Steps closer than this keep "moving" going (the page steps every ~170 ms; a turn or a bump in between). */
const STILL_GAP_MS = 700;

interface Boss {
  id: string;
  mob: string;
  name: string;
  floor: SilongFloor;
  room: SilongMapRoom;
  dead: boolean;
  engaged: boolean;
  lastInside: number;
  /** Ang Makinang Yelo: its fall clears the run. */
  last?: boolean;
}

/** One floor of a run: its own copy of the map and its mob room, whose director is its mini bosses' moves
 *  (town-silong-bosses.ts). */
class Floor implements MobDirector {
  readonly room: string;
  readonly map: SilongMap;
  readonly mobs: MobRoom;
  /** The elevator down: open (its mini bosses down), when the first stepped in (null: nobody's in), who was asked and
   *  who said yes. */
  open = false;
  firstIn: number | null = null;
  asked = new Set<string>();
  riders = new Set<string>();

  constructor(
    readonly floor: SilongFloor,
    readonly data: SilongFloorData,
    template: SilongMap,
    run: SilongRun,
    deps: RunDeps,
  ) {
    this.room = `${run.room}:${floor}`;
    this.map = { ...template, blocked: template.blocked.map((row) => [...row]) };
    const zoneStats: Record<string, { level: number; hp: number; atk: number; def: number; xp: number }> = {};
    for (const r of data.rooms) zoneStats[r.id] = run.weaker({ level: r.mobs.level, hp: r.mobs.hp, atk: r.mobs.atk, def: r.mobs.def, xp: r.mobs.xp });
    this.mobs = new MobRoom(this.map, deps.random, deps.levels, deps.shapes, deps.kinds, undefined, deps.fightData, deps.leveling, { zoneStats, director: this, dungeonAggro: 4 });
    this.bosses = new FloorBosses({ mobs: this.mobs, map: this.map, weaker: (x) => run.weaker(x) }, data, deps.random, template.silong.rooms.some((r) => r.boss?.last) ? run.S.lastBoss : null);
    for (const [c, r] of template.silong.belts.e) this.belts.set(`${c},${r}`, [1, 0]);
    for (const [c, r] of template.silong.belts.w) this.belts.set(`${c},${r}`, [-1, 0]);
    this.baseBelt = run.S.floorRules.belts.speedTilesPerSec;
  }

  /** A step along a belt from a belt tile, its way (the belts carry players: the page sends those steps, which cost them
   *  nothing of their step budget). */
  alongBelt(from: Tile, to: Tile): boolean {
    const d = this.belts.get(`${from[0]},${from[1]}`);
    return !!d && to[0] - from[0] === d[0] && to[1] - from[1] === d[1];
  }

  /** Its mini bosses' moves. */
  readonly bosses: FloorBosses;

  tick(now: number, players: ReadonlyMap<string, Tile>): MobEvent[] {
    return [...this.bosses.tick(now, players), ...this.carry(now)];
  }

  /** Each belt tile's way (`>` east: +col, `<` west: −col). */
  readonly belts = new Map<string, Tile>();
  private carried = new Map<string, number>();
  /** The belts' speed now (tiles a second): floorRules.belts', or Belt Rush's while it runs. */
  beltSpeed(now: number): number {
    const r = this.bosses.rush;
    return r && now < r.until ? r.speed : this.baseBelt;
  }
  private baseBelt = 2;
  /** The belts carry the mobs standing on them a tile at a time, at their speed (a wall or another mob ahead: they stay). */
  private carry(now: number): MobEvent[] {
    if (!this.belts.size) return [];
    const speed = this.beltSpeed(now);
    const out: MobEvent[] = [];
    for (const m of this.mobs.standingOn((c, r) => this.belts.has(`${c},${r}`), now)) {
      if (now < (this.carried.get(m.id) ?? 0)) continue;
      const [dc, dr] = this.belts.get(`${m.col},${m.row}`)!;
      const to: Tile = [m.col + dc, m.row + dr];
      if (!this.mobs.open(...to) || this.mobs.occupied(...to)) continue;
      this.carried.set(m.id, now + 1000 / speed);
      out.push(...this.mobs.moveMob(m.id, [to], now, speed));
    }
    return out;
  }

  hurt(id: string, now: number): MobEvent[] {
    return this.bosses.hurt(id, now);
  }

  /** Opens tiles for good (the elevator down, a cold-room door) on this floor's copy of the map. */
  unblock(tiles: Tile[]): void {
    for (const [c, r] of tiles) this.map.blocked[r][c] = 0;
  }
}

let runSeq = 0;

export class SilongRun {
  readonly room: string;
  readonly floors: Record<SilongFloor, Floor>;
  phase: TownSilongRun['phase'] = 'running';
  /** Everyone who has come in or joined; who's inside now (by member, with their floor). */
  readonly members = new Set<string>();
  private inside = new Map<string, SilongInside>();
  /** The floors the run has reached (B1 from the start). */
  readonly reached = new Set<SilongFloor>(['b1']);
  readonly startedAt: number;
  readonly endsAt: number;
  clearedAt = 0;
  private clearTeam: string[] = [];
  private emptySince: number;
  private warned = false;
  /** A mini boss has fallen: the opener's key is spent (until then the run's mobs give nothing). */
  keySpent = false;
  /** B3's Ice Tanks door. */
  doorOpen = false;
  private readonly bosses = new Map<string, Boss>();
  private kicks = new Map<string, number>();
  private scaledFor = 0;
  /** Chill (B2, B3 till the Ice Machine falls), by member. */
  private readonly chills = new Map<string, Chilly>();
  readonly chillR: ChillRules;

  constructor(
    readonly id: string,
    readonly S: SilongData,
    maps: Record<SilongFloor, SilongMap>,
    private readonly deps: RunDeps,
    readonly opener: { member: string; name: string },
    /** The opener's party (the host's key for it), or null: a solo run. */
    readonly party: unknown,
    now: number,
    /** A practice run (the Practice Susi ng Silong: 40% HP, 35% ATK, solo). */
    readonly practice = false,
  ) {
    this.room = `silong:${id}`;
    this.chillR = chillRules(S);
    const data = (f: SilongFloor) => S.floors.find((x) => x.id === f)!;
    this.floors = Object.fromEntries(SILONG_FLOORS.map((f) => [f, new Floor(f, data(f), maps[f], this, deps)])) as Record<SilongFloor, Floor>;
    this.members.add(opener.member);
    this.startedAt = now;
    this.endsAt = now + S.run.timeLimitMinutes * 60_000;
    this.emptySince = now;
    for (const f of SILONG_FLOORS) this.placeBosses(this.floors[f], now);
  }

  /** A mob's or boss's numbers in this run: a practice run's HP × practiceRun.mobHpPct, ATK × mobAtkPct. */
  weaker<T extends { hp: number; atk: number }>(s: T): T {
    if (!this.practice) return s;
    const { mobHpPct, mobAtkPct } = this.S.practiceRun;
    return { ...s, hp: Math.max(1, Math.round((s.hp * mobHpPct) / 100)), atk: Math.max(1, Math.round((s.atk * mobAtkPct) / 100)) };
  }

  /** Each room's mini boss on its tile (its room's mobs' art at miniBossLook.drawScale) with its guards beside it. (The
   *  Ice Machine comes with PR 3.) */
  private placeBosses(floor: Floor, now: number): void {
    const specs: MobSpec[] = [];
    for (const r of floor.data.rooms) {
      const def = r.miniBoss;
      const mapRoom = floor.map.silong.rooms.find((x) => x.id === r.id);
      if (!def || !mapRoom) continue;
      const mob = `boss:${def.id}`;
      const kind = mapRoom.mob;
      specs.push({ id: mob, kind, zone: r.id, tile: def.tile, stats: this.weaker({ level: def.level, hp: def.hp, atk: def.atk, def: def.def, xp: def.xp }), boss: 'mini', name: def.name, scale: this.S.miniBossLook.drawScale });
      const spots = guardSpots(floor, def.tile, def.guards);
      spots.forEach((t, k) => specs.push({ id: `guard:${def.id}:${k}`, kind, zone: r.id, tile: t, stats: this.weaker({ level: r.mobs.level, hp: r.mobs.hp, atk: r.mobs.atk, def: r.mobs.def, xp: r.mobs.xp }) }));
      this.bosses.set(mob, { id: def.id, mob, name: def.name, floor: floor.floor, room: mapRoom, dead: false, engaged: false, lastInside: 0 });
    }
    // The last boss (Ang Makinang Yelo) on its body's middle (it never moves or turns), with the Frost Scales it starts
    // with beside its fan.
    const lastRoom = floor.map.silong.rooms.find((r) => r.boss?.last);
    const body = floor.map.silong.bossBody;
    if (lastRoom && body.length) {
      const L = this.S.lastBoss;
      const mob = `boss:${L.id}`;
      const cs = body.map((t) => t[0]);
      const rs = body.map((t) => t[1]);
      const mid: Tile = [Math.floor((Math.min(...cs) + Math.max(...cs)) / 2), Math.floor((Math.min(...rs) + Math.max(...rs)) / 2)];
      // (Its reach: the data's, or as far as its body goes from the middle, so the tiles round the body are next to it.)
      const radius = Math.max(L.reachRadius, ...body.map(([c, r]) => Math.max(Math.abs(c - mid[0]), Math.abs(r - mid[1]))));
      specs.push({ id: mob, kind: L.id, zone: lastRoom.id, tile: mid, stats: this.weaker({ level: L.level, hp: L.hp, atk: L.atk, def: L.def, xp: L.xp }), boss: 'last', name: L.name, title: L.title, radius, still: true, silent: true });
      const call = (L.mechanics as { id: string; start?: number }[]).find((m) => m.id === 'callTheFrost');
      const R = floor.data.rooms.find((r) => r.id === lastRoom.id)!.mobs;
      const fan = floor.map.silong.bossTile ?? mid;
      guardSpots(floor, fan, call?.start ?? 0).forEach((t, k) => specs.push({ id: `guard:${L.id}:${k}`, kind: R.kind, zone: lastRoom.id, tile: t, stats: this.weaker({ level: R.level, hp: R.hp, atk: R.atk, def: R.def, xp: R.xp }) }));
      this.bosses.set(mob, { id: L.id, mob, name: L.name, floor: floor.floor, room: lastRoom, dead: false, engaged: false, lastInside: 0, last: true });
    }
    floor.mobs.addMobs(specs, now);
    floor.bosses.arm();
  }

  roomOf(floor: SilongFloor): string {
    return this.floors[floor].room;
  }

  /** A floor by its room, or null. */
  floorOf(room: string): Floor | null {
    return SILONG_FLOORS.map((f) => this.floors[f]).find((f) => f.room === room) ?? null;
  }

  /** The deepest floor reached (where you come back after dying). */
  deepest(): SilongFloor {
    return [...SILONG_FLOORS].reverse().find((f) => this.reached.has(f))!;
  }

  /** Where someone lands on a floor: its arrival elevator. */
  arrivalFor(floor: SilongFloor): Tile {
    return this.floors[floor].map.silong.arriveMark;
  }

  // ── Who's in ──

  setInside(list: SilongInside[], now: number): void {
    if (list.length || this.inside.size) this.emptySince = now;
    this.inside = new Map(list.map((x) => [x.member, x]));
  }

  get insideCount(): number {
    return this.inside.size;
  }

  view(now: number, member?: string, names?: (member: string) => string): TownSilongRun {
    const left = this.phase === 'running' ? Math.max(0, this.endsAt - now) : this.phase === 'cleared' ? Math.max(0, Math.min(this.endsAt, this.clearedAt + this.S.run.closeAfterLastBossMinutes * 60_000) - now) : 0;
    return {
      id: this.id, phase: this.phase, left, opener: this.opener.name, ...(member === this.opener.member ? { yours: true } : {}), ...(this.practice ? { practice: true } : {}),
      floors: SILONG_FLOORS.map((f) => ({
        floor: f, name: this.floors[f].data.name, reached: this.reached.has(f), open: this.floors[f].open,
        bosses: [...this.bosses.values()].filter((b) => b.floor === f).map((b) => ({ id: b.id, name: b.name, dead: b.dead })),
      })),
      door: this.doorOpen, inside: this.inside.size,
      ...(this.phase === 'cleared' ? { clearMs: this.clearedAt - this.startedAt, team: this.clearTeam.map((m) => names?.(m) ?? m) } : {}),
    };
  }

  // ── The clock (each second, from the host) ──

  step(now: number, allowed: (member: string) => boolean): SilongNews {
    const out = news();
    if (this.phase === 'closed') return out;
    // Party scaling: HP for the players inside now (their share kept), every floor.
    const n = Math.max(1, this.inside.size);
    if (n !== this.scaledFor) {
      this.scaledFor = n;
      for (const f of SILONG_FLOORS) for (const e of this.floors[f].mobs.scaleHp(partyHpScale(this.S.scaling.mobHp, n), partyHpScale(this.S.scaling.bossHp, n))) out.room.push([this.floors[f].room, e as TownServerMessage]);
    }
    this.resets(now, out);
    this.chill(now, out);
    for (const f of SILONG_FLOORS) this.elevator(this.floors[f], now, out);
    // Someone who left the party while inside: out after the wait (told once).
    for (const [member] of this.inside) {
      if (allowed(member)) {
        this.kicks.delete(member);
        continue;
      }
      if (!this.kicks.has(member)) {
        const ms = this.S.run.leavePartyKickSeconds * 1000;
        this.kicks.set(member, now + ms);
        out.to.push([member, { t: 'silong-kick', ms }]);
      } else if (now >= this.kicks.get(member)!) {
        this.kicks.delete(member);
        out.out.push({ member, reason: 'party' });
      }
    }
    if (this.phase === 'running' && !this.warned && now >= this.endsAt - 60_000) {
      this.warned = true;
      this.everywhere(out, this.line('One minute left in the Cellar!', 'stir'));
    }
    const timeUp = now >= this.endsAt;
    const cleared = this.phase === 'cleared' && now >= this.clearedAt + this.S.run.closeAfterLastBossMinutes * 60_000;
    const empty = !this.inside.size && now - this.emptySince >= this.S.run.closeWhenEmptySeconds * 1000;
    if (timeUp || cleared || empty) this.close(out);
    return out;
  }

  /** The elevator down on a floor, once open: who's in it; it rides when every living player on that floor is in (or
   *  said yes), or RIDE_AFTER_MS after the first stepped in; the others there are asked once. */
  private elevator(f: Floor, now: number, out: SilongNews): void {
    const below = floorBelow(f.floor);
    if (!f.open || !below) return;
    const down = new Set(f.map.silong.down.map(key));
    const here = [...this.inside.values()].filter((x) => x.floor === f.floor && !x.out);
    const inIt = here.filter((x) => down.has(key(x.at)));
    if (!inIt.length) {
      f.firstIn = null;
      f.asked.clear();
      f.riders.clear();
      return;
    }
    f.firstIn ??= now;
    const left = f.firstIn + RIDE_AFTER_MS - now;
    for (const x of here) {
      if (down.has(key(x.at)) || f.asked.has(x.member)) continue;
      f.asked.add(x.member);
      out.to.push([x.member, { t: 'silong-ride-ask', ms: Math.max(0, left) }]);
    }
    const all = here.every((x) => down.has(key(x.at)) || f.riders.has(x.member));
    if (!all && left > 0) return;
    // Down it goes: those in it and those who said yes.
    const riders = here.filter((x) => down.has(key(x.at)) || f.riders.has(x.member));
    this.reached.add(below);
    for (const x of riders) out.go.push({ member: x.member, floor: below, ride: 'down' });
    f.firstIn = null;
    f.asked.clear();
    f.riders.clear();
  }

  /** An answer to "Going down?": yes rides along with the others (on that floor, while it's waiting). */
  answerRide(member: string, yes: boolean): void {
    const x = this.inside.get(member);
    const f = x ? this.floors[x.floor] : null;
    if (!f || f.firstIn === null) return;
    if (yes) f.riders.add(member);
    else f.riders.delete(member);
  }

  /** Riding up from an arrival elevator (E) to a floor above that the run has reached: why not, or null (go). */
  rideUp(member: string, to: SilongFloor): string | null {
    const x = this.inside.get(member);
    if (!x) return "You're not in the Cellar.";
    if (!this.reached.has(to) || SILONG_FLOORS.indexOf(to) >= SILONG_FLOORS.indexOf(x.floor)) return 'The elevator only goes up to floors you have reached.';
    const arrive = new Set(this.floors[x.floor].map.silong.arrive.map(key));
    if (!arrive.has(key(x.at))) return 'Step into the freight elevator first.';
    return null;
  }

  private close(out: SilongNews): void {
    this.phase = 'closed';
    for (const member of this.inside.keys()) out.out.push({ member, reason: 'closed' });
    out.closed = true;
  }

  /** A line to every floor's room. */
  private everywhere(out: SilongNews, msg: TownServerMessage): void {
    for (const f of SILONG_FLOORS) out.room.push([this.floors[f].room, msg]);
  }

  private line(text: string, tone: string): TownServerMessage {
    return { t: 'system', line: { kind: 'warrens', text, tone } };
  }

  /** Mini bosses with no living player in their room for bossResetSeconds: full HP, their called mobs gone. */
  private resets(now: number, out: SilongNews): void {
    const ms = this.S.run.bossResetSeconds * 1000;
    for (const b of this.bosses.values()) {
      if (b.dead) continue;
      const here = [...this.inside.values()].some((p) => p.floor === b.floor && !p.out && inRect(b.room.rect, ...p.at));
      if (here) {
        b.lastInside = now;
        b.engaged = true;
        continue;
      }
      if (!b.engaged || now - b.lastInside < ms) continue;
      b.engaged = false;
      const f = this.floors[b.floor];
      const events = [...f.bosses.stop(b.mob), ...f.mobs.removeMobs(f.mobs.calledBy(b.mob)), ...f.mobs.healFull(b.mob)];
      for (const e of events) out.room.push([f.room, e as TownServerMessage]);
    }
  }

  // ── Kills ──

  /** A kill on a floor: a mini boss down (the key's spent; both of a floor's down: its elevator opens; Frosty Tubbs:
   *  the Ice Tanks door). */
  onKill(floor: SilongFloor, kill: MobKill, now: number): SilongNews {
    const out = news();
    const b = this.bosses.get(kill.id);
    if (!b || b.dead || b.floor !== floor) return out;
    b.dead = true;
    this.keySpent = true;
    const f = this.floors[floor];
    out.room.push([f.room, { t: 'boss-cancel', id: b.mob }]);
    for (const e of [...f.bosses.stop(b.mob), ...f.mobs.removeMobs(f.mobs.calledBy(b.mob))]) out.room.push([f.room, e as TownServerMessage]);
    // The last boss: the run's cleared (it closes closeAfterLastBossMinutes later); the frost melts on every floor.
    if (b.last) {
      this.phase = 'cleared';
      this.clearedAt = now;
      this.clearTeam = [...this.inside.keys()];
      this.everywhere(out, { t: 'boss-move', id: b.mob, move: 'melt', key: `${b.mob}:melt`, ms: 0 });
      this.everywhere(out, this.line(`${b.name} grinds to a stop. The frost melts away: the Cellar is cleared! It closes in ${this.S.run.closeAfterLastBossMinutes} minutes.`, 'down'));
      return out;
    }
    // The Ice Tanks door opens with its boss.
    const door = f.map.silong.doors.find((d) => d.room === b.room.id);
    if (door && !this.doorOpen) {
      this.doorOpen = true;
      f.unblock(door.tiles);
      out.room.push([f.room, this.line(`${b.name} is down. The Ice Tanks door cracks open: the Ice Plant is ahead.`, 'down')]);
    }
    // Both of a floor's mini bosses down: its elevator down wakes.
    const left = [...this.bosses.values()].filter((x) => x.floor === floor && !x.dead);
    if (!left.length && floorBelow(floor) && !f.open) {
      f.open = true;
      f.unblock(f.map.silong.down);
      out.room.push([f.room, this.line(`${b.name} is down. The freight elevator rumbles awake: going down!`, 'down')]);
    } else if (!door) out.room.push([f.room, this.line(`${b.name} is down.`, 'down')]);
    return out;
  }

  // ── Chill (silong.floorRules.chill) ──

  /** A step (or a move) by someone inside: they're moving. */
  stepped(member: string, now: number): void {
    const c = this.chills.get(member);
    if (!c) return void this.chills.set(member, { stacks: 0, stillSince: now, lastStep: now, movingSince: now });
    if (now - c.lastStep > STILL_GAP_MS) c.movingSince = now;
    c.lastStep = now;
  }

  /** Their Chill stacks now (0 off a cold floor). */
  chillOf(member: string): number {
    return this.chills.get(member)?.stacks ?? 0;
  }

  /** Each second: a stack for every `everyMs` standing still on a cold floor, one a second in the Brine Flood, the Freezer
   *  Breath's; cleared by walking `moveMs`, a work lamp within `lampTiles`, a Sinigang or Lugaw on, a knock-out, a warm
   *  floor (B1), and for good once the Ice Machine falls (the frost melts). Each change to the floor's room. */
  private chill(now: number, out: SilongNews): void {
    const R = this.chillR;
    const breath = new Map<string, number>();
    for (const f of SILONG_FLOORS) for (const [id, n] of this.floors[f].bosses.chilled.splice(0)) breath.set(id, (breath.get(id) ?? 0) + n);
    for (const p of this.inside.values()) {
      const f = this.floors[p.floor];
      const c = this.chills.get(p.member) ?? { stacks: 0, stillSince: now, lastStep: 0, movingSince: 0 };
      this.chills.set(p.member, c);
      const before = c.stacks;
      let puff = false;
      const lamp = f.map.silong.lamps.some(([lc, lr]) => Math.max(Math.abs(lc - p.at[0]), Math.abs(lr - p.at[1])) <= R.lampTiles);
      const walking = now - c.lastStep <= STILL_GAP_MS;
      if (!f.data.chill || this.phase !== 'running' || p.immune || p.out || lamp) {
        c.stacks = 0;
        c.stillSince = now;
      } else {
        if (walking) {
          c.stillSince = now;
          if (now - c.movingSince >= R.moveMs) c.stacks = 0;
        } else if (now - Math.max(c.stillSince, c.lastStep) >= R.everyMs) {
          c.stacks += 1;
          c.stillSince = now;
        }
        const add = (breath.get(p.id) ?? 0) + (f.bosses.flood?.tiles.has(`${p.at[0]},${p.at[1]}`) ? 1 : 0);
        c.stacks += add;
        c.stacks = Math.min(R.max, c.stacks);
      }
      puff = c.stacks > before;
      if (c.stacks !== before) out.room.push([f.room, { t: 'chill', id: p.id, stacks: c.stacks, ...(puff ? { puff: true } : {}) }]);
    }
  }

  /** Whether a kill is the last boss's. */
  isLastBoss(id: string): boolean {
    return !!this.bosses.get(id)?.last;
  }

  /** A kill's loot on a floor (silong.loot; all of it on the floor for anyone inside, first come): a mini boss's Kusing
   *  pile and a roll per player inside, Ang Makinang Yelo's heap for each (in front of its fan), a room mob's own; gear
   *  for the classes of those inside, boosted by the highest Drop rate inside. A practice run: its Kusing only (XP and
   *  Kusing, nothing else). */
  lootFor(floor: SilongFloor, kill: MobKill, classes: (string | null)[], uid: () => string, random: () => number, plusRandom = random): { contents: LootContent[]; at: Tile } {
    const data = this.deps.fightData;
    const n = Math.max(1, this.inside.size);
    const boost = dropBoost(data, Math.max(0, ...[...this.inside.keys()].map((m) => this.deps.dropRate?.(m) ?? 0)));
    const b = this.bosses.get(kill.id);
    const rooms = this.S.floors.find((f) => f.id === floor)?.rooms ?? [];
    const r = b?.last
      ? { contents: silongBossLoot(data, this.S, classes, n, random, uid, plusRandom, boost), at: this.floors[floor].map.silong.bossTile ?? kill.at }
      : b
        ? { contents: silongMiniLoot(data, this.S, rooms.find((x) => x.miniBoss?.id === b.id)?.miniBoss ?? kill, classes, n, random, uid, plusRandom, boost), at: kill.at }
        : { contents: silongMobDrops(data, this.S, kill.kind, kill.level, rooms.find((x) => x.mobs.kind === kill.kind || x.mobs.kind === kill.kind.replace(/-frost$/, ''))?.mobs.kusing ?? 0, random, uid, plusRandom, boost), at: kill.at };
    if (this.practice) r.contents = r.contents.filter((c) => 'kusing' in c);
    return r;
  }

  /** Dev (?silong=plant&hp=): to B3 with Frosty Tubbs down and the Ice Tanks door open (Ang Makinang Yelo next; `hp`:
   *  down to that much). */
  skipToPlant(hp?: number): void {
    this.skipTo('b3');
    const f = this.floors.b3;
    for (const b of this.bosses.values()) {
      if (b.floor !== 'b3' || b.last || b.dead) continue;
      b.dead = true;
      f.mobs.removeMobs([b.mob]);
    }
    this.doorOpen = true;
    for (const d of f.map.silong.doors) f.unblock(d.tiles);
    if (hp) f.mobs.devWound(`boss:${this.S.lastBoss.id}`, hp);
  }

  /** Dev (?silongboss=<floor>): every mini boss above that floor down, their elevators open, the floors reached. */
  skipTo(to: SilongFloor): void {
    for (const f of SILONG_FLOORS.slice(0, SILONG_FLOORS.indexOf(to))) {
      for (const b of this.bosses.values()) {
        if (b.floor !== f || b.dead) continue;
        b.dead = true;
        this.keySpent = true;
        this.floors[f].mobs.removeMobs([b.mob]);
      }
      this.floors[f].open = true;
      this.floors[f].unblock(this.floors[f].map.silong.down);
      this.reached.add(floorBelow(f)!);
    }
  }
}

/** Two (or `n`) open tiles beside a boss's tile, for its guards (within 2 of it, on its floor's open ground). */
function guardSpots(floor: Floor, at: Tile, n: number): Tile[] {
  const out: Tile[] = [];
  for (const [dc, dr] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2], [2, -2], [-2, 2]]) {
    const t: Tile = [at[0] + dc, at[1] + dr];
    if (out.length < n && floor.mobs.open(...t)) out.push(t);
  }
  return out;
}

/** What the host knows of a member for the hatch: whether they've done "Now's the Time" (palengke-15), and how many Practice
 *  Susi they hold. */
export interface SilongAccess {
  done: boolean;
  practiceKeys?: number;
}

const ANYONE: SilongAccess = { done: true };
export const SILONG_QUEST = 'palengke-15';

/** All the runs: opening, joining, who may come in, the clock, closing. */
export class Silong {
  private readonly runs = new Map<string, SilongRun>();
  static readonly MAX_RUNS = 10;

  constructor(
    readonly S: SilongData,
    private readonly maps: Record<SilongFloor, SilongMap>,
    private readonly deps: RunDeps,
    private readonly partyOf: (member: string) => unknown,
    private readonly newId: () => string = () => `${Date.now().toString(36).slice(-4)}${(++runSeq).toString(36)}${Math.floor(deps.random() * 1296).toString(36)}`,
  ) {}

  /** A run by a floor's room (`silong:<id>:<floor>`) or its id. */
  get(roomOrId: string): SilongRun | undefined {
    const id = roomOrId.startsWith('silong:') ? roomOrId.split(':')[1] : roomOrId;
    return this.runs.get(id);
  }

  all(): SilongRun[] {
    return [...this.runs.values()];
  }

  /** The run a member may be in now: their own practice run first, then one they opened, then a party's. */
  runOf(member: string): SilongRun | undefined {
    const rank = (r: SilongRun) => (r.opener.member !== member ? 2 : r.practice ? 0 : 1);
    return this.all().filter((r) => r.phase !== 'closed' && this.allowed(r, member, false)).sort((a, b) => rank(a) - rank(b))[0];
  }

  /** Their party's run (or their own solo one), if any. */
  runFor(member: string): SilongRun | undefined {
    const party = this.partyOf(member);
    return this.all().find((r) => r.phase !== 'closed' && !r.practice && (party ? r.party === party : !r.party && r.opener.member === member));
  }

  /** Whether a member may be in a run now (as the Warrens': the opener of a solo run, anyone in its party). */
  allowed(run: SilongRun, member: string, record = true): boolean {
    if (!run.party) return member === run.opener.member;
    const party = this.partyOf(member);
    if (party === run.party) {
      if (record) run.members.add(member);
      return true;
    }
    const alive = [...run.members].some((m) => this.partyOf(m) === run.party);
    return !alive && run.members.has(member);
  }

  leftParty(member: string, party: unknown): void {
    if (!party) return;
    for (const r of this.runs.values()) if (r.party === party) r.members.delete(member);
  }

  private entryRefusal(level: number, a: SilongAccess): { reason: 'level' | 'quest'; message: string } | null {
    if (level < this.S.entry.minLevel) return { reason: 'level', message: `The Cellar is for Lv ${this.S.entry.minLevel} and up.` };
    if (!a.done) return { reason: 'quest', message: 'Mang Pido says it isn\'t time yet.' };
    return null;
  }

  /** What the Silong Hatch offers a member. */
  gate(member: string, level: number, keys: number, a: SilongAccess = ANYONE): TownSilongGate {
    const run = this.runFor(member);
    const no = this.entryRefusal(level, a);
    const full = this.runs.size >= Silong.MAX_RUNS;
    const blocked = no && !(no.reason === 'quest' && run) ? no.reason : !run && full ? 'full' : !run && keys < 1 ? 'key' : undefined;
    const practice = (a.practiceKeys ?? 0) > 0 ? { keys: a.practiceKeys!, ...(level < this.S.entry.minLevel ? { blocked: 'level' as const } : this.runOf(member) ? { blocked: 'run' as const } : full ? { blocked: 'full' as const } : {}) } : undefined;
    return {
      minLevel: this.S.entry.minLevel, level, keys, inParty: !!this.partyOf(member),
      partyRun: run ? { id: run.id, inside: run.insideCount, opener: run.opener.name } : null,
      ...(blocked ? { blocked } : {}), ...(no ? { questLine: no.message } : {}), ...(practice ? { practice } : {}),
    };
  }

  /** Opens a run (a Susi ng Silong: `useKey`), or why not. It starts at once. */
  open(member: string, name: string, level: number, useKey: () => boolean, now: number, a: SilongAccess = ANYONE): { ok: true; run: SilongRun } | { ok: false; reason: 'level' | 'quest' | 'full' | 'key' | 'party'; message: string } {
    const no = this.entryRefusal(level, a);
    if (no) return { ok: false, ...no };
    if (this.runFor(member)) return { ok: false, reason: 'party', message: 'Your party already has a run open: join it instead.' };
    if (this.runOf(member)) return { ok: false, reason: 'party', message: "You're in a run already." };
    if (this.runs.size >= Silong.MAX_RUNS) return { ok: false, reason: 'full', message: 'The Cellar is full. Try again in a few minutes.' };
    if (!useKey()) return { ok: false, reason: 'key', message: 'You need a Cellar Key to open the hatch.' };
    const run = new SilongRun(this.newId(), this.S, this.maps, this.deps, { member, name }, this.partyOf(member) ?? null, now);
    this.runs.set(run.id, run);
    return { ok: true, run };
  }

  /** A practice run (the Practice Susi ng Silong from "Now's the Time"): solo, even in a party. */
  openPractice(member: string, name: string, level: number, useKey: () => boolean, now: number): { ok: true; run: SilongRun } | { ok: false; reason: 'level' | 'full' | 'key' | 'party'; message: string } {
    if (level < this.S.entry.minLevel) return { ok: false, reason: 'level', message: `The Cellar is for Lv ${this.S.entry.minLevel} and up.` };
    if (this.runOf(member)) return { ok: false, reason: 'party', message: "You're in a run already." };
    if (this.runs.size >= Silong.MAX_RUNS) return { ok: false, reason: 'full', message: 'The Cellar is full. Try again in a few minutes.' };
    if (!useKey()) return { ok: false, reason: 'key', message: 'You need the Practice Cellar Key for a practice run.' };
    const run = new SilongRun(this.newId(), this.S, this.maps, this.deps, { member, name }, null, now, true);
    this.runs.set(run.id, run);
    return { ok: true, run };
  }

  /** A party member joins their party's run (the invite's Join, or later at the hatch): no key. */
  join(member: string, level: number, runId?: string, a: SilongAccess = ANYONE): { ok: true; run: SilongRun } | { ok: false; reason: 'level' | 'quest' | 'gone' | 'party'; message: string } {
    const asked = runId ? this.get(runId) : undefined;
    if (asked?.practice && asked.opener.member !== member) return { ok: false, reason: 'party', message: 'Practice runs are solo.' };
    const no = this.entryRefusal(level, a);
    if (no) return { ok: false, ...no };
    const run = asked ?? this.runFor(member);
    if (!run || run.phase === 'closed') return { ok: false, reason: 'gone', message: 'That run has closed.' };
    if (!this.allowed(run, member)) return { ok: false, reason: 'party', message: "That isn't your party's run." };
    return { ok: true, run };
  }

  tick(now: number, insideOf: (run: SilongRun) => SilongInside[]): { run: SilongRun; news: SilongNews }[] {
    const out: { run: SilongRun; news: SilongNews }[] = [];
    for (const run of this.runs.values()) {
      run.setInside(insideOf(run), now);
      const n = run.step(now, (m) => this.allowed(run, m));
      out.push({ run, news: n });
      if (n.closed) this.runs.delete(run.id);
    }
    return out;
  }

  /** The open runs (a restart gives back the keys of those no mini boss has fallen in yet). */
  openRuns(): { id: string; opener: string; spent: boolean; practice?: boolean }[] {
    return this.all().map((r) => ({ id: r.id, opener: r.opener.member, spent: r.keySpent, ...(r.practice ? { practice: true } : {}) }));
  }
}
