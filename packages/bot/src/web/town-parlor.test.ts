import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The Parlor against a throwaway database, with made-up config (never the real .env or data/).
const dir = mkdtempSync(join(tmpdir(), 'parlor-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { LOOK_COST, parlorAction, townParlor } = await import('./town-parlor.js');
const { saveOutfit } = await import('./outfit.js');
const { giveTitle, titleOf } = await import('./titles.js');
const { add, balance } = await import('../credits/store.js');
const { closeDatabase } = await import('../db/db.js');

const LOOK = { skin: 'light', hair: 'short', hairColour: 'brown', top: 'tshirt', topColour: 'red', topTrim: 'white', bottom: 'jeans', bottomColour: 'blue', bottomTrim: 'blue', shoes: 'sneakers', shoesColour: 'white' };

test(`a new look costs ${LOOK_COST} Kowens and is shown to the town; the same look or too few Kowens is refused`, () => {
  saveOutfit('a', LOOK);
  const seen: string[] = [];
  const restyled = (id: string) => void seen.push(id);
  add('a', 4);
  assert.equal(parlorAction('a', { action: 'look', outfit: { ...LOOK } }, restyled)?.ok, false); // same look: free, nothing happens
  const red = { ...LOOK, hairColour: 'red' };
  const r = parlorAction('a', { action: 'look', outfit: red }, restyled)!;
  assert.ok(r.ok && r.kowens === 1 && r.outfit?.hairColour === 'red');
  assert.deepEqual(seen, ['a']);
  const poor = parlorAction('a', { action: 'look', outfit: LOOK }, restyled)!;
  assert.ok(!poor.ok && balance('a') === 1 && poor.outfit?.hairColour === 'red');
  assert.equal(parlorAction('a', { action: 'look', outfit: { nope: 1 } }, restyled), null); // not a look
});

test('titles: only your own are listed and worn, for free; Townfolk is always there', () => {
  assert.deepEqual(townParlor('b').titles.map((t) => [t.id, t.worn]), [['townfolk', true]]);
  giveTitle('b', 'kalbo');
  giveTitle('b', 'fairy'); // the newest given is worn
  assert.deepEqual(townParlor('b').titles.map((t) => [t.id, t.worn]), [['townfolk', false], ['kalbo', false], ['fairy', true]]);
  const noop = () => {};
  assert.ok(parlorAction('b', { action: 'title', id: 'kalbo' }, noop)?.ok);
  assert.equal(titleOf('b').name, 'Kalbo');
  assert.equal(parlorAction('b', { action: 'title', id: 'game-master' }, noop)?.ok, false); // not theirs
  assert.ok(parlorAction('b', { action: 'title', id: 'townfolk' }, noop)?.ok);
  assert.equal(titleOf('b').name, 'Townfolk');
  assert.deepEqual(townParlor('b').titles.map((t) => t.id), ['townfolk', 'kalbo', 'fairy']); // still has them all
  assert.equal(balance('b'), 0); // titles are free
});

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
