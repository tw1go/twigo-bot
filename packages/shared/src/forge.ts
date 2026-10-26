import type { AdventureState, EquipPlace, EquipmentDef, EquipSlot } from './adventure.js';
import { type AgimatSet, type CombatItemDef, type Item, type ItemData, affixTier, agimatSlots, enhancedBase, isGearDef, itemStats, lineValue } from './items.js';
import { type StatsData, gearKind, numbersIn } from './stats.js';
import type { TownItems } from './town.js';

// ⚒️ The forge popup's rules (combat-guide.md: Enhancement, How to enhance, Enhancement cost and odds, Agimats,
// Disassembly; classes/stats.json enhancement, agimats, disassembly, gearTiers): which item a whetstone, Repair Kit or
// agimat takes, what a try costs and its odds with the item's luck, what the next + gives, whether an agimat fits a
// slot, and what taking gear apart gives back. Pure and shared: the game shows these (and refuses at once), the bot
// checks them again and rolls (bot web/forge.ts). Training gear is never enhanced or taken apart.

/** What the forge popup does: enhance (a whetstone), repair (a Repair Kit), embed (an agimat), remove (Agimat Pliers),
 *  draw (an empty Temper Stone) or apply (a filled one). */
export type ForgeMode = 'enhance' | 'repair' | 'embed' | 'remove' | 'draw' | 'apply';

/** POST /town/forge. `item`: the gear's uid (worn or in the combat bag; disassembly: in the bag); `tool`: the whetstone
 *  or Repair Kit kind used (the one the popup was opened with); combine: `item` is a fragment stack's uid. */
export type TownForgeAction =
  | { action: 'enhance'; item: string; tool?: string }
  | { action: 'repair'; item: string; tool?: string }
  | { action: 'embed'; item: string; agimat: string; slot: number; replace?: boolean }
  /** Agimat Pliers: the agimat in `slot` back into the bag, whole. */
  | { action: 'remove'; item: string; slot: number }
  /** An empty Temper Stone: the item's + into a filled one (the item back to +0). */
  | { action: 'draw'; item: string }
  /** A filled Temper Stone (`stone`: its uid): its + onto the item; `retain`: a Retainment Stone keeps all of it (used up
   *  only when the item is a gear tier up: retainSaves). */
  | { action: 'apply'; item: string; stone: string; retain?: boolean }
  | { action: 'disassemble'; item: string }
  | { action: 'combine'; item: string }
  /** Training gear, agimats and potions sold from the bag for Kusing (`sellPrice`); `count`: how many of a stack (all of
   *  it without). */
  | { action: 'sell'; item: string; count?: number }
  /** A timed item (CONTEXT.md Timed cosmetic) thrown away from the bag: it can't be sold, traded or dropped. */
  | { action: 'destroy'; item: string }
  /** Several at once (the bag's multi-select): every one or none. */
  | { action: 'disassemble-many'; items: string[] }
  | { action: 'sell-many'; items: string[] };

/** What happened: an enhance's success, fail or break, a repair, an embed, a disassembly or a combine. */
export type ForgeOutcome = 'success' | 'fail' | 'break' | 'repaired' | 'embedded' | 'removed' | 'drawn' | 'applied' | 'disassembled' | 'combined' | 'sold' | 'destroyed';

export interface TownForgeResponse {
  ok: boolean;
  message: string;
  outcome?: ForgeOutcome;
  /** An embed into a full slot: ask, then send it again with `replace`. */
  confirm?: boolean;
  /** Their worn items, combat bag and Kusing after it. */
  items?: TownItems;
  /** The gear after it (enhanced, repaired, embedded). */
  item?: Item;
  /** What came back (disassembly, combine). */
  got?: Item[];
}

/** The parts of a character the forge changes. */
export type ForgeHolder = Pick<AdventureState, 'equipped' | 'bag'> & { kusing?: number };

/** What a piece of training gear sells for (stats.json trainingGear: sellKusing, unless noSell); null: it doesn't sell. */
export function trainingSellPrice(stats: StatsData): number | null {
  const T = (stats as StatsData & { trainingGear?: { noSell?: boolean; sellKusing?: number } }).trainingGear;
  return T && !T.noSell && typeof T.sellKusing === 'number' && T.sellKusing > 0 ? T.sellKusing : null;
}

/** What an agimat sells for, each (stats.json agimats.sellKusing, a repo addition: perLevel × its level, × rareTimes for
 *  a rare stat), or null: they don't sell. */
export function agimatSellPrice(stats: StatsData, item: Pick<Item, 'level' | 'stat'>): number | null {
  const A = (stats as StatsData & { agimats?: { sellKusing?: { perLevel?: number; rareTimes?: number } } }).agimats?.sellKusing;
  if (!A || typeof A.perLevel !== 'number' || A.perLevel <= 0) return null;
  return Math.round(A.perLevel * item.level * (item.stat && rareAgimat(stats, item.stat) ? (A.rareTimes ?? 1) : 1));
}

/** How bright an agimat of `level` is drawn (stats.json agimats.look, a repo addition): `darkest` at the first of
 *  `levels`, the art's own brightness (1) at the last, rising fastest at the start (a square root), so the levels found
 *  early already look apart; 1 without it. The game draws its picture at this brightness everywhere. */
export function agimatBrightness(stats: StatsData, level: number): number {
  const L = (stats as StatsData & { agimats?: { look?: { darkest?: number; levels?: [number, number] } } }).agimats?.look;
  if (!L || typeof L.darkest !== 'number' || !L.levels) return 1;
  const [from, to] = L.levels;
  const k = to > from ? Math.min(1, Math.max(0, (level - from) / (to - from))) : 1;
  return Math.round((L.darkest + (1 - L.darkest) * Math.sqrt(k)) * 1000) / 1000;
}

/** What an HP or MP Potion sells for, each (stats.json potions.sellShare, a repo addition: that share of its tier's
 *  kusing, rounded; Low 25, Medium 75, Large 200); null without the setting or a price. */
export function potionSellPrice(stats: StatsData, def: CombatItemDef): number | null {
  const P = (stats as StatsData & { potions?: { sellShare?: number; tiers?: Record<string, { kusing?: number }> } }).potions;
  const buy = def.tier ? P?.tiers?.[def.tier]?.kusing : undefined;
  if (!P || typeof P.sellShare !== 'number' || P.sellShare <= 0 || typeof buy !== 'number') return null;
  return Math.max(1, Math.round(buy * P.sellShare));
}

/** What an item in the combat bag sells for in Kusing (a stack: each × `count`, all of it without): training gear,
 *  agimats and HP/MP Potions; null for anything else. */
export function sellPrice(data: ItemData, item: Item, count = item.count): number | null {
  const def = data.defs.get(item.defId);
  if (isGearDef(def)) return def.training ? trainingSellPrice(data.stats) : null;
  const each = def?.kind === 'agimat' ? agimatSellPrice(data.stats, item) : def?.kind === 'potion' ? potionSellPrice(data.stats, def) : null;
  return each === null ? null : each * count;
}

/** An item by uid, worn (its place) or in the combat bag (its index). */
export function findItem(s: ForgeHolder, uid: string): { item: Item; place?: EquipPlace; index?: number } | null {
  const index = s.bag.findIndex((b) => b.uid === uid);
  if (index >= 0) return { item: s.bag[index], index };
  for (const [place, item] of Object.entries(s.equipped) as [EquipPlace, Item | undefined][]) if (item?.uid === uid) return { item, place };
  return null;
}

// ── Tiers and their tools ──

/** The gear tier an item level belongs to (stats.json gearTiers: low is Lv 1–20), or null. */
export function gearTier(data: StatsData, level: number): string | null {
  for (const [id, t] of Object.entries(itemStats(data).gearTiers)) {
    const levels = (t as { levels?: number[] } | undefined)?.levels;
    if (Array.isArray(levels) && level >= levels[0] && level <= levels[1]) return id;
  }
  return null;
}

/** A tier's whetstone, fragment or Repair Kit (items/items.json `forge`), if the game has it yet. */
export function toolFor(data: ItemData, kind: 'whetstone' | 'fragment' | 'repairKit', tier: string | null): CombatItemDef | undefined {
  if (!tier) return undefined;
  for (const d of data.defs.values()) if (!isGearDef(d) && d.forge === kind && d.tier === tier) return d;
  return undefined;
}

/** A tier's whetstone or Repair Kit by name ("Rough Whetstone", "Mid Repair Kit"), even before the game has it. */
export function toolName(data: ItemData, kind: 'whetstone' | 'repairKit', tier: string | null): string {
  const have = toolFor(data, kind, tier)?.name;
  if (have) return have;
  const T = itemStats(data.stats).gearTiers as Record<string, { material?: string } | string[]>;
  const t = tier ? (T[tier] as { material?: string } | undefined) : undefined;
  if (kind === 'whetstone') return t?.material ?? 'whetstone of its tier';
  const kits = T.repairKits as string[] | undefined;
  const order = Object.keys(T).filter((k) => k !== 'placeholder' && k !== 'repairKits');
  return (tier && kits?.[order.indexOf(tier)]) || 'Repair Kit of its tier';
}

/** "a" or "an" before a word. */
const an = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);

// ── Enhancement ──

/** The most an item can be enhanced to (+20). */
export const enhanceMax = (data: StatsData) => itemStats(data).enhancement.max;

/** Whetstones one try at `target` (+1 … +20) uses (enhancement.cost.whetstonesPerTry). */
export const stonesFor = (data: StatsData, target: number) => itemStats(data).enhancement.cost.whetstonesPerTry[target] ?? 0;

/** A try's own odds at `target` before luck (enhancement.cost.successPct), lower for an item of a higher gear tier
 *  (`level`: enhancement.cost.levelPenalty). */
export function successFor(data: StatsData, target: number, level = 0): number {
  const C = itemStats(data).enhancement.cost;
  const base = C.successPct[target] ?? 0;
  const P = C.levelPenalty;
  if (!P || !level) return base;
  return base * Math.max(0, 1 - P.pctPerTier * tiersUp(data, 1, level));
}

/** How much of a try's odds an item level keeps (stats.json enhancement.cost.levelPenalty): 1 for Low gear (Lv 1-20), 0.9 for Mid (Lv 30-40). */
export const levelOddsShare = (data: StatsData, level: number) => (successFor(data, 1, level) || 1) / (successFor(data, 1) || 1);

/** The luck a fail at `target` adds to the next try at that step (enhancement.cost.luckPerFail: "1-5", "6-10"…). */
export function luckPerFail(data: StatsData, target: number): number {
  for (const [range, luck] of Object.entries(itemStats(data).enhancement.cost.luckPerFail)) {
    const [lo, hi] = numbersIn(range);
    if (target >= lo && target <= (hi ?? lo)) return luck;
  }
  return 0;
}

/** The first + a fail breaks the item at (enhancement.cost.breaks: "from +16"). */
export const breaksFrom = (data: StatsData) => numbersIn(itemStats(data).enhancement.cost.breaks)[0] ?? Infinity;

/** Luck kept to a tenth of a percent (no float drift as it adds up). */
export const tidyLuck = (n: number) => Math.round(n * 1000) / 1000;

/** Why a whetstone (of `tool`'s kind; any of the item's tier when left out) can't enhance this item, or null. */
export function enhanceRefusal(data: ItemData, item: Item, tool?: string): string | null {
  const def = data.defs.get(item.defId);
  if (!isGearDef(def)) return 'Only weapons, armor and accessories can be enhanced.';
  if (def.training) return "Training gear can't be enhanced.";
  const tier = gearTier(data.stats, item.level);
  const stone = tool ? data.defs.get(tool) : undefined;
  if (tool && (isGearDef(stone) || stone?.forge !== 'whetstone')) return "That isn't a whetstone.";
  if (stone && !isGearDef(stone) && stone.tier !== tier) return `Needs ${an(toolName(data, 'whetstone', tier))}.`;
  if (item.broken) return `It's broken: repair it with ${an(toolName(data, 'repairKit', tier))} first.`;
  if (item.plus >= enhanceMax(data.stats)) return `It's already +${item.plus}, the most.`;
  return null;
}

/** One stat's change at the next + ("ATK 48 → 49"; an accessory's lines +1% a level). Rates as fractions. */
export interface NextStat {
  stat: string;
  from: number;
  to: number;
}

/** What an enhance try at the item's next + looks like: the step, the stones it takes (and how many they have), the
 *  odds with its luck, whether a fail breaks it, and what the next + gives. */
export interface EnhanceView {
  target: number;
  stones: number;
  have: number;
  /** The try's own odds and the item's luck (fractions); `chance` = both, at most 1. */
  base: number;
  luck: number;
  chance: number;
  breaks: boolean;
  whetstone: CombatItemDef | undefined;
  next: NextStat[];
}

/** The next try on an item (its tier's whetstone; null when it can't be enhanced). */
export function enhanceView(data: ItemData, item: Item, bag: Item[]): EnhanceView | null {
  const def = data.defs.get(item.defId);
  if (!isGearDef(def) || enhanceRefusal(data, item)) return null;
  const target = item.plus + 1;
  const whetstone = toolFor(data, 'whetstone', gearTier(data.stats, item.level));
  const base = successFor(data.stats, target, item.level);
  return {
    target,
    stones: stonesFor(data.stats, target),
    have: whetstone ? bag.reduce((n, b) => n + (b.defId === whetstone.id ? b.count : 0), 0) : 0,
    base,
    luck: item.luck,
    chance: Math.min(1, tidyLuck(base + item.luck)),
    breaks: target >= breaksFrom(data.stats),
    whetstone,
    next: nextStats(data, def, item),
  };
}

/** What the next + changes: a weapon's ATK or armor's DEF, or each of an accessory's lines (+1% of itself). */
export function nextStats(data: ItemData, def: EquipmentDef, item: Item): NextStat[] {
  const up = { ...item, plus: item.plus + 1 };
  if (gearKind(def.slot) === 'accessory') return item.lines.map((l) => ({ stat: l.stat, from: lineValue(data.stats, def, item, l), to: lineValue(data.stats, def, up, l) }));
  const now = enhancedBase(data.stats, def, item);
  const then = enhancedBase(data.stats, def, up);
  return (['atk', 'def'] as const).flatMap((k) => (now[k] === undefined ? [] : [{ stat: k, from: now[k]!, to: then[k]! }]));
}

// ── Repair ──

/** How many Repair Kits (of its tier) mending a broken item takes, by the + it kept (stats.json enhancement.cost.repairKits:
 *  +15 1, +16 and +17 2, +18 3, +19 4); 1 without it. */
export function repairKitsFor(data: StatsData, plus: number): number {
  const K = itemStats(data).enhancement.cost.repairKits ?? {};
  const at = Object.keys(K).map(Number).filter((p) => Number.isFinite(p) && p <= plus).sort((a, b) => b - a)[0];
  const n = at === undefined ? 1 : Number(K[String(at)]);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** "a Low Repair Kit" / "2 Low Repair Kits". */
export const repairKitsText = (data: ItemData, item: Item): string => {
  const n = repairKitsFor(data.stats, item.plus);
  const name = toolName(data, 'repairKit', gearTier(data.stats, item.level));
  return n === 1 ? an(name) : `${n} ${name}s`;
};

/** Why a Repair Kit (of `tool`'s kind; any of the item's tier when left out) can't repair this item, or null. */
export function repairRefusal(data: ItemData, item: Item, tool?: string): string | null {
  const def = data.defs.get(item.defId);
  if (!isGearDef(def)) return 'Only broken gear can be repaired.';
  const tier = gearTier(data.stats, item.level);
  const kit = tool ? data.defs.get(tool) : undefined;
  if (tool && (isGearDef(kit) || kit?.forge !== 'repairKit')) return "That isn't a Repair Kit.";
  if (kit && !isGearDef(kit) && kit.tier !== tier) return `Needs ${an(toolName(data, 'repairKit', tier))}.`;
  if (!item.broken) return "It isn't broken.";
  return null;
}

// ── Agimats ──

const SLOT_WORD: Record<EquipSlot, string> = {
  weapon: 'Weapon', head: 'Head', body: 'Body', hands: 'Hands', bottoms: 'Bottoms', feet: 'Feet', necklace: 'Necklace', earrings: 'Earrings', bracers: 'Bracers', ring: 'Ring',
};

/** How many rare agimats one item may hold (stats.json agimats.rarePerItem, a repo addition; 1 without it). */
export const rarePerItem = (data: StatsData) => (itemStats(data).agimats as { rarePerItem?: number }).rarePerItem ?? 1;

/** Whether an agimat's stat is one of the rare three (stats.json agimats.rare: crit rate, crit damage, damage amp). */
export const rareAgimat = (data: StatsData, stat: string) => itemStats(data).agimats.rare.includes(stat);

/** Why this agimat can't go into slot `slot` of this gear, or null (a full slot is allowed: it asks, then breaks the old
 *  one). Gear level ≥ the agimat's, its slot lock matches (any stat may fill both slots, the same one twice too), and no more rare
 *  ones than `rarePerItem` (2: both may be). */
/** "a, b and c". */
export const wordList = (words: string[]) => (words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);

/** The Agimat Pliers', Temper Stones' and Retainment Stone's kinds (items/items.json `forge`: pliers, temper, tempered,
 *  retain). */
export const toolOf = (data: ItemData, forge: 'pliers' | 'temper' | 'tempered' | 'retain'): CombatItemDef | undefined =>
  [...data.defs.values()].find((d): d is CombatItemDef => !isGearDef(d) && d.forge === forge);

/** Why the pliers can't pull the agimat out of this gear's `slot` (any filled one when left out), or null. Broken gear
 *  works too. */
export function removeRefusal(data: ItemData, gear: Item, slot?: number): string | null {
  if (!isGearDef(data.defs.get(gear.defId))) return 'Only gear holds agimats.';
  if (!gear.agimats.some((a) => !!a)) return 'It has no agimats.';
  if (slot !== undefined && !gear.agimats[slot]) return 'That slot is empty: pick one with an agimat.';
  return null;
}

/** Why an empty Temper Stone can't draw this item's +, or null. */
export function drawRefusal(data: ItemData, item: Item): string | null {
  const def = data.defs.get(item.defId);
  if (!isGearDef(def)) return 'Only gear has a + to draw.';
  if (item.broken) return 'Repair it first.';
  if (item.plus < 1) return 'It has no + to draw.';
  return null;
}

/** Why a filled Temper Stone can't go onto this item, or null: the same type (slot) and item level, not broken, and a
 *  lower + than the stone's. */
/** The gear tiers between a stone's item level and the item's (stats.json gearTiers, in order: Low, Mid…); 0 within one. */
function tiersUp(data: StatsData, from: number, to: number): number {
  const order = Object.keys(itemStats(data).gearTiers);
  const a = order.indexOf(gearTier(data, from) ?? '');
  const b = order.indexOf(gearTier(data, to) ?? '');
  return a < 0 || b < 0 ? 0 : Math.max(0, b - a);
}

/** The + a filled Temper Stone gives an item: its own, less stats.json enhancement.temper.minusPerTier for every gear
 *  tier up the item is (a Lv 10 +20 onto Lv 30 gear: +18; onto Lv 20: +20); `retain` (a Retainment Stone): all of it. */
export function temperedPlus(data: StatsData, stone: Item, item: Item, retain = false): number {
  return retain ? stone.plus : stone.plus - (itemStats(data).enhancement.temper?.minusPerTier ?? 0) * tiersUp(data, stone.level, item.level);
}

/** Whether a Retainment Stone saves anything on this apply (CONTEXT.md Retainment Stone): only when the item is a gear
 *  tier or more up from the stone, so one is never used up for nothing. */
export function retainSaves(data: StatsData, stone: Item, item: Item): boolean {
  return (itemStats(data).enhancement.temper?.minusPerTier ?? 0) > 0 && tiersUp(data, stone.level, item.level) > 0;
}

/** Why a filled Temper Stone can't go onto this item, or null; `retain`: with a Retainment Stone (its full +, when that
 *  saves anything). */
export function applyRefusal(data: ItemData, item: Item, stone: Item, retain = false): string | null {
  const def = data.defs.get(item.defId);
  const sdef = data.defs.get(stone.defId);
  if (isGearDef(sdef) || sdef?.forge !== 'tempered' || !stone.lock) return "That isn't a filled Temper Stone.";
  if (!isGearDef(def)) return `Needs ${an(SLOT_WORD[stone.lock])}.`;
  if (def.training) return "Training gear can't take a +.";
  if (def.slot !== stone.lock) return `Needs ${an(SLOT_WORD[stone.lock])}.`;
  if (item.level < stone.level) return `Needs a Lv ${stone.level} item or higher.`;
  if (item.broken) return 'Repair it first.';
  const plus = temperedPlus(data.stats, stone, item, retain && retainSaves(data.stats, stone, item));
  if (plus <= 0) return `Its +${stone.plus} is too little to carry up a tier.`;
  if (item.plus >= plus) return `This item is already +${plus} or higher.`;
  return null;
}

export function embedRefusal(data: ItemData, gear: Item, agimat: Item, slot?: number): string | null {
  const def = data.defs.get(gear.defId);
  const adef = data.defs.get(agimat.defId);
  if (isGearDef(adef) || adef?.kind !== 'agimat' || !agimat.stat) return "That isn't an agimat.";
  if (!isGearDef(def) || !gear.agimats.length) return 'Only weapons and armor with agimat slots take agimats.';
  if (gear.broken) return "It's broken: repair it first.";
  if (gear.level < agimat.level) return `Needs gear of Lv ${agimat.level} or higher.`;
  if (agimat.lock && agimat.lock !== def.slot) return `It fits ${SLOT_WORD[agimat.lock].toLowerCase()} gear only.`;
  const only = agimatSlots(data.stats, agimat.stat);
  if (only && !only.includes(def.slot)) return `It fits ${wordList(only.map((x) => SLOT_WORD[x].toLowerCase()))} gear only.`;
  if (slot === undefined) return null;
  if (!Number.isInteger(slot) || slot < 0 || slot >= gear.agimats.length) return 'No such slot.';
  const others = gear.agimats.filter((a, i): a is AgimatSet => !!a && i !== slot);
  const most = rarePerItem(data.stats);
  if (rareAgimat(data.stats, agimat.stat) && others.filter((a) => rareAgimat(data.stats, a.stat)).length >= most)
    return `Only ${most === 1 ? 'one rare agimat' : `${most} rare agimats`} (crit rate, crit damage or damage amp) per item.`;
  return null;
}

// ── Disassembly ──

/** Fragments taking an item at `plus` apart gives: 2 + 3 × the whetstones one try a step costs up to its + (stats.json
 *  disassembly.fragments.formula). */
/** Fragments a piece of gear gives when taken apart (stats.json disassembly.fragments.formula: 0 + 3 × the whetstones its
 *  plus took, so only gear with a + gives any). */
export function fragmentsFor(data: StatsData, plus: number): number {
  const [base, times] = numbersIn(itemStats(data).disassembly.fragments.formula);
  let stones = 0;
  for (let t = 1; t <= plus; t++) stones += stonesFor(data, t);
  return (base ?? 0) + (times ?? 0) * stones;
}

/** Fragments that make one whetstone (disassembly.fragments.craft: "10 fragments = 1 whetstone"). */
export const fragmentsPerWhetstone = (data: StatsData) => numbersIn(itemStats(data).disassembly.fragments.craft)[0] ?? 10;

/** How much likelier the rare three are from a two-slot item (disassembly.agimat.rareWeight.twoSlots: "3x"). */
export const twoSlotRareTimes = (data: StatsData) => numbersIn(itemStats(data).disassembly.agimat.rareWeight.twoSlots ?? '1')[0] ?? 1;

/** Why this item can't be taken apart, or null (from the combat bag; bound and broken gear may). */
export function disassembleRefusal(data: ItemData, s: ForgeHolder, uid: string): string | null {
  const found = findItem(s, uid);
  const def = found && data.defs.get(found.item.defId);
  if (!found || !def) return "You don't have that item.";
  if (!isGearDef(def)) return 'Only weapons, armor and accessories can be taken apart.';
  if (def.training) return "Training gear can't be taken apart.";
  if (found.place) return 'Take it off first.';
  return null;
}

/** How likely taking apart an item of this rarity gives an agimat (stats.json disassembly.agimat.chance by affix tier,
 *  a repo addition: blue 0.5, orange 1); 0 without affix lines (brown, white, grey). */
export function agimatChance(data: StatsData, rarity: string): number {
  const tier = affixTier(data, rarity);
  const p = tier ? itemStats(data).disassembly.agimat.chance?.[tier] : 0;
  return typeof p === 'number' ? Math.max(0, Math.min(1, p)) : tier ? 1 : 0;
}

/** What taking an item apart gives back: its tier's fragments, and from affix gear with agimat slots (blue, orange) maybe
 *  one agimat of its level locked to its slot type (`chance`: agimatChance; its stat rolled; two slots: the rare three 3×
 *  as likely). Its agimats are destroyed. */
export function disassemblyYield(data: ItemData, item: Item): { fragments: number; fragment: CombatItemDef | undefined; agimat: { level: number; lock: EquipSlot; rareTimes: number; chance: number } | null; destroys: AgimatSet[] } {
  const def = data.defs.get(item.defId);
  const chance = agimatChance(data.stats, item.rarity);
  const slotted = isGearDef(def) && item.agimats.length > 0 && chance > 0;
  return {
    fragments: fragmentsFor(data.stats, item.plus),
    fragment: toolFor(data, 'fragment', gearTier(data.stats, item.level)),
    agimat: slotted ? { level: item.level, lock: (def as EquipmentDef).slot, rareTimes: item.agimats.length >= 2 ? twoSlotRareTimes(data.stats) : 1, chance } : null,
    destroys: item.agimats.filter((a): a is AgimatSet => !!a),
  };
}

// ── Weapon auras ──

/** A weapon aura's look (stats.json enhancement.weaponAura): blue at +15–17, gold at +18–19, prismatic at +20. */
export interface AuraTier {
  aura: 'blue' | 'gold' | 'prismatic';
  /** The glow and the lit outline (blue, gold), or every prismatic colour at once (`cycle`). */
  colours: string[];
  cycle?: string[];
  glints: number;
  /** Spiral lines at a time: long and short (weaponAura.smoke.count: "4 (2 long, 2 short)"). */
  long: number;
  short: number;
}

/** A weapon's aura at its +, or null: weapons only, never broken (enhancement.weaponAura). */
export function auraFor(data: StatsData, plus: number, opts: { weapon?: boolean; broken?: boolean } = {}): AuraTier | null {
  if (opts.weapon === false || opts.broken || !plus) return null;
  const W = itemStats(data).enhancement.weaponAura;
  const t = W?.tiers.find((x) => plus >= x.from && plus <= x.to);
  if (!t) return null;
  const [, long, short] = numbersIn(W.smoke?.count?.[t.aura] ?? '');
  return { aura: t.aura as AuraTier['aura'], colours: t.colours ?? t.cycle ?? [], ...(t.cycle ? { cycle: t.cycle } : {}), glints: t.glints ?? 0, long: long ?? 2, short: short ?? 2 };
}

/** An item's aura (a weapon's, at its +; none when broken). */
export function itemAura(data: ItemData, item: Pick<Item, 'defId' | 'plus' | 'broken'>): AuraTier | null {
  const def = data.defs.get(item.defId);
  return isGearDef(def) ? auraFor(data.stats, item.plus, { weapon: def.slot === 'weapon', broken: item.broken }) : null;
}
