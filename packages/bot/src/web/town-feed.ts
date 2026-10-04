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

export function feed(kind: TownSystemLine['kind'], text: string, tone: string): void {
  town?.system({ kind, text, tone });
}

/** A banner across the top of the town (jackpot wins, the owner's notices). */
export function announce(a: TownAnnouncement): void {
  town?.announce(a);
}

/** Removes a member from the town right now, if they're in it (moderation keeps them out until `until`). */
export function kickFromTown(userId: string, until: number): boolean {
  return town?.kick(userId, until) ?? false;
}
