import { db, kvLoad, kvSave } from '../db/db.js';

// Which Easter eggs each member has found, so Marites Tea never hints at one they already know.
export type EggKey =
  | 'note' | '67' | 'wish' | 'secret-item' | '67-bet' | 'underdog' | 'photo-finish' | 'salute' | 'praise-bot' | 'christmas';

const KEY = 'found.json'; // kv key (its old file name)
const found: Record<string, EggKey[]> = kvLoad(KEY, {});
const save = () => {
  kvSave(KEY, found);
};

export const hasFound = (userId: string, key: EggKey) => found[userId]?.includes(key) ?? false;

export function markFound(userId: string, key: EggKey): void {
  if (hasFound(userId, key)) return;
  (found[userId] ??= []).push(key);
  save();
}

/** On startup: record eggs found before this tracking existed, from the eggs' own stored state. */
export function backfillFound(): void {
  const read = (key: string) => kvLoad<any>(key, null);
  const eggs = read('easter-eggs.json') as Record<string, string[]> | null;
  for (const ids of Object.values(eggs ?? {})) for (const id of ids) markFound(id, 'note');
  for (const id of (read('egg67.json')?.rewarded as string[] | undefined) ?? []) markFound(id, '67');
  const secrets = read('secrets.json');
  for (const id of (secrets?.praiseRewarded as string[] | undefined) ?? []) markFound(id, 'praise-bot');
  for (const id of Object.keys(secrets?.salute ?? {})) markFound(id, 'salute');
  const tsinelas = db.prepare<[], { user_id: string }>("SELECT user_id FROM inventory_items WHERE item_id = 'twigo-tsinelas'").all();
  for (const { user_id } of tsinelas) markFound(user_id, 'secret-item');
}
