import { readFileSync } from 'node:fs';
import {
  combatRating,
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
  type SkillEffect,
  capped,
  chargeMult,
  crowdShare,
  effectOf,
  shapeParts,
  skillEffects,
  skillHits,
  skillCooldown,
  skillLevelBonus,
  skillPct,
  skillTier,
  xpEarners,
} from '@mikazuki/shared';
import { loadItemData, loadLeveling } from './stats-data.js';
import type { TownServerMessage } from '@mikazuki/shared';
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
// whole pack together, each cap not already fighting): its target sticks (CONTEXT.md Aggro: hits from others never switch
// it), and within its reach of them (`rangeTiles`: melee 1, the Wire Tangle's zap 4) attacks every `attackEverySeconds` (the Scrap Crab its own rhythm: mobs.json attackMs, its shell down
// shellOpenMs from each): the stats rules' hit with its ATK as Power against the player's DEF and level (`guards`, from
// the host each tick; a miss by the level gap), sent with the attack (`hit`) and landing as its art does (its attack
// frame: `landed` hands the host what to take off their HP then; the Bag's also slows them for `slow` ms). An aggressive
// kind (Tire Roller, Wire Tangle, Scrap Crab) goes after the first player who comes within `aggroTiles` of it (in its
// zone, on its level; several at once: the nearest); passive ones (Tin Can, Bottle Caps, Plastic Bag Spook) only fight
// back, the first to hit them. It lets its target go when they're gone, knocked out, out of its zone, more than
// `leashTiles` from its spawn (it can't follow further) or more than its target range (stats.json aggro.keepTiles) from
// it, and takes the next player within its aggro range at once (aggressive: the one there longest; passive: whoever hit
// it earliest this fight); nobody, or (a passive one) no hit on it from anyone for GIVE_UP_MS: it walks home, keeping
// the HP it has left (never healed back up: owner, 26 Oct 2026; a boss's reset is its own, `healFull`). A taunt takes it over at once, and the taunter stays its target after (the latest wins). At 0 HP it dies (its XP to whoever killed it:
// `kills`, which the town turns into levels). A skill can only be used from its unlock level (classes.json; refused
// 'locked' before). Each has its own cooldown by its unlock level (baseCooldown in @mikazuki/shared, stats.json
// skills.cooldownByUnlock: Lv 1 the quickest),
// 1% less for each skill level past 1 (skillCooldown); a skill's slow or root lasts 5% longer a skill level
// (skillLevelBonus's buff).
//
// Mini bosses (classes/leveling.json miniBosses, at the spots in each zone's `miniBosses` in the map): one mob each, ids
// `<zone>:mini:<id>`, its kind's art, moves and rules with its own level, HP, ATK, DEF and XP; all up at once, each back
// at its own spot miniBoss.respawnSeconds after it dies, never part of a zone's count. Its kill goes to every member who
// did miniBoss.kill_credit's share of its HP (`dealt`, cleared when it dies or a boss resets), each getting its XP and their own
// loot (`mini` on the kill; the town adds their party nearby).
//
// The field boss (the map's `boss`, given its art): town-golem.ts runs it on this room's clock; hits on it come through
// attack() like any mob's (reach to its body's edge; area skills reach it too), and its Adds are mobs of this room (ids
// `golem-add:<n>`, sent with their `kind` in `mob-add`; aggressive toward the nearest player within its leash, never
// coming back once dead, all removed with `mob-remove` when the fight ends). Its slams and tosses land like the mobs'
// attacks (`landed`; its Junk Drop and Shockwave as they land: who's in them then), its Lamp Glare blinds (`blind` ms: the host makes their attacks miss, `Attacker.blinded`).
// Players the host leaves out of a tick (knocked out) are nobody's target: mobs walk home, the golem looks elsewhere.
//
// The Lumang Palengke's mobs (MobRoomOptions.area 'palengke': stats.json mobBehaviour aliveperZoneIn) are the same with
// their kinds' traits (mobs/mobs.json): eight facings (their art's); a front block (the Sangkalan Chomper always, the
// Payong Flapper while its umbrella opens: a share off hits from the 90 degrees it faces, `reduced`); a tear cloud on the
// player hit (Sibuyas Sobber: they miss more); spilled rice where the Sako Slammer lands (`slowAt`: walking there is
// slower, `mob-fx`); a thrown chair that only hits if the player is still near the tile it was thrown at as it lands, and
// chairs lost as its HP falls (Monobloc Stack: less ATK); hidden until a player comes near, a stronger first hit, hidden
// again after (Banyera Lurker, on its zone's floodwater spawn points only); Weigh (Timbangan Sentinel: harder on a
// player with more of their HP left). Zone mobs never step on the field boss's arena where it has no pit.

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
  | { t: 'mob-attack'; id: string; target: string; dir: TownMobFacing; slow?: number; hit?: PlayerHit; to?: [number, number] }
  | { t: 'mob-spawn'; id: string; col: number; row: number; hp: number }
  | { t: 'mob-heal'; id: string; hp: number }
  | Extract<TownServerMessage, { t: 'mob-scale' | 'mob-flag' | 'mob-fx' | 'boss-move' | 'boss-hit' | 'boss-cancel' | 'system' | 'great-scale' | 'mob-stun' | 'mob-debuff' }>
  | GolemEvent;

/** A Scrap Warrens run's say over its room's mobs (town-warrens.ts): its bosses' moves on the room's clock. */
export interface MobDirector {
  /** Each tick (players: where each one up is, by town id): what its bosses do; events to send. */
  /** `present`: everyone in the room, the knocked out and loading too (a field boss's HP follows it, as the golem's). */
  tick(now: number, players: ReadonlyMap<string, [number, number]>, present?: number): MobEvent[];
  /** A mob's HP fell (a hit or a burn's tick), or it died: its thresholds (calls, vanish, hunker, enrage); events. */
  hurt(id: string, now: number): MobEvent[];
  /** A player's hit is about to land on a mob (a miss too: it starts the fight), by a fighter of `level`: before it's
   *  rolled, so a director can change the mob's numbers first (the Halloween event's mobs grow with their hitters). */
  hit?(id: string, level: number, now: number): MobEvent[];
}

/** Several directors on one mob room (the Old Market's: the Great Scale and the Halloween event's Biikko), each told
 *  everything, their events together. */
export function bothDirectors(...ds: (MobDirector | null | undefined)[]): MobDirector {
  const all = ds.filter((d): d is MobDirector => !!d);
  return {
    tick: (now, players, present) => all.flatMap((d) => d.tick(now, players, present)),
    hurt: (id, now) => all.flatMap((d) => d.hurt(id, now)),
    hit: (id, level, now) => all.flatMap((d) => d.hit?.(id, level, now) ?? []),
  };
}

export interface MobRoomOptions {
  /** Fixed numbers for a zone's mobs (the Warrens' areas: by zone id) instead of the mob table's. */
  zoneStats?: Record<string, { level: number; hp: number; atk: number; def: number; xp: number }>;
  /** Dungeon mobs notice a player this close (warrens run.mobAggro: 4). */
  dungeonAggro?: number;
  director?: MobDirector;
  /** The map these mobs live on ('palengke': its own count per zone, stats.json mobBehaviour aliveperZoneIn). */
  area?: string;
}

/** A boss or a called mob the director adds: its kind, numbers and traits. */
export interface MobSpec {
  id: string;
  kind: string;
  zone: string;
  tile: [number, number];
  stats: { level: number; hp: number; atk: number; def: number; xp: number };
  boss?: 'mini' | 'last';
  name?: string;
  title?: string;
  scale?: number;
  radius?: number;
  /** Never moves (Barong-Barong); never attacks on its own (its moves are the director's). */
  still?: boolean;
  silent?: boolean;
  /** Called by a boss (gone when it resets): its tag. */
  calledBy?: string;
  /** A field boss (the Great Scale): hit only from inside its zone, never back on its own once dead (its director brings
   *  it back), its XP for everyone who did `xpShare` of its HP, its loot personal; losing a foe it just looks for the next.
   *  `dormant`: asleep (between fights: still, not to be targeted). */
  field?: boolean;
  dormant?: boolean;
}

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
  /** A front block took a share of it (the Chomper, the opening Payong): shown dim. */
  reduced?: boolean;
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
  /** The field boss: its loot is personal, for each of `to`; `dealt` is the damage each member did in the fight (the
   *  leaderboard's golem record, web/records.ts). */
  boss?: boolean;
  dealt?: Map<string, number>;
  /** A mini boss (its leveling.json id): `to` is everyone who did their share; personal loot for each. */
  mini?: string;
  /** A Scrap Warrens boss (its id; a mini boss or the last boss): `to` is everyone who did their share; the run opens
   *  its shutter and rolls its loot. */
  warrens?: { id: string; boss: 'mini' | 'last' };
}

/** `hits`: the target first, then any other mobs the skill's shape reached (skill-hits.json); `kills`: those it killed.
 *  Refused: out of reach, too soon, the mob gone, `skill` isn't one of their class's (its tier would be made up), or
 *  it's still locked (their level is under its unlock level). */
export type AttackResult =
  | {
      ok: true;
      hits: MobHit[];
      kills: MobKill[];
      /** A heal (heal:F): the caster and their party nearby heal this × Power (the skill level's bonus in). */
      heal?: number;
      /** A leap: the caster's new tile, next to the target. */
      leap?: [number, number];
      /** A windup: nothing landed yet (it does `windup` ms later; its MP then: skillTick's `spent`). */
      windup?: number;
      /** Its hits to come (a channel, or hits on the move): how many more and how far apart. */
      more?: { left: number; every: number; mode: 'channel' | 'move' | null };
    }
  | { ok: false; reason: 'range' | 'slow' | 'gone' | 'skill' | 'locked' };

/** A debuff on a mob (CONTEXT.md Debuff): its stats (stats.json skills.buffs: defPct, damageTakenPct, missChance,
 *  mobDamagePct, slow, taunt seconds) until then, and who cast it (a taunt's foe). */
export interface MobDebuff {
  stats: Record<string, number>;
  until: number;
  by: string;
}

/** A skill's later hits (a channel, hits on the move, a windup): who, how hard each, on what, and when. */
interface Cast {
  player: string;
  name: string;
  member: string;
  by: Hitter & { blinded?: boolean };
  pct: number;
  skill: number;
  shape: string;
  reach: number;
  target: string;
  from: [number, number];
  left: number;
  next: number;
  every: number;
  mode: 'channel' | 'move' | 'windup' | null;
  /** Each hit's effects on the mobs it hits (slow, root, stun, taunt), the skill level's bonus in. */
  effects: SkillEffect[];
  skillLevel: number;
  /** A windup's MP (spent as it lands) and its cooldown's key (cleared if it's cancelled). */
  mp?: number;
  ready?: string;
}

/** A mob's (or the golem's) attack landing on a player (town id) now: its damage (or a miss), and the Bag's slow (ms,
 *  on a hit) or the Lamp Glare's blindness (ms). The host takes it off their HP. */
export interface PlayerLanding extends PlayerHit {
  player: string;
  by: string;
  slow?: number;
  blind?: number;
  /** Stunned (can't move or attack) this long (Wire Wolf's Live Floor). */
  stun?: number;
  /** A tear cloud: `tearAccuracy` points more misses for `tear` ms (the Sibuyas Sobber's). */
  tearAccuracy?: number;
  /** A thrown chair: it hits only if they're within `within` tiles of `tile` as it lands. */
  tile?: [number, number];
  within?: number;
  /** A slow's strength (the share of their speed left: Brine Splash's 0.7); none: the usual half. */
  slowFactor?: number;
  /** The Great Scale's Weigh-in: held on its pan this long (ms; 0: let go): no steps, attacks or moves. */
  hold?: number;
  /** A share of their most HP off (held on the pan: each second's squeeze), on top of `damage`. */
  hpPct?: number;
  /** Their newest timed class buff taken off (Kulang sa Timbang). */
  strip?: boolean;
}

/** Each class's skills' target shapes, in their order (the game's classes/skill-hits.json), and their effects. */
export interface SkillShapes {
  shapes: Record<string, string[]>;
  effects?: Record<string, (string | null)[]>;
  /** Tiles each skill reaches (else the class's: RANGED or the next tile). */
  range?: Record<string, number[]>;
  /** A skill that lands as several hits (N:EVERY[:channel|:move], shared skillHits), by class and skill. */
  hits?: Record<string, (string | null)[]>;
}

/** The game's classes/skill-hits.json. */
export function loadSkillShapes(): SkillShapes {
  const json = JSON.parse(readFileSync(new URL('../../../game/public/assets/classes/skill-hits.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  const arrays = (o: Record<string, unknown> | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => Array.isArray(v)));
  return {
    shapes: arrays(json) as Record<string, string[]>,
    effects: arrays(json.effects as Record<string, unknown> | undefined) as Record<string, (string | null)[]>,
    range: arrays(json.range as Record<string, unknown> | undefined) as Record<string, number[]>,
    hits: arrays(json.hits as Record<string, unknown> | undefined) as Record<string, (string | null)[]>,
  };
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
   *  (buffTotals; fighterStats puts them on). */
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
  const d = derivedStats(S, a.cls, level, baseStats(S, a.cls, level, a.points), itemTotals(data, worn, main, a.cls)); // (a worn cosmetic's stats only on its class)
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
  /** A Scrap Warrens area: all aggressive, its packs (`groups`: each one's tiles) pull together, none respawns, none leaves
   *  its rect; its numbers are MobRoomOptions.zoneStats'. */
  dungeon?: boolean;
  groups?: [number, number][][];
  /** A field boss's own zone (the Great Scale's: its arena): its mob may stand on the arena no other zone's mob steps on. */
  field?: boolean;
}

export interface MobMapData {
  size: [number, number];
  blocked: number[][];
  height?: number[][];
  ramps?: { col: number; row: number }[];
  safeZone?: [number, number, number, number];
  mobZones?: MobZoneData[];
  /** Each tile's ground (rows of kinds; the Lurkers' floodwater). */
  ground?: string[][];
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
  /** Its art faces eight ways (the manifest's `directions`): its facing is any grid step's (the Palengke's mobs). */
  eight?: boolean;
  /** Its zone keeps this many about (packs counted once) instead of stats.json's count. */
  alive?: number;
  /** A mini boss of its kind wears this look. */
  miniLook?: string;
  /** Hits from its front quarter take `share` of their damage: always, or (`frames`) only while its attack is on those
   *  frames (`openMs`: how long from its start, worked out from the manifest's fps). */
  block?: { share: number; frames?: [number, number] };
  openMs?: number;
  /** A hit leaves a tear cloud on the player: `accuracy` points more misses for `ms`. */
  tear?: { accuracy: number; ms: number };
  /** Its attack leaves spilled rice on the player's tile as it lands: walking there at `slow` of the speed, for `ms`. */
  rice?: { slow: number; ms: number };
  /** It throws a chair: `speed` px a second from its attack frame to the player's tile then; it hits only those still
   *  within `hitTiles` of it. At each `loseAt` share of its HP it loses a chair: −`atkPerChair` of its ATK. */
  chair?: { speed: number; hitTiles: number; loseAt: number[]; atkPerChair: number };
  /** Hidden on its zone's spawn points on `ground` until a player comes within `tiles`; it rises (`riseMs`), its first
   *  hit ×`firstHit`; `hideMs` after it loses its target it hides again. */
  ambush?: { ground: string; tiles: number; firstHit: number; riseMs: number; hideMs: number };
  /** Its hit × (1 + perHp × the player's share of their HP left). */
  weigh?: { perHp: number; flashAt?: number };
  /** It drifts: its own pace and short rests. */
  drift?: { speed: number; rest: [number, number] };
  /** Its own walking pace (tiles a second: the Great Scale's slow hops). */
  pace?: number;
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
  /** Who it's after (its target: CONTEXT.md Aggro), and since when. Only losing them or a taunt changes it. */
  foe: { id: string; at: number } | null;
  /** The last hit on it by anyone in this fight (a passive one gives up GIVE_UP_MS after it). */
  fightAt?: number;
  /** Who has hit it this fight and when each first did (town id → ms): a passive one's next target is the earliest. */
  hitters?: Map<string, number>;
  /** An aggressive one: who is within its aggro range and since when (town id → ms); the first there is its target. */
  seen?: Map<string, number>;
  nextAttack: number;
  /** A shell's down until then (its last attack + shellOpenMs). */
  openUntil: number;
  /** Slowed to `factor` of its speed until then (0: rooted). */
  slow: { factor: number; until: number } | null;
  /** Stunned until then (CONTEXT.md Stun): it neither moves nor attacks. */
  stunUntil?: number;
  /** Taunted (CONTEXT.md Taunt): it fights this player until then, whoever else hits it. */
  taunt?: { id: string; until: number } | null;
  /** Its debuffs (CONTEXT.md Debuff), one of each name. */
  debuffs?: Map<string, MobDebuff>;
  /** The pace of the hop under way (tiles a second). */
  hopSpeed: number;
  /** Its pack (the caps of one spawn point, the leader the first alive), or null. */
  pack: Mob[] | null;
  /** One of the golem's Adds: no spawn point, never back once dead, gone when the fight ends. */
  add?: boolean;
  /** Its HP before party scaling (a Warrens run: maxHp = this × the scale). */
  baseHp?: number;
  /** A Warrens boss and how it's shown (name, title, scale), its body's radius (reach to its edge), and its traits:
   *  never moves, never attacks on its own (the director's moves), can't be targeted or hit for now, every hit blocked;
   *  a mob a boss called (gone when it resets). */
  boss?: 'mini' | 'last';
  name?: string;
  title?: string;
  scale?: number;
  radius?: number;
  /** A boss casting one of its moves: it holds still until then (its move lands where it stands). */
  castUntil?: number;
  still?: boolean;
  silent?: boolean;
  untargetable?: boolean;
  blockAll?: boolean;
  calledBy?: string;
  /** Its kind when it isn't its zone's (a director's boss or called mob): sent with it. */
  kindId?: string;
  /** A mini boss (its leveling.json entry): back at its own spot; who has done how much of its HP (members). */
  mini?: MiniBossDef;
  dealt?: Map<string, number>;
  /** A front block a director set (Sangkalancelot's shell): `share` of a hit from the quarter it faces taken off (1: all,
   *  shown "Blocked"), except until `openUntil`. */
  frontBlock?: { share: number; openUntil: number };
  /** A field boss (MobSpec.field), and asleep (`dormant`). */
  field?: boolean;
  dormant?: boolean;
  /** When it last started an attack (a Payong's block while it opens). */
  attackAt?: number;
  /** Chairs it has lost (a Monobloc Stack: less ATK each). */
  chairsLost?: number;
  /** A Lurker lying in wait; when it hides again (it lost its target); its next hit is the one from hiding. */
  hidden?: boolean;
  hideAt?: number;
  ambushHit?: boolean;
}

/** The game's mobs/mobs.json, with when each kind's attack lands (its attackFrame at the manifest's attack fps). */
export function loadMobKinds(): MobKinds {
  const read = (file: string) => JSON.parse(readFileSync(new URL(`../../../game/public/assets/${file}`, import.meta.url), 'utf8')) as Record<string, unknown>;
  const json = read('mobs/mobs.json');
  const art = read('manifest.json').mobs as Record<string, { animations?: Record<string, { fps: number }>; directions?: string[] } | string>;
  const kinds = Object.fromEntries(Object.entries(json).filter(([, v]) => typeof v === 'object' && v)) as Record<string, MobKind & { attackFrame?: number }>;
  for (const [id, k] of Object.entries(kinds)) {
    const def = art[id];
    const fps = typeof def === 'object' ? def.animations?.attack?.fps : undefined;
    if (fps) k.hitMs = Math.round(((k.attackFrame ?? 0) / fps) * 1000);
    // (A block while its attack is on frames f0–f1: from the attack's start to the end of f1.)
    if (fps && k.block?.frames) k.openMs = Math.round(((k.block.frames[1] + 1) / fps) * 1000);
    if (typeof def === 'object' && def.directions?.length === 8) k.eight = true;
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
const AXIS: Record<TownMobFacing, [number, number]> = { se: [1, 0], sw: [0, 1], nw: [-1, 0], ne: [0, -1], s: [1, 1], e: [1, -1], n: [-1, -1], w: [-1, 1] };
const FACINGS: TownMobFacing[] = ['se', 'sw', 'ne', 'nw'];

/** The way to face for something `dc, dr` away: along the bigger of the two; on a diagonal as the game shows a step
 *  that way (SE for S and E, SW for W, NE for N). Null for no way at all. */
export function facingTo(dc: number, dr: number): TownMobFacing | null {
  if (Math.abs(dc) > Math.abs(dr)) return dc > 0 ? 'se' : 'nw';
  if (Math.abs(dr) > Math.abs(dc)) return dr > 0 ? 'sw' : 'ne';
  if (!dc) return null;
  return dc > 0 ? 'se' : dr > 0 ? 'sw' : 'ne';
}

/** The way to face for a step `dc, dr` (or toward something that far) on art with eight facings: the grid step's screen
 *  direction (+col SE, +row SW, both S…), by the angle in 45-degree sectors. Null for no way at all. */
export function facing8(dc: number, dr: number): TownMobFacing | null {
  if (!dc && !dr) return null;
  // Screen x right = dc − dr, screen y down = dc + dr (an iso tile is twice as wide as it is tall).
  const a = Math.atan2((dc + dr) * 0.5, dc - dr);
  const i = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return (['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'] as const)[i];
}

/** Each facing's step on the grid (eight facings: the diagonals' too). */
const FACE_STEP: Record<TownMobFacing, [number, number]> = { se: [1, 0], sw: [0, 1], nw: [-1, 0], ne: [0, -1], s: [1, 1], e: [1, -1], n: [-1, -1], w: [-1, 1] };

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
    private readonly opts: MobRoomOptions = {},
  ) {
    this.minis = leveling ? miniBossRules(leveling) : null;
    for (const r of map.ramps ?? []) this.ramps.add(`${r.col},${r.row}`);
    this.pit = pitTiles(map.boss);
    this.roam = fightData.stats.mobBehaviour.wanderTiles;
    for (const zone of map.mobZones ?? []) {
      if (!zone.active) continue;
      const kind = kinds[zone.mob] ?? {};
      const R = mobRules(fightData.stats, zone.mob);
      if (zone.dungeon) {
        // A Warrens area: all aggressive, each pack's mobs pull together, none leaves its area or comes back.
        const z: MobZoneData = { ...zone, aggro: 'aggressive', aggroRange: opts.dungeonAggro ?? 4, leash: 10_000 };
        this.zones.push(z);
        (zone.groups ?? zone.spawns.map((s) => [s])).forEach((g, gi) => {
          const pack: Mob[] = [];
          g.forEach((tile, k) => {
            const [m] = this.place(z, { ...kind, pack: undefined }, `${zone.id}:${gi}:${k}`, tile);
            m.pack = pack;
            pack.push(m);
          });
        });
        continue;
      }
      // A field boss's zone (its director's: the Great Scale's arena): its own aggro and leash, nobody placed.
      if (zone.field) {
        this.zones.push({ ...zone });
        continue;
      }
      const R2 = mobRules(fightData.stats, zone.mob, opts.area);
      // (A Lurker notices a player only this close: its ambush.)
      const z: MobZoneData = { ...zone, aggro: R.aggressive ? 'aggressive' : 'passive', aggroRange: kind.ambush?.tiles ?? R.aggroTiles, leash: R.leashTiles };
      // Its spawn points: off the field boss's arena (where it has no pit), and a Lurker's only on its floodwater.
      z.spawns = zone.spawns.filter(([c, r]) => !this.inArena(c, r) && (!kind.ambush || map.ground?.[r]?.[c] === kind.ambush.ground));
      this.zones.push(z);
      // Its `alive` mobs (packs) at spread-out spawn points (a kind's own count, else the map's, else stats.json's).
      const alive = Math.min(kind.alive ?? R2.alive, kind.ambush ? z.spawns.length : Infinity);
      mobStartSpots(zone.id, z.spawns, alive).forEach((i, k) => this.place(z, kind, `${zone.id}:${k}`, z.spawns[i]));
      // Its mini bosses, each at its spot (one alone: never a pack), in its kind's mini boss look if it has one.
      for (const spot of zone.miniBosses ?? []) {
        const def = leveling ? miniBossDef(leveling, spot.id) : null;
        if (!def || def.kind !== zone.mob) continue;
        const [m] = this.place(z, { ...kind, pack: undefined }, miniMobId(zone.id, spot.id), spot.tile);
        const stats = { ...m.stats, level: def.level, hp: def.hp, atk: def.atk, def: def.defense, xp: def.xp };
        Object.assign(m, { stats, level: def.level, maxHp: def.hp, hp: def.hp, mini: def, dealt: new Map(), ...(kind.miniLook ? { variant: kind.miniLook } : {}) });
      }
    }
    const boss = map.boss;
    if (boss && golem) {
      const level = this.map.height?.[boss.tile[1]]?.[boss.tile[0]] ?? 0;
      this.golem = new Golem(boss, golem, {
        open: (c, r) => c >= 0 && r >= 0 && c < map.size[0] && r < map.size[1] && !map.blocked[r]?.[c] && (map.height?.[r]?.[c] ?? 0) === level && !this.ramps.has(`${c},${r}`),
        callAdds: (spots, now) => this.callAdds(boss, level, spots, now),
        dropAdds: () => this.dropAdds(),
        roll: (player, mult) => this.rollOn(player, this.statsOf(boss.id), mult, this.debuffOf('golem', Date.now())),
      }, random);
    }
  }

  /** This tick's players' DEF and level (town id → them): what mobs' and the golem's hits are rolled against. */
  private guards: ReadonlyMap<string, Target> = new Map();
  /** Attacks under way, landing on players at `at` (ms). */
  private landings: (PlayerLanding & { at: number })[] = [];

  /** A mob's hit on a player: its ATK (× `mult`) as Power against their DEF and level (the stats rules, with the level
   *  gap's miss chance), or null when their DEF isn't known (no HP here: harmless). */
  private rollOn(player: string, mob: MobStats, mult = 1, debuff: Record<string, number> = {}): PlayerHit | null {
    const guard = this.guards.get(player);
    if (!guard) return null;
    // (Its debuffs: Eye Sting's miss chance as accuracy off; Numbing Oil's damage off.)
    const by = { power: mob.atk * (1 + (debuff.mobDamagePct ?? 0)), level: mob.level, accuracy: -(debuff.missChance ?? 0) };
    const { damage, miss } = rollHit(this.fightData.stats, by, guard, mult, this.random);
    return miss ? { damage: 0, miss } : { damage };
  }

  /** A mob's debuffs as one set of stats (each name once; different ones add up), the expired ones dropped. */
  private debuffOf(m: Mob | 'golem', now: number): Record<string, number> {
    const all = m === 'golem' ? this.golemDebuffs : m.debuffs;
    const out: Record<string, number> = {};
    if (!all) return out;
    for (const [name, d] of all) {
      if (now >= d.until) {
        all.delete(name);
        continue;
      }
      for (const [k, v] of Object.entries(d.stats)) out[k] = (out[k] ?? 0) + v;
    }
    return out;
  }

  /** The golem's debuffs (it isn't one of the room's mobs). */
  private golemDebuffs = new Map<string, MobDebuff>();

  /** The attacks that land now (the host takes them off players' HP), in the order they land. */
  landed(now: number): (PlayerLanding & { at: number })[] {
    if (!this.landings.length) return [];
    const due = this.landings.filter((l) => l.at <= now).sort((a, b) => a.at - b.at);
    if (!due.length) return [];
    this.landings = this.landings.filter((l) => l.at > now);
    // A thrown chair: a miss for whoever has moved off where it was thrown.
    for (const l of due) {
      if (!l.tile || l.miss) continue;
      const p = this.lastPlayers.get(l.player);
      if (!p || cheb(p, l.tile) > (l.within ?? 0)) Object.assign(l, { damage: 0, miss: true, tear: undefined });
    }
    return due; // (each with when it landed: a Step Back's dodge is measured to that)
  }

  /** A player's stats as a fight sees them (HP, MP, DEF… and level), from their class, level, points and worn gear. */
  fighter(a: Attacker): DerivedStats & { level: number } {
    return fighterStats(this.fightData, a);
  }

  /** Their combat rating (CP), buffs and all. */
  rating(a: Attacker): number {
    return combatRating(this.fightData.stats, this.fighter(a), a.cls);
  }

  /** Their Drop rate (the stat, capped): the loot cascades' boost (CONTEXT.md Drop rate). */
  dropRate(a: Attacker): number {
    return this.fighter(a).dropRate ?? 0;
  }

  /** A kind's row in the mob table (a kind without one is a data problem: loud, at start). */
  private statsOf(mob: string): MobStats {
    const s = mobStats(this.fightData.stats, mob);
    if (!s) throw new Error(`No stats for the mob kind ${mob} (classes/stats.json mobs.list)`);
    return s;
  }

  /** A spawn point's mob (or pack: `point:<n>` each), its look seeded from its id, its level and HP its kind's; the Adds'
   *  too. */
  private place(zone: MobZoneData, kind: MobKind, point: string, [col, row]: [number, number], add = false, given?: MobStats): Mob[] {
    const variants = kind.variants ?? [];
    const n = kind.pack ? packSize(point, kind.pack) : 1;
    const own = given ?? this.opts.zoneStats?.[zone.id];
    const stats: MobStats = own ? { ...own } : this.statsOf(zone.mob);
    const base = mobRules(this.fightData.stats, zone.mob);
    const rules = zone.dungeon ? { ...base, aggressive: true, packAssist: true, aggroTiles: zone.aggroRange ?? base.aggroTiles } : base;
    const pack: Mob[] = [];
    const facings = kind.eight ? (Object.keys(FACE_STEP) as TownMobFacing[]) : FACINGS;
    for (let k = 0; k < n; k++) {
      const id = kind.pack ? `${point}:${k}` : point;
      const variant = variants[Math.floor(seeded(`${id}:variant`) * variants.length)] ?? '';
      const m: Mob = {
        id, zone, kind, stats, rules, level: stats.level, maxHp: stats.hp, variant, spawn: [col, row], home: [col, row], col, row, facing: facings[Math.floor(seeded(`${id}:dir`) * facings.length)], path: [], hopAt: 0, restUntil: 0,
        hp: stats.hp, respawnAt: 0, foe: null, nextAttack: 0, openUntil: 0, slow: null, hopSpeed: SPEED, pack: kind.pack ? pack : null, ...(add ? { add } : {}),
        ...(zone.dungeon ? { baseHp: stats.hp } : {}),
      };
      // A pack's caps start round the point, each on a tile of its own (seeded: the same every time).
      if (k) m.home = this.besideSpawn(m, pack, id);
      // A Lurker starts lying in wait.
      if (kind.ambush && !add) Object.assign(m, { hidden: true, untargetable: true });
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
    Object.assign(m, { respawnAt: 0, hp: m.maxHp, col: at[0], row: at[1], path: [], foe: null, fightAt: undefined, hitters: undefined, seen: undefined, slow: null, nextAttack: 0, restUntil: now + REST_MS[0], chairsLost: 0, ambushHit: false, hideAt: undefined });
    if (m.kind.ambush) Object.assign(m, { hidden: true, untargetable: true });
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
    if (!m.zone.dungeon && !m.zone.field && m.zone.id !== 'golem-add' && this.inArena(col, row)) return false;
    const [c0, r0, c1, r1] = this.map.safeZone ?? [-1, -1, -2, -2];
    if (col >= c0 && col <= c1 && row >= r0 && row <= r1) return false;
    return Math.max(Math.abs(col - m.spawn[0]), Math.abs(row - m.spawn[1])) <= reach;
  }

  /** `n` tiles round `at` (its own first, then outward) on its level, open and not ramps, to lay a kill's loot on;
   *  never a tile in `taken` (loot already lying there would hide under it, or it under that) while there's another
   *  (then those, then the same ones again if there still aren't enough). */
  lootSpots(at: [number, number], n: number, taken: ReadonlySet<string> = new Set()): [number, number][] {
    const [cols, rows] = this.map.size;
    const level = this.map.height?.[at[1]]?.[at[0]] ?? 0;
    const open = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && !this.map.blocked[r]?.[c] && (this.map.height?.[r]?.[c] ?? 0) === level && !this.ramps.has(`${c},${r}`);
    const out: [number, number][] = [];
    for (const skipTaken of [true, false]) {
      for (let ring = 0; ring <= 3 && out.length < n; ring++) {
        for (let dr = -ring; dr <= ring && out.length < n; dr++) {
          for (let dc = -ring; dc <= ring && out.length < n; dc++) {
            const [c, r] = [at[0] + dc, at[1] + dr];
            if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring || !open(c, r)) continue;
            if (taken.has(`${c},${r}`) ? skipTaken : out.some(([x, y]) => x === c && y === r)) continue;
            out.push([c, r]);
          }
        }
      }
    }
    return out.length ? out : [at];
  }

  /** On the field boss's arena where it has no pit (the Great Scale's hall): no zone's mob steps there. */
  private inArena(col: number, row: number): boolean {
    const a = !this.pit ? this.map.boss?.arena : undefined;
    return !!a && col >= a[0] && col <= a[2] && row >= a[1] && row <= a[3];
  }

  /** The way it faces toward something `dc, dr` away (a step, or its target): its art's four diagonals or eight. */
  private faceTo(m: Mob, dc: number, dr: number): TownMobFacing | null {
    return m.kind.eight ? facing8(dc, dr) : facingTo(dc, dr);
  }

  /** Spilled rice on the ground (the Sako Slammer's): where, from and until when (ms), how slow walking there is. */
  private patches: { at: [number, number]; from: number; until: number; slow: number }[] = [];

  /** Walking on `col, row` now: the slowest spilled rice there (1: none). */
  slowAt(col: number, row: number, now: number): number {
    if (this.patches.length && this.patches[0].until <= now) this.patches = this.patches.filter((p) => p.until > now);
    let k = 1;
    for (const p of this.patches) if (now >= p.from && p.at[0] === col && p.at[1] === row) k = Math.min(k, p.slow);
    return k;
  }

  /** Where each player stood at the last tick (a thrown chair hits only those still near where it was thrown). */
  private lastPlayers: ReadonlyMap<string, [number, number]> = new Map();

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
    return this.faceTo(m, to[0] - from[0], to[1] - from[1]) ?? m.facing;
  }

  /** Its pace now: its kind's (a drifter's own), slowed (or rooted: 0) for a while after a skill's effect. */
  private speedOf(m: Mob, now: number, pace = m.kind.pace ?? m.kind.drift?.speed ?? SPEED): number {
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

  /** How far a player is from it: from its body's edge for a boss with one, else tiles (Chebyshev). */
  private away(m: Mob, p: [number, number]): number {
    return m.radius ? Math.max(0, Math.hypot(p[0] - m.col, p[1] - m.row) - m.radius) : cheb(p, [m.col, m.row]);
  }

  /** An aggressive one notes who is within its aggro range and since when (`seen`; anyone who leaves it is let go). */
  private watch(m: Mob, near: [string, [number, number]][] | undefined, now: number): void {
    const range = m.zone.aggroRange ?? m.rules.aggroTiles;
    const here = (near ?? []).filter(([, p]) => this.away(m, p) <= range);
    if (!here.length) return void m.seen?.clear();
    const seen = (m.seen ??= new Map());
    const ids = new Set(here.map(([id]) => id));
    for (const id of [...seen.keys()]) if (!ids.has(id)) seen.delete(id);
    for (const id of ids) if (!seen.has(id)) seen.set(id, now);
  }

  /**
   * Its next target (CONTEXT.md Aggro), or null: a player in its zone and within its leash, within its aggro range: an
   * aggressive one the one who has been there longest (`seen`), a passive one the one who hit it earliest this fight
   * (`hitters`: never one who hasn't); a field boss (it fights in its arena) the earliest hitter there, else the nearest
   * there. Ties: the nearest. `flies`: no zone (the Manananggal's upper half).
   */
  private nextFoe(m: Mob, players: ReadonlyMap<string, [number, number]>, now: number, flies = false): string | null {
    const range = m.zone.aggroRange ?? m.rules.aggroTiles;
    const leash = m.zone.leash ?? m.rules.leashTiles;
    let best: { id: string; first: number; d: number } | null = null;
    // (An aggressive one only looks at who it has seen within its aggro range; a passive one at who has hit it.)
    const aggressive = m.zone.aggro === 'aggressive' && !m.field;
    const who = m.field ? [...players.keys()] : [...((aggressive ? m.seen : m.hitters)?.keys() ?? [])];
    for (const id of who) {
      const p = players.get(id);
      if (!p || (!flies && !this.inZone(m.zone, p)) || cheb(p, m.spawn) > leash) continue;
      const d = this.away(m, p);
      if (!m.field && d > range) continue;
      const first = m.field ? (m.hitters?.get(id) ?? Infinity) : aggressive ? m.seen!.get(id)! : m.hitters!.get(id)!;
      if (!best || first < best.first || (first === best.first && d < best.d)) best = { id, first, d };
    }
    return best?.id ?? null;
  }

  /** Whether it keeps `id` as its target: still here, in its zone (unless it `flies`), within its leash, and within its
   *  target range (keepTiles; not while they taunt it; a field boss: anywhere in its arena). */
  private keeps(m: Mob, id: string, p: [number, number] | undefined, now: number, flies = false): p is [number, number] {
    if (!p || cheb(p, m.spawn) > (m.zone.leash ?? m.rules.leashTiles) || (!flies && !this.inZone(m.zone, p))) return false;
    if (m.field || (m.taunt?.id === id && now < m.taunt.until)) return true;
    return this.away(m, p) <= m.rules.keepTiles;
  }

  /** Someone it should fight: it (and a `packAssist` kind's whole pack) goes after them, each one that isn't after someone
   *  already (a target sticks: CONTEXT.md Aggro). */
  private rally(m: Mob, player: string, now: number): void {
    for (const x of (m.rules.packAssist && m.pack) || [m]) {
      if (x.respawnAt || x.foe) continue;
      x.foe = { id: player, at: now };
      x.fightAt = now;
      if (x.zone.aggro !== 'aggressive') (x.hitters ??= new Map()).set(player, x.hitters.get(player) ?? now);
      if (x.hidden) this.surface(x, now);
    }
  }

  /** A hit on it (or a miss, or one its shell blocked): noted (who hit it first, the fight's last hit, its pack's too), and
   *  if it isn't fighting yet it (and its pack) goes after them. Never a switch: its target stays its target. */
  private struck(m: Mob, player: string, now: number): void {
    const hitters = (m.hitters ??= new Map());
    if (!hitters.has(player)) hitters.set(player, now);
    for (const x of (m.rules.packAssist && m.pack) || [m]) if (x.foe) x.fightAt = now;
    this.rally(m, player, now);
  }

  /** Its fight is over: no target, nobody's hits remembered. */
  private endFight(m: Mob): void {
    Object.assign(m, { foe: null, fightAt: undefined });
    m.hitters?.clear();
  }

  /**
   * A director's mob that moves on its own (`still` to the room: the Manananggal's upper half): its target as the room's
   * rules keep it (CONTEXT.md Aggro), or the next one if it lost them; null: nobody (its fight is over: it gives up).
   * `flies`: no zone for it.
   */
  retarget(id: string, players: ReadonlyMap<string, [number, number]>, now: number, flies = false): string | null {
    const m = this.byId.get(id);
    if (!m?.foe || m.respawnAt) return null;
    if (m.taunt && now >= m.taunt.until) m.taunt = null;
    if (m.taunt && players.has(m.taunt.id) && m.foe.id !== m.taunt.id) m.foe = { id: m.taunt.id, at: now };
    if (this.keeps(m, m.foe.id, players.get(m.foe.id), now, flies)) return m.foe.id;
    if (m.taunt?.id === m.foe.id) m.taunt = null;
    const next = this.nextFoe(m, players, now, flies);
    if (next) m.foe = { id: next, at: now };
    else this.endFight(m);
    return next;
  }

  /** A Lurker rises out of the water: seen and targetable, its first attack after it's up (`riseMs`) and harder. */
  private surface(m: Mob, now: number): void {
    const A = m.kind.ambush!;
    Object.assign(m, { hidden: false, untargetable: undefined, hideAt: undefined, ambushHit: true, nextAttack: Math.max(m.nextAttack, now + A.riseMs) });
    this.pending.push({ t: 'mob-flag', id: m.id, hidden: false, untargetable: false });
  }

  /**
   * Moves the clock on: hops that are over land; the dead come back; an aggressive mob notices a player near it; a mob
   * with a foe goes after them and attacks within its reach (or gives up and walks home); the rest, rested, start a new
   * hop. `players`: where each player in the room is (by town id; the knocked out left out); `guards`: their DEF and
   * level, which mobs' hits are rolled against (without one, the mobs' hits on that player are harmless). Returns what to send to the
   * room; what lands later, `landed`.
   */
  tick(now: number, players: ReadonlyMap<string, [number, number]> = new Map(), guards: ReadonlyMap<string, Target> = new Map(), present = players.size): MobEvent[] {
    this.claimed = null;
    this.guards = guards;
    this.lastPlayers = players;
    // (`present`: everyone in the room, the knocked out too: the golem's HP follows it.)
    const events: MobEvent[] = this.golem ? this.golem.tick(now, players, present) : [];
    // The golem's slams and tosses land after a moment (its art's), its glare blinds as it lights. (A director lands its
    // own moves' hits with `land`: its `boss-hit`s are only for the room to see.)
    for (const e of events) {
      // Its timed moves (Junk Drop, Shockwave) were decided as they landed: off HP now.
      if (e.t === 'boss-hit') for (const h of e.hits) this.landings.push({ at: now, player: h.id, by: e.id, damage: h.damage, ...(h.miss ? { miss: true } : {}) });
      if (e.t !== 'golem-attack' || !this.golem) continue;
      const at = now + this.golem.hitMs(e.attack as GolemAttack);
      for (const h of e.hits ?? []) this.landings.push({ at, player: h.id, by: e.id, damage: h.damage, ...(h.miss ? { miss: true } : {}) });
      for (const id of e.blinded ?? []) this.landings.push({ at, player: id, by: e.id, damage: 0, blind: e.blindMs });
    }
    if (this.opts.director) events.push(...this.opts.director.tick(now, players, present));
    // Who each zone's mobs could notice (a few players at most: looked up once a tick, not per mob): an aggressive one
    // notes who comes within its aggro range, and goes for the first there.
    const watched = new Map<MobZoneData, [string, [number, number]][]>();
    for (const zone of [...this.zones, ...this.addZones.values()]) {
      if (!zone.active || !zone.aggroRange) continue;
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
        m.facing = this.faceTo(m, b[0] - a[0], b[1] - a[1]) ?? m.facing;
        [m.col, m.row] = b;
        m.path = [];
        const rest = m.kind.drift?.rest ?? REST_MS;
        m.restUntil = now + rest[0] + this.random() * (rest[1] - rest[0]);
      }
      // (Who stepped within its aggro range when: noted mid-hop too, so the first there stays first.)
      if (m.zone.aggro === 'aggressive' && !m.still) this.watch(m, watched.get(m.zone), now);
      if (m.path.length) continue;
      // A Lurker home after its fight: back under the water.
      if (m.hideAt && now >= m.hideAt && !m.foe) {
        Object.assign(m, { hidden: true, untargetable: true, hideAt: undefined });
        events.push({ t: 'mob-flag', id: m.id, hidden: true, untargetable: true });
      }
      if (m.still) continue; // (Barong-Barong: its moves are the director's)
      if (m.castUntil && now < m.castUntil) continue; // (a boss mid-move holds still)
      if (m.stunUntil && now < m.stunUntil) continue; // (stunned: it stands there)
      // Taunted: it fights its taunter while it lasts (and while they're here); once it's over they're still its target.
      if (m.taunt) {
        if (now >= m.taunt.until) m.taunt = null;
        else if (players.has(m.taunt.id) && m.foe?.id !== m.taunt.id) m.foe = { id: m.taunt.id, at: now };
      }
      if (!m.foe && m.zone.aggro === 'aggressive') {
        // The first player to step within its aggro range (several at once: the nearest).
        const first = this.nextFoe(m, players, now);
        if (first) this.rally(m, first, now);
      }
      if (m.foe) {
        this.fight(m, now, players, events);
        continue;
      }
      if (now < m.restUntil || m.hidden) continue; // (a hidden Lurker lies still)
      this.wander(m, now, events);
    }
    // (A Lurker that rose this tick.)
    events.push(...this.pending.splice(0));
    return events;
  }

  /** After its target: next to them (within its reach), it attacks; else closer, two steps at a time. Lost them: the
   *  next one (CONTEXT.md Aggro), or it gives up and goes home. */
  private fight(m: Mob, now: number, players: ReadonlyMap<string, [number, number]>, events: MobEvent[]): void {
    const leash = m.zone.leash ?? m.rules.leashTiles;
    let p = players.get(m.foe!.id);
    if (!this.keeps(m, m.foe!.id, p, now)) {
      // Gone, knocked out, out of its zone, pulled past its leash or too far away (its target range): on to the next
      // player within its aggro range, the same tick.
      if (m.taunt?.id === m.foe!.id) m.taunt = null;
      const next = this.nextFoe(m, players, now);
      if (next) {
        m.foe = { id: next, at: now };
        p = players.get(next);
      } else if (m.field) {
        // A field boss with nobody in its arena: its director resets it.
        return this.endFight(m);
      } else p = undefined;
    }
    const foe = m.foe!;
    // (A passive one gets bored GIVE_UP_MS after the last hit on it by anyone: a tank holding it needn't keep hitting.)
    const bored = m.zone.aggro !== 'aggressive' && now - (m.fightAt ?? foe.at) > GIVE_UP_MS;
    if (!p || bored) {
      // Nobody left to fight, or done with it: home, hurt as it is (owner, 26 Oct 2026: it never heals back up; its
      // damage tally and a Monobloc's lost chairs stay with its HP until it dies).
      this.endFight(m);
      if (m.kind.ambush) m.hideAt = now + m.kind.ambush.hideMs;
      const [hc, hr] = m.home;
      const home = this.route(m, (c, r) => c === hc && r === hr, leash);
      if (home?.length) this.startHop(m, home, now, events);
      return;
    }
    const reach = m.rules.reach;
    if (cheb(p, [m.col, m.row]) <= reach) {
      if (m.silent) return; // (its attacks are the director's)
      if (now >= m.nextAttack) {
        m.nextAttack = now + (m.kind.attackMs ?? m.rules.attackMs);
        m.attackAt = now;
        m.facing = this.faceTo(m, p[0] - m.col, p[1] - m.row) ?? m.facing;
        if (m.kind.shell) m.openUntil = now + (m.kind.shellOpenMs ?? SHELL_OPEN_MS); // its shell drops as it swings
        // Its hit, rolled now and sent with the attack; it lands on its attack frame (the Bag's slow only if it hits).
        // (The Lurker's first from hiding harder; a Monobloc that has lost chairs weaker; the Sentinel's Weigh.)
        const K = m.kind;
        const first = m.ambushHit && K.ambush ? K.ambush.firstHit : 1;
        m.ambushHit = false;
        const chairs = K.chair ? 1 - K.chair.atkPerChair * (m.chairsLost ?? 0) : 1;
        const weigh = K.weigh ? 1 + K.weigh.perHp * Math.max(0, Math.min(1, this.guards.get(foe.id)?.hpShare ?? 1)) : 1;
        const rolled = this.rollOn(foe.id, m.stats, first * chairs * weigh, this.debuffOf(m, now));
        const hit = rolled && !rolled.miss ? { ...rolled, ...(K.weigh ? { mult: Math.round(weigh * 100) / 100 } : {}), ...(K.tear ? { tear: K.tear.ms } : {}) } : rolled;
        const slow = K.slowMs && !hit?.miss ? K.slowMs : undefined;
        let land = now + (K.hitMs ?? 0);
        let to: [number, number] | undefined;
        if (K.chair) {
          // A chair thrown at where they stand now: its flight (px on screen at its speed) after the attack frame.
          to = [p[0], p[1]];
          const [dc, dr] = [p[0] - m.col, p[1] - m.row];
          land += Math.round((Math.hypot((dc - dr) * 16, (dc + dr) * 8) / K.chair.speed) * 1000);
        }
        events.push({ t: 'mob-attack', id: m.id, target: foe.id, dir: m.facing, ...(slow ? { slow } : {}), ...(hit ? { hit } : {}), ...(to ? { to } : {}) });
        if (hit) this.landings.push({ at: land, player: foe.id, by: m.id, ...hit, ...(slow ? { slow } : {}), ...(K.tear && !hit.miss ? { tear: K.tear.ms, tearAccuracy: K.tear.accuracy } : {}), ...(to && K.chair ? { tile: to, within: K.chair.hitTiles } : {}) });
        if (K.rice) {
          // Spilled rice on their tile as the slam lands.
          const from = now + (K.hitMs ?? 0);
          this.patches.push({ at: [p[0], p[1]], from, until: from + K.rice.ms, slow: K.rice.slow });
          events.push({ t: 'mob-fx', fx: 'rice', at: [p[0], p[1]], in: K.hitMs ?? 0, ms: K.rice.ms, slow: K.rice.slow });
        }
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
      for (const f of [m.facing, ({ se: 'nw', nw: 'se', sw: 'ne', ne: 'sw', s: 'n', n: 's', e: 'w', w: 'e' } as const)[m.facing]]) {
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
  attack(player: string, from: [number, number], who: Attacker | string | null | undefined, id: string, now: number, skill = 0, name = player, member = player, opts: { held?: number; mp?: number } = {}): AttackResult {
    const a: Attacker = who && typeof who === 'object' ? who : { cls: who };
    const cls = a.cls;
    const skills = (cls && (this.levels[cls]?.length ?? this.shapes.shapes[cls]?.length)) || 1;
    if (skill < 0 || skill >= skills) return { ok: false, reason: 'skill' };
    const unlock = (cls && this.levels[cls]?.[skill]) || 1;
    if ((a.level ?? 1) < unlock) return { ok: false, reason: 'locked' };
    const boss = this.golem?.id === id ? this.golem : null;
    const m = boss ? null : this.byId.get(id);
    if (boss ? !boss.hittable : !m || m.respawnAt || m.untargetable) return { ok: false, reason: 'gone' };
    const ready = `${player}:${skill}`;
    if (now < (this.swings.get(player) ?? 0) || now < (this.swings.get(ready) ?? 0)) return { ok: false, reason: 'slow' };
    const [mc, mr] = boss ? boss.at(now) : this.at(m!, now);
    const reach = (cls && this.shapes.range?.[cls]?.[skill]) || (cls && RANGED_CLASSES.has(cls) ? RANGED : 1);
    // (A tile of slack: the mob may be mid-hop.)
    const far = boss ? boss.edge(from, now) : m!.radius ? Math.max(0, Math.hypot(from[0] - mc, from[1] - mr) - m!.radius) : Math.max(Math.abs(from[0] - mc), Math.abs(from[1] - mr));
    if (far > reach + 1) return { ok: false, reason: 'range' };
    // A field boss is only hit from its fight (its arena: no sniping from outside where it can't answer).
    if (m?.field && !this.inRect(m.zone, ...from)) return { ok: false, reason: 'range' };
    // The golem is only hit from its fight: the pit floor and way in (no sniping over the ring it can't answer).
    if (boss && !boss.inFight(from)) return { ok: false, reason: 'range' };
    const effects = skillEffects(cls ? this.shapes.effects?.[cls]?.[skill] : null);
    // A leap: the free tile next to the target it lands on (none: out of reach, nothing spent).
    const L = effectOf(effects, 'leap');
    const leap = L ? this.landing(from, [Math.round(mc), Math.round(mr)], L.tiles, boss ? boss.radius : (m!.radius ?? 0)) : undefined;
    if (L && !leap) return { ok: false, reason: 'range' };
    const at0: [number, number] = leap ?? from;
    // Another skill stops their channel under way (CONTEXT.md Channel).
    this.stopCasts(player);
    this.swings.set(player, now + SWING_MS);
    const skillLevel = a.skills?.[skill] ?? 1;
    const bonus = skillLevelBonus(this.fightData.stats, skillLevel);
    const by = { ...this.fighter(a), blinded: a.blinded };
    // (crit:F: that much more crit rate on this skill, held to the cap.)
    const C = effectOf(effects, 'crit');
    if (C) by.critRate = capped(this.fightData.stats, 'critRate', (by.critRate ?? 0) + C.add);
    // (Calm Mind: its share off.) (A little slack: the game's clock and the message's trip.)
    this.swings.set(ready, now + skillCooldown(this.fightData.stats, baseCooldown(this.fightData.stats, unlock), skillLevel) * (1 - (by.cooldownPct ?? 0)) * 1000 - 150);
    // Its slow, root, stun and taunt on each mob it hits, 5% longer a skill level.
    const onHit = effects.filter((e) => e.kind === 'slow' || e.kind === 'root' || e.kind === 'stun' || e.kind === 'taunt').map((e) => ({ ...e, ms: Math.round((e as { ms: number }).ms * bonus.buff) }) as SkillEffect);
    // Its damage (a charge-up: by how long the key was held; nothing sent counts as full, a tap on a touch screen).
    const charge = effectOf(effects, 'charge');
    const pct = skillPct(this.fightData.stats, skillTier(skill), skillLevel) * (charge ? chargeMult(charge, opts.held ?? charge.ms) : 1);
    const H = skillHits(cls ? this.shapes.hits?.[cls]?.[skill] : null);
    const each = H ? pct / H.count : pct;
    const shape = (cls && this.shapes.shapes[cls]?.[skill]) || 'single';
    const cast: Cast = { player, name, member, by: { ...by }, pct: each, skill, shape, reach, target: id, from: at0, left: 0, next: now, every: H?.every ?? 0, mode: H?.mode ?? null, effects: onHit, skillLevel };
    // A windup: it all lands `ms` later (its MP then); moving first cancels it, cooldown and all.
    const W = effectOf(effects, 'windup');
    if (W) {
      this.casts.push({ ...cast, left: 1, next: now + W.ms, every: W.ms, mode: 'windup', ...(opts.mp ? { mp: opts.mp } : {}), ready });
      return { ok: true, hits: [], kills: [], windup: W.ms };
    }
    const kills: MobKill[] = [];
    // A burning puddle where it lands (its ticks: burnTick), on the target's tile.
    const burn = effectOf(effects, 'burn');
    if (burn) this.burns.push({ at: [Math.round(mc), Math.round(mr)], player, name, member, by: { ...by }, pct: pct * burn.share, radius: burn.radius, left: burn.ticks, next: now + burn.first, every: burn.every });
    const target = m ?? 'golem';
    const seek = effectOf(effects, 'seek');
    const hits = seek ? this.seekHits(cast, target, at0, seek, now, kills) : this.landOn(cast, target, [mc, mr], at0, now, kills);
    // Damage over time on each mob it hit (and lived), wherever it goes.
    const D = effectOf(effects, 'dot');
    if (D) for (const h of hits) if (!h.dead && !h.miss && !h.blocked && h.id !== this.golem?.id) this.dots.push({ mob: h.id, player, name, member, by: { ...by }, pct: pct * D.share, left: D.ticks, next: now + D.every, every: D.every });
    // Its later hits (a channel, or on the move).
    if (H) this.casts.push({ ...cast, left: H.count - 1, next: now + H.every });
    const heal = effectOf(effects, 'heal');
    return {
      ok: true, hits, kills,
      ...(heal ? { heal: heal.factor * bonus.damage } : {}),
      ...(leap && (leap[0] !== from[0] || leap[1] !== from[1]) ? { leap } : {}),
      ...(H ? { more: { left: H.count - 1, every: H.every, mode: H.mode } } : {}),
    };
  }

  /** One hit of a skill on what its shape reaches round `target` (at `at`, from `from`): each hit rolled, its slow, root,
   *  stun and taunt on each it lands on (how much a boss takes: shared crowdShare). */
  private landOn(c: Cast, target: Mob | 'golem', at: [number, number], from: [number, number], now: number, kills: MobKill[]): MobHit[] {
    return this.reached(target, at, from, c.shape, now, c.reach).map((x) => {
      if (x === 'golem') {
        const hit = this.hitGolem(c.player, c.name, c.member, c.by, c.pct, now, kills); // (no slowing or stunning it)
        const T = effectOf(c.effects, 'taunt');
        if (T && !hit.miss && !hit.dead) this.golem!.taunt(c.player, now + T.ms);
        return hit;
      }
      const hit = this.damage(x, c.player, c.by, c.pct, now, c.member, from);
      if (hit.dead) kills.push(this.killOf(x, c.member));
      if (!hit.dead && !hit.blocked && !hit.miss) this.afflict(x, c.player, c.effects, now, hit);
      return hit;
    });
  }

  /** A skill's slow, root, stun and taunt on a mob it hit: a mini boss half of a slow, root or stun, a field or last
   *  boss none (a taunt: every mob). */
  private afflict(x: Mob, player: string, effects: SkillEffect[], now: number, hit: MobHit): void {
    const share = crowdShare({ mini: !!x.mini || x.boss === 'mini', field: !!x.field, last: x.boss === 'last' });
    for (const e of effects) {
      if ((e.kind === 'slow' || e.kind === 'root') && share > 0) {
        const factor = e.kind === 'slow' ? e.factor : 0;
        const ms = Math.round(e.ms * share);
        x.slow = { factor, until: now + ms };
        hit.slow = { factor, ms };
      } else if (e.kind === 'stun' && share > 0) {
        const ms = Math.round(e.ms * share);
        const [c, r] = this.at(x, now);
        Object.assign(x, { col: c, row: r, path: [], stunUntil: now + ms, nextAttack: Math.max(x.nextAttack, now + ms) });
        this.pending.push({ t: 'mob-stun', id: x.id, ms, col: c, row: r });
      } else if (e.kind === 'taunt') {
        // (The latest taunt wins; once it's over the taunter stays its target.)
        x.taunt = { id: player, until: now + e.ms };
        x.foe = { id: player, at: now };
        x.fightAt = now;
        this.pending.push({ t: 'mob-debuff', id: x.id, name: 'taunt', ms: e.ms });
      }
    }
  }

  /** seek:N:R: N projectiles of 1/N of the hit: one at the target, the rest at the nearest other mobs within R tiles of
   *  the caster, the spare ones at the target again (one mob alone takes it all). */
  private seekHits(c: Cast, target: Mob | 'golem', from: [number, number], seek: { count: number; radius: number }, now: number, kills: MobKill[]): MobHit[] {
    const each = { ...c, pct: c.pct / seek.count };
    const others = this.mobs
      .filter((x) => x !== target && !x.respawnAt && !x.untargetable && cheb(this.at(x, now), from) <= seek.radius)
      .sort((a, b) => cheb(this.at(a, now), from) - cheb(this.at(b, now), from))
      .slice(0, seek.count - 1);
    const at = (t: Mob | 'golem'): [number, number] => (t === 'golem' ? this.golem!.at(now) : this.at(t, now));
    const out: MobHit[] = [];
    for (const t of [target, ...others, ...Array(seek.count - 1 - others.length).fill(target)] as (Mob | 'golem')[]) {
      if (t !== 'golem' && (t.respawnAt || t.hp <= 0)) continue; // (an earlier pebble felled it)
      out.push(...this.landOn({ ...each, shape: 'single' }, t, at(t), from, now, kills));
    }
    return out;
  }

  /** Where a leap lands: the free tile next to the target (its body's edge) nearest the caster, at most `tiles` from
   *  them, on the target's level, with no higher ground between (no jumping a high-terrain wall); `from` if they're
   *  next to it already; else null. */
  private landing(from: [number, number], at: [number, number], tiles: number, radius: number): [number, number] | undefined {
    const next = (t: [number, number]) => (radius ? Math.max(0, Math.hypot(t[0] - at[0], t[1] - at[1]) - radius) : cheb(t, at)) <= 1;
    if (next(from)) return from;
    const h = (c: number, r: number) => this.map.height?.[r]?.[c] ?? 0;
    const level = h(at[0], at[1]);
    const [W, H] = this.map.size;
    const span = Math.ceil(radius) + 1;
    let best: [number, number] | undefined;
    for (let r = at[1] - span; r <= at[1] + span; r++) {
      for (let c = at[0] - span; c <= at[0] + span; c++) {
        const t: [number, number] = [c, r];
        if (c < 0 || r < 0 || c >= W || r >= H || this.map.blocked[r]?.[c] || h(c, r) !== level || !next(t) || (c === at[0] && r === at[1])) continue;
        if (cheb(t, from) > tiles || this.taken({ id: '' } as Mob, c, r)) continue;
        // (No higher ground on the way: a wall it would have to jump.)
        const top = Math.max(h(from[0], from[1]), level);
        const n = Math.max(1, cheb(t, from) * 2);
        let clear = true;
        for (let k = 1; k < n && clear; k++) {
          const pc = Math.round(from[0] + ((c - from[0]) * k) / n);
          const pr = Math.round(from[1] + ((r - from[1]) * k) / n);
          if (h(pc, pr) > top) clear = false;
        }
        if (!clear) continue;
        if (!best || cheb(t, from) < cheb(best, from)) best = t;
      }
    }
    return best;
  }

  /** A skill's later hits under way (channels, hits on the move, windups) and damage over time on mobs. */
  private casts: Cast[] = [];
  private dots: { mob: string; player: string; name: string; member: string; by: Hitter & { blinded?: boolean }; pct: number; left: number; next: number; every: number }[] = [];

  /** Their channel or windup under way stops (they moved, were knocked out or cast another skill): a windup's
   *  cooldown back (it cost nothing). Whether one did. */
  stopCasts(player: string): boolean {
    let stopped = false;
    this.casts = this.casts.filter((c) => {
      if (c.player !== player || (c.mode !== 'channel' && c.mode !== 'windup')) return true;
      if (c.mode === 'windup' && c.ready) this.swings.delete(c.ready);
      stopped = true;
      return false;
    });
    return stopped;
  }

  /** Whether they're spinning (a skill's hits on the move under way: they walk at 70%). */
  onTheMove(player: string): boolean {
    return this.casts.some((c) => c.player === player && c.mode === 'move');
  }

  /** The skills' later hits and the damage over time due by `now`: each later hit on its target (gone: the nearest live
   *  mob within the skill's reach; none: the rest stop; on the move: round where they stand now), each tick on its mob
   *  (dead: it stops). A channel or windup whose caster isn't in `players` (gone, knocked out) stops. What each hit,
   *  what it killed, and windups' MP to spend now. */
  skillTick(now: number, players: ReadonlyMap<string, [number, number]>): { hits: { by: string; skill: number; hits: MobHit[] }[]; dots: { by: string; hits: MobHit[] }[]; kills: MobKill[]; spent: { member: string; mp: number }[] } {
    const hits: { by: string; skill: number; hits: MobHit[] }[] = [];
    const dots: { by: string; hits: MobHit[] }[] = [];
    const kills: MobKill[] = [];
    const spent: { member: string; mp: number }[] = [];
    for (const c of this.casts) {
      while (c.left > 0 && now >= c.next) {
        c.left--;
        c.next += c.every;
        const here = players.get(c.player);
        if (!here && c.mode !== null) {
          c.left = 0;
          break;
        }
        const from: [number, number] = c.mode === 'move' && here ? [here[0], here[1]] : c.from;
        c.from = from;
        const t = this.castTarget(c, from, now);
        if (!t) {
          c.left = 0;
          break;
        }
        const at = t === 'golem' ? this.golem!.at(now) : this.at(t, now);
        if (c.mode === 'windup' && c.mp) spent.push({ member: c.member, mp: c.mp });
        hits.push({ by: c.player, skill: c.skill, hits: this.landOn(c, t, at, from, now, kills) });
      }
    }
    this.casts = this.casts.filter((c) => c.left > 0);
    for (const d of this.dots) {
      while (d.left > 0 && now >= d.next) {
        d.left--;
        d.next += d.every;
        const m = this.byId.get(d.mob);
        if (!m || m.respawnAt || m.hp <= 0) {
          d.left = 0;
          break;
        }
        const hit = this.damage(m, d.player, d.by, d.pct, now, d.member);
        if (hit.dead) kills.push(this.killOf(m, d.member));
        dots.push({ by: d.player, hits: [hit] });
      }
    }
    this.dots = this.dots.filter((d) => d.left > 0);
    return { hits, dots, kills, spent };
  }

  /** A later hit's mob: its target while it lives (on the move: the nearest within its radius of the caster), else the
   *  nearest live mob within the skill's reach of them. */
  private castTarget(c: Cast, from: [number, number], now: number): Mob | 'golem' | null {
    const { kind, radius } = shapeParts(c.shape);
    const within = c.mode === 'move' && kind === 'around' ? radius : c.reach;
    const live = (x: Mob) => !x.respawnAt && !x.untargetable && x.hp > 0;
    if (c.target === this.golem?.id) return this.golem.hittable && this.golem.edge(from, now) <= within + 1 ? 'golem' : null;
    const t = this.byId.get(c.target);
    if (t && live(t) && (c.mode !== 'move' || cheb(this.at(t, now), from) <= within)) return t;
    const near = this.mobs.filter((x) => live(x) && cheb(this.at(x, now), from) <= within).sort((a, b) => cheb(this.at(a, now), from) - cheb(this.at(b, now), from))[0];
    if (near) c.target = near.id;
    return near ?? null;
  }

  /** A debuff on a mob (CONTEXT.md Debuff; stats.json skills.buffs with `debuff`): on `target` (the caster's mob target,
   *  alive) if it's within `range` of the caster, and on nothing when it isn't (never the nearest in its place: 28 Oct
   *  2026, a Slingshot's Armor Crack landed on a nearer mob than the one targeted; the page walks you into range first);
   *  with no target (or one gone), the nearest mob within range; `tauntAround` (Iron Kitchen): every mob within that
   *  many tiles of the caster, no target needed. One of each name a mob, whoever cast it (again: its timer restarts). Its
   *  taunt (seconds) makes it fight the caster; its slow works on every mob (unlike a skill's). The ids it went on; none:
   *  nobody in range (`targetFar` says whether that was the target standing too far). `dry`: who it would go on, nothing
   *  put on. */
  debuff(caster: string, from: [number, number], name: string, stats: Record<string, number>, ms: number, target: string | null, range: number, now: number, dry = false): string[] {
    const { tauntAround, ...rest } = stats;
    const live = (x: Mob) => !x.respawnAt && !x.untargetable && x.hp > 0;
    const dist = (x: Mob) => (x.radius ? Math.max(0, Math.hypot(this.at(x, now)[0] - from[0], this.at(x, now)[1] - from[1]) - x.radius) : cheb(this.at(x, now), from));
    let on: (Mob | 'golem')[];
    if (tauntAround) {
      on = this.mobs.filter((x) => live(x) && dist(x) <= tauntAround);
      if (this.golem?.hittable && this.golem.edge(from, now) <= tauntAround) on.push('golem');
    } else {
      const golemOk = !!this.golem?.hittable && this.golem.edge(from, now) <= range;
      const mob = target && target !== this.golem?.id ? this.byId.get(target) : undefined;
      const targeted: Mob | 'golem' | null = target === this.golem?.id ? (this.golem?.hittable ? 'golem' : null) : mob && live(mob) ? mob : null;
      let one: Mob | 'golem' | null;
      if (targeted) one = (targeted === 'golem' ? golemOk : dist(targeted) <= range) ? targeted : null; // (their target, or nothing)
      else one = this.mobs.filter((x) => live(x) && dist(x) <= range).sort((a, b) => dist(a) - dist(b))[0] ?? (golemOk ? 'golem' : null);
      on = one ? [one] : [];
    }
    if (dry) return on.map((x) => (x === 'golem' ? this.golem!.id : x.id)); // (who it would go on)
    for (const x of on) {
      const d: MobDebuff = { stats: rest, until: now + ms, by: caster };
      const tauntMs = (rest.taunt ?? 0) * 1000;
      if (x === 'golem') {
        this.golemDebuffs.set(name, d);
        if (tauntMs) this.golem!.taunt(caster, now + tauntMs);
        this.pending.push({ t: 'mob-debuff', id: this.golem!.id, name, ms });
        continue;
      }
      (x.debuffs ??= new Map()).set(name, d);
      if (tauntMs) {
        x.taunt = { id: caster, until: now + tauntMs };
        x.foe = { id: caster, at: now };
        x.fightAt = now;
      }
      if (rest.slow) x.slow = { factor: rest.slow, until: now + ms }; // (Hamstring: on every mob)
      this.pending.push({ t: 'mob-debuff', id: x.id, name, ms });
    }
    return on.map((x) => (x === 'golem' ? this.golem!.id : x.id));
  }

  /** Dev (the dev server's GM tools): every live mob within `radius` of `from` down at once (never the golem or a field
   *  boss), as a hit that takes all its HP: its XP, loot and quest credit for `member` (town.ts `killed`). The hits for
   *  the room, and the kills. */
  devSlay(player: string, member: string, from: [number, number], radius: number, now: number): { hits: MobHit[]; kills: MobKill[] } {
    const hits: MobHit[] = [];
    const kills: MobKill[] = [];
    for (const m of this.mobs) {
      if (m.respawnAt || m.hp <= 0 || m.field || cheb(this.at(m, now), from) > radius) continue;
      const damage = m.hp;
      if (m.dealt) m.dealt.set(member, (m.dealt.get(member) ?? 0) + damage);
      [m.col, m.row] = this.at(m, now);
      m.hp = 0;
      m.respawnAt = m.add || m.zone.dungeon ? Infinity : now + (m.mini && this.minis ? this.minis.respawnMs : m.rules.respawnMs);
      this.endFight(m);
      m.path = [];
      hits.push({ id: m.id, damage, crit: false, hp: 0, dead: true });
      kills.push(this.killOf(m, member));
    }
    return { hits, kills };
  }

  /** A mob that just died, as a kill: its XP for its killer (a mini boss: everyone who did their share). */
  private killOf(x: Mob, member: string): MobKill {
    if (x.field) {
      // A field boss: its XP (and loot) for everyone who did its share (the mob table's xpTo), the tally kept for the
      // kill (who hit it, how much).
      const dealt = new Map(x.dealt ?? []);
      x.dealt?.clear();
      return { id: x.id, kind: x.kindId ?? x.zone.mob, at: [x.col, x.row], level: x.stats.level, xp: x.stats.xp, to: xpEarners({ ...x.stats, hp: x.maxHp }, dealt, member), boss: true, dealt };
    }
    const to = x.mini || x.boss ? this.miniEarners(x, member) : [member];
    return {
      id: x.id, kind: x.kindId ?? x.zone.mob, at: [x.col, x.row], level: x.stats.level, xp: x.stats.xp, to,
      ...(x.mini ? { mini: x.mini.id } : {}), ...(x.boss ? { warrens: { id: x.id, boss: x.boss } } : {}),
    };
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
          if (x.respawnAt || x.untargetable || cheb(this.at(x, now), b.at) > b.radius) continue;
          const hit = this.damage(x, b.player, b.by, b.pct, now, b.member, b.at);
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

  /** One hit on a mob (the stats rules' damage, or a miss), none through a shell that's up; either way it starts its
   *  fight if it hasn't one (it and its pack go after the player: `struck`), never switching a target; at 0 it dies. */
  private damage(m: Mob, player: string, by: Hitter & { blinded?: boolean }, pct: number, now: number, member = player, from?: [number, number]): MobHit {
    const [mc, mr] = this.at(m, now);
    this.struck(m, player, now);
    if (this.opts.director?.hit) this.pending.push(...this.opts.director.hit(m.id, by.level, now));
    if (m.blockAll || (m.kind.shell && now >= m.openUntil)) return { id: m.id, damage: 0, crit: false, hp: m.hp, dead: false, blocked: true };
    // A director's front block (its shell, in place of its kind's): its share off a hit from its front (all of it:
    // blocked), nothing while it's open.
    const shell = m.frontBlock ? (now >= m.frontBlock.openUntil && !!from && this.fromFront(m, [mc, mr], from, now) ? m.frontBlock.share : 0) : null;
    if (shell !== null && shell >= 1) return { id: m.id, damage: 0, crit: false, hp: m.hp, dead: false, blocked: true };
    // (Its debuffs: Armor Crack and Provoke take DEF off; Marked makes every hit on it harder.)
    const D = this.debuffOf(m, now);
    const on = D.defPct ? { ...m.stats, def: m.stats.def * Math.max(0, 1 + D.defPct) } : m.stats;
    const roll0 = by.blinded ? MISSED : rollHit(this.fightData.stats, by, on, pct, this.random);
    const rolled = D.damageTakenPct && !roll0.miss ? { ...roll0, damage: Math.max(1, Math.round(roll0.damage * (1 + D.damageTakenPct))) } : roll0;
    const { crit, miss } = rolled;
    if (miss) return { id: m.id, damage: 0, crit: false, hp: m.hp, dead: false, miss };
    // A front block (the Chomper always, the Payong while it opens): its share off a hit from the quarter it faces.
    const B = m.kind.block;
    const reduced = shell !== null ? shell > 0 : !!B && !!from && (!B.frames || (m.attackAt !== undefined && now - m.attackAt <= (m.kind.openMs ?? 0))) && this.fromFront(m, [mc, mr], from, now);
    const damage = reduced ? Math.max(1, Math.round(rolled.damage * (shell !== null ? 1 - shell : B!.share))) : rolled.damage;
    if (m.dealt) m.dealt.set(member, (m.dealt.get(member) ?? 0) + Math.min(damage, m.hp));
    m.hp = Math.max(0, m.hp - damage);
    if (m.hp === 0) {
      [m.col, m.row] = [mc, mr];
      m.respawnAt = m.add || m.zone.dungeon || m.field ? Infinity : now + (m.mini && this.minis ? this.minis.respawnMs : m.rules.respawnMs);
      this.endFight(m);
      m.path = [];
    }
    if (this.opts.director && damage > 0) this.pending.push(...this.opts.director.hurt(m.id, now));
    // A Monobloc Stack losing chairs as its HP falls (each loseAt share passed): weaker, and a flash for the room.
    const C = m.kind.chair;
    if (C && m.hp > 0) {
      const lost = C.loseAt.filter((t) => m.hp <= m.maxHp * t).length;
      if (lost > (m.chairsLost ?? 0)) {
        m.chairsLost = lost;
        this.pending.push({ t: 'mob-fx', fx: 'chair-lost', id: m.id });
      }
    }
    return { id: m.id, damage, crit, hp: m.hp, dead: m.hp === 0, ...(reduced ? { reduced: true } : {}) };
  }

  /** Whether `from` is in the quarter a mob faces (90 degrees round its facing, on the grid; on its own tile: yes). */
  private fromFront(m: Mob, at: [number, number], from: [number, number], now: number): boolean {
    const [fc, fr] = FACE_STEP[this.facingAt(m, now)];
    const [vc, vr] = [from[0] - at[0], from[1] - at[1]];
    const len = Math.hypot(vc, vr);
    if (len < 0.5) return true;
    return (fc * vc + fr * vr) / (Math.hypot(fc, fr) * len) >= Math.SQRT1_2 - 1e-9;
  }

  /** Who earned a mini boss that just fell: every member who did its share of its HP (miniBoss.kill_credit), the killer
   *  if nobody did; its tally starts over. */
  private miniEarners(m: Mob, killer: string): string[] {
    const share = this.minis?.creditShare ?? 0.1;
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
    const D = this.debuffOf('golem', now);
    const on = D.defPct ? { ...stats, def: stats.def * Math.max(0, 1 + D.defPct) } : stats;
    const r0 = by.blinded ? MISSED : rollHit(this.fightData.stats, by, on, pct, this.random);
    const { damage, crit, miss } = D.damageTakenPct && !r0.miss ? { ...r0, damage: Math.max(1, Math.round(r0.damage * (1 + D.damageTakenPct))) } : r0;
    const r = g.hit(player, name, damage, now, member)!;
    if (r.dead) {
      const [gc, gr] = g.at(now);
      kills.push({ id: g.id, kind: g.id, at: [Math.round(gc), Math.round(gr)], level: stats.level, xp: stats.xp, to: xpEarners({ ...stats, hp: g.maxHp }, r.dealt ?? new Map(), member), boss: true, ...(r.dealt ? { dealt: r.dealt } : {}) });
    }
    return { id: g.id, damage, crit, hp: r.hp, dead: r.dead, ...(miss ? { miss } : {}) };
  }

  /** The mobs a skill's shape reaches (the golem too, by its body's edge): the target first (see skill-hits.json). */
  private reached(target: Mob | 'golem', at: [number, number], from: [number, number], shape: string, now: number, range = RANGED): (Mob | 'golem')[] {
    const { kind, count: most, radius: R } = shapeParts(shape);
    const out: (Mob | 'golem')[] = [target];
    if (most < 2) return out;
    // Each other one alive, where it is and its body's radius (0 but the golem's).
    const live: { m: Mob | 'golem'; at: [number, number]; r: number }[] = this.mobs.filter((x) => !x.respawnAt && !x.untargetable && x !== target).map((x) => ({ m: x, at: this.at(x, now), r: x.radius ?? 0 }));
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
      // (Within R of the target: 2 when the shape doesn't say.)
      out.push(...live.filter((x) => dist(x, at) <= R).sort((a, b) => dist(a, at) - dist(b, at)).slice(0, most - 1).map((x) => x.m));
    } else if (kind === 'around') {
      out.push(...live.filter((x) => dist(x, from) <= R).sort((a, b) => dist(a, from) - dist(b, from)).slice(0, most - 1).map((x) => x.m));
    } else if (kind === 'line') {
      // Along the line from the caster through the target, out to the skill's range (the golem's body widens it).
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
        .filter((x) => x.along > -x.r && x.along <= range + x.r && x.off <= 0.8 + x.r)
        .sort((a, b) => a.along - b.along);
      out.push(...on.slice(0, most - 1).map((x) => x.m));
    }
    return out;
  }

  /** A player left the room: nothing still on its way lands on them, and the golem lets them go (a mob after them does on
   *  its next tick, which they're not in: on to its next target). `keepSwings`: their cooldowns stay (knocked out:
   *  they're still here). */
  forget(player: string, keepSwings = false): void {
    if (!keepSwings) for (const k of [...this.swings.keys()]) if (k === player || k.startsWith(`${player}:`)) this.swings.delete(k);
    this.landings = this.landings.filter((l) => l.player !== player);
    this.casts = this.casts.filter((c) => c.player !== player);
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
      ...(m.kindId ? { kind: m.kindId } : {}),
      ...(m.boss ? { boss: m.boss } : {}),
      ...(m.name ? { name: m.name } : {}),
      ...(m.title ? { title: m.title } : {}),
      ...(m.scale ? { scale: m.scale } : {}),
      ...(m.radius ? { radius: m.radius } : {}),
      ...(m.untargetable ? { untargetable: true } : {}),
      ...(m.blockAll ? { blockAll: true } : {}),
      ...(m.hidden ? { hidden: true } : {}),
      ...(m.field ? { field: true } : {}),
      ...(m.dormant ? { dormant: true } : {}),
    };
  }

  /** Every mob as a newcomer should see it (Adds that died are gone for good: left out). */
  snapshot(now: number): TownMob[] {
    return this.mobs.filter((m) => !((m.add || m.zone.dungeon) && m.respawnAt)).map((m) => this.view(m, now));
  }

  /** The golem as a newcomer should see it (null: not up, or no golem here). */
  golemState(now: number): TownGolem | null {
    return this.golem?.state(now) ?? null;
  }

  /** What happened outside the clock (a hit that called the Junk, enraged the golem or brought it down): send it now. */
  flush(): MobEvent[] {
    const out: MobEvent[] = [...(this.golem?.flush() ?? []), ...this.pending];
    this.pending = [];
    return out;
  }

  /** What the director set off outside the clock (a hit's thresholds), sent with the next flush. */
  private pending: MobEvent[] = [];

  // ── The director's hands (a Warrens run, town-warrens.ts) ──

  /** A mob's level (the golem's too), or null: no such mob. (A hit on it gives the hitter's pet that much Pet XP.) */
  levelOf(id: string): number | null {
    if (this.golem?.id === id) return this.golem.level;
    return this.byId.get(id)?.level ?? null;
  }

  /** The stats rules' data (the mob table and its formula: an event's director works its mobs' numbers out from them). */
  statsData() {
    return this.fightData.stats;
  }

  /** When a kind's attack lands after it starts (ms: mobs.json attackFrame at its art's fps), if it has one. */
  kindHitMs(kind: string): number | undefined {
    return this.kinds[kind]?.hitMs;
  }

  /** A mob as the director sees it (where it is now, its HP, its foe), or null. */
  mobInfo(id: string, now: number): { id: string; at: [number, number]; hp: number; maxHp: number; dead: boolean; foe: string | null; facing: TownMobFacing; zone: string; kind: string } | null {
    const m = this.byId.get(id);
    if (!m) return null;
    return { id, at: this.at(m, now), hp: m.hp, maxHp: m.maxHp, dead: !!m.respawnAt, foe: m.foe?.id ?? null, facing: m.facing, zone: m.zone.id, kind: m.kindId ?? m.zone.mob };
  }

  /** Whether a debuff's target (a mob id, the golem's too) is alive and targetable now: a refusal's reason is 'range'
   *  for one standing too far, 'target' when there's nothing to put it on. */
  targetFar(target: string | null, now: number): boolean {
    if (!target) return false;
    if (target === this.golem?.id) return !!this.golem?.hittable;
    const m = this.byId.get(target);
    return !!m && !m.respawnAt && !m.untargetable && m.hp > 0 && this.at(m, now).length === 2;
  }

  /** Every mob a boss called (by its tag), alive or not. */
  calledBy(tag: string): string[] {
    return this.mobs.filter((m) => m.calledBy === tag).map((m) => m.id);
  }

  /** Adds mobs (a boss, its guards, the mobs it calls) to their zone: each its own numbers and traits; aggressive like
   *  the zone. Returns the `mob-add` to send. */
  addMobs(specs: MobSpec[], now: number): MobEvent[] {
    const made: Mob[] = [];
    for (const s of specs) {
      const zone = this.zones.find((z) => z.id === s.zone);
      if (!zone || this.byId.has(s.id)) continue;
      const kind = { ...(this.kinds[s.kind] ?? {}), pack: undefined };
      const [m] = this.place(zone, kind, s.id, s.tile, !!s.calledBy, s.stats);
      Object.assign(m, {
        stats: { ...m.stats, ...s.stats }, level: s.stats.level, maxHp: s.stats.hp, hp: s.stats.hp, baseHp: s.stats.hp, kindId: s.kind,
        rules: { ...m.rules, ...(s.kind === zone.mob ? {} : mobRules(this.fightData.stats, s.kind)), aggressive: true, packAssist: false },
        ...(s.boss ? { boss: s.boss, dealt: new Map() } : {}), ...(s.name ? { name: s.name } : {}), ...(s.title ? { title: s.title } : {}),
        ...(s.scale ? { scale: s.scale } : {}), ...(s.radius ? { radius: s.radius } : {}), ...(s.still ? { still: true } : {}),
        ...(s.silent ? { silent: true } : {}), ...(s.calledBy ? { calledBy: s.calledBy } : {}), restUntil: now,
        ...(s.dormant ? { dormant: true, still: true, untargetable: true } : {}),
      });
      // A field boss: its damage tallied by member (its XP's share), and it stands off by its body's edge.
      if (s.field) Object.assign(m, { field: true, dealt: new Map(), rules: { ...m.rules, reach: (s.radius ?? 0) + 1 } });
      made.push(m);
    }
    return made.length ? [{ t: 'mob-add', mobs: made.map((m) => this.view(m, now)) }] : [];
  }

  /** Takes mobs away (a boss's called mobs when it resets or falls). */
  removeMobs(ids: string[]): MobEvent[] {
    const gone = new Set(ids.filter((id) => this.byId.has(id)));
    if (!gone.size) return [];
    for (const id of gone) this.byId.delete(id);
    this.mobs.splice(0, this.mobs.length, ...this.mobs.filter((m) => !gone.has(m.id)));
    this.claimed = null;
    return [{ t: 'mob-remove', ids: [...gone] }];
  }

  /** A boss's windows: can't be targeted or hit, every hit blocked. */
  setFlags(id: string, flags: { untargetable?: boolean; blockAll?: boolean; dormant?: boolean; hidden?: boolean }): MobEvent[] {
    const m = this.byId.get(id);
    if (!m) return [];
    // Under the ice (Frosty Tubbs' Ambush): not drawn and not to be targeted, as a Lurker lies in wait.
    if (flags.hidden !== undefined) {
      Object.assign(m, { hidden: flags.hidden || undefined, untargetable: flags.hidden || undefined });
      if (flags.hidden) m.foe = null;
      return [{ t: 'mob-flag', id, hidden: !!m.hidden, untargetable: !!m.untargetable }];
    }
    // Asleep (a field boss between fights): still and not to be targeted; awake: neither.
    if (flags.dormant !== undefined) Object.assign(m, { dormant: flags.dormant || undefined, still: flags.dormant || undefined, untargetable: flags.dormant || undefined });
    if (flags.untargetable !== undefined) m.untargetable = flags.untargetable || undefined;
    if (flags.blockAll !== undefined) m.blockAll = flags.blockAll || undefined;
    if (m.untargetable) {
      m.foe = null;
      this.forgetMob(m.id);
    }
    return [{ t: 'mob-flag', id, untargetable: !!m.untargetable, blockAll: !!m.blockAll, ...(flags.dormant !== undefined ? { dormant: !!m.dormant } : {}) }];
  }

  /** Nobody's after it any more (it can't be hit for now). */
  private forgetMob(_id: string): void {
    // (Players target mobs, not the other way round: nothing to undo here; the game drops its target.)
  }

  /** Dev (the dev town's /__warrens &hp=): a mob down to `hp` at most, so one hit fells it. */
  devWound(id: string, hp: number): void {
    const m = this.byId.get(id);
    if (m && !m.respawnAt) m.hp = Math.max(1, Math.min(m.maxHp, Math.round(hp)));
  }

  /** Full HP again, its fight over, its damage tally cleared (a boss resetting). */
  healFull(id: string): MobEvent[] {
    const m = this.byId.get(id);
    if (!m || m.respawnAt) return [];
    m.hp = m.maxHp;
    this.endFight(m);
    m.dealt?.clear();
    return [{ t: 'mob-heal', id, hp: m.hp }];
  }

  /** New numbers for a living mob (a Halloween event mob growing with its hitters, or back to its own): its level, ATK,
   *  DEF and most HP, its HP keeping its share. The `mob-scale` to send (empty if nothing changed). */
  restat(id: string, stats: { level: number; hp: number; atk: number; def: number }): MobEvent[] {
    const m = this.byId.get(id);
    if (!m || m.respawnAt) return [];
    if (m.level === stats.level && m.maxHp === stats.hp && m.stats.atk === stats.atk && m.stats.def === stats.def) return [];
    const share = m.hp / m.maxHp;
    m.stats = { ...m.stats, level: stats.level, hp: stats.hp, atk: stats.atk, def: stats.def };
    m.level = stats.level;
    m.maxHp = stats.hp;
    m.baseHp = stats.hp;
    m.hp = Math.max(1, Math.round(share * stats.hp));
    return [{ t: 'mob-scale', mobs: [{ id, hp: m.hp, maxHp: m.maxHp, level: m.level }] }];
  }

  /** Moves a mob along `path` at `speed` tiles a second now (Tire Ranny's Burnout Charge), or puts it on a tile at once
   *  (`jump`: Bag Yani coming back). */
  moveMob(id: string, path: [number, number][], now: number, speed = SPEED, jump = false): MobEvent[] {
    const m = this.byId.get(id);
    if (!m || m.respawnAt || !path.length) return [];
    if (jump) {
      [m.col, m.row] = path[path.length - 1];
      m.path = [];
      m.restUntil = now + 600;
      return [{ t: 'mob-spawn', id, col: m.col, row: m.row, hp: m.hp }];
    }
    const [c0, r0] = this.at(m, now);
    [m.col, m.row] = [c0, r0];
    m.path = path;
    m.hopAt = now;
    m.hopSpeed = speed;
    return [{ t: 'mob-move', id, path: [[c0, r0], ...path], speed }];
  }

  /** Spilled rice on a tile (a director's: Sakristan's Rice Rain) from `from` until `until` (ms): walking there at `slow`
   *  of the speed. The `mob-fx` to send. */
  spill(at: [number, number], from: number, until: number, slow: number, now: number): MobEvent {
    this.patches.push({ at, from, until, slow });
    return { t: 'mob-fx', fx: 'rice', at, in: Math.max(0, from - now), ms: until - from, slow };
  }

  /** A front block on a mob (a director's: its shell), `share` of a hit from its front taken off; `open` until then. */
  frontBlock(id: string, share: number, openUntil = 0): void {
    const m = this.byId.get(id);
    if (m) m.frontBlock = { share, openUntil };
  }

  /** A boss walks back to its own tile (a field boss resetting), at its pace. */
  walkHome(id: string, now: number): MobEvent[] {
    const m = this.byId.get(id);
    if (!m || m.respawnAt) return [];
    const [hc, hr] = m.home;
    [m.col, m.row] = this.at(m, now);
    m.path = [];
    if (m.col === hc && m.row === hr) return [];
    const way = this.route(m, (c, r) => c === hc && r === hr, 10_000);
    const events: MobEvent[] = [];
    if (way?.length) this.startHop(m, way, now, events);
    return events;
  }

  /** A mob turns to face `dir` where it stands (a boss aiming a move). */
  face(id: string, dir: TownMobFacing): MobEvent[] {
    const m = this.byId.get(id);
    if (!m || m.respawnAt || m.facing === dir) return [];
    m.facing = dir;
    return [{ t: 'mob-face', id, dir }];
  }

  /** A boss starts a move: it stops where it is now (a hop under way cut short) and holds still until `until` (when the
   *  move lands), neither walking nor swinging meanwhile. */
  hold(id: string, until: number, now: number): MobEvent[] {
    const m = this.byId.get(id);
    if (!m || m.respawnAt) return [];
    m.castUntil = until;
    if (!m.path.length) return [];
    [m.col, m.row] = this.at(m, now);
    m.path = [];
    return [{ t: 'mob-move', id, path: [[m.col, m.row]], speed: m.hopSpeed }];
  }

  /** A mob's hit on a player (its ATK × `mult` against their DEF and level), or null (no HP known: harmless). */
  rollFor(player: string, id: string, mult = 1): PlayerHit | null {
    const m = this.byId.get(id);
    return m ? this.rollOn(player, m.stats, mult) : null;
  }

  /** Lands a hit on a player at `at` (ms) with a slow or a stun (ms) on a hit. */
  land(player: string, by: string, hit: PlayerHit, at: number, extra: { slow?: number; slowFactor?: number; stun?: number; hold?: number; hpPct?: number; strip?: boolean } = {}): void {
    this.landings.push({ at, player, by, ...hit, ...(hit.miss ? {} : extra) });
  }

  /** Whether a tile is open floor (not blocked) on the map: where a boss may stand or a called mob appear. */
  open(col: number, row: number): boolean {
    const [cols, rows] = this.map.size;
    return col >= 0 && row >= 0 && col < cols && row < rows && !this.map.blocked[row]?.[col];
  }

  /** Living mobs standing still (no hop under way) on tiles `on` passes, the director's to move (Ang Silong's belts carry
   *  them); never one that never moves (a still boss) or lies hidden. */
  standingOn(on: (col: number, row: number) => boolean, now: number): { id: string; col: number; row: number }[] {
    return this.mobs.flatMap((m) => {
      if (m.respawnAt || m.still || m.hidden) return [];
      if (m.path.length && ((now - m.hopAt) / 1000) * m.hopSpeed < m.path.length) return [];
      const [col, row] = this.at(m, now);
      return on(col, row) ? [{ id: m.id, col, row }] : [];
    });
  }

  /** Whether a living mob stands on a tile (or is headed there). */
  occupied(col: number, row: number): boolean {
    this.claimed = null;
    return this.taken({ id: '' } as Mob, col, row);
  }

  /** Party scaling (a Warrens run): every dungeon mob's most HP is its base × `mob`, a boss's × `boss`; each keeps its
   *  HP's share. The `mob-scale` to send (empty if nothing changed). */
  scaleHp(mob: number, boss: number): MobEvent[] {
    const changed: { id: string; hp: number; maxHp: number }[] = [];
    for (const m of this.mobs) {
      if (!m.baseHp) continue;
      const max = Math.round(m.baseHp * (m.boss ? boss : mob));
      if (max === m.maxHp) continue;
      const share = m.hp / m.maxHp;
      m.maxHp = max;
      if (!m.respawnAt) m.hp = Math.max(1, Math.round(share * max));
      changed.push({ id: m.id, hp: m.hp, maxHp: m.maxHp });
    }
    return changed.length ? [{ t: 'mob-scale', mobs: changed }] : [];
  }

  /** One mob's most HP to `max` (a field boss growing with the players about: the Great Scale), its HP keeping its share.
   *  The `mob-scale` to send (empty if nothing changed, or it's dead). */
  setMaxHp(id: string, max: number): MobEvent[] {
    const m = this.mobs.find((x) => x.id === id);
    max = Math.max(1, Math.round(max));
    if (!m || m.respawnAt || m.hp <= 0 || m.maxHp === max) return [];
    const share = m.hp / m.maxHp;
    m.maxHp = max;
    m.hp = Math.max(1, Math.round(share * max));
    return [{ t: 'mob-scale', mobs: [{ id: m.id, hp: m.hp, maxHp: m.maxHp }] }];
  }

  /** Dev (?minibosses=now): every mini boss that's down comes back on the next tick. How many. */
  respawnMinis(): number {
    const down = this.mobs.filter((m) => m.mini && m.respawnAt);
    for (const m of down) m.respawnAt = 1;
    return down.length;
  }

  /** The golem's name and next rise on its own (nextRise null: it's up; null: no golem here). */
  golemPlan(now: number): { name: string; nextRise: number | null; everyMinutes: number } | null {
    return this.golem?.plan(now) ?? null;
  }

  /** When the golem rises next as last kept (null: nothing kept), and where to keep it as that changes (the bot's kv). */
  golemSchedule(at: number | null, save?: (at: number | null) => void): void {
    this.golem?.setSchedule(at, save);
  }

  /** The golem rises now (dev's ?golem=now, the CMS's Spawn now; false: it's up already, or none); plays its whole
   *  fight (dev's ?golemdemo=1, `name` = who asked). */
  riseGolem(now: number): boolean {
    return this.golem?.riseNow(now) ?? false;
  }

  golemDemo(now: number, name: string): void {
    this.golem?.demo(now, name);
  }
}
