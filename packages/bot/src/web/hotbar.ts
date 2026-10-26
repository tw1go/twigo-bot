import type { HotbarEntry, HotbarLayout } from '@mikazuki/shared';
import { kvLoad, kvSave } from '../db/db.js';

// 🎛️ Members' hotbars (POST /town/hotbar, /me `hotbars`): one layout per class a member has arranged, kept in kv
// 'hotbar:<userId>' so the same bar comes back on every device (it lived only in the browser before). The game decides
// what goes where; the bot only keeps it within bounds (`cleanHotbar`: the rows' sizes, each entry's shape, short
// strings), so a bad client can't store anything else. Any slot may hold a skill or an item (the game's open slots).
// The hotbar lock (CONTEXT.md Hotbar lock; POST /town/hotbar-lock, /me `hotbarLocked`): one switch per member, every
// class, kv 'hotbarLock:<userId>'.

/** The rows' sizes (ui/hotbar.ts SIZE). */
export const HOTBAR_ROWS: Record<keyof HotbarLayout, number> = { top: 13, main: 10, util: 3 };
const TEXT = 60;
const key = (userId: string) => `hotbar:${userId}`;

const text = (v: unknown, max = TEXT): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

/** One slot as the game sends it, or null (empty, or not a slot at all). */
function cleanEntry(e: unknown): HotbarEntry {
  if (!e || typeof e !== 'object') return null;
  const o = e as Record<string, unknown>;
  if (o.t === 'skill') {
    const name = text(o.name);
    return name ? { t: 'skill', name } : null;
  }
  if (o.t === 'item') {
    const id = text(o.id);
    const name = text(o.name);
    const emoji = text(o.emoji, 8) ?? '';
    const rarity = text(o.rarity, 20) ?? 'common';
    const cooldown = text(o.cooldown);
    return id && name ? { t: 'item', id, name, emoji, rarity, ...(cooldown ? { cooldown } : {}) } : null;
  }
  return null;
}

/** A layout within bounds (each row its size, every entry a slot or empty), or null when it isn't a layout at all. */
export function cleanHotbar(input: unknown): HotbarLayout | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const out = {} as HotbarLayout;
  for (const row of Object.keys(HOTBAR_ROWS) as (keyof HotbarLayout)[]) {
    const n = HOTBAR_ROWS[row];
    const list = Array.isArray(o[row]) ? (o[row] as unknown[]) : [];
    out[row] = Array.from({ length: n }, (_, i) => cleanEntry(list[i]));
  }
  return out;
}

/** A class id as the game names them (classes.json ids: short, lower case). */
export const isClassId = (cls: unknown): cls is string => typeof cls === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(cls);

/** Their hotbars, by class. */
export const hotbarsOf = (userId: string): Record<string, HotbarLayout> => kvLoad<Record<string, HotbarLayout>>(key(userId), {});

/** Keeps a class's hotbar for them (cleaned). Returns what was kept. */
export function saveHotbar(userId: string, cls: string, layout: unknown): HotbarLayout | null {
  const clean = cleanHotbar(layout);
  if (!clean) return null;
  const all = hotbarsOf(userId);
  all[cls] = clean;
  kvSave(key(userId), all);
  return clean;
}

const lockKey = (userId: string) => `hotbarLock:${userId}`;

/** Whether their hotbar is locked (undefined: never set: the game keeps this browser's). */
export const hotbarLockOf = (userId: string): boolean | undefined => kvLoad<boolean | null>(lockKey(userId), null) ?? undefined;

/** Locks or unlocks their hotbar (`locked` a boolean only). False: not a boolean. */
export function saveHotbarLock(userId: string, locked: unknown): boolean {
  if (typeof locked !== 'boolean') return false;
  kvSave(lockKey(userId), locked);
  return true;
}
