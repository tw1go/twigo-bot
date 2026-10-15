import { rogueFields, setRogueFields } from '../credits/store.js';

// 🎭 Rogues (CONTEXT.md "Rogues and stealing"): only a rogue can steal (games/steal.ts) or throw a Kalawang Potion
// (web/hood.ts). Every member is in one of three states:
//  • Open (the default): rogues can rob them; a successful robbery of an open member who isn't a rogue protects them.
//  • Protected: robbed already, so no rogue can rob them (not even with a Master Key) and no Kalawang Potion can be
//    thrown at their Bakod, until they become a rogue.
//  • Marked: a rogue who has made a steal attempt since becoming one, or anyone whose last steal attempt as a rogue was
//    under ROGUE_MARK_MS ago (so quitting doesn't hide them at once). Any rogue can rob them, any number of times, and
//    it never protects them.
// Becoming a rogue is free (not while in jail: the callers check) and ends protection for good; quitting is free any
// time, and the mark stays until ROGUE_MARK_MS after the last attempt, then they're Open (not Protected). Kept on the
// account (schema v17: rogue_since, rogue_marked_at, protected_at); the migration's empty columns are the one fresh
// start, and nothing here ever clears state on its own.

/** How long a steal attempt keeps a member marked after they quit being a rogue. */
export const ROGUE_MARK_MS = 2 * 24 * 60 * 60_000;

export type RogueState = 'open' | 'protected' | 'marked';

export const isRogue = (userId: string): boolean => rogueFields(userId).rogueSince !== undefined;

/** Marked: a steal attempt since becoming a rogue (while they still are one), or one under ROGUE_MARK_MS ago. */
export function isMarked(userId: string, now = Date.now()): boolean {
  const { rogueSince, rogueMarkedAt } = rogueFields(userId);
  if (rogueMarkedAt === undefined) return false;
  return (rogueSince !== undefined && rogueMarkedAt >= rogueSince) || now - rogueMarkedAt < ROGUE_MARK_MS;
}

export const isProtected = (userId: string): boolean => rogueFields(userId).protectedAt !== undefined;

/** Their state: marked over protected (a member can't be both: protection ends as they become a rogue, and only a rogue
 *  is ever marked), else open. */
export function rogueState(userId: string, now = Date.now()): RogueState {
  if (isMarked(userId, now)) return 'marked';
  return isProtected(userId) ? 'protected' : 'open';
}

/** When their mark ends (ms): ROGUE_MARK_MS after their last attempt, once they've quit; null while it lasts as long as
 *  they're a rogue (quitting starts the 2 days), or when they aren't marked. */
export function markedUntil(userId: string, now = Date.now()): number | null {
  const { rogueSince, rogueMarkedAt } = rogueFields(userId);
  if (!isMarked(userId, now) || rogueMarkedAt === undefined) return null;
  if (rogueSince !== undefined && rogueMarkedAt >= rogueSince) return null;
  return rogueMarkedAt + ROGUE_MARK_MS;
}

/** Becomes a rogue (on: their protection ends) or quits (off: the mark keeps its 2 days). False: no change. */
export function setRogue(userId: string, on: boolean, now = Date.now()): boolean {
  if (on === isRogue(userId)) return false;
  setRogueFields(userId, on ? { rogueSince: now, protectedAt: undefined } : { rogueSince: undefined });
  return true;
}

/** A steal attempt went ahead (stole, caught, or a Master Key snapped): the rogue is marked from now. */
export function markRogue(userId: string, now = Date.now()): void {
  setRogueFields(userId, { rogueMarkedAt: now });
}

/** Robbed: protected, if they're open (not a rogue and not marked). True: they were just protected. */
export function protect(userId: string, now = Date.now()): boolean {
  if (isRogue(userId) || isMarked(userId, now) || isProtected(userId)) return false;
  setRogueFields(userId, { protectedAt: now });
  return true;
}

/** Joining or quitting, as /rogue and the house menu (POST /town/rogue) do it: not joining while in jail (`jailedUntil`,
 *  from games/jail.ts: the callers pass it), and no change refused. Quitting always works, jailed or not: the mark keeps
 *  its 2 days, so it hides nothing. */
export type RogueTurn = { ok: true; on: boolean } | { ok: false; reason: 'jailed'; until: number } | { ok: false; reason: 'already'; on: boolean };

export function turnRogue(userId: string, on: boolean, jailedUntil: number | null, now = Date.now()): RogueTurn {
  if (on === isRogue(userId)) return { ok: false, reason: 'already', on };
  if (on && jailedUntil) return { ok: false, reason: 'jailed', until: jailedUntil };
  setRogue(userId, on, now);
  return { ok: true, on };
}
