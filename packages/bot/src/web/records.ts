import { db } from '../db/db.js';

// 🏆 The leaderboard's records (CONTEXT.md Leaderboard): the fastest Scrap Warrens clears, one row per line-up (the same
// members in any order) with its best clear time, and golem damage, each member's most in one fight that ended with the
// golem down. Written as a real run clears and as the golem falls (town.ts, TownOptions.records); read by the town's
// leaderboard (server.ts). Ties go to whoever got there first. Schema v24: warrens_clears, golem_fights.

export interface ClearRecord {
  members: string[];
  ms: number;
  at: number;
}
export interface GolemRecord {
  userId: string;
  damage: number;
  at: number;
}

type ClearRow = { members: string; ms: number; at: number };
type GolemRow = { user_id: string; damage: number; at: number };

/** A line-up's key: its members once each, sorted (so the order they're given in never matters). */
export const lineupOf = (members: string[]): string => [...new Set(members)].sort().join(',');

const getClear = db.prepare<[string], { ms: number }>('SELECT ms FROM warrens_clears WHERE lineup = ?');
const putClear = db.prepare('INSERT INTO warrens_clears (lineup, members, ms, at) VALUES (?, ?, ?, ?) ON CONFLICT(lineup) DO UPDATE SET members = excluded.members, ms = excluded.ms, at = excluded.at');
const clearsStmt = db.prepare<[], ClearRow>('SELECT members, ms, at FROM warrens_clears ORDER BY ms ASC, at ASC');
const getGolem = db.prepare<[string], { damage: number; at: number }>('SELECT damage, at FROM golem_fights WHERE user_id = ?');
const putGolem = db.prepare('INSERT INTO golem_fights (user_id, damage, at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET damage = excluded.damage, at = excluded.at');
const golemStmt = db.prepare<[number], GolemRow>('SELECT user_id, damage, at FROM golem_fights ORDER BY damage DESC, at ASC LIMIT ?');
const golemAheadStmt = db.prepare<[number, number, number], { n: number }>('SELECT COUNT(*) AS n FROM golem_fights WHERE damage > ? OR (damage = ? AND at < ?)');

const row = (r: ClearRow): ClearRecord => ({ members: JSON.parse(r.members) as string[], ms: r.ms, at: r.at });

/** A real run cleared: kept if it's the line-up's first clear or quicker than its best. Returns whether it was. */
export function recordClear(members: string[], ms: number, at: number): boolean {
  const key = lineupOf(members);
  if (!key || !(ms > 0)) return false;
  const best = getClear.get(key)?.ms;
  if (best !== undefined && best <= ms) return false;
  putClear.run(key, JSON.stringify([...new Set(members)].sort()), Math.round(ms), at);
  console.log(`[records] warrens clear ${key} in ${Math.round(ms / 1000)} s${best === undefined ? '' : ` (was ${Math.round(best / 1000)} s)`}`);
  return true;
}

/** The golem down: each member's damage this fight, kept where it beats their best. Returns whose best it is now. */
export function recordGolem(dealt: Map<string, number>, at: number): string[] {
  const bests: string[] = [];
  for (const [userId, damage] of dealt) {
    if (!(damage > 0)) continue;
    const best = getGolem.get(userId)?.damage;
    if (best !== undefined && best >= damage) continue;
    putGolem.run(userId, Math.round(damage), at);
    bests.push(userId);
  }
  if (bests.length) console.log(`[records] golem bests: ${bests.map((u) => `${u} ${Math.round(dealt.get(u)!)}`).join(', ')}`);
  return bests;
}

/** The fastest clears, quickest first. */
export const topClears = (n: number): ClearRecord[] => clearsStmt.all().slice(0, n).map(row);

/** A member's best place on the clears board (the quickest line-up they're in), or null. */
export function clearRankOf(userId: string): { rank: number; ms: number } | null {
  const all = clearsStmt.all();
  const i = all.findIndex((r) => (JSON.parse(r.members) as string[]).includes(userId));
  return i < 0 ? null : { rank: i + 1, ms: all[i].ms };
}

/** The most golem damage in one fight, highest first. */
export const topGolem = (n: number): GolemRecord[] => golemStmt.all(n).map((r) => ({ userId: r.user_id, damage: r.damage, at: r.at }));

/** A member's place on the golem board and their best, or null. */
export function golemBestOf(userId: string): { rank: number; damage: number } | null {
  const mine = getGolem.get(userId);
  if (!mine) return null;
  return { rank: golemAheadStmt.get(mine.damage, mine.damage, mine.at)!.n + 1, damage: mine.damage };
}
