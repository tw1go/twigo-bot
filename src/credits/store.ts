import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { daysBetween, today, weekStart } from '../time.js';

// Credits for /diss, /praise and /judge. Claim DAILY_CREDITS once per day (config.timezone); unused credits carry over.
// Voice chat also earns 1 credit per VOICE_MINUTES_PER_CREDIT minutes (see voice.ts).
export const DAILY_CREDITS = 5;
/** 🤫 Double on Christmas Day. */
export const dailyAmount = () => (today().slice(5) === '12-25' ? DAILY_CREDITS * 2 : DAILY_CREDITS);
export const VOICE_MINUTES_PER_CREDIT = 15;
export const VOICE_DAILY_CAP = 12; // max voice credits per day (= 3 hours), stops AFK farming

interface Account {
  balance: number;
  lastClaim?: string; // YYYY-MM-DD
  voiceMinutes?: number; // progress toward the next voice credit
  voiceTotalMinutes?: number; // lifetime voice minutes, for /leaderboard
  lastSteal?: number; // ms timestamp of last /steal attempt
  lastActive?: string; // YYYY-MM-DD of last message, voice time, or bot use
  fenceUntil?: number; // ms timestamp — /steal is blocked until then (Bakod)
  voiceCreditsDay?: string; // YYYY-MM-DD that voiceCreditsToday counts
  voiceCreditsToday?: number;
  voiceWeek?: string; // Monday of the week voiceWeekMinutes counts
  voiceWeekMinutes?: number; // eligible voice minutes this week (for the weekly rewards)
  giveDay?: string; // YYYY-MM-DD that giveSentToday counts
  giveSentToday?: number;
}

const DIR = 'data';
const FILE = `${DIR}/credits.json`;
let accounts: Record<string, Account> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};

function save(): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(accounts));
}

export function balance(userId: string): number {
  return accounts[userId]?.balance ?? 0;
}

/** Returns the new balance, or null if already claimed today. */
export function claim(userId: string): number | null {
  const account = (accounts[userId] ??= { balance: 0 });
  if (account.lastClaim === today()) return null;
  account.balance += dailyAmount();
  account.lastClaim = today();
  account.lastActive = today();
  save();
  return account.balance;
}

/** Spends one credit. Returns false if the user has none. */
export function spend(userId: string): boolean {
  const account = accounts[userId];
  if (!account || account.balance <= 0) return false;
  account.balance -= 1;
  save();
  return true;
}

/** Clears a user's balance and lets them claim again today. Returns their previous balance. */
export function reset(userId: string): number {
  const previous = balance(userId);
  delete accounts[userId];
  save();
  return previous;
}

/** Resets everyone. Returns how many accounts were cleared. */
export function resetAll(): number {
  const count = Object.keys(accounts).length;
  accounts = {};
  save();
  return count;
}

/** Voice credits earned today (resets at midnight). */
export function voiceCreditsToday(userId: string): number {
  const account = accounts[userId];
  return account?.voiceCreditsDay === today() ? (account.voiceCreditsToday ?? 0) : 0;
}

/** Minutes of voice time banked toward the next credit. */
export function voiceProgress(userId: string): number {
  return accounts[userId]?.voiceMinutes ?? 0;
}

/** Adds one voice minute to each user; awards a credit every VOICE_MINUTES_PER_CREDIT, up to VOICE_DAILY_CAP a day.
 *  Returns who earned one. Time past the cap still counts for /leaderboard and activity. */
export function addVoiceMinute(userIds: string[]): string[] {
  const earned: string[] = [];
  const day = today();
  for (const id of userIds) {
    const account = (accounts[id] ??= { balance: 0 });
    account.voiceTotalMinutes = (account.voiceTotalMinutes ?? 0) + 1;
    account.lastActive = day;
    if (account.voiceCreditsDay !== day) {
      account.voiceCreditsDay = day;
      account.voiceCreditsToday = 0;
    }
    // Weekly ranking counts every eligible voice minute (no daily cap — only the Kowen earnings are capped).
    const week = weekStart(day);
    if (account.voiceWeek !== week) {
      account.voiceWeek = week;
      account.voiceWeekMinutes = 0;
    }
    account.voiceWeekMinutes = (account.voiceWeekMinutes ?? 0) + 1;
    if ((account.voiceCreditsToday ?? 0) >= VOICE_DAILY_CAP) continue;
    account.voiceMinutes = (account.voiceMinutes ?? 0) + 1;
    if (account.voiceMinutes >= VOICE_MINUTES_PER_CREDIT) {
      account.voiceMinutes -= VOICE_MINUTES_PER_CREDIT;
      account.voiceCreditsToday = (account.voiceCreditsToday ?? 0) + 1;
      account.balance += 1;
      earned.push(id);
    }
  }
  if (userIds.length) save();
  return earned;
}

// Loans (see loans/loans.ts) register a garnish hook: while a member owes, part of what they earn goes to the
// lender. It runs after the Kowens land, so the hook can take its share with take().
type GarnishHook = (userId: string, earned: number) => void;
let garnishHook: GarnishHook | null = null;
export const setGarnishHook = (hook: GarnishHook) => (garnishHook = hook);

/** Adds `amount` Kowens. Returns the new balance. Pass { garnish: false } for loan payouts themselves. */
export function add(userId: string, amount: number, opts: { garnish?: boolean } = {}): number {
  const account = (accounts[userId] ??= { balance: 0 });
  account.balance += amount;
  save();
  if (amount > 0 && opts.garnish !== false) garnishHook?.(userId, amount);
  return accounts[userId].balance;
}

/** Takes up to `amount` credits (never below 0). Returns how many were actually taken. */
export function take(userId: string, amount: number): number {
  const account = accounts[userId];
  if (!account) return 0;
  const taken = Math.min(amount, account.balance);
  account.balance -= taken;
  save();
  return taken;
}

export function lastSteal(userId: string): number {
  return accounts[userId]?.lastSteal ?? 0;
}

export function markSteal(userId: string): void {
  (accounts[userId] ??= { balance: 0 }).lastSteal = Date.now();
  save();
}

export function topBalances(limit: number): [string, number][] {
  return Object.entries(accounts)
    .filter(([, a]) => a.balance > 0)
    .sort(([, a], [, b]) => b.balance - a.balance)
    .slice(0, limit)
    .map(([id, a]) => [id, a.balance]);
}

export function topVoice(limit: number): [string, number][] {
  return Object.entries(accounts)
    .filter(([, a]) => (a.voiceTotalMinutes ?? 0) > 0)
    .sort(([, a], [, b]) => (b.voiceTotalMinutes ?? 0) - (a.voiceTotalMinutes ?? 0))
    .slice(0, limit)
    .map(([id, a]) => [id, a.voiceTotalMinutes ?? 0]);
}

// Inactivity decay: after INACTIVE_GRACE_DAYS without activity, lose 1% on the next day, 2% the day after,
// and so on up to DECAY_MAX_PERCENT per day (always at least 1 credit).
export const INACTIVE_GRACE_DAYS = 3;
export const DECAY_MAX_PERCENT = 10;

/** Marks a member as active today. Only writes to disk when the date changes. */
export function touch(userId: string): void {
  const account = accounts[userId];
  if (!account || account.lastActive === today()) return;
  account.lastActive = today();
  save();
}

/** Daily: takes credits from inactive members. Returns [userId, lost, daysInactive] for each one charged. */
export function decayInactive(): [string, number, number][] {
  const charged: [string, number, number][] = [];
  const now = today();
  for (const [id, account] of Object.entries(accounts)) {
    if (!account.lastActive) {
      account.lastActive = now; // existing accounts start their clock today
      continue;
    }
    if (account.balance <= 0) continue;
    const idle = daysBetween(account.lastActive, now);
    if (idle <= INACTIVE_GRACE_DAYS) continue;
    const percent = Math.min(idle - INACTIVE_GRACE_DAYS, DECAY_MAX_PERCENT);
    const lost = Math.min(account.balance, Math.max(1, Math.floor((account.balance * percent) / 100)));
    account.balance -= lost;
    charged.push([id, lost, idle]);
  }
  save();
  return charged;
}

/** Returns when the member's Bakod (fence) ends, if they have one. */
export function fencedUntil(userId: string): number | null {
  const until = accounts[userId]?.fenceUntil ?? 0;
  return until > Date.now() ? until : null;
}

/** Adds fence time, capped at maxMs from now. Returns the new end time. */
export function addFence(userId: string, ms: number, maxMs: number): number {
  const account = (accounts[userId] ??= { balance: 0 });
  const start = Math.max(account.fenceUntil ?? 0, Date.now());
  account.fenceUntil = Math.min(start + ms, Date.now() + maxMs);
  save();
  return account.fenceUntil;
}

export function claimedToday(userId: string): boolean {
  return accounts[userId]?.lastClaim === today();
}

/** Days since the member was last active, or null if unknown. */
export function daysInactive(userId: string): number | null {
  const last = accounts[userId]?.lastActive;
  return last ? daysBetween(last, today()) : null;
}

/** 1-based rank by balance among members with credits, or null if they have none. */
export function rankOf(userId: string): number | null {
  if (balance(userId) <= 0) return null;
  return Object.values(accounts).filter((a) => a.balance > balance(userId)).length + 1;
}

// Member-to-member gifting (/give): each member can send up to DAILY_GIVE_LIMIT per day (resets at midnight).
export const DAILY_GIVE_LIMIT = 20;

/** Kowens this member has already given today. */
export function givenToday(userId: string): number {
  const account = accounts[userId];
  return account?.giveDay === today() ? (account.giveSentToday ?? 0) : 0;
}

/** Moves Kowens between members, respecting balance and the daily limit. */
export function give(fromId: string, toId: string, amount: number): { ok: true } | { ok: false; reason: 'balance' | 'limit' } {
  if (balance(fromId) < amount) return { ok: false, reason: 'balance' };
  if (givenToday(fromId) + amount > DAILY_GIVE_LIMIT) return { ok: false, reason: 'limit' };
  const from = accounts[fromId];
  from.giveSentToday = givenToday(fromId) + amount;
  from.giveDay = today();
  from.balance -= amount;
  (accounts[toId] ??= { balance: 0 }).balance += amount;
  save();
  garnishHook?.(toId, amount); // gifts to someone in debt help pay it off
  return { ok: true };
}

/** Top members by eligible voice minutes in the week starting `week` (a Monday, YYYY-MM-DD). */
export function topVoiceWeek(week: string, limit: number): [string, number][] {
  return Object.entries(accounts)
    .filter(([, a]) => a.voiceWeek === week && (a.voiceWeekMinutes ?? 0) > 0)
    .sort(([, a], [, b]) => (b.voiceWeekMinutes ?? 0) - (a.voiceWeekMinutes ?? 0))
    .slice(0, limit)
    .map(([id, a]) => [id, a.voiceWeekMinutes ?? 0]);
}
