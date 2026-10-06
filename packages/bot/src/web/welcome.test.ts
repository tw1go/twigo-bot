import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The welcome gift against a throwaway database, with made-up config (never the real .env or data/).
const dir = mkdtempSync(join(tmpdir(), 'welcome-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { WELCOME_KOWENS, welcome, welcomeEveryone, welcomeGift, welcomeSeen } = await import('./welcome.js');
const { saveOutfit } = await import('./outfit.js');
const { setNickname } = await import('./nickname.js');
const { balance } = await import('../credits/store.js');
const { closeDatabase } = await import('../db/db.js');

const look = { skin: 'tan', hair: 'crop', hairColour: 'brown', top: 'tshirt', topColour: 'blue', topTrim: 'white', bottom: 'jeans', bottomColour: 'blue', bottomTrim: 'white', shoes: 'sneakers', shoesColour: 'white' } as never;

test('the welcome gift: once, for members with a character (existing ones at startup, new ones as they finish)', () => {
  saveOutfit('old1', look);
  setNickname('old1', 'Old One');
  saveOutfit('old2', look);
  setNickname('old2', 'Old Two');
  saveOutfit('half', look); // no nickname yet: no character
  assert.equal(welcomeEveryone(), 2);
  assert.equal(welcomeEveryone(), 0); // only once
  assert.equal(balance('old1'), WELCOME_KOWENS);
  assert.equal(balance('half'), 0);
  assert.equal(welcomeGift('old1'), WELCOME_KOWENS); // to show
  welcomeSeen('old1');
  assert.equal(welcomeGift('old1'), null);
  assert.equal(balance('old1'), WELCOME_KOWENS);
  // A new player: the look first, then the nickname finishes the character.
  assert.equal(welcome('half'), false);
  setNickname('half', 'Halfway');
  assert.equal(welcome('half'), true);
  assert.equal(welcome('half'), false);
  assert.equal(balance('half'), WELCOME_KOWENS);
});

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
