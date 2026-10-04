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

/** The rewards shop: what /redeem sells, as the viewer sees it. */
export interface TownShopResponse {
  kowens: number;
  items: TownShopItem[];
  /** The viewer's Bakod lasts until (ms), if up. */
  fenceUntil: number | null;
  /** Passes can't be redeemed with a loan. */
  inDebt: boolean;
}

export interface TownShopItem {
  /** The reward's id (/redeem's), also its art: manifest items[id]. */
  id: string;
  name: string;
  cost: number;
  kind: 'fence' | 'shovel' | 'key' | 'vault' | 'potion' | 'bag' | 'pass';
  /** What it does. */
  about: string;
  /** Most that can be bought at once now (0 = none today, e.g. shovels). */
  max: number;
  /** A one-time reward the viewer already has. */
  owned?: boolean;
  /** How many the viewer has (potions, Master Keys). */
  have?: number;
}

/** POST /town/shop { id, quantity } → the shop afterwards, whether it worked, and what to tell the member. */
export type TownShopBuyResponse = TownShopResponse & { ok: boolean; message: string };

/** GET /town/player?id= : another player in town, as /balance and /status show them, and what the viewer can give. */
export interface TownPlayerInfo {
  name: string;
  title: TitleData;
  status: PresenceStatus;
  wallet: number;
  /** Null without a vault. */
  vault: number | null;
  rank: number | null;
  bakodUntil: number | null;
  jailedUntil: number | null;
  /** What they owe on a loan, if anything. */
  loan: number | null;
  jackpotTickets: number;
  /** Days without activity, once they're losing Kowens for it. */
  inactiveDays: number | null;
  /** The viewer's gifting: how many more Kowens they can give today, of the daily limit, and their wallet. */
  give: { left: number; limit: number; wallet: number; inDebt: boolean };
}

/** POST /town/verdict { to, mode }: /diss, /praise or /judge on a player in town (1 Kowen). */
export type TownVerdictMode = 'diss' | 'praise' | 'judge';

/** POST /town/give { to, amount } and /town/verdict → whether it worked, what to tell the sender, and the player afterwards. */
export type TownGiveResponse = { ok: boolean; message: string; player: TownPlayerInfo | null };

/** The Tanod outpost: who's in jail (bail them out like /bail) and how Tanod Patrol works. */
export interface TownOutpostResponse {
  /** Everyone in jail, soonest out first. `id` is for bailing them out (not their Discord id). */
  jailed: { id: string; name: string; until: number; reason: string; bail: number | null; me?: boolean }[];
  /** The viewer's wallet (bail is paid from it). */
  wallet: number;
  /** Bail: this share of the jailed member's Kowens, between min and max. */
  bail: { percent: number; min: number; max: number };
  patrol: {
    /** Calling roll in Discord right now. */
    active: boolean;
    rewards: number[];
    windowSeconds: number;
    slowpokeMinutes: number;
    /** Patrols only between these hours, every minGap–maxGap hours. */
    fromHour: number;
    untilHour: number;
    minGapHours: number;
    maxGapHours: number;
  };
}

/** POST /town/bail { id } → the outpost afterwards, whether it worked, and what to tell the payer. */
export type TownBailResponse = TownOutpostResponse & { ok: boolean; message: string };

/** The notice board: open and in-progress quests (/request), and whether the viewer can post one. */
export interface TownBoardResponse {
  quests: TownQuest[];
  maxReward: number;
  maxActive: number;
  /** The viewer's quests still open or in progress, their wallet (the reward is held from it), and a loan blocks posting. */
  myActive: number;
  wallet: number;
  inDebt: boolean;
}

export interface TownQuest {
  id: string;
  task: string;
  reward: number;
  status: 'open' | 'accepted';
  /** Who posted it, and who's on it (town nicknames). */
  by: string;
  helper: string | null;
  /** The viewer posted it / accepted it. */
  mine?: boolean;
  helping?: boolean;
  created: number;
}

export type TownBoardAction = 'post' | 'accept' | 'giveup' | 'complete' | 'cancel';

/** POST /town/board { action, id? | task + reward } → the board afterwards, whether it worked, and what to say. */
export type TownBoardActionResponse = TownBoardResponse & { ok: boolean; message: string };

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
