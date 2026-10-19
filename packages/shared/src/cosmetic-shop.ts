import type { AdventureState, CosmeticPlace } from './adventure.js';
import type { TownShopItem } from './room-api.js';
import { eventEndDay, type EventWindow } from './events.js';
import { type CombatItemDef, type Item, type ItemData, addToBag, isExpired, isGearDef, newItem, pocketOf, pocketSlots, pocketUsed } from './items.js';

// 👘 The sari-sari store's Cosmetics tab (CONTEXT.md Cosmetic, Set): every cosmetic kind with `shop: "cosmetic"`
// (items.json), a Head for stats.json cosmeticShop.headPrice and a Body for bodyPrice in Kowens, and each Set (the Head and
// Body sharing a `set`) for setPrice. One with an `event` is sold only while that event is on (the Witch Hat and Robe:
// Halloween; the store's are permanent kinds of their own, Biikko's drops the 5-day ones). Bought one at a time, into the
// Costume pocket, bound; never one you already have (in the Costume tab or worn; a timed one only until it runs out).

/** stats.json cosmeticShop: Kowens for a Head, a Body, or both as a Set. */
export interface CosmeticShopRules {
  headPrice: number;
  bodyPrice: number;
  setPrice: number;
}

export const cosmeticShopRules = (stats: ItemData['stats']): CosmeticShopRules | null =>
  ((stats as { cosmeticShop?: CosmeticShopRules }).cosmeticShop ?? null);

/** An event as the store needs it: whether it's on, and its window (for "until Nov 4"). */
export type ShopEvents = Record<string, { on: boolean; window: EventWindow }>;

/** A cosmetic on sale: one piece, or a Set (id `set:<set>`, its `pieces` Head then Body). */
export interface CosmeticWare {
  id: string;
  name: string;
  cost: number;
  /** A piece's place (a Set has none). */
  place?: CosmeticPlace;
  /** The Set it belongs to (a Set's own). */
  set?: string;
  /** A Set's pieces, Head then Body. */
  pieces?: string[];
  about: string;
  /** Sold only during an event: "Halloween only, until Nov 4". */
  limited?: string;
  /** A piece they already have (a Set they have a piece of isn't listed). */
  owned?: boolean;
}

/** A Set's name: "ember-imp" → "Ember Imp Set". */
export const setName = (set: string) => `${set.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} Set`;

/** The id a Set is sold under. */
export const setWareId = (set: string) => `set:${set}`;

/** Whether they have a cosmetic of this kind: in the Costume tab or worn (a timed one that hasn't run out). */
export function hasCosmetic(s: Pick<AdventureState, 'bag' | 'cosmetics'>, defId: string, now: number): boolean {
  const mine = (it: Item | undefined) => !!it && it.defId === defId && !isExpired(it, now);
  return s.bag.some(mine) || Object.values(s.cosmetics).some(mine);
}

const eventName = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

/** Every cosmetic kind on sale now (an event's only while it's on), in items.json's order. */
function onSale(data: ItemData, events: ShopEvents): (CombatItemDef & { cosmeticPlace: CosmeticPlace })[] {
  const out: (CombatItemDef & { cosmeticPlace: CosmeticPlace })[] = [];
  for (const def of data.defs.values()) {
    if (isGearDef(def) || def.kind !== 'cosmetic' || !def.cosmeticPlace || def.shop !== 'cosmetic') continue;
    if (def.event && !events[def.event]?.on) continue;
    out.push({ ...def, cosmeticPlace: def.cosmeticPlace });
  }
  return out;
}

/** What the Cosmetics tab sells them now: each piece (owned ones marked), then a Set for every Set with both pieces on
 *  sale and neither owned. Empty without stats.json cosmeticShop. */
export function cosmeticWares(data: ItemData, s: Pick<AdventureState, 'bag' | 'cosmetics'>, events: ShopEvents, now: number): CosmeticWare[] {
  const R = cosmeticShopRules(data.stats);
  if (!R) return [];
  const defs = onSale(data, events);
  const limited = (def: CombatItemDef) => {
    const e = def.event ? events[def.event] : undefined;
    return e ? { limited: `${eventName(def.event!)} only, until ${eventEndDay(e.window)}` } : {};
  };
  const pieces: CosmeticWare[] = defs.map((def) => ({
    id: def.id,
    name: def.name,
    cost: def.cosmeticPlace === 'head' ? R.headPrice : R.bodyPrice,
    place: def.cosmeticPlace,
    ...(def.set ? { set: def.set } : {}),
    about: def.about ?? '',
    ...limited(def),
    ...(hasCosmetic(s, def.id, now) ? { owned: true } : {}),
  }));
  const sets: CosmeticWare[] = [];
  for (const set of new Set(defs.flatMap((d) => (d.set ? [d.set] : [])))) {
    const head = defs.find((d) => d.set === set && d.cosmeticPlace === 'head');
    const body = defs.find((d) => d.set === set && d.cosmeticPlace === 'body');
    if (!head || !body || hasCosmetic(s, head.id, now) || hasCosmetic(s, body.id, now)) continue;
    sets.push({ id: setWareId(set), name: setName(set), cost: R.setPrice, set, pieces: [head.id, body.id], about: `The ${head.name} and the ${body.name} together.`, ...limited(head) });
  }
  return [...pieces, ...sets];
}

/** A cosmetic ware as the store's page shows it (one at a time: `max` 1, or 0 once theirs). */
export const cosmeticShopItem = (w: CosmeticWare): TownShopItem => ({
  id: w.id,
  name: w.name,
  cost: w.cost,
  kind: 'cosmetic',
  about: w.about,
  max: w.owned ? 0 : 1,
  ...(w.owned ? { owned: true } : {}),
  ...(w.place ? { cosmeticPlace: w.place } : {}),
  ...(w.set ? { set: w.set } : {}),
  ...(w.pieces ? { pieces: w.pieces } : {}),
  ...(w.limited ? { limited: w.limited } : {}),
});

const plural = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'Kowen' : 'Kowens'}`;

/** Buys a cosmetic or a Set (`id`): checked (on sale, not already theirs, room in the Costume tab, Kowens), paid and put
 *  in the Costume tab bound (a timed one's days start now). Kowens come from `kowens` (spend false: not enough). */
export function buyCosmetic(
  data: ItemData,
  s: Pick<AdventureState, 'bag' | 'cosmetics'>,
  id: string,
  events: ShopEvents,
  kowens: { have: number; spend(n: number): boolean },
  uid: () => string,
  now = Date.now(),
): { ok: boolean; message: string; ware?: CosmeticWare } {
  const wares = cosmeticWares(data, s, events, now);
  const ware = wares.find((w) => w.id === id);
  if (!ware && id.startsWith('set:')) {
    // A Set that's hidden because they have a piece of it: say which.
    const set = id.slice(4);
    const pieces = wares.filter((w) => w.set === set && w.place);
    const have = pieces.find((w) => w.owned);
    if (have && pieces.length === 2) {
      const other = pieces.find((w) => w !== have)!;
      return { ok: false, message: other.owned ? `You already have the ${setName(set)}.` : `You already have the ${have.name}. Buy the ${other.name} on its own.` };
    }
  }
  if (!ware) return { ok: false, message: "That isn't for sale." };
  if (ware.owned) return { ok: false, message: `You already have the ${ware.name}.` };
  const ids = ware.pieces ?? [ware.id];
  const pocket = pocketOf(data, { defId: ids[0] });
  const free = pocketSlots(data, pocket) - pocketUsed(data, s.bag, pocket);
  if (free < ids.length) return { ok: false, message: ids.length > 1 && free > 0 ? 'A Set needs 2 free slots in your Costume tab.' : 'Your Costume tab is full.' };
  if (kowens.have < ware.cost) return { ok: false, message: `You need ${plural(ware.cost)} but have ${plural(kowens.have)}.` };
  if (!kowens.spend(ware.cost)) return { ok: false, message: `You need ${plural(ware.cost)}.` };
  for (const defId of ids) {
    const item = newItem(data.stats, data.defs.get(defId)!, uid());
    addToBag(data, s.bag, { ...item, bound: true }, uid, now);
  }
  return { ok: true, message: `Bought the ${ware.name}!`, ware };
}
