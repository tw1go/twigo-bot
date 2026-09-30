import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Credit rewards (Crystal of Atlan passes). Redeeming deducts credits and pings the reward owner, who delivers it manually.
// Priced for an active member (~14 credits/day: daily claim + ~2h voice + some patrols), saving from zero:
// Phantasium ~3.5 months, Basic ~5 months, Advanced ~7.5 months.
export const GAME_NAME = 'Crystal of Atlan';

export const rewards = [
  { id: 'phantasium', name: 'Phantasium Pass', cost: 1_500, emoji: '🎟️' },
  { id: 'basic-bp', name: 'Basic Battle Pass', cost: 2_100, emoji: '⚔️' },
  { id: 'advanced-bp', name: 'Advanced Battle Pass', cost: 3_200, emoji: '👑' },
] as const;

export type RewardId = (typeof rewards)[number]['id'];

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
