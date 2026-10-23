import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { Arena, type ArenaBets, type ArenaSeat, arenaLine } from './town-arena.js';
import type { LevelGain } from './progress.js';
import type { Attacker, MobHit, MobKill, MobRoom } from './town-mobs.js';
import { PARTY_MAX, type PartyChange, Parties } from './town-party.js';
import { type FriendStore, Friends } from './town-friends.js';
import { BIIKKO_KIND, CARRIER_AWAY_MS, type Halloween, UPPER_KIND } from './halloween.js';
import { type GreatScale, PAN_KIND, scaleDownLine } from './town-great-scale.js';
import { type VitalMax, Vitals, shown } from './town-vitals.js';
import { Buffs, type DishOn, type Nearby } from './town-buffs.js';
import { levelingFor, loadItemData, loadPalengkeLeveling, loadStats } from './stats-data.js';
import { type CombatItems, type LootContent, potionMinLevel, potionOf } from './combat-bag.js';
import { type Loot, LootRoom, gotOf, splitKusing } from './town-loot.js';
import { type LootRoll, LootRolls } from './town-roll.js';
import { type HeldOffer, type Trade, Trades, checkOffer } from './trade.js';
import { type Inside, type Run, type RunDeps, type RunNews, Warrens, type WarrensAccess, type WarrensMap } from './town-warrens.js';
import { Silong, type SilongAccess, type SilongInside, type SilongMap, type SilongNews, type SilongRun } from './town-silong.js';
import type { SilongData, SilongFloor, FriendAsk, FriendView, FriendsState, HalloweenReward, LootGot, PrivacySettings, TestingSettings, WarrensData, ChatItemLink, CharacterProgress, QuestProgress, HoodHouse, HoodMap, OutfitData, PartyState, Target, TownRace, TitleData, TownAnnouncement, TownChatLine, TownClientMessage, TownDir, TownEmote, TownMove, TownPlayer, TownServerMessage, TownStayInfo, TownSystemLine, TownItems, Item, TradeEnd, TradeView } from '@mikazuki/shared';
import { SILONG_FLOORS, chillMove, chillRules, floorOfArea, type LanternPost, type PalengkeData, type Visibility, PALENGKE, VISIBILITIES, dishMs, dishOf, moveSpeedOf, PetXpClock, moveDodgeMs, petRules, petXpForHit, isLanternMap, itemName, itemStats, blockedWithPosts, lanternPostsOf, lanternRefusal, lootRollRules, rollWorthy, partyXpMult, partyXpRange, potionCooldownGroup, skillMpCost, targetPriority, tradeRules } from '@mikazuki/shared';

// 🏘️ Who's in the web town, and where: a WebSocket at /ws for logged-in members (see room-api's town.ts for the
// messages). The server keeps everyone's tile and checks each step — on the map, not blocked, next to the last
// one, no faster than walking — and passes it on to everyone else; chat goes to everyone, tidied and rate-limited.
// Nothing here is saved (positions or chat): leave and you're gone.
// The Arena's jack en poy against another player is played here too (town-arena.ts decides it; the messages are
// arena-*).
// One connection per member (a second tab takes over). Login and profiles come from the caller (server.ts), so
// this file has no Discord in it.
// Rooms: the town, and others the caller adds (the neighbourhood), picked with ?room= on the socket's address (going
// from one to the other is a new connection). Walking, benches and who you see are per room; chat, the system feed,
// banners and everything about a member (gifts, looks, jail) reach everyone. Parties (town-party.ts) span every room.
// Buffs (town-buffs.ts, by member, in memory): `buff` casts one on a battle map (MP, cooldown, its party range), the room
// sees `buff-cast`, those it reaches get `buffs` (their tray) and the stats (fighterOf puts them on every fight and on
// their most HP and DEF); Soothing Touch heals instead (`buff-heal`). Timed ones end on time, off the battle map and on
// a knock-out; a stance on a class change.
// HP and MP (town-vitals.ts, by member, in memory): where there are mobs (TownOptions.mobs), their hits land here
// (MobRoom.landed) and come off HP; each change goes to the player, their room (the bar over their head) and their party.
// At 0 they're knocked out (no steps, moves or attacks; mobs forget them) and after 3 s respawn at the room's way in
// (its spawn point, where arrivals land). Slowed (the Bag's), their steps are held to half; blinded, their attacks miss.
// Loot (town-loot.ts, by room, in memory): each kill's drops land round it, shown per player (faint while someone
// else's; the golem's only to its owner); walking onto loot (or next to Kusing) or `pick` takes it into their combat bag
// through TownOptions.items (saved by the bot), and `items` tells them. HP and MP Potions (`potion`) heal at once, with
// one shared cooldown per member (stats.json potions.sharedCooldownSec), only in battle maps and never when it'd do
// nothing.
// Trades (trade.ts, in memory): asked from the player menu, within stats.json trading's range by the positions kept
// here, in the same room; the asked one has its timeout to accept. Each side's changes are checked against their combat
// bag (TownOptions.items.state) and unlock both; with both locked and Trade pressed by both, TownOptions.items.trade
// checks it all again and moves it in one go (or nothing). Walking (or being moved) out of range, leaving, another tab
// taking over, a moderator's kick, or being knocked out cancels it.
// The Scrap Warrens (town-warrens.ts, TownOptions.warrens): each run is a room of its own, `warrens:<id>`, made as it
// opens and dropped as it closes, with its own mobs (the run's MobRoom, on its own copy of the map) and loot (first come,
// no head start: only its party is inside). The page joins `?room=warrens` and lands in the run it may be in (its
// party's, or its own); none → `warrens-out`. The Warren Gate's messages (warrens-gate/-open/-join/-start/-leave) open
// and join runs; the runs' clock (each second) starts them, scales them, sends who's inside the tracker and sends out
// those who must go. Wire Wolf's Live Floor stuns (no steps for its ms).
// Party XP: every kill's XP (bosses aside) is shared equally between the killer's party members in the same room within
// stats.json party.xpRangeTiles, the knocked out too, the total raised per extra member (partyXpMult).

const DIRS = new Set<TownDir>(['s', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw']);
const MOVES = new Set<TownMove>(['dash', 'step-back', 'charge', 'blink']);
/** How near the Great Scale's bell you ring it (tiles). */
const BELL_TILES = 3;
const cheb = (a: [number, number], b: [number, number]) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
const EMOTES = new Set<TownEmote>(['heart', 'laugh', 'exclaim', 'question', 'kowen', 'sleep', 'angry', 'wave']);
/** Emotes: a burst of 3, then one a second. */
const EMOTES_PER_SECOND = 1;
const EMOTE_BURST = 3;
/** Walking is 4 tiles a second; allow a little more, in bursts (messages bunch up on a bad connection). Slowed: half. */
const STEPS_PER_SECOND = 6;
const STEP_BURST = 6;
/** Mobs' hits land, HP and MP come back and the knocked out respawn on this clock (ms). */
const VITALS_MS = 100;
const HEARTBEAT_MS = 30_000;
/** Arrivals spread over the free tiles this far (in tiles, each way) around the map's spawn point (in a Warrens run, its
 *  start room or checkpoint: a tile each way, so nobody lands past a wall). */
const SPAWN_SPREAD = 3;
const RUN_SPREAD = 1;
/** Chat: up to 120 characters; a burst of 3, then one every 2 s. */
const SAY_MAX = 120;
const SAYS_PER_SECOND = 0.5;
const SAY_BURST = 3;
/** Lines kept for people arriving (in memory only, gone on restart). */
const RECENT = 20;
/** How long a notice is also shown to people arriving. */
const NOTICE_MS = 30 * 60_000;
/** System feed lines kept for people arriving (in memory only). */
const SYSTEM_RECENT = 10;
/** Messages from the Discord channel can be longer, up to this. */
const DISCORD_MAX = 200;
/** A party member who disconnects stays in it this long (a reload, a gate to another area). */
const PARTY_AWAY_MS = 60_000;
/** Party invites: one a second. */
const INVITE_GAP_MS = 1000;
/** A friend who disconnects is still shown online this long (a reload, a gate), and only one gone longer is announced
 *  as coming online. */
const FRIEND_AWAY_MS = 60_000;
/** Friend requests and actions: one a second. */
const FRIEND_GAP_MS = 1000;
/** While they're here, when members were last online is saved this often. */
const SEEN_EVERY_MS = 5 * 60_000;
/** The title shown for a friend without a character anymore. */
const TOWNFOLK: TitleData = { name: 'Townfolk', color: '#B794F6' };

/** A chat message tidied up: no control characters, single spaces, trimmed; null if empty or too long. */
function tidy(text: unknown, max = SAY_MAX): string | null {
  if (typeof text !== 'string') return null;
  const t = text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return t && [...t].length <= max ? t : null;
}

/** What makes two nicknames the same one (as web/nickname.ts: any case, the separators ignored). */
const fold = (nick: string) => nick.toLowerCase().replace(/[ _.-]/g, '');

export interface TownMap {
  size: [number, number]; // [cols, rows]
  spawn: [number, number]; // [col, row]
  blocked: number[][]; // [row][col], 1 = blocked
  /** Tiles nobody arrives on (the gates to other areas: stepping on one there would take you straight back). */
  avoid?: [number, number][];
  /** Its Lantern Posts (shared travel.ts): none, one, or the Palengke's four. */
  lanterns?: LanternPost[];
}

export interface TownProfile {
  nickname: string;
  title: TitleData;
  outfit: OutfitData;
  jailed?: boolean;
  /** Their class and worn weapon (web/adventure.ts), if any (its + for the aura), and level. */
  cls?: string | null;
  weapon?: string | null;
  weaponPlus?: number;
  level?: number;
  /** The pet they have out (stats.json pets.list key), if any. */
  pet?: string | null;
}

export interface TownOptions {
  /** The Arena's bets (Kowens): where stakes are held and paid; without it, matches have no bets. */
  arenaBets?: ArenaBets;
  /** The member behind an upgrade request, or null to refuse it. */
  authenticate: (req: IncomingMessage) => Promise<string | null>;
  /** Their nickname, title and look; null if they haven't made a character yet. */
  profile: (userId: string) => TownProfile | null;
  map: TownMap;
  /** Other rooms by name (e.g. 'hood'), each with its map (asked for again on each arrival, so it can grow). */
  rooms?: Record<string, () => TownMap>;
  /** Rooms with mobs (the Slums: web/town-mobs.ts), run here so everyone there sees the same ones. */
  mobs?: Record<string, MobRoom>;
  /** Quests (web/adventure.ts questKillFor): a kill that counts toward a member's (theirs, or their party's nearby), saved;
   *  their active quests if anything moved. Without it (the dev town) the page's pretend store is told the kill
   *  (`quest-kill`) and counts it itself. */
  quests?: {
    kill?(userId: string, kill: { kind: string; mini: boolean }): { active: QuestProgress[] } | null;
    /** They walked into a room: a chain that starts there (the Palengke's) started; their active quests, else null. */
    enter?(userId: string, room: string): { active: QuestProgress[] } | null;
    /** The quest items a kill of `kind` drops for them (CONTEXT.md Quest item): their own loot where it fell. */
    drops?(userId: string, kind: string): Item[];
    /** They rang a field boss's bell (the Great Scale's): their "ring the bell" step moved on; their active quests, else
     *  null. */
    bell?(userId: string, mob: string): { active: QuestProgress[] } | null;
  };
  /** Aling Conching's dishes (CONTEXT.md Dish; classes/palengke-leveling.json `dishes`): `buy` checks and spends its
   *  Kusing (null: done; else why not); the dishes on everyone kept through a restart (`load` at the start, `save` on
   *  every change). Without it no dish can be bought (the free ones still are served: Town.serveDish). */
  dishes?: {
    buy(userId: string, dish: string): string | null;
    load?(): Record<string, DishOn[]>;
    save?(all: Record<string, DishOn[]>): void;
  };
  /** Characters' levels (web/adventure.ts in the bot; in memory on the game's dev server, web/progress.ts either way):
   *  who someone is in a fight, and a kill's XP for them (saved; the level-ups it brought). Without it everyone fights as
   *  their class at Lv 1 and gains nothing. */
  progress?: {
    fighter(userId: string): Attacker;
    /** (`quests`: a level-up opened a quest that waited for it; their active quests then.) */
    kill(userId: string, mob: { level: number; xp: number }): LevelGain & { quests?: QuestProgress[] };
  };
  /** Members' combat bags and Kusing (web/adventure.ts in the bot; in memory on the game's dev server): loot picked up
   *  (false: no room), an HP or MP Potion of a kind used (what it heals; null: none), and what they hold now. Without it
   *  nothing drops. */
  items?: {
    take(userId: string, loot: LootContent): boolean;
    usePotion(userId: string, defId: string): { heals: 'hp' | 'mp'; amount: number } | null;
    state(userId: string): CombatItems;
    /** `count` of an item out of their combat bag to drop on the ground: the item, or why not (saved). Without it
     *  nothing can be dropped. */
    drop?(userId: string, uid: string, count: number): Item | string;
    /** A trade both have confirmed (web/trade.ts settleTrade): checked again and moved in one go, logged; or nothing,
     *  with why. Without it nobody can trade. */
    trade?(users: [string, string], offers: [HeldOffer, HeldOffer], names: [string, string]): { ok: true } | { ok: false; message: string };
    /** Timed items of a member's that ran out since they were last told (each named once; worn ones changed their look),
     *  taken out now (web/adventure.ts expiredFor). Without it nothing runs out. */
    expire?(userId: string): { name: string; worn: boolean }[];
  };
  /** Pets (web/adventure.ts petXpFor): Pet XP for the pet a member has out (saved): the pet now and the levels it went
   *  up, or null (none out, or maxed). A hit on a monster gives its level, at most once a stats.json pets.xp.throttleSeconds
   *  a member. Without it pets gain nothing. */
  pets?: { xp(userId: string, n: number): { pet: Item; ups: number } | null };
  /** Rolls drops (Math.random if left out; the game's dev server can make loot rich to try it). */
  lootRandom?: () => number;
  /** Rolls dropped gear's plus (lootRandom if left out). */
  lootPlusRandom?: () => number;
  /** Rolls loot rolls (Math.random if left out: never the dev server's rich loot random). */
  rollRandom?: () => number;
  /** The level a class's movement skill unlocks at (classes.json `mobility`), or null: not one of its moves. A move
   *  before its level, or not theirs, isn't passed on; without it every move goes. */
  moveLevel?: (cls: string | null | undefined, move: TownMove) => number | null;
  /** Whether a member may join a room; every room when left out. */
  mayEnter?: (room: string, userId: string) => Promise<boolean>;
  /** Leave upgrades to other paths alone (the game's dev server shares its HTTP server with Vite's own socket). */
  shared?: boolean;
  /** Someone said something in town (the Discord bridge passes it on). */
  onSay?: (userId: string, nickname: string, text: string, megaphone: boolean, gm?: boolean) => void;
  /** Whether a member is a Game Master (the chat's GM channel: `/gm`, gold, across everyone's screen, free). Without it
   *  nobody is. */
  gm?: (userId: string) => boolean;
  /** Maintenance mode (web/maintenance.ts, the CMS): while `on`, only members `allowed` (the CMS's users) may be in
   *  the town; the rest are closed with MAINTENANCE and the note as the reason. Without it, never. */
  maintenance?: { on(): boolean; allowed(userId: string): boolean; note(): string };
  /** Uses one of a member's megaphones (`/m` in the chat): how many are left, or null if they have none. Without it
   *  (the game's dev server) megaphones are free. */
  megaphone?: (userId: string) => number | null;
  /** What to start with after a restart, and where to keep it (web/town-memory.ts in the bot): the last chat lines and
   *  the system feed's. Without it they live in memory only. */
  memory?: { chat: TownChatLine[]; system: TownSystemLine[]; save(chat: TownChatLine[], system: TownSystemLine[]): void };
  /** The Scrap Warrens (web/town-warrens.ts): its data and map, what a run's mob room needs, the Warren Gate's tile in the
   *  Slums (opening is done there), the Warren Ticket (how many a member holds; using one: false if none; giving one
   *  back to the opener of a run that ended before any boss fell: false if their bag had no room), and `saved`: the
   *  open runs whenever they change (a restart refunds the openers' tickets of runs not yet spent). `dev`: open from
   *  anywhere. Without it, no Warrens. */
  warrens?: {
    data: WarrensData;
    map: WarrensMap;
    deps: RunDeps;
    gate: [number, number];
    tickets: { count(userId: string): number; use(userId: string): boolean; refund?(userId: string): boolean };
    /** Aling Nena's quest (entry.requiresQuest, warrens.practice): what a member may do (town-warrens.ts WarrensAccess),
     *  using a Practice Warren Ticket (and one back: a practice run that ended before a boss fell), and the quest item
     *  its last boss drops for them (null: none now). Without it,
     *  anyone may come in and there are no practice runs. */
    access?(userId: string): WarrensAccess;
    practice?: { use(userId: string): boolean; drop(userId: string): Item | null; refund?(userId: string): boolean };
    saved?(runs: { id: string; opener: string; cleared: boolean; spent: boolean; practice?: boolean }[]): void;
    dev?: boolean;
  };
  /** Ang Silong (web/town-silong.ts): its data and floors' maps, what a run's mob rooms need, the Silong Hatch's tile in
   *  the Palengke, the Susi ng Silong (count, use, give back to the opener of a run that ended before a mini boss fell)
   *  and the Practice Susi (the same), who may come in (`access`: "Now's the Time" done, Practice Susi held), and `saved`: the
   *  open runs whenever they change (a restart gives the keys of runs not yet spent back). `dev`: open from anywhere.
   *  Without it, no Silong. */
  silong?: {
    data: SilongData;
    maps: Record<SilongFloor, SilongMap>;
    deps: RunDeps;
    gate: [number, number];
    keys: { count(userId: string): number; use(userId: string): boolean; refund?(userId: string): boolean };
    practice?: { use(userId: string): boolean; refund?(userId: string): boolean };
    access?(userId: string): SilongAccess;
    /** Those inside as Ang Makinang Yelo fell: they've cleared Ang Silong (its Atchara refill after). */
    cleared?(members: string[]): void;
    /** Mang Ramon's box (his note) and Kuya Jun's thanks for it (null, given; else why not). */
    ramon?: { box(userId: string): 'given' | 'have' | 'done' | 'full'; give(userId: string): string | null };
    /** A Susi ng Silong from Aling Conching's menu (after the finale): null, bought; else why not. */
    buyKey?(userId: string): string | null;
    saved?(runs: { id: string; opener: string; spent: boolean; practice?: boolean }[]): void;
    dev?: boolean;
  };
  /** Return Lanterns (a teleport between Lantern Posts uses one): how many a member holds, and using one (false: none).
   *  Without it, no teleports. */
  lanterns?: { count(userId: string): number; use(userId: string): boolean };
  /** Friends (web/town-friends.ts): where they're kept (web/friends-db.ts in the bot; in memory on the game's dev
   *  server), and the member who goes by a nickname (any case), for a request by name. Without it, no friends. */
  friends?: { store: FriendStore; byName(name: string): string | null };
  /** Members' privacy settings (web/privacy.ts in the bot; in memory on the game's dev server): who may whisper them.
   *  Without it, everyone may whisper everyone. */
  privacy?: { get(userId: string): PrivacySettings; set(userId: string, change: Partial<PrivacySettings>): PrivacySettings };
  /** Game Masters' testing switches (web/testing.ts in the bot; in memory on the game's dev server): only `gm` members'
   *  are read or changed. Without it, no testing switches. */
  testing?: { get(userId: string): TestingSettings; set(userId: string, change: Partial<TestingSettings>): TestingSettings };
  /** The Halloween event (web/halloween.ts: its window, Mikko Kalabasa, Biikko Kalabasa, the Manananggal; its director
   *  runs on the Slums' mob room), and giving a find's or reunite's reward (Kowens, Kusing, Low Repair Kits by mail when
   *  the bag is full, a potion): whether the kits went by mail. Without it, no event. */
  halloween?: { event: Halloween; give(userId: string, reward: HalloweenReward, from: string): { kitsByMail: boolean } };
  /** The Great Scale (web/town-great-scale.ts: the director of `room`'s mob room, the Palengke's): its state for arrivals
   *  there, its bell. */
  greatScale?: { boss: GreatScale; room: string };
  /** The leaderboard's records (web/records.ts): a real run cleared (who was inside, how long it took) and the golem
   *  down (the damage each member did). Without it, nothing is kept. */
  records?: { clear(members: string[], ms: number, at: number): void; golem(dealt: Map<string, number>, at: number): void };
  /** Chat moderation (web/town-mod.ts in the bot; none in the game's dev server). */
  moderation?: {
    mutedUntil(userId: string): number | null;
    kickedUntil(userId: string): number | null;
    filter(text: string): string;
  };
}

/** How long a teleport's arrival may take (the page loading the other map) to still be shown as one. */
const TRIP_MS = 2 * 60_000;

/** Close code for a moderator's kick (the reason is when they may come back, in ms). */
export const KICKED = 4001;
/** Close code while maintenance is on (the reason is its note): the game shows it and doesn't come back on its own. */
export const MAINTENANCE = 4003;

/** What the rest of the bot can do with the town. */
export interface Town {
  /** A message from the town's Discord channel: to everyone in town, with a Discord mark. */
  fromDiscord(name: string, text: string): void;
  /** A line for the system feed (digs, bets): to everyone in town, and kept for people arriving. `userId` (a dig's
   *  digger) becomes their town player id on the live line, if they're here. */
  system(line: TownSystemLine, userId?: string): void;
  /** A banner for everyone in town; a notice is also shown to people arriving in the next 30 minutes. */
  announce(a: TownAnnouncement): void;
  /** Removes a member from the town now (they're kept out by moderation.kickedUntil). */
  kick(userId: string, until: number): boolean;
  /** Maintenance went on: everyone not allowed in is closed with MAINTENANCE (how many were). */
  closeForMaintenance(): number;
  /** The member behind a town player id, if they're here (ids are random per visit: Discord ids never reach the page). */
  memberOf(playerId: string): string | null;
  /** Tells a member, if they're in town, that someone gave them Kowens. */
  gifted(userId: string, from: string, amount: number): void;
  /** Tells a member, if they're in town, that the gifter gave them an item. */
  giftedItem(userId: string, from: string, item: { id: string; name: string; rarity: string }, quantity: number): void;
  /** Tells a member, if they're in town, that their Kowens changed (the HUD reloads them). */
  wallet(userId: string): void;
  /** The members in town right now. */
  here(): string[];
  /** Whether two members are friends (CONTEXT.md Friend; who can see a friends-only Balance or Status). */
  areFriends(a: string, b: string): boolean;
  /** Tells a member, if they're in town, where their stay reward is (a Kowen ready to claim). */
  stay(userId: string, stay: TownStayInfo): void;
  /** A member was jailed or released: everyone in town sees it under their name (them included). */
  setJailed(userId: string, on: boolean): void;
  /** A member has a new title: the reward pop-up, if they're in town. */
  newTitle(userId: string, id: string, title: TitleData): void;
  /** A dish served free (a quest's: Q1's Lugaw, a daily order's), on them now (their tray if they're here). */
  serveDish(userId: string, dish: string): void;
  /** A member changed their look or title at the Parlor: everyone in town sees it (them included). */
  restyle(userId: string, outfit: OutfitData, title: TitleData): void;
  /** A member changed their nickname (a Rename Card): everyone in town sees the new name (them included). */
  renamed(userId: string, nickname: string): void;
  /** A member chose a class or changed their weapon (or its +: the aura): everyone in town sees it (the resting weapon,
   *  the chat's badge). */
  kit(userId: string, cls: string | null, weapon: string | null, weaponPlus?: number): void;
  /** A member sent a pet out or called it back (null): everyone in town sees it follow them (or go). */
  pet(userId: string, pet: string | null): void;
  /** Whether a member is in a fight now (hit, hitting or missed within a few seconds on a battle map): pets can't be
   *  changed then. */
  inCombat(userId: string): boolean;
  /** Whether a member has a practice run open (Aling Nena won't hand over another ticket meanwhile). */
  inPracticeRun(userId: string): boolean;
  /** A member's worn items, combat bag or Kusing changed outside the town (the shop, dev's ?give=): theirs to them. */
  items(userId: string, got?: LootGot): void;
  /** A member got mail (`from`, `title`), or their mailbox changed elsewhere: how many aren't opened yet, to them. */
  mail(userId: string, unread: number, from?: string, title?: string): void;
  /** Dev and tests: `item` drops at a member's feet for them and their party in the room, as a kill's would (rolled for
   *  when it's rare and they're two or more). False: not in town. */
  rollLoot(userId: string, item: Item): boolean;
  /** A member's level, XP or points changed outside a fight (points refunded, dev's ?xp=): theirs to them, and with
   *  `ups` levels gained "Level up!" over them for their room. */
  progress(userId: string, progress: CharacterProgress, ups?: number, gained?: number): void;
  /** A house built, given a new look, or its Bakod up or down: everyone in the neighbourhood sees it at once (it rises,
   *  puffs into its new look, or its fence goes up or comes down). */
  /** The Mosang race (games/race.ts) changed: to everyone in town and the neighbourhood, and to arrivals while it's on. */
  race(state: TownRace | null): void;
  house(change: 'built' | 'look' | 'fence' | 'state', house: HoodHouse, at: { col: number; row: number; door: [number, number]; fence: HoodMap['fence'] }): void;
  /** A member (if in town) flexed an item from their bag: to everyone, them included (chat line + bubble). */
  flexed(userId: string, item: { id: string; name: string; rarity: string }): void;
  /** A member (if in town) says a diss, praise or judge line: to everyone, the speaker included. */
  verdict(userId: string, kind: 'roast' | 'praise', judged: boolean, text: string): void;
  /** Dev (?warrens=solo, ?warrensboss=<id>): a run for a member in town, free, at once; with `boss`, every area before
   *  that boss's cleared and them arriving at its arena. The run's id, or why not. */
  warrensDev(userId: string, boss?: string, hp?: number): { ok: true; run: string } | { ok: false; message: string };
  /** Dev (?silong=solo, ?silong=b3): an Ang Silong run for a member, free, at once; with `floor`, every mini boss above
   *  it down and the floors reached. The run's id and the floor to go to, or why not. */
  silongDev(userId: string, floor?: SilongFloor | 'plant', hp?: number): { ok: true; run: string; floor: SilongFloor } | { ok: false; message: string };
  /** Dev (?halloween=on): the Halloween event on now; `mikko`: Mikko hidden two tiles from the member; `biikko` / `round`:
   *  Biikko out and a Manananggal round started now; `wound`: Biikko down to that HP; `carry`: the dazed upper half theirs
   *  (a round started for it). What was done. */
  halloweenDev(userId: string, o: { mikko?: boolean; biikko?: boolean; wound?: number; round?: boolean; carry?: boolean }): string;
}

/** The game's map (packages/game/public/assets/maps/town.json), from the monorepo next to the bot. */
/** A map from the game's assets (maps/<name>.json: the town, the Slums, the Lumang Palengke), as far as the server needs
 *  it: a map with several Lantern Posts (`teleporters`) has their tiles blocked. (Raised ground isn't checked here, like
 *  fences: the game keeps to its ramps.) */
export function loadTownMap(name = 'town'): TownMap {
  const json = JSON.parse(readFileSync(new URL(`../../../game/public/assets/maps/${name}.json`, import.meta.url), 'utf8')) as TownMap & {
    gates?: Record<string, [number, number][]>;
    objects?: { id: string; col: number; row: number }[];
    arrive?: Record<string, [number, number]>;
    teleporters?: { id: string; name: string; tile: [number, number] }[];
  };
  const blocked = blockedWithPosts(json.blocked, json.teleporters);
  return { size: json.size, spawn: json.spawn, blocked, avoid: Object.values(json.gates ?? {}).flat(), lanterns: lanternPostsOf({ ...json, blocked }) };
}

/** Facing for one grid step (as the game's dirForStep: col runs screen right-down, row runs screen left-down). */
function dirForStep(dc: number, dr: number): TownDir {
  const table: Record<string, TownDir> = {
    '1,0': 'se', '0,1': 'sw', '1,1': 's', '-1,-1': 'n',
    '1,-1': 'e', '-1,1': 'w', '-1,0': 'nw', '0,-1': 'ne',
  };
  return table[`${dc},${dr}`] ?? 's';
}

interface Conn {
  ws: WebSocket;
  userId: string;
  /** 'town', or one of TownOptions.rooms. */
  room: string;
  player: TownPlayer;
  tokens: number;
  refilled: number;
  says: number;
  saidAt: number;
  emotes: number;
  emotedAt: number;
  /** The last mobility move shown (ms). */
  movedAt?: number;
  alive: boolean;
  /** Still at the spawn point, so 'here' is accepted (once). */
  fresh: boolean;
  /** Their DEF and level (what mobs' hits are rolled against), with their HP's most. */
  guard?: Target;
  /** This connection as the Arena sees it (made on first use). */
  seat?: ArenaSeat;
  /** The last party invite sent (ms). */
  invitedAt?: number;
  /** The last friend request or action (ms). */
  friendAt?: number;
  /** The last trade request sent (ms). */
  askedAt?: number;
  /** When they last dropped an item on the ground. */
  droppedAt?: number;
  /** When they last looked at someone's gear (the player menu's Info). */
  inspectAt?: number;
  /** When they last asked for someone's buffs (the player box). */
  buffsOfAt?: number;
  /** When they last opened a Warrens run (one a second). */
  warrensAt?: number;
  /** When they last opened a Silong run (one a second). */
  silongAt?: number;
  /** Their last step carried along an Ang Silong belt. */
  beltAt?: number;
  /** When they last asked to teleport (ms). */
  lanternAt?: number;
  /** Stunned until (ms): no steps (Wire Wolf's Live Floor). */
  stunnedUntil?: number;
  /** Held on the Great Scale's pan until (ms): no steps, attacks, moves or buffs. */
  heldUntil?: number;
  /** When they last rang the Great Scale's bell (ms). */
  bellAt?: number;
  /** Dodging every hit that lands before this (ms): a Step Back (stats.json skills.moveDodge). */
  dodgeUntil?: number;
}

export function attachTown(server: Server, opts: TownOptions): Town {
  const { map } = opts;
  const [cols, rows] = map.size;
  const conns = new Map<string, Conn>(); // by member
  const recent: TownChatLine[] = (opts.memory?.chat ?? []).slice(-RECENT);
  const systemLines: TownSystemLine[] = (opts.memory?.system ?? []).slice(-SYSTEM_RECENT);
  const keep = () => opts.memory?.save(recent, systemLines);
  const remember = (line: TownChatLine) => {
    recent.push(line);
    if (recent.length > RECENT) recent.shift();
    keep();
  };
  let notice: { a: TownAnnouncement; until: number } | null = null;
  let raceNow: TownRace | null = null;
  // (The desktop app sends its session token as a subprotocol, `mikazuki` and `mk-token.<token>`: the first is agreed to.)
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, handleProtocols: (protocols) => (protocols.has('mikazuki') ? 'mikazuki' : false) });
  const arena = new Arena(undefined, undefined, opts.arenaBets ?? null, (r) => postSystem({ kind: 'arena', text: arenaLine(r, Math.random()), tone: r.bot === 'loser' ? 'win' : 'lose' })); // mocking the loser (in the loss colour; beating the bot in the win colour)

  const send = (c: Conn, m: TownServerMessage) => c.ws.readyState === WebSocket.OPEN && c.ws.send(JSON.stringify(m));
  /** To everyone in `c`'s room but `c` (the message is turned into text once). */
  const others = (c: Conn, m: TownServerMessage) => {
    const text = JSON.stringify(m);
    for (const o of conns.values()) if (o !== c && o.room === c.room && o.ws.readyState === WebSocket.OPEN) o.ws.send(text);
  };
  /** To everyone, in every room. */
  const everyone = (m: TownServerMessage) => {
    const text = JSON.stringify(m);
    for (const o of conns.values()) if (o.ws.readyState === WebSocket.OPEN) o.ws.send(text);
  };
  // Parties (town-party.ts): kept by member; what the page sees is each member's party key, town id (while here) and
  // where they are. Last-known names and looks, so a member who stepped away still shows.
  const known = new Map<string, { nickname: string; outfit: OutfitData; cls?: string | null; level?: number }>();
  const parties = new Parties((u) => known.get(u)?.nickname ?? 'Someone');
  const away = new Map<string, NodeJS.Timeout>();
  const partyFor = (user: string): PartyState | null => {
    const party = parties.of(user);
    if (!party) return null;
    return {
      leader: parties.key(party.leader),
      you: parties.key(user),
      max: PARTY_MAX,
      members: party.members.map((m) => {
        const o = conns.get(m);
        const k = known.get(m);
        const v = vitals?.get(m);
        const level = o?.player.level ?? k?.level;
        return { key: parties.key(m), id: o?.player.id ?? null, nickname: k?.nickname ?? 'Someone', outfit: k!.outfit, cls: k?.cls ?? null, ...(level ? { level } : {}), area: o?.room ?? null, ...(v ? { hp: shown(v).hp, maxHp: v.max.hp } : {}) };
      }),
    };
  };
  /** Sends the party (and a note) to everyone in it. */
  const tellParty = (user: string, note?: string) => {
    for (const m of parties.of(user)?.members ?? []) {
      const o = conns.get(m);
      if (o) send(o, { t: 'party', party: partyFor(m), ...(note ? { note } : {}) });
    }
  };
  const partyChanged = (change: PartyChange | null) => {
    if (!change) return;
    for (const { user, note } of change.out) {
      const o = conns.get(user);
      if (o) send(o, { t: 'party', party: null, note });
    }
    if (change.party) tellParty(change.party.leader, change.note);
  };
  /** A member disconnected: still in their party for a minute (shown away), then out. */
  const stepAway = (user: string) => {
    friendLeft(user);
    if (!parties.of(user)) return;
    tellParty(user);
    clearTimeout(away.get(user));
    away.set(user, setTimeout(() => {
      away.delete(user);
      if (!conns.has(user)) partyChanged(parties.leave(user));
    }, PARTY_AWAY_MS));
  };
  // Friends (town-friends.ts, kept by opts.friends.store): by member; the page sees each friend's friend key, town id
  // (while here), where they are, level, class and look, and while they're away when they were last online. Someone who
  // drops is still online for FRIEND_AWAY_MS (a reload, a gate to another area); only one gone longer is announced.
  const F = opts.friends ? new Friends(opts.friends.store.load(), opts.friends.store) : null;
  /** The Halloween event, if there is one (web/halloween.ts). */
  const H = opts.halloween?.event ?? null;
  // (Its mobs live in Biikko's map's mob room, made with its director: the director's hands are that room.)
  const hwRoom = H && opts.mobs?.[H.data.biikko.map];
  if (hwRoom) H.attach(hwRoom);
  /** Since when the member carrying the dazed upper half has been gone (none: here). */
  let carrierAwaySince: number | null = null;
  /** Timed items of a member's that ran out (CONTEXT.md Timed cosmetic): a line each in their feed, their items again,
   *  and their look if one was worn. */
  const expireFor = (c: Conn) => {
    const gone = opts.items?.expire?.(c.userId) ?? [];
    if (!gone.length || conns.get(c.userId) !== c) return;
    send(c, { t: 'expired', items: gone });
    tellItems(c);
    if (gone.some((g) => g.worn)) {
      const prof = opts.profile(c.userId);
      if (prof) town.restyle(c.userId, prof.outfit, prof.title);
    }
  };
  const leaving = new Map<string, NodeJS.Timeout>();
  /** Where each member last was (shown while they're online but between rooms). */
  const lastRoom = new Map<string, string>();
  const friendName = (user: string) => conns.get(user)?.player.nickname ?? opts.profile(user)?.nickname ?? known.get(user)?.nickname ?? 'Someone';
  const friendView = (user: string): FriendView => {
    const c = conns.get(user);
    const p = c?.player ?? opts.profile(user);
    const online = !!c || leaving.has(user);
    const seen = F!.seenAt(user);
    return {
      key: F!.key(user),
      name: p?.nickname ?? known.get(user)?.nickname ?? 'Someone',
      title: p?.title ?? TOWNFOLK,
      outfit: p?.outfit ?? null,
      online,
      ...(c ? { id: c.player.id } : {}),
      ...(online ? { area: c?.room ?? lastRoom.get(user) ?? 'town' } : seen !== undefined ? { lastSeen: seen } : {}),
      cls: p?.cls ?? null,
      ...(p?.level ? { level: p.level } : {}),
    };
  };
  const friendsState = (user: string, now = Date.now()): FriendsState => ({
    friends: F!.friendsOf(user).map(friendView).sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)),
    incoming: F!.incoming(user, now).map((r): FriendAsk => ({ key: F!.key(r.from), name: friendName(r.from), at: r.at })),
    outgoing: F!.outgoing(user, now).map((r): FriendAsk => ({ key: F!.key(r.to), name: friendName(r.to), at: r.at })),
    blocked: F!.blockedBy(user).map((b): FriendAsk => ({ key: F!.key(b.who), name: friendName(b.who), at: b.at })),
  });
  /** Whether `who` is blocked by `by` (CONTEXT.md Block: no whispers, friend requests, party invites or trade requests
   *  from them; they're told as if they'd simply been turned away). */
  const blockedBy = (by: string, who: string) => !!F?.hasBlocked(by, who);
  /** A member's friends and requests, to them if they're here (with what happened). */
  const tellFriendList = (user: string, extra: { note?: string; online?: string; asked?: FriendAsk } = {}) => {
    const c = conns.get(user);
    if (c && F) send(c, { t: 'friends', friends: friendsState(user), ...extra });
  };
  /** What a member's friends see of them changed (here or not, where, level, look, name): their lists again
   *  (`online`: they just came online). */
  const tellFriends = (user: string, online?: string) => {
    if (F) for (const f of F.friendsOf(user)) tellFriendList(f, online ? { online } : {});
  };
  const befriended = (a: string, b: string) => {
    tellFriendList(a, { note: `You and ${friendName(b)} are friends now.` });
    tellFriendList(b, { note: `You and ${friendName(a)} are friends now.` });
  };
  /** A member arrived (a new tab, a reload or a gate: `back`, not announced). */
  const friendArrived = (user: string, room: string, back: boolean) => {
    if (!F) return;
    back ||= leaving.has(user);
    clearTimeout(leaving.get(user));
    leaving.delete(user);
    lastRoom.set(user, room);
    F.seen(user, Date.now());
    tellFriendList(user);
    tellFriends(user, back ? undefined : friendName(user));
  };
  /** A member's last connection closed: online a moment longer, then offline (when, saved). */
  const friendLeft = (user: string) => {
    if (!F || conns.has(user)) return;
    clearTimeout(leaving.get(user));
    leaving.set(user, setTimeout(() => {
      leaving.delete(user);
      if (conns.has(user)) return;
      F.seen(user, Date.now());
      tellFriends(user);
    }, FRIEND_AWAY_MS).unref());
    tellFriends(user); // (no town id now: no invite or player menu from the list)
  };
  // The Scrap Warrens: runs as rooms of their own (a run's party is the Parties' own object for it).
  const W = opts.warrens ? new Warrens(opts.warrens.data, opts.warrens.map, opts.warrens.deps, (u) => parties.of(u)) : null;
  const runOf = (room: string): Run | undefined => (W && room.startsWith('warrens:') ? W.get(room) : undefined);
  const SL = opts.silong ? new Silong(opts.silong.data, opts.silong.maps, opts.silong.deps, (u) => parties.of(u)) : null;
  /** The Silong run a floor's room (`silong:<id>:<floor>`) belongs to, and that floor. */
  const silongOf = (room: string): SilongRun | undefined => (SL && room.startsWith('silong:') ? SL.get(room) : undefined);
  const silongFloor = (room: string) => silongOf(room)?.floorOf(room) ?? null;
  /** A room's mobs: the Slums', or a run's. */
  const mobsOf = (room: string): MobRoom | undefined => opts.mobs?.[room] ?? runOf(room)?.mobs ?? silongFloor(room)?.mobs;
  /** Every room with mobs now. */
  const battleRooms = (): [string, MobRoom][] => [
    ...Object.entries(opts.mobs ?? {}),
    ...(W?.all().map((r): [string, MobRoom] => [r.room, r.mobs]) ?? []),
    ...(SL?.all().flatMap((r) => SILONG_FLOORS.map((f): [string, MobRoom] => [r.floors[f].room, r.floors[f].mobs])) ?? []),
  ];
  const mapOf = (room: string): TownMap => (room === 'town' ? map : (runOf(room)?.map ?? silongFloor(room)?.map ?? opts.rooms?.[room]?.() ?? map));

  // HP and MP: only where there are mobs (their rules come from a mob room: class, level, points, worn gear).
  const rules = Object.values(opts.mobs ?? {})[0];
  const STATS = loadStats();
  const vitals = rules ? new Vitals(STATS.regen) : null;
  const battle = (room: string) => !!mobsOf(room);
  // Buffs (town-buffs.ts): cast on battle maps, kept by member in memory, put on in every fight and in their most HP.
  const buffs = vitals ? new Buffs(STATS) : null;
  // Dishes (Aling Conching's, in the Lumang Palengke): on everyone as buffs, kept through restarts.
  const DISHES = loadPalengkeLeveling() as unknown as Pick<PalengkeData, 'dishes'>;
  buffs?.restoreDishes(opts.dishes?.load?.() ?? {}, Date.now());
  const saveDishes = () => {
    if (buffs) opts.dishes?.save?.(buffs.dishes());
  };
  /** A dish on them for its minutes (the one in its slot replaced), their tray and stats told. */
  const serve = (userId: string, id: string): boolean => {
    const d = dishOf(DISHES, id);
    if (!buffs || !d) return false;
    buffs.giveDish(userId, { name: id, slot: d.slot, stats: d.stats }, dishMs(d), Date.now());
    saveDishes();
    const c = conns.get(userId);
    if (c) buffsChanged(c);
    return true;
  };
  /** Who they are in a fight: class, level, points, everything worn, skill levels (the class and weapon alone without
   *  saved levels), and the buffs on them. */
  const fighterOf = (c: Conn): Attacker => ({ ...(opts.progress?.fighter(c.userId) ?? { cls: c.player.cls, gear: [c.player.weapon] }), ...(buffs ? { buffs: buffs.effective(c.userId) } : {}) });
  /** Pet XP (shared pets.ts): a swing that landed on a monster (not a miss) gives the pet out the level of the highest
   *  monster it hit, at most once a throttle per member. A level-up: the sparkle for everyone, the toast for them. */
  const petClock = new PetXpClock((petRules(STATS)?.xp.throttleSeconds ?? 1) * 1000);
  const petXp = (c: Conn, mobs: MobRoom, hits: MobHit[], now: number) => {
    if (!opts.pets || !c.player.pet) return;
    const n = petXpForHit(hits.flatMap((h) => (h.miss ? [] : [mobs.levelOf(h.id) ?? 0])));
    if (n <= 0 || !petClock.take(c.userId, now)) return;
    const g = opts.pets.xp(c.userId, n);
    if (!g) return;
    send(c, { t: 'pet-xp', pet: g.pet, gained: n, ups: g.ups });
    if (g.ups) everyone({ t: 'pet', id: c.player.id, pet: c.player.pet, up: g.pet.level });
  };
  /** Their most HP and MP, a regen buff's share (and their DEF, DEF rate and level, for mobs' hits). */
  const maxOf = (c: Conn): VitalMax => {
    const d = rules!.fighter(fighterOf(c));
    c.guard = { def: d.def, level: d.level, defRate: d.defRate, priority: targetPriority(STATS, c.player.cls), ...(d.evasion ? { evasion: d.evasion } : {}) };
    return { hp: d.hp, mp: d.mp, mpRegen: d.mpRegen, hpRegenPct: d.hpRegenPct ?? 0, ...(d.hpDrainPct ? { hpDrainPct: d.hpDrainPct } : {}) };
  };
  /** A skill's heal (heal:F, Herbal Storm): the caster and their party members in the room within the buffs' party
   *  range, `share` × the caster's Power each, green numbers for the room (as Soothing Touch's). */
  const healParty = (c: Conn, share: number) => {
    if (!vitals || !rules) return;
    const range = Number(STATS.skills.buffs?.rules.partyRangeTiles ?? 6);
    const power = rules.fighter(fighterOf(c)).power;
    const near = [c.userId, ...(parties.of(c.userId)?.members ?? []).filter((u) => u !== c.userId)].flatMap((u) => {
      const o = conns.get(u);
      return o && o.room === c.room && !o.player.out && Math.max(Math.abs(o.player.col - c.player.col), Math.abs(o.player.row - c.player.row)) <= range ? [o] : [];
    });
    const heals = near.map((o) => {
      const amount = vitals.heal(o.userId, 'hp', power * share);
      tellVitals(o);
      return { id: o.player.id, amount };
    });
    const healed: TownServerMessage = { t: 'buff-heal', by: c.player.id, heals, skill: true };
    others(c, healed);
    send(c, healed);
  };
  /** Their HP (and to them, MP) to them, their room and their party (wherever they are). */
  const tellVitals = (c: Conn) => {
    const v = vitals?.get(c.userId);
    if (!v) return;
    const { hp, maxHp, mp, maxMp } = shown(v);
    Object.assign(c.player, { hp, maxHp });
    send(c, { t: 'vitals', id: c.player.id, hp, maxHp, mp, maxMp });
    const seen: TownServerMessage = { t: 'vitals', id: c.player.id, hp, maxHp };
    others(c, seen);
    for (const m of parties.of(c.userId)?.members ?? []) {
      const o = conns.get(m);
      if (o && o !== c && o.room !== c.room) send(o, seen);
    }
  };
  /** Their most changed (points, gear, a level: `full` fills them up; buffs: `lift` raises their HP with the most). */
  const refreshVitals = (c: Conn, full = false, lift = false) => {
    if (!vitals?.get(c.userId)) return;
    const max = maxOf(c);
    if (full) vitals.fill(c.userId, max, Date.now());
    else vitals.setMax(c.userId, max, lift);
    tellVitals(c);
  };
  /** Their buffs changed: the tray, and their most HP and DEF (a max HP buff lifts their HP; ending, HP over it drops). */
  const buffsChanged = (c: Conn) => {
    if (!buffs) return;
    send(c, { t: 'buffs', buffs: buffs.view(c.userId, Date.now()) });
    refreshVitals(c, false, true);
  };
  /** Held on the Great Scale's pan now. */
  const held = (c: Conn) => (c.heldUntil ?? 0) > Date.now();
  /** 0 HP: faded out for everyone there, no mob after them, nothing more lands on them. */
  const knockOut = (c: Conn) => {
    c.player.out = true;
    c.player.sit = false;
    c.heldUntil = 0; // (the pan lets them go: town-great-scale.ts sees them gone)
    const dishes = !!buffs?.endDishes(c.userId); // (a knock-out ends them)
    if (dishes) saveDishes();
    if (buffs?.endTimed(c.userId) || dishes) buffsChanged(c); // (a stance stays)
    mobsOf(c.room)?.forget(c.player.id, true);
    endTrade(c.userId, 'out', { name: c.player.nickname }); // no trading while knocked out
    const m: TownServerMessage = { t: 'knocked-out', id: c.player.id };
    send(c, { ...m, reviveIn: vitals?.outFor(c.userId, Date.now()) ?? 0 });
    others(c, m);
  };
  /** Back after being knocked out: at the room's way in (where arrivals land), full, seen by everyone there. */
  const respawn = (c: Conn) => {
    // (Ang Silong: back at the arrival elevator of the deepest floor the run has reached.)
    const srun = silongOf(c.room);
    if (srun && srun.floorOf(c.room)?.floor !== srun.deepest()) send(c, { t: 'silong-go', run: srun.id, floor: srun.deepest() });
    const [col, row] = arrival(c.room, c.userId);
    Object.assign(c.player, { col, row, sit: false, out: undefined });
    const m: TownServerMessage = { t: 'respawn', id: c.player.id, col, row };
    send(c, m);
    others(c, m);
    tellVitals(c);
  };
  const inside = (m: TownMap, col: unknown, row: unknown): col is number =>
    Number.isInteger(col) && Number.isInteger(row) && (col as number) >= 0 && (row as number) >= 0 && (col as number) < m.size[0] && (row as number) < m.size[1];
  const walkable = (m: TownMap, col: number, row: number) => !m.blocked[row]?.[col];

  /** A system feed line: to everyone in town, and kept for people arriving (`userId`: tagged with their town id). */
  const postSystem = (line: TownSystemLine, userId?: string) => {
    systemLines.push(line);
    if (systemLines.length > SYSTEM_RECENT) systemLines.shift();
    keep();
    const playerId = userId ? conns.get(userId)?.player.id : undefined;
    everyone({ t: 'system', line: playerId ? { ...line, playerId } : line });
  };

  /** A member's level, XP and points to them; each level-up "Level up!" over them for their room (them included). */
  const progressed = (c: Conn, g: Pick<LevelGain, 'progress' | 'ups' | 'gained'> & { quests?: QuestProgress[] }) => {
    c.player.level = g.progress.level;
    refreshVitals(c, g.ups > 0); // a level up fills HP and MP; points change the most
    send(c, { t: 'progress', progress: g.progress, ...(g.gained ? { gained: g.gained } : {}) });
    if (g.quests) send(c, { t: 'quests', active: g.quests }); // (a quest that waited for this level)
    if (g.ups > 0) {
      const up: TownServerMessage = { t: 'level-up', id: c.player.id, level: g.progress.level };
      others(c, up);
      send(c, up);
      const k = known.get(c.userId);
      if (k) k.level = g.progress.level;
      tellParty(c.userId); // (the party panel shows levels)
      tellFriends(c.userId);
    }
  };

  // Loot on the ground, by battle room (only with somewhere to keep what's picked up).
  const items = loadItemData();
  // A member's Drop rate (the stat; CONTEXT.md): the loot cascades' boost (town-loot.ts, loot.ts dropBoost).
  const dropRateOf = (userId: string) => (rules && opts.progress ? rules.dropRate(opts.progress.fighter(userId)) : 0);
  // (Each room's own mini boss rules and drops: the Palengke's from its leveling data and stats.json drops.palengke.)
  const lootRoom = (room: string) => new LootRoom(items, opts.lootRandom, undefined, opts.lootPlusRandom, levelingFor(room), dropRateOf, room);
  const loots = new Map<string, LootRoom>(opts.items ? Object.keys(opts.mobs ?? {}).map((room) => [room, lootRoom(room)]) : []);
  /** A room's loot, made when something is first dropped there (a player's item off a map without mobs). */
  const lootIn = (room: string): LootRoom => {
    let L = loots.get(room);
    if (!L) loots.set(room, (L = lootRoom(room)));
    return L;
  };
  /** Where a dropped item lands on a map without mobs: `at`, else the nearest open tile within 2 with no loot on it. */
  const groundSpot = (m: TownMap, at: [number, number], taken: ReadonlySet<string>): [number, number] => {
    const [cols, rows] = m.size;
    for (let ring = 0; ring <= 2; ring++)
      for (let dr = -ring; dr <= ring; dr++)
        for (let dc = -ring; dc <= ring; dc++) {
          const [c, r] = [at[0] + dc, at[1] + dr];
          if (Math.max(Math.abs(dc), Math.abs(dr)) === ring && c >= 0 && r >= 0 && c < cols && r < rows && !m.blocked[r]?.[c] && !taken.has(`${c},${r}`)) return [c, r];
        }
    return at;
  };
  // Dropped items lying too long on maps without mobs go too (the mobs' clock does theirs).
  if (opts.items?.drop) {
    setInterval(() => {
      for (const [room, L] of loots) if (!mobsOf(room)) lootGone(room, L.tick(Date.now()));
    }, 1000).unref?.();
  }
  /** HP and MP Potions' cooldown (ms), and when each member's is over (by member and kind, or 'all' when shared). */
  const POTION_MS = itemStats(items.stats).potions.sharedCooldownSec * 1000;
  const potionReady = new Map<string, number>();
  /** Their worn items, combat bag and Kusing to them (`got`: what they just picked up). */
  const tellItems = (c: Conn, got?: LootGot) => {
    if (opts.items) send(c, { t: 'items', items: opts.items.state(c.userId) as TownItems, ...(got ? { got } : {}) });
  };
  /** New loot to everyone in the room who can see it (each their own view of it), bouncing out of `from`. */
  const showLoot = (room: string, fresh: Loot[], from?: [number, number]) => {
    const L = loots.get(room);
    if (!L || !fresh.length) return;
    const now = Date.now();
    for (const o of conns.values()) {
      if (o.room !== room) continue;
      const seen = fresh.flatMap((l) => L.view(l, o.userId, now) ?? []);
      if (seen.length) send(o, { t: 'loot-drop', loot: seen, ...(from ? { from } : {}) });
    }
  };
  /** Loot gone (taken or lain too long): off everyone's screen in the room. */
  const lootGone = (room: string, ids: string[]) => {
    if (!ids.length) return;
    const m: TownServerMessage = { t: 'loot-gone', ids };
    for (const o of conns.values()) if (o.room === room) send(o, m);
  };
  // ── Rolls for rare loot (shared loot-roll.ts says which; web/town-roll.ts) ──
  const rollRules = lootRollRules(STATS);
  const rolls = new LootRolls(rollRules.max);
  /** New loot several may take (a party's kill, a run's) that's worth a roll: taken off the ground and rolled for by
   *  whoever it dropped for who's in the room (fewer than two: it just lies there). Returns the loot that stays. */
  const startRolls = (room: string, L: LootRoom, fresh: Loot[], candidatesOf: (l: Loot) => string[]): Loot[] => {
    const rest: Loot[] = [];
    for (const l of fresh) {
      const item = 'item' in l.content ? l.content.item : null;
      const who = item && !l.personal && rollWorthy(items, item) ? [...new Set(candidatesOf(l))].filter((u) => conns.get(u)?.room === room) : [];
      if (!item || who.length < 2) {
        rest.push(l);
        continue;
      }
      L.remove(l.id);
      const ms = rollRules.seconds * 1000;
      const r = rolls.start(room, item, [l.col, l.row], who.map((u) => ({ member: u, name: conns.get(u)!.player.nickname })), Date.now(), ms);
      for (const u of who) send(conns.get(u)!, { t: 'loot-roll', id: r.id, item: r.item, ms, players: r.members.map((m) => m.name) });
    }
    return rest;
  };
  /** A roll over: the winner gets the item in their bag (on the ground for them alone if it's full); everyone passed: on
   *  the ground for them all, as a kill's loot. Everyone asked hears how it ended. */
  const endRoll = (r: LootRoll) => {
    const L = lootIn(r.room);
    const now = Date.now();
    const win = rolls.winner(r);
    const spot = () => mobsOf(r.room)?.lootSpots(r.at, 1, L.taken())[0] ?? r.at;
    let full = false;
    if (win && opts.items) {
      const o = conns.get(win.member);
      if (opts.items.take(win.member, { item: r.item })) {
        if (o) tellItems(o, { item: r.item });
      } else {
        full = true;
        showLoot(r.room, [L.place({ item: r.item }, spot(), [win.member], now)], r.at);
      }
      console.log(`[loot] ${win.member} won ${itemName(items, r.item)} with a roll of ${win.value} (${r.members.length} asked)`);
    } else {
      showLoot(r.room, [L.add({ item: r.item }, spot(), r.members.map((m) => m.member), now)], r.at);
    }
    for (const { member } of r.members) {
      const o = conns.get(member);
      if (o) send(o, { t: 'loot-roll-end', id: r.id, item: r.item, ...(win ? { winner: win.name, roll: win.value } : {}), ...(win?.member === member ? { yours: true, ...(full ? { full: true } : {}) } : {}) });
    }
  };

  /** What a hit (or a burn's tick) killed: its XP for whoever earns it (the killer; the golem's for every member who did
   *  enough, even after a reload mid-fight; a mini boss: everyone who did their share and their party nearby), if still
   *  here, its loot, and quest credit for them and their party nearby. */
  const killed = (room: string, kills: MobKill[]) => {
    const run = runOf(room);
    for (const k of kills) {
      // (The Halloween event mobs: no XP or quest credit; Biikko's own set, the upper half dazed behind its killer.)
      if (H && (k.kind === BIIKKO_KIND || k.kind === UPPER_KIND)) {
        eventKill(room, k);
        continue;
      }
      // (The Great Scale's pan: nothing; its director lets the held player go.)
      if (k.kind === PAN_KIND) continue;
      // (A run's mobs give nothing until a boss has fallen there: its ticket comes back until then. Ang Silong's: its key.)
      if (run && !k.warrens && !run.ticketSpent) continue;
      const srun = silongOf(room);
      if (srun && !k.warrens && !srun.keySpent) continue;
      const credited = k.mini || k.warrens ? withParty(k.to, room) : k.to;
      // The Great Scale down: its line naming everyone who hit it, to its room only.
      const scale = k.boss && opts.greatScale?.boss.id === k.kind;
      if (scale && k.dealt) {
        const line: TownServerMessage = { t: 'system', line: { kind: 'golem', text: scaleDownLine([...k.dealt.keys()].map(nameOf), opts.greatScale!.boss.boss.name), tone: 'down' } };
        for (const o of conns.values()) if (o.room === room) send(o, line);
      }
      if (k.boss || k.mini || k.warrens) {
        for (const user of credited) {
          const o = conns.get(user);
          if (o && opts.progress) progressed(o, opts.progress.kill(o.userId, k));
        }
      } else shareXp(room, k);
      // The golem down: each member's damage this fight, for the leaderboard (its Golem board: the golem only).
      if (k.boss && k.dealt && !scale) opts.records?.golem(k.dealt, Date.now());
      if (run) runDrop(run, k);
      else if (srun) silongDrop(srun, room, k);
      else dropFor(room, { ...k, to: credited });
      // (A Warrens boss counts for no quest: the Tanod's mini bosses are the Slums' own.)
      // (The Great Scale counts for those who earned it, not their party: CONTEXT.md Great Scale.)
      if (!k.warrens) {
        questKill(scale ? credited : withParty(credited, room), { kind: k.kind, mini: !!k.mini, level: k.level });
        questDrops(room, scale ? credited : withParty(credited, room), k);
      }
      if (srun && k.warrens) {
        const was = srun.phase;
        silongNews(srun, srun.onKill(srun.floorOf(room)!.floor, k, Date.now()));
        // Cleared just now: everyone inside has cleared Ang Silong (Aling Conching's Atchara refill at half price).
        if (was !== 'cleared' && srun.phase === 'cleared') {
          const team = silongInside(srun).map((x) => x.member);
          opts.silong?.cleared?.(team);
          for (const member of team) {
            const o = conns.get(member);
            if (o) send(o, { t: 'silong-cleared' });
          }
        }
      }
      if (run && k.warrens) {
        const before = run.phase;
        runNews(run, run.onKill(k, Date.now()));
        // A real run cleared just now: its clear time goes on the leaderboard.
        const c = before !== 'cleared' && run.cleared;
        if (c) opts.records?.clear(c.team, c.ms, Date.now());
        tellRun(run, Date.now());
        saveRuns();
      }
    }
  };
  /** An event mob's kill (Halloween): Biikko's set, one roll, each piece its own loot round where it fell, held
   *  openAfterSeconds for its last hitter and their party here (then anyone's), and its line; the upper half dazed
   *  behind whoever landed the last hit. */
  const eventKill = (room: string, k: MobKill) => {
    const killer = k.to[0];
    if (!H || !killer) return;
    const now = Date.now();
    if (k.kind === UPPER_KIND) {
      H.upperKilled(killer);
      return tellHalloween();
    }
    H.biikkoKilled(now);
    const L = lootIn(room);
    const mobs = mobsOf(room);
    const contents = H.biikkoLoot(items, () => randomBytes(8).toString('hex'));
    const spots = mobs?.lootSpots(k.at, contents.length, L.taken()) ?? [];
    const owners = withParty([killer], room);
    const fresh = contents.map((content, i) => L.add(content, spots[i] ?? k.at, owners, now, H.data.biikko.loot.openAfterSeconds * 1000));
    showLoot(room, fresh, k.at);
    eventLine(H.data.biikko.announceKill.replace('{name}', nameOf(killer)));
  };
  /** An event line in everyone's chat, every area (CONTEXT.md Event line): never Discord, never kept. */
  const eventLine = (text: string, icon?: 'mikko') => everyone({ t: 'event-line', text, ...(icon ? { icon } : {}) });
  /** Everyone's view of the Halloween event, each as their room has it. */
  const tellHalloween = () => {
    if (!H) return;
    const now = Date.now();
    const decorations = H.decorations(now);
    for (const o of conns.values()) send(o, { t: 'halloween', view: H.view(o.room, now, (u) => conns.get(u)?.player.id), decorations });
  };
  /** A Halloween reward to a member here: given (the bot's give), its pop-up. */
  const rewardHalloween = (c: Conn, kind: 'mikko' | 'reunite', reward: HalloweenReward) => {
    const from = kind === 'mikko' ? H!.data.mikko.name : H!.data.manananggal.name;
    const r = opts.halloween!.give(c.userId, reward, from);
    send(c, { t: 'halloween-reward', kind, reward: { ...reward, ...(r.kitsByMail ? { kitsByMail: true } : {}) } });
    tellItems(c);
  };
  /** A kill's XP shared between the killer's party members in the room within reach (the knocked out too): the total
   *  raised per extra member, split equally (each share then their own level's low-mob rule). Alone: all theirs. */
  const shareXp = (room: string, k: MobKill) => {
    const killer = conns.get(k.to[0]);
    if (!killer || !opts.progress) return;
    const reach = partyXpRange(STATS);
    const near = (parties.of(killer.userId)?.members ?? [killer.userId]).flatMap((u) => {
      const o = conns.get(u);
      return o && o.room === room && Math.max(Math.abs(o.player.col - killer.player.col), Math.abs(o.player.row - killer.player.row)) <= reach ? [o] : [];
    });
    const sharers = near.length ? near : [killer];
    const xp = sharers.length > 1 ? Math.round((k.xp * partyXpMult(STATS, sharers.length)) / sharers.length) : k.xp;
    for (const o of sharers) progressed(o, opts.progress.kill(o.userId, { level: k.level, xp }));
  };
  /** Members and their party members nearby (in the same room), once each. */
  const withParty = (members: string[], room: string): string[] =>
    [...new Set(members.flatMap((u) => [u, ...(parties.of(u)?.members ?? []).filter((m) => conns.get(m)?.room === room)]))];
  /** A kill counted toward each member's quests (saved by the bot; told to them). (A mini boss quest's +5 piece comes
   *  with its report, into the bag: web/adventure.ts.) */
  const questKill = (members: string[], kill: { kind: string; mini: boolean; level: number }) => {
    for (const user of members) {
      const o = conns.get(user);
      if (!o) continue;
      if (!opts.quests?.kill) {
        send(o, { t: 'quest-kill', kind: kill.kind, mini: kill.mini, level: kill.level });
        continue;
      }
      const r = opts.quests.kill(user, { kind: kill.kind, mini: kill.mini });
      if (!r) continue;
      send(o, { t: 'quests', active: r.active });
    }
  };
  /** A kill's quest items (CONTEXT.md Quest item): each member's own, only while a quest of theirs asks for them, at
   *  their feet's side of the kill for them alone. */
  const questDrops = (room: string, members: string[], kill: { kind: string; at: [number, number] }) => {
    if (!opts.quests?.drops) return;
    const L = lootIn(room);
    const mobs = mobsOf(room);
    const now = Date.now();
    for (const user of members) {
      if (!conns.get(user)) continue;
      const fresh = opts.quests.drops(user, kill.kind).map((item) => L.place({ item }, mobs?.lootSpots(kill.at, 1, L.taken())[0] ?? kill.at, [user], now));
      showLoot(room, fresh, kill.at);
    }
  };
  /** A kill's drops, round where it died: the killer's (and their party's, those in the room), or the golem's or a mini
   *  boss's for each player who earned it (their own). */
  const dropFor = (room: string, kill: { kind: string; level: number; at: [number, number]; to: string[]; boss?: boolean; mini?: string }) => {
    const L = loots.get(room);
    const mobs = mobsOf(room);
    if (!L || !mobs || !kill.to.length) return;
    const party = kill.boss || kill.mini ? [] : (parties.of(kill.to[0])?.members ?? []).filter((m) => conns.get(m)?.room === room);
    const fresh = L.drop(kill, party, (at, n) => mobs.lootSpots(at, n, L.taken()), Date.now()); // (beside loot already there, not on it)
    showLoot(room, startRolls(room, L, fresh, (l) => l.owners), kill.at);
  };
  /** A kill's drops in a Warrens run: everything on the floor for anyone in it, first come (a mini boss's pile and a roll
   *  per player inside, Barong-Barong's heap for each, a mob's own). Gear for the classes of those inside. */
  const runDrop = (run: Run, kill: MobKill) => {
    if (!opts.items) return;
    const L = lootIn(run.room);
    const classes = [...conns.values()].filter((o) => o.room === run.room).map((o) => o.player.cls ?? null);
    const random = opts.lootRandom ?? Math.random;
    const { contents, at } = run.lootFor(kill, classes, () => randomBytes(8).toString('hex'), random, opts.lootPlusRandom ?? random);
    const fresh = L.scatter(contents, at, (a, n) => run.mobs.lootSpots(a, n, L.taken()), Date.now());
    const inside = [...conns.values()].filter((o) => o.room === run.room).map((o) => o.userId);
    showLoot(run.room, startRolls(run.room, L, fresh, () => inside), kill.at);
    // A practice run's last boss: the quest's item for its opener (it's solo), straight into their bag with the item
    // toast, even if their link is down just then; a full bag, at its feet for them alone.
    if (run.practice && run.isLastBoss(kill.id) && opts.warrens?.practice) {
      const member = run.opener.member;
      const item = opts.warrens.practice.drop(member);
      if (item) {
        const o = conns.get(member);
        const took = opts.items.take(member, { item });
        if (took) {
          if (o) tellItems(o, { item });
        } else showLoot(run.room, [L.place({ item }, at, [member], Date.now())], kill.at);
        console.log(`[warrens] ${member} ${took ? 'got' : 'had no room for'} ${item.defId} from practice run ${run.id}`);
      } else console.log(`[warrens] practice run ${run.id} cleared: ${member}'s quest needs no item`);
    }
  };
  /** A kill's drops on an Ang Silong floor: like a Warrens run's, everything on the floor for anyone on it, first come
   *  (the run's `lootFor`: a mini boss's pile and rolls, the Ice Machine's heap, a mob's own). */
  const silongDrop = (run: SilongRun, room: string, kill: MobKill) => {
    const floor = run.floorOf(room);
    if (!opts.items || !floor) return;
    const L = lootIn(room);
    const here = [...conns.values()].filter((o) => o.room === room);
    const random = opts.lootRandom ?? Math.random;
    const { contents, at } = run.lootFor(floor.floor, kill, here.map((o) => o.player.cls ?? null), () => randomBytes(8).toString('hex'), random, opts.lootPlusRandom ?? random);
    const fresh = L.scatter(contents, at, (a, n) => floor.mobs.lootSpots(a, n, L.taken()), Date.now());
    const inside = here.map((o) => o.userId);
    showLoot(room, startRolls(room, L, fresh, () => inside), kill.at);
  };
  /** Picks up the loot asked for (`id`) or, without one, the nearest they may take, within LOOT_REACH (a click, F or
   *  Space; nothing is picked up on its own). Full bag: it stays, and they're told. */
  const pickUp = (c: Conn, id?: string) => {
    const L = loots.get(c.room);
    if (!L || !opts.items || c.player.out) return;
    const l = L.pickable(c.userId, c.player.col, c.player.row, Date.now(), id);
    if (!l) return;
    // Kusing (and an event's Kowens) in a party (not personal loot): split equally between the party members in this
    // room, the picker first.
    const money = 'kusing' in l.content ? { kind: 'kusing' as const, n: l.content.kusing } : 'kowens' in l.content ? { kind: 'kowens' as const, n: l.content.kowens } : null;
    if (money && !l.personal) {
      const shares = splitKusing(money.n, withParty([c.userId], c.room));
      if (shares.size > 1) {
        L.remove(l.id);
        for (const [user, n] of shares) {
          const o = conns.get(user);
          const share = money.kind === 'kusing' ? { kusing: n } : { kowens: n };
          if (o && opts.items.take(user, share)) tellItems(o, share);
        }
        partyLoot(c, money.kind === 'kusing' ? { kusing: money.n } : { kowens: money.n }, Math.min(...shares.values()));
        return lootGone(c.room, [l.id]);
      }
    }
    if (!opts.items.take(c.userId, l.content)) return send(c, { t: 'loot-full' });
    L.remove(l.id);
    const got = gotOf(l.content);
    tellItems(c, got);
    partyLoot(c, got);
    lootGone(c.room, [l.id]);
  };
  /** Items a member shows in a chat line (their uids, at most 3): each one theirs (worn or in the combat bag) whose name
   *  ("[Hemp Robe +5]", named for their main stat) is in the text, as the server has it. */
  const itemLinks = (c: Conn, uids: unknown, text: string): ChatItemLink[] => {
    if (!opts.items || !Array.isArray(uids)) return [];
    const mine = opts.items.state(c.userId);
    const all = [...Object.values(mine.equipped), ...mine.bag].filter((i): i is Item => !!i);
    const main = c.player.cls ? (STATS.classes[c.player.cls]?.main ?? null) : null;
    const out: ChatItemLink[] = [];
    for (const uid of uids.slice(0, 3)) {
      const item = typeof uid === 'string' ? all.find((i) => i.uid === uid) : undefined;
      const label = item ? itemName(items, item, main) : '';
      if (item && text.includes(`[${label}]`) && !out.some((l) => l.label === label)) out.push({ label, item });
    }
    return out;
  };
  /** What a member picked up, to the rest of their party (their system feed), wherever they are. */
  const partyLoot = (c: Conn, got: LootGot, share?: number) => {
    const m: TownServerMessage = { t: 'party-loot', name: c.player.nickname, got, ...(share ? { share } : {}) };
    for (const user of parties.of(c.userId)?.members ?? []) {
      const o = conns.get(user);
      if (o && o !== c) send(o, m);
    }
  };

  // Trades (trade.ts): only with somewhere to keep items and a way to settle them.
  const TR = tradeRules(items.stats);
  const trades = opts.items?.trade ? new Trades(TR) : null;
  /** Near enough to trade: in the same room, neither knocked out, within range (tiles, either way). */
  const nearEnough = (a: Conn, b: Conn) =>
    a.room === b.room && !a.player.out && !b.player.out && Math.max(Math.abs(a.player.col - b.player.col), Math.abs(a.player.row - b.player.row)) <= TR.range;
  const nameOf = (user: string) => conns.get(user)?.player.nickname ?? known.get(user)?.nickname ?? 'Someone';
  /** The trade window as one side sees it (`with`: the other's town id). */
  const tradeView = (t: Trade, i: 0 | 1): TradeView => {
    const side = (k: 0 | 1) => ({ name: nameOf(t.users[k]), items: t.offers[k].items, kusing: t.offers[k].kusing, locked: t.locked[k], confirmed: t.confirmed[k] });
    const j = (1 - i) as 0 | 1;
    return { id: t.id, with: conns.get(t.users[j])?.player.id ?? '', you: side(i), them: side(j), slots: TR.slots };
  };
  /** The trade window to both sides (`note`: a line for each, if any). */
  const tellTrade = (t: Trade, note?: (user: string) => string | undefined) => {
    t.users.forEach((u, i) => {
      const o = conns.get(u);
      const n = note?.(u);
      if (o) send(o, { t: 'trade', trade: tradeView(t, i as 0 | 1), ...(n ? { note: n } : {}) });
    });
  };
  /** Ends a member's trade, if they're in one, telling both sides how. */
  const endTrade = (user: string, reason: TradeEnd, extra: { name?: string; message?: string } = {}) => {
    const t = trades?.end(user);
    if (!t) return;
    for (const u of t.users) {
      const o = conns.get(u);
      if (o) send(o, { t: 'trade-end', reason, ...extra });
    }
  };
  /** A member left (closed the page, another tab, a kick): their trade ends, their requests go (pop-ups close, askers
   *  hear they're gone). */
  const leftTrades = (user: string) => {
    endTrade(user, 'left', { name: nameOf(user) });
    for (const a of trades?.dropAsks(user) ?? []) {
      const o = conns.get(a.from === user ? a.to : a.from);
      if (!o) continue;
      if (a.from === user) send(o, { t: 'trade-ask-gone', ask: a.id });
      else send(o, { t: 'trade-refused', reason: 'gone', name: nameOf(user) });
    }
  };
  /** After someone moved: their trade ends if they're now too far apart (or in different rooms). */
  const tradeRange = (c: Conn) => {
    const t = trades?.of(c.userId);
    if (!t) return;
    const other = conns.get(t.users[0] === c.userId ? t.users[1] : t.users[0]);
    if (!other || !nearEnough(c, other)) endTrade(c.userId, 'far');
  };

  /** Token bucket: true if this message may go through (slowed: half as many, half as fast). */
  const spend = (c: Conn) => {
    const now = Date.now();
    // (Slowed: half; a dish's move speed (Pancit) on a battle map: faster.)
    // (Spilled rice under them: slower still, the slowest of the two; a Pancit's speed on top.)
    const slow = Math.min(vitals?.slowFactor(c.userId, now) ?? 1, mobsOf(c.room)?.slowAt(c.player.col, c.player.row, now) ?? 1);
    // (Ang Silong's Chill: 5% slower a stack.)
    const srun = silongOf(c.room);
    const chill = srun ? chillMove(srun.chillR, srun.chillOf(c.userId)) : 1;
    // (Spinning: a skill's hits on the move under way, Whirlwind, at 70%.)
    const spin = mobsOf(c.room)?.onTheMove(c.player.id) ? 0.7 : 1;
    const k = slow * chill * spin * (buffs && battle(c.room) ? moveSpeedOf(buffs.effective(c.userId)) : 1);
    c.tokens = Math.min(STEP_BURST * k, c.tokens + ((now - c.refilled) / 1000) * STEPS_PER_SECOND * k);
    c.refilled = now;
    if (c.tokens < 1) return false;
    c.tokens -= 1;
    return true;
  };

  const handle = (c: Conn, m: TownClientMessage) => {
    const p = c.player;
    const here = mapOf(c.room);
    const inside_ = (col: unknown, row: unknown): col is number => inside(here, col, row);
    const walkable_ = (col: number, row: number) => walkable(here, col, row);
    const fresh = c.fresh;
    c.fresh = false;
    // Knocked out: they can't walk, sit, move or fight until they respawn (chat and the rest go on).
    if (p.out) {
      if (m.t === 'here' || m.t === 'step' || m.t === 'sit') return send(c, { t: 'snap', col: p.col, row: p.row });
      if (m.t === 'attack') return send(c, { t: 'attack-refused', reason: 'out' });
      if (m.t === 'face' || m.t === 'move' || m.t === 'stand') return;
    }
    switch (m.t) {
      case 'here':
        if (!fresh || !inside_(m.col, m.row) || !walkable_(m.col, m.row) || !DIRS.has(m.dir)) return send(c, { t: 'snap', col: p.col, row: p.row });
        Object.assign(p, { col: m.col, row: m.row, dir: m.dir });
        others(c, { t: 'join', player: p }); // seen at the spawn point so far: show them where they are
        landed(c);
        return tradeRange(c);
      case 'step': {
        if (c.stunnedUntil && Date.now() < c.stunnedUntil) return send(c, { t: 'snap', col: p.col, row: p.row });
        const dc = (m.col as number) - p.col;
        const dr = (m.row as number) - p.row;
        // (Carried along one of Ang Silong's belts: free, at most the belts' speed.)
        const belt = silongFloor(c.room);
        const carried = !!belt?.alongBelt([p.col, p.row], [m.col as number, m.row as number]) && Date.now() - (c.beltAt ?? 0) >= 900 / belt.beltSpeed(Date.now());
        if (carried) c.beltAt = Date.now();
        const ok = inside_(m.col, m.row) && walkable_(m.col, m.row) && Math.abs(dc) <= 1 && Math.abs(dr) <= 1 && (dc || dr) && (carried || spend(c));
        if (!ok) return send(c, { t: 'snap', col: p.col, row: p.row });
        Object.assign(p, { col: m.col, row: m.row, dir: dirForStep(dc, dr), sit: false });
        silongOf(c.room)?.stepped(c.userId, Date.now()); // (walking clears Ang Silong's Chill)
        mobsOf(c.room)?.stopCasts(p.id); // (walking stops a channel or windup: CONTEXT.md Channel)
        others(c, { t: 'step', id: p.id, col: p.col, row: p.row });
        return tradeRange(c); // walking away from someone you're trading with cancels it
      }
      case 'face':
        if (!DIRS.has(m.dir) || !spend(c)) return;
        p.dir = m.dir;
        return others(c, { t: 'face', id: p.id, dir: p.dir });
      case 'sit': {
        // Benches are blocked tiles next to where you stand.
        const near = inside_(m.col, m.row) && Math.abs((m.col as number) - p.col) <= 1 && Math.abs((m.row as number) - p.row) <= 1;
        if (!near || !DIRS.has(m.dir) || !spend(c)) return send(c, { t: 'snap', col: p.col, row: p.row });
        // One person per bench.
        for (const o of conns.values()) {
          if (o !== c && o.room === c.room && o.player.sit && o.player.col === m.col && o.player.row === m.row) {
            send(c, { t: 'seat-taken' });
            return send(c, { t: 'snap', col: p.col, row: p.row });
          }
        }
        Object.assign(p, { col: m.col, row: m.row, dir: m.dir, sit: true });
        tradeRange(c);
        return others(c, { t: 'sit', id: p.id, col: p.col, row: p.row, dir: p.dir });
      }
      case 'stand':
        if (!p.sit) return;
        p.sit = false;
        return others(c, { t: 'stand', id: p.id });
      case 'emote': {
        if (!EMOTES.has(m.emote)) return;
        const now = Date.now();
        c.emotes = Math.min(EMOTE_BURST, c.emotes + ((now - c.emotedAt) / 1000) * EMOTES_PER_SECOND);
        c.emotedAt = now;
        if (c.emotes < 1) return;
        c.emotes -= 1;
        return others(c, { t: 'emote', id: p.id, emote: m.emote });
      }
      case 'move': {
        // A mobility move: just shown to the others (the steps after it move them, checked as ever). Ends near
        // where they are, one at a time; only their class's moves, from their unlock level. (Never while held on the
        // Great Scale's pan.)
        if (held(c)) return;
        const near = inside_(m.col, m.row) && Math.abs((m.col as number) - p.col) <= 6 && Math.abs((m.row as number) - p.row) <= 6;
        const now = Date.now();
        if (!MOVES.has(m.move) || !near || now - (c.movedAt ?? 0) < 800) return;
        if (opts.moveLevel) {
          const unlock = opts.moveLevel(p.cls, m.move);
          if (unlock === null || (p.level ?? 1) < unlock) return;
        }
        // Its MP on a battle map (the town is free): not enough, not shown (the game checks first).
        if (vitals && battle(c.room)) {
          const who = fighterOf(c);
          if (!vitals.spend(c.userId, skillMpCost(STATS, who.cls, m.move, who.moves?.[m.move] ?? 1))) return;
          tellVitals(c);
        }
        c.movedAt = now;
        // A dodging move (Step Back: stats.json skills.moveDodge): every hit landing in its window misses.
        const dodge = moveDodgeMs(STATS, m.move);
        if (dodge && battle(c.room)) c.dodgeUntil = now + dodge;
        return others(c, { t: 'move', id: p.id, move: m.move, col: m.col, row: m.row });
      }
      case 'attack': {
        // A damage skill on a mob (battle maps only): the mob room decides; everyone there sees the hit.
        const mobs = mobsOf(c.room);
        if (!mobs || typeof m.mob !== 'string' || !Number.isInteger(m.skill)) return;
        if (held(c)) return send(c, { t: 'attack-refused', reason: 'held' }); // (held on the Great Scale's pan)
        // Their class, level, points, everything worn and skill levels; blinded, every hit misses.
        const now = Date.now();
        const who = { ...fighterOf(c), blinded: !!vitals?.blinded(c.userId, now) };
        // (A tear cloud: that much off their accuracy, so they miss more.)
        const tear = vitals?.tearOf(c.userId, now) ?? 0;
        if (tear) who.buffs = { ...who.buffs, accuracy: (who.buffs?.accuracy ?? 0) - tear };
        // Its MP (stats.json skills.mpCost at its skill level), spent once the mob room takes the hit.
        const mp = skillMpCost(STATS, who.cls, String(m.skill), who.skills?.[m.skill as number] ?? 1);
        if (vitals && !vitals.hasMp(c.userId, mp)) return send(c, { t: 'attack-refused', reason: 'mp' });
        // (A charge-up's key held this long: the mob room clamps it to the skill's time.)
        const heldMs = typeof m.held === 'number' && Number.isFinite(m.held) ? Math.max(0, m.held) : undefined;
        const r = mobs.attack(p.id, [p.col, p.row], who, m.mob, now, m.skill as number, p.nickname, c.userId, { ...(heldMs !== undefined ? { held: heldMs } : {}), mp });
        if (!r.ok) return send(c, { t: 'attack-refused', reason: r.reason });
        // (A windup's MP is spent as it lands: skillTick's `spent`.)
        if (!r.windup && mp > 0 && vitals?.spend(c.userId, mp)) tellVitals(c);
        // A leap: they land next to the target first (everyone there sees them jump).
        if (r.leap) {
          [p.col, p.row] = r.leap;
          const jump: TownServerMessage = { t: 'leap', id: p.id, col: p.col, row: p.row };
          others(c, jump);
          send(c, jump);
        }
        // A heal (Herbal Storm): them and their party in range, its share of their Power.
        if (r.heal && vitals) healParty(c, r.heal);
        vitals?.fought(c.userId, now); // in combat: no HP back for a while
        // The hit, then what it set off (the golem calling the Junk, enraging, falling: its line too, to this room only).
        for (const e of [{ t: 'mob-hit', by: p.id, skill: m.skill as number, hits: r.hits, ...(r.windup ? { windup: r.windup, target: m.mob } : {}) } satisfies TownServerMessage, ...mobs.flush()]) {
          others(c, e);
          send(c, e);
        }
        killed(c.room, r.kills);
        petXp(c, mobs, r.hits, now);
        return;
      }
      case 'skill-stop':
        // They moved or let go: their channel or windup stops (a windup's cooldown back: it cost nothing).
        mobsOf(c.room)?.stopCasts(p.id);
        return;
      case 'buff-off':
        // A buff taken off yourself (right-click in the tray): gone, and your stats and most HP with it.
        if (buffs && typeof m.buff === 'string' && buffs.remove(c.userId, m.buff)) {
          saveDishes();
          buffsChanged(c);
        }
        return;
      case 'dish-buy': {
        // A dish from Aling Conching: only in the Lumang Palengke; its Kusing spent (the bot checks it's unlocked), then
        // it's on (the one in its slot replaced).
        if (typeof m.dish !== 'string') return;
        const no = (message: string) => send(c, { t: 'dish', ok: false, dish: m.dish, message });
        if (c.room !== PALENGKE) return no('Aling Conching serves them in the Old Market.');
        // (Her menu's Susi ng Silong row: a key into the bag, not a dish.)
        if (opts.silong?.buyKey && m.dish === opts.silong.data.key.id) {
          const why = opts.silong.buyKey(c.userId);
          if (why) return no(why);
          tellItems(c);
          console.log(`[silong] ${c.userId} bought a ${opts.silong.data.key.name}`);
          return send(c, { t: 'dish', ok: true, dish: m.dish });
        }
        if (!dishOf(DISHES, m.dish) || !opts.dishes || !buffs) return no('No such dish.');
        const refused = opts.dishes.buy(c.userId, m.dish);
        if (refused) return no(refused);
        serve(c.userId, m.dish);
        tellItems(c);
        console.log(`[dishes] ${c.userId} bought ${m.dish}`);
        return send(c, { t: 'dish', ok: true, dish: m.dish });
      }
      case 'buff': {
        // A buff (town-buffs.ts decides): its MP spent, everyone in the room sees the cast; who it reached gets it (their
        // tray, HP's most), or a heal (Soothing Touch) for the caster's Power × its share, green numbers for the room.
        if (!buffs || !vitals || typeof m.buff !== 'string' || held(c)) return;
        const now = Date.now();
        const who = fighterOf(c);
        const party = (parties.of(c.userId)?.members ?? []).flatMap((u): Nearby[] => {
          const o = conns.get(u);
          return o && o.room === c.room ? [{ member: u, at: [o.player.col, o.player.row], out: !!o.player.out }] : [];
        });
        // The player they've picked (any player in the room, party or not).
        const picked = typeof m.target === 'string' ? town.memberOf(m.target) : null;
        const t = picked ? conns.get(picked) : undefined;
        const target: Nearby | undefined = t && t.room === c.room ? { member: t.userId, at: [t.player.col, t.player.row], out: !!t.player.out } : undefined;
        const v = vitals.get(c.userId);
        // A debuff (CONTEXT.md Debuff) goes on a mob: the one they've targeted (`target`: its id) within its range, else
        // the nearest that is; nobody in range, nothing spent.
        const def = STATS.skills.buffs?.list[m.buff];
        const mobs = mobsOf(c.room);
        const mobTarget = typeof m.target === 'string' && !picked ? m.target : null;
        if (def?.debuff && battle(c.room)) {
          const ids = mobs?.debuff(p.id, [p.col, p.row], m.buff, def.stats, 0, mobTarget, def.rangeTiles ?? 1, now, true) ?? [];
          if (!ids.length) return send(c, { t: 'buff-refused', buff: m.buff, reason: 'target' });
        }
        const r = buffs.cast({ member: c.userId, cls: who.cls, level: who.level ?? p.level ?? 1, skillLevel: who.buffLevels?.[m.buff] ?? 1, out: !!p.out, battle: battle(c.room), mp: v ? v.mp : 0, at: [p.col, p.row] }, m.buff, party, target, now);
        if (!r.ok) return send(c, { t: 'buff-refused', buff: m.buff, reason: r.reason, ...(r.ms ? { ms: r.ms } : {}) });
        if (r.debuff && mobs) {
          mobs.debuff(p.id, [p.col, p.row], m.buff, r.debuff, (r.buff.durationSec ?? 0) * 1000, mobTarget, r.buff.rangeTiles ?? 1, now);
          for (const e of mobs.flush()) {
            others(c, e as TownServerMessage);
            send(c, e as TownServerMessage);
          }
        }
        if (r.mp > 0) vitals.spend(c.userId, r.mp);
        // (Who it reached, by town id: everyone sees its look on each of them.)
        const reached = r.to.flatMap((u) => (conns.get(u) ? [conns.get(u)!.player.id] : []));
        const cast: TownServerMessage = { t: 'buff-cast', id: p.id, buff: m.buff, dir: p.dir, ...(r.off ? { off: true } : {}), ...(reached.length ? { to: reached } : {}) };
        others(c, cast);
        send(c, { ...cast, cooldown: r.cooldownMs });
        if (r.heal !== null) {
          const power = rules!.fighter(fighterOf(c)).power;
          const heals = r.to.flatMap((u) => {
            const o = conns.get(u);
            const amount = o ? vitals.heal(u, 'hp', power * r.heal!) : 0;
            if (o && o !== c) tellVitals(o);
            return o ? [{ id: o.player.id, amount }] : [];
          });
          const healed: TownServerMessage = { t: 'buff-heal', by: p.id, heals };
          others(c, healed);
          send(c, healed);
        } else for (const u of r.to) if (conns.get(u)) buffsChanged(conns.get(u)!);
        return tellVitals(c);
      }
      case 'loot-roll': {
        const r = rolls.answer(String(m.id), c.userId, m.roll === true, opts.rollRandom ?? Math.random);
        if (!r) return;
        for (const { member } of r.roll.members) {
          const o = conns.get(member);
          if (o) send(o, { t: 'loot-rolled', id: r.roll.id, name: c.player.nickname, roll: r.value, ...(o === c ? { you: true } : {}) });
        }
        if (r.done) endRoll(rolls.finish(r.roll.id)!);
        return;
      }
      case 'pick':
        if (m.id === undefined || typeof m.id === 'string') pickUp(c, m.id);
        return;
      case 'drop': {
        // An item dragged out of the bag onto the map: on the ground at their feet (bouncing out of them), for their
        // party alone if they're in one, else for anyone; gone after LOOT_MS like any loot. Never bound items.
        if (!opts.items?.drop || p.out || typeof m.item !== 'string') return;
        const now = Date.now();
        if (now - (c.droppedAt ?? 0) < 300) return send(c, { t: 'drop-refused', message: 'Slow down a little.' });
        c.droppedAt = now;
        const r = opts.items.drop(c.userId, m.item, Number(m.count));
        if (typeof r === 'string') return send(c, { t: 'drop-refused', message: r });
        const L = lootIn(c.room);
        const at: [number, number] = [p.col, p.row];
        const mobs = mobsOf(c.room);
        const spot = mobs ? (mobs.lootSpots(at, 1, L.taken())[0] ?? at) : groundSpot(mapOf(c.room), at, L.taken());
        const party = parties.of(c.userId)?.members ?? [];
        showLoot(c.room, [L.place({ item: r }, spot, party.length > 1 ? [...party] : [], now)], at);
        tellItems(c);
        console.log(`[drop] ${c.userId} dropped ${r.defId}${r.count > 1 ? ` ×${r.count}` : ''} (${r.uid}) in ${c.room}${party.length > 1 ? ' for their party' : ''}`);
        return;
      }
      case 'revive':
        // "Revive now" from the unconscious pop-up: only while knocked out, else nothing happens.
        if (vitals?.revive(c.userId, Date.now())) respawn(c);
        return;
      case 'potion': {
        // An HP or MP Potion from their bag: battle maps only, its kind's cooldown (or one shared: potionCooldownGroup),
        // never when it'd do nothing.
        if (typeof m.item !== 'string' || !opts.items) return;
        const kind = potionOf(items, m.item);
        if (!kind) return;
        const now = Date.now();
        if (!vitals?.get(c.userId) || !battle(c.room)) return send(c, { t: 'potion-refused', reason: 'here' });
        const from = potionMinLevel(items, m.item); // (a Medium Potion traded to someone under its level)
        if (levelOf(c) < from) return send(c, { t: 'potion-refused', reason: 'level', level: from });
        const cdKey = `${c.userId}:${potionCooldownGroup(items.stats, kind.heals)}`;
        const ready = potionReady.get(cdKey) ?? 0;
        if (now < ready) return send(c, { t: 'potion-refused', reason: 'cooldown', ms: ready - now, heals: kind.heals });
        if (vitals.full(c.userId, kind.heals)) return send(c, { t: 'potion-refused', reason: 'full' });
        const used = opts.items.usePotion(c.userId, m.item);
        if (!used) return send(c, { t: 'potion-refused', reason: 'none' });
        const healed = vitals.heal(c.userId, used.heals, used.amount);
        potionReady.set(cdKey, now + POTION_MS);
        tellItems(c);
        const shownTo: TownServerMessage = { t: 'potion', id: p.id, heals: used.heals, amount: healed };
        others(c, shownTo);
        send(c, { ...shownTo, cooldown: POTION_MS });
        return tellVitals(c);
      }
      case 'party-invite': {
        const now = Date.now();
        if (now - (c.invitedAt ?? 0) < INVITE_GAP_MS) return send(c, { t: 'party-refused', reason: 'slow' });
        c.invitedAt = now;
        const to = typeof m.to === 'string' ? town.memberOf(m.to) : null;
        const them = to ? conns.get(to) : undefined;
        if (!to || !them) return send(c, { t: 'party-refused', reason: 'gone' });
        if (blockedBy(to, c.userId)) return send(c, { t: 'party-refused', reason: 'closed', name: them.player.nickname });
        const r = parties.invite(c.userId, to, now);
        if (!r.ok) return send(c, { t: 'party-refused', reason: r.reason, name: them.player.nickname });
        return send(them, { t: 'party-invited', invite: r.invite, from: p.id, name: p.nickname, members: r.members });
      }
      case 'party-answer': {
        if (typeof m.invite !== 'string') return;
        const r = parties.answer(c.userId, m.invite, m.accept === true, Date.now());
        if (!r.ok) return send(c, { t: 'party-refused', reason: r.reason });
        if (!r.change) {
          const inviter = conns.get(r.from);
          return inviter && send(inviter, { t: 'party-declined', name: p.nickname });
        }
        return partyChanged(r.change);
      }
      case 'party-leave': {
        // (Leaving for good: none of the party's Warrens runs take them back once it's over.)
        const party = parties.of(c.userId);
        const change = parties.leave(c.userId);
        W?.leftParty(c.userId, party);
        SL?.leftParty(c.userId, party);
        return partyChanged(change);
      }
      case 'party-disband': {
        const r = parties.disband(c.userId);
        return r.ok ? partyChanged(r.change) : send(c, { t: 'party-refused', reason: r.reason });
      }
      case 'party-kick': {
        const party = parties.of(c.userId);
        const r = typeof m.member === 'string' ? parties.kick(c.userId, m.member) : null;
        if (!r) return;
        if (r.ok && r.change.out[0]) {
          W?.leftParty(r.change.out[0].user, party);
          SL?.leftParty(r.change.out[0].user, party);
        }
        return r.ok ? partyChanged(r.change) : send(c, { t: 'party-refused', reason: r.reason });
      }
      case 'friend-ask': {
        if (!F || !opts.friends) return;
        const now = Date.now();
        if (now - (c.friendAt ?? 0) < FRIEND_GAP_MS) return send(c, { t: 'friend-refused', reason: 'slow' });
        c.friendAt = now;
        // Someone here (their town id), or anyone by nickname (offline too: they see it next time).
        const asked = typeof m.name === 'string' ? m.name.slice(0, 32) : undefined;
        const to = typeof m.to === 'string' ? town.memberOf(m.to) : asked ? opts.friends.byName(asked) : null;
        if (!to || !opts.profile(to)) return send(c, { t: 'friend-refused', reason: 'gone', ...(asked ? { name: asked } : {}) });
        const r = F.ask(c.userId, to, now);
        if (!r.ok) return send(c, { t: 'friend-refused', reason: r.reason, name: friendName(to) });
        if (r.friends) return befriended(c.userId, to); // (they'd asked you already)
        tellFriendList(c.userId, { note: `Friend request sent to ${friendName(to)}.` });
        return tellFriendList(to, { asked: { key: F.key(c.userId), name: p.nickname, at: now } });
      }
      case 'friend-answer': {
        if (!F || typeof m.key !== 'string') return;
        const from = F.member(m.key);
        const r = from ? F.answer(c.userId, from, m.accept === true, Date.now()) : null;
        if (!from || !r?.ok) return send(c, { t: 'friend-refused', reason: r && !r.ok ? r.reason : 'expired', ...(from ? { name: friendName(from) } : {}) });
        if (r.friends) return befriended(c.userId, from);
        tellFriendList(c.userId);
        return tellFriendList(from); // (declined: their request is simply gone)
      }
      case 'friend-cancel': {
        if (!F || typeof m.key !== 'string') return;
        const to = F.member(m.key);
        const r = to ? F.cancel(c.userId, to, Date.now()) : null;
        if (!to || !r?.ok) return send(c, { t: 'friend-refused', reason: 'expired' });
        tellFriendList(c.userId);
        return tellFriendList(to);
      }
      case 'friend-remove': {
        if (!F || typeof m.key !== 'string') return;
        const other = F.member(m.key);
        const r = other ? F.remove(c.userId, other) : null;
        if (!other || !r?.ok) return send(c, { t: 'friend-refused', reason: 'gone' });
        tellFriendList(c.userId, { note: `${friendName(other)} is no longer your friend.` });
        return tellFriendList(other);
      }
      case 'block': {
        if (!F || !opts.friends) return;
        const now = Date.now();
        if (now - (c.friendAt ?? 0) < FRIEND_GAP_MS) return send(c, { t: 'friend-refused', reason: 'slow' });
        c.friendAt = now;
        const asked = typeof m.name === 'string' ? m.name.slice(0, 32) : undefined;
        const who = typeof m.to === 'string' ? town.memberOf(m.to) : asked ? opts.friends.byName(asked) : null;
        if (!who || !opts.profile(who)) return send(c, { t: 'friend-refused', reason: 'gone', ...(asked ? { name: asked } : {}) });
        if (opts.gm?.(who)) return send(c, { t: 'friend-refused', reason: 'gm', name: friendName(who) });
        const r = F.block(c.userId, who, now);
        if (!r.ok) return send(c, { t: 'friend-refused', reason: r.reason, name: friendName(who) });
        tellFriendList(c.userId, { note: `You blocked ${friendName(who)}.` });
        return tellFriendList(who); // (a friendship or request with you is gone from their list; nothing says why)
      }
      case 'unblock': {
        if (!F || typeof m.key !== 'string') return;
        const who = F.member(m.key);
        const r = who ? F.unblock(c.userId, who) : null;
        if (!who || !r?.ok) return send(c, { t: 'friend-refused', reason: 'gone' });
        return tellFriendList(c.userId, { note: `You unblocked ${friendName(who)}.` });
      }
      case 'buffs-of': {
        // The buffs on someone (the player box's icons, asked every couple of seconds while it's open).
        const now = Date.now();
        if (now - (c.buffsOfAt ?? 0) < 400 || typeof m.id !== 'string') return;
        c.buffsOfAt = now;
        const of = town.memberOf(m.id);
        const them = of ? conns.get(of) : undefined;
        return send(c, { t: 'buffs-of', id: m.id, buffs: of && buffs ? buffs.view(of, now) : [], ...(them && rules ? { cp: rules.rating(fighterOf(them)) } : {}) });
      }
      case 'inspect': {
        // Someone's worn gear and stats (the player menu's Info): anyone in town, a few a second at most.
        const now = Date.now();
        if (now - (c.inspectAt ?? 0) < 250 || typeof m.id !== 'string') return;
        c.inspectAt = now;
        const to = town.memberOf(m.id);
        const them = to ? conns.get(to) : undefined;
        if (!them) return send(c, { t: 'inspect', id: m.id, gone: true });
        const state = opts.items?.state(them.userId);
        const equipped = state?.equipped ?? {};
        const cosmetics = state?.cosmetics ?? {};
        const d = rules?.fighter(fighterOf(them));
        const stats = d
          ? {
              cp: rules!.rating(fighterOf(them)),
              ...{ power: d.power, def: d.def, hp: d.hp, mp: d.mp, STR: d.STR, DEX: d.DEX, INT: d.INT, critRate: d.critRate },
              ...{ critDamage: d.critDamage, amp: d.amp, atkRate: d.atkRate, defRate: d.defRate, lifesteal: d.lifesteal, manasteal: d.manasteal },
              ...{ hpRegen: d.hpRegen, hpRegenPct: d.hpRegenPct, mpRegen: d.mpRegen, dropRate: d.dropRate, accuracy: d.accuracy, cooldownPct: d.cooldownPct },
            }
          : null;
        // (Their pet out too: the Info window's Pet tab.)
        return send(c, { t: 'inspect', id: m.id, cls: them.player.cls ?? null, level: d?.level ?? them.player.level ?? 1, equipped, cosmetics, pet: state?.pet ?? null, stats });
      }
      case 'trade-ask': {
        // Ask someone near you to trade (the player menu): they have the timeout to answer.
        if (!trades) return;
        const now = Date.now();
        if (now - (c.askedAt ?? 0) < INVITE_GAP_MS) return send(c, { t: 'trade-refused', reason: 'slow' });
        c.askedAt = now;
        const to = typeof m.to === 'string' ? town.memberOf(m.to) : null;
        const them = to ? conns.get(to) : undefined;
        if (!to || !them) return send(c, { t: 'trade-refused', reason: 'gone' });
        const name = them.player.nickname;
        if (p.out || them.player.out) return send(c, { t: 'trade-refused', reason: 'out', name });
        if (!nearEnough(c, them)) return send(c, { t: 'trade-refused', reason: 'far', name });
        if (blockedBy(to, c.userId)) return send(c, { t: 'trade-refused', reason: 'closed', name });
        const r = trades.ask(c.userId, to, now);
        if (!r.ok) return send(c, { t: 'trade-refused', reason: r.reason, name });
        return send(them, { t: 'trade-asked', ask: r.ask.id, from: p.id, name: p.nickname, ms: TR.timeoutMs });
      }
      case 'trade-answer': {
        // Yes opens the window for both (if they're still near each other); no tells the asker.
        if (!trades || typeof m.ask !== 'string') return;
        const now = Date.now();
        const a = trades.pending(c.userId, m.ask, now);
        if (!a) return send(c, { t: 'trade-refused', reason: 'expired' });
        const asker = conns.get(a.from);
        const accept = m.accept === true;
        if (accept && (!asker || !nearEnough(c, asker))) {
          trades.answer(c.userId, a.id, false, now);
          const reason = !asker ? 'gone' : p.out || asker.player.out ? 'out' : 'far';
          send(c, { t: 'trade-refused', reason, name: nameOf(a.from) });
          if (asker) send(asker, { t: 'trade-refused', reason, name: p.nickname });
          return;
        }
        const r = trades.answer(c.userId, a.id, accept, now);
        if (!r.ok) return send(c, { t: 'trade-refused', reason: r.reason, name: nameOf(a.from) });
        if (!r.trade) return asker && send(asker, { t: 'trade-refused', reason: 'declined', name: p.nickname });
        return tellTrade(r.trade);
      }
      case 'trade-offer': {
        // Their whole side again, checked against their combat bag: any change unlocks both.
        if (!trades || !opts.items) return;
        const t = trades.of(c.userId);
        if (!t) return;
        const r = checkOffer(items, opts.items.state(c.userId), { items: m.items, kusing: m.kusing }, TR.slots);
        if (!r.ok) return send(c, { t: 'trade-bad', message: r.message });
        const wasLocked = t.locked[0] || t.locked[1];
        trades.offer(c.userId, r.offer);
        return tellTrade(t, (u) => (!wasLocked ? undefined : u === c.userId ? 'You changed your side: both unlocked.' : `${p.nickname} changed their side: both unlocked.`));
      }
      case 'trade-lock': {
        const t = trades?.lock(c.userId, m.on === true);
        if (t) tellTrade(t);
        return;
      }
      case 'trade-confirm': {
        // Trade pressed: once both have, everything is checked again and moved in one go (or nothing, and it ends).
        if (!trades || !opts.items?.trade) return;
        const r = trades.confirm(c.userId);
        if (!r) return send(c, { t: 'trade-bad', message: 'Both sides lock first.' });
        if (!r.both) return tellTrade(r.trade);
        const t = r.trade;
        let done: { ok: true } | { ok: false; message: string };
        try {
          done = opts.items.trade(t.users, t.offers, [nameOf(t.users[0]), nameOf(t.users[1])]);
        } catch (e) {
          console.error('[trade] failed to save:', e);
          done = { ok: false, message: "Couldn't save the trade. Nothing moved." };
        }
        if (!done.ok) return endTrade(c.userId, 'failed', { message: done.message });
        for (const u of t.users) {
          const o = conns.get(u);
          if (o) tellItems(o);
        }
        return endTrade(c.userId, 'done');
      }
      case 'trade-cancel':
        // Closing the window (or Cancel): it ends for both.
        return endTrade(c.userId, 'cancelled', { name: p.nickname });
      case 'warrens-gate':
      case 'warrens-open':
      case 'warrens-practice':
      case 'warrens-join':
      case 'warrens-start':
      case 'warrens-decline':
      case 'warrens-leave':
        return warrensMessage(c, m);
      case 'silong-gate':
      case 'silong-open':
      case 'silong-practice':
      case 'silong-join':
      case 'silong-decline':
      case 'silong-leave':
      case 'silong-ride':
      case 'silong-up':
      case 'silong-ramon':
        return silongMessage(c, m);
      case 'ramon-give': {
        // Mang Ramon's note to Kuya Jun, in the Lumang Palengke.
        if (!opts.silong?.ramon || c.room !== PALENGKE) return;
        const why = opts.silong.ramon.give(c.userId);
        if (!why) {
          console.log(`[silong] ${c.userId} gave Kuya Jun Mang Ramon's note`);
          tellItems(c);
        }
        return send(c, { t: 'ramon-thanks', ok: !why, ...(why ? { message: why } : {}) });
      }
      case 'lantern':
        return lanternMessage(c, m.to, m.post);
      case 'arena-queue':
        if (p.jailed) return; // no games from jail
        c.seat ??= { key: c.userId, player: p, send: (msg) => send(c, msg) };
        return arena.join(c.seat, m.bet);
      case 'arena-bot':
        if (p.jailed) return;
        c.seat ??= { key: c.userId, player: p, send: (msg) => send(c, msg) };
        return arena.playBot(c.seat, m.bet);
      case 'arena-cancel':
        return arena.cancel(c.userId);
      case 'arena-pick':
        return arena.pick(c.userId, m.hand);
      case 'arena-rematch':
        return arena.rematch(c.userId, m.bet);
      case 'arena-decline':
        return arena.decline(c.userId);
      case 'arena-leave':
        return arena.leave(c.userId);
      case 'say': {
        const said = speaking(c, m.text, m.links);
        if (!said) return;
        const { text, links } = said;
        // To the party only: its members, wherever they are (not kept, not to Discord).
        if (m.party === true) {
          const party = parties.of(c.userId);
          if (!party) return send(c, { t: 'say-refused', reason: 'party' });
          c.says -= 1;
          for (const member of party.members) {
            const o = conns.get(member);
            if (o) send(o, { t: 'party-say', id: p.id, name: p.nickname, text, ...(links.length ? { links } : {}), ...(p.cls ? { cls: p.cls } : {}) });
          }
          return;
        }
        // The GM channel: Game Masters only (free); else a megaphone, if asked for, uses one.
        const gm = m.gm === true;
        if (gm && !opts.gm?.(c.userId)) return send(c, { t: 'say-refused', reason: 'gm' });
        const megaphone = !gm && m.megaphone === true;
        if (megaphone && opts.megaphone && opts.megaphone(c.userId) === null) return send(c, { t: 'say-refused', reason: 'megaphone' });
        c.says -= 1;
        // To everyone, the speaker included (their own words come back this way), and on to Discord. Not saved.
        // (The speaker's class goes with it: their badge in the chat, for those on other maps too.)
        const loud = { ...(megaphone ? { megaphone } : {}), ...(gm ? { gm } : {}), ...(p.cls ? { cls: p.cls } : {}) };
        remember({ name: p.nickname, text, ...loud, ...(links.length ? { links } : {}) });
        opts.onSay?.(c.userId, p.nickname, text, megaphone, gm);
        return everyone({ t: 'say', id: p.id, name: p.nickname, text, ...loud, ...(links.length ? { links } : {}) });
      }
      case 'whisper': {
        // To one player who's online, anywhere (CONTEXT.md Whisper): never to Discord, never kept, never in the log.
        if (typeof m.to !== 'string') return;
        const name = m.to.slice(0, 32);
        const said = speaking(c, m.text, m.links);
        if (!said) return;
        const to = [...conns.values()].find((o) => fold(o.player.nickname) === fold(name));
        if (to === c) return send(c, { t: 'whisper-refused', reason: 'self', name: p.nickname });
        if (!to) return send(c, { t: 'whisper-refused', reason: 'offline', name });
        // Blocked, or friends-only whispers (theirs to set): the same answer either way. Game Masters may always whisper.
        const gm = !!opts.gm?.(c.userId);
        const closed = blockedBy(to.userId, c.userId) || (opts.privacy?.get(to.userId).whispers === 'friends' && !F?.areFriends(c.userId, to.userId));
        if (closed && !gm) return send(c, { t: 'whisper-refused', reason: 'closed', name: to.player.nickname });
        c.says -= 1;
        const extra = { ...(gm ? { gm: true as const } : {}), ...(said.links.length ? { links: said.links } : {}) };
        send(to, { t: 'whisper', id: p.id, name: p.nickname, text: said.text, ...extra });
        return send(c, { t: 'whisper', id: to.player.id, name: to.player.nickname, text: said.text, sent: true, ...extra });
      }
      case 'bell-ring': {
        // The Great Scale's bell after its fall, rung within 3 tiles of it: everyone near it on their "ring the bell"
        // step moves on (CONTEXT.md Bell). One ring a second.
        const G = opts.greatScale;
        const now = Date.now();
        const at = G && G.room === c.room ? G.boss.bell(now) : null;
        if (!at || p.out || cheb([p.col, p.row], at) > BELL_TILES || now - (c.bellAt ?? 0) < 1000) return;
        c.bellAt = now;
        const rung: TownServerMessage = { t: 'bell-rung', id: p.id };
        for (const o of conns.values()) {
          if (o.room !== c.room) continue;
          send(o, rung);
          if (cheb([o.player.col, o.player.row], at) > BELL_TILES || o.player.out) continue;
          if (!opts.quests?.bell) {
            send(o, { t: 'quest-bell', mob: G!.boss.id }); // (the dev town: the page's pretend quests)
            continue;
          }
          const r = opts.quests.bell(o.userId, G!.boss.id);
          if (r) send(o, { t: 'quests', active: r.active });
        }
        return;
      }
      case 'mikko-claim': {
        // A click on Mikko Kalabasa: theirs if it hides here within reach (the server's tiles decide; first wins).
        if (!H || p.out) return;
        const now = Date.now();
        const r = H.claimMikko(c.room, [p.col, p.row], now);
        if (!r) return;
        rewardHalloween(c, 'mikko', r.reward);
        const fx: TownServerMessage = { t: 'mikko-found', col: r.where[0], row: r.where[1] };
        for (const o of conns.values()) if (o.room === c.room) send(o, fx);
        eventLine(H.data.mikko.announce.replace('{name}', p.nickname), 'mikko');
        return tellHalloween();
      }
      case 'reunite': {
        // A click on the Manananggal's lower half while carrying its upper half (town, within reach).
        if (!H || c.room !== 'town') return;
        const r = H.reunite(c.userId, [p.col, p.row], Date.now());
        if (!r) return;
        rewardHalloween(c, 'reunite', r.reward);
        const fx: TownServerMessage = { t: 'reunited', id: p.id, col: r.where[0], row: r.where[1] };
        for (const o of conns.values()) if (o.room === 'town') send(o, fx);
        eventLine(H.data.manananggal.announceReunite.replace('{name}', p.nickname));
        return tellHalloween();
      }
      case 'privacy': {
        // Only what's given and valid changes (whispers: everyone / friends; balance and status: everyone / friends / me).
        if (!opts.privacy) return;
        const change: Partial<PrivacySettings> = {};
        if (m.whispers === 'everyone' || m.whispers === 'friends') change.whispers = m.whispers;
        for (const what of ['balance', 'status'] as const) if (VISIBILITIES.includes(m[what] as Visibility)) change[what] = m[what];
        if (!Object.keys(change).length) return;
        return send(c, { t: 'privacy', privacy: opts.privacy.set(c.userId, change) });
      }
      case 'testing': {
        // A Game Master's testing switches (Settings → Testing): anyone else's message is ignored.
        if (!opts.testing || !opts.gm?.(c.userId) || typeof m.unkillable !== 'boolean') return;
        const testing = opts.testing.set(c.userId, { unkillable: m.unkillable });
        vitals?.setUnkillable(c.userId, testing.unkillable);
        console.log(`[testing] ${p.nickname} unkillable ${testing.unkillable ? 'on' : 'off'}`);
        return send(c, { t: 'testing', testing });
      }
    }
  };

  /** A line someone says (in chat or a whisper): not muted, tidied, through the word filter, and within their pace (the
   *  caller takes one off `says` once it goes), with the items shown in it. Null: refused (they're told why). */
  const speaking = (c: Conn, raw: unknown, rawLinks: unknown): { text: string; links: ChatItemLink[] } | null => {
    const refuse = (m: TownServerMessage) => {
      send(c, m);
      return null;
    };
    const muted = opts.moderation?.mutedUntil(c.userId);
    if (muted) return refuse({ t: 'say-refused', reason: 'muted', until: muted });
    const tidied = tidy(raw);
    if (!tidied) return refuse({ t: 'say-refused', reason: 'invalid' });
    const text = opts.moderation ? opts.moderation.filter(tidied) : tidied;
    const now = Date.now();
    c.says = Math.min(SAY_BURST, c.says + ((now - c.saidAt) / 1000) * SAYS_PER_SECOND);
    c.saidAt = now;
    if (c.says < 1) return refuse({ t: 'say-refused', reason: 'slow' });
    // Items shown in it: theirs (worn or in the combat bag), each written in the text as "[its name]".
    return { text, links: itemLinks(c, rawLinks, text) };
  };

  /** A walkable tile near the room's spawn point that nobody's standing on (any walkable one if they're all taken). A
   *  teleport under way to this room (`trips`: a Lantern Post's light) lands by the room's post instead, on its landing
   *  itself when it's free: the server places them there, so their page needn't know (a reload, a relaunched home screen
   *  app or a stale map on the page would otherwise leave them at the spawn point, the way in from the town). */
  const arrival = (room: string, userId?: string): [number, number] => {
    const m = mapOf(room);
    const run = runOf(room);
    const trip = userId ? trips.get(userId) : undefined;
    const post = trip && trip.to === room && Date.now() < trip.until ? m.lanterns?.[trip.post]?.arrive : undefined;
    const floor = silongFloor(room);
    const [sc, sr] = run && userId ? run.arrivalFor(userId) : floor ? floor.map.silong.arriveMark : (post ?? m.spawn);
    const spread = post ? 1 : run || floor ? RUN_SPREAD : SPAWN_SPREAD;
    const taken = new Set([...conns.values()].filter((o) => o.room === room).map((o) => `${o.player.col},${o.player.row}`));
    if (post && walkable(m, sc, sr) && !taken.has(`${sc},${sr}`)) return [sc, sr];
    const avoid = new Set((m.avoid ?? []).map(([c, r]) => `${c},${r}`));
    const free: [number, number][] = [];
    const open: [number, number][] = [];
    for (let r = sr - spread; r <= sr + spread; r++) {
      for (let c = sc - spread; c <= sc + spread; c++) {
        if (!inside(m, c, r) || !walkable(m, c, r) || avoid.has(`${c},${r}`)) continue;
        open.push([c, r]);
        if (!taken.has(`${c},${r}`)) free.push([c, r]);
      }
    }
    const pool = free.length ? free : open.length ? open : [[sc, sr] as [number, number]];
    return pool[Math.floor(Math.random() * pool.length)];
  };

  const join = (ws: WebSocket, userId: string, profile: TownProfile, room: string) => {
    // Kicked by a moderator: told when they may come back, and closed.
    const kicked = opts.moderation?.kickedUntil(userId);
    if (kicked) return ws.close(KICKED, String(kicked));
    // Maintenance: only the CMS's users come in.
    if (opts.maintenance?.on() && !opts.maintenance.allowed(userId)) return ws.close(MAINTENANCE, opts.maintenance.note().slice(0, 120));
    // The Warrens: the run they may be in (their party's, or their own); none (closed, or not theirs) → back out.
    if (room === 'warrens') {
      const run = W?.runOf(userId);
      if (!run) {
        ws.send(JSON.stringify({ t: 'warrens-out', reason: 'closed' } satisfies TownServerMessage));
        return ws.close(4002, 'no run');
      }
      room = run.room;
    }
    // Ang Silong: the floor asked for of the run they may be in (one the run hasn't reached yet: its deepest); none → out.
    const asked = floorOfArea(room);
    if (asked) {
      const run = SL?.runOf(userId);
      if (!run) {
        ws.send(JSON.stringify({ t: 'silong-out', reason: 'closed' } satisfies TownServerMessage));
        return ws.close(4002, 'no run');
      }
      room = run.roomOf(run.reached.has(asked) ? asked : run.deepest());
    }
    // A second tab takes over: the first one is told and closed.
    const old = conns.get(userId);
    if (old) {
      conns.delete(userId);
      arena.leave(userId);
      leftTrades(userId);
      others(old, { t: 'leave', id: old.player.id });
      old.ws.close(4000, 'opened elsewhere');
    }
    const [col, row] = arrival(room, userId);
    const player: TownPlayer = { id: randomBytes(6).toString('hex'), ...profile, col, row, dir: 's', sit: false };
    const c: Conn = { ws, userId, room, player, tokens: STEP_BURST, refilled: Date.now(), says: SAY_BURST, saidAt: Date.now(), emotes: EMOTE_BURST, emotedAt: Date.now(), alive: true, fresh: true };
    // Off a battle map, timed buffs are over (a stance stays on; a reload on the same battle map keeps them).
    if (!battle(room)) buffs?.endTimed(userId);
    // HP and MP: full in a safe room; in a battle map as they were (a reload), full if new there or knocked out.
    if (vitals) {
      const { hp, maxHp } = shown(vitals.arrive(userId, maxOf(c), battle(room), Date.now()));
      Object.assign(player, { hp, maxHp });
    }
    const mobRoom = mobsOf(room);
    queueMicrotask(() => {
      // After the welcome: the mobs, and the loot they can see.
      if (mobRoom) {
        const now = Date.now();
        const plan = mobRoom.golemPlan(now);
        const G = opts.greatScale?.room === room ? opts.greatScale.boss : null;
        send(c, { t: 'mobs', mobs: mobRoom.snapshot(now), golem: mobRoom.golemState(now), ...(plan && plan.nextRise !== null ? { riseIn: plan.nextRise - now } : {}), ...(G ? { greatScale: G.state(now) } : {}) });
      }
      const loot = loots.get(room);
      if (loot) send(c, { t: 'loot', loot: loot.viewAll(userId, Date.now()) });
    });
    send(c, { t: 'welcome', now: Date.now(), you: player.id, players: [...conns.values()].filter((o) => o.room === room).map((o) => o.player), recent, system: systemLines, spawn: [col, row], notice: notice && notice.until > Date.now() ? notice.a : undefined, ...(opts.gm?.(userId) ? { gm: true } : {}), ...(player.jailed ? { jailed: true } : {}) });
    conns.set(userId, c);
    others(c, { t: 'join', player });
    known.set(userId, { nickname: player.nickname, outfit: player.outfit, cls: player.cls, level: player.level });
    clearTimeout(away.get(userId));
    away.delete(userId);
    tellParty(userId); // back (or in another area): their new id and where they are
    friendArrived(userId, room, !!old);
    if (opts.privacy) send(c, { t: 'privacy', privacy: opts.privacy.get(userId) });
    // A Game Master's testing switches (and only a Game Master's: rights taken away, they no longer count).
    if (opts.testing) {
      const gm = !!opts.gm?.(userId);
      const testing = gm ? opts.testing.get(userId) : null;
      vitals?.setUnkillable(userId, !!testing?.unkillable);
      if (testing) send(c, { t: 'testing', testing });
    }
    if (H) {
      send(c, { t: 'halloween', view: H.view(room, Date.now(), (u) => conns.get(u)?.player.id), decorations: H.decorations(Date.now()) });
      if (H.carrier === userId) tellHalloween(); // (back: their dazed upper half shows behind them again)
    }
    if (opts.items?.expire) queueMicrotask(() => expireFor(c)); // (timed items that ran out while they were away)
    // A quest chain that starts here (the Palengke's first quest, at its level).
    const entered = opts.quests?.enter?.(userId, room);
    if (entered) send(c, { t: 'quests', active: entered.active });
    if (raceNow) send(c, { t: 'race', race: { ...raceNow, now: Date.now() } });
    if (vitals) tellVitals(c); // your HP and MP (the HUD), and your party's panel
    if (buffs) send(c, { t: 'buffs', buffs: buffs.view(userId, Date.now()) }); // the buffs on you (the tray)
    const run = runOf(room);
    if (run) {
      run.arrived.add(userId); // (back later: at the checkpoint)
      send(c, { t: 'warrens', run: run.view(Date.now(), userId, nameOf) });
    }
    const srun = silongOf(room);
    if (srun) send(c, { t: 'silong', run: srun.view(Date.now(), userId, nameOf) });

    ws.on('pong', () => (c.alive = true));
    ws.on('message', (data) => {
      let m: TownClientMessage;
      try {
        m = JSON.parse(String(data));
      } catch {
        return;
      }
      if (m && typeof m === 'object') handle(c, m);
    });
    ws.on('close', () => {
      if (conns.get(userId) !== c) return; // already replaced by a newer tab
      conns.delete(userId);
      arena.leave(userId); // mid-match, the other player wins
      leftTrades(userId); // a trade ends, nothing moved
      others(c, { t: 'leave', id: player.id });
      mobsOf(room)?.forget(player.id); // no mob goes after someone who left
      stepAway(userId);
    });
  };

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') return void (opts.shared || socket.destroy());
    const room = url.searchParams.get('room') ?? 'town';
    if (room !== 'town' && !opts.rooms?.[room] && !(room === 'warrens' && W) && !(floorOfArea(room) && SL)) return void socket.destroy();
    void (async () => {
      const userId = await opts.authenticate(req).catch(() => null);
      const profile = userId ? opts.profile(userId) : null;
      if (!userId || !profile) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        return;
      }
      if (opts.mayEnter && !(await opts.mayEnter(room, userId).catch(() => false))) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => join(ws, userId, profile, room));
    })();
  });

  const town: Town = {
    halloweenDev(userId, o) {
      if (!H) return 'no Halloween event here';
      const now = Date.now();
      const c = conns.get(userId);
      const at = c ? ([c.player.col, c.player.row] as [number, number]) : null;
      const said = H.dev({ ...o, member: userId, room: c?.room, at }, now);
      tellHalloween();
      return said;
    },
    rollLoot(userId, item) {
      const c = conns.get(userId);
      if (!c || !opts.items) return false;
      const L = lootIn(c.room);
      const at: [number, number] = [c.player.col, c.player.row];
      const fresh = L.add({ item }, mobsOf(c.room)?.lootSpots(at, 1, L.taken())[0] ?? at, withParty([userId], c.room), Date.now());
      showLoot(c.room, startRolls(c.room, L, [fresh], (l) => l.owners), at);
      return true;
    },
    fromDiscord(name, raw) {
      const tidied = tidy(raw.length > DISCORD_MAX ? `${[...raw].slice(0, DISCORD_MAX - 1).join('')}…` : raw, DISCORD_MAX);
      const text = tidied && opts.moderation ? opts.moderation.filter(tidied) : tidied;
      const who = tidy(name, 32);
      if (!text || !who) return;
      remember({ name: who, text, discord: true });
      everyone({ t: 'say-discord', name: who, text });
    },
    system: postSystem,
    kick(userId, until) {
      const c = conns.get(userId);
      if (!c) return false;
      conns.delete(userId);
      arena.leave(userId);
      leftTrades(userId);
      others(c, { t: 'leave', id: c.player.id });
      c.ws.close(KICKED, String(until));
      stepAway(userId);
      return true;
    },
    closeForMaintenance() {
      const M = opts.maintenance;
      if (!M?.on()) return 0;
      let n = 0;
      for (const [userId, c] of [...conns]) {
        if (M.allowed(userId)) continue;
        conns.delete(userId);
        arena.leave(userId);
        leftTrades(userId);
        others(c, { t: 'leave', id: c.player.id });
        c.ws.close(MAINTENANCE, M.note().slice(0, 120));
        stepAway(userId);
        n++;
      }
      return n;
    },
    areFriends(a, b) {
      return !!F?.areFriends(a, b);
    },
    memberOf(playerId) {
      for (const c of conns.values()) if (c.player.id === playerId) return c.userId;
      return null;
    },
    gifted(userId, from, amount) {
      const c = conns.get(userId);
      if (c) send(c, { t: 'gift', from, amount });
    },
    giftedItem(userId, from, item, quantity) {
      const c = conns.get(userId);
      if (c) send(c, { t: 'gift-item', from, item, quantity });
    },
    wallet(userId) {
      const c = conns.get(userId);
      if (c) send(c, { t: 'wallet' });
    },
    here() {
      return [...conns.keys()];
    },
    stay(userId, stay) {
      const c = conns.get(userId);
      if (c) send(c, { t: 'stay', stay });
    },
    newTitle(userId, id, title) {
      const c = conns.get(userId);
      if (c) send(c, { t: 'new-title', id, title });
    },
    serveDish(userId, dish) {
      if (!serve(userId, dish)) return;
      const c = conns.get(userId);
      if (c) send(c, { t: 'dish', ok: true, dish, free: true });
    },
    race(state) {
      raceNow = state;
      everyone({ t: 'race', race: state });
    },
    house(change, house, at) {
      const text = JSON.stringify({ t: 'house', change, house, ...at } satisfies TownServerMessage);
      for (const o of conns.values()) if (o.room === 'hood' && o.ws.readyState === WebSocket.OPEN) o.ws.send(text);
    },
    restyle(userId, outfit, title) {
      const c = conns.get(userId);
      if (!c) return;
      Object.assign(c.player, { outfit, title });
      everyone({ t: 'look', id: c.player.id, outfit, title });
      known.set(userId, { ...known.get(userId)!, outfit });
      tellParty(userId);
      tellFriends(userId);
    },
    renamed(userId, nickname) {
      const c = conns.get(userId);
      if (!c) return;
      c.player.nickname = nickname;
      everyone({ t: 'rename', id: c.player.id, nickname });
      known.set(userId, { ...known.get(userId)!, nickname });
      tellParty(userId);
      tellFriends(userId);
    },
    pet(userId, pet) {
      const c = conns.get(userId);
      if (!c) return;
      c.player.pet = pet;
      everyone({ t: 'pet', id: c.player.id, pet });
      refreshVitals(c); // its HP
    },
    inCombat(userId) {
      return !!vitals?.inCombat(userId, Date.now());
    },
    inPracticeRun(userId) {
      const run = W?.runOf(userId);
      return !!run?.practice && run.phase !== 'closed';
    },
    kit(userId, cls, weapon, weaponPlus = 0) {
      const c = conns.get(userId);
      if (!c) return;
      const changed = c.player.cls !== cls;
      Object.assign(c.player, { cls, weapon, weaponPlus });
      if (changed && buffs?.endStances(userId)) send(c, { t: 'buffs', buffs: buffs.view(userId, Date.now()) }); // (a class change ends its stance)
      everyone({ t: 'kit', id: c.player.id, cls, weapon, weaponPlus });
      known.set(userId, { ...known.get(userId)!, cls });
      tellParty(userId);
      tellFriends(userId);
      refreshVitals(c); // their gear's HP, MP and DEF
    },
    items(userId, got) {
      const c = conns.get(userId);
      if (c) tellItems(c, got);
    },
    mail(userId, unread, from, title) {
      const c = conns.get(userId);
      if (c) send(c, { t: 'mail', unread, ...(from ? { from } : {}), ...(title ? { title } : {}) });
    },
    progress(userId, progress, ups = 0, gained = 0) {
      const c = conns.get(userId);
      if (c) progressed(c, { progress, ups, gained });
    },
    setJailed(userId, on) {
      const c = conns.get(userId);
      if (!c || !!c.player.jailed === on) return;
      c.player.jailed = on || undefined;
      everyone({ t: 'jailed', id: c.player.id, on });
    },
    flexed(userId, item) {
      const c = conns.get(userId);
      if (c) everyone({ t: 'flex', id: c.player.id, itemId: item.id, itemName: item.name, rarity: item.rarity });
    },
    verdict(userId, kind, judged, text) {
      const c = conns.get(userId);
      if (c) everyone({ t: 'verdict', id: c.player.id, kind, judged, text });
    },
    announce(a) {
      if (a.kind === 'notice') notice = { a, until: Date.now() + NOTICE_MS };
      everyone({ t: 'announce', announcement: a });
    },
    warrensDev(userId, boss, hp) {
      if (!W) return { ok: false, message: 'No Warrens here.' };
      const now = Date.now();
      const r = W.runOf(userId) ?? (() => {
        const o = W.open(userId, nameOf(userId), 99, () => true, now);
        return o.ok ? o.run : null;
      })();
      if (!r) return { ok: false, message: 'Too many runs open.' };
      if (boss && !r.skipTo(boss, now, hp)) return { ok: false, message: `No boss ${boss}.` };
      saveRuns();
      return { ok: true, run: r.id };
    },
    silongDev(userId, floor, hp) {
      if (!SL) return { ok: false, message: 'No Cellar here.' };
      const now = Date.now();
      const r = SL.runOf(userId) ?? (() => {
        const o = SL.open(userId, nameOf(userId), 99, () => true, now);
        return o.ok ? o.run : null;
      })();
      if (!r) return { ok: false, message: 'Too many runs open.' };
      if (floor === 'plant') r.skipToPlant(hp);
      else if (floor) r.skipTo(floor);
      saveSilong();
      return { ok: true, run: r.id, floor: floor === 'plant' ? 'b3' : floor ?? 'b1' };
    },
  };

  // ── Lantern Posts ──

  /** Teleports on their way: who's going where (the map and its post; until when), so their arrival there is shown as one
   *  and lands by that post. */
  const trips = new Map<string, { to: string; post: number; until: number }>();
  /** A teleport from the post they're by to another (on another map, or on this one where it has several): checked
   *  (shared travel.ts), a Return Lantern used, everyone there sees them go, and their page loads that map. */
  const lanternMessage = (c: Conn, to: unknown, toPost?: unknown) => {
    if (!opts.lanterns) return;
    const now = Date.now();
    const refuse = (message: string) => send(c, { t: 'lantern-refused', message });
    if (now - (c.lanternAt ?? 0) < 1000) return refuse('Slow down a little.');
    c.lanternAt = now;
    const p = c.player;
    const toPosts = isLanternMap(to) && (to === 'town' || opts.rooms?.[to]) ? (mapOf(to).lanterns?.length ?? 0) : 0;
    const why = lanternRefusal({
      from: c.room,
      to,
      toPost,
      toPosts,
      posts: mapOf(c.room).lanterns ?? [],
      at: [p.col, p.row],
      inCombat: !!vitals?.inCombat(c.userId, now),
      out: !!p.out || !!vitals?.out(c.userId),
      lanterns: opts.lanterns.count(c.userId),
    });
    if (why || !isLanternMap(to)) return refuse(why ?? "There's no Lantern Post there.");
    if (!opts.lanterns.use(c.userId)) return refuse('You need a Return Lantern.');
    tellItems(c); // (one fewer)
    const post = typeof toPost === 'number' ? toPost : 0;
    trips.set(c.userId, { to, post, until: now + TRIP_MS });
    others(c, { t: 'lantern-fx', id: p.id, col: p.col, row: p.row, phase: 'out' });
    console.log(`[lantern] ${c.userId}: ${c.room} → ${to}${post ? ` (post ${post})` : ''}`);
    send(c, { t: 'lantern-go', to, ...(post ? { post } : {}) });
  };
  /** Arrived where they teleported to (their first 'here' there): everyone there sees them come. */
  const landed = (c: Conn) => {
    const trip = trips.get(c.userId);
    if (!trip) return;
    trips.delete(c.userId);
    if (trip.to === c.room && Date.now() < trip.until) others(c, { t: 'lantern-fx', id: c.player.id, col: c.player.col, row: c.player.row, phase: 'in' });
  };

  // ── The Scrap Warrens ──

  /** Their level as a fight sees it. */
  const levelOf = (c: Conn) => fighterOf(c).level ?? c.player.level ?? 1;
  /** The open runs to the bot (a restart refunds their openers' tickets). */
  const saveRuns = () => opts.warrens?.saved?.(W?.openRuns() ?? []);
  /** Who's inside a run now. */
  const insideOf = (run: Run): Inside[] =>
    [...conns.values()].filter((o) => o.room === run.room).map((o) => ({ member: o.userId, id: o.player.id, at: [o.player.col, o.player.row], out: !!o.player.out }));
  /** What a run's clock or a kill set off: to its room, to members, and out with those who must go. */
  const runNews = (run: Run, news: RunNews, ticketBack?: string) => {
    for (const msg of news.room) for (const o of conns.values()) if (o.room === run.room) send(o, msg);
    for (const [member, msg] of news.to) {
      const o = conns.get(member);
      if (o) send(o, msg);
    }
    for (const { member, reason } of news.out) {
      const o = conns.get(member);
      if (o && o.room === run.room) send(o, { t: 'warrens-out', reason, ...(member === ticketBack ? { ticketBack: run.practice ? ('practice' as const) : true } : {}) });
    }
  };
  /** A run that ended before any boss fell: its opener's ticket back (told: in their bag, and as they come out, or a
   *  line in their feed if they're elsewhere). The opener's member id if it went back. */
  const refundRun = (run: Run): string | undefined => {
    const member = run.opener.member;
    const back = !!(run.practice ? opts.warrens?.practice?.refund : opts.warrens?.tickets.refund)?.(member);
    console.log(`[warrens] ${run.practice ? 'practice ' : ''}run ${run.id} ended before a boss fell: ${back ? 'ticket back to' : 'NO ROOM for the ticket of'} ${member}`);
    const o = conns.get(member);
    if (o) {
      tellItems(o);
      if (o.room !== run.room) {
        const ticket = run.practice ? 'Practice Warren Ticket' : 'Warren Ticket';
        const text = back ? `Your ${ticket} is back: the run ended before a mini boss fell.` : `The run ended before a mini boss fell, but your bag had no room for your ${ticket}.`;
        send(o, { t: 'system', line: { kind: 'warrens', text, tone: back ? 'stir' : 'down' } });
      }
    }
    return back ? member : undefined;
  };
  /** The tracker to everyone inside, when it changed (the timer counts down on the page). */
  const runSeen = new Map<string, string>();
  const tellRun = (run: Run, now: number) => {
    const v = run.view(now);
    const seen = JSON.stringify([v.phase, v.bosses, v.opened, v.inside, v.waiting]);
    if (runSeen.get(run.id) === seen) return;
    runSeen.set(run.id, seen);
    for (const o of conns.values()) if (o.room === run.room) send(o, { t: 'warrens', run: run.view(now, o.userId, nameOf) });
  };
  /** The Warren Gate's panel and buttons, the run's Start now and Leave. */
  const warrensMessage = (c: Conn, m: Extract<TownClientMessage, { t: `warrens-${string}` }>) => {
    if (!W || !opts.warrens) return;
    const now = Date.now();
    const refuse = (reason: Extract<TownServerMessage, { t: 'warrens-refused' }>['reason'], message: string) => send(c, { t: 'warrens-refused', reason, message });
    const [gc, gr] = opts.warrens.gate;
    const atGate = opts.warrens.dev || (c.room === 'slums' && Math.max(Math.abs(c.player.col - gc), Math.abs(c.player.row - gr)) <= W.W.entry.warp.useRangeTiles + 2);
    const access = (member: string): WarrensAccess => opts.warrens?.access?.(member) ?? { done: true };
    /** Party members in the Slums who can't come into a real run yet (Aling Nena's quest not done). */
    const notReady = () => (parties.of(c.userId)?.members ?? []).filter((m) => m !== c.userId && conns.get(m)?.room === 'slums' && !access(m).done);
    switch (m.t) {
      case 'warrens-gate': {
        const a = access(c.userId);
        return send(c, { t: 'warrens-gate', gate: W.gate(c.userId, levelOf(c), opts.warrens.tickets.count(c.userId), { ...a, notReady: notReady().map(nameOf) }) });
      }
      case 'warrens-practice': {
        // A practice run (Aling Nena's quest): theirs alone, with a Practice Warren Ticket while the quest needs it.
        if (!atGate) return refuse('gone', 'Walk up to the Warren Gate first.');
        if (now - (c.warrensAt ?? 0) < 1000) return refuse('slow', 'Slow down a little.');
        c.warrensAt = now;
        if (!opts.warrens.practice || !access(c.userId).needs) return refuse('ticket', "There's nothing to practise for now.");
        const r = W.openPractice(c.userId, c.player.nickname, levelOf(c), () => opts.warrens!.practice!.use(c.userId), now);
        if (!r.ok) return refuse(r.reason, r.message);
        tellItems(c); // (the ticket's gone)
        saveRuns();
        console.log(`[warrens] ${c.userId} opened practice run ${r.run.id}`);
        return send(c, { t: 'warrens-go', run: r.run.id, ticket: true });
      }
      case 'warrens-open': {
        if (!atGate) return refuse('gone', 'Walk up to the Warren Gate first.');
        if (now - (c.warrensAt ?? 0) < 1000) return refuse('slow', 'Slow down a little.');
        c.warrensAt = now;
        const r = W.open(c.userId, c.player.nickname, levelOf(c), () => opts.warrens!.tickets.use(c.userId), now, access(c.userId));
        if (!r.ok) return refuse(r.reason, r.message);
        tellItems(c); // (the ticket's gone)
        saveRuns();
        console.log(`[warrens] ${c.userId} opened run ${r.run.id}${r.run.party ? ' for their party' : ''}`);
        // Their party: an invite for those in the Slums, a line for the rest (and those who can't come in yet).
        const waiting = new Set(notReady());
        for (const member of parties.of(c.userId)?.members ?? []) {
          const o = conns.get(member);
          if (!o || o === c) continue;
          if (waiting.has(member)) send(o, { t: 'system', line: { kind: 'warrens', text: `${c.player.nickname} opened the Scrap Warrens for your party, but you can't come in yet: help Aling Nena on the plaza first.`, tone: 'down' } });
          else if (o.room === 'slums') {
            const ms = W.W.entry.partyInviteSeconds * 1000;
            r.run.invite(member, now + ms); // (it waits for them till they answer)
            send(o, { t: 'warrens-invite', run: r.run.id, from: c.player.nickname, ms });
          }
          else send(o, { t: 'system', line: { kind: 'warrens', text: `${c.player.nickname} opened the Scrap Warrens for your party. Join at the Warren Gate in the Slums while it lasts.`, tone: 'stir' } });
        }
        return send(c, { t: 'warrens-go', run: r.run.id, ticket: true }); // (their ticket went: its sound)
      }
      case 'warrens-join': {
        const r = W.join(c.userId, levelOf(c), typeof m.run === 'string' ? m.run : undefined, access(c.userId));
        if (!r.ok) return refuse(r.reason, r.message);
        tellRun(r.run, now);
        return send(c, { t: 'warrens-go', run: r.run.id });
      }
      case 'warrens-decline':
        if (typeof m.run === 'string') W.get(m.run)?.answer(c.userId, false);
        return;
      case 'warrens-start':
        return void runOf(c.room)?.requestStart(c.userId); // (its clock starts it within a second)
      case 'warrens-leave':
        if (runOf(c.room)) send(c, { t: 'warrens-out', reason: 'left' });
        return;
    }
  };

  // The runs' clock: started, scaled, sent out, closed (its loot goes with it).
  if (W) {
    setInterval(() => {
      const now = Date.now();
      for (const { run, news } of W.tick(now, insideOf)) {
        // (A practice run's too: its Practice Warren Ticket.)
        runNews(run, news, news.closed && !run.ticketSpent ? refundRun(run) : undefined);
        if (news.closed) {
          loots.delete(run.room);
          runSeen.delete(run.id);
          saveRuns();
          console.log(`[warrens] run ${run.id} closed`);
        } else tellRun(run, now);
      }
    }, 1000).unref?.();
  }

  // ── Ang Silong ──

  const saveSilong = () => opts.silong?.saved?.(SL?.openRuns() ?? []);
  /** Whether a Sinigang or Lugaw is on them (no Chill). */
  const CHILL_PROOF = new Set(SL ? chillRules(SL.S).immune.map((d) => dishOf(DISHES, d)?.name).filter(Boolean) : []);
  const chillProof = (member: string) => !!buffs?.list(member).some((b) => b.cls === 'dish' && CHILL_PROOF.has(b.name));
  /** Who's inside a run now, on which floor. */
  const silongInside = (run: SilongRun): SilongInside[] =>
    [...conns.values()].flatMap((o) => {
      const f = run.floorOf(o.room);
      return f ? [{ member: o.userId, id: o.player.id, at: [o.player.col, o.player.row] as [number, number], out: !!o.player.out, floor: f.floor, immune: chillProof(o.userId) }] : [];
    });
  /** What a run's clock or a kill set off: to its floors' rooms, to members, out with those who must go, and down (or up)
   *  with the riders. */
  const silongNews = (run: SilongRun, n: SilongNews, keyBack?: string) => {
    for (const [room, msg] of n.room) for (const o of conns.values()) if (o.room === room) send(o, msg);
    for (const [member, msg] of n.to) {
      const o = conns.get(member);
      if (o) send(o, msg);
    }
    for (const { member, reason } of n.out) {
      const o = conns.get(member);
      if (o && run.floorOf(o.room)) send(o, { t: 'silong-out', reason, ...(member === keyBack ? { keyBack: run.practice ? ('practice' as const) : true } : {}) });
    }
    for (const { member, floor, ride } of n.go) {
      const o = conns.get(member);
      if (o) send(o, { t: 'silong-go', run: run.id, floor, ...(ride ? { ride } : {}) });
    }
  };
  /** A run that ended before a mini boss fell: its opener's key back. The opener's member id if it went back. */
  const refundSilong = (run: SilongRun): string | undefined => {
    const member = run.opener.member;
    const back = !!(run.practice ? opts.silong?.practice?.refund : opts.silong?.keys.refund)?.(member);
    console.log(`[silong] ${run.practice ? 'practice ' : ''}run ${run.id} ended before a mini boss fell: ${back ? 'key back to' : 'NO ROOM for the key of'} ${member}`);
    const o = conns.get(member);
    if (o) {
      tellItems(o);
      if (!run.floorOf(o.room)) {
        const key = run.practice ? 'Practice Cellar Key' : 'Cellar Key';
        send(o, { t: 'system', line: { kind: 'warrens', text: back ? `Your ${key} is back: the run ended before a mini boss fell.` : `The run ended before a mini boss fell, but your bag had no room for your ${key}.`, tone: back ? 'stir' : 'down' } });
      }
    }
    return back ? member : undefined;
  };
  /** The tracker to everyone inside, when it changed. */
  const silongSeen = new Map<string, string>();
  const tellSilong = (run: SilongRun, now: number) => {
    const v = run.view(now);
    const seen = JSON.stringify([v.phase, v.floors, v.door, v.inside]);
    if (silongSeen.get(run.id) === seen) return;
    silongSeen.set(run.id, seen);
    for (const o of conns.values()) if (run.floorOf(o.room)) send(o, { t: 'silong', run: run.view(now, o.userId, nameOf) });
  };
  /** The Silong Hatch's panel and buttons; Leave; the elevator's answers. */
  const silongMessage = (c: Conn, m: Extract<TownClientMessage, { t: `silong-${string}` }>) => {
    if (!SL || !opts.silong) return;
    const now = Date.now();
    const refuse = (reason: Extract<TownServerMessage, { t: 'silong-refused' }>['reason'], message: string) => send(c, { t: 'silong-refused', reason, message });
    const [gc, gr] = opts.silong.gate;
    const atGate = opts.silong.dev || (c.room === 'palengke' && Math.max(Math.abs(c.player.col - gc), Math.abs(c.player.row - gr)) <= SL.S.entry.warp.useRangeTiles + 2);
    const access = (member: string): SilongAccess => opts.silong?.access?.(member) ?? { done: true };
    switch (m.t) {
      case 'silong-gate':
        return send(c, { t: 'silong-gate', gate: SL.gate(c.userId, levelOf(c), opts.silong.keys.count(c.userId), access(c.userId)) });
      case 'silong-practice': {
        if (!atGate) return refuse('gone', 'Walk up to the Cellar Hatch first.');
        if (now - (c.silongAt ?? 0) < 1000) return refuse('slow', 'Slow down a little.');
        c.silongAt = now;
        if (!opts.silong.practice) return refuse('key', 'There are no practice runs.');
        const r = SL.openPractice(c.userId, c.player.nickname, levelOf(c), () => opts.silong!.practice!.use(c.userId), now);
        if (!r.ok) return refuse(r.reason, r.message);
        tellItems(c);
        saveSilong();
        console.log(`[silong] ${c.userId} opened practice run ${r.run.id}`);
        return send(c, { t: 'silong-go', run: r.run.id, floor: 'b1', key: true });
      }
      case 'silong-open': {
        if (!atGate) return refuse('gone', 'Walk up to the Cellar Hatch first.');
        if (now - (c.silongAt ?? 0) < 1000) return refuse('slow', 'Slow down a little.');
        c.silongAt = now;
        const r = SL.open(c.userId, c.player.nickname, levelOf(c), () => opts.silong!.keys.use(c.userId), now, access(c.userId));
        if (!r.ok) return refuse(r.reason, r.message);
        tellItems(c);
        saveSilong();
        console.log(`[silong] ${c.userId} opened run ${r.run.id}${r.run.party ? ' for their party' : ''}`);
        // Their party: an invite for those in the Palengke (partyInviteSeconds), a line for the rest.
        for (const member of parties.of(c.userId)?.members ?? []) {
          const o = conns.get(member);
          if (!o || o === c) continue;
          if (o.room === 'palengke') send(o, { t: 'silong-invite', run: r.run.id, from: c.player.nickname, ms: SL.S.entry.partyInviteSeconds * 1000 });
          else send(o, { t: 'system', line: { kind: 'warrens', text: `${c.player.nickname} opened the Cellar for your party. Join at the Cellar Hatch in the Market Hall while it lasts.`, tone: 'stir' } });
        }
        return send(c, { t: 'silong-go', run: r.run.id, floor: 'b1', key: true });
      }
      case 'silong-join': {
        if (!atGate && typeof m.run !== 'string') return refuse('gone', 'Walk up to the Cellar Hatch first.');
        const r = SL.join(c.userId, levelOf(c), typeof m.run === 'string' ? m.run : undefined, access(c.userId));
        if (!r.ok) return refuse(r.reason, r.message);
        return send(c, { t: 'silong-go', run: r.run.id, floor: 'b1' });
      }
      case 'silong-decline':
        return;
      case 'silong-leave':
        if (silongOf(c.room)) send(c, { t: 'silong-out', reason: 'left' });
        return;
      case 'silong-ride':
        return void silongOf(c.room)?.answerRide(c.userId, m.yes === true);
      case 'silong-up': {
        const run = silongOf(c.room);
        if (!run || typeof m.floor !== 'string') return;
        const why = run.rideUp(c.userId, m.floor);
        if (why) return refuse('floor', why);
        return send(c, { t: 'silong-go', run: run.id, floor: m.floor, ride: 'up' });
      }
      case 'silong-ramon': {
        // Mang Ramon's box on its floor (B2's R), from 2 tiles: his note, once.
        const box = silongFloor(c.room)?.map.silong.ramonBox;
        if (!box || !opts.silong.ramon) return;
        if (Math.max(Math.abs(c.player.col - box[0]), Math.abs(c.player.row - box[1])) > 2) return send(c, { t: 'silong-ramon', result: 'far' });
        const result = opts.silong.ramon.box(c.userId);
        if (result === 'given') {
          console.log(`[silong] ${c.userId} took Mang Ramon's note`);
          tellItems(c);
        }
        return send(c, { t: 'silong-ramon', result });
      }
    }
  };

  // The Silong runs' clock: scaled, elevators, sent out, closed (its loot goes with it).
  if (SL) {
    setInterval(() => {
      const now = Date.now();
      for (const { run, news: n } of SL.tick(now, silongInside)) {
        silongNews(run, n, n.closed && !run.keySpent ? refundSilong(run) : undefined);
        if (n.closed) {
          for (const f of SILONG_FLOORS) loots.delete(run.floors[f].room);
          silongSeen.delete(run.id);
          saveSilong();
          console.log(`[silong] run ${run.id} closed`);
        } else tellSilong(run, now);
      }
    }, 1000).unref?.();
  }

  // The mobs: each room's clock, every quarter second; their hops go to whoever is in that room. So do the golem's lines
  // (`system`, kind 'golem': its warning, rise and fall), which are only for that room: never kept for arrivals like
  // postSystem's, and never passed to the bot's Discord feed (that only hears town.system).
  if (opts.mobs || W) {
    setInterval(() => {
      const now = Date.now();
      for (const [room, mobs] of battleRooms()) {
        const here = [...conns.values()].filter((o) => o.room === room);
        // The knocked out are nobody's target.
        const up = here.filter((o) => !o.player.out);
        const where = new Map(up.map((o) => [o.player.id, [o.player.col, o.player.row] as [number, number]]));
        // (Their share of their HP left too: the Timbangan Sentinel's Weigh.)
        const guards = new Map(up.flatMap((o) => {
          const v = vitals?.get(o.userId);
          return o.guard ? [[o.player.id, { ...o.guard, ...(v ? { hpShare: v.hp / Math.max(1, v.max.hp) } : {}) }] as const] : [];
        }));
        const events: TownServerMessage[] = mobs.tick(now, where, guards, here.length);
        lootGone(room, loots.get(room)?.tick(now) ?? []); // loot that lay there too long
        // Burning puddles' ticks (their hits to the room, then what they killed and what that set off).
        const burn = mobs.burnTick(now);
        for (const t of burn.ticks) events.push({ t: 'mob-burn', by: t.by, hits: t.hits.map(({ slow: _s, ...h }) => h) });
        if (burn.kills.length) {
          events.push(...mobs.flush());
          killed(room, burn.kills);
        }
        // Skills' later hits (channels, hits on the move, windups) and damage over time (orange, as burns), then what
        // they killed; a windup's MP spent as it lands.
        const later = mobs.skillTick(now, where);
        for (const h of later.hits) events.push({ t: 'mob-hits', by: h.by, skill: h.skill, hits: h.hits });
        for (const d of later.dots) events.push({ t: 'mob-burn', by: d.by, hits: d.hits.map(({ slow: _s, ...x }) => x) });
        for (const sp of later.spent) {
          const o = conns.get(sp.member);
          if (o && vitals?.spend(sp.member, sp.mp)) tellVitals(o);
        }
        if (later.hits.length || later.dots.length) events.push(...mobs.flush());
        if (later.kills.length) killed(room, later.kills);
        if (!events.length) continue;
        // A boss move landing on someone dodging (a Step Back): shown as Dodge (it comes off nothing: the landings above).
        const dodging = new Set(here.filter((o) => (o.dodgeUntil ?? 0) > now).map((o) => o.player.id));
        if (dodging.size) for (const e of events) if (e.t === 'boss-hit') e.hits = e.hits.map((h) => (dodging.has(h.id) ? { id: h.id, damage: 0, miss: true, dodge: true } : h));
        const listeners = here.filter((o) => o.ws.readyState === WebSocket.OPEN);
        for (const e of events) {
          const text = JSON.stringify(e satisfies TownServerMessage);
          for (const o of listeners) o.ws.send(text);
        }
      }
    }, 250).unref?.();
  }

  // Mobs' hits landing (off HP; the Bag's slow, the Lamp Glare's blindness), HP and MP coming back, the knocked out
  // respawning: on a quicker clock than the mobs', so a hit lands about when the game shows it.
  if (vitals) {
    setInterval(() => {
      const now = Date.now();
      const touched = new Set<Conn>();
      for (const [room, mobs] of battleRooms()) {
        const landed = mobs.landed(now);
        if (!landed.length) continue;
        const byId = new Map([...conns.values()].filter((o) => o.room === room).map((o) => [o.player.id, o]));
        for (const l of landed) {
          const o = byId.get(l.player);
          if (!o || o.player.out) continue;
          // Dodged (a Step Back just before it landed): nothing, not even a slow, stun or blindness.
          if (l.at < (o.dodgeUntil ?? 0)) {
            vitals.fought(o.userId, now);
            continue;
          }
          if (l.blind) {
            vitals.blind(o.userId, l.blind, now);
            continue;
          }
          vitals.fought(o.userId, now);
          if (l.miss) continue;
          if (l.slow) vitals.slow(o.userId, l.slow, now, l.slowFactor);
          if (l.tear) vitals.tear(o.userId, l.tear, l.tearAccuracy ?? 0, now);
          if (l.stun) {
            o.stunnedUntil = now + l.stun;
            const stun: TownServerMessage = { t: 'stunned', id: o.player.id, ms: l.stun };
            send(o, stun);
            others(o, stun);
          }
          // Held on the Great Scale's pan (or let go: 0): no steps, attacks, moves or buffs meanwhile.
          if (l.hold !== undefined) {
            o.heldUntil = l.hold ? now + l.hold : 0;
            o.stunnedUntil = l.hold ? now + l.hold : now;
            const stun: TownServerMessage = { t: 'stunned', id: o.player.id, ms: l.hold };
            send(o, stun);
            others(o, stun);
          }
          // Kulang sa Timbang: their newest timed class buff off.
          if (l.strip && buffs?.stripNewest(o.userId)) buffsChanged(o);
          // The pan's squeeze: a share of their most HP.
          const squeeze = l.hpPct ? Math.round((vitals.get(o.userId)?.max.hp ?? 0) * l.hpPct) : 0;
          if (!l.damage && !squeeze) continue;
          const r = vitals.hurt(o.userId, l.damage + squeeze, now);
          if (!r) continue;
          touched.add(o);
          if (r === 'out') knockOut(o);
        }
      }
      // Buffs that ran out: off (the tray, the most HP).
      const ran = buffs?.tick(now) ?? [];
      if (ran.length) saveDishes();
      for (const user of ran) {
        const o = conns.get(user);
        if (o) buffsChanged(o);
      }
      const inBattle = [...conns.values()].filter((o) => battle(o.room));
      const { changed, respawned } = vitals.tick(now, inBattle.map((o) => o.userId));
      for (const user of changed) touched.add(conns.get(user)!);
      for (const user of respawned) {
        const o = conns.get(user)!;
        touched.delete(o);
        respawn(o);
      }
      for (const o of touched) tellVitals(o);
    }, VITALS_MS).unref?.();
  }

  // Loot rolls whose time is up: decided (the silent passed).
  setInterval(() => {
    for (const r of rolls.due(Date.now())) endRoll(r);
  }, 250).unref();

  // Party invites nobody answered in time: the inviter hears no. Friend requests that lapsed: gone from both lists.
  setInterval(() => {
    for (const i of parties.prune(Date.now())) {
      const from = conns.get(i.from);
      if (from) send(from, { t: 'party-declined', name: known.get(i.to)?.nickname ?? 'They' });
    }
    for (const r of F?.prune(Date.now()) ?? []) {
      tellFriendList(r.from);
      tellFriendList(r.to);
    }
  }, 5000).unref();

  // Trade requests nobody answered in time: the asker hears so, the asked one's pop-up closes.
  if (trades) {
    setInterval(() => {
      for (const a of trades.prune(Date.now())) {
        const from = conns.get(a.from);
        const to = conns.get(a.to);
        if (from) send(from, { t: 'trade-refused', reason: 'timeout', name: nameOf(a.to) });
        if (to) send(to, { t: 'trade-ask-gone', ask: a.id });
      }
    }, 1000).unref();
  }

  // The Halloween event's clock: its window, Mikko hiding, the rounds, a carrier gone too long (then the upper half flies
  // away: a line to them alone, if they're back). Its mob room's part is its director's (the Slums' clock).
  if (H) {
    setInterval(() => {
      const now = Date.now();
      const here = [...conns.values()].map((o) => ({ member: o.userId, map: o.room, at: [o.player.col, o.player.row] as [number, number] }));
      const r = H.tick(now, here);
      const carrier = H.carrier;
      if (carrier && !conns.has(carrier)) {
        carrierAwaySince ??= now;
        if (now - carrierAwaySince > CARRIER_AWAY_MS && H.carrierGone(carrier, now)) {
          r.changed = true;
          r.flew.push(carrier);
        }
      } else carrierAwaySince = null;
      for (const member of r.flew) {
        const o = conns.get(member);
        if (o) send(o, { t: 'manananggal-flew' });
      }
      if (r.changed) tellHalloween();
    }, 1000).unref();
  }
  // Timed items: once a minute, anything of anyone's here that ran out is taken out (and they're told).
  if (opts.items?.expire) setInterval(() => {
    for (const c of conns.values()) expireFor(c);
  }, 60_000).unref();

  // Drop connections that stopped answering pings (closed laptops, lost Wi-Fi). Those here: when they were last online.
  setInterval(() => {
    const now = Date.now();
    for (const c of conns.values()) {
      if (F && now - (F.seenAt(c.userId) ?? 0) >= SEEN_EVERY_MS) F.seen(c.userId, now);
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }, HEARTBEAT_MS).unref();
  return town;
}
