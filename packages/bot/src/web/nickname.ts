import { db } from '../db/db.js';

// The name a member goes by in the web game (picked in the character creator). Unique, ignoring case and the
// separators (space _ - .), so "Mika Zuki" and "mika_zuki" can't both exist. The game checks the same rule
// before sending (packages/game/src/characters/nickname.ts); this is the one that counts.

const SHAPE = /^[A-Za-z0-9](?:[A-Za-z0-9 _.-]{1,14})[A-Za-z0-9]$/;

/** The cleaned-up nickname (trimmed, single spaces) if valid, else null. */
export function parseNickname(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const nick = raw.trim().replace(/ {2,}/g, ' ');
  return SHAPE.test(nick) ? nick : null;
}

/** What makes two nicknames the same one. */
const fold = (nick: string) => nick.toLowerCase().replace(/[ _.-]/g, '');

const getStmt = db.prepare<[string], { nickname: string }>('SELECT nickname FROM nicknames WHERE user_id = ?');
const ownerStmt = db.prepare<[string], { user_id: string }>('SELECT user_id FROM nicknames WHERE folded = ?');
const setStmt = db.prepare(
  'INSERT INTO nicknames (user_id, nickname, folded, updated) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET nickname = excluded.nickname, folded = excluded.folded, updated = excluded.updated',
);

export function getNickname(userId: string): string | null {
  return getStmt.get(userId)?.nickname ?? null;
}

/** Saves a (parsed) nickname; 'taken' if another member has it. */
export function setNickname(userId: string, nick: string): 'ok' | 'taken' {
  const owner = ownerStmt.get(fold(nick));
  if (owner && owner.user_id !== userId) return 'taken';
  setStmt.run(userId, nick, fold(nick), Date.now());
  return 'ok';
}
