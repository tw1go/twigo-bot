import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The leaderboard's records against a throwaway database, with made-up config (never the real .env or data/).
const dir = mkdtempSync(join(tmpdir(), 'records-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { clearRankOf, golemBestOf, lineupOf, recordClear, recordGolem, topClears, topGolem } = await import('./records.js');
const { closeDatabase } = await import('../db/db.js');

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});

test('a line-up is the same members in any order, once each', () => {
  assert.equal(lineupOf(['b', 'a', 'c']), 'a,b,c');
  assert.equal(lineupOf(['a', 'b', 'a']), 'a,b');
});

test('clears: one row per line-up with its best time; quickest first, the earlier of a tie first', () => {
  assert.equal(recordClear(['ana', 'ben'], 600_000, 1000), true);
  assert.equal(recordClear(['ben', 'ana'], 700_000, 2000), false); // the same line-up, slower: kept as it was
  assert.equal(recordClear(['ben', 'ana'], 500_000, 3000), true); // quicker: its new best
  assert.equal(recordClear(['cai'], 500_000, 4000), true); // a tie with the pair's: after it
  assert.equal(recordClear(['ana'], 800_000, 5000), true); // Ana alone: a line-up of its own
  assert.equal(recordClear(['dan'], 0, 6000), false);
  assert.deepEqual(topClears(10), [
    { members: ['ana', 'ben'], ms: 500_000, at: 3000 },
    { members: ['cai'], ms: 500_000, at: 4000 },
    { members: ['ana'], ms: 800_000, at: 5000 },
  ]);
  assert.deepEqual(topClears(1).length, 1);
  assert.deepEqual(clearRankOf('ana'), { rank: 1, ms: 500_000 }); // her quickest line-up
  assert.deepEqual(clearRankOf('cai'), { rank: 2, ms: 500_000 });
  assert.equal(clearRankOf('dan'), null);
});

test("golem: each member's most in one fight; highest first, the earlier of a tie first", () => {
  assert.deepEqual(recordGolem(new Map([['ana', 30_000], ['ben', 12_000], ['cai', 0]]), 1000), ['ana', 'ben']);
  assert.deepEqual(recordGolem(new Map([['ana', 20_000], ['ben', 40_000]]), 2000), ['ben']); // Ana's was better
  assert.deepEqual(recordGolem(new Map([['dan', 40_000]]), 3000), ['dan']); // a tie with Ben's: after it
  assert.deepEqual(topGolem(10), [
    { userId: 'ben', damage: 40_000, at: 2000 },
    { userId: 'dan', damage: 40_000, at: 3000 },
    { userId: 'ana', damage: 30_000, at: 1000 },
  ]);
  assert.deepEqual(golemBestOf('dan'), { rank: 2, damage: 40_000 });
  assert.deepEqual(golemBestOf('ana'), { rank: 3, damage: 30_000 });
  assert.equal(golemBestOf('cai'), null);
});
