// The town's live connection (WebSocket at /ws, logged-in members only): who else is in town and where.
// JSON messages, one per frame. Players are identified by a random id per connection, never their Discord ID.
// A moderator's kick closes the socket with code 4001 and the time (ms) they may come back as the reason.

import type { CharacterProgress } from './adventure.js';
import type { HoodHouse, HoodMap, OutfitData, TitleData } from './room-api.js';

export type TownDir = 's' | 'se' | 'e' | 'ne' | 'n' | 'nw' | 'w' | 'sw';

/** The four ways a mob's art faces (SE = +col, SW = +row, NW = −col, NE = −row on the grid). */
export type TownMobFacing = 'se' | 'sw' | 'ne' | 'nw';

/** A mob as the server has it: `<zone id>:<spawn index>` (a pack's: `…:<n>`), its tile, its kind's one level, its HP of
 *  its kind's `maxHp` (the mob table), which way it faces, and the rest of a hop under way. */
export interface TownMob {
  id: string;
  col: number;
  row: number;
  level: number;
  maxHp: number;
  dir: TownMobFacing;
  /** Its look, one of its kind's variants (seeded per spawn: the same every time); none for a kind with one look. */
  variant?: string;
  hp: number;
  dead?: boolean;
  path?: [number, number][];
  /** The hop's pace (tiles a second) when it isn't the usual (slowed). */
  speed?: number;
  /** Its kind (mobs.json id) for a mob that isn't on a spawn point (the golem's Adds: ids `golem-add:<n>`). */
  kind?: string;
}

/** The Scrapheap Golem's attacks: Tire Slam, Scrap Toss, Lamp Glare. */
export type GolemAttack = 'slam' | 'toss' | 'glare';

/** The field boss as the server has it (bot web/town-golem.ts). `state`: rising (its death anim backwards, `left` ms of
 *  it to go; not hittable), idle in the Golem Pit, in a fight, walking home after a reset, sinking (its death anim
 *  forwards, `left` ms; not hittable), or dead. Its body is `radius` tiles round its tile (reach to it is measured to
 *  that edge); it fights players within `leash` tiles of `home` (the boss bar is for them, during a fight). */
export interface TownGolem {
  id: string;
  col: number;
  row: number;
  dir: TownMobFacing;
  level: number;
  hp: number;
  maxHp: number;
  state: 'rising' | 'idle' | 'fight' | 'home' | 'sinking' | 'dead';
  left?: number;
  /** 25% HP and under: the `-enraged` sheets, faster attacks, rubble rings after slams. */
  enraged: boolean;
  home: [number, number];
  leash: number;
  radius: number;
  /** The rest of a hop under way (as TownMob's). */
  path?: [number, number][];
  speed?: number;
}

/** What changed for the golem: it rose, a fight began, it called the Junk (50%), enraged (25%), reset (healed, walking
 *  home), sank, or died. */
export type GolemChange = 'rise' | 'fight' | 'call' | 'enrage' | 'reset' | 'sink' | 'death';

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
  /** Their class (the chat's badge) and the weapon they wear (its resting weapon in town), if any. */
  cls?: string | null;
  weapon?: string | null;
  /** Their character level (stats rules), if they have one saved. */
  level?: number;
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
  | { t: 'say'; text: string; megaphone?: boolean; /** To your party only (`/p` in the chat; not to Discord). */ party?: boolean }
  /** An emote over your head (one of TOWN_EMOTES). */
  | { t: 'emote'; emote: TownEmote }
  /** A damage skill on a mob (battle maps: the Slums): `skill` = its place in the class's list (which pose it plays). */
  | { t: 'attack'; mob: string; skill: number }
  /** A mobility move (Dash, Step Back, Charge, Blink) ending at col,row: sent just before its steps, so the others
   *  play the move instead of a walk (where you are still comes from the steps). */
  | { t: 'move'; move: TownMove; col: number; row: number }
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
  | { t: 'arena-leave' }
  /** Parties (bot web/town-party.ts; up to 6): invite a player (by their town id; you lead, or you're in none), answer an
   *  invite, leave (a leader's lead passes to the next member), disband (the leader), kick a member (the leader; by
   *  their party key). */
  | { t: 'party-invite'; to: string }
  | { t: 'party-answer'; invite: string; accept: boolean }
  | { t: 'party-leave' }
  | { t: 'party-disband' }
  | { t: 'party-kick'; member: string };

/** A party member as everyone in the party sees them: `key` is theirs for the party's lifetime (never a Discord id),
 *  `id` their town player id while they're connected (null: away, kept for a minute), `area` the room they're in. */
export interface PartyMember {
  key: string;
  id: string | null;
  nickname: string;
  outfit: OutfitData;
  cls?: string | null;
  area: string | null;
}

export interface PartyState {
  leader: string;
  /** Your own key. */
  you: string;
  /** In the order they joined (the next leader is the first after the leader). */
  members: PartyMember[];
  max: number;
}

export type PartyRefusal = 'self' | 'gone' | 'not-leader' | 'full' | 'in-party' | 'already' | 'invited' | 'expired' | 'slow';

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
export type TownMove = 'dash' | 'step-back' | 'charge' | 'blink';
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
/** A Mosang race's stop: at `at` of the track (0–1) she stops for `ms` (an arthritis attack, a fall…); `line` picks
 *  what she says (the game's lines for that kind, modulo their count). */
export interface TownRaceStop {
  at: number;
  ms: number;
  kind: 'arthritis' | 'asthma' | 'gossip' | 'phone' | 'fall';
  line: number;
}

/** A Mosang's race: her pace (track lengths a second, between stops) and her stops. */
export interface TownRaceLane {
  speed: number;
  stops: TownRaceStop[];
}

/** The Mosang race (bot games/race.ts; the same race as Discord's /race), as the town sees it. Times are the bot's
 *  clock (`now`: the bot's clock as this was sent, so pages can correct for their own). */
export interface TownRace {
  id: string;
  /** The runners' NPC ids (marites, nena…), lane by lane. */
  runners: string[];
  /** Betting closes and the race starts. */
  closesAt: number;
  now: number;
  /** Bets so far, lane by lane: how many and how many Kowens. */
  bets: { count: number; pot: number }[];
  /** Once it's running: each lane's script, the winner's lane (and a photo finish's second, else -1), when it's won. */
  run?: { lanes: TownRaceLane[]; winner: number; tie: number; endsAt: number };
  /** Who started it (a town nickname or Discord name). */
  startedBy: string;
}

/** GET/POST /town/race: the race (null: none on), your bet on it, and the rules. */
export interface TownRaceResponse {
  race: TownRace | null;
  mine: { lane: number; amount: number } | null;
  kowens: number;
  maxBet: number;
  payout: number;
  ok?: boolean;
  message?: string;
}

export interface TownSystemLine {
  /** 'golem': the field boss's lines, only to those in the Slums (never kept for arrivals, never in Discord). */
  kind: 'dig' | 'gamble' | 'jackpot' | 'shop' | 'gift' | 'jail' | 'quest' | 'arena' | 'steal' | 'race' | 'golem';
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
  /** The Mosang race changed: opened, a bet, off, won, or over (null). Also sent on arrival while one is on. */
  | { t: 'race'; race: TownRace | null }
  /** Staying in town: a Kowen is ready to claim (web/town-stay.ts). */
  | { t: 'stay'; stay: TownStayInfo }
  /** Someone dissed, praised or judged someone (the player menu): `id` says the line (the target's name is in it). */
  | { t: 'verdict'; id: string; kind: 'roast' | 'praise'; judged: boolean; text: string }
  /** You have a new title (e.g. you just became the richest): the reward pop-up, then `POST /title/seen { id }`. */
  | { t: 'new-title'; id: string; title: TitleData }
  /** The neighbourhood: someone built a house ('built': it rises on its lot, top tile col/row, door tile) or gave theirs a
   *  new look ('look'). Only to those in the neighbourhood. */
  /** A house in the neighbourhood: built, a new look, or its Bakod up or down (`door`: its door spot now, outside the
   *  fence with a Bakod; `fence`: every Bakod's fence in the neighbourhood now, as HoodMap's). */
  | { t: 'house'; change: 'built' | 'look' | 'fence'; house: HoodHouse; col: number; row: number; door: [number, number]; fence: HoodMap['fence'] }
  /** Someone changed their look or title at the Parlor (you too: `id` is yours). */
  | { t: 'look'; id: string; outfit: OutfitData; title: TitleData }
  /** Someone changed their nickname with a Rename Card (you too: `id` is yours). */
  | { t: 'rename'; id: string; nickname: string }
  /** Someone chose a class or changed their weapon (you too: `id` is yours). */
  | { t: 'kit'; id: string; cls: string | null; weapon: string | null }
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
  /** Every mob in your room as you arrive (the Slums; the same for everyone: bot web/town-mobs.ts), the golem's Adds
   *  included (with their `kind`), and the field boss if it's up (null: not). */
  | { t: 'mobs'; mobs: TownMob[]; golem?: TownGolem | null }
  /** Mobs that weren't there (the golem's Adds, as they crawl out), and mobs that are gone for good (the Adds when the
   *  fight ends). */
  | { t: 'mob-add'; mobs: TownMob[] }
  | { t: 'mob-remove'; ids: string[] }
  /** A mob turns where it stands (the golem, slowly: a quarter turn at a time). */
  | { t: 'mob-face'; id: string; dir: TownMobFacing }
  /** The golem changed (its whole state each time: HP, enraged, where it is). 'call': the Junk crawls out at `spots`
   *  (fx-golem-call-junk on each), its Adds arrive as `mob-add` `ms` later. */
  | { t: 'golem'; change: GolemChange; golem: TownGolem; spots?: [number, number][]; ms?: number }
  /** The golem attacks (shown only: players have no HP yet), turned to `dir`, at `target` (a town id): 'slam' lands its
   *  fist at `at` (the warning there from the start, impact + shockwave on mobs.json attackFrame; a rubble ring after it
   *  when `enraged`), 'toss' throws at `at` (the target's tile: the marker from the start, the scrap leaves on
   *  tossFrame), 'glare' lights a cone from its tile along `dir` (`cone`: tiles long, degrees wide, in grid space) on
   *  glareFrames: `blinded` are the players inside, blinded for `blindMs` (shown only). Frame times come from the
   *  manifest's anims (the server keeps it still for the anim's length). */
  | { t: 'golem-attack'; id: string; attack: GolemAttack; dir: TownMobFacing; target: string; at: [number, number]; enraged: boolean; blinded?: string[]; blindMs?: number; cone?: [number, number] }
  /** A mob hops: from the first tile of `path` along the rest (at the mobs' pace). */
  | { t: 'mob-move'; id: string; path: [number, number][]; speed?: number }
  /** Someone (`by`, a town id) hit with skill `skill`: each mob it reached (the target first) with the damage, a crit or
   *  not, the HP left, dead or not; `blocked`: a Scrap Crab's shell took it (0); `miss`: it missed (0). */
  | { t: 'mob-hit'; by: string; skill: number; hits: { id: string; damage: number; crit: boolean; hp: number; dead: boolean; blocked?: boolean; miss?: boolean; slow?: { factor: number; ms: number } }[] }
  /** A mob attacks a player (shown only: players have no HP yet), turned to face `dir`; `slow`: the player is slowed
   *  for that long (ms; the Plastic Bag Spook's, shown only). */
  | { t: 'mob-attack'; id: string; target: string; dir: TownMobFacing; slow?: number }
  /** A dead mob is back at its spawn. */
  | { t: 'mob-spawn'; id: string; col: number; row: number; hp: number }
  /** Your level, XP and points changed (XP from a kill: `gained`; a level-up; dev's ?xp= / ?level=). */
  | { t: 'progress'; progress: CharacterProgress; gained?: number }
  /** Someone in your room went up a level (you too: `id` is yours): "Level up!" over them. HP and MP refill with it. */
  | { t: 'level-up'; id: string; level: number }
  /** Your attack didn't land: too far, too fast, the mob's gone, or the skill isn't one of yours or unlocked yet. */
  | { t: 'attack-refused'; reason: 'range' | 'slow' | 'gone' | 'skill' | 'locked' }
  /** Your party now (null: none), with a line for a toast when something happened ("Mara joined the party."). */
  | { t: 'party'; party: PartyState | null; note?: string }
  /** Someone invites you: answer with party-answer (it lapses after a minute). */
  | { t: 'party-invited'; invite: string; from: string; name: string; members: number }
  /** Your invite or action didn't go through (`name`: who it was about). */
  | { t: 'party-refused'; reason: PartyRefusal; name?: string }
  /** The player you invited said no (or let it lapse). */
  | { t: 'party-declined'; name: string }
  /** A party member said something to the party (you too: your own words come back this way). */
  | { t: 'party-say'; id: string; name: string; text: string }
  /** Someone used a mobility move (their steps follow). */
  | { t: 'move'; id: string; move: TownMove; col: number; row: number }
  /** Someone said something in the town's Discord channel (shown with a Discord mark, no bubble). */
  | { t: 'say-discord'; name: string; text: string }
  /** Your message wasn't sent: too fast, empty / too long once tidied, or you're muted (until when, ms). */
  /** 'megaphone': they have none (bought in the shop). */
  | { t: 'say-refused'; reason: 'slow' | 'invalid' | 'muted' | 'megaphone' | 'party'; until?: number }
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
