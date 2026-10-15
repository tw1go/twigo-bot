import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

// 🎭 Rogues (games/rogue.ts with games/steal.ts and web/hood.ts) against a throwaway database (never the real data/):
// only rogues steal; robbing an open member protects them; a protected member can't be robbed, not even with a Master
// Key (none is used up); becoming a rogue ends protection; every attempt marks the rogue; a marked member can be robbed
// again and is never protected; quitting keeps the mark until 2 days after the last attempt; getting caught marks the
// thief and doesn't protect; the v17 migration starts everyone open, and the state outlives a restart.
const dir = mkdtempSync(join(tmpdir(), 'rogue-test-'));
const env = {
  DATA_DIR: dir,
  ENV_FILE: join(dir, 'none.env'),
  TIMEZONE: 'Asia/Manila',
  ...Object.fromEntries(['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
    'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
    'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID'].map((n) => [n, 'test'])),
};
Object.assign(process.env, env);

const { add, addFence, balance, lastSteal } = await import('../credits/store.js');
const { addMasterKey, masterKeys } = await import('../dig/store.js');
const { MIGRATIONS, closeDatabase } = await import('../db/db.js');
const { ROGUE_MARK_MS, isMarked, isProtected, isRogue, markedUntil, rogueState, setRogue, turnRogue } = await import('./rogue.js');
const { stealFrom } = await import('./steal.js');

/** Math.random as a list of rolls for one call (stealFrom: a Master Key's roll if any, the amount's two, then success). */
async function withRolls<T>(rolls: number[], f: () => Promise<T>): Promise<T> {
  const real = Math.random;
  let i = 0;
  Math.random = () => rolls[Math.min(i++, rolls.length - 1)];
  try {
    return await f();
  } finally {
    Math.random = real;
  }
}
/** A roll that succeeds (under 35%), and one that gets caught. */
const WIN = [0.5, 0.5, 0.1];
const LOSE = [0.5, 0.5, 0.9];
/** A new rogue with Kowens to steal with (each thief steals once: the cooldown would stop a second try). */
const fresh = (id: string, kowens = 50) => {
  add(id, kowens);
  setRogue(id, true);
};

test('a non-rogue can\'t steal: refused before anything else, no cooldown and no mark', async () => {
  add('nr', 50);
  add('nr-target', 50);
  const r = await stealFrom('nr', 'nr-target', true, 'test');
  assert.deepEqual(r, { ok: false, reason: 'not-rogue' });
  assert.equal(lastSteal('nr'), 0);
  assert.equal(rogueState('nr'), 'open');
});

test('a rogue robs an open member, who becomes protected', async () => {
  fresh('r1');
  add('open1', 100);
  assert.equal(rogueState('open1'), 'open');
  const r = await withRolls(WIN, () => stealFrom('r1', 'open1', true, 'test'));
  assert.ok(r.ok && r.outcome === 'stole');
  assert.equal(r.ok && r.outcome === 'stole' && r.protected, true, 'just protected');
  assert.equal(rogueState('open1'), 'protected');
});

test('a protected member can\'t be robbed, not even with a Master Key, and no key is used', async () => {
  fresh('r2');
  addMasterKey('r2');
  addFence('open1', 60 * 60_000, 7 * 86_400_000);
  const keys = masterKeys('r2');
  const before = balance('open1');
  const r = await stealFrom('r2', 'open1', true, 'test');
  assert.deepEqual(r, { ok: false, reason: 'protected' });
  assert.equal(masterKeys('r2'), keys, 'the key is kept');
  assert.equal(balance('open1'), before);
  assert.equal(lastSteal('r2'), 0, 'no attempt, no cooldown');
  assert.equal(isMarked('r2'), false, 'no attempt, no mark');
});

test('becoming a rogue ends protection', () => {
  assert.equal(isProtected('open1'), true);
  assert.deepEqual(turnRogue('open1', true, null), { ok: true, on: true });
  assert.equal(isProtected('open1'), false);
  assert.equal(rogueState('open1'), 'open', 'a rogue who hasn\'t stolen is open');
  // Quitting doesn't bring it back: open, until they're robbed again.
  setRogue('open1', false);
  assert.equal(rogueState('open1'), 'open');
});

test('a rogue\'s attempt marks them, for as long as they\'re a rogue', async () => {
  fresh('r3');
  add('open3', 100);
  await withRolls(WIN, () => stealFrom('r3', 'open3', true, 'test'));
  assert.equal(rogueState('r3'), 'marked');
  assert.equal(markedUntil('r3'), null, 'no end while they\'re a rogue');
  assert.equal(isMarked('r3', Date.now() + 30 * ROGUE_MARK_MS), true, 'still marked a long while on');
});

test('a marked member can be robbed again and again, and is never protected', async () => {
  fresh('r4');
  fresh('r5');
  add('r3', 200);
  for (const thief of ['r4', 'r5']) {
    const r = await withRolls(WIN, () => stealFrom(thief, 'r3', true, 'test'));
    assert.ok(r.ok && r.outcome === 'stole', thief);
    assert.equal(r.ok && r.outcome === 'stole' && r.protected, false);
  }
  assert.equal(rogueState('r3'), 'marked');
  assert.equal(isProtected('r3'), false);
});

test('quitting keeps the mark until 2 days after the last attempt, then they\'re open (not protected)', () => {
  const quitAt = Date.now();
  assert.deepEqual(turnRogue('r3', false, null, quitAt), { ok: true, on: false });
  const until = markedUntil('r3', quitAt)!;
  assert.ok(until > quitAt && until <= quitAt + ROGUE_MARK_MS, 'two days after the last attempt');
  assert.equal(rogueState('r3', until - 1), 'marked');
  assert.equal(rogueState('r3', until + 1), 'open');
});

test('getting caught marks the thief and doesn\'t protect the target', async () => {
  fresh('r6');
  add('open6', 100);
  const r = await withRolls(LOSE, () => stealFrom('r6', 'open6', true, 'test'));
  assert.ok(r.ok && r.outcome === 'caught');
  assert.equal(rogueState('r6'), 'marked');
  assert.equal(rogueState('open6'), 'open');
});

test('joining is refused in jail; quitting works in jail', () => {
  const until = Date.now() + 60_000;
  assert.deepEqual(turnRogue('jailbird', true, until), { ok: false, reason: 'jailed', until });
  assert.equal(isRogue('jailbird'), false);
  setRogue('jailbird', true);
  assert.deepEqual(turnRogue('jailbird', false, Date.now() + 60_000), { ok: true, on: false });
});

test('the v17 fresh start: everyone open (attempts from before it mark nobody), the columns empty', () => {
  const mem = new Database(':memory:');
  for (const sql of MIGRATIONS.slice(0, 16)) mem.exec(sql);
  mem.prepare('INSERT INTO accounts (user_id, balance, last_steal) VALUES (?, ?, ?)').run('old-thief', 40, Date.now() - 60_000);
  mem.exec(MIGRATIONS[16]);
  assert.deepEqual(mem.prepare('SELECT rogue_since, rogue_marked_at, protected_at FROM accounts WHERE user_id = ?').get('old-thief'), { rogue_since: null, rogue_marked_at: null, protected_at: null });
  mem.close();
});

test('rogue, marked and protected outlive a restart', () => {
  // On record now: r1 a marked rogue, r3 marked after quitting, open1 open again (turned rogue, then quit).
  const want = { r1: [isRogue('r1'), rogueState('r1')], r3: [isRogue('r3'), rogueState('r3')], open1: [isRogue('open1'), rogueState('open1')] };
  assert.deepEqual(want, { r1: [true, 'marked'], r3: [false, 'marked'], open1: [false, 'open'] });
  add('safe', 100);
  fresh('r7');
  return withRolls(WIN, () => stealFrom('r7', 'safe', true, 'test')).then(() => {
    assert.equal(rogueState('safe'), 'protected');
    // A second process on the same database: as after the bot restarts.
    const script = join(dir, 'restart.mts');
    const rogueTs = fileURLToPath(new URL('./rogue.ts', import.meta.url));
    writeFileSync(script, `const R = await import(${JSON.stringify(rogueTs)});\nconsole.log(JSON.stringify(Object.fromEntries(['r1', 'r3', 'open1', 'safe'].map((id) => [id, [R.isRogue(id), R.rogueState(id)]]))));\n`);
    const out = spawnSync(process.execPath, ['--conditions=source', '--import', 'tsx', script], { env: { ...process.env, ...env }, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    const seen = JSON.parse(out.stdout.trim().split('\n').at(-1)!);
    assert.deepEqual(seen, { r1: [true, 'marked'], r3: [false, 'marked'], open1: [false, 'open'], safe: [false, 'protected'] });
  });
});

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
