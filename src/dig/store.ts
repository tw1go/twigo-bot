import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { today } from '../time.js';
import { ITEM_BY_ID } from './items.js';

// Shovels, daily digs and inventories. A shovel bought in /redeem adds SHOVEL_USES digs.
export const SHOVEL_COST = 2;
export const SHOVEL_USES = 10;
export const DIGS_PER_DAY = 3;

interface Bag {
  shovel: number; // digs left on your shovel(s)
  digDay?: string; // YYYY-MM-DD that digsToday counts
  digsToday?: number;
  items: Record<string, number>; // itemId -> count
}

const DIR = 'data';
const FILE = `${DIR}/inventory.json`;
const bags: Record<string, Bag> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};

function save(): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(bags));
}

const bag = (userId: string) => (bags[userId] ??= { shovel: 0, items: {} });

export const shovelUses = (userId: string) => bags[userId]?.shovel ?? 0;

export function digsToday(userId: string): number {
  const b = bags[userId];
  return b?.digDay === today() ? (b.digsToday ?? 0) : 0;
}

export function addShovel(userId: string): number {
  const b = bag(userId);
  b.shovel += SHOVEL_USES;
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
