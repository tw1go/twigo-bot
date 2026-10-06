// The town's live connection (WebSocket at /ws, logged-in members only): who else is in town and where.
// JSON messages, one per frame. Players are identified by a random id per connection, never their Discord ID.
// A moderator's kick closes the socket with code 4001 and the time (ms) they may come back as the reason.

import type { HoodHouse, OutfitData, TitleData } from './room-api.js';

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
  /** In jail (shown under their name). */
  jailed?: boolean;
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
  /** `megaphone`: uses one of the sender's megaphones; the line runs across everyone's screen. */
  | { t: 'say'; text: string; megaphone?: boolean }
  /** An emote over your head (one of TOWN_EMOTES). */
  | { t: 'emote'; emote: TownEmote }
  /** The Arena's jack en poy against another player (bot web/town-arena.ts): join the queue (with an optional bet in
   *  Kowens), leave it, pick a hand for the open round, ask for a rematch or accept one (with a bet), decline one, leave
   *  the match. The stake is the smaller of the two bets. */
  | { t: 'arena-queue'; bet?: number }
  /** A match against the bot, played on the server (so it can be bet on). */
  | { t: 'arena-bot'; bet?: number }
  | { t: 'arena-cancel' }
  | { t: 'arena-pick'; hand: ArenaHand }
  | { t: 'arena-rematch'; bet?: number }
  | { t: 'arena-decline' }
  | { t: 'arena-leave' };

/** Jack en poy: bato (rock) beats gunting (scissors), gunting beats papel (paper), papel beats bato. */
export type ArenaHand = 'bato' | 'papel' | 'gunting';

/** Server → browser, during an Arena match (everything is "you" and "them", as the player sees it). */
export type ArenaServerMessage =
  /** In the queue, waiting for someone. */
  | { t: 'arena-queued' }
  /** Matched (or a rematch both accepted): who against, first to `firstTo` round wins, and the stake each put in (Kowens,
   *  0 for none; the winner gets both). */
  | { t: 'arena-start'; opponent: Pick<TownPlayer, 'id' | 'nickname' | 'title' | 'outfit'> & { bot?: boolean }; firstTo: number; rematch: boolean; stake: number }
  /** A round opens: pick within `ms` (a random hand is picked for you after that). */
  | { t: 'arena-round'; round: number; ms: number }
  /** Both hands, shown together. `random` says whose hand was picked for them (time ran out); `over` ends the match. */
  | { t: 'arena-reveal'; you: ArenaHand; them: ArenaHand; result: 'win' | 'lose' | 'draw'; score: [number, number]; random: [boolean, boolean]; over?: 'you' | 'them' }
  /** The other player left: mid-match, you win (and the stake); after it, no rematch. */
  | { t: 'arena-left'; youWin: boolean }
  /** You asked for a rematch; waiting for the other player. */
  | { t: 'arena-rematch-wait' }
  /** The other player asks for a rematch, betting `bet` (accept with arena-rematch, or arena-decline). */
  | { t: 'arena-rematch-ask'; bet: number }
  /** They said no to your rematch. */
  | { t: 'arena-rematch-declined' };

/** Emotes: the icons in the art's emote sheet (ui.emotes), plus a wave. */
export type TownEmote = 'heart' | 'laugh' | 'exclaim' | 'question' | 'kowen' | 'sleep' | 'angry' | 'wave';

/** A line of the town chat, as kept for people arriving (the last few, in memory only). */
export interface TownChatLine {
  name: string;
  text: string;
  /** Said in the town's Discord channel rather than in town. */
  discord?: boolean;
  /** Said through a megaphone. */
  megaphone?: boolean;
}

/** A line in the town's system feed: something that happened around the server (a dig, a bet). */
export interface TownSystemLine {
  kind: 'dig' | 'gamble' | 'jackpot' | 'shop' | 'gift' | 'jail' | 'quest' | 'arena' | 'steal';
  text: string;
  /** Colour key: a dig's rarity, win / lose / bust, jackpot, shop, or gift. */
  tone: string;
  /** Dig and bet lines: what was found (the dig item's id), and who dug or bet — their town player id, only while
   *  they're in town (never a Discord id), so the town can play the dig panel or the bet's effects. Older games ignore
   *  them. */
  itemId?: string;
  itemName?: string;
  playerId?: string;
  /** Bet lines: how much was bet (big wins burst coins over the winner in town). */
  amount?: number;
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
  | { t: 'say'; id: string; text: string; megaphone?: boolean; /** The speaker's nickname (they may be in another room). */ name?: string }
  /** A banner for everyone in town. */
  | { t: 'announce'; announcement: TownAnnouncement }
  /** Something happened around the server (the system feed). */
  | { t: 'system'; line: TownSystemLine }
  /** Staying in town: a Kowen is ready to claim (web/town-stay.ts). */
  | { t: 'stay'; stay: TownStayInfo }
  /** Someone dissed, praised or judged someone (the player menu): `id` says the line (the target's name is in it). */
  | { t: 'verdict'; id: string; kind: 'roast' | 'praise'; judged: boolean; text: string }
  /** You have a new title (e.g. you just became the richest): the reward pop-up, then `POST /title/seen { id }`. */
  | { t: 'new-title'; id: string; title: TitleData }
  /** The neighbourhood: someone built a house ('built': it rises on its lot, top tile col/row, door tile) or gave theirs a
   *  new look ('look'). Only to those in the neighbourhood. */
  | { t: 'house'; change: 'built' | 'look'; house: HoodHouse; col: number; row: number; door: [number, number] }
  /** Someone changed their look or title at the Parlor (you too: `id` is yours). */
  | { t: 'look'; id: string; outfit: OutfitData; title: TitleData }
  /** Someone was jailed or released (you too: `id` is yours). */
  | { t: 'jailed'; id: string; on: boolean }
  /** Someone flexed an item from their bag (`id` says it; to everyone, them included). */
  | { t: 'flex'; id: string; itemId: string; itemName: string; rarity: string }
  /** Someone gave you Kowens (from the town's player menu). */
  | { t: 'gift'; from: string; amount: number }
  /** The gifter gave them an item (/gift item): a pop-up with its picture. */
  | { t: 'gift-item'; from: string; item: { id: string; name: string; rarity: string }; quantity: number }
  /** Your Kowens changed (anywhere: a command, voice rewards, a draw…): the HUD reloads them. */
  | { t: 'wallet' }
  /** Someone emoted (not sent back to the one who did it: they show it right away). */
  | { t: 'emote'; id: string; emote: TownEmote }
  /** Someone said something in the town's Discord channel (shown with a Discord mark, no bubble). */
  | { t: 'say-discord'; name: string; text: string }
  /** Your message wasn't sent: too fast, empty / too long once tidied, or you're muted (until when, ms). */
  /** 'megaphone': they have none (bought in the shop). */
  | { t: 'say-refused'; reason: 'slow' | 'invalid' | 'muted' | 'megaphone'; until?: number }
  | ArenaServerMessage;

/** Staying in the web town pays (bot web/town-stay.ts): a Kowen to claim every `every` minutes in town (`minutes`
 *  counted toward the next; the count waits while one is `ready`), up to `max` a day. */
export interface TownStayInfo {
  ready: boolean;
  minutes: number;
  every: number;
  claimed: number;
  max: number;
  /** Voice chat in Discord pays too (1 Kowen per `every` minutes, up to `max` a day): earned today and the minutes toward
   *  the next. Only in GET /town/stay (the `stay` messages leave it out). */
  voice?: { earned: number; max: number; minutes: number; every: number };
  /** The daily Kowens (/get-kowens): claimed today or not, and how many they are today. Only in GET /town/stay. */
  daily?: TownDailyInfo;
}

export type TownStayClaim = { ok: true; kowens: number; stay: TownStayInfo } | { ok: false; error: string };

export interface TownDailyInfo {
  claimed: boolean;
  amount: number;
}

/** POST /town/daily: the daily Kowens claimed (`kowens` = the balance after; `christmas` = doubled today). */
export type TownDailyClaim = { ok: true; amount: number; kowens: number; christmas: boolean } | { ok: false; error: string };
