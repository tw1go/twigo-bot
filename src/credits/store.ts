import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { today } from '../time.js';

// Credits for /diss, /praise and /judge. Claim DAILY_CREDITS once per day (config.timezone); unused credits carry over.
// Voice chat also earns 1 credit per VOICE_MINUTES_PER_CREDIT minutes (see voice.ts).
export const DAILY_CREDITS = 5;
export const VOICE_MINUTES_PER_CREDIT = 15;

interface Account {
  balance: number;
  lastClaim?: string; // YYYY-MM-DD
  voiceMinutes?: number; // progress toward the next voice credit
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
    if (account.voiceMinutes >= VOICE_MINUTES_PER_CREDIT) {
      account.voiceMinutes -= VOICE_MINUTES_PER_CREDIT;
      account.balance += 1;
      earned.push(id);
    }
  }
  if (userIds.length) save();
  return earned;
}
