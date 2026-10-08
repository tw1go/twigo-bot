import type { AdventureState, EquipmentDef, EquipPlace, EquipSlot, GearRarity } from './adventure.js';
import { type GearTotals, type StatName, type StatsData, gearKind, numbersIn, placesFor, needsLine, wearCheck } from './stats.js';

// 🎒 Items as things a player owns: each one an instance (its own uid, rolls and history) of a kind from the game's data
// (items/equipment.json: gear; items/items.json: whetstones, fragments, Repair Kits, HP/MP Potions, agimats, cosmetics).
// Pure functions over the numbers in classes/stats.json (affixes, rarity, enhancement, agimats, inventory, currencies,
// potions, bossLoot…; none of them written here), shared by the bot (which rolls and keeps every item) and the game
// (which shows them). The rules in words: the art folder's data/combat-guide.md (Affixes, Agimats, Item rarity and name
// colours, Enhancement, Potions regen and inventory). Rolls take a `random` so tests can seed them; uids come from the
// caller (the bot's are random hex).

/** An affix line's stat (stats.json affixes.maxAtItemLevel): `stat` adds to the wearer's main stat. */
export type AffixStat = 'atk' | 'hp' | 'mp' | 'def' | 'stat' | 'hpRegen' | 'atkRate' | 'defRate' | 'critRate' | 'critDmg' | 'amp' | 'lifesteal' | 'manasteal' | 'dropRate';
/** An agimat's stat (stats.json agimats.valueAtLevel; its `stat` comes as STR, DEX or INT). */
export type AgimatStat = 'atk' | 'hp' | 'mp' | 'def' | 'STR' | 'DEX' | 'INT' | 'atkRate' | 'critRate' | 'critDmg' | 'amp';

/** One affix line: its stat and value (flat stats whole numbers, rates as fractions: 0.012 = 1.2%). */
export interface AffixLine {
  stat: AffixStat;
  value: number;
}

/** An agimat set in an item's slot: its stat and level (and the slot type it was locked to, if any). */
export interface AgimatSet {
  stat: AgimatStat;
  level: number;
  lock?: EquipSlot;
}

/** One item a player owns. Gear: its level, rarity, plus (0–20), broken, bound, luck (its next enhance's bonus),
 *  agimat slots (one per slot its rarity gives: null when empty) and affix lines (blue and orange only: three, line 3
 *  last). Stackable kinds (materials, agimats, HP/MP Potions) keep a `count`; gear is always 1. An agimat item has its
 *  `stat` and maybe a slot `lock`. */
export interface Item {
  uid: string;
  defId: string;
  level: number;
  rarity: GearRarity;
  plus: number;
  broken: boolean;
  bound: boolean;
  luck: number;
  agimats: (AgimatSet | null)[];
  lines: AffixLine[];
  count: number;
  stat?: AgimatStat;
  lock?: EquipSlot;
}

/** What isn't gear: whetstones, fragments and Repair Kits (material), HP/MP Potions (potion), agimats, cosmetics. */
export type ItemKind = 'material' | 'potion' | 'agimat' | 'cosmetic';

/** items/items.json: a kind of item that isn't worn (gear is items/equipment.json). */
export interface CombatItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  /** Its name's colour (stats.json rarity). */
  rarity: GearRarity;
  /** Its tier (stats.json gearTiers / potions.tiers: low, mid…), for whetstones, kits and potions. */
  tier?: string;
  /** An HP or MP Potion: what it heals (its tier's number in stats.json potions). */
  heals?: 'hp' | 'mp';
  /** An agimat's stat. */
  stat?: AgimatStat;
  /** What it's for (the tooltip). */
  about?: string;
  /** A cosmetic that can't be worn yet. */
  cosmetic?: boolean;
  /** Sold at the sari-sari store: priced as a potion (its tier's Kusing), a whetstone or a Repair Kit (Kowens). */
  shop?: 'potion' | 'whetstone' | 'repairKit';
  /** What it does at the forge popup for its tier's gear: enhances (whetstone), combines ten into a whetstone
   *  (fragment), repairs (repairKit). */
  forge?: 'whetstone' | 'fragment' | 'repairKit';
  icon?: string;
  showcase?: string;
  large?: string;
}

export interface CombatItemsFile {
  items: CombatItemDef[];
}

export type AnyItemDef = EquipmentDef | CombatItemDef;
export const isGearDef = (d: AnyItemDef | undefined): d is EquipmentDef => !!d && 'slot' in d;

/** Every item kind by id (gear and the rest) with the stats rules' numbers: what items need. */
export interface ItemData {
  stats: StatsData;
  defs: Map<string, AnyItemDef>;
}

/** The parts of classes/stats.json items read (the stats rules' StatsData has the rest). */
export interface ItemStats {
  affixes: {
    rollRange: [number, number];
    maxAtItemLevel: Record<string, [string | number, string | number]>;
    rareRollWeight: Record<string, number>;
    slots: Record<string, [string, string[]]>;
    names: Record<string, unknown>;
  };
  gearBase: { weaponATK: string; armorDEFPerPiece: Record<string, number | string> };
  enhancement: {
    max: number;
    perLevel: { from: number; to: number; pct: number }[];
    accessories: { perLevel: number };
    cost: { successPct: (number | null)[]; whetstonesPerTry: (number | null)[]; luckPerFail: Record<string, number>; breaks: string };
    weaponAura: { tiers: { from: number; to: number; aura: string; colours?: string[]; cycle?: string[]; glints?: number }[]; smoke: { count: Record<string, string> } };
  };
  disassembly: { fragments: { formula: string; craft: string }; agimat: { rareWeight: Record<string, string> } };
  rarity: {
    nameColour: Record<string, { affix: string | null; slots: number; colour?: string }>;
    slotsOn: string[];
    mobGearDrop: { chancePerKill: number; odds: Record<string, number>; level: Record<string, string | Record<string, number>> };
    bossGearDrop: { affix: Record<string, number>; slots: Record<string, number>; level: Record<string, number> };
    /** A dropped piece's plus: weight by plus ("0": 0.6, "1": 0.25…; other keys are notes). */
    dropPlus: Record<string, number | string | boolean>;
  };
  agimats: { valueAtLevel: Record<string, string | number>; rare: string[]; dropWeight: Record<string, number> };
  currencies: { kusingPerMob: string; kusingPerMobRange?: [number, number]; kowensShop: { whetstone: number; repairKit: number } };
  potions: { tiers: Record<string, { minLevel: number; hp: number; mp: number; kusing: number }>; sharedCooldownSec: number; mobDropChance: number };
  inventory: Record<string, unknown> & { slots: number };
  trading: { bindOnWear: string };
  gearTiers: Record<string, unknown>;
  party: { solo: string; loot: string; boss: string };
  bossLoot: {
    perEligiblePlayer: {
      kusing: number;
      roughWhetstones: [number, number];
      gearPieces: [number, number];
      accessoryChance: number;
      agimatChance: number;
      agimatLevels: number[];
      lampHatChance: number;
    };
    eligible: string;
  };
}

/** stats.json as items read it. */
export const itemStats = (data: StatsData): ItemStats => data as unknown as ItemStats;

const ARMOR: readonly EquipSlot[] = ['head', 'body', 'hands', 'bottoms', 'feet'];
export const RATE_STATS: ReadonlySet<string> = new Set(['atkRate', 'defRate', 'critRate', 'critDmg', 'amp', 'lifesteal', 'manasteal', 'dropRate']);

/** A per-level formula ("0.16R+1", "0.1A+1", or a plain number) at level `n`. */
export function atLevel(f: string | number, n: number): number {
  if (typeof f === 'number') return f;
  const m = /^\s*([\d.]+)\s*[A-Z]\s*(?:\+\s*([\d.]+))?\s*$/.exec(f);
  return m ? Number(m[1]) * n + Number(m[2] ?? 0) : Number(f) || 0;
}

/** A value as a line keeps it: flat stats whole (at least 1), rates to a tenth of a percent. */
const tidyValue = (stat: string, v: number) => (RATE_STATS.has(stat) ? Math.round(v * 1000) / 1000 : Math.max(1, Math.round(v)));

// ── Rarity ──

/** A rarity's name colour (stats.json rarity.nameColour[r].colour). */
export const rarityColour = (data: StatsData, rarity: string): string => itemStats(data).rarity.nameColour[rarity]?.colour ?? '#E5E7EB';

/** Its affix tier: 'blue', 'orange' or null (brown, white and grey have none). */
export const affixTier = (data: StatsData, rarity: string): 'blue' | 'orange' | null => (itemStats(data).rarity.nameColour[rarity]?.affix as 'blue' | 'orange' | null) ?? null;

/** Agimat slots an item of this rarity has in this kind of place (weapons and armor only; accessories never). */
export function slotCount(data: StatsData, rarity: string, slot: EquipSlot): number {
  const R = itemStats(data).rarity;
  return R.slotsOn.includes(slot) ? (R.nameColour[rarity]?.slots ?? 0) : 0;
}

/** Whether an item of this rarity binds the first time it's worn (stats.json trading.bindOnWear names them). */
export const bindsOnWear = (data: StatsData, rarity: string) => new RegExp(`\\b${rarity}\\b`).test(itemStats(data).trading.bindOnWear);

// ── Affix lines ──

/** A line's most at item level R for a tier (stats.json affixes.maxAtItemLevel: [blue, orange]). */
export function lineMax(data: StatsData, stat: AffixStat, tier: 'blue' | 'orange', R: number): number {
  const row = itemStats(data).affixes.maxAtItemLevel[stat];
  return row ? atLevel(row[tier === 'blue' ? 0 : 1], R) : 0;
}

/** One pick from weighted choices. */
function weighted<T>(choices: [T, number][], random: () => number): T {
  const total = choices.reduce((n, [, w]) => n + w, 0);
  let r = random() * total;
  for (const [c, w] of choices) if ((r -= w) < 0) return c;
  return choices[choices.length - 1][0];
}

/** A slot's line 1 (its fixed stat; a ring's is crit rate or crit damage) and its line 3 pool (stats.json affixes.slots;
 *  a ring's "the other one" crit stat resolved against its line 1). */
function slotStats(data: StatsData, slot: EquipSlot, random: () => number): { first: AffixStat; pool: AffixStat[] } {
  const [fixed, pool] = itemStats(data).affixes.slots[slot] ?? ['hp', []];
  const options = fixed.split('|') as AffixStat[];
  const first = options[Math.floor(random() * options.length)];
  const resolved = pool.map((p) => (p.includes('|') ? (p.split(/[|\s]/)[0] === first ? p.split(/[|\s]/)[1] : p.split(/[|\s]/)[0]) : p)) as AffixStat[];
  return { first, pool: resolved };
}

/** A line's value: 80–100% (affixes.rollRange) of its most at the item's level. */
const rollValue = (data: StatsData, stat: AffixStat, tier: 'blue' | 'orange', R: number, random: () => number) => {
  const [lo, hi] = itemStats(data).affixes.rollRange;
  return tidyValue(stat, lineMax(data, stat, tier, R) * (lo + (hi - lo) * random()));
};

/** A blue or orange item's three lines: the slot's own stat, HP, then one from the slot's pool (crit rate, crit damage
 *  and damage amp at their rare weight). No stat twice, except a ring with both crit stats. */
export function rollLines(data: StatsData, slot: EquipSlot, tier: 'blue' | 'orange', R: number, random: () => number = Math.random): AffixLine[] {
  const A = itemStats(data).affixes;
  const { first, pool } = slotStats(data, slot, random);
  const taken = new Set<AffixStat>([first, 'hp']);
  const open = pool.filter((s) => !taken.has(s));
  const third = open.length ? weighted(open.map((s): [AffixStat, number] => [s, A.rareRollWeight[s] ?? A.rareRollWeight.others ?? 1]), random) : 'hp';
  return [first, 'hp' as AffixStat, third].map((stat) => ({ stat, value: rollValue(data, stat, tier, R, random) }));
}

// ── Making items ──

/** A plain item of a kind: as the kind says (training gear: its level, brown, bound), no lines, empty slots. */
export function newItem(data: StatsData, def: AnyItemDef, uid: string, count = 1): Item {
  const gear = isGearDef(def);
  const level = gear ? def.level : 1;
  return {
    uid,
    defId: def.id,
    level,
    rarity: def.rarity,
    plus: 0,
    broken: false,
    bound: gear ? def.bound : false,
    luck: 0,
    agimats: gear ? Array(slotCount(data, def.rarity, def.slot)).fill(null) : [],
    lines: [],
    count: gear ? 1 : Math.max(1, Math.floor(count)),
    ...(!gear && def.kind === 'agimat' && def.stat ? { stat: def.stat } : {}),
  } as Item;
}

/** A piece of gear of `rarity`: its slots empty, its three lines rolled if blue or orange. */
export function rollGear(data: StatsData, def: EquipmentDef, rarity: GearRarity, uid: string, random: () => number = Math.random): Item {
  const item = newItem(data, { ...def, rarity }, uid);
  item.bound = false;
  const tier = affixTier(data, rarity);
  if (tier) item.lines = rollLines(data, def.slot, tier, def.level, random);
  return item;
}

/** An agimat item: its stat and level, maybe locked to a slot type. */
export function newAgimat(data: StatsData, def: CombatItemDef, level: number, uid: string, lock?: EquipSlot): Item {
  return { ...newItem(data, def, uid), level, stat: def.stat, ...(lock ? { lock } : {}) };
}

// ── What an item gives ──

/** Enhancement's total on base at `plus` (stats.json enhancement.perLevel: +2% a level to +10, +3% to +15, +5% to +20). */
export function enhanceTotal(data: StatsData, plus: number): number {
  let total = 0;
  for (const b of itemStats(data).enhancement.perLevel) total += Math.max(0, Math.min(plus, b.to) - b.from + 1) * b.pct;
  return total;
}

/** Gear's base stat before enhancement: a weapon's ATK (2 × its level; training: its own), an armor piece's DEF (its gear
 *  type's per-level × its level; training: its own); accessories have none. */
export function baseOf(data: StatsData, def: EquipmentDef, level = def.level): { atk?: number; def?: number } {
  const kind = gearKind(def.slot);
  if (kind === 'accessory') return {};
  if (def.stats?.atk !== undefined || def.stats?.def !== undefined) return { ...(def.stats.atk !== undefined ? { atk: def.stats.atk } : {}), ...(def.stats.def !== undefined ? { def: def.stats.def } : {}) };
  const G = itemStats(data).gearBase;
  if (kind === 'weapon') return { atk: Math.round((numbersIn(G.weaponATK)[0] ?? 0) * level) };
  const per = Number(G.armorDEFPerPiece[def.gear?.toLowerCase() ?? '']) || 0;
  return { def: Math.round(per * level) };
}

/** Its base stat with its plus (rounded): "ATK 48 → 49" is this at plus and plus + 1. */
export function enhancedBase(data: StatsData, def: EquipmentDef, item: Pick<Item, 'level' | 'plus'>): { atk?: number; def?: number } {
  const b = baseOf(data, def, item.level);
  const m = 1 + enhanceTotal(data, item.plus);
  return { ...(b.atk !== undefined ? { atk: Math.round(b.atk * m) } : {}), ...(b.def !== undefined ? { def: Math.round(b.def * m) } : {}) };
}

/** A line's value on its item: an accessory's lines grow +1% of themselves a plus (enhancement.accessories). */
export function lineValue(data: StatsData, def: EquipmentDef, item: Pick<Item, 'plus'>, line: AffixLine): number {
  if (gearKind(def.slot) !== 'accessory' || !item.plus) return line.value;
  return tidyValue(line.stat, line.value * (1 + itemStats(data).enhancement.accessories.perLevel * item.plus));
}

/** An agimat's value at its level (stats.json agimats.valueAtLevel; STR, DEX and INT are its `stat`). */
export function agimatValue(data: StatsData, stat: AgimatStat, level: number): number {
  const V = itemStats(data).agimats.valueAtLevel;
  const f = V[stat] ?? V[stat === 'STR' || stat === 'DEX' || stat === 'INT' ? 'stat' : ''];
  return f === undefined ? 0 : tidyValue(stat, atLevel(f, level));
}

/** What worn items add up to (broken ones give nothing): each one's base with its plus, its lines (a `stat` line to the
 *  wearer's main stat) and its agimats. Rates as fractions. */
export function itemTotals(data: ItemData, items: Item[], mainStat: StatName | null): GearTotals {
  const t: Required<GearTotals> = { atk: 0, def: 0, hp: 0, mp: 0, STR: 0, DEX: 0, INT: 0, critRate: 0, critDamage: 0, amp: 0, hpRegen: 0, atkRate: 0, defRate: 0, lifesteal: 0, manasteal: 0, dropRate: 0 };
  const add = (stat: string, v: number) => {
    const key = stat === 'critDmg' ? 'critDamage' : stat === 'stat' ? mainStat : stat;
    if (key && key in t) t[key as keyof GearTotals] += v;
  };
  for (const item of items) {
    const def = data.defs.get(item.defId);
    if (!isGearDef(def) || item.broken) continue;
    const b = enhancedBase(data.stats, def, item);
    if (b.atk) t.atk += b.atk;
    if (b.def) t.def += b.def;
    for (const [k, v] of Object.entries(def.stats ?? {})) if (k !== 'atk' && k !== 'def') add(k === 'crit' ? 'critRate' : k === 'str' ? 'STR' : k === 'dex' ? 'DEX' : k === 'int' ? 'INT' : k, k === 'crit' ? (v as number) / 100 : (v as number));
    for (const line of item.lines) add(line.stat, lineValue(data.stats, def, item, line));
    for (const a of item.agimats) if (a) add(a.stat, agimatValue(data.stats, a.stat, a.level));
  }
  return t;
}

// ── Names and words ──

/** What a stat is called on a line ("ATK", "Crit rate"…; a `stat` line by the wearer's main stat). */
export function statLabel(stat: string, mainStat: StatName | null = null): string {
  const L: Record<string, string> = {
    atk: 'ATK', def: 'DEF', hp: 'HP', mp: 'MP', stat: mainStat ?? 'Main stat', hpRegen: 'HP regen', atkRate: 'Attack rate', defRate: 'DEF rate', critRate: 'Crit rate',
    critDmg: 'Crit damage', amp: 'Damage amp', lifesteal: 'Lifesteal', manasteal: 'Manasteal', dropRate: 'Drop rate', STR: 'STR', DEX: 'DEX', INT: 'INT',
  };
  return L[stat] ?? stat;
}

/** A line as the tooltip shows it: "+3 ATK", "+1.2% Crit rate", "+2 HP/s HP regen". */
export function lineText(stat: string, value: number, mainStat: StatName | null = null): string {
  if (RATE_STATS.has(stat)) return `+${+(value * 100).toFixed(1)}% ${statLabel(stat)}`;
  return `+${value} ${statLabel(stat, mainStat)}${stat === 'stat' ? ' (main stat)' : ''}`;
}

/** The affix name for a line ("of Calamity"): stats.json affixes.names, by tier; a `stat` line by the main stat (STR when
 *  there's none). */
export function affixName(data: StatsData, stat: AffixStat, tier: 'blue' | 'orange', mainStat: StatName | null = null): string {
  const N = itemStats(data).affixes.names ?? {};
  const row = (stat === 'stat' ? (N.stat as Record<string, string[]> | undefined)?.[mainStat ?? 'STR'] : N[stat]) as string[] | undefined;
  return row?.[tier === 'blue' ? 0 : 1] ?? '';
}

const SLOT_WORD: Record<EquipSlot, string> = {
  weapon: 'Weapon', head: 'Head', body: 'Body', hands: 'Hands', bottoms: 'Bottoms', feet: 'Feet', necklace: 'Necklace', earrings: 'Earrings', bracers: 'Bracers', ring: 'Ring',
};

/** An item's name: "Sturdy Slingshot of Calamity +7" (the plus after the name, none at +0), "(Broken)" after that; an
 *  agimat's "Crit Damage Agimat Lv 20" ("(Body only)" when locked); a stack's without its count. `mainStat`: the
 *  viewer's (a `stat` line's name). */
export function itemName(data: ItemData, item: Item, mainStat: StatName | null = null): string {
  const def = data.defs.get(item.defId);
  if (!def) return item.defId;
  if (!isGearDef(def)) {
    if (def.kind === 'agimat') return `${def.name} Lv ${item.level}${item.lock ? ` (${SLOT_WORD[item.lock]} only)` : ''}`;
    return def.name;
  }
  const tier = affixTier(data.stats, item.rarity);
  const third = item.lines[2];
  const affix = tier && third ? affixName(data.stats, third.stat, tier, mainStat) : '';
  return `${def.name}${affix ? ` ${affix}` : ''}${item.plus > 0 ? ` +${item.plus}` : ''}${item.broken ? ' (Broken)' : ''}`;
}

/** Plain things' names (Kusing, whetstones, fragments, Repair Kits, HP/MP Potions) are white; gear, agimats and
 *  cosmetics show their rarity's colour. */
export const PLAIN_COLOUR = '#FFFFFF';

/** The colour an item's name is shown in (loot labels, the pickup line). */
export function nameColour(data: ItemData, item: Item): string {
  const def = data.defs.get(item.defId);
  if (!def || (!isGearDef(def) && (def.kind === 'material' || def.kind === 'potion'))) return PLAIN_COLOUR;
  return rarityColour(data.stats, item.rarity);
}

/** Loot is picked up within this many tiles of you (either way): a click on it, F or Space. The server checks it. */
export const LOOT_REACH = 1;

/** One run of a coloured line. */
export interface LinePart {
  text: string;
  colour: string;
}

/** The line in your own system feed (only you see it) as you pick something up: "Gained Sturdy Slingshot of Calamity +1
 *  (1 slot)", "Gained Crude Stick +3" (no slot part without slots), "Gained Rough Whetstone ×3", "Gained 120 Kusing".
 *  Only the item's name is in its colour (`nameColour`); the rest is white. `text`: all of it. `mainStat`: the viewer's. */
export function pickupLine(data: ItemData, got: { kusing?: number; item?: Item }, mainStat: StatName | null = null): { text: string; parts: LinePart[] } {
  const plain = (text: string): LinePart => ({ text, colour: PLAIN_COLOUR });
  let parts: LinePart[];
  if (!got.item) parts = [plain(`Gained ${(got.kusing ?? 0).toLocaleString('en-US')} Kusing`)];
  else {
    const it = got.item;
    const slots = isGearDef(data.defs.get(it.defId)) ? it.agimats.length : 0;
    const after = `${it.count > 1 ? ` ×${it.count}` : ''}${slots ? ` (${slots} slot${slots === 1 ? '' : 's'})` : ''}`;
    parts = [plain('Gained '), { text: itemName(data, it, mainStat), colour: nameColour(data, it) }, ...(after ? [plain(after)] : [])];
  }
  return { text: parts.map((p) => p.text).join(''), parts };
}

// ── Bags and stacks ──

/** The most of a kind in one slot (stats.json inventory: stackN lists; gear never stacks). */
export function stackLimit(data: StatsData, def: AnyItemDef | undefined): number {
  if (!def || isGearDef(def) || def.kind === 'cosmetic') return 1;
  const word = def.kind === 'potion' ? 'potions' : def.kind === 'agimat' ? 'agimats' : 'materials';
  for (const [k, v] of Object.entries(itemStats(data).inventory)) {
    const m = /^stack(\d+)$/.exec(k);
    if (m && Array.isArray(v) && v.some((x) => String(x).startsWith(word))) return Number(m[1]);
  }
  return 1;
}

/** Whether two items go in one stack: the same kind (agimats: same stat, level and slot lock), never gear. */
export function sameStack(data: ItemData, a: Item, b: Item): boolean {
  if (a.defId !== b.defId || stackLimit(data.stats, data.defs.get(a.defId)) < 2) return false;
  return a.level === b.level && a.stat === b.stat && (a.lock ?? null) === (b.lock ?? null) && a.bound === b.bound;
}

/** Slots in the combat bag (stats.json inventory.slots). */
export const bagSlots = (data: StatsData) => itemStats(data).inventory.slots;

/** How many of `item` the bag could take: what fits on its stacks plus free slots' worth. */
export function bagRoom(data: ItemData, bag: Item[], item: Item): number {
  const limit = stackLimit(data.stats, data.defs.get(item.defId));
  const onStacks = bag.filter((b) => sameStack(data, b, item)).reduce((n, b) => n + Math.max(0, limit - b.count), 0);
  return onStacks + Math.max(0, bagSlots(data.stats) - bag.length) * limit;
}

/** Puts an item (or a stack) into the bag: onto its stacks first, then new slots (new uids from `uid` for the extra ones).
 *  All or nothing: false (and the bag untouched) if it doesn't all fit. */
export function addToBag(data: ItemData, bag: Item[], item: Item, uid: () => string): boolean {
  if (bagRoom(data, bag, item) < item.count) return false;
  const limit = stackLimit(data.stats, data.defs.get(item.defId));
  let left = item.count;
  for (const b of bag) {
    if (!left) break;
    if (!sameStack(data, b, item)) continue;
    const n = Math.min(left, limit - b.count);
    b.count += n;
    left -= n;
  }
  let first = true;
  while (left > 0) {
    const n = Math.min(left, limit);
    bag.push({ ...item, uid: first ? item.uid : uid(), count: n });
    first = false;
    left -= n;
  }
  return true;
}

/** How many of a kind they carry (every stack). */
export const countOf = (bag: Item[], defId: string) => bag.reduce((n, b) => n + (b.defId === defId ? b.count : 0), 0);

/** Takes `n` of a kind out of the bag (smallest stacks first): false (untouched) if there aren't that many. */
export function takeKind(bag: Item[], defId: string, n: number): boolean {
  if (countOf(bag, defId) < n) return false;
  let left = n;
  for (const b of [...bag].filter((x) => x.defId === defId).sort((x, y) => x.count - y.count)) {
    const k = Math.min(left, b.count);
    b.count -= k;
    left -= k;
    if (!left) break;
  }
  for (let i = bag.length - 1; i >= 0; i--) if (bag[i].count <= 0) bag.splice(i, 1);
  return true;
}

// ── Money ──

/** Kusing a kill drops: round(100 × 1.08^(mob level − 1)) (stats.json currencies.kusingPerMob). */
export function kusingFor(data: StatsData, mobLevel: number): number {
  const [base, growth] = numbersIn(itemStats(data).currencies.kusingPerMob);
  return Math.round(base * growth ** (Math.max(1, mobLevel) - 1));
}

/** The Kusing a kill may drop, lowest and highest: kusingFor × stats.json currencies.kusingPerMobRange (0.6–1.2),
 *  rounded (a Tin Can 60–120, Bottle Caps Lv 3 70–140). The roll is the server's. */
export function kusingRange(data: StatsData, mobLevel: number): [number, number] {
  const mid = kusingFor(data, mobLevel);
  const [lo, hi] = itemStats(data).currencies.kusingPerMobRange ?? [1, 1];
  return [Math.round(mid * lo), Math.round(mid * hi)];
}

// ── Wearing ──

/** The parts of a character wearing needs. */
export type Wearer = Pick<AdventureState, 'cls' | 'progress' | 'equipped' | 'bag'>;

/** Wears an item from the combat bag (by uid): in `place`, else the first free place for its kind, else the first; what
 *  was there goes into the bag (where the item was). Refused: not gear, broken, a cosmetic, its requirements (base stats
 *  only), the wrong place. An orange item binds the first time it's worn. */
export function equipFromBag(data: ItemData, s: Wearer, uid: string, place?: EquipPlace): { ok: boolean; message: string } {
  const at = s.bag.findIndex((b) => b.uid === uid);
  const item = s.bag[at];
  const def = item && data.defs.get(item.defId);
  if (!item || !def) return { ok: false, message: "You don't have that item." };
  if (!isGearDef(def)) return { ok: false, message: def.kind === 'cosmetic' ? "Can't be worn yet." : "That can't be worn." };
  if (item.broken) return { ok: false, message: 'It\'s broken: repair it first.' };
  const places = placesFor(def.slot);
  if (place && !places.includes(place)) return { ok: false, message: 'Wrong slot.' };
  const can = wearCheck(data.stats, s, { ...def, level: item.level });
  if (!can.ok) return { ok: false, message: needsLine(can.missing) };
  const to = place ?? places.find((p) => !s.equipped[p]) ?? places[0];
  const old = s.equipped[to];
  s.bag.splice(at, 1, ...(old ? [old] : []));
  if (bindsOnWear(data.stats, item.rarity)) item.bound = true;
  s.equipped[to] = item;
  return { ok: true, message: `Equipped ${itemName(data, item)}.` };
}

/** Takes off what's worn in a place, into the bag: refused when the bag is full. */
export function unequipToBag(data: ItemData, s: Wearer, place: EquipPlace): { ok: boolean; message: string } {
  const item = s.equipped[place];
  if (!item) return { ok: false, message: 'Nothing to take off there.' };
  if (s.bag.length >= bagSlots(data.stats)) return { ok: false, message: 'Your bag is full.' };
  delete s.equipped[place];
  s.bag.push(item);
  return { ok: true, message: `Took off ${itemName(data, item)}.` };
}

/** Takes off anything broken that's worn (an enhance that broke it), into the bag (worn on if there's no room: it gives
 *  nothing anyway). */
export function unequipBroken(data: ItemData, s: Pick<Wearer, 'equipped' | 'bag'>): void {
  for (const [place, item] of Object.entries(s.equipped) as [EquipPlace, Item][]) {
    if (item?.broken && s.bag.length < bagSlots(data.stats)) {
      delete s.equipped[place];
      s.bag.push(item);
    }
  }
}

/** The kinds of armour (not weapons or accessories). */
export const isArmorSlot = (slot: string) => (ARMOR as readonly string[]).includes(slot);

// ── The Tanod's training gear ──

/** The training gear a character owns (worn or in the bag). */
const ownsKind = (s: Wearer, defId: string) => s.bag.some((b) => b.defId === defId) || Object.values(s.equipped).some((i) => i?.defId === defId);

/** Gives gear (plain new items of these kinds): each into a free place for its kind if they can wear it, else into the
 *  combat bag while it has room. Returns the kinds given, and those that fitted nowhere (to try again later). */
export function giveGear(data: ItemData, s: Wearer, defs: EquipmentDef[], uid: () => string): { given: string[]; left: string[] } {
  const given: string[] = [];
  const left: string[] = [];
  for (const def of defs) {
    const item = newItem(data.stats, def, uid());
    const place = placesFor(def.slot).find((p) => !s.equipped[p]);
    if (place && wearCheck(data.stats, s, def).ok) s.equipped[place] = item;
    else if (s.bag.length < bagSlots(data.stats)) s.bag.push(item);
    else {
      left.push(def.id);
      continue;
    }
    given.push(def.id);
  }
  return { given, left };
}

/** Their class's training gear they don't own yet (`defs`: every gear kind). */
export const missingTraining = (data: ItemData, s: Wearer, armor: EquipmentDef[]) => armor.filter((d) => !ownsKind(s, d.id));

/** A new class's training gear in place of the old (a Bagong Buhay Ticket): every training piece they own, worn or in the
 *  bag, becomes the new class's piece for the same kind (a fresh item, as training gear never changes), in the same place
 *  (a worn one goes to the bag instead if they can't wear it); a piece the new class has none of goes. With no training
 *  weapon at all, the new one is put on (what was worn there to the bag). Call it with `s.cls` (and their points)
 *  already the new class's. */
export function swapTrainingGear(data: ItemData, s: Wearer, kit: { weapon?: EquipmentDef; armor: EquipmentDef[] }, uid: () => string): void {
  const forSlot = (slot: EquipSlot) => (slot === 'weapon' ? kit.weapon : kit.armor.find((i) => i.slot === slot));
  const trainingDef = (item: Item | undefined) => {
    const d = item && data.defs.get(item.defId);
    return isGearDef(d) && d.training ? d : null;
  };
  let hadWeapon = false;
  const bag: Item[] = [];
  for (const item of s.bag) {
    const old = trainingDef(item);
    if (!old) bag.push(item);
    else {
      hadWeapon ||= old.slot === 'weapon';
      const now = forSlot(old.slot);
      if (now) bag.push(newItem(data.stats, now, uid()));
    }
  }
  s.bag = bag;
  for (const [place, item] of Object.entries(s.equipped) as [EquipPlace, Item][]) {
    const old = trainingDef(item);
    if (!old) continue;
    hadWeapon ||= old.slot === 'weapon';
    const now = forSlot(old.slot);
    if (now && wearCheck(data.stats, s, now).ok) s.equipped[place] = newItem(data.stats, now, uid());
    else {
      delete s.equipped[place];
      if (now) s.bag.push(newItem(data.stats, now, uid()));
    }
  }
  if (!hadWeapon && kit.weapon) {
    if (s.equipped.weapon) s.bag.push(s.equipped.weapon);
    s.equipped.weapon = newItem(data.stats, kit.weapon, uid());
  }
}
