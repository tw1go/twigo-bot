import {
  type AdventureState,
  type CombatItemDef,
  type GearRarity,
  type Item,
  type ItemData,
  addToBag,
  bagRoom,
  isGearDef,
  itemStats,
  newItem,
  rollGear,
  stackLimit,
  takeKind,
} from '@mikazuki/shared';

// 💰 A character's combat bag and Kusing wallet, pure (the bot keeps them with the character, web/adventure.ts; the game's
// dev server in memory): loot picked up (Kusing always fits; an item only if the bag has room), HP and MP Potions used,
// the sari-sari store's Healing tab (HP/MP Potions for Kusing) and Smithing tab (whetstones and Repair Kits for Kowens),
// by stats.json's prices; only the Low tier is sold until a character reaches the next tier's level. And dev's ?give=.

/** The parts of a character that hold items and money. */
export type CombatItems = Pick<AdventureState, 'equipped' | 'bag' | 'kusing'>;

/** What lies on the ground: Kusing, or an item. */
export type LootContent = { kusing: number } | { item: Item };

/** Picks loot up: Kusing into the wallet, an item into the bag (false, nothing taken, when it has no room). */
export function takeLoot(data: ItemData, c: CombatItems, loot: LootContent, uid: () => string): boolean {
  if ('kusing' in loot) {
    c.kusing += Math.max(0, Math.floor(loot.kusing));
    return true;
  }
  return addToBag(data, c.bag, structuredClone(loot.item), uid);
}

/** An HP or MP Potion kind: what it heals and how much (stats.json potions.tiers[its tier]); null for anything else. */
export function potionOf(data: ItemData, defId: string): { heals: 'hp' | 'mp'; amount: number } | null {
  const def = data.defs.get(defId);
  if (isGearDef(def) || def?.kind !== 'potion' || !def.heals || !def.tier) return null;
  const tier = itemStats(data.stats).potions.tiers[def.tier];
  return tier ? { heals: def.heals, amount: tier[def.heals] } : null;
}

/** Uses one HP or MP Potion of a kind from the bag: what it heals, or null (not a potion, or none left). */
export function usePotion(data: ItemData, c: CombatItems, defId: string): { heals: 'hp' | 'mp'; amount: number } | null {
  const p = potionOf(data, defId);
  if (!p || !takeKind(c.bag, defId, 1)) return null;
  return p;
}

// ── The sari-sari store's Healing and Smithing tabs ──

/** A combat item on sale: its kind, price and money (Kusing for HP/MP Potions, Kowens for whetstones and Repair Kits). */
export interface CombatWare {
  def: CombatItemDef;
  tab: 'healing' | 'smithing';
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

/** What the store sells a character at `level`: every kind with a `shop` price whose tier they've reached (the Low tier
 *  always; higher ones stay hidden until then). */
export function combatWares(data: ItemData, level: number): CombatWare[] {
  const S = itemStats(data.stats);
  const out: CombatWare[] = [];
  for (const def of data.defs.values()) {
    if (isGearDef(def) || !def.shop) continue;
    if (def.tier !== 'low' && tierFrom(data, def) > level) continue;
    if (def.shop === 'potion') {
      const tier = def.tier ? S.potions.tiers[def.tier] : undefined;
      if (tier) out.push({ def, tab: 'healing', cost: tier.kusing, currency: 'kusing' });
    } else out.push({ def, tab: 'smithing', cost: S.currencies.kowensShop[def.shop], currency: 'kowens' });
  }
  return out;
}

/** How many of a kind the bag can still take. */
export const roomFor = (data: ItemData, c: CombatItems, defId: string) => {
  const def = data.defs.get(defId);
  return def ? bagRoom(data, c.bag, newItem(data.stats, def, '')) : 0;
};

/** The most bought at once: one slot's stack. */
export const mostAtOnce = (data: ItemData, defId: string) => stackLimit(data.stats, data.defs.get(defId));

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const money = (n: number, currency: 'kusing' | 'kowens') => (currency === 'kusing' ? `${n.toLocaleString('en-US')} Kusing` : plural(n, 'Kowen'));

/** Buys `quantity` of a combat item: checked (on sale for their level, money, room), the money taken and the items put in
 *  the bag. Kowens come from `kowens` (the bot's wallet; spend returns false if there aren't enough). */
export function buyCombat(
  data: ItemData,
  c: CombatItems,
  level: number,
  defId: string,
  quantity: number,
  kowens: { have: number; spend(n: number): boolean },
  uid: () => string,
): { ok: boolean; message: string; ware?: CombatWare; quantity?: number } {
  const ware = combatWares(data, level).find((w) => w.def.id === defId);
  if (!ware) return { ok: false, message: "That isn't for sale." };
  const n = Math.floor(quantity);
  if (!Number.isFinite(n) || n < 1 || n > mostAtOnce(data, defId)) return { ok: false, message: `Buy 1 to ${mostAtOnce(data, defId)} at a time.` };
  const total = ware.cost * n;
  const have = ware.currency === 'kusing' ? c.kusing : kowens.have;
  if (have < total) {
    const can = Math.floor(have / ware.cost);
    return { ok: false, message: `You need ${money(total, ware.currency)} but have ${money(have, ware.currency)}.${can > 0 ? ` You can afford ${can}.` : ''}` };
  }
  const room = roomFor(data, c, defId);
  if (room < n) return { ok: false, message: room ? `Your combat bag only has room for ${room} more.` : 'Your combat bag is full.' };
  if (ware.currency === 'kusing') c.kusing -= total;
  else if (!kowens.spend(total)) return { ok: false, message: `You need ${money(total, 'kowens')}.` };
  addToBag(data, c.bag, newItem(data.stats, ware.def, uid(), n), uid);
  return { ok: true, message: `Bought ${n > 1 ? `${n}× ` : ''}${ware.def.name}!`, ware, quantity: n };
}

/** Dev (?give=): an item of a kind, rolled as the server rolls drops (gear of `rarity` with its lines, at `plus`), or a
 *  stack of anything else; into the bag if it fits. */
export function devGive(data: ItemData, c: CombatItems, defId: string, opts: { rarity?: GearRarity; plus?: number; count?: number; level?: number }, uid: () => string, random: () => number = Math.random): Item | null {
  const def = data.defs.get(defId);
  if (!def) return null;
  let item: Item;
  if (isGearDef(def)) {
    item = rollGear(data.stats, def, opts.rarity ?? def.rarity, uid(), random);
    item.plus = Math.max(0, Math.min(20, Math.floor(opts.plus ?? 0)));
  } else {
    item = newItem(data.stats, def, uid(), opts.count ?? 1);
    if (def.kind === 'agimat' && opts.level) item.level = opts.level;
  }
  return addToBag(data, c.bag, item, uid) ? item : null;
}
