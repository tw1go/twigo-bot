// 🧊 Ang Silong (classes/dungeons.json `silong`, the art folder's silong/data/silong.json; CONTEXT.md Silong, Floor,
// Freight elevator, Susi ng Silong): the Lumang Palengke's dungeon, three frozen floors under the Market Hall played as
// runs. Its data's types, its maps' `silong` block (maps/silong-b1..b3.json, built by the game's scripts/build-silong.ts
// from the art folder's silong-floors.json) and a few pure rules both sides use.

import type { DungeonMechanic, Rect, Tile } from './dungeons.js';
import { numbersIn } from './stats.js';

/** A floor's key: B1 (dry storage), B2 (the canteen and meat lockers), B3 (the ice plant). */
export type SilongFloor = 'b1' | 'b2' | 'b3';
export const SILONG_FLOORS: readonly SilongFloor[] = ['b1', 'b2', 'b3'];
/** The page's area for a floor (`silong-b1`…), and back. */
export const silongArea = (f: SilongFloor) => `silong-${f}` as const;
export const floorOfArea = (area: string): SilongFloor | null => {
  const f = area.startsWith('silong-') ? area.slice(7) : '';
  return (SILONG_FLOORS as readonly string[]).includes(f) ? (f as SilongFloor) : null;
};

/** A room's mobs: their kind and fixed numbers. */
export interface SilongRoomMobs {
  kind: string;
  level: number;
  hp: number;
  atk: number;
  def: number;
  xp: number;
  kusing: number;
}

/** A mini boss (its room's mobs' art at miniBossLook.drawScale): its numbers, Kusing pile, tile and moves. */
export interface SilongMiniBoss {
  id: string;
  name: string;
  level: number;
  hp: number;
  atk: number;
  def: number;
  xp: number;
  kusingPile: number;
  tile: Tile;
  guards: number;
  mechanics: DungeonMechanic[];
}

export interface SilongRoom {
  id: string;
  name: string;
  rect: Rect;
  mobs: SilongRoomMobs;
  mobCount: number;
  packs: Tile[][];
  miniBoss?: SilongMiniBoss;
}

export interface SilongFloorData {
  index: number;
  id: SilongFloor;
  name: string;
  level: number;
  chill: boolean;
  rooms: SilongRoom[];
}

export interface SilongData {
  name: string;
  maps: string[];
  entry: {
    warp: { map: string; object: string; useRangeTiles: number };
    minLevel: number;
    key: string;
    keysPerRun: number;
    partyInviteSeconds: number;
    onePerParty: boolean;
    partyMax: number;
  };
  run: {
    timeLimitMinutes: number;
    closeAfterLastBossMinutes: number;
    closeWhenEmptySeconds: number;
    leavePartyKickSeconds: number;
    bossResetSeconds: number;
    mobRespawn: boolean;
  };
  floorRules: {
    chill: {
      stackEverySecondsStill: number;
      perStack: { moveSpeedPct: number; attackSpeedPct: number };
      maxStacks: number;
      /** "moving for 1 s", "standing within 2 tiles of a work lamp (L)". */
      clears: string[];
      immune: string;
    };
    belts: { speedTilesPerSec: number };
  } & Record<string, unknown>;
  scaling: { mobHp: string; bossHp: string };
  floors: SilongFloorData[];
  lastBoss: SilongMiniBoss & { title: string; reachRadius: number };
  miniBossLook: { drawScale: number; nameColour: string };
  /** A practice run's mobs and bosses: this % of their HP and of their ATK. */
  practiceRun: { mobHpPct: number; mobAtkPct: number; once: boolean };
  loot: SilongLoot;
  key: { id: string; name: string; sources: { shop: { kusing: number }; greatScaleChance: number; lastBossChance: number } };
}

/** The Silong's loot (classes/dungeons.json silong.loot): like the Warrens', a tier up (Lv 40, Polished Whetstones). */
export interface SilongLoot {
  gearLevel: number;
  miniBoss: {
    roll: {
      affix: { chance: number; affix: Record<string, number> };
      plain: { chance: number; colour: Record<string, number> };
      unlucky: { chance: number; kusingTimes: number; polishedWhetstones: [number, number] };
    };
  };
  lastBoss: {
    perPlayerInside: {
      affixGear: number;
      affix: Record<string, number>;
      accessories: number;
      accessoryLevel: number;
      kusing: number;
      polishedWhetstones: [number, number];
      agimatChance: number;
      agimatLevel: number;
      keyChance: number;
    };
  };
}

/** A room as a floor's map has it (its boss's tile, and its boss floor's tiles). */
export interface SilongMapRoom {
  id: string;
  name: string;
  rect: Rect;
  mob: string;
  boss: { id: string; tile: Tile; last?: boolean } | null;
  bossTiles: Tile[];
}

/** A floor map's `silong` block. */
export interface SilongBlock {
  floor: SilongFloor;
  index: number;
  name: string;
  level: number;
  rooms: SilongMapRoom[];
  /** The arrival elevator's tiles (E: safe), and where you land in it. */
  arrive: Tile[];
  arriveMark: Tile;
  /** The elevator down's tiles (X: shut until the floor's mini bosses are down; none on B3). */
  down: Tile[];
  /** Cold-room doors (G: shut until their room's boss falls). */
  doors: { room: string; tiles: Tile[] }[];
  /** The stairs up to the Market Hall (w, B1). */
  exit: Tile[];
  safe: Tile[];
  lamps: Tile[];
  pallets: Tile[];
  ice: Tile[];
  belts: { e: Tile[]; w: Tile[] };
  ramonBox: Tile | null;
  bossBody: Tile[];
  bossTile: Tile | null;
}

/** A Silong run as its players see it (bot web/town-silong.ts): running (`left` ms of its time), cleared (the Ice
 *  Machine down: `left` ms until it closes) or closed; each floor reached, its mini bosses (as they fall) and whether its
 *  elevator down is open; the B3 door; who's inside where. */
export interface TownSilongRun {
  id: string;
  phase: 'running' | 'cleared' | 'closed';
  left: number;
  opener: string;
  yours?: boolean;
  practice?: boolean;
  floors: { floor: SilongFloor; name: string; reached: boolean; bosses: { id: string; name: string; dead: boolean }[]; open: boolean }[];
  door: boolean;
  inside: number;
  /** Cleared: ms from its start to the last boss's fall, and who was inside then (names). */
  clearMs?: number;
  team?: string[];
}

/** What the Silong Hatch offers you: your level and keys, your party's run (if it has one), and why not. */
export interface TownSilongGate {
  minLevel: number;
  level: number;
  keys: number;
  inParty: boolean;
  partyRun: { id: string; inside: number; opener: string } | null;
  /** 'level' (under minLevel), 'quest' (Now's the Time not done: `questLine`), 'full', 'key' (none to open with). */
  blocked?: 'level' | 'quest' | 'full' | 'key';
  questLine?: string;
  /** A practice run (a Practice Susi ng Silong held): Practice run (alone); `blocked` its reason if it can't open now. */
  practice?: { keys: number; blocked?: 'level' | 'full' | 'run' };
}

/** The floor below (none under B3). */
export const floorBelow = (f: SilongFloor): SilongFloor | null => SILONG_FLOORS[SILONG_FLOORS.indexOf(f) + 1] ?? null;

/** Chill (CONTEXT.md Chill; silong.floorRules.chill, its numbers from its sentences): a stack every `everyMs` standing
 *  still, up to `max`; each `movePct` / `attackPct` off move and attack speed; cleared by moving `moveMs` or standing
 *  within `lampTiles` of a work lamp; none with one of the `immune` dishes on (Sinigang, Lugaw). */
export function chillRules(S: Pick<SilongData, 'floorRules'>) {
  const C = S.floorRules.chill;
  return {
    everyMs: C.stackEverySecondsStill * 1000,
    max: C.maxStacks,
    movePct: C.perStack.moveSpeedPct / 100,
    attackPct: C.perStack.attackSpeedPct / 100,
    moveMs: (numbersIn(C.clears.find((c) => c.includes('moving')) ?? '')[0] ?? 1) * 1000,
    lampTiles: numbersIn(C.clears.find((c) => c.includes('lamp')) ?? '')[0] ?? 2,
    immune: ['lugaw', 'sinigang'].filter((d) => C.immune.toLowerCase().includes(d)),
  };
}
export type ChillRules = ReturnType<typeof chillRules>;

/** Move speed with `stacks` of Chill (1 = none; −5% a stack). */
export const chillMove = (R: ChillRules, stacks: number) => Math.max(0.1, 1 + R.movePct * stacks);
/** Attack speed with `stacks` of Chill (the time between casts ÷ this). */
export const chillAttack = (R: ChillRules, stacks: number) => Math.max(0.1, 1 + R.attackPct * stacks);

/** One-off things a character has done in Ang Silong (kept in `quests.flags`): cleared it once (Aling Conching's Atchara
 *  refill at half price after), Mang Ramon's note handed to Kuya Jun (his box gives no more). */
export const SILONG_FLAGS = { cleared: 'silong-cleared', ramonDone: 'ramon-note-done' } as const;
/** The quest item in Mang Ramon's box (B2's R), and what Kuya Jun gives for it. */
export const RAMON = { note: 'ramon-note', reward: 'mid-repair-kit' } as const;
/** After the first clear: this dish at this share of its price (silong.json's "Atchara refill at half price"). */
export const ATCHARA_REFILL = { dish: 'atchara', share: 0.5 } as const;
