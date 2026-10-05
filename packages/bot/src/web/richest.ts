import { kvLoad, kvSave } from '../db/db.js';
import { topBalances } from '../credits/store.js';
import { RICHEST, earnTitle, setAutoHolder } from './titles.js';

// 💰 <Richest Among All>: always held by the leaderboard's #1 (most Kowens, wallet + vault, as topBalances ranks them).
// Checked whenever someone's Kowens change (a moment later, so a burst of changes is one check) and at startup. The new
// #1 gets it (the first time ever: the reward pop-up and the Parlor's NEW tag); the one before loses it (if they were
// wearing it, they show Townfolk again). The holder is kept in kv 'richest', so a restart doesn't re-announce anyone.

const KEY = 'richest';
const state = kvLoad<{ holder: string | null }>(KEY, { holder: null });
setAutoHolder(RICHEST, state.holder);

/** What changed: who took the top spot (first = never had the title before) and who lost it. */
export interface RichestChange {
  won: { userId: string; first: boolean } | null;
  lost: string | null;
}

/** The leaderboard's #1 now holds the title. Null when nothing changed. */
export function checkRichest(): RichestChange | null {
  const top = topBalances(1)[0]?.[0] ?? null;
  if (top === state.holder) return null;
  const lost = state.holder;
  state.holder = top;
  kvSave(KEY, state);
  setAutoHolder(RICHEST, top);
  return { won: top ? { userId: top, first: earnTitle(top, RICHEST) } : null, lost };
}

export const richestHolder = () => state.holder;
