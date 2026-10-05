import type { TitleData } from '@mikazuki/shared';
import { db, kvLoad, kvSave } from '../db/db.js';

// Titles: shown under a member's name in the web game, as <Title>, in the title's colour ('prismatic' = a shifting
// rainbow). Everyone is a Townfolk to begin with (that one isn't stored); others are given with /gift title (and
// later earned as rewards) and land in the titles table, one of them equipped. A new title is announced once in
// the game (announced = when), whichever device the member uses first. The CMS adds, changes and removes titles (kv
// 'titles': the changes over these built-in ones; null = removed), with a description for each (what it's for, shown
// at the Parlor; never sent with a player in town). Automatic titles (`auto`) belong to whoever the bot says holds them
// right now (web/richest.ts: the leaderboard's #1); a row in the titles table only says they've had it (for the pop-up
// and the NEW tag), and nobody gives them by hand. A title is new until it's clicked at the Parlor (`opened`).

export interface TitleDef extends TitleData {
  description?: string;
  /** Held by whoever the bot says, not given by hand (built-in only). */
  auto?: boolean;
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
  richest: { name: 'Richest Among All', color: '#FFD54A', description: 'Held by whoever has the most Kowens (wallet + vault). Lose the top spot, lose the title.', auto: true },
};
export const RICHEST = 'richest';
export const DEFAULT_TITLE = 'townfolk';

const TITLES_KEY = 'titles';
const changes = kvLoad<Record<string, TitleDef | null>>(TITLES_KEY, {});

/** Every title there is now (refilled in place, so every importer sees changes). */
export const TITLES: Record<string, TitleDef> = {};

function refill(): void {
  for (const id of Object.keys(TITLES)) delete TITLES[id];
  for (const [id, t] of Object.entries({ ...BUILT_IN, ...changes })) if (t) TITLES[id] = { ...t, ...(BUILT_IN[id]?.auto ? { auto: true } : {}) };
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

/** Removes a title (not Townfolk or an automatic one): whoever has it equipped shows Townfolk. */
export function removeTitle(id: string): boolean {
  if (id === DEFAULT_TITLE || !TITLES[id] || TITLES[id].auto) return false;
  if (BUILT_IN[id]) changes[id] = null;
  else delete changes[id];
  kvSave(TITLES_KEY, changes);
  refill();
  return true;
}

// ── Who has which title ──

/** Who holds each automatic title right now (set by web/richest.ts). */
const autoHolders = new Map<string, string | null>();
export const setAutoHolder = (title: string, userId: string | null) => void autoHolders.set(title, userId);
export const autoHolder = (title: string) => autoHolders.get(title) ?? null;

interface Row {
  title: string;
  equipped: number;
  announced: number | null;
  opened: number | null;
}
const rowsStmt = db.prepare<[string], Row>('SELECT title, equipped, announced, opened FROM titles WHERE user_id = ? ORDER BY earned, rowid');
const announceStmt = db.prepare('UPDATE titles SET announced = ? WHERE user_id = ? AND title = ? AND announced IS NULL');
const unequipStmt = db.prepare('UPDATE titles SET equipped = 0 WHERE user_id = ?');
const grantStmt = db.prepare(
  'INSERT INTO titles (user_id, title, earned, equipped) VALUES (?, ?, ?, 1) ON CONFLICT(user_id, title) DO UPDATE SET equipped = 1',
);
const earnStmt = db.prepare('INSERT OR IGNORE INTO titles (user_id, title, earned, equipped) VALUES (?, ?, ?, 0)');
const wearStmt = db.prepare('UPDATE titles SET equipped = 1 WHERE user_id = ? AND title = ?');
const openStmt = db.prepare('UPDATE titles SET opened = ? WHERE user_id = ? AND title = ? AND opened IS NULL');

/** Whether a title row counts: the title still exists and, if automatic, they hold it now. */
const holds = (userId: string, title: string) => !!TITLES[title] && (!TITLES[title].auto || autoHolder(title) === userId);
/** The member's title rows that count. */
const owned = (userId: string) => rowsStmt.all(userId).filter((r) => r.title !== DEFAULT_TITLE && holds(userId, r.title));
const plain = (id: string): TitleData => ({ name: TITLES[id].name, color: TITLES[id].color }); // the description stays here

/** The id of the member's equipped title (Townfolk if it's gone, or an automatic one they've lost). */
export const titleIdOf = (userId: string): string => owned(userId).find((r) => r.equipped)?.title ?? DEFAULT_TITLE;

/** The member's equipped title. */
export const titleOf = (userId: string): TitleData => plain(titleIdOf(userId));

/** A title of theirs the game hasn't shown them yet (the reward pop-up), oldest first, or null. */
export function newTitle(userId: string): (TitleData & { id: string }) | null {
  const row = owned(userId).find((r) => r.announced === null);
  return row ? { id: row.title, ...plain(row.title) } : null;
}

/** The game showed them that new title (or, without an id, all of them): not again, on any device. */
export function titleSeen(userId: string, title?: string): void {
  for (const r of owned(userId)) if (r.announced === null && (!title || r.title === title)) announceStmt.run(Date.now(), userId, r.title);
}

/** Gives a member a title and equips it; the default title just unequips theirs (earned ones are kept). */
export const giveTitle = db.transaction((userId: string, title: string): void => {
  unequipStmt.run(userId);
  if (title !== DEFAULT_TITLE) grantStmt.run(userId, title, Date.now());
});

/** An automatic title reached them: noted (not worn). True the first time ever (the pop-up and the NEW tag). */
export const earnTitle = (userId: string, title: string): boolean => earnStmt.run(userId, title, Date.now()).changes > 0;

/** The titles a member has: Townfolk first, then the others, with whether each is still new to them. */
export const ownedTitles = (userId: string): { id: string; isNew: boolean }[] => [
  { id: DEFAULT_TITLE, isNew: false },
  ...owned(userId).map((r) => ({ id: r.title, isNew: r.opened === null })),
];

/** Shows one of the member's own titles (the Parlor). False if they don't have it. */
export const wearTitle = db.transaction((userId: string, title: string): boolean => {
  if (!ownedTitles(userId).some((t) => t.id === title)) return false;
  unequipStmt.run(userId);
  if (title !== DEFAULT_TITLE) wearStmt.run(userId, title);
  return true;
});

/** They clicked the title at the Parlor: its NEW tag goes. */
export const openTitle = (userId: string, title: string): void => void openStmt.run(Date.now(), userId, title);

/** How many members have each title equipped (the CMS's title list). */
export const titleHolders = (): Record<string, number> =>
  Object.fromEntries(db.prepare<[], { title: string; n: number }>('SELECT title, COUNT(*) AS n FROM titles WHERE equipped = 1 GROUP BY title').all().map((r) => [r.title, r.n]));
