// 🕳️ The Scrap Warrens (classes/dungeons.json warrens, the art folder's data/dungeons/warrens.json; its rules in words:
// docs/dungeons/combat-guide-dungeon.md there), and the dungeon block of its map (maps/warrens.json `dungeon`, built by
// the game's scripts/build-warrens.ts from the layout). Types and a few pure rules both sides use: the party scaling and
// where things are on the map.

/** A dungeon mob's fixed numbers (its kind's art, attacks and behaviour; these numbers instead of the mob table's). */
export interface DungeonMobStats {
  kind: string;
  level: number;
  hp: number;
  atk: number;
  def: number;
  xp: number;
  kusing: number;
}

/** One of a boss's moves (warrens.json mechanics): a timed attack (`every` s, a telegraph `telegraphMs` long of
 *  `shape`), or something at an HP share (`atHp`: calls, vanish, hunker, enrage). The rest of its fields are its own. */
export interface DungeonMechanic {
  id: string;
  every?: number;
  telegraphMs?: number;
  shape?: 'circle' | 'circles' | 'line' | 'cone' | 'tiles';
  radius?: number;
  width?: number;
  length?: number;
  angleDeg?: number;
  count?: number;
  atkMult?: number;
  atHp?: number[] | number;
  fromHp?: number;
  calls?: { kind: string; count: number; where: string };
  slow?: { pct: number; ms: number };
  stunMs?: number;
  untargetableMs?: number;
  alpha?: number;
  blockAllMs?: number;
  range?: number;
  jumps?: number;
  jumpRange?: number;
  jumpMult?: number;
  speedTilesPerSec?: number;
  attackSpeed?: number;
  roofRainEvery?: number;
}

/** A mini boss (or the last boss): its numbers and moves. */
export interface DungeonBossDef {
  id: string;
  name: string;
  kind?: string;
  title?: string;
  level: number;
  hp: number;
  atk: number;
  def: number;
  xp: number;
  kusingPile?: number;
  guards?: number | { kind: string; count: number };
  mechanics: DungeonMechanic[];
  tile?: [number, number];
  body?: [number, number, number, number];
  reachRadius?: number;
}

export interface DungeonArea {
  index: number;
  id: string;
  name: string;
  mobs: DungeonMobStats;
  mobCount?: number;
  miniBoss: DungeonBossDef;
}

/** Odds by key (they add up to 1). */
export type Odds = Record<string, number>;

export interface WarrensData {
  name: string;
  map: string;
  entry: {
    warp: { map: string; object: string; tile: [number, number]; footprint: [number, number]; useRangeTiles: number; arrive: [number, number] };
    minLevel: number;
    ticket: string;
    ticketsPerRun: number;
    partyInviteSeconds: number;
    onePerParty: boolean;
    partyMax: number;
  };
  run: {
    timeLimitMinutes: number;
    gatherSeconds?: number;
    closeAfterLastBossMinutes: number;
    closeWhenEmptySeconds: number;
    leavePartyKickSeconds: number;
    bossResetSeconds: number;
    mobRespawn: boolean;
  };
  scaling: { mobHp: string; bossHp: string };
  areas: DungeonArea[];
  scrapling: { id: string; name: string; art: string; drawScale: number; level: number; hp: number; atk: number; def: number; xp: number; kusing: number; attacks: { tireSlam: number } };
  lastBoss: DungeonBossDef & { tile: [number, number]; body: [number, number, number, number]; reachRadius: number; guards: { kind: string; count: number } };
  miniBossLook: { drawScale: number; nameColour: string };
  loot: {
    gearLevel: number;
    miniBoss: {
      roll: {
        affix: { chance: number; affix: Odds; slots: Odds };
        plain: { chance: number; colour: Odds };
        unlucky: { chance: number; kusingTimes: number; roughWhetstones: [number, number] };
      };
    };
    lastBoss: {
      perPlayerInside: {
        affixGear: number;
        affix: Odds;
        slots: Odds;
        accessories: number;
        accessoryAffix: Odds;
        accessoryLevel: number;
        kusing: number;
        roughWhetstones: [number, number];
        agimatChance: number;
        agimatLevel: number;
        ticketChance: number;
      };
    };
  };
  ticket: { id: string; name: string; sources: { shop: { kusing: number }; golemLootChance: number; lastBossChance: number } };
}

export interface DungeonsData {
  warrens: WarrensData;
}

// ── The map's dungeon block (maps/warrens.json `dungeon`) ──

export type Tile = [number, number];
export type Rect = [number, number, number, number];

/** An area as the map has it: where it is, its arena (rect and floor tiles), its boss's tile, its two guards' tiles, its
 *  checkpoint and its mob kind. */
export interface DungeonMapArea {
  index: number;
  id: string;
  name: string;
  mob: string;
  rect: Rect;
  arena: Rect;
  arenaTiles: Tile[];
  bossTile: Tile;
  guards: Tile[];
  checkpoint: Tile;
}

/** An area's way out: its shutter's three tiles (the art on the middle one; `flip` for a passage that runs the other
 *  way), the passage tiles it keeps shut, and the area it opens to. */
export interface DungeonMapShutter {
  area: string;
  opensTo: string;
  tiles: Tile[];
  passage: Tile[];
  flip: boolean;
}

export interface DungeonMapBlock {
  areas: DungeonMapArea[];
  shutters: DungeonMapShutter[];
  /** The start room's tiles (safe), and the floor tiles round it that are shut while a run gathers. */
  startTiles: Tile[];
  seal: Tile[];
  exitWarp: Tile[];
  /** The last boss: its feet tile, its body's tiles (blocked) and its reach (to a circle of this radius round its tile). */
  boss: { id: string; tile: Tile; body: Rect; reachRadius: number };
}

/** The HP multiplier for `n` players inside a run (warrens.json scaling: "1 + 0.4 * (n - 1)"): at least 1. */
export function partyHpScale(formula: string, n: number): number {
  const [base, per] = (formula.match(/\d+(?:\.\d+)?/g) ?? ['1', '0']).map(Number);
  return Math.max(1, base + (per ?? 0) * (Math.max(1, n) - 1));
}

/** The area a tile is in (by its rect), or null. */
export function areaAt(block: DungeonMapBlock, col: number, row: number): DungeonMapArea | null {
  return block.areas.find((a) => col >= a.rect[0] && col <= a.rect[2] && row >= a.rect[1] && row <= a.rect[3]) ?? null;
}

/** Whether a tile is in a rect. */
export const inRect = (r: Rect, col: number, row: number) => col >= r[0] && col <= r[2] && row >= r[1] && row <= r[3];
