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
