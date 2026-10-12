import { type Item, type ItemData, affixTier, isGearDef, itemStats } from './items.js';
import { type StatsData, gearKind } from './stats.js';

// 🎲 Rare loot a party rolls for (stats.json lootRoll, a repo addition): when one of these drops for several players (a
// party's kill in the Slums, anyone in a Scrap Warrens run) it isn't left on the ground: everyone it dropped for gets a
// pop-up, Roll or Pass, `seconds` to decide; rolls are 1..`max` and the highest wins it (the bot: web/town-roll.ts).
// Which items: of the `tier` (orange) named by one of the stats (an item's third line names it: "of Calamity" is crit
// rate or crit damage, "of Flamboyance" damage amp, "of Bloodlust" lifesteal), gear with at least `gear.minSlots` agimat
// slots and a `gear.stats` name, or an accessory with an `accessories.stats` name.

export interface LootRollRules {
  seconds: number;
  max: number;
}

export function lootRollRules(data: StatsData): LootRollRules {
  const r = itemStats(data).lootRoll;
  return { seconds: r?.seconds ?? 10, max: r?.max ?? 1000 };
}

/** Whether this item is rolled for when it drops for several players. */
export function rollWorthy(data: ItemData, item: Item): boolean {
  const R = itemStats(data.stats).lootRoll;
  const def = data.defs.get(item.defId);
  if (!R || !isGearDef(def) || item.broken) return false;
  if (affixTier(data.stats, item.rarity) !== R.tier) return false;
  const third = item.lines[2]?.stat;
  if (!third) return false;
  if (gearKind(def.slot) === 'accessory') return R.accessories.stats.includes(third);
  return item.agimats.length >= R.gear.minSlots && R.gear.stats.includes(third);
}
