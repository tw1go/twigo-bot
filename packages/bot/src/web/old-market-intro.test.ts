import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 🏮 The Tanod's The Market Up North (quests.json tanod-13): after his chain, it waits for Lv 21 (a grey "!" with his own
// line), starts then, and its visit is made as you walk into the Old Market (or at once if you've been before); then
// it's reported over his radio for its rewards. Against the game's real data and a throwaway database.
const dir = mkdtempSync(join(tmpdir(), 'old-market-intro-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { QUESTS, adventureOf, enterAreaFor, freshAdventure, questStep, startQuests } = await import('./adventure.js');
const { areasBeen, questVisit, readyToReport, waitingQuests } = await import('@mikazuki/shared');
type AdventureState = import('@mikazuki/shared').AdventureState;

const INTRO = QUESTS.find((q) => q.id === 'tanod-13')!;

/** A Stick at a level, the Tanod's chain to Shell Shock done. */
function at(level: number): AdventureState {
  const s = freshAdventure();
  s.cls = 'stick';
  s.progress = { ...s.progress, level, xp: 0 };
  s.quests.done = QUESTS.filter((q) => q.giver === 'tanod' && q.id !== INTRO.id).map((q) => q.id);
  s.quests.rewarded = [...s.quests.done];
  return s;
}
const active = (s: AdventureState) => s.quests.active.find((p) => p.id === INTRO.id);

test("The Market Up North: after Shell Shock, the Tanod's, guided, a visit to the Old Market at Lv 21; its own waiting line", () => {
  assert.equal(QUESTS.find((q) => q.id === 'tanod-12')?.next, INTRO.id);
  assert.deepEqual([INTRO.giver, INTRO.type, INTRO.guided, INTRO.unlockLevel], ['tanod', 'main', true, 21]);
  assert.deepEqual(INTRO.objectives.map((o) => [o.type, o.area]), [['visit', 'palengke']]);
  assert.match(INTRO.dialogue!.wait![0], /\{level\}/);
  assert.ok(!/dear/.test(INTRO.dialogue!.wait![0]), "the Tanod's own words, not Aling Conching's");
  // At Lv 20 it waits (the grey "!" over the Tanod); at 21 it starts.
  const s = at(20);
  startQuests(s);
  assert.equal(active(s), undefined);
  assert.deepEqual(waitingQuests(s, QUESTS).map((q) => q.id), [INTRO.id]);
  s.progress.level = 21;
  startQuests(s);
  assert.deepEqual(active(s), { id: INTRO.id, step: 0 });
});

test('the visit: made as they walk into the Old Market (not elsewhere), then reported over the radio for its XP, Kusing and Medium potions', () => {
  const s = at(21);
  startQuests(s);
  assert.equal(questStep(s, { quest: INTRO.id, action: 'report' }).ok, false, 'not yet');
  assert.equal(questVisit(s, QUESTS, ['slums']), false);
  assert.equal(readyToReport(INTRO, active(s)), false);
  assert.equal(questVisit(s, QUESTS, ['palengke']), true);
  assert.equal(readyToReport(INTRO, active(s)), true);
  assert.equal(questVisit(s, QUESTS, ['palengke']), false, 'once');
  const r = questStep(s, { quest: INTRO.id, action: 'report' });
  assert.equal(r.completed, INTRO.id);
  assert.equal(r.kusing, INTRO.rewardKusing);
  assert.ok(s.quests.done.includes(INTRO.id));
  assert.deepEqual(['mid-hp-potion', 'mid-mp-potion'].map((id) => s.bag.find((i) => i.defId === id)?.count), [10, 10]);
});

test("been there before it started: the visit's made at once; walking in keeps that they've been (only for a map a visit asks for)", () => {
  const s = at(21);
  s.quests.flags = ['been:palengke'];
  assert.deepEqual(areasBeen(s), ['palengke']);
  startQuests(s);
  assert.equal(readyToReport(INTRO, active(s)), true, 'ready to report straight away');
  // Over the bot's own store: a member walking into the Old Market (no quest of it yet) is kept as having been.
  enterAreaFor('m1', 'palengke');
  assert.ok(adventureOf('m1').quests.flags?.includes('been:palengke'));
  enterAreaFor('m1', 'warrens:abc123');
  assert.ok(!adventureOf('m1').quests.flags?.some((f) => f.startsWith('been:warrens')), 'not a run room');
});
