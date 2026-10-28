// 🚶 The pure rules of starting a step (characters/character.ts update) and of a click that comes while a move plays
// (scenes/TownScene.ts moveTo), kept apart from Phaser so they can be tested (step-gate.test.ts). 28 Oct 2026: right
// clicks that went dead: a step the server refused snapped the whole walk away, and a click during a Dash was wiped by
// its landing.

import type { Tile } from '../world/grid';

/** Waiting for a step token: the walk cycle keeps going this long, then the character stands until it comes. */
export const WALK_WAIT_MS = 150;

/** A walk waiting for a token since `since` (ms; null: not waiting): whether to keep the walking animation (a short wait)
 *  or stand (a long one). */
export function walkWhileWaiting(since: number | null, now: number): boolean {
  return since === null || now - since < WALK_WAIT_MS;
}

/** The step gate's decision as Character.update makes it each frame it reaches a new step: `canStep` answers whether a
 *  token is there. Yes: the step is announced (`announce`) and the walk goes on; no: nothing is announced, the character
 *  stays at the tile centre and the wait starts (or goes on from `since`). */
export function stepGate(canStep: (() => boolean) | null, since: number | null, now: number): { announce: boolean; since: number | null } {
  if (!canStep || canStep()) return { announce: true, since: null };
  return { announce: false, since: since ?? now };
}

/** A click to walk somewhere while a mobility move (or a leap) is still moving the character (`busy`): the walk can't
 *  start now (the move's landing would wipe its path), so the target is kept and walked as the move lands; the latest
 *  click wins. Not busy: walked now, nothing kept. */
export function walkNowOrAfter(busy: boolean, target: Tile): { now: Tile | null; after: Tile | null } {
  return busy ? { now: null, after: target } : { now: target, after: null };
}
