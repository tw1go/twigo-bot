import { readFileSync } from 'node:fs';
import { type EventPotion, type HalloweenData, type HalloweenReward, type HalloweenView, type ItemData, HALLOWEEN_MOBS, decorationsOn, scaledEventMob, eventStart, halloweenRules, mobRules, isEventOn, linear, mobStats, newItem, pickOne, rollRange } from '@mikazuki/shared';
import type { LootContent } from './combat-bag.js';
import { type GolemBoss, pitTiles } from './town-golem.js';
import { type MobDirector, type MobEvent, type MobRoom, type MobZoneData, facingTo } from './town-mobs.js';

// 🎃 The Halloween event (CONTEXT.md Event, Event window, Mikko Kalabasa, Biikko Kalabasa, Manananggal; rules and every
// number in the game's assets/events/halloween.json). Everything here exists only while its window is on (shared
// isEventOn; dev's ?halloween=on forces it): when it closes Mikko, Biikko and both Manananggal halves go, with no reward
// for anything under way, and the schedules stop.
//
// • Mikko Kalabasa: one at a time for the whole server, hidden on a tile of the Town or the Slums (hideTiles: beside cover,
//   never on the plaza, a path or road, a door, a gate, the camp or the golem pit, nor within 6 tiles of a player as it
//   hides); the first click within reach finds it (the server's word on who was first), then the next one hides
//   respawnMinutes later.
// • Biikko Kalabasa: an event mob in each of its maps (the Slums and the Old Market), each run by that map's
//   `directorFor` on its MobRoom and on its own schedule: still to the room (this moves it: a walk to a spot 4-10 tiles
//   away on height 1, a pause, again), silent (it never attacks), full again after healAfterSecondsUnhit without a hit.
//   Its kill (web/town.ts) drops one set (biikkoLoot, with its map's own items: `itemsIn`) held for the last hitter's
//   party; that map's back respawnMinutes after.
// • The Manananggal: a round every everyMinutes: its lower half stands at one of lowerSpots in town for lowerStaysMinutes,
//   its upper half flies in the Slums (the director: passive until hit, then after its foe over anything, Claw Swipe
//   every attackMs; leash and reset like a mob). Beaten, it's dazed behind whoever landed the last hit (anywhere: a town
//   view's `dazed`); they reunite it at the legs (within reach) for its reward. Gone too long, or the legs' time up: it
//   flies away, no reward. The next round's wait starts as one ends.
//
// What's kept (the bot's kv: `save`): where Mikko hides and when the next one does, each map's Biikko's next spawn (null
// while it's up: a restart brings it straight back), the round (the legs, until when, who carries it) and when the next one starts.
// Pure apart from its clock and `random`: web/town.ts sends the messages and gives the rewards.

export const EVENT_ZONE = 'halloween';
export const BIIKKO_KIND = HALLOWEEN_MOBS.biikko;
export const UPPER_KIND = HALLOWEEN_MOBS.upper;
export const BIIKKO_ID = 'halloween:biikko';
export const UPPER_ID = 'halloween:upper';
/** A carrier gone longer than this (ms): the upper half flies away. */
export const CARRIER_AWAY_MS = 60_000;
const MIN = 60_000;

/** A map as Mikko and the event mobs need it (the map files' own fields). */
export interface HalloweenMap {
  size: [number, number];
  blocked: number[][];
  height?: number[][];
  ground?: string[][];
  objects?: { id: string; col: number; row: number; footprint?: [number, number] }[];
  doors?: Record<string, [number, number] | [number, number][]>;
  gates?: Record<string, [number, number][]>;
  safeZone?: [number, number, number, number];
  boss?: GolemBoss;
}

/** What's kept across a restart. */
export interface HalloweenSaved {
  mikko: { map: string; col: number; row: number } | null;
  mikkoAt: number | null;
  /** Each map's Biikko's next spawn (ms), null while it's up. */
  biikkoAt: Record<string, number | null>;
  round: { lower: [number, number]; until: number; carrier: string | null } | null;
  roundAt: number | null;
}

const fresh = (): HalloweenSaved => ({ mikko: null, mikkoAt: null, biikkoAt: {}, round: null, roundAt: null });

/** One map's Biikko: its mob room (once attached), the tiles it walks, its last hit, when its walk ends and it may set off
 *  again, and (dev) where it comes out next. */
interface BiikkoSpot {
  room: MobRoom | null;
  tiles: [number, number][];
  hitAt: number;
  next: number;
  devNear: [number, number] | null;
}

/** Cover Mikko hides beside: the Town's trees, bushes, ferns and rocks; the Slums' junk, dead trees and rubble. */
const COVER = /^(tree-|bush-|fern|rock|rocks-|slums-(junk-|tire-|scrap-|oil-|cinder-|sacks|crates|trash-|cardboard|mattress|fridge|pushcart|dead-tree-|boulder|rubble))/;
/** Ground Mikko never hides on: the plaza, paths and the Slums' roads and walkways (and water, void). */
const OPEN_GROUND = new Set(['plaza', 'path', 'concrete', 'plate', 'planks', 'water', 'canal', 'void']);

const key = (c: number, r: number) => `${c},${r}`;
const cheb = (a: [number, number], b: [number, number]) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
const inRect = (rect: [number, number, number, number] | undefined, c: number, r: number) => !!rect && c >= rect[0] && c <= rect[2] && r >= rect[1] && r <= rect[3];

/** A map's tiles Mikko may hide on (worked out once a map): open floor right beside cover, never on the plaza, a path
 *  or a road, a door or gate, the safe zone or the golem pit. */
export function hideTiles(map: HalloweenMap): [number, number][] {
  const [cols, rows] = map.size;
  const shut = new Set<string>();
  for (const d of Object.values(map.doors ?? {})) for (const t of (Array.isArray(d[0]) ? d : [d]) as [number, number][]) shut.add(key(t[0], t[1]));
  for (const g of Object.values(map.gates ?? {})) for (const [c, r] of g) shut.add(key(c, r));
  for (const t of pitTiles(map.boss)?.all ?? []) shut.add(t);
  const covered = new Set<string>();
  const beside = new Set<string>();
  for (const o of map.objects ?? []) {
    if (!COVER.test(o.id)) continue;
    const [w, h] = o.footprint ?? [1, 1];
    for (let dc = 0; dc < w; dc++) for (let dr = 0; dr < h; dr++) covered.add(key(o.col + dc, o.row + dr));
    for (let c = o.col - 1; c <= o.col + w; c++) for (let r = o.row - 1; r <= o.row + h; r++) beside.add(key(c, r));
  }
  const out: [number, number][] = [];
  for (const k of beside) {
    if (covered.has(k) || shut.has(k)) continue;
    const [c, r] = k.split(',').map(Number);
    if (c < 0 || r < 0 || c >= cols || r >= rows || map.blocked[r]?.[c]) continue;
    if (OPEN_GROUND.has(map.ground?.[r]?.[c] ?? '') || inRect(map.safeZone, c, r) || (map.height?.[r]?.[c] ?? 0) < 0) continue;
    out.push([c, r]);
  }
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/** Who's where for the town's clock: each member here, their map and tile. */
export interface HerePlayer {
  member: string;
  map: string;
  at: [number, number];
}

/** What the town's clock found changed: everyone's view to send again, and whose dazed upper half flew away. */
export interface HalloweenTick {
  changed: boolean;
  flew: string[];
}

export class Halloween {
  private saved: HalloweenSaved;
  private readonly hides = new Map<string, [number, number][]>();
  /** Dev (?halloween=on): on whatever its start, from this moment. */
  private forcedAt: number | undefined;
  private wasOn = false;
  private wasDeco = false;
  /** The upper half's map's mob room (the Slums': its director's hands), once attached. */
  private room: MobRoom | null = null;
  /** Each map's Biikko (halloween.json biikko.maps). */
  private readonly biikkos = new Map<string, BiikkoSpot>();
  /** The upper half: where it came out, its next swing. */
  private upperHome: [number, number] | null = null;
  private upperSwing = 0;
  private upperNext = 0;
  /** An event mob's level in its fight, by `<map>:<id>`, while it's above its own (it grows with its hitters: `hit`). */
  private readonly fightLevel = new Map<string, number>();
  /** The upper half's tiles to come out on (the Slums' walking tiles: height 1, open, outside the camp and the pit). */
  private readonly wanderTiles: [number, number][];
  /** The numbers halloween.json writes in words (Mikko's clearance, Biikko's walks and rests, the first spawns, the
   *  Claw Swipe's pace). */
  private readonly rules: ReturnType<typeof halloweenRules>;

  constructor(
    readonly data: HalloweenData,
    private readonly maps: Record<string, HalloweenMap>,
    saved: HalloweenSaved | null,
    private readonly save: (s: HalloweenSaved) => void = () => {},
    private readonly random: () => number = Math.random,
  ) {
    this.saved = { ...fresh(), ...(saved ?? {}) };
    // (Kept before Biikko came out in more than one map: one time, the first map's.)
    const was = (saved as { biikkoAt?: unknown } | null)?.biikkoAt;
    if (typeof was !== 'object' || !was) this.saved.biikkoAt = { [data.biikko.maps[0]]: typeof was === 'number' ? was : null };
    this.rules = halloweenRules(data);
    for (const name of data.mikko.maps) if (maps[name]) this.hides.set(name, hideTiles(maps[name]));
    for (const name of data.biikko.maps) if (maps[name]) this.biikkos.set(name, { room: null, tiles: this.walkTiles(maps[name]), hitAt: 0, next: 0, devNear: null });
    this.wanderTiles = maps[data.manananggal.upper.map] ? this.walkTiles(maps[data.manananggal.upper.map]) : [];
  }

  /** A map's tiles Biikko walks (and the upper half comes out on): open, on its height, outside the safe zone and the
   *  field boss's pit or arena. */
  private walkTiles(map: HalloweenMap): [number, number][] {
    const pit = pitTiles(map.boss)?.all ?? new Set<string>();
    const arena = (map.boss as { arena?: [number, number, number, number] } | undefined)?.arena;
    const out: [number, number][] = [];
    const [cols, rows] = map.size;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (map.blocked[r]?.[c] || (map.height?.[r]?.[c] ?? 1) !== this.rules.biikkoHeight || inRect(map.safeZone, c, r) || inRect(arena, c, r) || pit.has(key(c, r))) continue;
      out.push([c, r]);
    }
    return out;
  }

  /** A map's Biikko's walking tiles (tests). */
  biikkoTilesOf(map: string): [number, number][] {
    return this.biikkos.get(map)?.tiles ?? [];
  }

  /** Dev: the event on from now (whatever its start), until its end. */
  force(now: number): void {
    this.forcedAt ??= now;
  }

  on(now: number): boolean {
    return isEventOn(this.data, now, this.forcedAt !== undefined);
  }

  /** Whether its decorations are up (their own start, the event's end; forced on with it). */
  decorations(now: number): boolean {
    return decorationsOn(this.data, now, this.forcedAt !== undefined);
  }

  /** The tiles Mikko may hide on, by map (tests). */
  hideTilesOf(map: string): [number, number][] {
    return this.hides.get(map) ?? [];
  }

  /** What's kept (tests, and the kv). */
  get state(): Readonly<HalloweenSaved> {
    return this.saved;
  }

  private keep(): void {
    this.save(this.saved);
  }

  /** When the event began (its start, or when it was forced on), for the first spawns. */
  private startedAt(now: number): number {
    return eventStart(this.data, this.forcedAt) ?? now;
  }

  /** The town's clock (about a second): the window opening or closing, Mikko hiding, the legs' time running out. */
  tick(now: number, players: HerePlayer[]): HalloweenTick {
    const on = this.on(now);
    const out: HalloweenTick = { changed: false, flew: [] };
    // (The decorations' own window opening or closing: everyone's told.)
    const deco = this.decorations(now);
    if (deco !== this.wasDeco) {
      this.wasDeco = deco;
      out.changed = true;
    }
    if (!on) {
      if (this.wasOn || this.saved.mikko || this.saved.round) {
        // Closed: everything of it goes, no reward for anything under way; the schedules stop.
        if (this.saved.round?.carrier) out.flew.push(this.saved.round.carrier);
        this.saved = fresh();
        this.keep();
        out.changed = true;
      }
      this.wasOn = false;
      return out;
    }
    if (!this.wasOn) {
      this.wasOn = true;
      out.changed = true;
      const start = this.startedAt(now);
      // (Its schedules from the start, unless a restart brought them back.)
      if (this.saved.mikkoAt === null && !this.saved.mikko) this.saved.mikkoAt = now;
      for (const [map, b] of this.biikkos) if ((this.saved.biikkoAt[map] ?? null) === null && !b.room?.mobInfo(BIIKKO_ID, now)) this.saved.biikkoAt[map] = Math.max(now, start + this.rules.firstMs);
      if (this.saved.roundAt === null && !this.saved.round) this.saved.roundAt = Math.max(now, start + this.rules.firstMs);
      this.keep();
    }
    // Mikko hides (where nobody stands near).
    if (!this.saved.mikko && this.saved.mikkoAt !== null && now >= this.saved.mikkoAt) {
      const spot = this.hideSpot(players);
      if (spot) {
        this.saved.mikko = spot;
        this.saved.mikkoAt = null;
        this.keep();
        out.changed = true;
      }
    }
    // A round starts: the legs in town (the upper half comes out on the director's tick).
    if (!this.saved.round && this.saved.roundAt !== null && now >= this.saved.roundAt) {
      const spot = this.lowerSpot();
      if (spot) {
        this.saved.round = { lower: spot, until: now + this.data.manananggal.lowerStaysMinutes * MIN, carrier: null };
        this.saved.roundAt = null;
        this.keep();
        out.changed = true;
      }
    }
    // The legs' time is up: whatever's carried flies away, the round ends.
    const round = this.saved.round;
    if (round && now >= round.until) {
      if (round.carrier) out.flew.push(round.carrier);
      this.endRound(now);
      out.changed = true;
    }
    return out;
  }

  /** A spot for Mikko: a hiding tile of a random map of its maps, none within mikkoClear of a player there. */
  private hideSpot(players: HerePlayer[]): { map: string; col: number; row: number } | null {
    const maps = [...this.hides.keys()].filter((m) => this.hides.get(m)!.length);
    for (let tries = 0; tries < 8 && maps.length; tries++) {
      const map = pickOne(maps, this.random);
      const near = players.filter((p) => p.map === map);
      const free = this.hides.get(map)!.filter((t) => near.every((p) => cheb(p.at, t) > this.rules.mikkoClear));
      if (free.length) {
        const [col, row] = pickOne(free, this.random);
        return { map, col, row };
      }
    }
    return null;
  }

  /** One of lowerSpots that's open floor (an unusable one is skipped). */
  private lowerSpot(): [number, number] | null {
    const town = this.maps.town;
    const ok = this.data.manananggal.lowerSpots.filter(([c, r]) => !!town && !town.blocked[r]?.[c] && !OPEN_GROUND.has(town.ground?.[r]?.[c] ?? 'grass'));
    return ok.length ? pickOne(ok, this.random) : null;
  }

  /** The legs' spots that can be used (tests: each one open floor). */
  lowerSpots(): [number, number][] {
    const town = this.maps.town;
    return this.data.manananggal.lowerSpots.filter(([c, r]) => !!town && !town.blocked[r]?.[c] && !OPEN_GROUND.has(town.ground?.[r]?.[c] ?? 'grass'));
  }

  private endRound(now: number): void {
    this.saved.round = null;
    this.saved.roundAt = now + rollRange(this.data.manananggal.everyMinutes, this.random) * MIN;
    this.keep();
  }

  /** The event as someone in `room` sees it (null: off). `townIdOf`: a member's town id while they're here. */
  view(room: string, now: number, townIdOf: (member: string) => string | undefined): HalloweenView | null {
    if (!this.on(now)) return null;
    const m = this.saved.mikko;
    const r = this.saved.round;
    const carrier = r?.carrier ? townIdOf(r.carrier) : undefined;
    return {
      endsAt: Date.parse(this.data.endsAt),
      ...(m && m.map === room ? { mikko: { col: m.col, row: m.row } } : {}),
      ...(r && room === 'town' ? { lower: { col: r.lower[0], row: r.lower[1], until: r.until } } : {}),
      dazed: carrier ? [carrier] : [],
    };
  }

  // ── Mikko Kalabasa ──

  /** A click on Mikko from `at` on `map`: theirs if it's there and within reach (first come); its reward, and where it
   *  was. Then the next one hides respawnMinutes later. Null: not there (gone, too far, another map). */
  claimMikko(map: string, at: [number, number], now: number): { reward: HalloweenReward; where: [number, number] } | null {
    const m = this.saved.mikko;
    if (!this.on(now) || !m || m.map !== map || cheb(at, [m.col, m.row]) > this.data.mikko.clickReach) return null;
    this.saved.mikko = null;
    this.saved.mikkoAt = now + rollRange(this.data.mikko.respawnMinutes, this.random) * MIN;
    this.keep();
    const R = this.data.mikko.rewards;
    return { where: [m.col, m.row], reward: { kowens: rollRange(R.kowens, this.random), kusing: R.kusing, repairKits: this.chance(R.lowRepairKit), ...this.potionOf(R.potion) } };
  }

  /** How many a chance gives (0, or its count). */
  private chance(c: { chance: number; count: number | [number, number] }): number {
    return this.random() < c.chance ? rollRange(c.count, this.random) : 0;
  }

  private potionOf(c: { chance: number }): { potion?: EventPotion } {
    return this.random() < c.chance ? { potion: pickOne(this.data.potions, this.random) } : {};
  }

  // ── Biikko Kalabasa ──

  /** Biikko's one set (rolled once): Kowens, Kusing, maybe Low Repair Kits, a potion, maybe a Warren Ticket, maybe a 5-day
   *  Witch Hat or Robe; each its own loot. `map`'s own items stand in for some (halloween.json `itemsIn`: the Old
   *  Market's Mid Repair Kits and Cellar Key). */
  biikkoLoot(items: ItemData, uid: () => string, map: string): LootContent[] {
    const L = this.data.biikko.loot;
    const own = this.data.biikko.itemsIn?.[map] ?? {};
    const out: LootContent[] = [{ kowens: rollRange(L.kowens, this.random) }, { kusing: L.kusing }];
    const item = (id: string, n: number) => {
      const def = items.defs.get(own[id] ?? id);
      if (def && n > 0) out.push({ item: newItem(items.stats, def, uid(), n) });
    };
    item('low-repair-kit', this.chance(L.lowRepairKit));
    const potion = this.potionOf(L.potion).potion;
    if (potion) out.push({ potion });
    item('warren-ticket', this.chance(L.warrenTicket));
    if (this.random() < L.witchCosmetic.chance) item(pickOne(L.witchCosmetic.pick, this.random), 1);
    return out;
  }

  /** `map`'s Biikko fell: back respawnMinutes later (the other map's keeps its own time). */
  biikkoKilled(map: string, now: number): void {
    this.saved.biikkoAt[map] = now + rollRange(this.data.biikko.respawnMinutes, this.random) * MIN;
    this.keep();
  }

  // ── The Manananggal ──

  /** The upper half fell to `member` (its last hit): dazed behind them. */
  upperKilled(member: string): void {
    if (!this.saved.round || this.saved.round.carrier) return;
    this.saved.round.carrier = member;
    this.keep();
  }

  /** Who carries the dazed upper half now (a member), or null. */
  get carrier(): string | null {
    return this.saved.round?.carrier ?? null;
  }

  /** A click on the legs (town) from `at` by `member`: their reward if they carry the upper half and are within reach;
   *  the round ends. Null: not theirs, or too far. */
  reunite(member: string, at: [number, number], now: number): { reward: HalloweenReward; where: [number, number] } | null {
    const r = this.saved.round;
    if (!this.on(now) || !r || r.carrier !== member || cheb(at, r.lower) > this.data.manananggal.reuniteReach) return null;
    const where = r.lower;
    this.endRound(now);
    const R = this.data.manananggal.rewards;
    return { where, reward: { kowens: rollRange(R.kowens, this.random), kusing: R.kusing, repairKits: this.chance(R.lowRepairKit) } };
  }

  /** The carrier was gone too long (logged out, left the game): the upper half flies away, the round ends. */
  carrierGone(member: string, now: number): boolean {
    if (this.saved.round?.carrier !== member) return false;
    this.endRound(now);
    return true;
  }

  // ── The directors (each Biikko map's mob room: its Biikko; the Slums' the upper half too) ──

  /** Dev (the dev town's /__halloween, the page's ?halloween=on): on from now; Mikko hidden beside `at` on `room` (the
   *  nearest hiding tile to it); Biikko out now in `room` (the first of its maps if it has none there; or, out, down to
   *  `wound` HP); a round now; the upper half carried by `member`. What was done. */
  dev(o: { mikko?: boolean; biikko?: boolean; wound?: number; round?: boolean; carry?: boolean; member?: string; room?: string; at: [number, number] | null }, now: number): string {
    this.force(now);
    const said = ['on'];
    const tiles = o.room ? this.hides.get(o.room) : undefined;
    if (o.mikko && o.at && tiles?.length) {
      const at = o.at;
      const [col, row] = tiles.reduce((best, t) => (cheb(t, at) >= 2 && cheb(t, at) < cheb(best, at) ? t : best), tiles[0]);
      this.saved.mikko = { map: o.room!, col, row };
      this.saved.mikkoAt = null;
      said.push(`Mikko at ${col},${row} (${o.room})`);
    }
    const bmap = o.room && this.biikkos.has(o.room) ? o.room : this.data.biikko.maps[0];
    const b = this.biikkos.get(bmap);
    if (o.biikko && b && !b.room?.mobInfo(BIIKKO_ID, now)) {
      this.saved.biikkoAt[bmap] = now;
      if (o.room === bmap) b.devNear = o.at; // (out by them)
      said.push(`Biikko now (${bmap})`);
    }
    if (o.wound !== undefined && b?.room?.mobInfo(BIIKKO_ID, now)) {
      b.room.devWound(BIIKKO_ID, o.wound);
      said.push(`Biikko down to ${o.wound} HP`);
    }
    if ((o.round || o.carry) && !this.saved.round) {
      const spot = this.lowerSpot();
      if (spot) this.saved.round = { lower: spot, until: now + this.data.manananggal.lowerStaysMinutes * MIN, carrier: null };
      this.saved.roundAt = null;
      said.push(spot ? `a round: the legs at ${spot.join(',')}` : 'no spot for the legs');
    }
    if (o.carry && o.member && this.saved.round) {
      this.saved.round.carrier = o.member;
      said.push(`${o.member} carries the upper half`);
    }
    this.keep();
    return said.join('; ');
  }

  /** Hands `map`'s director its mob room: its zone for the event mobs is the room's, given at its making (`eventZone`). */
  attach(room: MobRoom, map: string): void {
    const b = this.biikkos.get(map);
    if (b) b.room = room;
    if (map === this.data.manananggal.upper.map) this.room = room;
  }

  /** The maps the event's mobs live in (each needs its mob room attached and `directorFor` it). */
  get mobMaps(): string[] {
    return [...new Set([...this.biikkos.keys(), this.data.manananggal.upper.map])];
  }

  /** The zone a mob room of the event's needs for its mobs (added to its map's zones as it's made). */
  static eventZone(size: [number, number]): MobZoneData {
    return { id: EVENT_ZONE, mob: BIIKKO_KIND, level: 1, rect: [0, 0, size[0] - 1, size[1] - 1], height: 1, active: true, spawns: [], aggro: 'passive' };
  }

  /** `map`'s mob room's director: its Biikko, and in the upper half's map the upper half too. */
  directorFor(map: string): MobDirector {
    return {
      tick: (now, players) => this.directorTick(map, now, players),
      hurt: (id, now) => this.hurt(map, id, now),
      hit: (id, level) => this.hit(map, id, level),
    };
  }

  private directorTick(map: string, now: number, players: ReadonlyMap<string, [number, number]>): MobEvent[] {
    const b = this.biikkos.get(map);
    const room = b?.room ?? (map === this.data.manananggal.upper.map ? this.room : null);
    if (!room) return [];
    const events: MobEvent[] = [];
    const biikko = room.mobInfo(BIIKKO_ID, now);
    if (!this.on(now)) {
      // (The window closed: the event mobs go.)
      return room.removeMobs([BIIKKO_ID, UPPER_ID]);
    }
    // An event mob healed full with its fight over (its own heal below, the upper half's lost foe, or the room's own
    // give-up): back to its own numbers.
    for (const id of [BIIKKO_ID, UPPER_ID]) {
      const m = this.fightLevel.has(`${map}:${id}`) ? room.mobInfo(id, now) : null;
      if (m && !m.dead && !m.foe && m.hp >= m.maxHp) events.push(...this.ownLevel(map, room, id));
    }
    // Biikko: out when it's due; wandering; full again after a while unhit.
    const due = this.saved.biikkoAt[map] ?? null;
    if (b && !biikko && due !== null && now >= due && b.tiles.length) {
      const near = b.devNear;
      b.devNear = null;
      const tile = near ? b.tiles.reduce((x, y) => (cheb(y, near) < cheb(x, near) ? y : x)) : pickOne(b.tiles, this.random);
      this.fightLevel.delete(`${map}:${BIIKKO_ID}`);
      events.push(...room.addMobs([{ id: BIIKKO_ID, kind: BIIKKO_KIND, zone: EVENT_ZONE, tile, stats: this.biikkoStats(room), name: this.data.biikko.name, title: this.data.biikko.title, still: true, silent: true }], now));
      this.saved.biikkoAt[map] = null;
      b.hitAt = now;
      b.next = now + 2000;
      this.keep();
    } else if (b && biikko && !biikko.dead) {
      if (biikko.hp < biikko.maxHp && now - b.hitAt >= this.data.biikko.healAfterSecondsUnhit * 1000) events.push(...room.healFull(BIIKKO_ID), ...this.ownLevel(map, room, BIIKKO_ID));
      if (now >= b.next) events.push(...this.biikkoWalk(room, b, biikko.at, now));
    }
    if (map !== this.data.manananggal.upper.map) return events;
    // The upper half: out while a round is on and nobody carries it.
    const upper = room.mobInfo(UPPER_ID, now);
    const r = this.saved.round;
    if (r && !r.carrier && !upper) {
      const tile = pickOne(this.wanderTiles, this.random);
      if (tile) {
        this.fightLevel.delete(`${map}:${UPPER_ID}`);
        events.push(...room.addMobs([{ id: UPPER_ID, kind: UPPER_KIND, zone: EVENT_ZONE, tile, stats: this.upperStats(), name: this.data.manananggal.name, still: true, silent: true }], now));
        this.upperHome = tile;
        this.upperNext = now + 1500;
      }
    } else if ((!r || r.carrier) && upper) events.push(...room.removeMobs([UPPER_ID]));
    else if (upper && !upper.dead) events.push(...this.upperFly(room, upper, players, now));
    return events;
  }

  /** Biikko's numbers at a level (its own, halloween.json's, unless it's grown with its hitters: `scaling`): its HP
   *  10% more a level above its own (`hpPerLevel`), the higher of the golem's DEF and the mob table's for that level; it
   *  never attacks and gives no XP. */
  biikkoStats(room: MobRoom, top = 0) {
    const { level, hp } = scaledEventMob(this.data.biikko, top);
    const table = Math.round(linear(room.statsData().mobs.formula?.def ?? '0', { lv: level }));
    return { level, hp, atk: 0, def: Math.max(mobStats(room.statsData(), 'scrapheap-golem')?.def ?? 0, table), xp: 0 };
  }

  /** The upper half's numbers at a level (its own unless it's grown with its hitters: `scaling`): its HP as Biikko's
   *  grows, the mob table's ATK and DEF for that level (stats.json mobs.formula: "6 + 3 * lv", "2 * lv"); no XP. */
  upperStats(top = 0) {
    const { level, hp } = scaledEventMob(this.data.manananggal.upper, top);
    const f = this.room!.statsData().mobs.formula;
    const at = (formula: string | undefined) => (formula ? Math.round(linear(formula, { lv: level })) : 0);
    return { level, hp, atk: at(f?.atk), def: at(f?.def), xp: 0 };
  }

  /** A hit about to land on an event mob by a fighter of `level`: it grows to the highest level among its hitters this
   *  fight (never lower in it), its HP keeping its share (halloween.json `scaling`). */
  private hit(map: string, id: string, level: number): MobEvent[] {
    if (id !== BIIKKO_ID && id !== UPPER_ID) return [];
    const room = this.biikkos.get(map)?.room ?? (map === this.data.manananggal.upper.map ? this.room : null);
    const base = id === BIIKKO_ID ? this.data.biikko : this.data.manananggal.upper;
    const k = `${map}:${id}`;
    if (!room || !base.scaling || level <= (this.fightLevel.get(k) ?? base.level)) return [];
    this.fightLevel.set(k, level);
    return room.restat(id, id === BIIKKO_ID ? this.biikkoStats(room, level) : this.upperStats(level));
  }

  /** An event mob back to its own numbers (healed full, its fight over). */
  private ownLevel(map: string, room: MobRoom, id: string): MobEvent[] {
    if (!this.fightLevel.delete(`${map}:${id}`)) return [];
    return room.restat(id, id === BIIKKO_ID ? this.biikkoStats(room) : this.upperStats());
  }

  /** A Biikko sets off: a spot wanderTiles away on its walking tiles, walked at its pace; then a pause. */
  private biikkoWalk(room: MobRoom, b: BiikkoSpot, from: [number, number], now: number): MobEvent[] {
    const [lo, hi] = this.rules.wanderTiles;
    const near = b.tiles.filter((t) => {
      const d = cheb(t, from);
      return d >= lo && d <= hi;
    });
    const to = near.length ? pickOne(near, this.random) : null;
    const path = to ? this.walkPath(b.tiles, from, to) : null;
    const [p0, p1] = this.rules.pauseMs;
    const pause = p0 + this.random() * (p1 - p0);
    if (!path?.length) {
      b.next = now + pause;
      return [];
    }
    const speed = this.data.biikko.speedTilesPerSec;
    b.next = now + (path.length / speed) * 1000 + pause;
    return room.moveMob(BIIKKO_ID, path, now, speed);
  }

  /** A walk on Biikko's tiles from one to another (8 ways, never cutting a blocked corner), or null. */
  private walkPath(tiles: [number, number][], from: [number, number], to: [number, number]): [number, number][] | null {
    const ok = new Set(tiles.map(([c, r]) => key(c, r)));
    const prev = new Map<string, string>();
    const start = key(from[0], from[1]);
    const goal = key(to[0], to[1]);
    const queue: [number, number][] = [from];
    prev.set(start, '');
    for (let i = 0; i < queue.length && i < 4000; i++) {
      const [c, r] = queue[i];
      if (key(c, r) === goal) break;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const k = key(c + dc, r + dr);
        if (prev.has(k) || !ok.has(k)) continue;
        if (dc && dr && (!ok.has(key(c + dc, r)) || !ok.has(key(c, r + dr)))) continue;
        prev.set(k, key(c, r));
        queue.push([c + dc, r + dr]);
      }
    }
    if (!prev.has(goal)) return null;
    const path: [number, number][] = [];
    for (let k = goal; k && k !== start; k = prev.get(k)!) path.unshift(k.split(',').map(Number) as [number, number]);
    return path;
  }

  /** The upper half: after its foe (it flies: straight over anything, inside the map and out of the camp), Claw Swipe
   *  next to them; pulled past its leash (or its foe gone), full again and home; else drifting round where it came out. */
  private upperFly(room: MobRoom, upper: NonNullable<ReturnType<MobRoom['mobInfo']>>, players: ReadonlyMap<string, [number, number]>, now: number): MobEvent[] {
    const home = this.upperHome ?? upper.at;
    const speed = this.data.manananggal.upper.speedTilesPerSec;
    const foe = upper.foe ? players.get(upper.foe) : undefined;
    if (upper.foe && (!foe || cheb(foe, home) > mobRules(room.statsData(), UPPER_KIND).leashTiles)) {
      // Lost them: healed and back where it came out.
      const events = [...room.healFull(UPPER_ID), ...this.ownLevel(this.data.manananggal.upper.map, room, UPPER_ID)];
      return [...events, ...room.moveMob(UPPER_ID, this.flight(upper.at, home), now, speed)];
    }
    if (foe) {
      if (cheb(foe, upper.at) <= mobRules(room.statsData(), UPPER_KIND).reach) {
        if (now < this.upperSwing) return [];
        this.upperSwing = now + this.rules.upperAttackMs;
        const dir = facingTo(foe[0] - upper.at[0], foe[1] - upper.at[1]) ?? upper.facing;
        const hit = room.rollFor(upper.foe!, UPPER_ID);
        if (hit) room.land(upper.foe!, UPPER_ID, hit, now + (room.kindHitMs(UPPER_KIND) ?? 0));
        return [{ t: 'mob-attack', id: UPPER_ID, target: upper.foe!, dir, ...(hit ? { hit } : {}) }];
      }
      if (now < this.upperNext) return [];
      // Closer: the tile next to them on its way, a few at a time.
      const path = this.flight(upper.at, foe).slice(0, 3);
      this.upperNext = now + (path.length / speed) * 1000;
      return room.moveMob(UPPER_ID, path, now, speed);
    }
    if (now < this.upperNext) return [];
    // Drifting round where it came out.
    const [hc, hr] = home;
    const to: [number, number] = this.clampFly([hc + Math.round((this.random() - 0.5) * 8), hr + Math.round((this.random() - 0.5) * 8)]);
    const path = this.flight(upper.at, to);
    this.upperNext = now + (path.length / speed) * 1000 + 1500 + this.random() * 2500;
    return path.length ? room.moveMob(UPPER_ID, path, now, speed) : [];
  }

  /** A flight from one tile toward another: straight, a tile a step (stopping next to `to`), inside the map and out of
   *  the camp. */
  private flight(from: [number, number], to: [number, number]): [number, number][] {
    const path: [number, number][] = [];
    let [c, r] = from;
    for (let i = 0; i < 40 && cheb([c, r], to) > 1; i++) {
      const next = this.clampFly([c + Math.sign(to[0] - c), r + Math.sign(to[1] - r)]);
      if (next[0] === c && next[1] === r) break;
      [c, r] = next;
      path.push([c, r]);
    }
    return path;
  }

  /** A tile kept inside the Slums and out of its camp (the safe zone). */
  private clampFly([c, r]: [number, number]): [number, number] {
    const map = this.maps[this.data.manananggal.upper.map];
    if (!map) return [c, r];
    const [cols, rows] = map.size;
    let col = Math.max(1, Math.min(cols - 2, c));
    const row = Math.max(1, Math.min(rows - 2, r));
    const z = map.safeZone;
    if (z && inRect(z, col, row)) col = z[0] - 1;
    return [col, row];
  }

  /** A hit on an event mob in `map`: its Biikko's last hit noted; a death takes it out of the room (never back on its own). */
  private hurt(map: string, id: string, now: number): MobEvent[] {
    if (id !== BIIKKO_ID && id !== UPPER_ID) return [];
    const b = this.biikkos.get(map);
    if (id === BIIKKO_ID && b) b.hitAt = now;
    const room = b?.room ?? (map === this.data.manananggal.upper.map ? this.room : null);
    const info = room?.mobInfo(id, now);
    if (info?.dead) this.fightLevel.delete(`${map}:${id}`);
    return info?.dead ? (room?.removeMobs([id]) ?? []) : [];
  }
}

/** events/halloween.json and the maps it's played on (the game's assets). */
export function loadHalloween(): { data: HalloweenData; maps: Record<string, HalloweenMap> } {
  const read = <T>(file: string) => JSON.parse(readFileSync(new URL(`../../../game/public/assets/${file}`, import.meta.url), 'utf8')) as T;
  return { data: read<HalloweenData>('events/halloween.json'), maps: { town: read<HalloweenMap>('maps/town.json'), slums: read<HalloweenMap>('maps/slums.json'), palengke: read<HalloweenMap>('maps/palengke.json') } };
}
