import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

// 🍲 Aling Conching's dishes and daily orders (classes/palengke-leveling.json `dishes`, `dailies`), against the game's
// real data files and a throwaway database: each dish unlocked by its quest, bought for Kusing, one main and one side at
// a time (a new one replaces its slot), running everywhere, ended by a knock-out, kept through a restart; Lugaw's MP
// regen and Pancit's move speed; Q1's free Lugaw; one daily order a day after the chain, from 4 am Manila, a random
// free dish with it; bought only in the Lumang Palengke (over the town's socket).
const dir = mkdtempSync(join(tmpdir(), 'palengke-dishes-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { PALENGKE, QUESTS, freshAdventure, questStep, startQuests } = await import('./adventure.js');
const { closeDatabase } = await import('../db/db.js');
const { loadItemData, loadStats } = await import('./stats-data.js');
const { Buffs } = await import('./town-buffs.js');
const { MobRoom, loadMobKinds, loadMobMap } = await import('./town-mobs.js');
const { attachTown } = await import('./town.js');
const { freshProgress } = await import('./progress.js');
const { addToBag, dailyDay, derivedStats, dishRefusal, freeDishOf, moveSpeedOf, newItem, startDaily, withBuffs } = await import('@mikazuki/shared');
type AdventureState = import('@mikazuki/shared').AdventureState;
type TownServerMessage = import('@mikazuki/shared').TownServerMessage;

const D = loadItemData();
const S = loadStats();
const DISHES = PALENGKE.dishes!;
const chain = QUESTS.filter((q) => q.id.startsWith('palengke-') && !q.daily);
const dailies = QUESTS.filter((q) => q.daily);
let uids = 0;
const uid = () => `t${++uids}`;
/** 20 Oct 2026, this hour in Manila (UTC+8). */
const manila = (day: number, hour: number, minute = 0) => Date.UTC(2026, 9, day, hour - 8, minute);

/** A Stick at Lv 37 with the Tanod's chain and the Palengke's quests up to `done` done, and Kusing. */
function at(done: number, kusing = 0): AdventureState {
  const s = freshAdventure();
  s.cls = 'stick';
  s.progress = { ...s.progress, level: 37, xp: 0 };
  s.quests.done = [...QUESTS.filter((x) => !x.id.startsWith('palengke-')).map((x) => x.id), ...chain.slice(0, done).map((x) => x.id)];
  s.quests.rewarded = [...s.quests.done];
  s.kusing = kusing;
  return s;
}

test('seven dishes, each unlocked by the quest that says so, six main and Atchara on the side, their effects as stats', () => {
  assert.equal(Object.keys(DISHES).length, 7);
  for (const [id, d] of Object.entries(DISHES)) {
    assert.equal(chain.find((q) => q.id === d.unlockedBy)?.unlocksDish, id, id);
    assert.ok(Object.keys(d.stats).length === 1 && d.minutes === 10, id);
  }
  assert.deepEqual(Object.entries(DISHES).filter(([, d]) => d.slot === 'side').map(([id]) => id), ['atchara']);
  assert.deepEqual(DISHES.lugaw.stats, { mpRegenPct: 0.5 });
  assert.deepEqual(DISHES.pancit.stats, { moveSpeedPct: 0.1 });
});

test('bought once unlocked and paid for: locked says which quest, short says how much', () => {
  assert.equal(dishRefusal(at(1, 10_000), QUESTS, PALENGKE, 'lugaw'), 'Unlocks with Sa Ilalim ng Payong.');
  assert.equal(dishRefusal(at(2, 299), QUESTS, PALENGKE, 'lugaw'), 'You need 300 Kusing.');
  assert.equal(dishRefusal(at(2, 300), QUESTS, PALENGKE, 'lugaw'), null);
  assert.equal(dishRefusal(at(2, 300), QUESTS, PALENGKE, 'tapsilog'), 'No such dish.');
});

test('one main and one side at a time; dishes run on off a battle map, a knock-out ends them, a restart keeps them', () => {
  const b = new Buffs(S);
  const put = (id: string, now: number) => b.giveDish('m', { name: id, slot: DISHES[id].slot, stats: DISHES[id].stats }, 600_000, now);
  put('adobo', 0);
  put('atchara', 0);
  put('bulalo', 1000);
  assert.deepEqual(b.list('m').map((x) => x.name).sort(), ['atchara', 'bulalo'], 'Bulalo replaced Adobo; Atchara stays');
  assert.deepEqual(b.view('m', 1000).map((x) => x.dish).sort(), ['main', 'side']);
  assert.equal(b.endTimed('m'), false, 'leaving a battle map keeps them');
  // Through a restart: kept and put back, minus what ran out meanwhile.
  const kept = b.dishes();
  const again = new Buffs(S);
  again.restoreDishes(kept, 300_000);
  assert.equal(again.view('m', 300_000).find((x) => x.name === 'bulalo')?.ms, 301_000);
  again.restoreDishes(kept, 700_000);
  // Run out on the clock.
  assert.deepEqual(b.tick(600_000), ['m']);
  assert.deepEqual(b.list('m').map((x) => x.name), ['bulalo']);
  assert.equal(b.endDishes('m'), true, 'a knock-out');
  assert.deepEqual(b.list('m'), []);
});

test("Lugaw's MP regen and Pancit's move speed; Kare-kare's amp and Bulalo's HP through the buff rules", () => {
  const d = derivedStats(S, 'stick', 30, { STR: 40, DEX: 20, INT: 20 });
  const fed = withBuffs(S, d, { ...DISHES.lugaw.stats, ...DISHES['kare-kare'].stats, ...DISHES.bulalo.stats });
  assert.equal(fed.mpRegen, d.mpRegen * 1.5);
  assert.equal(fed.amp, d.amp + 0.05);
  assert.equal(fed.hp, Math.round(d.hp * 1.08));
  assert.equal(moveSpeedOf(DISHES.pancit.stats), 1.1);
  assert.equal(moveSpeedOf({}), 1);
});

test("Q1's free bowl of Lugaw", () => {
  const s = at(0);
  startQuests(s);
  s.quests.active.push({ id: 'palengke-01', step: 0 });
  questStep(s, { quest: 'palengke-01', action: 'talk', npc: 'aling-conching' });
  const r = questStep(s, { quest: 'palengke-01', action: 'talk', npc: 'mang-pido' });
  assert.equal(r.completed, 'palengke-01');
  assert.equal(r.dish, 'lugaw');
});

test('the day turns at 4 am Manila', () => {
  assert.equal(dailyDay(PALENGKE, manila(21, 3, 59)), '2026-10-20');
  assert.equal(dailyDay(PALENGKE, manila(21, 4)), '2026-10-21');
});

test('daily orders: one a day once the chain is done, never into done, a random dish of yours with it', () => {
  assert.equal(dailies.length, PALENGKE.dailies!.pool.length);
  assert.ok(dailies.every((q) => q.after === 'palengke-14' && q.giver === 'aling-conching' && q.rewardXP === 2000 && q.rewardKusing === 250_001));
  assert.equal(startDaily(at(13), QUESTS, PALENGKE, manila(20, 12)), null, 'not before the chain is done');
  const s = at(14);
  const now = manila(20, 12);
  const q = startDaily(s, QUESTS, PALENGKE, now, () => 0)!;
  assert.equal(q.id, 'palengke-daily-unbroken-lid');
  assert.equal(startDaily(s, QUESTS, PALENGKE, now), null, 'one at a time');
  assert.equal(q.objectives[0].count, 8);
  addToBag(D, s.bag, newItem(S, D.defs.get('unbroken-lid')!, uid(), 8), uid);
  const r = questStep(s, { quest: q.id, action: 'talk', npc: 'aling-conching' }, { now });
  assert.equal(r.completed, q.id);
  assert.equal(r.xp, 2000);
  assert.equal(r.kusing, 250_001);
  assert.ok(r.dish && s.quests.done.includes(DISHES[r.dish].unlockedBy), `a dish of theirs: ${r.dish}`);
  assert.ok(!s.quests.done.includes(q.id), 'never into done');
  assert.equal(s.quests.dailyDone, dailyDay(PALENGKE, now));
  assert.equal(startDaily(s, QUESTS, PALENGKE, manila(21, 3)), null, 'not until 4 am');
  assert.ok(startDaily(s, QUESTS, PALENGKE, manila(21, 4)), 'the next day');
  // A free dish with nothing unlocked (never: Lugaw comes with Q2) would be Lugaw.
  assert.equal(freeDishOf(at(0), QUESTS, PALENGKE, 'random'), 'lugaw');
});

test("over the town's socket: dishes are bought only in the Lumang Palengke, and show in the buff tray", async () => {
  const map = loadMobMap('slums');
  const lcg = (seed: number) => () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const room = new MobRoom(map, lcg(1), {}, { shapes: {} }, loadMobKinds());
  const mob = room.snapshot(0)[0];
  const bought: string[] = [];
  let saved: unknown = null;
  const server = createServer();
  const town = attachTown(server, {
    map: { size: [4, 4], spawn: [1, 1], blocked: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
    rooms: { palengke: () => ({ size: map.size, spawn: [mob.col + 1, mob.row], blocked: map.blocked }) },
    mobs: { palengke: room },
    authenticate: async (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('as'),
    profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} as never, cls: 'stick' }),
    progress: { fighter: () => ({ cls: 'stick', level: 30, points: {} }), kill: () => ({ progress: freshProgress(S, 'stick'), gained: 0, ups: 0 }) },
    dishes: { buy: (name, dish) => (dish === 'adobo' ? (bought.push(`${name}:${dish}`), null) : 'Unlocks with Bigas, Bigas.'), save: (all) => (saved = all) },
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  const open = (as: string, r: string) =>
    new Promise<{ ws: WebSocket; got: TownServerMessage[] }>((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?as=${as}${r ? `&room=${r}` : ''}`);
      const got: TownServerMessage[] = [];
      ws.on('message', (d) => got.push(JSON.parse(String(d))));
      ws.on('open', () => ok({ ws, got }));
    });
  const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
  const dish = (got: TownServerMessage[]) => got.filter((m): m is Extract<TownServerMessage, { t: 'dish' }> => m.t === 'dish');
  const town1 = await open('Away', '');
  const pal = await open('Here', 'palengke');
  await wait(100);
  town1.ws.send(JSON.stringify({ t: 'dish-buy', dish: 'adobo' }));
  pal.ws.send(JSON.stringify({ t: 'dish-buy', dish: 'sinigang' }));
  await wait(100);
  pal.ws.send(JSON.stringify({ t: 'dish-buy', dish: 'adobo' }));
  await wait(150);
  assert.deepEqual(dish(town1.got).map((m) => [m.ok, m.message]), [[false, 'Aling Conching serves them in the Lumang Palengke.']]);
  assert.deepEqual(dish(pal.got).map((m) => [m.dish, m.ok, m.message]), [['sinigang', false, 'Unlocks with Bigas, Bigas.'], ['adobo', true, undefined]]);
  assert.deepEqual(bought, ['Here:adobo']);
  const tray = pal.got.filter((m): m is Extract<TownServerMessage, { t: 'buffs' }> => m.t === 'buffs').at(-1)!;
  assert.deepEqual(tray.buffs.map((b) => [b.name, b.cls, b.dish]), [['adobo', 'dish', 'main']]);
  assert.deepEqual(Object.keys(saved as object), ['Here'], 'kept for a restart');
  // A free one (a quest's), told as such.
  town.serveDish('Here', 'lugaw');
  await wait(100);
  assert.deepEqual(dish(pal.got).at(-1), { t: 'dish', ok: true, dish: 'lugaw', free: true });
  for (const c of [town1, pal]) c.ws.close();
  await new Promise((ok) => server.close(ok));
});

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
