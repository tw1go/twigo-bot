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
const { adventureOf, gainXpFor, townEquip, townPoints, townQuest } = await import('../web/adventure.js');
const { loadStats } = await import('../web/stats-data.js');
const { skillPointsAt, xpForLevel } = await import('@mikazuki/shared');
const { usedSlots } = await import('../dig/bag.js');
const { closeDatabase } = await import('../db/db.js');

const armorOf = (gear: string) => ['head', 'body', 'hands', 'bottoms', 'feet'].map((slot) => `armor-training-${gear}-${slot}`);

test('a Bagong Buhay Ticket changes the class (the new training gear in the old one\'s places, points back, quests kept), and is only used when it works', () => {
  // A class first, the Tanod's way.
  const s = adventureOf('a');
  const quest = s.quests.active[0].id;
  townQuest('a', { quest, action: 'talk', npc: 'tanod' });
  townQuest('a', { quest, action: 'chooseClass', cls: 'stick' });
  // Lv 5 with a stat point spent; the gauntlets off, in the bag.
  gainXpFor('a', xpForLevel(loadStats(), 5));
  assert.ok(townPoints('a', { action: 'spend', stat: 'STR' }).ok);
  assert.ok(townEquip('a', { action: 'unequip', place: 'hands' }).ok);
  assert.deepEqual(adventureOf('a').bag.map((i) => i.defId), ['low-hp-potion', 'low-mp-potion', 'armor-training-heavy-hands']); // (the quest's potions first)
  assert.equal(adventureOf('a').cls, 'stick');
  const done = adventureOf('a').quests.done;

  assert.equal(changeClassWithTicket('a', 'broom').ok, false); // no ticket
  addClassTickets('a', 2);
  assert.equal(usedSlots('a'), 1); // both share one slot (the gauntlets are in the combat bag)
  assert.equal(changeClassWithTicket('a', 'stick').ok, false); // already theirs
  assert.equal(changeClassWithTicket('a', 'wizard').ok, false); // no such class
  assert.equal(classTickets('a'), 2);

  const r = changeClassWithTicket('a', 'broom');
  assert.ok(r.ok);
  const now = adventureOf('a');
  assert.equal(now.cls, 'broom');
  assert.equal(now.equipped.weapon?.defId, 'weapon-training-broom');
  assert.ok(!now.bag.some((i) => i.defId === 'weapon-training-stick'), 'the old training weapon goes');
  // The Light armor where the Heavy was: worn, and the gloves in the bag where the gauntlets were.
  const light = armorOf('light');
  assert.deepEqual([now.equipped.head, now.equipped.body, now.equipped.hands, now.equipped.bottoms, now.equipped.feet].map((i) => i?.defId), [light[0], light[1], undefined, light[3], light[4]]);
  assert.deepEqual(now.bag.map((i) => i.defId), ['low-hp-potion', 'low-mp-potion', light[2]]);
  // Every stat and skill point back; the level stays.
  assert.deepEqual([now.progress.level, now.progress.points, now.progress.statPoints, now.progress.skillPoints], [5, {}, 4, skillPointsAt(loadStats(), 5)]);
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
