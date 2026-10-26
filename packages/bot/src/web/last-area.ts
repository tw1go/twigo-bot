import { type ResumeArea } from '@mikazuki/shared';
import { db } from '../db/db.js';

// 🧭 The area each member was last in (schema v25 last_area; CONTEXT.md Resume spot): saved as they arrive in a room of
// the town (web/town.ts `TownOptions.resume`), sent with /me so a fresh visit starts there. Kept in memory too (read on
// every /me), written as it changes.

const AREAS = new Set<string>(['hood', 'slums', 'palengke', 'warrens', 'silong']);
const allStmt = db.prepare<[], { user_id: string; area: string }>('SELECT user_id, area FROM last_area');
const setStmt = db.prepare('INSERT INTO last_area (user_id, area, at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET area = excluded.area, at = excluded.at');

let cache: Map<string, ResumeArea> | null = null;
const all = (): Map<string, ResumeArea> =>
  (cache ??= new Map(allStmt.all().flatMap((r) => (AREAS.has(r.area) ? [[r.user_id, r.area as ResumeArea] as const] : []))));

/** The area a member was last in, or undefined (never kept). */
export const lastAreaOf = (userId: string): ResumeArea | undefined => all().get(userId);

/** A member arrived in `area`: kept (written only when it changed). */
export function saveLastArea(userId: string, area: ResumeArea, now = Date.now()): void {
  if (all().get(userId) === area) return;
  all().set(userId, area);
  setStmt.run(userId, area, now);
}

/** /me's resume spot (CONTEXT.md Resume spot; shared resumeStart picks the start from it): the area they were last in,
 *  whether a guided quest is under way (the guide runs in town and the Slums) and whether the Old Market is still closed
 *  to them. Nothing when no area is kept. */
export function resumeFor(userId: string, o: { guided: boolean; palengkeClosed: boolean }): { lastArea?: ResumeArea; guided?: boolean; palengkeClosed?: boolean } {
  const lastArea = lastAreaOf(userId);
  if (!lastArea) return {};
  return { lastArea, ...(o.guided ? { guided: true } : {}), ...(o.palengkeClosed ? { palengkeClosed: true } : {}) };
}
