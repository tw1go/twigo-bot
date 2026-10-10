import { type Client, type User, escapeMarkdown } from 'discord.js';
import type { TownAnnouncement, TownRace, TownSystemLine } from '@mikazuki/shared';
import { config } from '../config.js';
import { RARITY, type Rarity } from '../dig/items.js';
import { getNickname } from './nickname.js';
import type { Town } from './town.js';

// 📰 The web town's system feed — what happens around the server (digs, bets), shown bottom right — and its banners
// (announce: jackpot wins, the owner's notices). Commands call these; the web server connects the town once it's up. Names are town nicknames where people have one.
// Every line and banner also goes to TOWN_FEED_CHANNEL_ID in Discord (if set): gathered for a few seconds into one
// message (so a busy minute stays a few posts), an emoji per kind, no pings, names' markdown escaped.

let town: Town | null = null;

export function connectTownFeed(t: Town): void {
  town = t;
}

const ICON: Record<TownSystemLine['kind'], string> = { dig: '⛏️', gamble: '🪙', jackpot: '🎟️', shop: '🎁', gift: '🎁', jail: '🚔', quest: '📜', arena: '⚔️', steal: '🥷', race: '🏁', golem: '🗿', warrens: '🕳️', forge: '🔨' }; // (golem and warrens lines stay in their rooms: never here)
const GATHER_MS = 3000;
const MAX_POST = 1900;
let client: Client | null = null;
const waiting: string[] = [];
let flushing: ReturnType<typeof setTimeout> | null = null;

/** Posts the feed in Discord too (from the bot's ready; nothing without TOWN_FEED_CHANNEL_ID). */
export function connectFeedChannel(c: Client): void {
  if (config.townFeedChannelId) client = c;
}

/** Queues a line for the feed's Discord channel; what's gathered goes out together after a moment. */
function toDiscord(line: string): void {
  if (!client) return;
  waiting.push(line);
  flushing ??= setTimeout(() => void flush(), GATHER_MS);
}

async function flush(): Promise<void> {
  flushing = null;
  const lines = waiting.splice(0);
  const channel = client && (await client.channels.fetch(config.townFeedChannelId!).catch(() => null));
  if (!channel?.isSendable()) return;
  // As few posts as fit (Discord's 2,000-character limit).
  const posts: string[] = [];
  for (const l of lines) {
    if (posts.length && posts[posts.length - 1].length + l.length + 1 <= MAX_POST) posts[posts.length - 1] += `\n${l}`;
    else posts.push(l.slice(0, MAX_POST));
  }
  for (const content of posts) await channel.send({ content, allowedMentions: { parse: [] } }).catch((err) => console.error('[feed] post failed:', err));
}

/** A feed line as Discord shows it: its kind's emoji (a dig's rarity marker after it), the text as plain text. */
function feedLine(kind: TownSystemLine['kind'], text: string, tone: string): string {
  const rarity = kind === 'dig' && tone in RARITY && tone !== 'junk' && tone !== 'common' ? ` ${RARITY[tone as Rarity].emoji}` : '';
  return `${ICON[kind] ?? '•'}${rarity} ${escapeMarkdown(text)}`;
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
  toDiscord(feedLine(kind, text, tone));
}

/** A banner across the top of the town (jackpot wins, the owner's notices). */
export function announce(a: TownAnnouncement): void {
  town?.announce(a);
  toDiscord(`${a.kind === 'jackpot' ? '🎉' : '📢'} **${escapeMarkdown(a.title)}**${a.text ? ` · ${escapeMarkdown(a.text)}` : ''}`);
}

/** The Mosang race changed (games/race.ts): everyone in town sees it (null: it's over). */
export function townRace(state: TownRace | null): void {
  town?.race(state);
}

/** A gift pop-up for a member in town (Kowens from `from`), e.g. /gift kowens. */
export function townGift(userId: string, from: string, amount: number): void {
  town?.gifted(userId, from, amount);
}

/** The gifter gave a member an item: a pop-up, if they're in the web town. */
export function townGiftItem(userId: string, from: string, item: { id: string; name: string; rarity: string }, quantity: number): void {
  town?.giftedItem(userId, from, item, quantity);
}

/** A member's combat bag changed outside the town (a gift): their bag in town shows it. */
export function townItems(userId: string): void {
  town?.items(userId);
}

/** Shows a member as jailed (or not) in the town, if they're in it. */
export function townJailed(userId: string, on: boolean): void {
  town?.setJailed(userId, on);
}

/** Removes a member from the town right now, if they're in it (moderation keeps them out until `until`). */
export function kickFromTown(userId: string, until: number): boolean {
  return town?.kick(userId, until) ?? false;
}
