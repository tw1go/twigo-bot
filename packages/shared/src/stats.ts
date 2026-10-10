import type { AdventureState, CharacterProgress, ClassInfo, EquipmentDef, EquipPlace, EquipSlot, EquipStats } from './adventure.js';

// 📊 Character levels and stats, gear requirements, skill levels, damage and XP: pure functions over the numbers in the
// game's classes/stats.json (passed in as `data`; none of them are written here), shared by the bot (which decides every
// hit and keeps levels and points) and the game (which shows them). The rules in words: the art folder's
// data/combat-guide.md, "Stats, levels and scaling". A few of the file's numbers sit in short formula strings (a skill's
// base %, the skill level cap, MP regen, the name colours): `numbersIn` and `linear` read them out.

export type StatName = 'STR' | 'DEX' | 'INT';
export const STAT_NAMES: readonly StatName[] = ['STR', 'DEX', 'INT'];
export type StatBlock = Record<StatName, number>;
/** Stat points spent, per stat. */
export type StatPoints = Partial<Record<StatName, number>>;
/** A class's three stats in the order it grows them. */
export type StatPlace = 'main' | 'second' | 'third';

interface PerLevel {
  base: number;
  perLevel: number;
}
interface ItemReq {
  perItemLevel: number;
  plus: number;
}

/** A mob kind's row in the mob table. */
export interface MobStats {
  level: number;
  hp: number;
  atk: number;
  def: number;
  xp: number;
  /** The golem's attacks' multipliers (Tire Slam, Scrap Toss). */
  skillMult?: Record<string, number>;
  /** Who gets its XP, when not only the killer: "everyone who did at least 5% of its HP" (the golem). */
  xpTo?: string;
}

/** classes/stats.json: the parts the rules read (the file has more: gear, affixes, enhancement… for later). */
export interface StatsData {
  levelCap: number;
  classless: StatBlock;
  classes: Record<string, Record<StatPlace, StatName> & { gearType: string }>;
  growth: Record<StatPlace, PerLevel> & { pointsPerLevelUp: number; pointsGoTo: StatPlace[] };
  gearTypeStats: Record<string, StatName[]>;
  requirements: { weapon: { main: ItemReq; second: ItemReq; mainMustBeHighest: boolean }; armor: { bothGearTypeStats: ItemReq } };
  derived: {
    hp: { base: number; perLevel: number; perSTR: number };
    mp: { base: number; perLevel: number; perINT: number };
    power: { perMain: number; perSecond: number };
    def: { perSTR: number; round: string };
    critRate: { base: number; perDEX: number };
    critDamage: number;
  };
  damage: { levelGap: { perLevelAboveYou: number; missPerLevelAboveYou: number; minMult: number } };
  xp: { toNext: { mult: number; pow: number; round: boolean }; lowMobPenalty: { freeGap: number; perExtraLevel: number; minMult: number } };
  mobs: { list: Record<string, MobStats> };
  skills: {
    levelOnUnlock: number;
    skillPointsPerLevelUp: number;
    /** "min(20, characterLevel - unlockLevel + 1)" */
    levelCap: string;
    /** "100 * 1.3^(tier-1), rounded" */
    basePct: string;
    perSkillLevel: { damageOrHeal: number; buffDebuff: number; mpCost: number; cooldown: number };
    /** MP at skill Lv 1 (the art folder's stats.json): damage skills by tier per class, Dash and the Lv 8 move per class
     *  (buffs too, for later). */
    mpCost?: { damageByTier: Record<string, number[]>; dash: Record<string, number>; mobilityLv8: Record<string, number>; buffs?: Record<string, Record<string, number>> };
    /** A damage skill's cooldown (s) at skill Lv 1, by its unlock level ("18": 14); `note` says why. */
    cooldownByUnlock?: Record<string, number | string>;
    /** The buffs' numbers (Mac, 9 Oct; combat-guide.md "Buffs"): each one's stats at skill Lv 1, duration, cooldown. */
    buffs?: BuffsData;
  };
  caps: Record<string, number>;
  /** MP per second: "1 + 0.05 * INT". */
  regen: { inCombat: { hp: number; mpPerSec: string }; outOfCombatAfterSec: number; outOfCombatPctPerSec: number };
  rarity: { nameColour: Record<string, { affix: string | null; slots: number }> };
  mobBehaviour: MobBehaviour;
}

/** stats.json mobBehaviour: how the mobs live (the guide's "Mob behaviour"). Kinds in its lists are camelCase ('tinCan'). */
export interface MobBehaviour {
  respawnSeconds: number;
  /** Mobs about in each zone (a pack counted once). */
  aliveperZone: number;
  passive: string[];
  aggressive: string[];
  aggroTiles: number;
  /** Hitting one of these pulls its whole pack. */
  packAssist: string[];
  leashTiles: number;
  wanderTiles: number;
  attackEverySeconds: number;
  /** Tiles a mob attacks from: `melee` for every kind not listed. */
  rangeTiles: Record<string, number> & { melee: number };
  hpBar: { showOn: string; hideAfterSeconds: number; playersSee: string };
  /** Mob name colours by level gap: "mob 5+ levels below" (grey), "mob 3+ levels above" (red). */
  nameColour: { grey: string; white: string; red: string };
  golem: { leavesPit: boolean; resetAfterSecondsEmpty: number };
  /** Who mobs go for first, by class (higher first; a repo addition): `note` says how. */
  targetPriority?: Record<string, number | string>;
}

/** How much mobs want a player of this class (stats.json mobBehaviour.targetPriority; 0 without a class or a number). */
export function targetPriority(data: StatsData, cls: string | null | undefined): number {
  const v = cls ? data.mobBehaviour.targetPriority?.[cls] : undefined;
  return typeof v === 'number' ? v : 0;
}

/** The numbers in a formula string, in order ("100 * 1.3^(tier-1)" → 100, 1.3, 1). */
export const numbersIn = (s: string): number[] => (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

/** A sum of terms like "1 + 0.05 * INT" for these values. */
export function linear(formula: string, vars: Record<string, number>): number {
  return formula.split('+').reduce((sum, term) => sum + term.split('*').reduce((p, f) => p * (vars[f.trim()] ?? Number(f)), 1), 0);
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
/** A level within 1 … the cap. */
const lvl = (data: StatsData, level: number) => clamp(Math.floor(level) || 1, 1, data.levelCap);

// ── Level and XP ──

/** XP from `level` to the next (0 at the cap: XP stops there). */
export function xpToNext(data: StatsData, level: number): number {
  if (level >= data.levelCap) return 0;
  const { mult, pow, round } = data.xp.toNext;
  const n = mult * Math.max(1, level) ** pow;
  return round ? Math.round(n) : n;
}

/** All the XP it takes from Lv 1 to `level`. */
export function xpForLevel(data: StatsData, level: number): number {
  let total = 0;
  for (let l = 1; l < Math.min(level, data.levelCap); l++) total += xpToNext(data, l);
  return total;
}

/** The level a total of XP (since Lv 1) reaches, the XP into it and the XP its next level takes (0 at the cap). */
export function levelFromXp(data: StatsData, total: number): { level: number; xp: number; next: number } {
  let level = 1;
  let xp = Math.max(0, Math.floor(total));
  while (level < data.levelCap && xp >= xpToNext(data, level)) xp -= xpToNext(data, level++);
  if (level >= data.levelCap) xp = 0;
  return { level, xp, next: xpToNext(data, level) };
}

/** `gained` XP on a character at `level` with `xp` into it: the new level and XP, and how many levels it went up. */
export function gainXp(data: StatsData, level: number, xp: number, gained: number): { level: number; xp: number; ups: number } {
  const from = lvl(data, level);
  const r = levelFromXp(data, xpForLevel(data, from) + Math.max(0, xp) + Math.max(0, gained));
  return { level: r.level, xp: r.xp, ups: r.level - from };
}

// ── Stats ──

/** Stat points a character has earned by `level` (one a level-up), and skill points (three a level-up). */
export const statPointsAt = (data: StatsData, level: number) => (lvl(data, level) - 1) * data.growth.pointsPerLevelUp;
export const skillPointsAt = (data: StatsData, level: number) => (lvl(data, level) - 1) * data.skills.skillPointsPerLevelUp;

/** The stats a class's points may go into (its main and second); none before a class. */
export function pointStats(data: StatsData, cls: string | null | undefined): StatName[] {
  const c = cls ? data.classes[cls] : undefined;
  return c ? data.growth.pointsGoTo.map((place) => c[place]) : [];
}

/** Stat points earned and not spent (only those spent where they may go count as spent). */
export function unspentStatPoints(data: StatsData, cls: string | null | undefined, level: number, spent: StatPoints = {}): number {
  return statPointsAt(data, level) - pointStats(data, cls).reduce((n, s) => n + Math.max(0, spent[s] ?? 0), 0);
}

/** Base stats (what gear requirements check): the class's growth at `level` plus the points spent on its main and second
 *  stat; before a class, the classless stats (points are banked, not spent). */
export function baseStats(data: StatsData, cls: string | null | undefined, level: number, spent: StatPoints = {}): StatBlock {
  const c = cls ? data.classes[cls] : undefined;
  if (!c) return { ...data.classless };
  const L = lvl(data, level);
  const out = { STR: 0, DEX: 0, INT: 0 };
  for (const place of ['main', 'second', 'third'] as const) {
    const g = data.growth[place];
    out[c[place]] = g.base + g.perLevel * L;
  }
  for (const s of pointStats(data, cls)) out[s] += Math.max(0, Math.floor(spent[s] ?? 0));
  return out;
}

/** What worn gear adds (crit as fractions: 0.01 = 1%). STR, DEX and INT from gear count here but never for requirements. */
export interface GearTotals {
  atk?: number;
  def?: number;
  hp?: number;
  mp?: number;
  STR?: number;
  DEX?: number;
  INT?: number;
  critRate?: number;
  critDamage?: number;
  /** Damage amp (a fraction). */
  amp?: number;
  /** HP a second (the bracers' line), and attack rate, DEF rate, lifesteal, manasteal and drop rate (fractions). */
  hpRegen?: number;
  atkRate?: number;
  defRate?: number;
  lifesteal?: number;
  manasteal?: number;
  dropRate?: number;
}

/** What worn items add up to (items/equipment.json `stats`; their `crit` is in %). */
export function gearTotals(items: EquipStats[]): GearTotals {
  const t: Required<Pick<GearTotals, 'atk' | 'def' | 'hp' | 'mp' | 'STR' | 'DEX' | 'INT' | 'critRate'>> = { atk: 0, def: 0, hp: 0, mp: 0, STR: 0, DEX: 0, INT: 0, critRate: 0 };
  for (const s of items) {
    t.atk += s.atk ?? 0;
    t.def += s.def ?? 0;
    t.hp += s.hp ?? 0;
    t.mp += s.mp ?? 0;
    t.STR += s.str ?? 0;
    t.DEX += s.dex ?? 0;
    t.INT += s.int ?? 0;
    t.critRate += (s.crit ?? 0) / 100;
  }
  return t;
}

export interface DerivedStats extends StatBlock {
  hp: number;
  mp: number;
  /** MP a second in combat. */
  mpRegen: number;
  /** Attack strength (ATK on the stats box). */
  power: number;
  def: number;
  /** A fraction, capped (caps.critRate). */
  critRate: number;
  /** The crit multiplier (1.5 = 150%). */
  critDamage: number;
  amp: number;
  /** From gear: HP a second, and attack rate, DEF rate, lifesteal, manasteal and drop rate, each held to its cap. */
  hpRegen: number;
  atkRate: number;
  defRate: number;
  lifesteal: number;
  manasteal: number;
  dropRate: number;
  /** From buffs (withBuffs): points off the miss chance, the share off damage skills' cooldowns, and max HP a second
   *  (in combat too). */
  accuracy?: number;
  cooldownPct?: number;
  hpRegenPct?: number;
}

/** Everything that comes from base stats, level and gear: HP, MP, MP regen, Power (gear ATK + its main and second
 *  stat), DEF (gear DEF + STR), crit; with gear's STR, DEX and INT. Before a class, Power counts the two highest stats. */
export function derivedStats(data: StatsData, cls: string | null | undefined, level: number, base: StatBlock, gear: GearTotals = {}): DerivedStats {
  const L = lvl(data, level);
  const D = data.derived;
  const total: StatBlock = { STR: base.STR + (gear.STR ?? 0), DEX: base.DEX + (gear.DEX ?? 0), INT: base.INT + (gear.INT ?? 0) };
  const c = cls ? data.classes[cls] : undefined;
  const [main, second] = c ? [total[c.main], total[c.second]] : STAT_NAMES.map((s) => total[s]).sort((a, b) => b - a);
  const def = D.def.round === 'down' ? Math.floor(D.def.perSTR * total.STR) : Math.round(D.def.perSTR * total.STR);
  return {
    ...total,
    hp: D.hp.base + D.hp.perLevel * L + D.hp.perSTR * total.STR + (gear.hp ?? 0),
    mp: D.mp.base + D.mp.perLevel * L + D.mp.perINT * total.INT + (gear.mp ?? 0),
    mpRegen: linear(data.regen.inCombat.mpPerSec, total),
    power: (gear.atk ?? 0) + D.power.perMain * main + D.power.perSecond * second,
    def: def + (gear.def ?? 0),
    critRate: capped(data, 'critRate', D.critRate.base + D.critRate.perDEX * total.DEX + (gear.critRate ?? 0)),
    critDamage: D.critDamage + (gear.critDamage ?? 0),
    amp: gear.amp ?? 0,
    hpRegen: gear.hpRegen ?? 0,
    atkRate: capped(data, 'atkRate', gear.atkRate ?? 0),
    defRate: capped(data, 'defRate', gear.defRate ?? 0),
    lifesteal: capped(data, 'lifesteal', gear.lifesteal ?? 0),
    manasteal: capped(data, 'manasteal', gear.manasteal ?? 0),
    dropRate: capped(data, 'dropRate', gear.dropRate ?? 0),
  };
}

/** A value held to its cap (stats.json `caps`), if it has one. */
export const capped = (data: StatsData, key: string, value: number) => (data.caps[key] === undefined ? value : Math.min(value, data.caps[key]));

// ── Gear requirements ──

export type GearKind = 'weapon' | 'armor' | 'accessory';
const ARMOR = new Set(['head', 'body', 'hands', 'bottoms', 'feet']);
export const gearKind = (slot: string): GearKind => (slot === 'weapon' ? 'weapon' : ARMOR.has(slot) ? 'armor' : 'accessory');

/** What an item needs: its fields that matter (items/equipment.json). */
export interface GearItem {
  slot: string;
  level: number;
  /** A weapon's class. */
  class?: string;
  /** An armor piece's gear type (Heavy, Light, Household). */
  gear?: string;
}

/** One requirement: the character's level, or a base stat (`main`: a weapon's main stat, which must also be the highest). */
export interface Requirement {
  stat: StatName | 'level';
  value: number;
  main?: boolean;
}

/** An item's requirements, level first: weapons their class's main stat ≥ 2R + 6 and second ≥ R + 4; armor both its gear
 *  type's stats ≥ R + 4; accessories the level only (R = the item's level; the numbers are stats.json's). */
export function requirements(data: StatsData, item: GearItem): Requirement[] {
  const R = item.level;
  const out: Requirement[] = [{ stat: 'level', value: R }];
  const at = (r: ItemReq) => r.perItemLevel * R + r.plus;
  const kind = gearKind(item.slot);
  if (kind === 'weapon') {
    const c = item.class ? data.classes[item.class] : undefined;
    const W = data.requirements.weapon;
    if (c) out.push({ stat: c.main, value: at(W.main), ...(W.mainMustBeHighest ? { main: true } : {}) }, { stat: c.second, value: at(W.second) });
  } else if (kind === 'armor') {
    for (const s of data.gearTypeStats[item.gear?.toLowerCase() ?? ''] ?? []) out.push({ stat: s, value: at(data.requirements.armor.bothGearTypeStats) });
  }
  return out;
}

/** A requirement not met: what it needs and what the character has (`highest`: the stat is high enough but isn't their
 *  highest). */
export interface Missing {
  stat: StatName | 'level';
  need: number;
  have: number;
  highest?: boolean;
}

/** Whether a character with these base stats (never gear's) and level can wear the item, and what's missing. */
export function canEquip(data: StatsData, base: StatBlock, level: number, item: GearItem): { ok: boolean; missing: Missing[] } {
  const missing: Missing[] = [];
  for (const r of requirements(data, item)) {
    const have = r.stat === 'level' ? level : base[r.stat];
    if (have < r.value) missing.push({ stat: r.stat, need: r.value, have });
    else if (r.main && r.stat !== 'level' && STAT_NAMES.some((s) => s !== r.stat && base[s] > have)) missing.push({ stat: r.stat, need: r.value, have, highest: true });
  }
  return { ok: !missing.length, missing };
}

/** A short line for what's missing: "Needs DEX 26", "Needs Lv 10 and INT 14", "Needs DEX as your highest stat". */
export function needsLine(missing: Missing[]): string {
  const parts = missing.map((m) => (m.highest ? `${m.stat} as your highest stat` : m.stat === 'level' ? `Lv ${m.need}` : `${m.stat} ${m.need}`));
  return parts.length ? `Needs ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]}` : '';
}

/** Gear made for another class, said plainly (before its stat requirements, which would only say "Needs DEX 14"): a
 *  weapon of another class, or armor of another gear type ("Heavy armor, for the Stick and Greatstick. You wear
 *  Household armor."). Null when it's theirs, or before a class. `nameOf`: a class's name (its id, capitalised, if
 *  left out). */
export function gearMismatch(data: StatsData, cls: string | null | undefined, item: GearItem, nameOf: (cls: string) => string = (c) => c[0].toUpperCase() + c.slice(1)): string | null {
  if (!cls || !data.classes[cls]) return null;
  const kind = gearKind(item.slot);
  if (kind === 'weapon' && item.class && item.class !== cls) return `A ${nameOf(item.class)}’s weapon: only a ${nameOf(item.class)} can use it.`;
  if (kind !== 'armor' || !item.gear) return null;
  const type = item.gear.toLowerCase();
  const mine = data.classes[cls].gearType;
  if (!mine || type === mine) return null;
  const who = Object.entries(data.classes).filter(([, c]) => c.gearType === type).map(([id]) => nameOf(id));
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  return `${cap(type)} armor, for the ${who.length > 1 ? `${who.slice(0, -1).join(', ')} and ${who.at(-1)}` : (who[0] ?? 'other classes')}. You wear ${cap(mine)} armor.`;
}

/** Whether a character (class, level and stat points spent) can wear an item: canEquip on their base stats. */
export const wearCheck = (data: StatsData, who: { cls: string | null; progress: { level: number; points: StatPoints } }, item: GearItem) =>
  canEquip(data, baseStats(data, who.cls, who.progress.level, who.progress.points), who.progress.level, item);

// ── Wearing and giving gear ──

/** Where a kind of equipment can be worn (two places for bracers and rings). */
export const placesFor = (slot: EquipSlot): EquipPlace[] => (slot === 'bracers' ? ['bracers1', 'bracers2'] : slot === 'ring' ? ['ring1', 'ring2'] : [slot]);

/** The Tanod's training gear for a class (items/equipment.json `training`): its weapon, and its gear type's armor. */
export function trainingGear<T extends EquipmentDef>(data: StatsData, items: Iterable<T>, cls: string | null): { weapon?: T; armor: T[] } {
  const type = cls ? data.classes[cls]?.gearType : undefined;
  const all = [...items].filter((i) => i.training);
  return { weapon: all.find((i) => i.slot === 'weapon' && i.class === cls), armor: type ? all.filter((i) => gearKind(i.slot) === 'armor' && i.gear?.toLowerCase() === type) : [] };
}

// ── Skills ──

/** A damage skill's tier: its place in its class's unlock order (the first is tier 1). */
export const skillTier = (index: number) => index + 1;

/** A tier's base damage %: 100 × 1.3^(tier − 1), rounded (stats.json skills.basePct). */
export function skillBasePct(data: StatsData, tier: number): number {
  const [base, growth] = numbersIn(data.skills.basePct);
  return Math.round(base * growth ** (Math.max(1, tier) - 1));
}

/** What each skill level does past Lv 1, as multipliers: damage or heal (+2% a level), buff or debuff strength (+5%), MP
 *  cost (+3%) and cooldown (−1%). */
export function skillLevelBonus(data: StatsData, skillLevel: number): { damage: number; buff: number; mpCost: number; cooldown: number } {
  const n = Math.max(1, skillLevel) - 1;
  const P = data.skills.perSkillLevel;
  return { damage: 1 + P.damageOrHeal * n, buff: 1 + P.buffDebuff * n, mpCost: 1 + P.mpCost * n, cooldown: 1 + P.cooldown * n };
}

/** The MP a skill costs at its skill level (stats.json skills.mpCost: damageByTier / dash / mobilityLv8 for the class,
 *  +3% a level past 1, rounded): `key` is a damage skill's place ('0'…) or a move's id ('dash', else the class's Lv 8
 *  move). 0 when the table has none. */
export function skillMpCost(data: StatsData, cls: string | null | undefined, key: string, skillLevel = 1): number {
  const T = data.skills.mpCost;
  if (!cls || !T) return 0;
  const base = /^\d+$/.test(key) ? (T.damageByTier[cls]?.[Number(key)] ?? 0) : key === 'dash' ? (T.dash[cls] ?? 0) : (T.mobilityLv8[cls] ?? 0);
  return Math.round(base * skillLevelBonus(data, skillLevel).mpCost);
}

/** stats.json skills.buffs: the rules in words (and a few numbers: party range, cooldowns), each buff by name. */
export interface BuffsData {
  note?: string;
  rules: Record<string, string | number | boolean>;
  list: Record<string, BuffDef>;
  /** What each stat key means, in words. */
  statKeys: Record<string, string>;
}

/** A buff (skills.buffs.list): its class, unlock level, who it reaches, its stats at skill Lv 1 (atkPct 0.08 = +8%;
 *  point stats like critRate 0.08 = 8 points), how long it lasts (s; null = a stance, until changed; 0 = instant),
 *  and its cooldown (s). */
export interface BuffDef {
  class: string;
  unlock: number;
  target: 'self' | 'ally+self' | 'party';
  stats: Record<string, number>;
  durationSec: number | null;
  cooldownSec: number;
  stance?: boolean;
  note?: string;
}

/** A buff's stats at a skill level: each +5% of itself a level past 1 (perSkillLevel.buffDebuff); a heal's
 *  (healPctOfPower) +2% like other heals (damageOrHeal). Rounded to a millionth. Empty for an unknown buff. */
export function buffValue(data: StatsData, name: string, skillLevel = 1): Record<string, number> {
  const b = data.skills.buffs?.list[name];
  if (!b) return {};
  const bonus = skillLevelBonus(data, skillLevel);
  return Object.fromEntries(Object.entries(b.stats).map(([k, v]) => [k, Math.round(v * (k === 'healPctOfPower' ? bonus.damage : bonus.buff) * 1e6) / 1e6]));
}

/** A buff's skill level cap at a character level: the damage skills' rule (skillLevelCap) from its unlock level. */
export function buffSkillCap(data: StatsData, name: string, characterLevel: number): number {
  const b = data.skills.buffs?.list[name];
  return b ? skillLevelCap(data, characterLevel, b.unlock) : 0;
}

/** The buffs on someone as one set of stats: for each stat only the strongest of them counts (Rally and Vital Rub both
 *  raise ATK: only the bigger), different stats add up. */
export function strongestBuffs(on: Iterable<{ stats: Record<string, number> }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of on) for (const [k, v] of Object.entries(b.stats)) if (!(k in out) || v > out[k]) out[k] = v;
  return out;
}

/** Whether buffs on the same stat add up (stats.json skills.buffs.rules.stack, a repo addition), else only the strongest. */
export const buffsStack = (data: StatsData | null | undefined): boolean => data?.skills.buffs?.rules.stack === true;

/** The buffs on someone as one set of stats, by the rule (buffsStack): every buff's added up (Rally and Vital Rub both
 *  count; the caps hold in withBuffs), or each stat's strongest. One buff of a name each (a recast restarts it), so the
 *  same buff never stacks with itself. */
export function buffTotals(data: StatsData | null | undefined, on: Iterable<{ stats: Record<string, number> }>): Record<string, number> {
  if (!buffsStack(data)) return strongestBuffs(on);
  const out: Record<string, number> = {};
  for (const b of on) for (const [k, v] of Object.entries(b.stats)) out[k] = (out[k] ?? 0) + v;
  return out;
}

/** Derived stats with buffs on (buffTotals): Power × (1 + atkPct), max HP × (1 + maxHpPct), DEF × (1 + defPct),
 *  + amp, + crit rate (held to caps.critRate), + DEF rate (gear's and the buff's together, held to caps.defRate), and
 *  accuracy, cooldownPct and hpRegenPctPerSec as they are. A heal (healPctOfPower) is no lasting stat. */
export function withBuffs(data: StatsData, d: DerivedStats, b: Record<string, number>): DerivedStats {
  return {
    ...d,
    power: d.power * (1 + (b.atkPct ?? 0)),
    hp: Math.round(d.hp * (1 + (b.maxHpPct ?? 0))),
    def: d.def * (1 + (b.defPct ?? 0)),
    amp: d.amp + (b.amp ?? 0),
    critRate: capped(data, 'critRate', d.critRate + (b.critRate ?? 0)),
    defRate: capped(data, 'defRate', d.defRate + (b.defRate ?? 0)),
    accuracy: (d.accuracy ?? 0) + (b.accuracy ?? 0),
    cooldownPct: (d.cooldownPct ?? 0) + (b.cooldownPct ?? 0),
    hpRegenPct: (d.hpRegenPct ?? 0) + (b.hpRegenPctPerSec ?? 0),
  };
}

/** A buff's MP at its skill level (stats.json skills.mpCost.buffs, +3% a level past 1, rounded); 0 if none. */
export function buffMpCost(data: StatsData, name: string, skillLevel = 1): number {
  const b = data.skills.buffs?.list[name];
  const base = b ? (data.skills.mpCost?.buffs?.[b.class]?.[name] ?? 0) : 0;
  return Math.round(base * skillLevelBonus(data, skillLevel).mpCost);
}

/** A damage skill's multiplier on Power at its skill level (tier 2 at Lv 5: 1.3 × 1.08). */
export const skillPct = (data: StatsData, tier: number, skillLevel = 1) => (skillBasePct(data, tier) / 100) * skillLevelBonus(data, skillLevel).damage;

/** How high a skill unlocked at `unlockLevel` can be raised at character `level`: level − unlock + 1, at most 20 (0:
 *  not unlocked yet). */
export function skillLevelCap(data: StatsData, level: number, unlockLevel: number): number {
  const [most] = numbersIn(data.skills.levelCap);
  return clamp(level - unlockLevel + 1, 0, most);
}

/** A skill's cap: a damage skill's skillLevelCap; a mobility move (Dash, the Lv 8 move) stays at Lv 1 (0 before it
 *  unlocks). */
export function skillCap(data: StatsData, level: number, skill: { unlock: number; move?: string }): number {
  return skill.move ? (level >= skill.unlock ? 1 : 0) : skillLevelCap(data, level, skill.unlock);
}

/** A skill in a class's list: its key (where its level is kept: a damage skill's place '0'…'6', a move's id), name,
 *  description and unlock level; a damage skill's place (`index`, its tier − 1), a move's id (`move`). */
export interface ClassSkill {
  key: string;
  name: string;
  desc: string;
  unlock: number;
  index?: number;
  move?: string;
  /** A buff's name (classes.json buffs; its key too). */
  buff?: string;
}

/** A class's skills, damage skills and movement skills (classes.json `skills` and `mobility`), in unlock order (a
 *  damage skill before a move of the same level). */
export function classSkills(c: ClassInfo | null | undefined): ClassSkill[] {
  if (!c) return [];
  const damage = c.skills.map((s, i): ClassSkill => ({ key: String(i), name: s.name, desc: s.desc, unlock: s.level, index: i }));
  const moves = (c.mobility ?? []).map((m): ClassSkill => ({ key: m.id, name: m.name, desc: m.desc, unlock: m.level, move: m.id }));
  return [...damage, ...moves].sort((a, b) => a.unlock - b.unlock);
}

/** A class's buffs (classes.json `buffs`) as skills, in unlock order: each kept under its name. */
export function classBuffs(c: ClassInfo | null | undefined): ClassSkill[] {
  return [...(c?.buffs ?? [])].sort((a, b) => a.level - b.level).map((b) => ({ key: b.name, name: b.name, desc: b.effect ?? '', unlock: b.level, buff: b.name }));
}

/** A class's buffs' skill levels, by name (a fight's Attacker: what each cast gives). */
export const buffSkillLevels = (c: ClassInfo | null | undefined, p: Pick<CharacterProgress, 'skills'>): Record<string, number> =>
  Object.fromEntries(classBuffs(c).map((b) => [b.key, skillLevelOf(p, b.key)]));

/** A skill's level (Lv 1 unless raised; `skills` keeps only those above it). */
export const skillLevelOf = (p: Pick<CharacterProgress, 'skills'> | null | undefined, key: string) => Math.max(1, Math.floor(p?.skills[key] ?? 1));

/** A class's damage skills' levels, in their order (a fight's Attacker). */
export const damageSkillLevels = (c: ClassInfo | null | undefined, p: Pick<CharacterProgress, 'skills'>) => (c?.skills ?? []).map((_, i) => skillLevelOf(p, String(i)));

/** The level a class's movement skill unlocks at (classes.json), or null: not one of its moves. */
export const moveUnlock = (c: ClassInfo | null | undefined, move: string): number | null => c?.mobility?.find((m) => m.id === move)?.level ?? null;

/** A damage skill's cooldown (s) at Lv 1, by its unlock level: stats.json skills.cooldownByUnlock (Lv 1: 1 s … Lv 18:
 *  14 s), the base its skill levels take their −1% off. A level the table lacks: the old 0.8 + 0.15 a level, to a tenth. */
export function baseCooldown(data: StatsData, unlockLevel: number): number {
  const s = data.skills.cooldownByUnlock?.[String(unlockLevel)];
  return typeof s === 'number' ? s : Math.round((0.8 + 0.15 * Math.max(1, unlockLevel)) * 10) / 10;
}

/** A cooldown of `seconds` at Lv 1 at a skill level: −1% a level past 1 (stats.json perSkillLevel.cooldown), to a
 *  hundredth. The bot enforces it, the game shows it. */
export const skillCooldown = (data: StatsData, seconds: number, skillLevel = 1) => Math.round(seconds * skillLevelBonus(data, skillLevel).cooldown * 100) / 100;

// ── Damage ──

/** The level gap: for each level the target is above the attacker, less damage (never under minMult) and a miss chance. No
 *  bonus against lower levels. */
export function levelGap(data: StatsData, attackerLevel: number, targetLevel: number): { mult: number; miss: number } {
  const G = data.damage.levelGap;
  const above = Math.max(0, targetLevel - attackerLevel);
  return { mult: Math.max(G.minMult, 1 + G.perLevelAboveYou * above), miss: clamp(G.missPerLevelAboveYou * above, 0, 1) };
}

/** Who hits: their Power, crit and amp (derivedStats), and level. A mob: its ATK as Power, no crit. */
export interface Hitter {
  power: number;
  level: number;
  critRate?: number;
  critDamage?: number;
  amp?: number;
  /** Points off the level gap's miss chance (buffs), never below 0. */
  accuracy?: number;
}

/** Who's hit: their DEF and level, and their DEF rate (gear and buffs, held to caps.defRate): that share less damage,
 *  after DEF. A player's `priority`: how much mobs want them (targetPriority). */
export interface Target {
  def: number;
  level: number;
  defRate?: number;
  priority?: number;
}

/** One hit's damage, before any roll: Power × skill % × (1 + amp) × crit × 100 / (100 + DEF) (DEF taking at most
 *  caps.damageReduction) × (1 − DEF rate) × the level gap's multiplier; at least 1. */
export function hitDamage(data: StatsData, by: Hitter, on: Target, pct: number, crit = false): number {
  const def = Math.max(1 - (data.caps.damageReduction ?? 1), 100 / (100 + Math.max(0, on.def)));
  const rate = 1 - capped(data, 'defRate', Math.max(0, on.defRate ?? 0));
  const n = by.power * pct * (1 + (by.amp ?? 0)) * (crit ? (by.critDamage ?? 1) : 1) * def * rate * levelGap(data, by.level, on.level).mult;
  return Math.max(1, Math.round(n));
}

/** A hit as it lands: a miss (by the level gap's chance, less the hitter's accuracy), else a crit or not, and its
 *  damage. `random` decides (the miss first, then the crit). */
export function rollHit(data: StatsData, by: Hitter, on: Target, pct: number, random: () => number = Math.random): { damage: number; crit: boolean; miss: boolean } {
  const miss = Math.max(0, levelGap(data, by.level, on.level).miss - (by.accuracy ?? 0));
  if (miss > 0 && random() < miss) return { damage: 0, crit: false, miss: true };
  const crit = !!by.critRate && random() < by.critRate;
  return { damage: hitDamage(data, by, on, pct, crit), crit, miss: false };
}

// ── Mobs ──

/** A mob kind's level, HP, ATK, DEF and XP (the mob table); undefined for a kind it doesn't have. */
export const mobStats = (data: StatsData, kind: string): MobStats | undefined => data.mobs.list[kind];

/** The XP a kill gives a character at `level`: the mob's, less for a mob far below them (20% less per level past the
 *  first 5, never under 20%); at least 1. */
export function mobXp(data: StatsData, mob: { level: number; xp: number }, level: number): number {
  const P = data.xp.lowMobPenalty;
  const extra = level - mob.level - P.freeGap;
  const mult = extra > 0 ? Math.max(P.minMult, 1 - P.perExtraLevel * extra) : 1;
  return mob.xp > 0 ? Math.max(1, Math.round(mob.xp * mult)) : 0;
}

/** The share of a mob's HP a player must have done in its fight to get its XP (the mob table's `xpTo`: 5% → 0.05), or
 *  null: its killer gets it. */
export function xpShare(mob: MobStats): number | null {
  const [pct] = numbersIn(mob.xpTo ?? '');
  return pct === undefined ? null : pct / 100;
}

/** Who gets a kill's XP: everyone whose damage in its fight (`dealt`, by player) reached the mob's share of its HP, for a
 *  mob with one (the golem); else the killer. */
export function xpEarners(mob: MobStats, dealt: ReadonlyMap<string, number>, killer: string): string[] {
  const share = xpShare(mob);
  if (share === null) return [killer];
  return [...dealt].filter(([, n]) => n >= share * mob.hp).map(([who]) => who);
}

/** A mob's name colour for a character at `level`: grey 5+ levels below them (little XP), red 3+ above, white between. */
export function mobTone(data: StatsData, level: number, mobLevel: number): 'grey' | 'white' | 'red' {
  const [below] = numbersIn(data.mobBehaviour.nameColour.grey);
  const [above] = numbersIn(data.mobBehaviour.nameColour.red);
  return level - mobLevel >= below ? 'grey' : mobLevel - level >= above ? 'red' : 'white';
}

// ── Mob behaviour ──

/** A mob kind's key in mobBehaviour's lists ('tin-can' → 'tinCan'). */
const behaviourKey = (kind: string) => kind.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

/** How a kind of mob lives (stats.json mobBehaviour): whether it comes for players within `aggroTiles` (else it only
 *  fights back), whether a hit pulls its whole pack, the tiles it attacks from and how often (ms), how far it's pulled
 *  before it walks home healed, how far it wanders, how soon it's back after dying (ms), and how many are about in its
 *  zone (a pack counted once). A kind in neither list (the golem) is passive. */
export interface MobRules {
  aggressive: boolean;
  packAssist: boolean;
  reach: number;
  attackMs: number;
  aggroTiles: number;
  leashTiles: number;
  wanderTiles: number;
  respawnMs: number;
  alive: number;
}

export function mobRules(data: StatsData, kind: string): MobRules {
  const B = data.mobBehaviour;
  const key = behaviourKey(kind);
  return {
    aggressive: B.aggressive.includes(key),
    packAssist: B.packAssist.includes(key),
    reach: B.rangeTiles[key] ?? B.rangeTiles.melee,
    attackMs: B.attackEverySeconds * 1000,
    aggroTiles: B.aggroTiles,
    leashTiles: B.leashTiles,
    wanderTiles: B.wanderTiles,
    respawnMs: B.respawnSeconds * 1000,
    alive: B.aliveperZone,
  };
}

/** How long a mob's HP bar stays after its last hit (ms; while it's your target it stays). */
export const mobBarMs = (data: StatsData): number => data.mobBehaviour.hpBar.hideAfterSeconds * 1000;

/** How long the golem waits with nobody fighting it before it resets to full (ms). */
export const golemResetMs = (data: StatsData): number => data.mobBehaviour.golem.resetAfterSecondsEmpty * 1000;

/** The golem's HP multiplier per player in the Slums (stats.json mobBehaviour.golem.hpPerPlayer, a repo addition): its HP
 *  is the mob table's × this ^ players. 1 without it. */
export const golemHpPerPlayer = (data: StatsData): number => (data.mobBehaviour.golem as { hpPerPlayer?: number }).hpPerPlayer ?? 1;

/** A small seeded number (0–1) from a string, so a mob's look, pack and first spot are the same on every restart and in
 *  the game before the server answers. */
export function seeded(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

/** How many caps a pack of `[lo, hi]` with id `id` has (seeded). */
export const packSize = (id: string, [lo, hi]: [number, number]): number => lo + Math.floor(seeded(`${id}:pack`) * (hi - lo + 1));

/** Where a zone's `n` mobs (or packs) start: indices into its spawn points, spread out (a seeded first, then each the
 *  point farthest from those taken), the same every time. Its mob `k` is `<zone>:<k>` (a pack's caps `<zone>:<k>:<n>`);
 *  after a death it comes back at a random free point of the zone (the server's pick). */
export function mobStartSpots(zone: string, spawns: readonly (readonly [number, number])[], n: number): number[] {
  if (!spawns.length) return [];
  const out = [Math.floor(seeded(`${zone}:first`) * spawns.length)];
  const d = (a: readonly [number, number], b: readonly [number, number]) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
  while (out.length < Math.min(n, spawns.length)) {
    let best = -1;
    let far = -1;
    spawns.forEach((s, i) => {
      if (out.includes(i)) return;
      const near = Math.min(...out.map((j) => d(s, spawns[j])));
      if (near > far) [best, far] = [i, near];
    });
    out.push(best);
  }
  return out;
}
