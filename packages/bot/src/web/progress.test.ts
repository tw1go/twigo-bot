import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mobStats, xpForLevel, xpToNext } from '@mikazuki/shared';
import { addXp, freshProgress, killXp, levelTo, progressView, refundPoints } from './progress.js';
import { loadStats } from './stats-data.js';

// Levels, XP and points by the game's real stats.json (the numbers are read from it, never written here).

const S = loadStats();
const CAP = S.levelCap;
const SKILL = S.skills.skillPointsPerLevelUp;
const STAT = S.growth.pointsPerLevelUp;

test('a new character: Lv 1, no XP, nothing earned or spent', () => {
  assert.deepEqual(freshProgress(S), { level: 1, xp: 0, next: xpToNext(S, 1), points: {}, statPoints: 0, skills: {}, skillPoints: 0 });
});

test('XP short of the next level stays XP; reaching it is a level-up with its stat point and 3 skill points', () => {
  const p = freshProgress(S, 'slingshot');
  const short = addXp(S, 'slingshot', p, p.next - 1);
  assert.deepEqual([short.progress.level, short.progress.xp, short.ups, short.gained], [1, p.next - 1, 0, p.next - 1]);
  const up = addXp(S, 'slingshot', short.progress, 1);
  assert.deepEqual([up.progress.level, up.progress.xp, up.ups], [2, 0, 1]);
  assert.equal(up.progress.next, xpToNext(S, 2));
  assert.equal(up.progress.statPoints, STAT);
  assert.equal(up.progress.skillPoints, SKILL);
});

test('a lot of XP at once: several levels, the points for each, the rest carried into the level', () => {
  const r = addXp(S, 'stick', freshProgress(S, 'stick'), xpForLevel(S, 5) + 7);
  assert.deepEqual([r.progress.level, r.progress.xp, r.ups], [5, 7, 4]);
  assert.equal(r.progress.skillPoints, 4 * SKILL);
  assert.equal(r.progress.statPoints, 4 * STAT);
  // Points spent stay spent; skill points already there are kept.
  const spent = addXp(S, 'stick', { ...r.progress, points: { STR: 2 }, skillPoints: 1 }, xpToNext(S, 5));
  assert.deepEqual([spent.progress.level, spent.progress.statPoints, spent.progress.skillPoints, spent.progress.points.STR], [6, 5 * STAT - 2, 1 + SKILL, 2]);
});

test('before a class, stat points are banked (none spent)', () => {
  const r = addXp(S, null, freshProgress(S), xpForLevel(S, 4));
  assert.equal(r.progress.statPoints, 3 * STAT);
  assert.equal(progressView(S, null, { level: 4, points: { STR: 3 } }).statPoints, 3 * STAT, 'points "spent" without a class don\'t count');
});

test('at the level cap: MAX (no XP to next), and XP stops', () => {
  const top = levelTo(S, 'broom', freshProgress(S, 'broom'), CAP);
  assert.deepEqual([top.progress.level, top.progress.xp, top.progress.next, top.ups], [CAP, 0, 0, CAP - 1]);
  assert.equal(top.progress.skillPoints, (CAP - 1) * SKILL);
  assert.equal(top.progress.statPoints, (CAP - 1) * STAT);
  const more = addXp(S, 'broom', top.progress, 5000);
  assert.deepEqual([more.progress.level, more.progress.xp, more.gained, more.ups], [CAP, 0, 0, 0]);
  // Past it in one go: up to the cap, the rest lost.
  const over = addXp(S, 'broom', freshProgress(S, 'broom'), xpForLevel(S, CAP) * 2);
  assert.deepEqual([over.progress.level, over.progress.xp, over.gained, over.ups], [CAP, 0, xpForLevel(S, CAP), CAP - 1]);
});

test('kill XP: the mob\'s, less for one far below (the low-mob penalty), never under its floor', () => {
  const can = mobStats(S, 'tin-can')!;
  const P = S.xp.lowMobPenalty;
  const at = (level: number) => killXp(S, 'stick', levelTo(S, 'stick', freshProgress(S, 'stick'), level).progress, can).gained;
  assert.equal(at(1), can.xp, 'its level: all of it');
  assert.equal(at(can.level + P.freeGap), can.xp, 'within the free gap: all of it');
  assert.equal(at(can.level + P.freeGap + 1), Math.round(can.xp * (1 - P.perExtraLevel)), 'a level past it: less');
  assert.equal(at(CAP - 1), Math.max(1, Math.round(can.xp * P.minMult)), 'far below: the floor');
  // A kill's XP can level you up.
  const p = freshProgress(S, 'stick');
  const r = killXp(S, 'stick', { ...p, xp: p.next - 1 }, can);
  assert.deepEqual([r.progress.level, r.ups], [2, 1]);
});

test('refund: nothing spent, skills at Lv 1, the level\'s skill points back; level and XP stay', () => {
  const p = { ...levelTo(S, 'stick', freshProgress(S, 'stick'), 6).progress, xp: 3, points: { STR: 3, DEX: 2 }, skills: { '0': 4, dash: 2 }, skillPoints: 2 };
  const r = refundPoints(S, null, p);
  assert.deepEqual(r, { level: 6, xp: 3, next: xpToNext(S, 6), points: {}, statPoints: 5 * STAT, skills: {}, skillPoints: 5 * SKILL });
});

test('dev ?level=N: up as from kills (each level-up counted); down from Lv 1 again with no level-up', () => {
  const ten = levelTo(S, 'slingshot', freshProgress(S, 'slingshot'), 10);
  assert.deepEqual([ten.progress.level, ten.progress.xp, ten.ups, ten.progress.skillPoints], [10, 0, 9, 9 * SKILL]);
  const down = levelTo(S, 'slingshot', { ...ten.progress, points: { DEX: 4 } }, 3);
  assert.deepEqual([down.progress.level, down.ups, down.progress.points, down.progress.skillPoints], [3, 0, {}, 2 * SKILL]);
  assert.equal(levelTo(S, 'slingshot', freshProgress(S), 99).progress.level, CAP);
});

test('saved numbers are held to the rules: level within 1…cap, XP under the next, no negatives', () => {
  const v = progressView(S, 'stick', { level: 0, xp: -4, points: { STR: -2, INT: 1.7 }, skills: { '0': 1, '1': 3 }, skillPoints: -1 });
  assert.deepEqual(v, { level: 1, xp: 0, next: xpToNext(S, 1), points: { INT: 1 }, statPoints: 0, skills: { '1': 3 }, skillPoints: 0 }, 'INT is the Stick\'s third stat: not counted as spent');
  assert.equal(progressView(S, 'stick', { level: 3, xp: 1e9 }).xp, xpToNext(S, 3) - 1);
});
