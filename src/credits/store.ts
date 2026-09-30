import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { daysBetween, today } from '../time.js';

// Credits for /diss, /praise and /judge. Claim DAILY_CREDITS once per day (config.timezone); unused credits carry over.
// Voice chat also earns 1 credit per VOICE_MINUTES_PER_CREDIT minutes (see voice.ts).
export const DAILY_CREDITS = 5;
export const VOICE_MINUTES_PER_CREDIT = 15;

interface Account {
  balance: number;
  lastClaim?: string; // YYYY-MM-DD
  voiceMinutes?: number; // progress toward the next voice credit
  voiceTotalMinutes?: number; // lifetime voice minutes, for /leaderboard
  lastSteal?: number; // ms timestamp of last /steal attempt
  lastActive?: string; // YYYY-MM-DD of last message, voice time, or bot use
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
  account.balance += DAILY_CREDITS;
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

/** Minutes of voice time banked toward the next credit. */
export function voiceProgress(userId: string): number {
  return accounts[userId]?.voiceMinutes ?? 0;
}

/** Adds one voice minute to each user; awards a credit every VOICE_MINUTES_PER_CREDIT. Returns who earned one. */
export function addVoiceMinute(userIds: string[]): string[] {
  const earned: string[] = [];
  for (const id of userIds) {
    const account = (accounts[id] ??= { balance: 0 });
    account.voiceMinutes = (account.voiceMinutes ?? 0) + 1;
    account.voiceTotalMinutes = (account.voiceTotalMinutes ?? 0) + 1;
    account.lastActive = today();
    if (account.voiceMinutes >= VOICE_MINUTES_PER_CREDIT) {
      account.voiceMinutes -= VOICE_MINUTES_PER_CREDIT;
      account.balance += 1;
      earned.push(id);
    }
  }
  if (userIds.length) save();
  return earned;
}

/** Adds `amount` credits. Returns the new balance. */
export function add(userId: string, amount: number): number {
  const account = (accounts[userId] ??= { balance: 0 });
  account.balance += amount;
  save();
  return account.balance;
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
