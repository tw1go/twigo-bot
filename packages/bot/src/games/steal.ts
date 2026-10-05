import { add, balance, fencedUntil, lastSteal, markSteal, take } from '../credits/store.js';
import { masterKeys, useMasterKey } from '../dig/store.js';
import { jail } from './jail.js';

// 🥷 Stealing, shared by /steal and the neighbourhood's houses (web/hood.ts): 35% chance to steal 2–5% of the target's
// Kowens (at least 1–3, at most MAX_STEAL). Otherwise the Tanod catches you: pay the target a fine of half what you
// tried to take (at least MIN_FINE) and go to jail, so robbing the rich is a real gamble, not free money. A Bakod
// blocks it, unless you use a Master Key: 50% it breaks in (then the normal roll), 50% it snaps.

const KEY_CHANCE = 0.5;
const SUCCESS_CHANCE = 0.35;
const MIN_PERCENT = 0.02;
const MAX_PERCENT = 0.05;
const MAX_STEAL = 50;
const MIN_FINE = 2;
/** You need at least this much to try (in case you get caught). */
export const STEAL_FINE = MIN_FINE;
export const FAIL_JAIL_MINUTES = 5;
/** Don't pick on people who are nearly broke. */
export const MIN_TARGET_BALANCE = 3;
export const STEAL_COOLDOWN_MS = 60 * 60_000;

/** How much this attempt goes for: a slice of the target's Kowens, never below 1–3 or above MAX_STEAL. */
function attemptAmount(targetBalance: number): number {
  const base = 1 + Math.floor(Math.random() * 3);
  const scaled = Math.floor(targetBalance * (MIN_PERCENT + Math.random() * (MAX_PERCENT - MIN_PERCENT)));
  return Math.min(MAX_STEAL, Math.max(base, scaled));
}

export type StealResult =
  | { ok: false; reason: 'self' }
  | { ok: false; reason: 'cooldown'; until: number }
  | { ok: false; reason: 'broke' } // the thief can't cover a fine
  | { ok: false; reason: 'poor'; have: number } // the target has next to nothing
  | { ok: false; reason: 'fenced'; until: number; keys: number } // a Bakod, and no key used
  | { ok: true; outcome: 'key-snapped' } // the Master Key broke on the Bakod
  | { ok: true; outcome: 'stole'; amount: number; key: boolean }
  | { ok: true; outcome: 'caught'; fine: number; minutes: number; key: boolean };

/** When the thief may steal again (ms), or null now. */
export const stealCooldown = (thief: string): number | null => {
  const until = lastSteal(thief) + STEAL_COOLDOWN_MS;
  return until > Date.now() ? until : null;
};

/** One attempt. `useKey`: break through a Bakod with a Master Key if there's one (/steal always does). */
export async function stealFrom(thief: string, target: string, useKey: boolean, caughtReason: string): Promise<StealResult> {
  if (thief === target) return { ok: false, reason: 'self' };
  const wait = stealCooldown(thief);
  if (wait) return { ok: false, reason: 'cooldown', until: wait };
  if (balance(thief) < STEAL_FINE) return { ok: false, reason: 'broke' };
  if (balance(target) < MIN_TARGET_BALANCE) return { ok: false, reason: 'poor', have: balance(target) };

  // Checked last, so a Master Key is only used on an attempt that would otherwise go ahead.
  const fence = fencedUntil(target);
  if (fence) {
    if (!useKey || masterKeys(thief) <= 0) return { ok: false, reason: 'fenced', until: fence, keys: masterKeys(thief) };
    useMasterKey(thief);
    markSteal(thief);
    if (Math.random() >= KEY_CHANCE) return { ok: true, outcome: 'key-snapped' };
  } else markSteal(thief);

  const attempt = attemptAmount(balance(target));
  if (Math.random() < SUCCESS_CHANCE) {
    const amount = take(target, attempt);
    add(thief, amount);
    return { ok: true, outcome: 'stole', amount, key: !!fence };
  }
  const fine = take(thief, Math.max(MIN_FINE, Math.ceil(attempt / 2)));
  add(target, fine);
  await jail(thief, FAIL_JAIL_MINUTES, caughtReason);
  return { ok: true, outcome: 'caught', fine, minutes: FAIL_JAIL_MINUTES, key: !!fence };
}
