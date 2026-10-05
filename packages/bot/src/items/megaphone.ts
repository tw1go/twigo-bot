import { kvLoad, kvSave } from '../db/db.js';

// 📢 Megaphones (1 Kowen in /redeem and the town's shop; one bag slot each): `/m message` in the town's chat uses one,
// and the message runs across everyone's screen in sky blue. Kept in kv 'megaphones' (member → how many).

const KEY = 'megaphones';
let held = kvLoad<Record<string, number>>(KEY, {});

export const megaphones = (userId: string) => held[userId] ?? 0;

export function addMegaphones(userId: string, n: number): number {
  held = { ...held, [userId]: megaphones(userId) + n };
  kvSave(KEY, held);
  return held[userId];
}

/** Uses one; how many are left, or null if they had none. */
export function useMegaphone(userId: string): number | null {
  const have = megaphones(userId);
  if (!have) return null;
  const { [userId]: _, ...rest } = held;
  held = have > 1 ? { ...rest, [userId]: have - 1 } : rest;
  kvSave(KEY, held);
  return have - 1;
}
