import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The pet cube gift (web/pet-cube-gift.ts), on a throwaway database: once, everyone with a character gets a letter: a
// Pet Selection Cube (bound, claimed into the bag), or 100 Kowens for those who already have a pet (out, in the bag, or
// an unopened pet box); never a second time, and nothing for a character made after.
const dir = mkdtempSync(join(tmpdir(), 'pet-cube-gift-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { sendPetCubeGift, petOwners, KOWENS, CUBE } = await import('./pet-cube-gift.js');
const { mailAction, mailboxOf } = await import('./mail.js');
const { combatOf, newUid, withItems } = await import('./adventure.js');
const { makeItem } = await import('./combat-bag.js');
const { setNickname } = await import('./nickname.js');
const { balance } = await import('../credits/store.js');
const { closeDatabase } = await import('../db/db.js');
const { loadItemData } = await import('./stats-data.js');

const D = loadItemData();
const give = (member: string, defId: string, out = false) =>
  withItems(member, (s) => {
    const it = makeItem(D, defId, {}, newUid)!;
    if (out) s.pet = it;
    else s.bag.push(it);
  });

test('once: a cube for those without a pet, 100 Kowens for those with one (out, in the bag, or a box); never again', () => {
  for (const [id, nick] of [['ana', 'Ana'], ['ben', 'Ben'], ['cy', 'Cy'], ['dee', 'Dee']]) assert.equal(setNickname(id, nick), 'ok');
  give('ben', 'pet-croakyangs', true); // out
  give('cy', 'pet-box-tamtam'); // an unopened box
  give('dee', 'pet-kislap'); // in the bag
  give('nobody', 'pet-wonwuu'); // a pet, but no character: no letter
  assert.deepEqual([...petOwners()].sort(), ['ben', 'cy', 'dee', 'nobody']);

  const sent = sendPetCubeGift(1_000);
  assert.deepEqual(sent, { at: 1_000, cubes: 1, kowens: 3 });
  const [cube] = mailboxOf('ana', 1_000).mail;
  assert.equal(cube.title, 'A pet for you');
  assert.deepEqual(cube.items.map((i) => [i.defId, i.count, i.bound]), [[CUBE, 1, true]]);
  assert.equal(cube.kowens, 0);
  for (const m of ['ben', 'cy', 'dee']) {
    const [k] = mailboxOf(m, 1_000).mail;
    assert.equal(k.kowens, KOWENS, m);
    assert.equal(k.items.length, 0, m);
  }
  assert.equal(mailboxOf('nobody', 1_000).mail.length, 0);

  // Claimed: the cube into Ana's bag, bound; the Kowens into Ben's wallet.
  assert.ok(mailAction('ana', { action: 'claim', id: cube.id }, 1_000).ok);
  assert.deepEqual(combatOf('ana').bag.map((i) => [i.defId, i.bound]), [[CUBE, true]]);
  const before = balance('ben');
  assert.ok(mailAction('ben', { action: 'claim', id: mailboxOf('ben', 1_000).mail[0].id }, 1_000).ok);
  assert.equal(balance('ben'), before + KOWENS);

  // Never a second time, and nothing for a character made after.
  assert.equal(setNickname('eve', 'Eve'), 'ok');
  assert.equal(sendPetCubeGift(2_000), null);
  assert.equal(mailboxOf('ana', 2_000).mail.length, 1);
  assert.equal(mailboxOf('eve', 2_000).mail.length, 0);
});

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
