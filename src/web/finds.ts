import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { today } from '../time.js';

// 🪙 Kowens found in twigo's room (tw1go.github.io).
//
// Clicking a character there asks this bot whether the click turned up a
// Kowen. The roll happens here, never in the browser — anything the site
// decided could be faked from devtools. A find is a one-time claim code;
// the visitor proves who they are by running /claim CODE in Discord, so
// nobody can claim on someone else's behalf.

/** Chance a character click finds a Kowen. */
export const FIND_CHANCE = 0.1;
/** Fairy Cha is the room's luck: she only turns up 7.16% of the time, so
 *  catching her is worth far more… */
export const FAIRY_CHANCE = 0.5;
/** …and anyone clicked while she is in the room is luckier too. The site
 *  reports her presence, so this could be claimed falsely — which is why
 *  it stays modest; the daily caps below still bound everyone. */
export const BLESSED_CHANCE = 0.25;

/** The chance for one click. */
export function chanceFor(character: string, fairyAround: boolean): number {
  if (character === 'fairy-cha') return FAIRY_CHANCE;
  return fairyAround ? BLESSED_CHANCE : FIND_CHANCE;
}
/** Kowens per find. */
export const FIND_REWARD = 1;
/** Most finds one member can claim per day (config.timezone). */
export const CLAIMS_PER_DAY = 3;
/** How long a code stays claimable. */
export const CODE_TTL_MS = 15 * 60_000;
/** Most codes one visitor (by IP) can be handed per day — a little above the
 *  claim cap, so someone who lost a code is not locked out. */
export const CODES_PER_IP_PER_DAY = 5;
/** Shortest gap between rolls from one visitor, so a script cannot spam it. */
export const ROLL_GAP_MS = 2500;

interface Code {
  character: string;
  expires: number;
}

interface State {
  codes: Record<string, Code>;
  /** userId -> { day, count } */
  claims: Record<string, { day: string; count: number }>;
}

const DIR = 'data';
const FILE = `${DIR}/room-finds.json`;
const state: State = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { codes: {}, claims: {} };

function save(): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(state));
}

// Kept in memory only: losing these on a restart just resets the limits.
const lastRoll = new Map<string, number>();
const issuedToday = new Map<string, { day: string; count: number }>();

/* No 0/O/1/I, so a code read off the screen is never ambiguous. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode(): string {
  let code = '';
  for (const byte of randomBytes(6)) code += ALPHABET[byte % ALPHABET.length];
  return code;
}

function prune(): void {
  const now = Date.now();
  for (const [code, entry] of Object.entries(state.codes)) if (entry.expires < now) delete state.codes[code];
}

export type RollResult =
  | { found: false; reason?: 'slow-down' | 'limit' }
  | { found: true; code: string; expires: number; reward: number };

/** A character was clicked in the room. Decides, here, whether it found a Kowen. */
export function roll(ip: string, character: string, fairyAround = false): RollResult {
  const now = Date.now();
  if (now - (lastRoll.get(ip) ?? 0) < ROLL_GAP_MS) return { found: false, reason: 'slow-down' };
  lastRoll.set(ip, now);

  const day = today();
  const issued = issuedToday.get(ip);
  const count = issued?.day === day ? issued.count : 0;
  if (count >= CODES_PER_IP_PER_DAY) return { found: false, reason: 'limit' };
  if (Math.random() >= chanceFor(character, fairyAround)) return { found: false };

  prune();
  const code = newCode();
  const expires = now + CODE_TTL_MS;
  state.codes[code] = { character: character.slice(0, 32), expires };
  issuedToday.set(ip, { day, count: count + 1 });
  save();
  return { found: true, code, expires, reward: FIND_REWARD };
}

export type ClaimResult =
  | { ok: true; character: string; reward: number; claimedToday: number }
  | { ok: false; reason: 'unknown' | 'limit' };

/** /claim: spends a code for a member. Single use. */
export function claimCode(userId: string, raw: string): ClaimResult {
  prune();
  const code = raw.trim().toUpperCase();
  const entry = state.codes[code];
  if (!entry) return { ok: false, reason: 'unknown' };

  const day = today();
  const mine = state.claims[userId];
  const count = mine?.day === day ? mine.count : 0;
  if (count >= CLAIMS_PER_DAY) return { ok: false, reason: 'limit' };

  delete state.codes[code];
  state.claims[userId] = { day, count: count + 1 };
  save();
  return { ok: true, character: entry.character, reward: FIND_REWARD, claimedToday: count + 1 };
}
