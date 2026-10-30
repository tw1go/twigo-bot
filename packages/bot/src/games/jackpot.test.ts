import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRAW_CRON, drawMissed, dueDraw, nextDraw } from './jackpot.js';

// The jackpot's clock (games/jackpot.ts): draws at 10:00 and 22:00 Manila; the draw due before a moment, and whether
// it was missed (later than the last run, and the scheduled job's two minutes gone by).

const manila = (iso: string) => new Date(`${iso}+08:00`);

test('the draw due before a moment is the latest 10:00 or 22:00 Manila at or before it; the next is after it', () => {
  assert.equal(DRAW_CRON, '0 10,22 * * *');
  assert.equal(dueDraw(manila('2026-10-30T10:00:30'))!.getTime(), manila('2026-10-30T10:00:00').getTime());
  assert.equal(dueDraw(manila('2026-10-30T11:40:00'))!.getTime(), manila('2026-10-30T10:00:00').getTime());
  assert.equal(dueDraw(manila('2026-10-30T09:59:00'))!.getTime(), manila('2026-10-29T22:00:00').getTime());
  assert.equal(nextDraw().getTime() > Date.now(), true);
});

test('missed: the due draw is later than the last run and two minutes have gone; on time, or just struck, is not', () => {
  const lastNight = manila('2026-10-29T22:00:16').getTime();
  assert.equal(drawMissed(manila('2026-10-30T10:00:30'), lastNight), false, 'the job gets its two minutes');
  assert.equal(drawMissed(manila('2026-10-30T10:02:00'), lastNight), true);
  assert.equal(drawMissed(manila('2026-10-30T11:40:00'), lastNight), true, 'the 10 AM draw never ran');
  assert.equal(drawMissed(manila('2026-10-30T11:40:00'), manila('2026-10-30T10:00:05').getTime()), false, 'it ran');
  assert.equal(drawMissed(manila('2026-10-30T21:59:00'), manila('2026-10-30T10:00:05').getTime()), false);
  assert.equal(drawMissed(manila('2026-10-30T22:05:00'), manila('2026-10-30T10:00:05').getTime()), true);
});
