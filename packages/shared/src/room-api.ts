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
}

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
