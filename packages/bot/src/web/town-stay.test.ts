import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Staying in town against a throwaway database, with made-up config (never the real .env or data/).
const dir = mkdtempSync(join(tmpdir(), 'stay-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { STAY_DAILY_CAP, STAY_MINUTES, claimStay, stayInfo, stayMinute } = await import('./town-stay.js');
const { balance } = await import('../credits/store.js');
const { closeDatabase } = await import('../db/db.js');

test('a Kowen every 15 minutes in town: ready, waits until claimed, then the next starts; 20 a day', () => {
  for (let i = 1; i < STAY_MINUTES; i++) assert.deepEqual(stayMinute(['a']), []);
  assert.equal(claimStay('a').ok, false); // not yet
  assert.deepEqual(stayMinute(['a', 'b']), ['a']); // 15 minutes
  for (let i = 0; i < 40; i++) stayMinute(['a']); // waits while one is ready
  assert.deepEqual(stayInfo('a'), { ready: true, minutes: 0, every: STAY_MINUTES, claimed: 0, max: STAY_DAILY_CAP });
  const c = claimStay('a');
  assert.ok(c.ok && c.kowens === 1 && !c.stay.ready && c.stay.claimed === 1);
  assert.equal(claimStay('a').ok, false); // only once
  assert.equal(stayInfo('b').minutes, 1);
  // Up to the cap, then no more counting today.
  for (let n = 1; n < STAY_DAILY_CAP; n++) {
    for (let i = 0; i < STAY_MINUTES; i++) stayMinute(['a']);
    assert.ok(claimStay('a').ok);
  }
  assert.equal(balance('a'), STAY_DAILY_CAP);
  for (let i = 0; i < STAY_MINUTES * 2; i++) assert.deepEqual(stayMinute(['a']), []);
  assert.deepEqual(stayInfo('a'), { ready: false, minutes: 0, every: STAY_MINUTES, claimed: STAY_DAILY_CAP, max: STAY_DAILY_CAP });
});

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
