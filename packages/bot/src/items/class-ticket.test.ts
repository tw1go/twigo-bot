import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Bagong Buhay Tickets against a throwaway database (never the real .env or data/).
const dir = mkdtempSync(join(tmpdir(), 'ticket-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { addRenameCards, renameCards, renameWithCard } = await import('./rename-card.js');

const { addClassTickets, classTickets, changeClassWithTicket } = await import('./class-ticket.js');
const { adventureOf, townQuest } = await import('../web/adventure.js');
const { usedSlots } = await import('../dig/bag.js');
const { closeDatabase } = await import('../db/db.js');

test('a Bagong Buhay Ticket changes the class (the new training weapon, quests kept), and is only used when it works', () => {
  // A class first, the Tanod's way.
  const s = adventureOf('a');
  const quest = s.quests.active[0].id;
  townQuest('a', { quest, action: 'talk', npc: 'tanod' });
  townQuest('a', { quest, action: 'chooseClass', cls: 'stick' });
  assert.equal(adventureOf('a').cls, 'stick');
  const done = adventureOf('a').quests.done;

  assert.equal(changeClassWithTicket('a', 'broom').ok, false); // no ticket
  addClassTickets('a', 2);
  assert.equal(usedSlots('a'), 1); // both share one slot
  assert.equal(changeClassWithTicket('a', 'stick').ok, false); // already theirs
  assert.equal(changeClassWithTicket('a', 'wizard').ok, false); // no such class
  assert.equal(classTickets('a'), 2);

  const r = changeClassWithTicket('a', 'broom');
  assert.ok(r.ok);
  const now = adventureOf('a');
  assert.equal(now.cls, 'broom');
  assert.equal(now.equipped.weapon, 'weapon-training-broom');
  assert.ok(!now.bag.includes('weapon-training-stick'), 'the old training weapon goes');
  assert.deepEqual(now.quests.done, done);
  assert.equal(classTickets('a'), 1);

  // No class yet: the Tanod first.
  addClassTickets('b', 1);
  assert.equal(changeClassWithTicket('b', 'broom').ok, false);
  assert.equal(classTickets('b'), 1);
});

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
