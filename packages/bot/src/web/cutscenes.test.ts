import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 🎬 Cutscenes watched and waiting (CONTEXT.md Cutscene; shared quests.ts markCutscene): kept with the quests in a
// throwaway database (never the real .env or data/), so each plays once on every device; POST /town/quest
// { action: 'cutscene' }.
const dir = mkdtempSync(join(tmpdir(), 'cutscenes-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { parseQuestAction, townQuest } = await import('./adventure.js');
const { closeDatabase } = await import('../db/db.js');
const { markCutscene } = await import('@mikazuki/shared');
type Quests = import('@mikazuki/shared').AdventureState['quests'];

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});

test('a cutscene seen is kept once; one due waits until it is seen, and never comes due again after', () => {
  const q: Quests = { active: [], done: [] };
  assert.equal(markCutscene(q, 'golem-reveal', 'due'), true);
  assert.deepEqual(q.cutscenesDue, ['golem-reveal']);
  assert.equal(markCutscene(q, 'golem-reveal', 'due'), false, 'already waiting');
  assert.equal(markCutscene(q, 'golem-reveal', 'seen'), true);
  assert.deepEqual(q.cutscenesSeen, ['golem-reveal']);
  assert.equal(q.cutscenesDue, undefined, 'off the due list');
  assert.equal(markCutscene(q, 'golem-reveal', 'seen'), false, 'seen once');
  assert.equal(markCutscene(q, 'golem-reveal', 'due'), false, 'seen: never due again');
  assert.equal(markCutscene(q, 'Not An Id!', 'seen'), false);
  assert.equal(markCutscene(q, 'x'.repeat(41), 'seen'), false);
  for (let i = 0; i < 60; i++) markCutscene(q, `scene-${i}`, 'seen');
  assert.equal(q.cutscenesSeen!.length, 50, 'the list keeps its last 50');
});

test('POST /town/quest takes a cutscene mark (anything else of that shape is refused), saved with their quests', () => {
  assert.deepEqual(parseQuestAction({ action: 'cutscene', cutscene: 'huling-suki', mark: 'seen' }), { action: 'cutscene', cutscene: 'huling-suki', mark: 'seen' });
  assert.equal(parseQuestAction({ action: 'cutscene', cutscene: 'huling-suki', mark: 'watched' }), null);
  assert.equal(parseQuestAction({ action: 'cutscene', mark: 'seen' }), null);
  assert.deepEqual(parseQuestAction({ quest: 'palengke-01', action: 'talk', npc: 'aling-conching' }), { quest: 'palengke-01', action: 'talk', npc: 'aling-conching' });
  const due = townQuest('cutscene-user', { action: 'cutscene', cutscene: 'golem-reveal', mark: 'due' });
  assert.equal(due.ok, true);
  assert.deepEqual(due.adventure.quests.cutscenesDue, ['golem-reveal']);
  townQuest('cutscene-user', { action: 'cutscene', cutscene: 'golem-reveal', mark: 'seen' });
  // (Loaded again from the database: another device sees the same.)
  const again = townQuest('cutscene-user', { action: 'cutscene', cutscene: 'town-arrival', mark: 'seen' });
  assert.deepEqual(again.adventure.quests.cutscenesSeen, ['golem-reveal', 'town-arrival']);
  assert.equal(again.adventure.quests.cutscenesDue, undefined);
});
