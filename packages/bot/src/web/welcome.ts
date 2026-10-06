import { add } from '../credits/store.js';
import { db, kvLoad, kvSave } from '../db/db.js';
import { kowen } from '../kowens.js';

// 🎁 The welcome gift: WELCOME_KOWENS for every member with a character in the web game (a look and a nickname), once.
// New players get it as they finish the character creator; everyone who already had a character got it when this
// came in (`welcomeEveryone` at startup gives anyone who hasn't had it). The game shows it in the reward pop-up on
// the next visit (`/me` welcomeGift → POST /welcome/seen). Kept in kv 'welcome-gift'.

export const WELCOME_KOWENS = 50;

type Gift = { at: number; seen?: boolean };
const KEY = 'welcome-gift';
let gifts = kvLoad<Record<string, Gift>>(KEY, {});
const save = () => {
  gifts = { ...gifts };
  kvSave(KEY, gifts);
};

const charactersStmt = db.prepare<[], { user_id: string }>('SELECT o.user_id FROM outfits o JOIN nicknames n ON n.user_id = o.user_id');
const hasCharacterStmt = db.prepare<[string], { user_id: string }>('SELECT o.user_id FROM outfits o JOIN nicknames n ON n.user_id = o.user_id WHERE o.user_id = ?');

/** Gives the gift if they have a character and haven't had it; true if it was given now. */
export function welcome(userId: string): boolean {
  if (gifts[userId] || !hasCharacterStmt.get(userId)) return false;
  gifts[userId] = { at: Date.now() };
  save();
  add(userId, WELCOME_KOWENS);
  console.log(`[welcome] ${userId} got the welcome gift (${WELCOME_KOWENS} ${kowen(WELCOME_KOWENS)})`);
  return true;
}

/** Everyone with a character who hasn't had the gift gets it (at startup); returns how many. */
export function welcomeEveryone(): number {
  let n = 0;
  for (const { user_id } of charactersStmt.all()) if (welcome(user_id)) n++;
  return n;
}

/** The gift to show in the game, until it's been seen. */
export const welcomeGift = (userId: string): number | null => (gifts[userId] && !gifts[userId].seen ? WELCOME_KOWENS : null);

export function welcomeSeen(userId: string): void {
  const g = gifts[userId];
  if (!g || g.seen) return;
  g.seen = true;
  save();
}
