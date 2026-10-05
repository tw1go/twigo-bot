import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// <Richest Among All> against a throwaway database, with made-up config (never the real .env or data/).
const dir = mkdtempSync(join(tmpdir(), 'richest-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { checkRichest } = await import('./richest.js');
const { RICHEST, giveTitle, newTitle, openTitle, ownedTitles, titleOf, titleSeen, wearTitle } = await import('./titles.js');
const { add, take } = await import('../credits/store.js');
const { closeDatabase } = await import('../db/db.js');

const has = (id: string) => ownedTitles(id).map((t) => t.id).includes(RICHEST);

test('the #1 holds <Richest Among All>: new and announced the first time, lost when overtaken, not announced again', () => {
  assert.equal(checkRichest(), null); // nobody has Kowens yet
  add('a', 50);
  add('b', 20);
  assert.deepEqual(checkRichest(), { won: { userId: 'a', first: true }, lost: null });
  assert.ok(has('a') && !has('b'));
  assert.equal(titleOf('a').name, 'Townfolk'); // held, not worn
  assert.equal(newTitle('a')?.id, RICHEST); // the pop-up
  assert.equal(ownedTitles('a').find((t) => t.id === RICHEST)?.isNew, true); // the NEW tag
  titleSeen('a', RICHEST);
  assert.equal(newTitle('a'), null);
  openTitle('a', RICHEST);
  assert.equal(ownedTitles('a').find((t) => t.id === RICHEST)?.isNew, false);
  assert.ok(wearTitle('a', RICHEST));
  assert.equal(titleOf('a').name, 'Richest Among All');
  assert.equal(checkRichest(), null); // still #1

  add('b', 100); // b overtakes
  assert.deepEqual(checkRichest(), { won: { userId: 'b', first: true }, lost: 'a' });
  assert.ok(!has('a') && has('b'));
  assert.equal(titleOf('a').name, 'Townfolk'); // was wearing it: back to Townfolk
  assert.equal(wearTitle('a', RICHEST), false);

  take('b', 100); // a is back on top: theirs again, worn again (they never took it off), no second pop-up
  assert.deepEqual(checkRichest(), { won: { userId: 'a', first: false }, lost: 'b' });
  assert.equal(titleOf('a').name, 'Richest Among All');
  assert.equal(newTitle('a'), null);
  assert.ok(!has('b'));
  assert.equal(newTitle('b'), null); // b never saw theirs, but no longer holds it: no pop-up for a title that's gone
  add('b', 200);
  assert.deepEqual(checkRichest(), { won: { userId: 'b', first: false }, lost: 'a' });
  assert.equal(newTitle('b')?.id, RICHEST); // back on top: the pop-up they missed
});

test('a given title is new (pop-up + NEW tag) until seen and clicked', () => {
  giveTitle('c', 'kalbo');
  assert.equal(newTitle('c')?.id, 'kalbo');
  assert.equal(ownedTitles('c').find((t) => t.id === 'kalbo')?.isNew, true);
  titleSeen('c'); // an older game: all of them
  assert.equal(newTitle('c'), null);
});

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
