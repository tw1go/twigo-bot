import type { User } from 'discord.js';
import type { TownSystemLine } from '@mikazuki/shared';
import { getNickname } from './nickname.js';
import type { Town } from './town.js';

// 📰 The web town's system feed: what happens around the server (digs, bets), shown bottom right in town. Commands
// call feed(); the web server connects the town once it's up. Names are town nicknames where people have one.

let town: Town | null = null;

export function connectTownFeed(t: Town): void {
  town = t;
}

/** Someone's name as the town knows them. */
export const townName = (user: User): string => getNickname(user.id) ?? user.globalName ?? user.username;

export function feed(kind: TownSystemLine['kind'], text: string, tone: string): void {
  town?.system({ kind, text, tone });
}
