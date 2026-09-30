import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Credit rewards (Crystal of Atlan passes). Redeeming deducts credits and pings the reward owner, who delivers it manually.
// Priced for an active member (~14 credits/day: daily claim + ~2h voice + some patrols), saving from zero:
// Phantasium ~3.5 months, Basic ~5 months, Advanced ~7.5 months.
export const GAME_NAME = 'Crystal of Atlan';

// kind 'pass' = delivered by hand (owner is pinged); 'fence' = applied instantly by the bot.
export const rewards = [
  { id: 'bakod', name: 'Bakod (Fence)', cost: 5, emoji: '🧱', kind: 'fence' },
  { id: 'phantasium', name: 'Phantasium Pass', cost: 1_500, emoji: '🎟️', kind: 'pass' },
  { id: 'basic-bp', name: 'Basic Battle Pass', cost: 2_100, emoji: '⚔️', kind: 'pass' },
  { id: 'advanced-bp', name: 'Advanced Battle Pass', cost: 3_200, emoji: '👑', kind: 'pass' },
] as const;

export type RewardId = (typeof rewards)[number]['id'];

// Bakod (Fence): blocks /steal against you. Buying again adds more time, up to FENCE_MAX_DAYS.
export const FENCE_DAYS = 3;
export const FENCE_MAX_DAYS = 7;

interface Redemption {
  userId: string;
  reward: RewardId;
  cost: number;
  at: string; // ISO timestamp
}

const DIR = 'data';
const FILE = `${DIR}/redemptions.json`;
const log: Redemption[] = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : [];

export function recordRedemption(userId: string, reward: RewardId, cost: number): void {
  log.push({ userId, reward, cost, at: new Date().toISOString() });
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(log, null, 2));
}
