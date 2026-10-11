import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Close beta applications (web/beta.ts) against a throwaway database (never the real data/): the form's checks, one row
// per Discord username, the CMS's list, status and CSV, the IP hash and the rate limit.
const dir = mkdtempSync(join(tmpdir(), 'beta-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { BetaRateLimit, betaCsv, ipHash, listBetaApplications, parseBetaForm, saveBetaApplication, setBetaStatus } = await import('./beta.js');
const { closeDatabase, db } = await import('../db/db.js');

test('the form: a Discord username of 2-32 characters (trimmed, no spaces, a leading @ dropped), a class from the list, a note of 500 at most', () => {
  assert.deepEqual(parseBetaForm({ discord: '  @moonwalker ', class: 'Pot lid', note: ' hi ' }), { ok: true, form: { discordUsername: 'moonwalker', cls: 'Pot lid', note: 'hi' } });
  assert.equal(parseBetaForm({ discord: 'a', class: 'Stick' }).ok, false);
  assert.equal(parseBetaForm({ discord: 'x'.repeat(33), class: 'Stick' }).ok, false);
  assert.equal(parseBetaForm({ discord: 'moon walker', class: 'Stick' }).ok, false);
  assert.equal(parseBetaForm({ discord: 'moon', class: 'Wizard' }).ok, false);
  assert.equal(parseBetaForm({ discord: 'moon', class: 'Not sure yet', note: 'x'.repeat(501) }).ok, false);
  assert.equal(parseBetaForm({ discord: 'moon', class: 'Not sure yet' }).ok, true, 'no note is fine');
  assert.equal(parseBetaForm(null).ok, false);
});

test('one row per Discord username: a repeat (any case) updates it, its status kept; logged in, the same Discord id does too', () => {
  const first = saveBetaApplication({ discordUsername: 'Moonwalker', cls: 'Broom', note: '' }, null, '203.0.113.5', 1000);
  assert.equal(first.updated, false);
  assert.equal(first.application.status, 'new');
  setBetaStatus(first.application.id, 'contacted', 1500);
  const again = saveBetaApplication({ discordUsername: 'moonwalker', cls: 'Hilot', note: 'changed my mind' }, null, '203.0.113.5', 2000);
  assert.equal(again.updated, true);
  assert.equal(again.application.id, first.application.id);
  assert.deepEqual([again.application.cls, again.application.note, again.application.status, again.application.createdAt, again.application.updatedAt], ['Hilot', 'changed my mind', 'contacted', 1000, 2000]);
  // Logged in: their id goes with it, and a new username under the same id is the same application.
  const mine = saveBetaApplication({ discordUsername: 'starry', cls: 'Stick', note: '' }, '111', null, 3000);
  const renamed = saveBetaApplication({ discordUsername: 'starry_night', cls: 'Stick', note: '' }, '111', null, 4000);
  assert.equal(renamed.application.id, mine.application.id);
  assert.deepEqual([renamed.application.discordUsername, renamed.application.discordId], ['starry_night', '111']);
  assert.equal((db.prepare('SELECT count(*) AS n FROM beta_applications').get() as { n: number }).n, 2);
});

test('the IP is only kept as a salted hash', () => {
  const row = db.prepare("SELECT ip_hash FROM beta_applications WHERE discord_username = 'moonwalker'").get() as { ip_hash: string };
  assert.match(row.ip_hash, /^[0-9a-f]{64}$/);
  assert.equal(row.ip_hash, ipHash('203.0.113.5'));
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM beta_applications').all()).includes('203.0.113.5'));
});

test('the CMS: newest first, search by username, filter by status and class, a status change, CSV for a spreadsheet', () => {
  saveBetaApplication({ discordUsername: 'cool_cat', cls: 'Broom', note: '=HYPERLINK("x")' }, null, null, 5000);
  assert.deepEqual(listBetaApplications().map((a) => a.discordUsername), ['cool_cat', 'starry_night', 'moonwalker']);
  assert.deepEqual(listBetaApplications({ q: 'MOON' }).map((a) => a.discordUsername), ['moonwalker']);
  assert.deepEqual(listBetaApplications({ q: '_' }).map((a) => a.discordUsername), ['cool_cat', 'starry_night'], 'an underscore is a letter, not a wildcard');
  assert.deepEqual(listBetaApplications({ status: 'contacted' }).map((a) => a.discordUsername), ['moonwalker']);
  assert.deepEqual(listBetaApplications({ cls: 'Broom' }).map((a) => a.discordUsername), ['cool_cat']);
  const cat = listBetaApplications({ q: 'cool' })[0];
  assert.equal(setBetaStatus(cat.id, 'invited', 6000)?.status, 'invited');
  assert.equal(setBetaStatus(cat.id, 'hired', 6000), null, 'not a status');
  assert.equal(setBetaStatus(9999, 'invited', 6000), null, 'no such one');
  const csv = betaCsv(listBetaApplications({ q: 'cool' }));
  assert.equal(csv.split('\n')[0], 'id,discord_username,discord_id,class,note,status,created_at,updated_at');
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`), 'a formula made plain text');
});

test('a few applications an hour from one address', () => {
  const limit = new BetaRateLimit(3);
  const t = 10_000_000;
  assert.deepEqual([1, 2, 3, 4].map((i) => limit.allow('ip', t + i)), [true, true, true, false]);
  assert.equal(limit.allow('other', t), true);
  assert.equal(limit.allow('ip', t + 3_600_002), true, 'an hour later');
});

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
