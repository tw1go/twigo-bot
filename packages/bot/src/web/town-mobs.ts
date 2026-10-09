import { readFileSync } from 'node:fs';
import {
  type DerivedStats,
  type GolemAttack,
  type LevelingData,
  type MiniBossDef,
  type Hitter,
  type Item,
  type ItemData,
  type MobRules,
  type MobStats,
  type PlayerHit,
  type StatPoints,
  type StatsData,
  type Target,
  type TownGolem,
  type TownMob,
  type TownMobFacing,
  baseCooldown,
  baseStats,
  derivedStats,
  itemTotals,
  miniBossDef,
  miniBossRules,
  miniMobId,
  mobRules,
  mobStartSpots,
  mobStats,
  newItem,
  packSize,
  rollHit,
  withBuffs,
  seeded,
  skillCooldown,
  skillLevelBonus,
  skillPct,
  skillTier,
  xpEarners,
} from '@mikazuki/shared';
import { loadItemData, loadLeveling } from './stats-data.js';
import { Golem, type GolemArt, type GolemBoss, type GolemEvent, type PitTiles, pitTiles } from './town-golem.js';

// 🥫 The Slums' mobs, run on the server so every player sees the same ones in the same places, and fought there. How they
// live is stats.json mobBehaviour's (mobRules in @mikazuki/shared; the guide's "Mob behaviour"): each zone that's on
// (`active` in the game's maps/slums.json) keeps `aliveperZone` about, a pack counting once (a kind with `pack`, the
// Bottle Caps: a seeded 3–5 round a leader, ids `<zone>:<k>:<n>`; the rest `<zone>:<k>`), starting at spread-out spawn
// points (mobStartSpots) — the map's spawn points are only places now: a mob that dies comes back `respawnSeconds` later
// at a random free one of its zone's (nobody standing on or next to it), or a pack's cap beside its pack while any of it
// lives; the zone's own `aggro`/`aggroRange`/`leash`/`respawnSec` in the map aren't read. Each has its kind's one level,
// HP, ATK, DEF and XP (the mob table in classes/stats.json), a variant (its look) picked once from its kind's (the game's
// mobs/mobs.json), and now and then a hop round its spawn: at most `wanderTiles` away, on its zone's level and in its
// rect, on open tiles that aren't ramps or in the safe zone (a pack's followers hop to within FOLLOW of their leader
// instead; a Tire Roller sometimes rolls a tile or two straight on; a Plastic Bag Spook drifts, slower, with short
// rests). A hop is sent to the room as a path; the game walks it at its pace. Each mob faces the way it last stepped (or
// turned to attack), on the art's four diagonals. Pure (no Discord), so it's tested on its own and the dev server runs it
// too.
//
// Battle: a hit's damage is the stats rules' (@mikazuki/shared stats.ts, numbers from stats.json): the attacker's Power
// (their class, level, spent stat points and worn gear's ATK) × the skill's % (its tier = its place in the class's order,
// and its skill level) × crit × the mob's DEF × the level gap, which can also make it miss (`miss`: no damage). Reach: the
// next tile with a melee class or up to RANGED tiles with a ranged one (each skill's own: skill-hits.json range). A Scrap
// Crab's shell blocks every hit (0, `blocked`) except for a moment after each of its own attacks (shell down: mobs.json
// shellOpenMs, SHELL_OPEN_MS if not given), from any side. A mob that's hit (or missed) fights back (a `packAssist` kind's
// whole pack together): it goes after whoever hit it last, and within its reach of them (`rangeTiles`: melee 1, the Wire
// Tangle's zap 4) attacks every `attackEverySeconds` (the Scrap Crab its own rhythm: mobs.json attackMs, its shell down
// shellOpenMs from each): the stats rules' hit with its ATK as Power against the player's DEF and level (`guards`, from
// the host each tick; a miss by the level gap), sent with the attack (`hit`) and landing as its art does (its attack
// frame: `landed` hands the host what to take off their HP then; the Bag's also slows them for `slow` ms). An aggressive
// kind (Tire Roller, Wire Tangle, Scrap Crab) goes after a player who comes within `aggroTiles` of it (in its zone, on its
// level) the same way; passive ones (Tin Can, Bottle Caps, Plastic Bag Spook) only fight back. It gives up when they're
// gone, out of its zone or more than `leashTiles` from its spawn (it can't follow further), or (a passive one) haven't
// hit it for GIVE_UP_MS: it heals to full (`mob-heal`) and walks home. At 0 HP it dies (its XP to whoever killed it:
// `kills`, which the town turns into levels). A skill can only be used from its unlock level (classes.json; refused
// 'locked' before). Each has its own cooldown by its unlock level (baseCooldown in @mikazuki/shared, stats.json
// skills.cooldownByUnlock: Lv 1 the quickest),
// 1% less for each skill level past 1 (skillCooldown); a skill's slow or root lasts 5% longer a skill level
// (skillLevelBonus's buff).
//
// Mini bosses (classes/leveling.json miniBosses, at the spots in each zone's `miniBosses` in the map): one mob each, ids
// `<zone>:mini:<id>`, its kind's art, moves and rules with its own level, HP, ATK, DEF and XP; all up at once, each back
// at its own spot miniBoss.respawnSeconds after it dies, never part of a zone's count. Its kill goes to every member who
// did miniBoss.kill_credit's share of its HP (`dealt`, cleared when it heals or dies), each getting its XP and their own
// loot (`mini` on the kill; the town adds their party nearby).
//
// The field boss (the map's `boss`, given its art): town-golem.ts runs it on this room's clock; hits on it come through
// attack() like any mob's (reach to its body's edge; area skills reach it too), and its Adds are mobs of this room (ids
// `golem-add:<n>`, sent with their `kind` in `mob-add`; aggressive toward the nearest player within its leash, never
// coming back once dead, all removed with `mob-remove` when the fight ends). Its slams and tosses land like the mobs'
// attacks (`landed`), its Lamp Glare blinds (`blind` ms: the host makes their attacks miss, `Attacker.blinded`).
// Players the host leaves out of a tick (knocked out) are nobody's target: mobs walk home, the golem looks elsewhere.

const SPEED = 2.4; // tiles per second (the game walks them at the same pace)
const REST_MS: [number, number] = [2200, 6500];
const FOLLOW = 2; // a pack's followers keep within this of their leader
const FREE = 4; // a mob comes back at a spawn point no player is this close to
const RANGED = 5;
/** The classes that fight from afar; the rest hit from the next tile. */
const RANGED_CLASSES = new Set(['slingshot', 'broom']);
const GIVE_UP_MS = 12_000;
const SWING_MS = 400; // a player's attacks: no faster than this

export type MobEvent =
  | { t: 'mob-move'; id: string; path: [number, number][]; speed?: number }
  | { t: 'mob-attack'; id: string; target: string; dir: TownMobFacing; slow?: number; hit?: PlayerHit }
  | { t: 'mob-spawn'; id: string; col: number; row: number; hp: number }
  | { t: 'mob-heal'; id: string; hp: number }
  | GolemEvent;

export interface MobHit {
  id: string;
  damage: number;
  crit: boolean;
  hp: number;
  dead: boolean;
  /** Its shell took it (a Scrap Crab with its shell up): no damage. */
  blocked?: boolean;
  /** It missed (the level gap's chance against a mob above you): no damage. */
  miss?: boolean;
  /** Slowed (to `factor` of its speed; 0 = rooted) for `ms`. */
  slow?: { factor: number; ms: number };
}

/** A mob that died: its level and XP (the mob table's), and who gets the XP (members: attack's `member`): its killer, or
 *  for the golem everyone who did its share of its HP in the fight (stats.json xpTo). */
export interface MobKill {
  id: string;
  /** Its kind (the mob table's key) and where it died (its loot lands round there). */
  kind: string;
  at: [number, number];
  level: number;
  xp: number;
  to: string[];
  /** The field boss: its loot is personal, for each of `to`. */
  boss?: boolean;
  /** A mini boss (its leveling.json id): `to` is everyone who did their share; personal loot for each. */
  mini?: string;
}

/** `hits`: the target first, then any other mobs the skill's shape reached (skill-hits.json); `kills`: those it killed.
 *  Refused: out of reach, too soon, the mob gone, `skill` isn't one of their class's (its tier would be made up), or
 *  it's still locked (their level is under its unlock level). */
export type AttackResult = { ok: true; hits: MobHit[]; kills: MobKill[] } | { ok: false; reason: 'range' | 'slow' | 'gone' | 'skill' | 'locked' };

/** A mob's (or the golem's) attack landing on a player (town id) now: its damage (or a miss), and the Bag's slow (ms,
 *  on a hit) or the Lamp Glare's blindness (ms). The host takes it off their HP. */
export interface PlayerLanding extends PlayerHit {
  player: string;
  by: string;
  slow?: number;
  blind?: number;
}

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
/** A skill's burning puddle (skill-hits.json effects: burn:N:EVERY:SHARE:R:FIRST), or null. */
function parseBurn(e: string | null | undefined): { ticks: number; every: number; share: number; radius: number; first: number } | null {
  const [kind, n, every, share, r, first] = (e ?? '').split(':');
  if (kind !== 'burn') return null;
  return { ticks: Number(n) || 3, every: Number(every) || 300, share: Number(share) || 0.2, radius: Number(r) || 1, first: Number(first) || 700 };
}

function parseEffect(e: string | null | undefined): { factor: number; ms: number } | null {
  if (!e) return null;
  const [kind, a, b] = e.split(':');
  if (kind === 'slow') return { factor: Math.max(0, Math.min(1, Number(a) || 0.5)), ms: Number(b) || 2000 };
  if (kind === 'root') return { factor: 0, ms: Number(a) || 2000 };
  return null;
}

/** Each class's damage skills' unlock levels, in their order (classes.json). */
export type SkillLevels = Record<string, number[]>;

/** Who attacks: their class, level and stat points spent, the items they wear (each an item, or a kind's id: a plain
 *  one of it) and their skills' levels (by skill, in their order); `blinded`: every hit misses (the golem's Lamp Glare).
 *  Left out: Lv 1, nothing spent, nothing worn, every skill at Lv 1. A class id alone is the same. */
export interface Attacker {
  cls: string | null | undefined;
  level?: number;
  points?: StatPoints;
  gear?: (Item | string | null | undefined)[];
  skills?: number[];
  /** Their mobility moves' skill levels (by move id; for their MP cost). */
  moves?: Record<string, number>;
  /** Their buffs' skill levels (by name; what each cast gives) and the buffs on them as one set of stats
   *  (strongestBuffs; fighterStats puts them on). */
  buffLevels?: Record<string, number>;
  buffs?: Record<string, number>;
  blinded?: boolean;
}

/** The stats rules' data (classes/stats.json) and the item kinds (items/equipment.json, items/items.json) a fight needs. */
export type FightData = ItemData;

/** The game's classes/stats.json and item kinds. */
export const loadFightData = (): FightData => loadItemData();

/** A character's stats as a fight sees them (the stats rules): HP, MP, Power, DEF, crit… from their class, level, points
 *  and worn items (each one's base with its plus, lines and agimats; a broken one nothing), and the buffs on them, with
 *  their level. */
export function fighterStats(data: FightData, a: Attacker): DerivedStats & { level: number } {
  const S = data.stats;
  const level = a.level ?? 1;
  const worn = (a.gear ?? []).flatMap((g): Item[] => {
    if (g && typeof g === 'object') return [g];
    const def = g ? data.defs.get(g) : undefined;
    return def ? [newItem(S, def, g!)] : [];
  });
  const main = a.cls ? (S.classes[a.cls]?.main ?? null) : null;
  const d = derivedStats(S, a.cls, level, baseStats(S, a.cls, level, a.points), itemTotals(data, worn, main));
  return { ...(a.buffs ? withBuffs(S, d, a.buffs) : d), level };
}

/** A blinded attacker's hit: always a miss. */
const MISSED = { damage: 0, crit: false, miss: true } as const;

export interface MobZoneData {
  id: string;
  mob: string;
  /** Its mobs' one level (the mob table's: the stats rules take that one). */
  level: number;
  /** [col0, row0, col1, row1]: its mobs never leave it. */
  rect?: [number, number, number, number];
  height: number;
  active: boolean;
  spawns: [number, number][];
  /** Aggressive: its mobs go after a player within aggroRange; passive: they only fight back. (The map's are ignored:
   *  stats.json mobBehaviour sets them by kind; the golem's Adds have their own.) */
  aggro?: 'passive' | 'aggressive';
  aggroRange?: number;
  leash?: number;
  /** (Unused: stats.json mobBehaviour respawnSeconds.) */
  respawnSec?: number;
  /** Its mini bosses' spots (classes/leveling.json miniBosses ids). */
  miniBosses?: { id: string; tile: [number, number] }[];
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
  /** Its attack slows the player hit (to half their walking speed) for this long. */
  slowMs?: number;
  /** When its attack lands after it starts (ms: its attack frame at its anim's fps, from the manifest; loadMobKinds). */
  hitMs?: number;
  /** Its shell blocks every hit, except for `shellOpenMs` from each of its own attacks (shell down). */
  shell?: boolean;
  shellOpenMs?: number;
  /** Its own pace of attack (ms between swings), if not stats.json mobBehaviour's (the Scrap Crab's). */
  attackMs?: number;
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
  /** Its kind's level, HP, ATK, DEF and XP (the mob table), and how it lives (stats.json mobBehaviour). */
  stats: MobStats;
  rules: MobRules;
  level: number;
  maxHp: number;
  /** Its look ('' for a kind with one). */
  variant: string;
  /** Its spawn point (how far it may roam and be pulled is measured from here: where it last came back) and its own
   *  tile there (a pack's caps round the point). */
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
  /** A shell's down until then (its last attack + shellOpenMs). */
  openUntil: number;
  /** Slowed to `factor` of its speed until then (0: rooted). */
  slow: { factor: number; until: number } | null;
  /** The pace of the hop under way (tiles a second). */
  hopSpeed: number;
  /** Its pack (the caps of one spawn point, the leader the first alive), or null. */
  pack: Mob[] | null;
  /** One of the golem's Adds: no spawn point, never back once dead, gone when the fight ends. */
  add?: boolean;
  /** A mini boss (its leveling.json entry): back at its own spot; who has done how much of its HP (members). */
  mini?: MiniBossDef;
  dealt?: Map<string, number>;
}

/** The game's mobs/mobs.json, with when each kind's attack lands (its attackFrame at the manifest's attack fps). */
export function loadMobKinds(): MobKinds {
  const read = (file: string) => JSON.parse(readFileSync(new URL(`../../../game/public/assets/${file}`, import.meta.url), 'utf8')) as Record<string, unknown>;
  const json = read('mobs/mobs.json');
  const art = read('manifest.json').mobs as Record<string, { animations?: Record<string, { fps: number }> } | string>;
  const kinds = Object.fromEntries(Object.entries(json).filter(([, v]) => typeof v === 'object' && v)) as Record<string, MobKind & { attackFrame?: number }>;
  for (const [id, k] of Object.entries(kinds)) {
    const def = art[id];
    const fps = typeof def === 'object' ? def.animations?.attack?.fps : undefined;
    if (fps) k.hitMs = Math.round(((k.attackFrame ?? 0) / fps) * 1000);
  }
  return kinds;
}

/** The mobs' data from a map file (maps/<name>.json in the game's assets). */
export function loadMobMap(name: string): MobMapData {
  return JSON.parse(readFileSync(new URL(`../../../game/public/assets/maps/${name}.json`, import.meta.url), 'utf8')) as MobMapData;
}

// (seeded and packSize are @mikazuki/shared's, as the game's world/mobs.ts uses them: the same looks and packs there.)
export { packSize, seeded };

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

/** A shell's down this long from each of its attacks, if its kind doesn't say. */
const SHELL_OPEN_MS = 2000;

const cheb = (a: [number, number], b: [number, number]) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
const STEPS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export class MobRoom {
  private readonly mobs: Mob[] = [];
  private readonly byId = new Map<string, Mob>();
  private readonly ramps = new Set<string>();
  /** The zones that are on, with their behaviour from stats.json (by kind). */
  private readonly zones: MobZoneData[] = [];
  /** Tiles from its spawn an idle mob wanders (stats.json mobBehaviour wanderTiles). */
  private readonly roam: number;
  /** This tick's tiles each mob stands on or is hopping to (so they don't pile up on one): col × 4096 + row. */
  private claimed: Map<number, Mob> | null = null;

  /** The field boss, if the map has one (and its art was given). */
  private readonly golem: Golem | null = null;
  /** The mini bosses' rules (classes/leveling.json miniBoss), if there are any. */
  private readonly minis: ReturnType<typeof miniBossRules> | null;
  /** Its Adds' zones (one per kind: the golem's leash, aggressive), and how many Adds it has called so far (their ids). */
  private readonly addZones = new Map<string, MobZoneData>();
  private adds = 0;
  /** The Golem Pit's tiles: no zone's mob steps on them; the Adds keep to its floor and way in. */
  private readonly pit: PitTiles | null;

  constructor(
    private readonly map: MobMapData,
    private readonly random: () => number = Math.random,
    private readonly levels: SkillLevels = {},
    private readonly shapes: SkillShapes = { shapes: {} },
    private readonly kinds: MobKinds = {},
    golem?: GolemArt,
    private readonly fightData: FightData = loadFightData(),
    leveling: LevelingData | null = loadLeveling(),
  ) {
    this.minis = leveling ? miniBossRules(leveling) : null;
    for (const r of map.ramps ?? []) this.ramps.add(`${r.col},${r.row}`);
    this.pit = pitTiles(map.boss);
    this.roam = fightData.stats.mobBehaviour.wanderTiles;
    for (const zone of map.mobZones ?? []) {
      if (!zone.active) continue;
      const kind = kinds[zone.mob] ?? {};
      const R = mobRules(fightData.stats, zone.mob);
      const z: MobZoneData = { ...zone, aggro: R.aggressive ? 'aggressive' : 'passive', aggroRange: R.aggroTiles, leash: R.leashTiles };
      this.zones.push(z);
      // Its `alive` mobs (packs) at spread-out spawn points.
      mobStartSpots(zone.id, zone.spawns, R.alive).forEach((i, k) => this.place(z, kind, `${zone.id}:${k}`, zone.spawns[i]));
      // Its mini bosses, each at its spot (one alone: never a pack).
      for (const spot of zone.miniBosses ?? []) {
        const def = leveling ? miniBossDef(leveling, spot.id) : null;
        if (!def || def.kind !== zone.mob) continue;
        const [m] = this.place(z, { ...kind, pack: undefined }, miniMobId(zone.id, spot.id), spot.tile);
        const stats = { ...m.stats, level: def.level, hp: def.hp, atk: def.atk, def: def.defense, xp: def.xp };
        Object.assign(m, { stats, level: def.level, maxHp: def.hp, hp: def.hp, mini: def, dealt: new Map() });
      }
    }
    const boss = map.boss;
    if (boss && golem) {
      const level = this.map.height?.[boss.tile[1]]?.[boss.tile[0]] ?? 0;
      this.golem = new Golem(boss, golem, {
        open: (c, r) => c >= 0 && r >= 0 && c < map.size[0] && r < map.size[1] && !map.blocked[r]?.[c] && (map.height?.[r]?.[c] ?? 0) === level && !this.ramps.has(`${c},${r}`),
        callAdds: (spots, now) => this.callAdds(boss, level, spots, now),
        dropAdds: () => this.dropAdds(),
        roll: (player, mult) => this.rollOn(player, this.statsOf(boss.id), mult),
      }, random);
    }
  }

  /** This tick's players' DEF and level (town id → them): what mobs' and the golem's hits are rolled against. */
  private guards: ReadonlyMap<string, Target> = new Map();
  /** Attacks under way, landing on players at `at` (ms). */
  private landings: (PlayerLanding & { at: number })[] = [];

  /** A mob's hit on a player: its ATK (× `mult`) as Power against their DEF and level (the stats rules, with the level
   *  gap's miss chance), or null when their DEF isn't known (no HP here: harmless). */
  private rollOn(player: string, mob: MobStats, mult = 1): PlayerHit | null {
    const guard = this.guards.get(player);
    if (!guard) return null;
    const { damage, miss } = rollHit(this.fightData.stats, { power: mob.atk, level: mob.level }, guard, mult, this.random);
    return miss ? { damage: 0, miss } : { damage };
  }

  /** The attacks that land now (the host takes them off players' HP), in the order they land. */
  landed(now: number): PlayerLanding[] {
    if (!this.landings.length) return [];
    const due = this.landings.filter((l) => l.at <= now).sort((a, b) => a.at - b.at);
    if (!due.length) return [];
    this.landings = this.landings.filter((l) => l.at > now);
    return due.map(({ at: _at, ...l }) => l);
  }

  /** A player's stats as a fight sees them (HP, MP, DEF… and level), from their class, level, points and worn gear. */
  fighter(a: Attacker): DerivedStats & { level: number } {
    return fighterStats(this.fightData, a);
  }

  /** A kind's row in the mob table (a kind without one is a data problem: loud, at start). */
  private statsOf(mob: string): MobStats {
    const s = mobStats(this.fightData.stats, mob);
    if (!s) throw new Error(`No stats for the mob kind ${mob} (classes/stats.json mobs.list)`);
    return s;
  }

  /** A spawn point's mob (or pack: `point:<n>` each), its look seeded from its id, its level and HP its kind's; the Adds'
   *  too. */
  private place(zone: MobZoneData, kind: MobKind, point: string, [col, row]: [number, number], add = false): Mob[] {
    const variants = kind.variants ?? [];
    const n = kind.pack ? packSize(point, kind.pack) : 1;
    const stats = this.statsOf(zone.mob);
    const rules = mobRules(this.fightData.stats, zone.mob);
    const pack: Mob[] = [];
    for (let k = 0; k < n; k++) {
      const id = kind.pack ? `${point}:${k}` : point;
      const variant = variants[Math.floor(seeded(`${id}:variant`) * variants.length)] ?? '';
      const m: Mob = {
        id, zone, kind, stats, rules, level: stats.level, maxHp: stats.hp, variant, spawn: [col, row], home: [col, row], col, row, facing: FACINGS[Math.floor(seeded(`${id}:dir`) * 4)], path: [], hopAt: 0, restUntil: 0,
        hp: stats.hp, respawnAt: 0, foe: null, nextAttack: 0, openUntil: 0, slow: null, hopSpeed: SPEED, pack: kind.pack ? pack : null, ...(add ? { add } : {}),
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
   *  is one); each kind's own level and HP. They come for the nearest player within the golem's leash. */
  private callAdds(boss: GolemBoss, level: number, spots: [number, number][], now: number): GolemEvent[] {
    const made: Mob[] = [];
    const zoneFor = (mob: string) => {
      let z = this.addZones.get(mob);
      if (!z) {
        const [hc, hr] = boss.tile;
        const L = boss.leash;
        z = {
          id: 'golem-add', mob, level: this.statsOf(mob).level, rect: [hc - L, hr - L, hc + L, hr + L], height: level,
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

  /** A dead mob comes back, full: a pack's cap beside its pack while any of it lives (the leader's spot), else at a
   *  random free spawn point of its zone (no mob on or next to it, no player within FREE tiles), which is its spawn from
   *  now on. */
  private respawn(m: Mob, now: number, players: ReadonlyMap<string, [number, number]>): void {
    const lead = m.pack?.find((x) => x !== m && !x.respawnAt);
    let at: [number, number] | null = m.mini ? m.spawn : null; // (a mini boss: its own spot, always)
    if (lead) {
      const to = this.dest(lead);
      const near = STEPS.map(([dc, dr]): [number, number] => [to[0] + dc, to[1] + dr]).filter(([c, r]) => this.canStand({ zone: m.zone, spawn: lead.spawn }, c, r, this.roam + FOLLOW) && !this.taken(m, c, r));
      at = near[Math.floor(this.random() * near.length)] ?? null;
      if (at) m.spawn = lead.spawn;
    }
    if (!at) {
      const points = m.zone.spawns.filter((s) => this.canStand({ zone: m.zone, spawn: s }, s[0], s[1], 0));
      const busy = (s: [number, number]) =>
        this.mobs.some((x) => x !== m && !x.respawnAt && cheb(this.dest(x), s) <= 1) || [...players.values()].some((p) => cheb(p, s) <= FREE);
      const free = points.filter((s) => !busy(s));
      const pick = free.length ? free : points;
      at = pick[Math.floor(this.random() * pick.length)] ?? m.spawn;
      m.spawn = [at[0], at[1]];
    }
    m.home = [at[0], at[1]];
    Object.assign(m, { respawnAt: 0, hp: m.maxHp, col: at[0], row: at[1], path: [], foe: null, slow: null, nextAttack: 0, restUntil: now + REST_MS[0] });
    this.claim(m, m.col, m.row);
  }

  /** Where a mob may stand: open, on its zone's level and in its rect, not a ramp, outside the safe zone, close to its
   *  spawn. */
  canStand(m: { zone: MobZoneData; spawn: [number, number] }, col: number, row: number, reach = this.roam): boolean {
    const [cols, rows] = this.map.size;
    if (col < 0 || row < 0 || col >= cols || row >= rows || this.map.blocked[row]?.[col]) return false;
    if ((this.map.height?.[row]?.[col] ?? 0) !== m.zone.height || this.ramps.has(`${col},${row}`)) return false;
    if (!this.inRect(m.zone, col, row)) return false;
    if (this.pit && (m.zone.id === 'golem-add' ? !this.pit.fight.has(`${col},${row}`) : this.pit.all.has(`${col},${row}`))) return false;
    const [c0, r0, c1, r1] = this.map.safeZone ?? [-1, -1, -2, -2];
    if (col >= c0 && col <= c1 && row >= r0 && row <= r1) return false;
    return Math.max(Math.abs(col - m.spawn[0]), Math.abs(row - m.spawn[1])) <= reach;
  }

  /** `n` tiles round `at` (its own first, then outward) on its level, open and not ramps, to lay a kill's loot on (the
   *  same ones again if there aren't enough). */
  lootSpots(at: [number, number], n: number): [number, number][] {
    const [cols, rows] = this.map.size;
    const level = this.map.height?.[at[1]]?.[at[0]] ?? 0;
    const open = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && !this.map.blocked[r]?.[c] && (this.map.height?.[r]?.[c] ?? 0) === level && !this.ramps.has(`${c},${r}`);
    const out: [number, number][] = [];
    for (let ring = 0; ring <= 3 && out.length < n; ring++) {
      for (let dr = -ring; dr <= ring && out.length < n; dr++) {
        for (let dc = -ring; dc <= ring && out.length < n; dc++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;
          if (open(at[0] + dc, at[1] + dr)) out.push([at[0] + dc, at[1] + dr]);
        }
      }
    }
    return out.length ? out : [at];
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
  private route(m: Mob, goal: (c: number, r: number) => boolean, reach = this.roam): [number, number][] | null {
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

  /** Someone it should fight: it (and a `packAssist` kind's whole pack) goes after them. */
  private rally(m: Mob, player: string, now: number): void {
    for (const x of (m.rules.packAssist && m.pack) || [m]) if (!x.respawnAt) x.foe = { id: player, at: now };
  }

  /**
   * Moves the clock on: hops that are over land; the dead come back; an aggressive mob notices a player near it; a mob
   * with a foe goes after them and attacks within its reach (or gives up and walks home); the rest, rested, start a new
   * hop. `players`: where each player in the room is (by town id; the knocked out left out); `guards`: their DEF and
   * level, which mobs' hits are rolled against (without one, the mobs' hits on that player are harmless). Returns what to send to the
   * room; what lands later, `landed`.
   */
  tick(now: number, players: ReadonlyMap<string, [number, number]> = new Map(), guards: ReadonlyMap<string, Target> = new Map()): MobEvent[] {
    this.claimed = null;
    this.guards = guards;
    const events: MobEvent[] = this.golem ? this.golem.tick(now, players) : [];
    // The golem's slams and tosses land after a moment (its art's), its glare blinds as it lights.
    for (const e of events) {
      if (e.t !== 'golem-attack' || !this.golem) continue;
      const at = now + this.golem.hitMs(e.attack as GolemAttack);
      for (const h of e.hits ?? []) this.landings.push({ at, player: h.id, by: e.id, damage: h.damage, ...(h.miss ? { miss: true } : {}) });
      for (const id of e.blinded ?? []) this.landings.push({ at, player: id, by: e.id, damage: 0, blind: e.blindMs });
    }
    // Who each aggressive zone's mobs could notice (a few players at most: looked up once a tick, not per mob).
    const watched = new Map<MobZoneData, [string, [number, number]][]>();
    for (const zone of [...this.zones, ...this.addZones.values()]) {
      if (!zone.active || zone.aggro !== 'aggressive' || !zone.aggroRange) continue;
      const here = [...players].filter(([, p]) => this.inZone(zone, p));
      if (here.length) watched.set(zone, here);
    }
    for (const m of this.mobs) {
      if (m.respawnAt) {
        if (now < m.respawnAt) continue;
        this.respawn(m, now, players);
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
    const leash = m.zone.leash ?? m.rules.leashTiles;
    const p = players.get(foe.id);
    const bored = m.zone.aggro !== 'aggressive' && now - foe.at > GIVE_UP_MS;
    if (!p || cheb(p, m.spawn) > leash || !this.inZone(m.zone, p) || bored) {
      // Gone, pulled past its leash, or done with it: healed to full, home.
      m.foe = null;
      m.dealt?.clear();
      if (m.hp < m.maxHp) {
        m.hp = m.maxHp;
        events.push({ t: 'mob-heal', id: m.id, hp: m.hp });
      }
      const [hc, hr] = m.home;
      const home = this.route(m, (c, r) => c === hc && r === hr, leash);
      if (home?.length) this.startHop(m, home, now, events);
      return;
    }
    const reach = m.rules.reach;
    if (cheb(p, [m.col, m.row]) <= reach) {
      if (now >= m.nextAttack) {
        m.nextAttack = now + (m.kind.attackMs ?? m.rules.attackMs);
        m.facing = facingTo(p[0] - m.col, p[1] - m.row) ?? m.facing;
        if (m.kind.shell) m.openUntil = now + (m.kind.shellOpenMs ?? SHELL_OPEN_MS); // its shell drops as it swings
        // Its hit, rolled now and sent with the attack; it lands on its attack frame (the Bag's slow only if it hits).
        const hit = this.rollOn(foe.id, m.stats);
        const slow = m.kind.slowMs && !hit?.miss ? m.kind.slowMs : undefined;
        events.push({ t: 'mob-attack', id: m.id, target: foe.id, dir: m.facing, ...(slow ? { slow } : {}), ...(hit ? { hit } : {}) });
        if (hit) this.landings.push({ at: now + (m.kind.hitMs ?? 0), player: foe.id, by: m.id, ...hit, ...(slow ? { slow } : {}) });
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
      const to: [number, number] = [m.spawn[0] + Math.round((this.random() * 2 - 1) * this.roam), m.spawn[1] + Math.round((this.random() * 2 - 1) * this.roam)];
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
    const reach = this.roam + FOLLOW;
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

  /** Burning puddles (Boiling Splash): where, whose (for credit), how hard, and their ticks to come. */
  private burns: { at: [number, number]; player: string; name: string; member: string; by: Hitter & { blinded?: boolean }; pct: number; radius: number; left: number; next: number; every: number }[] = [];

  /** A player's attack on a mob (or the golem): in range for their class (from where they stand; to the golem's body's
   *  edge), not too fast, the mob alive. `who`: their class, level, points, gear and skill levels (or their class alone);
   *  blinded, every hit misses. `name`: theirs, for the golem's line when it falls; `member`: who they are across reloads
   *  (the golem's damage is counted by it, and kills' XP goes to it), their town id if not given. */
  attack(player: string, from: [number, number], who: Attacker | string | null | undefined, id: string, now: number, skill = 0, name = player, member = player): AttackResult {
    const a: Attacker = who && typeof who === 'object' ? who : { cls: who };
    const cls = a.cls;
    const skills = (cls && (this.levels[cls]?.length ?? this.shapes.shapes[cls]?.length)) || 1;
    if (skill < 0 || skill >= skills) return { ok: false, reason: 'skill' };
    const unlock = (cls && this.levels[cls]?.[skill]) || 1;
    if ((a.level ?? 1) < unlock) return { ok: false, reason: 'locked' };
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
    // The golem is only hit from its fight: the pit floor and way in (no sniping over the ring it can't answer).
    if (boss && !boss.inFight(from)) return { ok: false, reason: 'range' };
    this.swings.set(player, now + SWING_MS);
    // (A little slack: the game's clock and the message's trip.)
    const skillLevel = a.skills?.[skill] ?? 1;
    const by = { ...this.fighter(a), blinded: a.blinded };
    // (Calm Mind: its share off.)
    this.swings.set(ready, now + skillCooldown(this.fightData.stats, baseCooldown(this.fightData.stats, unlock), skillLevel) * (1 - (by.cooldownPct ?? 0)) * 1000 - 150);
    // Its slow or root, 5% longer a skill level.
    const effect = parseEffect(cls ? this.shapes.effects?.[cls]?.[skill] : null);
    if (effect) effect.ms = Math.round(effect.ms * skillLevelBonus(this.fightData.stats, skillLevel).buff);
    const pct = skillPct(this.fightData.stats, skillTier(skill), skillLevel);
    const kills: MobKill[] = [];
    // A burning puddle where it lands (its ticks: burnTick), on the target's tile.
    const burn = parseBurn(cls ? this.shapes.effects?.[cls]?.[skill] : null);
    if (burn) this.burns.push({ at: [Math.round(mc), Math.round(mr)], player, name, member, by: { ...by }, pct: pct * burn.share, radius: burn.radius, left: burn.ticks, next: now + burn.first, every: burn.every });
    const hits = this.reached(m ?? 'golem', [mc, mr], from, (cls && this.shapes.shapes[cls]?.[skill]) || 'single', now).map((x) => {
      if (x === 'golem') return this.hitGolem(player, name, member, by, pct, now, kills); // (no slowing it)
      const hit = this.damage(x, player, by, pct, now, member);
      if (hit.dead) kills.push(this.killOf(x, member));
      if (effect && !hit.dead && !hit.blocked && !hit.miss) {
        x.slow = { factor: effect.factor, until: now + effect.ms };
        hit.slow = effect;
      }
      return hit;
    });
    return { ok: true, hits, kills };
  }

  /** A mob that just died, as a kill: its XP for its killer (a mini boss: everyone who did their share). */
  private killOf(x: Mob, member: string): MobKill {
    return { id: x.id, kind: x.zone.mob, at: [x.col, x.row], level: x.stats.level, xp: x.stats.xp, to: x.mini ? this.miniEarners(x, member) : [member], ...(x.mini ? { mini: x.mini.id } : {}) };
  }

  /** The burning puddles' ticks due by `now`: each hits every mob standing within its radius (the golem by its body's
   *  edge) for its share of the cast's damage, credited to whoever cast it. What each tick hit (by caster, for the room)
   *  and what it killed. */
  burnTick(now: number): { ticks: { by: string; hits: MobHit[] }[]; kills: MobKill[] } {
    const ticks: { by: string; hits: MobHit[] }[] = [];
    const kills: MobKill[] = [];
    for (const b of this.burns) {
      while (b.left > 0 && now >= b.next) {
        b.left--;
        b.next += b.every;
        const hits: MobHit[] = [];
        for (const x of this.mobs) {
          if (x.respawnAt || cheb(this.at(x, now), b.at) > b.radius) continue;
          const hit = this.damage(x, b.player, b.by, b.pct, now, b.member);
          if (hit.dead) kills.push(this.killOf(x, b.member));
          hits.push(hit);
        }
        if (this.golem?.hittable && this.golem.edge(b.at, now) <= b.radius) hits.push(this.hitGolem(b.player, b.name, b.member, b.by, b.pct, now, kills));
        if (hits.length) ticks.push({ by: b.player, hits });
      }
    }
    this.burns = this.burns.filter((b) => b.left > 0);
    return { ticks, kills };
  }

  /** One hit on a mob (the stats rules' damage, or a miss), none through a shell that's up; it (and its pack) goes after
   *  the player either way; at 0 it dies. */
  private damage(m: Mob, player: string, by: Hitter & { blinded?: boolean }, pct: number, now: number, member = player): MobHit {
    const [mc, mr] = this.at(m, now);
    this.rally(m, player, now);
    if (m.kind.shell && now >= m.openUntil) return { id: m.id, damage: 0, crit: false, hp: m.hp, dead: false, blocked: true };
    const { damage, crit, miss } = by.blinded ? MISSED : rollHit(this.fightData.stats, by, m.stats, pct, this.random);
    if (miss) return { id: m.id, damage: 0, crit: false, hp: m.hp, dead: false, miss };
    if (m.dealt) m.dealt.set(member, (m.dealt.get(member) ?? 0) + Math.min(damage, m.hp));
    m.hp = Math.max(0, m.hp - damage);
    if (m.hp === 0) {
      [m.col, m.row] = [mc, mr];
      m.respawnAt = m.add ? Infinity : now + (m.mini && this.minis ? this.minis.respawnMs : m.rules.respawnMs);
      m.foe = null;
      m.path = [];
    }
    return { id: m.id, damage, crit, hp: m.hp, dead: m.hp === 0 };
  }

  /** Who earned a mini boss that just fell: every member who did its share of its HP (miniBoss.kill_credit), the killer
   *  if nobody did; its tally starts over. */
  private miniEarners(m: Mob, killer: string): string[] {
    const share = this.minis?.creditShare ?? 0;
    const to = [...(m.dealt ?? new Map<string, number>())].filter(([, d]) => d >= m.maxHp * share).map(([u]) => u);
    m.dealt?.clear();
    return to.length ? to : [killer];
  }

  /** A hit on the golem (the stats rules' damage against its row in the mob table, or a miss), never blocked. A miss
   *  still starts its fight. Its damage counts for the member (a reload mid-fight keeps it); the last hit: its XP to
   *  every member who did enough of its HP (into `kills`). */
  private hitGolem(player: string, name: string, member: string, by: Hitter & { blinded?: boolean }, pct: number, now: number, kills: MobKill[]): MobHit {
    const g = this.golem!;
    const stats = this.statsOf(g.id);
    const { damage, crit, miss } = by.blinded ? MISSED : rollHit(this.fightData.stats, by, stats, pct, this.random);
    const r = g.hit(player, name, damage, now, member)!;
    if (r.dead) {
      const [gc, gr] = g.at(now);
      kills.push({ id: g.id, kind: g.id, at: [Math.round(gc), Math.round(gr)], level: stats.level, xp: stats.xp, to: xpEarners(stats, r.dealt ?? new Map(), member), boss: true });
    }
    return { id: g.id, damage, crit, hp: r.hp, dead: r.dead, ...(miss ? { miss } : {}) };
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

  /** A player left the room: no mob (nor the golem) is after them any more, and nothing still on its way lands on them.
   *  `keepSwings`: their cooldowns stay (knocked out: they're still here). */
  forget(player: string, keepSwings = false): void {
    for (const m of this.mobs) if (m.foe?.id === player) m.foe.at = -Infinity;
    if (!keepSwings) for (const k of [...this.swings.keys()]) if (k === player || k.startsWith(`${player}:`)) this.swings.delete(k);
    this.landings = this.landings.filter((l) => l.player !== player);
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
      ...(m.mini ? { mini: m.mini.id } : {}),
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

  /** Dev (?minibosses=now): every mini boss that's down comes back on the next tick. How many. */
  respawnMinis(): number {
    const down = this.mobs.filter((m) => m.mini && m.respawnAt);
    for (const m of down) m.respawnAt = 1;
    return down.length;
  }

  /** Dev: the golem rises now (?golem=now); plays its whole fight (?golemdemo=1, `name` = who asked). */
  riseGolem(now: number): boolean {
    return this.golem?.riseNow(now) ?? false;
  }

  golemDemo(now: number, name: string): void {
    this.golem?.demo(now, name);
  }
}
