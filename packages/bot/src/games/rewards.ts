import { db } from '../db/db.js';

// Credit rewards (Crystal of Atlan passes). Redeeming deducts credits and pings the reward owner, who delivers it manually.
// Priced for an active member (~16 Kowens/day: daily claim + ~2h voice + some patrols + nightly Mine Wars),
// saving from zero: Phantasium ~3.5 months, Basic ~5 months, Advanced ~7.5 months.
export const GAME_NAME = 'Crystal of Atlan';

// kind 'pass' = delivered by hand (owner is pinged); 'fence' / 'shovel' / 'bag' / 'key' / 'vault' / 'potion' / 'megaphone' = applied instantly by the bot.
// Bags add BAG_SLOTS inventory slots each (10 base + 5 bags × 8 = 50 max); each bag can be bought once.
export const rewards = [
  { id: 'bakod', name: 'Bakod (Fence)', cost: 5, emoji: '🧱', kind: 'fence' },
  { id: 'shovel', name: 'Shovel', cost: 2, emoji: '🪏', kind: 'shovel' },
  { id: 'master-key', name: 'Master Key', cost: 5, emoji: '🗝️', kind: 'key' },
  { id: 'megaphone', name: 'Megaphone', cost: 1, emoji: '📢', kind: 'megaphone' },
  { id: 'vault', name: 'Vault', cost: 50, emoji: '🔐', kind: 'vault' },
  { id: 'potion-kalawang', name: 'Kalawang Potion', cost: 8, emoji: '🧪', kind: 'potion' },
  { id: 'potion-tago', name: 'Tago Tonic', cost: 6, emoji: '🫥', kind: 'potion' },
  { id: 'potion-swerte', name: 'Swerte Elixir', cost: 5, emoji: '🍀', kind: 'potion' },
  { id: 'potion-marites', name: 'Marites Tea', cost: 3, emoji: '🍵', kind: 'potion' },
  { id: 'bag-supot', name: 'Supot (Plastic Bag)', cost: 5, emoji: '🛍️', kind: 'bag' },
  { id: 'bag-bayong', name: 'Bayong', cost: 10, emoji: '🧺', kind: 'bag' },
  { id: 'bag-backpack', name: 'School Backpack', cost: 20, emoji: '🎒', kind: 'bag' },
  { id: 'bag-balikbayan', name: 'Balikbayan Box', cost: 35, emoji: '🧳', kind: 'bag' },
  { id: 'bag-lola', name: "Lola's Bottomless Bag", cost: 50, emoji: '👜', kind: 'bag' },
  { id: 'phantasium', name: 'Phantasium Pass', cost: 1_700, emoji: '🎟️', kind: 'pass' },
  { id: 'basic-bp', name: 'Basic Battle Pass', cost: 2_450, emoji: '⚔️', kind: 'pass' },
  { id: 'advanced-bp', name: 'Advanced Battle Pass', cost: 3_650, emoji: '👑', kind: 'pass' },
] as const;

export type RewardId = (typeof rewards)[number]['id'];

// Bakod (Fence): blocks /steal against you. Buying again adds more time, up to FENCE_MAX_DAYS.
export const BAG_SLOTS = 8;

export const FENCE_DAYS = 1.5; // nerfed from 3 on 2026-09-30; existing fences kept their end times
export const FENCE_MAX_DAYS = 7;

// Every redemption is appended to the `redemptions` table.
const insert = db.prepare('INSERT INTO redemptions (user_id, reward, cost, at) VALUES (?, ?, ?, ?)');

export function recordRedemption(userId: string, reward: RewardId, cost: number): void {
  insert.run(userId, reward, cost, new Date().toISOString());
}
