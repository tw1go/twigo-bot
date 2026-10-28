import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WALK_WAIT_MS, stepGate, walkNowOrAfter, walkWhileWaiting } from './step-gate.ts';

// The step gate (Character.update's rule for starting a step) and the click-during-a-move rule (TownScene.moveTo), the
// pure parts: Phaser isn't loadable here, so the scene and the character aren't.

test('a step with no token is not announced: the walk waits at the tile centre, then goes on when the token comes', () => {
  let token = false;
  const canStep = () => token;
  // Frame 1: no token. Nothing announced, the wait starts now.
  let g = stepGate(canStep, null, 1000);
  assert.deepEqual(g, { announce: false, since: 1000 });
  // Frame 2: still none. The wait goes on from when it started.
  g = stepGate(canStep, g.since, 1016);
  assert.deepEqual(g, { announce: false, since: 1000 });
  // Frame 3: a token. The step is announced, the wait is over.
  token = true;
  g = stepGate(canStep, g.since, 1033);
  assert.deepEqual(g, { announce: true, since: null });
  // No gate at all (an NPC, another player's copy): every step is announced.
  assert.deepEqual(stepGate(null, null, 5), { announce: true, since: null });
});

test('while it waits: the walk cycle keeps going for a short wait, standing for a long one', () => {
  assert.equal(walkWhileWaiting(null, 500), true, 'not waiting');
  assert.equal(walkWhileWaiting(1000, 1000 + WALK_WAIT_MS - 1), true);
  assert.equal(walkWhileWaiting(1000, 1000 + WALK_WAIT_MS), false);
  assert.equal(walkWhileWaiting(1000, 3000), false);
});

test('a click during a move keeps the target for the landing; a click while free walks now', () => {
  assert.deepEqual(walkNowOrAfter(true, { col: 3, row: 4 }), { now: null, after: { col: 3, row: 4 } });
  assert.deepEqual(walkNowOrAfter(false, { col: 3, row: 4 }), { now: { col: 3, row: 4 }, after: null });
  // The latest click wins: the scene keeps only what the last call gave it.
  let kept: { col: number; row: number } | null = null;
  for (const t of [{ col: 1, row: 1 }, { col: 2, row: 2 }, { col: 9, row: 9 }]) kept = walkNowOrAfter(true, t).after;
  assert.deepEqual(kept, { col: 9, row: 9 });
});
