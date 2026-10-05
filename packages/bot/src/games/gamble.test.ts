import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// gambleFor against a throwaway database, with made-up config (never the real .env or data/). Math.random decides.
const dir = mkdtempSync(join(tmpdir(), 'gamble-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { gambleFor, BUST_CHANCE_IN_CHANNEL, WIN_CHANCE, SIXTY_SEVEN_BONUS } = await import('./gamble.js');
const { add, balance } = await import('../credits/store.js');
const { jailedUntil } = await import('./jail.js');
const { addPotions, usePotion, startTago } = await import('../potions/potions.js');
const { closeDatabase } = await import('../db/db.js');

const realRandom = Math.random;
const rolls = (r: number) => (Math.random = () => r);
test.afterEach(() => (Math.random = realRandom));
test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});

test('a win doubles the bet; a loss takes it', async () => {
  add('w', 100);
  rolls(BUST_CHANCE_IN_CHANNEL + 0.01); // just past the raid: a win
  const win = await gambleFor('w', 10, 'safe');
  assert.deepEqual(win.ok && [win.outcome, win.balance], ['win', 110]);
  add('l', 100);
  rolls(BUST_CHANCE_IN_CHANNEL + WIN_CHANCE + 0.01); // past the win: a loss
  const lose = await gambleFor('l', 10, 'safe');
  assert.deepEqual(lose.ok && [lose.outcome, lose.balance], ['lose', 90]);
});

test('a bust takes the bet and jails', async () => {
  add('b', 100);
  rolls(0); // inside the raid chance
  const r = await gambleFor('b', 10, 'safe');
  assert.deepEqual(r.ok && [r.outcome, r.balance], ['bust', 90]);
  assert.ok(jailedUntil('b'));
  const again = await gambleFor('b', 10, 'safe');
  assert.equal(!again.ok && again.reason, 'jailed');
});

test('67 pays a bonus; a Tago Tonic hides you from the raid', async () => {
  add('s', 200);
  rolls(BUST_CHANCE_IN_CHANNEL + 0.01);
  const r = await gambleFor('s', 67, 'safe');
  assert.deepEqual(r.ok && [r.outcome, r.bonus, r.balance], ['win', SIXTY_SEVEN_BONUS, 200 + 67 + SIXTY_SEVEN_BONUS]);

  add('t', 100);
  addPotions('t', 'tago', 1);
  assert.ok(usePotion('t', 'tago'));
  startTago('t');
  rolls(0); // would be a raid anywhere, but the Tanod can't see them
  const hidden = await gambleFor('t', 10, 'elsewhere');
  assert.deepEqual(hidden.ok && [hidden.outcome, hidden.hidden], ['win', true]);
});

test('refuses too soon after a bet, and more than the wallet', async () => {
  add('c', 100);
  rolls(0.9);
  await gambleFor('c', 1, 'safe');
  const soon = await gambleFor('c', 1, 'safe');
  assert.equal(!soon.ok && soon.reason, 'cooldown');
  add('p', 5);
  const broke = await gambleFor('p', 10, 'safe');
  assert.deepEqual(broke, { ok: false, reason: 'kowens', have: 5 });
  assert.equal(balance('p'), 5);
});

test('a bust puts 70% of the bet (rounded down) into the jackpot pot', async () => {
  const { pot, raidMoney } = await import('./jackpot.js');
  const before = raidMoney();
  add('r', 100);
  rolls(0);
  const r = await gambleFor('r', 15, 'safe');
  assert.deepEqual(r.ok && [r.outcome, r.toPot, r.balance], ['bust', 10, 85]); // 70% of 15 = 10.5 → 10
  assert.equal(raidMoney(), before + 10);
  assert.equal(pot(), raidMoney()); // no tickets yet: the pot is the raid money
});

test('balance changes reach the wallet hook once each (the web town reloads that HUD)', async () => {
  const { setWalletHook } = await import('../credits/store.js');
  const seen: string[] = [];
  setWalletHook((id) => seen.push(id));
  add('hud', 5);
  add('hud', 0); // nothing changed: no call
  await gambleFor('hud', 1, 'safe').catch(() => null);
  assert.equal(seen[0], 'hud');
  assert.ok(seen.every((id) => id === 'hud'));
  assert.ok(seen.length >= 1 && seen.length <= 2);
});
