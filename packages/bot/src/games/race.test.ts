import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The Mosang race's script against a throwaway database, with made-up config (never the real .env or data/).
const dir = mkdtempSync(join(tmpdir(), 'race-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { finishMs, laneAt, raceScript } = await import('./race-script.js');
const { closeDatabase } = await import('../db/db.js');

test('the race script: the first over the line wins, and the town and Discord read positions from it alike', () => {
  for (let i = 0; i < 200; i++) {
    const s = raceScript(5);
    const times = s.lanes.map(finishMs);
    assert.equal(s.ms, Math.min(...times));
    assert.equal(times[s.winner], s.ms);
    if (s.tie >= 0) assert.ok(Math.abs(times[s.tie] - s.ms) < 1e-6, 'a photo finish crosses together');
    for (const l of s.lanes) {
      // Starts at 0, never goes back, reaches the line exactly at its finish time.
      let last = 0;
      for (let t = 0; t <= finishMs(l); t += 250) {
        const { at } = laneAt(l, t);
        assert.ok(at >= last - 1e-9 && at <= 1);
        last = at;
      }
      assert.ok(Math.abs(laneAt(l, finishMs(l)).at - 1) < 1e-9);
      assert.equal(laneAt(l, 0).at, 0);
      // A stop holds her where it is, for as long as it lasts.
      for (const stop of l.stops) {
        let t = 0;
        while (laneAt(l, t).stop !== stop) t += 10;
        assert.equal(laneAt(l, t).at, stop.at);
        assert.equal(laneAt(l, t + stop.ms - 20).at, stop.at);
      }
    }
  }
});

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
