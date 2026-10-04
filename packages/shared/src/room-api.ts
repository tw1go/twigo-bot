// Response shapes of the twigo's-room API (the bot's src/web/server.ts), served at https://twigo-bot.duckdns.org.

/** One row of `GET /leaderboard`. */
export interface LeaderboardRow {
  rank: number;
  /** Server nickname, or Discord display name. */
  name: string;
  /** Avatar URL (64px PNG), or '' if unknown. */
  avatar: string;
  kowens: number;
}

/** `GET /leaderboard` */
export interface LeaderboardResponse {
  /** ms timestamp of when the board was computed (cached for ~30s). */
  updated: number;
  rows: LeaderboardRow[];
}

/** `POST /find` — whether a click in the room turned up a Kowen. Codes are claimed with /claim in Discord. */
export type FindResult =
  | { found: false; reason?: 'slow-down' | 'limit' }
  | { found: true; code: string; expires: number; reward: number };

/** One stack of dug-up items in `GET /me`. */
export interface MeItem {
  id: string;
  name: string;
  emoji: string;
  rarity: string;
  count: number;
}

/**
 * A character's look: wardrobe item and colour names from the game's manifest (characters.wardrobe,
 * colourPresets, skinTones). Saved per member with `PUT /outfit`.
 */
export interface OutfitData {
  skin: string;
  hair: string;
  hairColour: string;
  top: string;
  topColour: string;
  topTrim: string;
  bottom: string;
  bottomColour: string;
  bottomTrim: string;
  shoes: string;
  shoesColour: string;
  glasses?: string;
  glassesColour?: string;
  hat?: string;
  hatColour?: string;
}

/** `GET /me` — the member logged in to the web game (401 when not logged in). */
export interface MeResponse {
  /** Discord user ID. */
  id: string;
  /** Server nickname, or Discord display name. */
  name: string;
  /** Avatar URL (64px PNG), or '' if unknown. */
  avatar: string;
  /** Wallet Kowens (not counting the vault). */
  kowens: number;
  vault: number;
  /** Rank by total Kowens, or null with none. */
  rank: number | null;
  items: MeItem[];
  /** Signed up for the launch reward (see `/prereg`). */
  preregistered: boolean;
  /** Their saved character look, or null if they haven't made one. */
  outfit: OutfitData | null;
  /** Their nickname in the web game (`PUT /nickname`), or null if they haven't picked one. */
  nickname: string | null;
  /** Their title, shown under the nickname as <Title> (Townfolk by default; others are given or earned). */
  title: TitleData;
  /** The title is new to them: the game shows it in a reward pop-up, then calls `POST /title/seen`. */
  newTitle: boolean;
  /** Digging today (see /dig and /redeem reward:Shovel). */
  dig: MeDig;
  /** May play the web town (before launch: testers, mods and admins; after launch: everyone). */
  canPlay: boolean;
  /** Their Discord status, shown on the avatar (not sent yet: needs the Presence intent; dev fakes it). */
  status?: PresenceStatus;
}

/** The status dots in the art (manifest ui.statusDots). */
export type PresenceStatus = 'online' | 'idle' | 'busy' | 'offline' | 'jailed';

export interface MeDig {
  /** Digs left on their shovel(s). */
  shovel: number;
  /** Digs left today (the daily cap minus today's digs). */
  digsLeft: number;
  digsPerDay: number;
  /** Shovels they can still buy today, and what one costs and gives. */
  shovelsLeft: number;
  shovelCost: number;
  shovelUses: number;
}

/** `GET /town/leaderboard` (logged in, may play): the top 10 by Kowens, as the town knows them. */
export interface TownLeaderboardResponse {
  rows: TownLeaderboardRow[];
  /** The viewer: their rank (null with no Kowens) and Kowens (wallet + vault). */
  me: { rank: number | null; kowens: number };
}

export interface TownLeaderboardRow {
  rank: number;
  /** Their town nickname, or their Discord name. */
  name: string;
  title: TitleData;
  kowens: number;
  /** This row is the viewer. */
  me?: boolean;
  /** Their character's look (top 3 only, for the podium; null if they haven't made one). */
  outfit?: OutfitData | null;
}

/** The jackpot booth: the next draw's pot and players, the viewer's tickets, and the last draw. */
export interface TownJackpotResponse {
  /** Kowens in the pot (1 per ticket). */
  pot: number;
  /** The most tickets one member may hold per draw. */
  max: number;
  /** Fewer players than this and everyone is refunded. */
  minPlayers: number;
  /** When the next draw happens (ms). */
  nextDraw: number;
  /** Everyone in the next draw, most tickets first (town nicknames). */
  players: { name: string; tickets: number; me?: boolean }[];
  /** The viewer's tickets and wallet. */
  mine: number;
  kowens: number;
  /** When the viewer gets out of jail (ms), if they're in it: no tickets till then. */
  jailedUntil: number | null;
  last: { at: number; winner: string | null; pot: number; players: number; me?: boolean } | null;
}

/** POST /town/jackpot { tickets } → the booth afterwards, and what happened. */
export type TownJackpotBuyResponse = TownJackpotResponse &
  ({ bought: number } | { refused: 'max' | 'kowens' | 'jailed' });

/** The bank: wallet, vault and loans as the viewer sees them. */
export interface TownBankResponse {
  wallet: number;
  /** Null without a vault (bought with /redeem in Discord for `vaultPrice`). */
  vault: { inside: number; capacity: number; minWithdraw: number } | null;
  vaultPrice: number;
  /** The vault holds up to this share of everything you own; withdrawals take at least this share of what's inside. */
  vaultCap: number;
  vaultMinWithdraw: number;
  /** What the viewer owes, if anything ('Tanod Bank' or the lender's name). */
  loan: { owed: number; lender: string; due: number; overdue: boolean; defaulted: boolean } | null;
  /** The Tanod Bank: how much it will lend the viewer (0 when blacklisted), and its terms. */
  bank: { limit: number; blacklistedUntil: number | null; interest: number; dueDays: number; garnish: number };
  /** Loans the viewer gave other members. */
  lent: { name: string; owed: number; due: number; defaulted: boolean }[];
}

export type TownBankAction = 'deposit' | 'withdraw' | 'borrow' | 'repay';

/** POST /town/bank { action, amount } → the bank afterwards, whether it worked, and what to tell the member. */
export type TownBankActionResponse = TownBankResponse & { ok: boolean; message: string };

/** A title: its name, and its colour ('#RRGGBB', or 'prismatic' for a shifting rainbow). */
export interface TitleData {
  name: string;
  color: string;
}

/** `GET /prereg` — public pre-registration status for the web game. */
export interface PreregStatus {
  /** False once the game has launched. */
  open: boolean;
  count: number;
  /** Kowens each pre-registered member gets at launch. */
  reward: number;
}

/** `POST /prereg` (logged in) — sign up. */
export interface PreregResponse {
  result: 'joined' | 'already' | 'closed';
  count: number;
}
