import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchStalls } from './stalls.js';

test('a stall over the limit is reported with how long the timer came late; on time or a little late is not', () => {
  let t = 0;
  let tick: () => void = () => {};
  const stalls: number[] = [];
  watchStalls((ms) => stalls.push(ms), { everyMs: 100, overMs: 250, now: () => t, every: (fn) => ((tick = fn), {}) });
  for (const step of [100, 110, 300, 100, 1100, 100]) {
    t += step;
    tick();
  }
  assert.deepEqual(stalls, [1000], 'only the 1,100 ms gap: 1,000 ms late');
});

test('a real timer: a busy thread for 400 ms is seen', async () => {
  const stalls: number[] = [];
  const w = watchStalls((ms) => stalls.push(ms), { everyMs: 20, overMs: 200 });
  await new Promise((r) => setTimeout(r, 50));
  const until = performance.now() + 400;
  while (performance.now() < until) {
    // busy
  }
  await new Promise((r) => setTimeout(r, 60));
  w.stop();
  assert.equal(stalls.length, 1);
  assert.ok(stalls[0] >= 300 && stalls[0] < 600, String(stalls[0]));
});
