import type { User } from 'discord.js';
import type { TownAnnouncement, TownSystemLine } from '@mikazuki/shared';
import { getNickname } from './nickname.js';
import type { Town } from './town.js';

// 📰 The web town's system feed — what happens around the server (digs, bets), shown bottom right — and its banners
// (announce: jackpot wins, the owner's notices). Commands call these; the web server connects the town once it's up. Names are town nicknames where people have one.

let town: Town | null = null;

export function connectTownFeed(t: Town): void {
  town = t;
}

/** Someone's name as the town knows them. */
export const townName = (user: User): string => getNickname(user.id) ?? user.globalName ?? user.username;

/** A line for the town's system feed. Digs and bets can also say who (the town turns the Discord id into their town
 *  player id), what was found, and how much was bet. */
export function feed(
  kind: TownSystemLine['kind'],
  text: string,
  tone: string,
  who?: { userId: string; itemId?: string; itemName?: string; amount?: number },
): void {
  const extra = { ...(who?.itemId ? { itemId: who.itemId, itemName: who.itemName ?? who.itemId } : {}), ...(who?.amount !== undefined ? { amount: who.amount } : {}) };
  town?.system({ kind, text, tone, ...extra }, who?.userId);
}

/** A banner across the top of the town (jackpot wins, the owner's notices). */
export function announce(a: TownAnnouncement): void {
  town?.announce(a);
}

/** A gift pop-up for a member in town (Kowens from `from`), e.g. /gift kowens. */
export function townGift(userId: string, from: string, amount: number): void {
  town?.gifted(userId, from, amount);
}

/** The gifter gave a member an item: a pop-up, if they're in the web town. */
export function townGiftItem(userId: string, from: string, item: { id: string; name: string; rarity: string }, quantity: number): void {
  town?.giftedItem(userId, from, item, quantity);
}

/** Shows a member as jailed (or not) in the town, if they're in it. */
export function townJailed(userId: string, on: boolean): void {
  town?.setJailed(userId, on);
}

/** Removes a member from the town right now, if they're in it (moderation keeps them out until `until`). */
export function kickFromTown(userId: string, until: number): boolean {
  return town?.kick(userId, until) ?? false;
}
