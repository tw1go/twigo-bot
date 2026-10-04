import type { TitleData } from '@mikazuki/shared';
import { db } from '../db/db.js';

// Titles: shown under a member's name in the web game, as <Title>, in the title's colour ('prismatic' = a shifting
// rainbow). Everyone is a Townfolk to begin with (that one isn't stored); others are given with /gift title (and
// later earned as rewards) and land in the titles table, one of them equipped. A new title is announced once in
// the game (announced = when), whichever device the member uses first.

export const TITLES: Record<string, TitleData> = {
  townfolk: { name: 'Townfolk', color: '#B794F6' },
  'game-master': { name: 'Game Master', color: 'prismatic' },
  fairy: { name: 'She was a Fairy', color: '#F0ABFC' },
  'low-battery': { name: '20% Battery Life', color: '#F8BF27' },
  'thank-kyuuu': { name: 'Thank Kyuuu', color: '#F8BF27' },
  junwuurat: { name: 'junwuurat', color: '#F8BF27' },
  'licensed-overthinker': { name: 'Licensed Overthinker', color: '#F8BF27' },
  'specimen-3': { name: 'Specimen #3', color: '#F8BF27' },
  kalbo: { name: 'Kalbo', color: '#F8BF27' },
  'holder-of-the-fork': { name: 'Holder of the Fork', color: '#F8BF27' },
};
export const DEFAULT_TITLE = 'townfolk';

const equippedStmt = db.prepare<[string], { title: string; announced: number | null }>('SELECT title, announced FROM titles WHERE user_id = ? AND equipped = 1');
const announceStmt = db.prepare('UPDATE titles SET announced = ? WHERE user_id = ? AND equipped = 1 AND announced IS NULL');
const unequipStmt = db.prepare('UPDATE titles SET equipped = 0 WHERE user_id = ?');
const grantStmt = db.prepare(
  'INSERT INTO titles (user_id, title, earned, equipped) VALUES (?, ?, ?, 1) ON CONFLICT(user_id, title) DO UPDATE SET equipped = 1',
);

/** The member's equipped title (Townfolk unless they've equipped another). */
export function titleOf(userId: string): TitleData {
  const id = equippedStmt.get(userId)?.title;
  return TITLES[id ?? DEFAULT_TITLE] ?? TITLES[DEFAULT_TITLE];
}

/** True when the member's equipped title hasn't been shown to them yet (the game's reward pop-up). */
export function titleIsNew(userId: string): boolean {
  const row = equippedStmt.get(userId);
  return !!row && row.announced === null && !!TITLES[row.title];
}

/** The game showed them their new title: don't announce it again (on any device). */
export function titleSeen(userId: string): void {
  announceStmt.run(Date.now(), userId);
}

/** Gives a member a title and equips it; the default title just unequips theirs (earned ones are kept). */
export const giveTitle = db.transaction((userId: string, title: string): void => {
  unequipStmt.run(userId);
  if (title !== DEFAULT_TITLE) grantStmt.run(userId, title, Date.now());
});
