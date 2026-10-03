import { db, kvLoad } from '../db/db.js';
import { tableSync } from '../db/sync.js';

// Which Easter eggs each member has found, so Marites Tea never hints at one they already know.
export type EggKey =
  | 'note' | '67' | 'wish' | 'secret-item' | '67-bet' | 'underdog' | 'photo-finish' | 'salute' | 'praise-bot' | 'christmas';

const table = tableSync<{ user_id: string; egg: string }>('eggs_found', ['user_id', 'egg'], []);
const found: Record<string, EggKey[]> = {};
for (const r of table.load()) (found[r.user_id] ??= []).push(r.egg as EggKey);
const save = () => table.save(Object.entries(found).flatMap(([user_id, eggs]) => eggs.map((egg) => ({ user_id, egg }))));

export const hasFound = (userId: string, key: EggKey) => found[userId]?.includes(key) ?? false;

export function markFound(userId: string, key: EggKey): void {
  if (hasFound(userId, key)) return;
  (found[userId] ??= []).push(key);
  save();
}

/** On startup: record eggs found before this tracking existed, from the eggs' own stored state. */
export function backfillFound(): void {
  const ids = (sql: string) => db.prepare<[], { user_id: string }>(sql).all().map((r) => r.user_id);
  for (const id of ids('SELECT user_id FROM easter_egg_finds')) markFound(id, 'note');
  for (const id of kvLoad<{ rewarded?: string[] }>('egg67.json', {}).rewarded ?? []) markFound(id, '67');
  for (const id of ids('SELECT user_id FROM secret_progress WHERE praise_rewarded = 1')) markFound(id, 'praise-bot');
  for (const id of ids('SELECT user_id FROM secret_progress WHERE salute_day IS NOT NULL')) markFound(id, 'salute');
  for (const id of ids("SELECT user_id FROM inventory_items WHERE item_id = 'twigo-tsinelas'")) markFound(id, 'secret-item');
}
