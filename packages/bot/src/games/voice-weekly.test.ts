import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from 'discord.js';

// 🎙️ The weekly voice rewards against a throwaway database (never the real data/): a new week keeps the old week's
// minutes aside, so Monday noon's payout ranks the week before as it was, members in voice since midnight included
// (the week of 2026-10-05 was paid to the wrong people before that); paid once; the week after ranks on its own.
const dir = mkdtempSync(join(tmpdir(), 'voice-weekly-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { addVoiceMinute, balance, topVoiceWeek } = await import('../credits/store.js');
const { payWeeklyVoice, WEEKLY_VC_REWARDS } = await import('./voice-weekly.js');

const minutes = (ids: string[], n: number, day: string) => {
  for (let i = 0; i < n; i++) addVoiceMinute(ids, day);
};

/** A client whose games channel keeps what was sent. */
const fakeClient = (sent: string[]) =>
  ({ channels: { fetch: async () => ({ isSendable: () => true, send: async (m: { content: string }) => void sent.push(m.content) }) } }) as unknown as Client;

test('a new week keeps the old week aside: Monday morning voice no longer wipes last week', () => {
  // Ana: 300 min in the week of 2026-10-05 (Sunday the 11th), then in voice from Monday the 12th's first minutes.
  minutes(['ana'], 300, '2026-10-11');
  minutes(['ana'], 40, '2026-10-12');
  // Ben: 120 min that week, nothing since. Cid: only this week.
  minutes(['ben'], 120, '2026-10-10');
  minutes(['cid'], 90, '2026-10-12');
  assert.deepEqual(topVoiceWeek('2026-10-05', 10), [['ana', 300], ['ben', 120]], 'last week as it was');
  assert.deepEqual(topVoiceWeek('2026-10-12', 10), [['cid', 90], ['ana', 40]], 'this week on its own');
  assert.deepEqual(topVoiceWeek('2026-09-28', 10), [], 'two weeks back is gone');
});

test('Monday noon pays last week once, by the kept counts', async () => {
  const sent: string[] = [];
  const before = { ana: balance('ana'), ben: balance('ben'), cid: balance('cid') };
  await payWeeklyVoice(fakeClient(sent), '2026-10-12');
  assert.equal(balance('ana') - before.ana, WEEKLY_VC_REWARDS[0], 'first');
  assert.equal(balance('ben') - before.ben, WEEKLY_VC_REWARDS[1], 'second');
  assert.equal(balance('cid') - before.cid, 0, 'only this week: nothing');
  assert.equal(sent.length, 1);
  assert.match(sent[0], /week of 2026-10-05/);
  assert.match(sent[0], /🥇 <@ana> — 5h 0m · \*\*\+50\*\*/);
  assert.match(sent[0], /🥈 <@ben> — 2h 0m · \*\*\+30\*\*/);
  assert.doesNotMatch(sent[0], /cid/);
  // Again the same week (a restart, a second run): nothing more.
  await payWeeklyVoice(fakeClient(sent), '2026-10-13');
  assert.equal(balance('ana') - before.ana, WEEKLY_VC_REWARDS[0]);
  assert.equal(sent.length, 1);
});

test('the week after: this week becomes last week, the one before is dropped', async () => {
  minutes(['ana'], 10, '2026-10-19');
  assert.deepEqual(topVoiceWeek('2026-10-12', 10), [['cid', 90], ['ana', 40]]);
  assert.deepEqual(topVoiceWeek('2026-10-05', 10), [['ben', 120]], "ana's week of the 5th is gone, ben's untouched");
  const sent: string[] = [];
  await payWeeklyVoice(fakeClient(sent), '2026-10-19');
  assert.match(sent[0], /week of 2026-10-12/);
  assert.match(sent[0], /🥇 <@cid> — 1h 30m/);
  assert.match(sent[0], /🥈 <@ana> — 40m/);
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
