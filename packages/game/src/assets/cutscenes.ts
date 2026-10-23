import type { Dir } from './types';

// 🎬 The story's cutscenes, as quests/cutscenes.json has them (the art folder's docs/cutscenes, its words in English;
// CONTEXT.md Cutscene): each a list of steps world/cutscene.ts plays in order, with what sets it off.

/** A tile [col, row], someone ('player', an NPC id), or (`to`/`at` only) 'home', the NPC's own spot. */
export type CutsceneAt = [number, number] | string;

/** One step: the steps doc in the json says what each does. Exactly one of the step keys is set. */
export interface CutsceneStep {
  bars?: boolean;
  camera?: CutsceneAt;
  zoom?: number;
  hold?: number;
  fade?: 'out' | 'in';
  wait?: number | boolean;
  say?: string;
  lines?: string[];
  quest?: string;
  part?: 'give' | 'report' | 'talk';
  bubble?: string;
  text?: string;
  walk?: string;
  to?: CutsceneAt;
  stopAt?: number;
  place?: string;
  at?: CutsceneAt;
  face?: string;
  dir?: Dir | string;
  anim?: string;
  play?: string;
  hop?: string;
  px?: number;
  nod?: string;
  fx?: string;
  dx?: number;
  dy?: number;
  layer?: 'front' | 'ground';
  sound?: string;
  shake?: number;
  power?: number;
  icon?: string;
  rise?: number;
  glint?: boolean;
  hide?: boolean;
  lights?: string;
  ghosts?: CutsceneGhost[];
  around?: [number, number];
  count?: number;
  radius?: number;
  banner?: string;
  sub?: string;
  ms?: number;
  end?: boolean;
}

/** One old vendor in a `ghosts` step: where, whose look ('random': a doll with a random outfit; an NPC id: its sheet),
 *  which way, and a gesture. */
export interface CutsceneGhost {
  at: [number, number];
  look: string;
  face?: Dir;
  do?: 'wave' | 'nod' | null;
}

/** What sets a scene off (rules: once each, on its own map). */
export interface CutsceneTrigger {
  /** The first time you're on this map (while `whenNotDone` isn't done). */
  firstEnter?: string;
  whenNotDone?: string;
  /** A quest's give or report talk: the scene before its lines, after them, or instead of them (`before` / `after` /
   *  `instead`: 'lines'). */
  questGive?: string;
  questReport?: string;
  before?: 'lines';
  after?: 'lines';
  instead?: 'lines';
  /** Also as soon as this objective of the questReport quest is done (the finale: Q14's bell). */
  afterStep?: string;
  /** A quest just finished. */
  questDone?: string;
  /** Wait until nothing has hit you or been hit by you for 4 s. */
  outOfCombat?: boolean;
}

export interface Cutscene {
  title: string;
  /** The map it plays on (its moment elsewhere waits for it: rules.map). */
  map: string;
  trigger: CutsceneTrigger;
  about?: string;
  note?: string;
  steps: CutsceneStep[];
}

export interface CutscenesData {
  version: number;
  rules: Record<string, string>;
  steps: Record<string, string>;
  scenes: Record<string, Cutscene>;
}
