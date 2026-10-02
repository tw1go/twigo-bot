import { db, kvLoad, kvSave } from '../db/db.js';
import { today } from '../time.js';
import { ITEM_BY_ID } from './items.js';
import { BAG_SLOTS } from '../games/rewards.js';

// Shovels, daily digs and inventories. A shovel bought in /redeem adds SHOVEL_USES digs; up to SHOVELS_PER_DAY a day.
export const SHOVEL_COST = 2;
export const SHOVEL_USES = 3;
export const SHOVELS_PER_DAY = 3;
export const DIGS_PER_DAY = SHOVEL_USES * SHOVELS_PER_DAY; // 9
// Inventory limit counts every item (stacks included). Bags from /redeem add slots, up to MAX_SLOTS.
export const BASE_SLOTS = 10;
export const MAX_SLOTS = 50;

interface Bag {
  shovel: number; // digs left on your shovel(s)
  digDay?: string; // YYYY-MM-DD that digsToday counts
  digsToday?: number;
  shovelDay?: string; // YYYY-MM-DD that shovelsToday counts
  shovelsToday?: number;
  bags?: string[]; // bag reward ids owned (each adds slots)
  keys?: number; // Master Keys (see /steal)
  items: Record<string, number>; // itemId -> count
}

// Dig state lives in `dig_state` (one row per member) and items in `inventory_items` (see db/db.ts). Cached in
// memory; every save() writes the whole set in one transaction.
interface DigRow {
  user_id: string;
  shovel: number;
  dig_day: string | null;
  digs_today: number | null;
  shovel_day: string | null;
  shovels_today: number | null;
  keys: number | null;
  bags: string | null;
}
const opt = <T>(v: T | null): T | undefined => (v === null ? undefined : v);
const bags: Record<string, Bag> = {};
for (const r of db.prepare<[], DigRow>('SELECT * FROM dig_state').all()) {
  bags[r.user_id] = {
    shovel: r.shovel,
    digDay: opt(r.dig_day),
    digsToday: opt(r.digs_today),
    shovelDay: opt(r.shovel_day),
    shovelsToday: opt(r.shovels_today),
    keys: opt(r.keys),
    bags: r.bags ? (JSON.parse(r.bags) as string[]) : undefined,
    items: {},
  };
}
for (const r of db.prepare<[], { user_id: string; item_id: string; count: number }>('SELECT * FROM inventory_items').all()) {
  (bags[r.user_id] ??= { shovel: 0, items: {} }).items[r.item_id] = r.count;
}

const upsertDig = db.prepare(`INSERT INTO dig_state (user_id, shovel, dig_day, digs_today, shovel_day, shovels_today, keys, bags)
  VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET shovel = excluded.shovel, dig_day = excluded.dig_day,
  digs_today = excluded.digs_today, shovel_day = excluded.shovel_day, shovels_today = excluded.shovels_today,
  keys = excluded.keys, bags = excluded.bags`);
const clearItems = db.prepare('DELETE FROM inventory_items WHERE user_id = ?');
const insertItem = db.prepare('INSERT INTO inventory_items (user_id, item_id, count) VALUES (?,?,?)');

const writeAll = db.transaction(() => {
  for (const [id, b] of Object.entries(bags)) {
    upsertDig.run(id, b.shovel, b.digDay ?? null, b.digsToday ?? null, b.shovelDay ?? null, b.shovelsToday ?? null,
      b.keys ?? null, b.bags ? JSON.stringify(b.bags) : null);
    clearItems.run(id);
    for (const [itemId, count] of Object.entries(b.items)) if (count > 0) insertItem.run(id, itemId, count);
  }
});

function save(): void {
  writeAll();
}

const bag = (userId: string) => (bags[userId] ??= { shovel: 0, items: {} });

export const shovelUses = (userId: string) => bags[userId]?.shovel ?? 0;

export function digsToday(userId: string): number {
  const b = bags[userId];
  return b?.digDay === today() ? (b.digsToday ?? 0) : 0;
}

/** Shovels bought today (resets at midnight). */
export function shovelsBoughtToday(userId: string): number {
  const b = bags[userId];
  if (b?.shovelDay !== today()) return 0;
  return b.shovelsToday ?? 1; // older records only knew "bought today"
}

export function addShovel(userId: string): number {
  const b = bag(userId);
  b.shovel += SHOVEL_USES;
  b.shovelsToday = shovelsBoughtToday(userId) + 1;
  b.shovelDay = today();
  save();
  return b.shovel;
}

/** Uses one dig (shovel + daily count) and stores the find. Caller checks limits first. */
export function recordDig(userId: string, itemId: string): void {
  const b = bag(userId);
  const day = today();
  if (b.digDay !== day) {
    b.digDay = day;
    b.digsToday = 0;
  }
  b.digsToday = (b.digsToday ?? 0) + 1;
  b.shovel -= 1;
  b.items[itemId] = (b.items[itemId] ?? 0) + 1;
  save();
}

/** [itemId, count] for everything the member owns. */
export function inventory(userId: string): [string, number][] {
  return Object.entries(bags[userId]?.items ?? {}).filter(([id, n]) => n > 0 && ITEM_BY_ID.has(id));
}

/** Removes up to `count` of an item. Returns how many were removed. */
export function removeItems(userId: string, itemId: string, count: number): number {
  const b = bags[userId];
  const have = b?.items[itemId] ?? 0;
  const removed = Math.min(have, count);
  if (!removed) return 0;
  b.items[itemId] = have - removed;
  if (!b.items[itemId]) delete b.items[itemId];
  save();
  return removed;
}

export const ownedBags = (userId: string) => bags[userId]?.bags ?? [];

export function addBag(userId: string, bagId: string): void {
  const b = bag(userId);
  b.bags = [...new Set([...(b.bags ?? []), bagId])];
  save();
}

/** Items held, counting every copy. */
export const itemCount = (userId: string) => Object.values(bags[userId]?.items ?? {}).reduce((a, b) => a + b, 0);

/** Inventory capacity: BASE_SLOTS + BAG_SLOTS for each bag owned, capped at MAX_SLOTS. */
export const capacity = (userId: string) => Math.min(MAX_SLOTS, BASE_SLOTS + ownedBags(userId).length * BAG_SLOTS);

export const masterKeys = (userId: string) => bags[userId]?.keys ?? 0;

export function addMasterKey(userId: string): number {
  const b = bag(userId);
  b.keys = (b.keys ?? 0) + 1;
  save();
  return b.keys;
}

/** Uses one Master Key. Returns false if they had none. */
export function useMasterKey(userId: string): boolean {
  const b = bags[userId];
  if (!b?.keys) return false;
  b.keys -= 1;
  save();
  return true;
}

// Server-wide lucky dig: every LUCKY_EVERY-th dig by anyone is guaranteed Epic or better.
export const LUCKY_EVERY = 60;
let luckyCount: number = kvLoad<{ count?: number }>('lucky-dig.json', {}).count ?? 0;

/** Counts a dig. Returns true if this one is the lucky dig (and resets the counter). */
export function countServerDig(): boolean {
  luckyCount += 1;
  const lucky = luckyCount >= LUCKY_EVERY;
  if (lucky) luckyCount = 0;
  kvSave('lucky-dig.json', { count: luckyCount });
  return lucky;
}

/** Digs so far toward the next lucky dig. */
export const serverDigProgress = () => luckyCount;
