import type { TitleData } from '@mikazuki/shared';
import { db, kvLoad, kvSave } from '../db/db.js';

// Titles: shown under a member's name in the web game, as <Title>, in the title's colour ('prismatic' = a shifting
// rainbow). Everyone is a Townfolk to begin with (that one isn't stored); others are given with /gift title (and
// later earned as rewards) and land in the titles table, one of them equipped. A new title is announced once in
// the game (announced = when), whichever device the member uses first. The CMS adds, changes and removes titles (kv
// 'titles': the changes over these built-in ones; null = removed), with a description for each (what it's for, shown
// at the Parlor; never sent with a player in town).

export interface TitleDef extends TitleData {
  description?: string;
}

export const DESCRIPTION_MAX = 140;

const BUILT_IN: Record<string, TitleDef> = {
  townfolk: { name: 'Townfolk', color: '#B794F6', description: 'Everyone starts here: a neighbour in Mikazuki town.' },
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

const TITLES_KEY = 'titles';
const changes = kvLoad<Record<string, TitleDef | null>>(TITLES_KEY, {});

/** Every title there is now (refilled in place, so every importer sees changes). */
export const TITLES: Record<string, TitleDef> = {};

function refill(): void {
  for (const id of Object.keys(TITLES)) delete TITLES[id];
  for (const [id, t] of Object.entries({ ...BUILT_IN, ...changes })) if (t) TITLES[id] = t;
}
refill();

/** A title colour: #RRGGBB or 'prismatic'. */
export const isTitleColor = (c: unknown): c is string => typeof c === 'string' && (c === 'prismatic' || /^#[0-9A-Fa-f]{6}$/.test(c));

/** Adds or changes a title (the CMS). */
export function setTitle(id: string, title: TitleDef): void {
  changes[id] = { name: title.name, color: title.color, ...(title.description ? { description: title.description } : {}) };
  kvSave(TITLES_KEY, changes);
  refill();
}

/** Removes a title (not Townfolk): whoever has it equipped shows Townfolk. */
export function removeTitle(id: string): boolean {
  if (id === DEFAULT_TITLE || !TITLES[id]) return false;
  if (BUILT_IN[id]) changes[id] = null;
  else delete changes[id];
  kvSave(TITLES_KEY, changes);
  refill();
  return true;
}

/** How many members have each title equipped (the CMS's title list). */
export const titleHolders = (): Record<string, number> =>
  Object.fromEntries(db.prepare<[], { title: string; n: number }>('SELECT title, COUNT(*) AS n FROM titles WHERE equipped = 1 GROUP BY title').all().map((r) => [r.title, r.n]));

/** The id of the member's equipped title. */
export const titleIdOf = (userId: string): string => equippedStmt.get(userId)?.title ?? DEFAULT_TITLE;

const equippedStmt = db.prepare<[string], { title: string; announced: number | null }>('SELECT title, announced FROM titles WHERE user_id = ? AND equipped = 1');
const announceStmt = db.prepare('UPDATE titles SET announced = ? WHERE user_id = ? AND equipped = 1 AND announced IS NULL');
const unequipStmt = db.prepare('UPDATE titles SET equipped = 0 WHERE user_id = ?');
const grantStmt = db.prepare(
  'INSERT INTO titles (user_id, title, earned, equipped) VALUES (?, ?, ?, 1) ON CONFLICT(user_id, title) DO UPDATE SET equipped = 1',
);

/** The member's equipped title (Townfolk unless they've equipped another). */
export function titleOf(userId: string): TitleData {
  const id = equippedStmt.get(userId)?.title;
  const { name, color } = TITLES[id ?? DEFAULT_TITLE] ?? TITLES[DEFAULT_TITLE];
  return { name, color }; // the description stays here
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

const ownedStmt = db.prepare<[string], { title: string }>('SELECT title FROM titles WHERE user_id = ? ORDER BY earned, rowid');
const wearStmt = db.prepare('UPDATE titles SET equipped = 1 WHERE user_id = ? AND title = ?');

/** The titles a member has: Townfolk first, then those given to them (ones the CMS removed are left out). */
export const ownedTitles = (userId: string): string[] => [DEFAULT_TITLE, ...ownedStmt.all(userId).map((r) => r.title).filter((id) => id !== DEFAULT_TITLE && TITLES[id])];

/** Shows one of the member's own titles (the Parlor). False if they don't have it. */
export const wearTitle = db.transaction((userId: string, title: string): boolean => {
  if (!ownedTitles(userId).includes(title)) return false;
  unequipStmt.run(userId);
  if (title !== DEFAULT_TITLE) wearStmt.run(userId, title);
  return true;
});
