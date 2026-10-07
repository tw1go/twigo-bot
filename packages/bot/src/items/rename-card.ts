import { kvLoad, kvSave } from '../db/db.js';
import { getNickname, parseNickname, setNickname } from '../web/nickname.js';

// 🪪 Rename Cards (5 Kowens in /redeem and the town's sari-sari store; all of them share one bag slot): used from the bag
// in the web town, one changes your town nickname (the creator's rules: 3-16 letters, numbers, spaces, _ - . in
// between, nobody else's). Kept in kv 'rename-cards' (member → how many).

const KEY = 'rename-cards';
let held = kvLoad<Record<string, number>>(KEY, {});

export const renameCards = (userId: string) => held[userId] ?? 0;

export function addRenameCards(userId: string, n: number): number {
  held = { ...held, [userId]: renameCards(userId) + n };
  kvSave(KEY, held);
  return held[userId];
}

function useRenameCard(userId: string): void {
  const have = renameCards(userId);
  const { [userId]: _, ...rest } = held;
  held = have > 1 ? { ...rest, [userId]: have - 1 } : rest;
  kvSave(KEY, held);
}

export type RenameResult = { ok: true; nickname: string; cards: number } | { ok: false; error: string; cards: number };

/** Changes a member's nickname with one of their Rename Cards (only used if the new name is taken up). */
export function renameWithCard(userId: string, raw: unknown): RenameResult {
  const cards = renameCards(userId);
  if (!cards) return { ok: false, error: "You don't have a Rename Card. Get one at the sari-sari store.", cards };
  const nickname = parseNickname(raw);
  if (!nickname) return { ok: false, error: '3-16 letters or numbers; spaces, _ - . only in between.', cards };
  const fold = (n: string) => n.toLowerCase().replace(/[ _.-]/g, '');
  const now = getNickname(userId);
  if (now && fold(now) === fold(nickname) && now === nickname) return { ok: false, error: "That's already your name.", cards };
  if (setNickname(userId, nickname) === 'taken') return { ok: false, error: 'Someone already goes by that name.', cards };
  useRenameCard(userId);
  return { ok: true, nickname, cards: renameCards(userId) };
}
