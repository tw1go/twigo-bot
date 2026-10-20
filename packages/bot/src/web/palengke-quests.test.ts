import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

// 🏮 The Lumang Palengke's quest chain "Ang Huling Suki" (classes/palengke-leveling.json), against the game's real data
// files and a throwaway database: its 14 quests after the Tanod's; the first starts as you walk in at Lv 21; each next
// one waits for its unlockLevel (the level gap) and opens with a level-up; hunts move on by themselves and are reported
// at an NPC (never the radio); quest items drop only while a quest asks, from its mob, up to its count, each player
// their own, into the Quest pocket, and go as they're handed over; Tisay's note; the Honest Weight for the Great Scale;
// the title.
const dir = mkdtempSync(join(tmpdir(), 'palengke-quests-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { PALENGKE, QUESTS, freshAdventure, questStep, startQuests } = await import('./adventure.js');
const { closeDatabase } = await import('../db/db.js');
const { loadItemData, loadStats } = await import('./stats-data.js');
const { MobRoom, loadMobKinds, loadMobMap } = await import('./town-mobs.js');
const { attachTown } = await import('./town.js');
const { freshProgress } = await import('./progress.js');
type TownServerMessage = import('@mikazuki/shared').TownServerMessage;
const { advanceCollects, addToBag, heldCount, newItem, pocketOf, questItemDrops, questKill, readyToReport, ringBell, startInArea, waitingQuests, xpToNext } = await import('@mikazuki/shared');
type AdventureState = import('@mikazuki/shared').AdventureState;

const D = loadItemData();
const S = loadStats();
const chain = QUESTS.filter((q) => q.id.startsWith('palengke-') && !q.daily);
const q = (n: number) => chain[n - 1];
let uids = 0;
const uid = () => `t${++uids}`;

/** A Stick at a level with 0 XP into it, the Tanod's chain done, the Palengke's quests up to `before` done. */
function at(level: number, done: number = 0): AdventureState {
  const s = freshAdventure();
  s.cls = 'stick';
  s.progress = { ...s.progress, level, xp: 0 };
  s.quests.done = [...QUESTS.filter((x) => !x.id.startsWith('palengke-')).map((x) => x.id), ...chain.slice(0, done).map((x) => x.id)];
  s.quests.rewarded = [...s.quests.done]; // (their rewards given then)
  return s;
}
const stepOf = (s: AdventureState, id: string) => s.quests.active.find((p) => p.id === id)?.step;
const give = (s: AdventureState, id: string, count = 1) => addToBag(D, s.bag, newItem(S, D.defs.get(id)!, uid(), count), uid);
const kill = (s: AdventureState, kind: string, n = 1, mini = false) => {
  for (let i = 0; i < n; i++) questKill(s, QUESTS, { kind, mini });
  advanceCollects(s, QUESTS);
};
const talk = (s: AdventureState, quest: string, npc: string) => questStep(s, { quest, action: 'talk', npc });

test('15 quests after the Tanod\'s (the 15th, Ngayon Na, lets you into Ang Silong), one chain, every one hand-in with its unlock level, Q1 starting in the Palengke', () => {
  assert.equal(chain.length, 15);
  chain.forEach((x, i) => {
    assert.equal(x.next, chain[i + 1]?.id ?? null, `${x.id}'s next`);
    assert.ok(x.handIn && x.unlockLevel! >= 21, x.id);
    // Every one ends at an NPC: a talk (a report) or a delivery.
    assert.ok(['talk', 'deliver'].includes(x.objectives.at(-1)!.type), `${x.id} ends at an NPC`);
  });
  assert.equal(q(1).startsIn, 'palengke');
  assert.deepEqual(q(1).objectives.map((o) => o.npc), ['aling-conching', 'mang-pido']);
  assert.equal(q(14).rewardTitle, 'huling-suki');
  // Bigas, Bigas: the kills with the scoops in hand, then the scoops to Aling Conching.
  assert.deepEqual(q(6).objectives.map((o) => [o.type, o.mob ?? o.item, o.collect?.item]), [['kill', 'sako-slammer', 'clean-rice-scoop'], ['deliver', 'clean-rice-scoop', undefined]]);
  assert.equal(q(6).objectives[0].text, 'Sako Slammers');
});

test('Q1 starts as you walk into the Palengke at Lv 21, not at 20, and not elsewhere', () => {
  assert.deepEqual(startInArea(at(20), QUESTS, 'palengke'), []);
  assert.deepEqual(startInArea(at(21), QUESTS, 'slums'), []);
  const s = at(21);
  assert.deepEqual(startInArea(s, QUESTS, 'palengke').map((x) => x.id), ['palengke-01']);
  assert.deepEqual(startInArea(s, QUESTS, 'palengke'), [], 'once');
  // Its talks: Aling Conching, then Mang Pido; Q2 (Lv 21) comes straight after.
  assert.equal(talk(s, 'palengke-01', 'mang-pido').ok, false, 'Aling Conching first');
  assert.equal(talk(s, 'palengke-01', 'aling-conching').ok, true);
  const r = talk(s, 'palengke-01', 'mang-pido');
  assert.equal(r.completed, 'palengke-01');
  assert.equal(r.kusing, q(1).rewardKusing);
  assert.equal(stepOf(s, 'palengke-02'), 0);
  assert.deepEqual(r.started, undefined, 'started by the completion itself (advance), not a level-up');
});

test('a hunt moves on by itself and is reported at the NPC, never over the radio', () => {
  const s = at(21, 1);
  startQuests(s);
  kill(s, 'payong-flapper', 19);
  assert.equal(stepOf(s, 'palengke-02'), 0);
  kill(s, 'payong-flapper', 1);
  assert.equal(stepOf(s, 'palengke-02'), 1, 'on to Report to Mang Pido');
  assert.equal(q(2).objectives[1].text, 'Report to Mang Pido');
  assert.equal(readyToReport(q(2), s.quests.active.find((p) => p.id === 'palengke-02')), false);
  assert.equal(questStep(s, { quest: 'palengke-02', action: 'report' }).ok, false, 'no radio');
  const r = talk(s, 'palengke-02', 'mang-pido');
  assert.equal(r.completed, 'palengke-02');
  assert.equal(r.xp, q(2).rewardXP);
});

test('the level gap: the next quest waits for its unlockLevel (grey "!"), and opens with the level-up', () => {
  // Q2 done at Lv 21 (its reward's XP short of Lv 23): Q3 waits.
  const s = at(21, 2);
  startQuests(s);
  assert.equal(stepOf(s, 'palengke-03'), undefined);
  assert.deepEqual(waitingQuests(s, QUESTS).map((x) => x.id), ['palengke-03']);
  assert.equal(waitingQuests(s, QUESTS)[0].giver, 'aling-conching');
  s.progress = { ...s.progress, level: 23 };
  assert.deepEqual(startQuests(s).map((x) => x.id), ['palengke-03']);
  assert.deepEqual(waitingQuests(s, QUESTS), []);
  // A report whose XP reaches the next level starts the next quest with it (`started`).
  const t = at(21, 1);
  startQuests(t);
  kill(t, 'payong-flapper', 20);
  t.progress = { ...t.progress, level: 22, xp: xpToNext(S, 22) - 1 };
  const r = talk(t, 'palengke-02', 'mang-pido');
  assert.equal(r.completed, 'palengke-02');
  assert.equal(t.progress.level, 23);
  assert.deepEqual(r.started, ['palengke-03']);
  assert.equal(stepOf(t, 'palengke-03'), 0);
});

test('quest items drop only while a quest asks, from its mob, up to its count; into the Quest pocket; handed over', () => {
  const s = at(23, 2);
  startQuests(s);
  const always = () => 0;
  // Not from another mob, nor before the quest: a Sako Slammer drops no onion, a Sobber at Q2 nothing.
  assert.deepEqual(questItemDrops(s, QUESTS, PALENGKE, 'sako-slammer', always), []);
  assert.deepEqual(questItemDrops(at(21, 1), QUESTS, PALENGKE, 'sibuyas-sobber', always), []);
  // Its dropChance (0.5): a roll at 0.5 or over drops nothing.
  assert.deepEqual(questItemDrops(s, QUESTS, PALENGKE, 'sibuyas-sobber', () => 0.5), []);
  assert.deepEqual(questItemDrops(s, QUESTS, PALENGKE, 'sibuyas-sobber', always), ['fresh-onion']);
  assert.equal(pocketOf(D, { defId: 'fresh-onion' }), 'quest');
  for (let i = 0; i < 11; i++) give(s, 'fresh-onion');
  assert.equal(s.bag.filter((it) => it.defId === 'fresh-onion').length, 1, 'one stack');
  assert.equal(stepOf(s, 'palengke-03'), 0);
  give(s, 'fresh-onion');
  advanceCollects(s, QUESTS);
  assert.equal(stepOf(s, 'palengke-03'), 1, 'all 12: on to Aling Conching');
  assert.deepEqual(questItemDrops(s, QUESTS, PALENGKE, 'sibuyas-sobber', always), [], 'never past its count');
  const r = talk(s, 'palengke-03', 'aling-conching');
  assert.equal(r.completed, 'palengke-03');
  assert.equal(heldCount(s.bag, 'fresh-onion'), 0, 'handed over');
});

test('a hunt that also collects needs both: the kills and the items in hand', () => {
  const s = at(27, 5);
  startQuests(s);
  assert.equal(stepOf(s, 'palengke-06'), 0);
  kill(s, 'sako-slammer', 20);
  assert.equal(stepOf(s, 'palengke-06'), 0, 'no scoops yet');
  assert.deepEqual(questItemDrops(s, QUESTS, PALENGKE, 'sako-slammer', () => 0), ['clean-rice-scoop'], 'scoops still drop once the kills are in');
  give(s, 'clean-rice-scoop', 10);
  advanceCollects(s, QUESTS);
  assert.equal(stepOf(s, 'palengke-06'), 1);
  assert.equal(talk(s, 'palengke-06', 'aling-conching').completed, 'palengke-06');
  assert.equal(heldCount(s.bag, 'clean-rice-scoop'), 0);
});

test("Tisay's note: she hands it over, Aling Conching takes it", () => {
  const s = at(28, 6);
  startQuests(s);
  const r = talk(s, 'palengke-07', 'tisay');
  assert.equal(r.handed, 'tisay-note');
  assert.equal(heldCount(s.bag, 'tisay-note'), 1);
  assert.equal(talk(s, 'palengke-07', 'aling-conching').completed, 'palengke-07');
  assert.equal(heldCount(s.bag, 'tisay-note'), 0);
});

test('a mini boss after the kills: its own kind\'s mini boss only', () => {
  const s = at(24, 3);
  startQuests(s);
  kill(s, 'sibuyas-sobber', 25);
  assert.equal(stepOf(s, 'palengke-04'), 1, 'on to Shallot Holmes');
  kill(s, 'monobloc-stack', 1, true);
  assert.equal(stepOf(s, 'palengke-04'), 1);
  kill(s, 'sibuyas-sobber', 1, true);
  assert.equal(stepOf(s, 'palengke-04'), 2, 'on to Mang Pido');
  assert.equal(talk(s, 'palengke-04', 'mang-pido').completed, 'palengke-04');
});

test('the Great Scale counts only with the Honest Weight in hand, then its bell; the last quest gives the title', () => {
  const s = at(37, 13);
  startQuests(s);
  assert.equal(stepOf(s, 'palengke-14'), 0);
  kill(s, 'great-scale');
  assert.equal(stepOf(s, 'palengke-14'), 0, 'no Honest Weight');
  give(s, 'honest-weight');
  kill(s, 'great-scale');
  assert.equal(stepOf(s, 'palengke-14'), 1, 'on to its bell');
  assert.ok(ringBell(s, QUESTS, 'great-scale'));
  assert.equal(stepOf(s, 'palengke-14'), 2);
  const r = talk(s, 'palengke-14', 'aling-conching');
  assert.equal(r.completed, 'palengke-14');
  assert.equal(r.title, 'huling-suki');
  assert.equal(heldCount(s.bag, 'honest-weight'), 1, 'kept for good');
});

test('the rewards that stay: the Suki Card and the Honest Weight, bound quest items', () => {
  for (const id of ['suki-card', 'honest-weight', 'tisay-note']) {
    assert.ok(D.defs.get(id)?.bound && pocketOf(D, { defId: id }) === 'quest', id);
  }
  const s = at(35, 12);
  startQuests(s);
  kill(s, 'timbangan-sentinel', 20);
  give(s, 'brass-weight', 5);
  advanceCollects(s, QUESTS);
  const r = talk(s, 'palengke-13', 'kuya-jun');
  assert.equal(r.completed, 'palengke-13');
  assert.deepEqual(r.rewards, [{ item: 'honest-weight', count: 1 }]);
  assert.equal(heldCount(s.bag, 'honest-weight'), 1);
});

test("over the town's socket: a chain that starts in a room starts as you join it; a kill's quest items are each member's own loot", async () => {
  const map = loadMobMap('slums');
  const lcg = (seed: number) => () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const room = new MobRoom(map, lcg(16), {}, { shapes: {} }, loadMobKinds());
  const can = room.snapshot(0).find((m) => m.id.startsWith('tin-can-alley:') && !m.mini)!;
  const entered: string[] = [];
  const server = createServer();
  attachTown(server, {
    map: { size: [4, 4], spawn: [1, 1], blocked: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
    rooms: { slums: () => ({ size: map.size, spawn: [can.col + 1, can.row], blocked: map.blocked }) },
    mobs: { slums: room },
    authenticate: async (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('as'),
    profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} as never, cls: 'slingshot' }),
    progress: {
      fighter: (name) => ({ cls: 'slingshot', level: 20, points: name === 'Mara' ? { DEX: 100_000 } : {} }),
      kill: () => ({ progress: freshProgress(S, 'slingshot'), gained: 0, ups: 0 }),
    },
    items: { take: () => ({ ok: true }) as never, usePotion: () => null as never, state: () => ({ equipped: {}, cosmetics: {}, bag: [], kusing: 0 }) },
    quests: {
      kill: () => null,
      enter: (name, r) => (entered.push(`${name}:${r}`), name === 'Bob' ? { active: [{ id: 'palengke-01', step: 0 }] } : null),
      // (Only Bob's quest asks for an onion.)
      drops: (name, kind) => (name === 'Bob' && kind === 'tin-can' ? [newItem(S, D.defs.get('fresh-onion')!, `onion-${name}`)] : []),
    },
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  const open = (as: string) =>
    new Promise<{ ws: WebSocket; got: TownServerMessage[] }>((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?as=${as}&room=slums`);
      const got: TownServerMessage[] = [];
      ws.on('message', (d) => got.push(JSON.parse(String(d))));
      ws.on('open', () => ok({ ws, got }));
    });
  const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
  const a = await open('Mara');
  const b = await open('Bob');
  await wait(100);
  assert.deepEqual(entered, ['Mara:slums', 'Bob:slums']);
  assert.ok(b.got.some((m) => m.t === 'quests'), 'Bob told his quest started');
  assert.ok(!a.got.some((m) => m.t === 'quests'));
  // In a party: Mara's kill drops Bob's onion, for him alone.
  const bobId = (b.got.find((m) => m.t === 'welcome') as Extract<TownServerMessage, { t: 'welcome' }>).you;
  a.ws.send(JSON.stringify({ t: 'party-invite', to: bobId }));
  await wait(100);
  const invite = b.got.find((m) => m.t === 'party-invited') as Extract<TownServerMessage, { t: 'party-invited' }>;
  b.ws.send(JSON.stringify({ t: 'party-answer', invite: invite.invite, accept: true }));
  await wait(100);
  a.ws.send(JSON.stringify({ t: 'attack', mob: can.id, skill: 0 }));
  await wait(200);
  const loot = (got: TownServerMessage[]) => got.filter((m): m is Extract<TownServerMessage, { t: 'loot-drop' }> => m.t === 'loot-drop').flatMap((m) => m.loot);
  const onion = loot(b.got).find((l) => l.item?.defId === 'fresh-onion');
  assert.ok(onion?.mine, "Bob's onion, his to take");
  assert.ok(!loot(a.got).some((l) => l.item?.defId === 'fresh-onion'), 'Mara never sees it');
  for (const c of [a, b]) c.ws.close();
  await new Promise((ok) => server.close(ok));
});

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
