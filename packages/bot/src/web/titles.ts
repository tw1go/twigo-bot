import { db } from '../db/db.js';

// Titles: shown under a member's nickname in the web game, as <Title>. Everyone is a Townfolk to begin with (that
// one isn't stored); others will be earned as rewards and land in the titles table, one of them equipped.

export const TITLES: Record<string, string> = {
  townfolk: 'Townfolk',
};
export const DEFAULT_TITLE = 'townfolk';

const equippedStmt = db.prepare<[string], { title: string }>('SELECT title FROM titles WHERE user_id = ? AND equipped = 1');

/** The member's equipped title, as shown ("Townfolk" unless they've equipped another). */
export function titleOf(userId: string): string {
  const id = equippedStmt.get(userId)?.title;
  return TITLES[id ?? DEFAULT_TITLE] ?? TITLES[DEFAULT_TITLE];
}
