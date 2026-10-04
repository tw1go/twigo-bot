// The town's live connection (WebSocket at /ws, logged-in members only): who else is in town and where.
// JSON messages, one per frame. Players are identified by a random id per connection, never their Discord ID.

import type { OutfitData, TitleData } from './room-api.js';

export type TownDir = 's' | 'se' | 'e' | 'ne' | 'n' | 'nw' | 'w' | 'sw';

export interface TownPlayer {
  id: string;
  nickname: string;
  title: TitleData;
  outfit: OutfitData;
  col: number;
  row: number;
  dir: TownDir;
  /** Sitting on the bench at (col, row). */
  sit: boolean;
}

/** Browser → server. A step is to a neighbouring tile; the server checks it (walkable, adjacent, walking speed). */
export type TownClientMessage =
  /** Right after the welcome only: where you already are (after a reconnect), instead of the spawn point. */
  | { t: 'here'; col: number; row: number; dir: TownDir }
  | { t: 'step'; col: number; row: number }
  | { t: 'face'; dir: TownDir }
  | { t: 'sit'; col: number; row: number; dir: TownDir }
  | { t: 'stand' }
  /** Say something (1–120 characters after tidying; a few at once, then about one every 2 s). */
  | { t: 'say'; text: string }
  /** An emote over your head (one of TOWN_EMOTES). */
  | { t: 'emote'; emote: TownEmote };

/** Emotes: the icons in the art's emote sheet (ui.emotes), plus a wave. */
export type TownEmote = 'heart' | 'laugh' | 'exclaim' | 'question' | 'kowen' | 'sleep' | 'angry' | 'wave';

/** A line of the town chat, as kept for people arriving (the last few, in memory only). */
export interface TownChatLine {
  name: string;
  text: string;
  /** Said in the town's Discord channel rather than in town. */
  discord?: boolean;
}

/** A line in the town's system feed: something that happened around the server (a dig, a bet). */
export interface TownSystemLine {
  kind: 'dig' | 'gamble';
  text: string;
  /** Colour key: a dig's rarity, or win / lose / bust. */
  tone: string;
}

/** A banner across the top of the town: a jackpot win, or a notice from the owner (maintenance and such). */
export interface TownAnnouncement {
  kind: 'jackpot' | 'notice';
  title: string;
  text: string;
}

/** Server → browser. */
export type TownServerMessage =
  /** `spawn`: where you arrive (a free tile near the town's spawn point), unless you're already somewhere (a reconnect). */
  | { t: 'welcome'; you: string; players: TownPlayer[]; recent: TownChatLine[]; system: TownSystemLine[]; spawn: [number, number];
      /** The owner's latest notice, while it's still current (30 minutes). */
      notice?: TownAnnouncement }
  | { t: 'join'; player: TownPlayer }
  | { t: 'leave'; id: string }
  | { t: 'step'; id: string; col: number; row: number }
  | { t: 'face'; id: string; dir: TownDir }
  | { t: 'sit'; id: string; col: number; row: number; dir: TownDir }
  | { t: 'stand'; id: string }
  /** Your last step was refused: you're really at (col, row). */
  | { t: 'snap'; col: number; row: number }
  /** That bench is taken (followed by a snap back to where you stood). */
  | { t: 'seat-taken' }
  /** Someone said something (you too: your own words come back this way). */
  | { t: 'say'; id: string; text: string }
  /** A banner for everyone in town. */
  | { t: 'announce'; announcement: TownAnnouncement }
  /** Something happened around the server (the system feed). */
  | { t: 'system'; line: TownSystemLine }
  /** Someone emoted (not sent back to the one who did it: they show it right away). */
  | { t: 'emote'; id: string; emote: TownEmote }
  /** Someone said something in the town's Discord channel (shown with a Discord mark, no bubble). */
  | { t: 'say-discord'; name: string; text: string }
  /** Your message wasn't sent: too fast, or empty / too long once tidied. */
  | { t: 'say-refused'; reason: 'slow' | 'invalid' };
