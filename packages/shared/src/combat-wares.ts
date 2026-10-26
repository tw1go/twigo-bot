import { type CombatItemDef, type ItemData, isGearDef, itemStats } from './items.js';
import { boxPrice } from './pets.js';

// 🛒 What the sari-sari store's combat tabs sell a character (Healing, Smithing, Dungeons, Travel, Pets): every kind with
// a `shop` and a price whose tier they've reached (the Low tier always; higher ones hidden until then: the Polished
// Whetstone and Mid Repair Kit from Lv 30). The bot's store (web/town-shop.ts) and the game's pretend one in dev
// (ui/shop.ts) both list them from here, so the dev store never falls behind. Pure.

export interface CombatWare {
  def: CombatItemDef;
  tab: 'healing' | 'smithing' | 'dungeons' | 'travel' | 'pets';
  cost: number;
  currency: 'kusing' | 'kowens';
}

/** A tier's first level: a potion's minLevel, a gear tier's first item level (stats.json). Low is always open. */
function tierFrom(data: ItemData, def: CombatItemDef): number {
  const S = itemStats(data.stats);
  if (!def.tier) return 1;
  if (def.kind === 'potion') return S.potions.tiers[def.tier]?.minLevel ?? Infinity;
  const levels = (S.gearTiers[def.tier] as { levels?: number[] } | undefined)?.levels;
  return levels?.[0] ?? Infinity;
}

/** What the store sells a character at `level`. `ticketPrice`: a dungeon ticket's price in Kusing
 *  (classes/dungeons.json), or null. */
export function combatWares(data: ItemData, level: number, ticketPrice: (id: string) => number | null = () => null): CombatWare[] {
  const S = itemStats(data.stats);
  const out: CombatWare[] = [];
  for (const def of data.defs.values()) {
    if (isGearDef(def) || !def.shop) continue;
    if (def.tier !== 'low' && tierFrom(data, def) > level) continue;
    if (def.shop === 'potion') {
      const tier = def.tier ? S.potions.tiers[def.tier] : undefined;
      if (tier) out.push({ def, tab: 'healing', cost: tier.kusing, currency: 'kusing' });
    } else if (def.shop === 'pets') {
      // A pet box (stats.json pets.boxPrice by its pet's rarity, in Kowens), in the Pets tab.
      const price = boxPrice(data, def.id);
      if (price) out.push({ def, tab: 'pets', cost: price, currency: 'kowens' });
    } else if (def.shop === 'ticket') {
      // A dungeon's ticket (classes/dungeons.json: its shop price in Kusing), in the Dungeons tab.
      const price = ticketPrice(def.id);
      if (price) out.push({ def, tab: 'dungeons', cost: price, currency: 'kusing' });
    } else if (def.price) {
      // Its own price (items.json): Kusing (the Travel tab's Return Lantern) or Kowens (Smithing's Agimat Pliers, Temper
      // Stones, the Polished Whetstone and Mid Repair Kit).
      const tab = def.shop === 'travel' ? 'travel' : 'smithing';
      if (def.price.kusing) out.push({ def, tab, cost: def.price.kusing, currency: 'kusing' });
      else if (def.price.kowens) out.push({ def, tab, cost: def.price.kowens, currency: 'kowens' });
    } else if (def.shop === 'whetstone' || def.shop === 'repairKit') out.push({ def, tab: 'smithing', cost: S.currencies.kowensShop[def.shop], currency: 'kowens' });
  }
  return out;
}

/** What a combat item does, as the store says it: a potion's heal and its cooldown, else its `about`. */
export function combatWareAbout(data: ItemData, def: CombatItemDef): string {
  const S = itemStats(data.stats);
  const tier = def.kind === 'potion' && def.heals && def.tier ? S.potions.tiers[def.tier] : undefined;
  if (tier && def.heals) return `Heals ${tier[def.heals]} ${def.heals.toUpperCase()} at once. Put it on your hotbar; HP and MP Potions each have their own ${S.potions.sharedCooldownSec} s cooldown.`;
  return def.about ?? '';
}
