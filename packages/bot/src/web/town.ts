import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { Arena, type ArenaBets, type ArenaSeat, arenaLine } from './town-arena.js';
import type { LevelGain } from './progress.js';
import type { Attacker, MobKill, MobRoom } from './town-mobs.js';
import { PARTY_MAX, type PartyChange, Parties } from './town-party.js';
import { type VitalMax, Vitals, shown } from './town-vitals.js';
import { Buffs, type Nearby } from './town-buffs.js';
import { loadItemData, loadStats } from './stats-data.js';
import { type CombatItems, type LootContent, potionOf } from './combat-bag.js';
import { type Loot, LootRoom, splitKusing } from './town-loot.js';
import { type HeldOffer, type Trade, Trades, checkOffer } from './trade.js';
import type { ChatItemLink, CharacterProgress, QuestProgress, HoodHouse, HoodMap, OutfitData, PartyState, Target, TownRace, TitleData, TownAnnouncement, TownChatLine, TownClientMessage, TownDir, TownEmote, TownMove, TownPlayer, TownServerMessage, TownStayInfo, TownSystemLine, TownItems, Item, TradeEnd, TradeView } from '@mikazuki/shared';
import { itemName, itemStats, skillMpCost, targetPriority, tradeRules } from '@mikazuki/shared';

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

const DIRS = new Set<TownDir>(['s', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw']);
const MOVES = new Set<TownMove>(['dash', 'step-back', 'charge', 'blink']);
const EMOTES = new Set<TownEmote>(['heart', 'laugh', 'exclaim', 'question', 'kowen', 'sleep', 'angry', 'wave']);
/** Emotes: a burst of 3, then one a second. */
const EMOTES_PER_SECOND = 1;
const EMOTE_BURST = 3;
/** Walking is 4 tiles a second; allow a little more, in bursts (messages bunch up on a bad connection). Slowed: half. */
const STEPS_PER_SECOND = 6;
const STEP_BURST = 6;
const SLOWED = 0.5;
/** Mobs' hits land, HP and MP come back and the knocked out respawn on this clock (ms). */
const VITALS_MS = 100;
const HEARTBEAT_MS = 30_000;
/** Arrivals spread over the free tiles this far (in tiles, each way) around the map's spawn point. */
const SPAWN_SPREAD = 3;
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

/** A chat message tidied up: no control characters, single spaces, trimmed; null if empty or too long. */
function tidy(text: unknown, max = SAY_MAX): string | null {
  if (typeof text !== 'string') return null;
  const t = text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return t && [...t].length <= max ? t : null;
}

export interface TownMap {
  size: [number, number]; // [cols, rows]
  spawn: [number, number]; // [col, row]
  blocked: number[][]; // [row][col], 1 = blocked
  /** Tiles nobody arrives on (the gates to other areas: stepping on one there would take you straight back). */
  avoid?: [number, number][];
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
  quests?: { kill(userId: string, kill: { kind: string; mini: boolean }): { active: QuestProgress[] } | null };
  /** Characters' levels (web/adventure.ts in the bot; in memory on the game's dev server, web/progress.ts either way):
   *  who someone is in a fight, and a kill's XP for them (saved; the level-ups it brought). Without it everyone fights as
   *  their class at Lv 1 and gains nothing. */
  progress?: {
    fighter(userId: string): Attacker;
    kill(userId: string, mob: { level: number; xp: number }): LevelGain;
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
  };
  /** Rolls drops (Math.random if left out; the game's dev server can make loot rich to try it). */
  lootRandom?: () => number;
  /** Rolls dropped gear's plus (lootRandom if left out). */
  lootPlusRandom?: () => number;
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
  /** Uses one of a member's megaphones (`/m` in the chat): how many are left, or null if they have none. Without it
   *  (the game's dev server) megaphones are free. */
  megaphone?: (userId: string) => number | null;
  /** What to start with after a restart, and where to keep it (web/town-memory.ts in the bot): the last chat lines and
   *  the system feed's. Without it they live in memory only. */
  memory?: { chat: TownChatLine[]; system: TownSystemLine[]; save(chat: TownChatLine[], system: TownSystemLine[]): void };
  /** Chat moderation (web/town-mod.ts in the bot; none in the game's dev server). */
  moderation?: {
    mutedUntil(userId: string): number | null;
    kickedUntil(userId: string): number | null;
    filter(text: string): string;
  };
}

/** Close code for a moderator's kick (the reason is when they may come back, in ms). */
export const KICKED = 4001;

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
  /** Tells a member, if they're in town, where their stay reward is (a Kowen ready to claim). */
  stay(userId: string, stay: TownStayInfo): void;
  /** A member was jailed or released: everyone in town sees it under their name (them included). */
  setJailed(userId: string, on: boolean): void;
  /** A member has a new title: the reward pop-up, if they're in town. */
  newTitle(userId: string, id: string, title: TitleData): void;
  /** A member changed their look or title at the Parlor: everyone in town sees it (them included). */
  restyle(userId: string, outfit: OutfitData, title: TitleData): void;
  /** A member changed their nickname (a Rename Card): everyone in town sees the new name (them included). */
  renamed(userId: string, nickname: string): void;
  /** A member chose a class or changed their weapon (or its +: the aura): everyone in town sees it (the resting weapon,
   *  the chat's badge). */
  kit(userId: string, cls: string | null, weapon: string | null, weaponPlus?: number): void;
  /** A member's worn items, combat bag or Kusing changed outside the town (the shop, dev's ?give=): theirs to them. */
  items(userId: string, got?: { kusing?: number; item?: Item }): void;
  /** A member's level, XP or points changed outside a fight (points refunded, dev's ?xp=): theirs to them, and with
   *  `ups` levels gained "Level up!" over them for their room. */
  progress(userId: string, progress: CharacterProgress, ups?: number, gained?: number): void;
  /** A house built, given a new look, or its Bakod up or down: everyone in the neighbourhood sees it at once (it rises,
   *  puffs into its new look, or its fence goes up or comes down). */
  /** The Mosang race (games/race.ts) changed: to everyone in town and the neighbourhood, and to arrivals while it's on. */
  race(state: TownRace | null): void;
  house(change: 'built' | 'look' | 'fence', house: HoodHouse, at: { col: number; row: number; door: [number, number]; fence: HoodMap['fence'] }): void;
  /** A member (if in town) flexed an item from their bag: to everyone, them included (chat line + bubble). */
  flexed(userId: string, item: { id: string; name: string; rarity: string }): void;
  /** A member (if in town) says a diss, praise or judge line: to everyone, the speaker included. */
  verdict(userId: string, kind: 'roast' | 'praise', judged: boolean, text: string): void;
}

/** The game's map (packages/game/public/assets/maps/town.json), from the monorepo next to the bot. */
/** A map from the game's assets (maps/<name>.json: the town, the Slums), as far as the server needs it. (Raised ground
 *  isn't checked here, like fences: the game keeps to its ramps.) */
export function loadTownMap(name = 'town'): TownMap {
  const json = JSON.parse(readFileSync(new URL(`../../../game/public/assets/maps/${name}.json`, import.meta.url), 'utf8')) as TownMap & { gates?: Record<string, [number, number][]> };
  return { size: json.size, spawn: json.spawn, blocked: json.blocked, avoid: Object.values(json.gates ?? {}).flat() };
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
  /** The last trade request sent (ms). */
  askedAt?: number;
  /** When they last dropped an item on the ground. */
  droppedAt?: number;
  /** When they last looked at someone's gear (the player menu's Info). */
  inspectAt?: number;
  /** When they last asked for someone's buffs (the player box). */
  buffsOfAt?: number;
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
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
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
    if (!parties.of(user)) return;
    tellParty(user);
    clearTimeout(away.get(user));
    away.set(user, setTimeout(() => {
      away.delete(user);
      if (!conns.has(user)) partyChanged(parties.leave(user));
    }, PARTY_AWAY_MS));
  };
  const mapOf = (room: string): TownMap => (room === 'town' ? map : opts.rooms?.[room]?.() ?? map);

  // HP and MP: only where there are mobs (their rules come from a mob room: class, level, points, worn gear).
  const rules = Object.values(opts.mobs ?? {})[0];
  const STATS = loadStats();
  const vitals = rules ? new Vitals(STATS.regen) : null;
  const battle = (room: string) => !!opts.mobs?.[room];
  // Buffs (town-buffs.ts): cast on battle maps, kept by member in memory, put on in every fight and in their most HP.
  const buffs = vitals ? new Buffs(STATS) : null;
  /** Who they are in a fight: class, level, points, everything worn, skill levels (the class and weapon alone without
   *  saved levels), and the buffs on them. */
  const fighterOf = (c: Conn): Attacker => ({ ...(opts.progress?.fighter(c.userId) ?? { cls: c.player.cls, gear: [c.player.weapon] }), ...(buffs ? { buffs: buffs.effective(c.userId) } : {}) });
  /** Their most HP and MP, a regen buff's share (and their DEF, DEF rate and level, for mobs' hits). */
  const maxOf = (c: Conn): VitalMax => {
    const d = rules!.fighter(fighterOf(c));
    c.guard = { def: d.def, level: d.level, defRate: d.defRate, priority: targetPriority(STATS, c.player.cls) };
    return { hp: d.hp, mp: d.mp, mpRegen: d.mpRegen, hpRegenPct: d.hpRegenPct ?? 0 };
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
  /** 0 HP: faded out for everyone there, no mob after them, nothing more lands on them. */
  const knockOut = (c: Conn) => {
    c.player.out = true;
    c.player.sit = false;
    if (buffs?.endTimed(c.userId)) buffsChanged(c); // (a stance stays)
    opts.mobs?.[c.room]?.forget(c.player.id, true);
    endTrade(c.userId, 'out', { name: c.player.nickname }); // no trading while knocked out
    const m: TownServerMessage = { t: 'knocked-out', id: c.player.id };
    send(c, { ...m, reviveIn: vitals?.outFor(c.userId, Date.now()) ?? 0 });
    others(c, m);
  };
  /** Back after being knocked out: at the room's way in (where arrivals land), full, seen by everyone there. */
  const respawn = (c: Conn) => {
    const [col, row] = arrival(c.room);
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
  const progressed = (c: Conn, g: Pick<LevelGain, 'progress' | 'ups' | 'gained'>) => {
    c.player.level = g.progress.level;
    refreshVitals(c, g.ups > 0); // a level up fills HP and MP; points change the most
    send(c, { t: 'progress', progress: g.progress, ...(g.gained ? { gained: g.gained } : {}) });
    if (g.ups > 0) {
      const up: TownServerMessage = { t: 'level-up', id: c.player.id, level: g.progress.level };
      others(c, up);
      send(c, up);
      const k = known.get(c.userId);
      if (k) k.level = g.progress.level;
      tellParty(c.userId); // (the party panel shows levels)
    }
  };

  // Loot on the ground, by battle room (only with somewhere to keep what's picked up).
  const items = loadItemData();
  const loots = new Map<string, LootRoom>(opts.items ? Object.keys(opts.mobs ?? {}).map((room) => [room, new LootRoom(items, opts.lootRandom, undefined, opts.lootPlusRandom)]) : []);
  /** A room's loot, made when something is first dropped there (a player's item off a map without mobs). */
  const lootIn = (room: string): LootRoom => {
    let L = loots.get(room);
    if (!L) loots.set(room, (L = new LootRoom(items, opts.lootRandom, undefined, opts.lootPlusRandom)));
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
      for (const [room, L] of loots) if (!opts.mobs?.[room]) lootGone(room, L.tick(Date.now()));
    }, 1000).unref?.();
  }
  /** HP and MP Potions' shared cooldown (ms), and when each member's is over. */
  const POTION_MS = itemStats(items.stats).potions.sharedCooldownSec * 1000;
  const potionReady = new Map<string, number>();
  /** Their worn items, combat bag and Kusing to them (`got`: what they just picked up). */
  const tellItems = (c: Conn, got?: { kusing?: number; item?: Item }) => {
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
  /** What a hit (or a burn's tick) killed: its XP for whoever earns it (the killer; the golem's for every member who did
   *  enough, even after a reload mid-fight; a mini boss: everyone who did their share and their party nearby), if still
   *  here, its loot, and quest credit for them and their party nearby. */
  const killed = (room: string, kills: MobKill[]) => {
    for (const k of kills) {
      const credited = k.mini ? withParty(k.to, room) : k.to;
      for (const user of credited) {
        const o = conns.get(user);
        if (o && opts.progress) progressed(o, opts.progress.kill(o.userId, k));
      }
      dropFor(room, { ...k, to: credited });
      questKill(withParty(credited, room), { kind: k.kind, mini: !!k.mini, level: k.level });
    }
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
      if (!opts.quests) {
        send(o, { t: 'quest-kill', kind: kill.kind, mini: kill.mini, level: kill.level });
        continue;
      }
      const r = opts.quests.kill(user, { kind: kill.kind, mini: kill.mini });
      if (!r) continue;
      send(o, { t: 'quests', active: r.active });
    }
  };
  /** A kill's drops, round where it died: the killer's (and their party's, those in the room), or the golem's or a mini
   *  boss's for each player who earned it (their own). */
  const dropFor = (room: string, kill: { kind: string; level: number; at: [number, number]; to: string[]; boss?: boolean; mini?: string }) => {
    const L = loots.get(room);
    const mobs = opts.mobs?.[room];
    if (!L || !mobs || !kill.to.length) return;
    const party = kill.boss || kill.mini ? [] : (parties.of(kill.to[0])?.members ?? []).filter((m) => conns.get(m)?.room === room);
    const fresh = L.drop(kill, party, (at, n) => mobs.lootSpots(at, n, L.taken()), Date.now()); // (beside loot already there, not on it)
    showLoot(room, fresh, kill.at);
  };
  /** Picks up the loot asked for (`id`) or, without one, the nearest they may take, within LOOT_REACH (a click, F or
   *  Space; nothing is picked up on its own). Full bag: it stays, and they're told. */
  const pickUp = (c: Conn, id?: string) => {
    const L = loots.get(c.room);
    if (!L || !opts.items || c.player.out) return;
    const l = L.pickable(c.userId, c.player.col, c.player.row, Date.now(), id);
    if (!l) return;
    // Kusing in a party (not personal loot): split equally between the party members in this room, the picker first.
    if ('kusing' in l.content && !l.personal) {
      const shares = splitKusing(l.content.kusing, withParty([c.userId], c.room));
      if (shares.size > 1) {
        L.remove(l.id);
        for (const [user, kusing] of shares) {
          const o = conns.get(user);
          if (o && opts.items.take(user, { kusing })) tellItems(o, { kusing });
        }
        partyLoot(c, { kusing: l.content.kusing }, Math.min(...shares.values()));
        return lootGone(c.room, [l.id]);
      }
    }
    if (!opts.items.take(c.userId, l.content)) return send(c, { t: 'loot-full' });
    L.remove(l.id);
    const got = 'kusing' in l.content ? { kusing: l.content.kusing } : { item: l.content.item };
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
  const partyLoot = (c: Conn, got: { kusing?: number; item?: Item }, share?: number) => {
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
    const k = vitals?.slowed(c.userId, now) ? SLOWED : 1;
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
        return tradeRange(c);
      case 'step': {
        const dc = (m.col as number) - p.col;
        const dr = (m.row as number) - p.row;
        const ok = inside_(m.col, m.row) && walkable_(m.col, m.row) && Math.abs(dc) <= 1 && Math.abs(dr) <= 1 && (dc || dr) && spend(c);
        if (!ok) return send(c, { t: 'snap', col: p.col, row: p.row });
        Object.assign(p, { col: m.col, row: m.row, dir: dirForStep(dc, dr), sit: false });
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
        // where they are, one at a time; only their class's moves, from their unlock level.
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
        return others(c, { t: 'move', id: p.id, move: m.move, col: m.col, row: m.row });
      }
      case 'attack': {
        // A damage skill on a mob (battle maps only): the mob room decides; everyone there sees the hit.
        const mobs = opts.mobs?.[c.room];
        if (!mobs || typeof m.mob !== 'string' || !Number.isInteger(m.skill)) return;
        // Their class, level, points, everything worn and skill levels; blinded, every hit misses.
        const now = Date.now();
        const who = { ...fighterOf(c), blinded: !!vitals?.blinded(c.userId, now) };
        // Its MP (stats.json skills.mpCost at its skill level), spent once the mob room takes the hit.
        const mp = skillMpCost(STATS, who.cls, String(m.skill), who.skills?.[m.skill as number] ?? 1);
        if (vitals && !vitals.hasMp(c.userId, mp)) return send(c, { t: 'attack-refused', reason: 'mp' });
        const r = mobs.attack(p.id, [p.col, p.row], who, m.mob, now, m.skill as number, p.nickname, c.userId);
        if (!r.ok) return send(c, { t: 'attack-refused', reason: r.reason });
        if (mp > 0 && vitals?.spend(c.userId, mp)) tellVitals(c);
        vitals?.fought(c.userId, now); // in combat: no HP back for a while
        // The hit, then what it set off (the golem calling the Junk, enraging, falling: its line too, to this room only).
        for (const e of [{ t: 'mob-hit', by: p.id, skill: m.skill as number, hits: r.hits } satisfies TownServerMessage, ...mobs.flush()]) {
          others(c, e);
          send(c, e);
        }
        killed(c.room, r.kills);
        return;
      }
      case 'buff': {
        // A buff (town-buffs.ts decides): its MP spent, everyone in the room sees the cast; who it reached gets it (their
        // tray, HP's most), or a heal (Soothing Touch) for the caster's Power × its share, green numbers for the room.
        if (!buffs || !vitals || typeof m.buff !== 'string') return;
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
        const r = buffs.cast({ member: c.userId, cls: who.cls, level: who.level ?? p.level ?? 1, skillLevel: who.buffLevels?.[m.buff] ?? 1, out: !!p.out, battle: battle(c.room), mp: v ? v.mp : 0, at: [p.col, p.row] }, m.buff, party, target, now);
        if (!r.ok) return send(c, { t: 'buff-refused', buff: m.buff, reason: r.reason, ...(r.ms ? { ms: r.ms } : {}) });
        if (r.mp > 0) vitals.spend(c.userId, r.mp);
        const cast: TownServerMessage = { t: 'buff-cast', id: p.id, buff: m.buff, dir: p.dir, ...(r.off ? { off: true } : {}) };
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
        const mobs = opts.mobs?.[c.room];
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
        // An HP or MP Potion from their bag: battle maps only, one shared cooldown, never when it'd do nothing.
        if (typeof m.item !== 'string' || !opts.items) return;
        const kind = potionOf(items, m.item);
        if (!kind) return;
        const now = Date.now();
        if (!vitals?.get(c.userId) || !battle(c.room)) return send(c, { t: 'potion-refused', reason: 'here' });
        const ready = potionReady.get(c.userId) ?? 0;
        if (now < ready) return send(c, { t: 'potion-refused', reason: 'cooldown', ms: ready - now });
        if (vitals.full(c.userId, kind.heals)) return send(c, { t: 'potion-refused', reason: 'full' });
        const used = opts.items.usePotion(c.userId, m.item);
        if (!used) return send(c, { t: 'potion-refused', reason: 'none' });
        const healed = vitals.heal(c.userId, used.heals, used.amount);
        potionReady.set(c.userId, now + POTION_MS);
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
      case 'party-leave':
        return partyChanged(parties.leave(c.userId));
      case 'party-disband': {
        const r = parties.disband(c.userId);
        return r.ok ? partyChanged(r.change) : send(c, { t: 'party-refused', reason: r.reason });
      }
      case 'party-kick': {
        const r = typeof m.member === 'string' ? parties.kick(c.userId, m.member) : null;
        if (!r) return;
        return r.ok ? partyChanged(r.change) : send(c, { t: 'party-refused', reason: r.reason });
      }
      case 'buffs-of': {
        // The buffs on someone (the player box's icons, asked every couple of seconds while it's open).
        const now = Date.now();
        if (now - (c.buffsOfAt ?? 0) < 400 || typeof m.id !== 'string') return;
        c.buffsOfAt = now;
        const of = town.memberOf(m.id);
        return send(c, { t: 'buffs-of', id: m.id, buffs: of && buffs ? buffs.view(of, now) : [] });
      }
      case 'inspect': {
        // Someone's worn gear and stats (the player menu's Info): anyone in town, a few a second at most.
        const now = Date.now();
        if (now - (c.inspectAt ?? 0) < 250 || typeof m.id !== 'string') return;
        c.inspectAt = now;
        const to = town.memberOf(m.id);
        const them = to ? conns.get(to) : undefined;
        if (!them) return send(c, { t: 'inspect', id: m.id, gone: true });
        const equipped = opts.items ? opts.items.state(them.userId).equipped : {};
        const d = rules?.fighter(fighterOf(them));
        const stats = d ? { power: d.power, def: d.def, hp: d.hp, mp: d.mp, STR: d.STR, DEX: d.DEX, INT: d.INT, critRate: d.critRate } : null;
        return send(c, { t: 'inspect', id: m.id, cls: them.player.cls ?? null, level: d?.level ?? them.player.level ?? 1, equipped, stats });
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
        const muted = opts.moderation?.mutedUntil(c.userId);
        if (muted) return send(c, { t: 'say-refused', reason: 'muted', until: muted });
        const tidied = tidy(m.text);
        if (!tidied) return send(c, { t: 'say-refused', reason: 'invalid' });
        const text = opts.moderation ? opts.moderation.filter(tidied) : tidied;
        const now = Date.now();
        c.says = Math.min(SAY_BURST, c.says + ((now - c.saidAt) / 1000) * SAYS_PER_SECOND);
        c.saidAt = now;
        if (c.says < 1) return send(c, { t: 'say-refused', reason: 'slow' });
        // Items shown in it: theirs (worn or in the combat bag), each written in the text as "[its name]".
        const links = itemLinks(c, m.links, text);
        // To the party only: its members, wherever they are (not kept, not to Discord).
        if (m.party === true) {
          const party = parties.of(c.userId);
          if (!party) return send(c, { t: 'say-refused', reason: 'party' });
          c.says -= 1;
          for (const member of party.members) {
            const o = conns.get(member);
            if (o) send(o, { t: 'party-say', id: p.id, name: p.nickname, text, ...(links.length ? { links } : {}) });
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
        const loud = { ...(megaphone ? { megaphone } : {}), ...(gm ? { gm } : {}) };
        remember({ name: p.nickname, text, ...loud, ...(links.length ? { links } : {}) });
        opts.onSay?.(c.userId, p.nickname, text, megaphone, gm);
        return everyone({ t: 'say', id: p.id, name: p.nickname, text, ...loud, ...(links.length ? { links } : {}) });
      }
    }
  };

  /** A walkable tile near the room's spawn point that nobody's standing on (any walkable one if they're all taken). */
  const arrival = (room: string): [number, number] => {
    const m = mapOf(room);
    const [sc, sr] = m.spawn;
    const taken = new Set([...conns.values()].filter((o) => o.room === room).map((o) => `${o.player.col},${o.player.row}`));
    const avoid = new Set((m.avoid ?? []).map(([c, r]) => `${c},${r}`));
    const free: [number, number][] = [];
    const open: [number, number][] = [];
    for (let r = sr - SPAWN_SPREAD; r <= sr + SPAWN_SPREAD; r++) {
      for (let c = sc - SPAWN_SPREAD; c <= sc + SPAWN_SPREAD; c++) {
        if (!inside(m, c, r) || !walkable(m, c, r) || avoid.has(`${c},${r}`)) continue;
        open.push([c, r]);
        if (!taken.has(`${c},${r}`)) free.push([c, r]);
      }
    }
    const pool = free.length ? free : open.length ? open : [m.spawn];
    return pool[Math.floor(Math.random() * pool.length)];
  };

  const join = (ws: WebSocket, userId: string, profile: TownProfile, room: string) => {
    // Kicked by a moderator: told when they may come back, and closed.
    const kicked = opts.moderation?.kickedUntil(userId);
    if (kicked) return ws.close(KICKED, String(kicked));
    // A second tab takes over: the first one is told and closed.
    const old = conns.get(userId);
    if (old) {
      conns.delete(userId);
      arena.leave(userId);
      leftTrades(userId);
      others(old, { t: 'leave', id: old.player.id });
      old.ws.close(4000, 'opened elsewhere');
    }
    const [col, row] = arrival(room);
    const player: TownPlayer = { id: randomBytes(6).toString('hex'), ...profile, col, row, dir: 's', sit: false };
    const c: Conn = { ws, userId, room, player, tokens: STEP_BURST, refilled: Date.now(), says: SAY_BURST, saidAt: Date.now(), emotes: EMOTE_BURST, emotedAt: Date.now(), alive: true, fresh: true };
    // Off a battle map, timed buffs are over (a stance stays on; a reload on the same battle map keeps them).
    if (!battle(room)) buffs?.endTimed(userId);
    // HP and MP: full in a safe room; in a battle map as they were (a reload), full if new there or knocked out.
    if (vitals) {
      const { hp, maxHp } = shown(vitals.arrive(userId, maxOf(c), battle(room), Date.now()));
      Object.assign(player, { hp, maxHp });
    }
    const mobRoom = opts.mobs?.[room];
    queueMicrotask(() => {
      // After the welcome: the mobs, and the loot they can see.
      if (mobRoom) send(c, { t: 'mobs', mobs: mobRoom.snapshot(Date.now()), golem: mobRoom.golemState(Date.now()) });
      const loot = loots.get(room);
      if (loot) send(c, { t: 'loot', loot: loot.viewAll(userId, Date.now()) });
    });
    send(c, { t: 'welcome', you: player.id, players: [...conns.values()].filter((o) => o.room === room).map((o) => o.player), recent, system: systemLines, spawn: [col, row], notice: notice && notice.until > Date.now() ? notice.a : undefined, ...(opts.gm?.(userId) ? { gm: true } : {}) });
    conns.set(userId, c);
    others(c, { t: 'join', player });
    known.set(userId, { nickname: player.nickname, outfit: player.outfit, cls: player.cls, level: player.level });
    clearTimeout(away.get(userId));
    away.delete(userId);
    tellParty(userId); // back (or in another area): their new id and where they are
    if (raceNow) send(c, { t: 'race', race: { ...raceNow, now: Date.now() } });
    if (vitals) tellVitals(c); // your HP and MP (the HUD), and your party's panel
    if (buffs) send(c, { t: 'buffs', buffs: buffs.view(userId, Date.now()) }); // the buffs on you (the tray)

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
      opts.mobs?.[room]?.forget(player.id); // no mob goes after someone who left
      stepAway(userId);
    });
  };

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') return void (opts.shared || socket.destroy());
    const room = url.searchParams.get('room') ?? 'town';
    if (room !== 'town' && !opts.rooms?.[room]) return void socket.destroy();
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
    },
    renamed(userId, nickname) {
      const c = conns.get(userId);
      if (!c) return;
      c.player.nickname = nickname;
      everyone({ t: 'rename', id: c.player.id, nickname });
      known.set(userId, { ...known.get(userId)!, nickname });
      tellParty(userId);
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
      refreshVitals(c); // their gear's HP, MP and DEF
    },
    items(userId, got) {
      const c = conns.get(userId);
      if (c) tellItems(c, got);
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
  };

  // The mobs: each room's clock, every quarter second; their hops go to whoever is in that room. So do the golem's lines
  // (`system`, kind 'golem': its warning, rise and fall), which are only for that room: never kept for arrivals like
  // postSystem's, and never passed to the bot's Discord feed (that only hears town.system).
  if (opts.mobs) {
    setInterval(() => {
      const now = Date.now();
      for (const [room, mobs] of Object.entries(opts.mobs ?? {})) {
        const here = [...conns.values()].filter((o) => o.room === room);
        // The knocked out are nobody's target.
        const up = here.filter((o) => !o.player.out);
        const where = new Map(up.map((o) => [o.player.id, [o.player.col, o.player.row] as [number, number]]));
        const guards = new Map(up.flatMap((o) => (o.guard ? [[o.player.id, o.guard] as const] : [])));
        const events: TownServerMessage[] = mobs.tick(now, where, guards, here.length);
        lootGone(room, loots.get(room)?.tick(now) ?? []); // loot that lay there too long
        // Burning puddles' ticks (their hits to the room, then what they killed and what that set off).
        const burn = mobs.burnTick(now);
        for (const t of burn.ticks) events.push({ t: 'mob-burn', by: t.by, hits: t.hits.map(({ slow: _s, ...h }) => h) });
        if (burn.kills.length) {
          events.push(...mobs.flush());
          killed(room, burn.kills);
        }
        if (!events.length) continue;
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
      for (const [room, mobs] of Object.entries(opts.mobs ?? {})) {
        const landed = mobs.landed(now);
        if (!landed.length) continue;
        const byId = new Map([...conns.values()].filter((o) => o.room === room).map((o) => [o.player.id, o]));
        for (const l of landed) {
          const o = byId.get(l.player);
          if (!o || o.player.out) continue;
          if (l.blind) {
            vitals.blind(o.userId, l.blind, now);
            continue;
          }
          vitals.fought(o.userId, now);
          if (l.miss) continue;
          if (l.slow) vitals.slow(o.userId, l.slow, now);
          const r = vitals.hurt(o.userId, l.damage, now);
          if (!r) continue;
          touched.add(o);
          if (r === 'out') knockOut(o);
        }
      }
      // Buffs that ran out: off (the tray, the most HP).
      for (const user of buffs?.tick(now) ?? []) {
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

  // Party invites nobody answered in time: the inviter hears no.
  setInterval(() => {
    for (const i of parties.prune(Date.now())) {
      const from = conns.get(i.from);
      if (from) send(from, { t: 'party-declined', name: known.get(i.to)?.nickname ?? 'They' });
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

  // Drop connections that stopped answering pings (closed laptops, lost Wi-Fi).
  setInterval(() => {
    for (const c of conns.values()) {
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
