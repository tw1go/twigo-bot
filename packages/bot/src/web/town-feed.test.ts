import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The system feed's Discord channel, against a throwaway database and a pretend Discord (never the real .env or data/).
const dir = mkdtempSync(join(tmpdir(), 'feed-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';
process.env.TOWN_FEED_CHANNEL_ID = 'feed';

const { announce, connectFeedChannel, feed } = await import('./town-feed.js');
const { closeDatabase } = await import('../db/db.js');

test("feed lines and banners reach the feed's channel, gathered into one post, no pings, names' markdown escaped", async () => {
  const sent: { content: string; allowedMentions: unknown }[] = [];
  const client = { channels: { fetch: async (id: string) => (id === 'feed' ? { isSendable: () => true, send: async (m: (typeof sent)[number]) => void sent.push(m) } : null) } };
  feed('dig', 'Before connecting', 'rare'); // not connected yet: stays in town only
  connectFeedChannel(client as never);
  feed('dig', 'Moon dug up a Golden Crown (Legendary)', 'legendary');
  feed('gamble', '*Star* won 20 Kowens at Kara y Krus', 'win');
  announce({ kind: 'notice', title: 'Maintenance', text: 'back in 10 minutes' });
  await new Promise((r) => setTimeout(r, 3300));
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].allowedMentions, { parse: [] });
  assert.deepEqual(sent[0].content.split('\n'), ['⛏️ 🟡 Moon dug up a Golden Crown (Legendary)', '🪙 \\*Star\\* won 20 Kowens at Kara y Krus', '📢 **Maintenance** · back in 10 minutes']);
});

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
