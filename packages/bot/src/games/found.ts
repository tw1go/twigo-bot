import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DATA_DIR } from '../paths.js';

// Which Easter eggs each member has found, so Marites Tea never hints at one they already know.
export type EggKey =
  | 'note' | '67' | 'wish' | 'secret-item' | '67-bet' | 'underdog' | 'photo-finish' | 'salute' | 'praise-bot' | 'christmas';

const DIR = DATA_DIR;
const FILE = `${DIR}/found.json`;
const found: Record<string, EggKey[]> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
const save = () => {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(found));
};

export const hasFound = (userId: string, key: EggKey) => found[userId]?.includes(key) ?? false;

export function markFound(userId: string, key: EggKey): void {
  if (hasFound(userId, key)) return;
  (found[userId] ??= []).push(key);
  save();
}

/** On startup: record eggs found before this tracking existed, from the eggs' own data files. */
export function backfillFound(): void {
  const read = (f: string) => (existsSync(`${DIR}/${f}`) ? JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')) : null);
  const eggs = read('easter-eggs.json') as Record<string, string[]> | null;
  for (const ids of Object.values(eggs ?? {})) for (const id of ids) markFound(id, 'note');
  for (const id of (read('egg67.json')?.rewarded as string[] | undefined) ?? []) markFound(id, '67');
  const secrets = read('secrets.json');
  for (const id of (secrets?.praiseRewarded as string[] | undefined) ?? []) markFound(id, 'praise-bot');
  for (const id of Object.keys(secrets?.salute ?? {})) markFound(id, 'salute');
  const inv = read('inventory.json') as Record<string, { items?: Record<string, number> }> | null;
  for (const [id, bag] of Object.entries(inv ?? {})) if (bag.items?.['twigo-tsinelas']) markFound(id, 'secret-item');
}
