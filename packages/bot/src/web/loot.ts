import { type EquipmentDef, type GearRarity, type ItemData, type Item, gearKind, isGearDef, itemStats, kusingFor, newAgimat, newItem, numbersIn, rollGear } from '@mikazuki/shared';
import type { LootContent } from './combat-bag.js';

// 🎲 What a kill drops, rolled on the server by stats.json (rarity.mobGearDrop and bossGearDrop, potions, currencies,
// bossLoot; combat-guide.md "Death, parties and loot"): every mob drops Kusing (round(100 × 1.08^(level − 1))); about 3%
// of kills a weapon or armor piece for a random class or gear type at the map's gear level (Wire Tangle and Scrap Crab
// sometimes Lv 20), brown, white or grey with no lines; about 5% a potion of the map's tier (HP or MP). The Scrapheap
// Golem gives everyone who did 5% of its HP their own loot: its Kusing, Rough Whetstones, 1–2 blue or orange gear pieces
// (lines rolled), now and then an accessory, an agimat and, rarely, the Lamp-head Hat. Pure: `random` and `uid` come in.

/** One pick from weighted choices. */
function weighted<T>(choices: [T, number][], random: () => number): T {
  const total = choices.reduce((n, [, w]) => n + w, 0);
  let r = random() * total;
  for (const [c, w] of choices) if ((r -= w) < 0) return c;
  return choices[choices.length - 1][0];
}
const pick = <T>(list: T[], random: () => number): T => list[Math.floor(random() * list.length)];
/** A whole number in [lo, hi]. */
const between = ([lo, hi]: [number, number], random: () => number) => lo + Math.floor(random() * (hi - lo + 1));

/** The gear tier an item level belongs to (stats.json gearTiers: low is Lv 1–20). */
export function tierAt(data: ItemData, level: number): string | null {
  for (const [id, t] of Object.entries(itemStats(data.stats).gearTiers)) {
    const levels = (t as { levels?: number[] }).levels;
    if (levels && level >= levels[0] && level <= levels[1]) return id;
  }
  return null;
}

/** Gear that drops (weapons and armor, or accessories) of a level: never training gear. */
const dropGear = (data: ItemData, level: number, accessories = false): EquipmentDef[] =>
  [...data.defs.values()].filter((d): d is EquipmentDef => isGearDef(d) && !d.training && d.level === level && (gearKind(d.slot) === 'accessory') === accessories);

/** The map's gear level for a mob kind's drops: its own odds (Wire Tangle, Scrap Crab: Lv 10 or 20), else the map's
 *  (stats.json rarity.mobGearDrop.level.default: "map gear level (Slums 10)"). */
export function dropLevel(data: ItemData, kind: string, random: () => number): number {
  const L = itemStats(data.stats).rarity.mobGearDrop.level;
  const own = L[kind];
  if (own && typeof own === 'object') return Number(weighted(Object.entries(own).map(([lv, w]): [string, number] => [lv, w]), random));
  return numbersIn(String(L.default))[0] ?? 1;
}

/** A normal mob's drops: Kusing always, now and then gear (brown, white or grey) or an HP or MP Potion. */
export function mobDrops(data: ItemData, kind: string, level: number, random: () => number, uid: () => string): LootContent[] {
  const S = itemStats(data.stats);
  const out: LootContent[] = [{ kusing: kusingFor(data.stats, level) }];
  const G = S.rarity.mobGearDrop;
  if (random() < G.chancePerKill) {
    const gearLevel = dropLevel(data, kind, random);
    const kinds = dropGear(data, gearLevel);
    if (kinds.length) {
      const rarity = weighted(Object.entries(G.odds) as [GearRarity, number][], random);
      out.push({ item: rollGear(data.stats, pick(kinds, random), rarity, uid(), random) });
    }
  }
  if (random() < S.potions.mobDropChance) {
    const tier = tierAt(data, dropLevel(data, 'default', random));
    const potions = [...data.defs.values()].filter((d) => !isGearDef(d) && d.kind === 'potion' && d.tier === tier);
    if (potions.length) out.push({ item: newItem(data.stats, pick(potions, random), uid()) });
  }
  return out;
}

/** An agimat's stat, by stats.json agimats.dropWeight (the rare three seldom, attack rate now and then; STR, DEX and INT
 *  share a common one's weight). `rareTimes`: the rare three that many times as likely (disassembly's two slots). */
export function rollAgimatStat(data: ItemData, random: () => number, rareTimes = 1): string {
  const A = itemStats(data.stats).agimats;
  const stats = Object.keys(A.valueAtLevel).flatMap((s) => (s === 'stat' ? ['STR', 'DEX', 'INT'] : [s]));
  const w = (s: string) => (A.rare.includes(s) ? (A.dropWeight.rare ?? 0.1) * rareTimes : A.dropWeight[s] ?? (['STR', 'DEX', 'INT'].includes(s) ? (A.dropWeight.others ?? 1) / 3 : A.dropWeight.others ?? 1));
  return weighted(stats.map((s): [string, number] => [s, w(s)]), random);
}

/** The golem's loot for one player who earned it (stats.json bossLoot.perEligiblePlayer). */
export function golemLoot(data: ItemData, random: () => number, uid: () => string): LootContent[] {
  const S = itemStats(data.stats);
  const P = S.bossLoot.perEligiblePlayer;
  const B = S.rarity.bossGearDrop;
  const out: LootContent[] = [{ kusing: P.kusing }];
  const whetstone = [...data.defs.values()].find((d) => !isGearDef(d) && d.shop === 'whetstone' && d.tier === 'low');
  if (whetstone) out.push({ item: newItem(data.stats, whetstone, uid(), between(P.roughWhetstones, random)) });
  const level = () => Number(weighted(Object.entries(B.level).map(([lv, w]): [string, number] => [lv, w]), random));
  const affix = () => weighted(Object.entries(B.affix) as ['blue' | 'orange', number][], random);
  const colour = (tier: 'blue' | 'orange', slots: number): GearRarity => `${slots >= 2 ? 'dark' : 'light'}${tier === 'blue' ? 'Blue' : 'Orange'}` as GearRarity;
  for (let n = between(P.gearPieces, random); n > 0; n--) {
    const kinds = dropGear(data, level());
    const slots = Number(weighted(Object.entries(B.slots).map(([s, w]): [string, number] => [s, w]), random));
    if (kinds.length) out.push({ item: rollGear(data.stats, pick(kinds, random), colour(affix(), slots), uid(), random) });
  }
  if (random() < P.accessoryChance) {
    const kinds = dropGear(data, level(), true);
    if (kinds.length) out.push({ item: rollGear(data.stats, pick(kinds, random), colour(affix(), 1), uid(), random) });
  }
  if (random() < P.agimatChance) {
    const stat = rollAgimatStat(data, random);
    const def = [...data.defs.values()].find((d) => !isGearDef(d) && d.kind === 'agimat' && d.stat === stat);
    if (def && !isGearDef(def)) out.push({ item: newAgimat(data.stats, def, pick(P.agimatLevels, random), uid()) });
  }
  if (random() < P.lampHatChance) {
    const hat = data.defs.get('lamp-hat');
    if (hat) out.push({ item: newItem(data.stats, hat, uid()) });
  }
  return out;
}

/** What a piece of loot is called (for logs and tests). */
export const lootLabel = (l: LootContent): string => ('kusing' in l ? `${l.kusing} Kusing` : `${(l.item as Item).defId}${l.item.count > 1 ? ` ×${l.item.count}` : ''}`);
