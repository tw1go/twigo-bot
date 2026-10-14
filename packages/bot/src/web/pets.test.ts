import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';

// Pets (@mikazuki/shared pets.ts, against the game's real stats.json `pets` and items.json): opening a box (bound, Lv 1),
// sending out and calling back, the swap rule, Pet XP (the table, the cap, one gain a second over the town's socket),
// the pet tree's unlock rule and stats (caps hold), Fairy Cha's drop rate, the store's prices, and schema v16.
const dir = mkdtempSync(join(tmpdir(), 'pets-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const shared = await import('@mikazuki/shared');
const { PetXpClock, bagSlots, baseStats, boxPrice, callBackPet, derivedStats, dropRefusal, gainPetXp, itemTotals, newItem, nodeOpen, openPetBox, petPointsLeft, petRules, petSwapRefusal, petTotals, petXpForHit, petXpToNext, resetPetPoints, sendOutPet, setPetLevel, spendPetPoint, stackLimit, tradeRefusal, OPEN_BOX_FIRST } = shared;
type Item = import('@mikazuki/shared').Item;
type AdventureState = import('@mikazuki/shared').AdventureState;
type CombatItemDef = import('@mikazuki/shared').CombatItemDef;
type TownServerMessage = import('@mikazuki/shared').TownServerMessage;
const { loadItemData } = await import('./stats-data.js');
const { combatWares, buyCombat } = await import('./combat-bag.js');
const { sellPrice } = shared;
const { MIGRATIONS, closeDatabase } = await import('../db/db.js');
const { MobRoom, loadMobKinds, loadMobMap } = await import('./town-mobs.js');
const { attachTown } = await import('./town.js');
const { freshAdventure } = await import('./adventure.js');
const { parsePetAction } = shared;
const { freshProgress } = await import('./progress.js');

const D = loadItemData();
const S = D.stats;
const R = petRules(S)!;
let n = 0;
const uid = () => `u${++n}`;
const box = (pet: string, count = 1) => newItem(S, D.defs.get(`pet-box-${pet}`) as CombatItemDef, uid(), count);
const bagWith = (...items: Item[]): AdventureState => ({ ...freshAdventure(), bag: items });

test('the pets block: seven pets, the tree fills with 20 points at Lv 20, the XP table adds up to 1,745,600', () => {
  assert.deepEqual(Object.keys(R.list), ['fork-of-jord', 'croakyangs', 'wonwuu', 'pittuki', 'tamtam', 'kislap', 'fairy-cha']);
  assert.equal(Object.values(R.tree).reduce((s, t) => s + t.max, 0), 20);
  let total = 0;
  for (let l = 1; l < R.levelCap; l++) total += petXpToNext(R, l);
  assert.equal(total, 1_745_600);
  assert.equal(petXpToNext(R, 1), 2600);
  assert.equal(petXpToNext(R, 19), 215_300);
  assert.equal(petXpToNext(R, 20), 0, 'MAX');
  // The table is 2600 × level^1.5 rounded to 100.
  for (let l = 1; l < 20; l++) assert.equal(petXpToNext(R, l), Math.round((2600 * l ** 1.5) / 100) * 100);
  for (const id of Object.keys(R.list)) {
    assert.ok(D.defs.get(`pet-${id}`), `pet-${id}`);
    assert.ok(D.defs.get(`pet-box-${id}`), `pet-box-${id}`);
  }
});

test('opening a box: the box goes, a bound Lv 1 pet with no XP or points comes; a stack needs a free slot; a pet never stacks', () => {
  const s = bagWith(box('croakyangs'));
  const r = openPetBox(D, s, s.bag[0].uid, uid);
  assert.ok(r.ok);
  assert.equal(s.bag.length, 1);
  const pet = s.bag[0];
  assert.equal(pet.defId, 'pet-croakyangs');
  assert.equal(pet.bound, true, 'binds when opened');
  assert.equal(pet.level, 1);
  assert.equal(pet.xp, 0);
  assert.deepEqual(pet.points, {});
  assert.equal(tradeRefusal(D, pet), "Bound items can't be traded.");
  assert.equal(dropRefusal(D, pet), "Bound items can't be dropped.");
  assert.equal(sellPrice(D, pet), null, 'never sold');
  assert.equal(stackLimit(S, D.defs.get('pet-croakyangs')), 1);
  // Boxes stack to 99, can be traded and dropped, but the store doesn't buy them back.
  const b = box('wonwuu', 3);
  assert.equal(stackLimit(S, D.defs.get('pet-box-wonwuu')), 99);
  assert.equal(tradeRefusal(D, b), null);
  assert.equal(dropRefusal(D, b), null);
  assert.equal(sellPrice(D, b), null);
  // A stack of three: one opened, two left, the pet in a new slot; a full bag refuses (nothing changes).
  const t = bagWith(b);
  assert.ok(openPetBox(D, t, b.uid, uid).ok);
  assert.equal(t.bag.find((i) => i.defId === 'pet-box-wonwuu')!.count, 2);
  assert.equal(t.bag.filter((i) => i.defId === 'pet-wonwuu').length, 1);
  const full = bagWith(box('tamtam', 2), ...Array.from({ length: bagSlots(S) - 1 }, () => newItem(S, D.defs.get('low-hp-potion')!, uid(), 99)));
  const before = JSON.stringify(full.bag);
  assert.deepEqual(openPetBox(D, full, full.bag[0].uid, uid), { ok: false, message: 'Make room in your bag first.' });
  assert.equal(JSON.stringify(full.bag), before);
  assert.equal(openPetBox(D, bagWith(newItem(S, D.defs.get('low-hp-potion')!, 'p', 1)), 'p', uid).ok, false);
});

test('sending out and calling back: a box is refused ("Open the box first."), the old pet swaps back, a full bag keeps it out; never in a fight or within 30 s', () => {
  const s = bagWith(box('kislap'));
  assert.deepEqual(sendOutPet(D, s, s.bag[0].uid), { ok: false, message: OPEN_BOX_FIRST });
  openPetBox(D, s, s.bag[0].uid, uid);
  const kislap = s.bag[0];
  assert.ok(sendOutPet(D, s, kislap.uid).ok);
  assert.equal(s.pet?.uid, kislap.uid);
  assert.equal(s.bag.length, 0);
  s.bag.push({ ...newItem(S, D.defs.get('pet-tamtam')!, 'tam'), bound: true, xp: 0, points: {} });
  assert.ok(sendOutPet(D, s, 'tam').ok);
  assert.equal(s.pet?.uid, 'tam');
  assert.deepEqual(s.bag.map((i) => i.uid), [kislap.uid], 'the one out before back where the new one was');
  assert.ok(callBackPet(D, s).ok);
  assert.equal(s.pet, null);
  assert.equal(callBackPet(D, s).ok, false);
  const full = { ...bagWith(...Array.from({ length: bagSlots(S) }, () => newItem(S, D.defs.get('low-hp-potion')!, uid(), 99))), pet: kislap };
  assert.deepEqual(callBackPet(D, full), { ok: false, message: 'Your bag is full.' });
  assert.equal(petSwapRefusal(R, undefined, 0, false), null);
  assert.equal(petSwapRefusal(R, undefined, 0, true), "Can't change pets during a fight.");
  assert.equal(petSwapRefusal(R, 1000, 1000 + 29_000, false), 'You can change pets again in 1 s.');
  assert.equal(petSwapRefusal(R, 1000, 1000 + 30_000, false), null);
});

test('Pet XP: levels up through the table, stops at Lv 20 (XP 0, MAX); a hit gives the highest monster level it hit (a Lv 13 one: 13)', () => {
  const pet: Item = { ...newItem(S, D.defs.get('pet-croakyangs')!, 'p'), bound: true, xp: 0, points: {} };
  assert.deepEqual(gainPetXp(R, pet, 2599), { ups: 0, gained: 2599 });
  assert.deepEqual(gainPetXp(R, pet, 1 + 7400 + 5), { ups: 2, gained: 7406 });
  assert.equal(pet.level, 3);
  assert.equal(pet.xp, 5);
  gainPetXp(R, pet, 10_000_000);
  assert.equal(pet.level, 20);
  assert.equal(pet.xp, 0);
  assert.deepEqual(gainPetXp(R, pet, 13), { ups: 0, gained: 0 }, 'nothing past the cap');
  assert.equal(petXpForHit([13]), 13);
  assert.equal(petXpForHit([4, 13, 9]), 13, 'one gain per swing: the highest level');
  assert.equal(petXpForHit([]), 0);
});

test('the throttle: one gain a second per member, whatever the swing hit', () => {
  const clock = new PetXpClock(1000);
  assert.equal(clock.take('mara', 0), true);
  assert.equal(clock.take('mara', 400), false);
  assert.equal(clock.take('mara', 999), false);
  assert.equal(clock.take('bob', 500), true, 'each member their own');
  assert.equal(clock.take('mara', 1000), true);
  assert.equal(clock.take('mara', 1500), false);
});

test('the pet tree: a point a level (Lv 1 too); ATK stays locked until HP and DEF are both 3/3; Attack rate and Crit rate need ATK maxed; Reset gives every point back', () => {
  const pet: Item = { ...newItem(S, D.defs.get('pet-croakyangs')!, 'p'), bound: true, xp: 0, points: {} };
  assert.equal(petPointsLeft(R, pet), 1, 'one point at Lv 1');
  setPetLevel(R, pet, 20);
  assert.equal(petPointsLeft(R, pet), 20);
  assert.equal(nodeOpen(R, pet, 'atk'), false);
  assert.equal(spendPetPoint(R, pet, 'atk'), 'Needs HP 3/3 and DEF 3/3 first.');
  for (let i = 0; i < 3; i++) assert.equal(spendPetPoint(R, pet, 'hp'), null);
  assert.equal(spendPetPoint(R, pet, 'hp'), "That's maxed.");
  assert.equal(spendPetPoint(R, pet, 'atk'), 'Needs HP 3/3 and DEF 3/3 first.', 'still locked with DEF at 0');
  for (let i = 0; i < 2; i++) spendPetPoint(R, pet, 'def');
  assert.equal(nodeOpen(R, pet, 'atk'), false, 'DEF 2/3');
  spendPetPoint(R, pet, 'def');
  assert.equal(nodeOpen(R, pet, 'atk'), true);
  assert.equal(spendPetPoint(R, pet, 'critRate'), 'Needs ATK 3/3 first.');
  for (let i = 0; i < 3; i++) spendPetPoint(R, pet, 'atk');
  for (const node of ['atkRate', 'atkRate', 'atkRate', 'amp', 'amp', 'critRate', 'critRate', 'critRate', 'critDmg', 'critDmg', 'critDmg'] as const) assert.equal(spendPetPoint(R, pet, node), null, node);
  assert.equal(petPointsLeft(R, pet), 0, 'all 20 in');
  assert.deepEqual(petTotals(R, pet, 'croakyangs'), { hp: 12, def: 6, atk: 9, atkRate: 0.015, amp: 0.035, critRate: 0.015, critDamage: 0.09 });
  assert.equal(resetPetPoints(pet), true);
  assert.equal(petPointsLeft(R, pet), 20);
  assert.equal(resetPetPoints(pet), false, 'none spent');
  // A level below the points spent (dev's ?petlevel=) gives them all back.
  for (let i = 0; i < 3; i++) spendPetPoint(R, pet, 'hp');
  setPetLevel(R, pet, 2);
  assert.equal(petPointsLeft(R, pet), 2);
  // No point without one left.
  const fresh: Item = { ...pet, uid: 'q', level: 1, points: { hp: 1 } };
  assert.equal(spendPetPoint(R, fresh, 'hp'), 'No pet points left.');
});

test('a pet out adds to its owner like gear lines (never STR, DEX or INT), within the caps; Fairy Cha gives +2.3% drop rate from Lv 1', () => {
  const maxed = (id: string): Item => ({ ...newItem(S, D.defs.get(`pet-${id}`)!, id), bound: true, level: 20, xp: 0, points: { hp: 3, def: 3, atk: 3, atkRate: 3, amp: 2, critRate: 3, critDmg: 3 } });
  const base = baseStats(S, 'slingshot', 20, {});
  const bare = derivedStats(S, 'slingshot', 20, base, itemTotals(D, [], 'DEX'));
  const withPet = derivedStats(S, 'slingshot', 20, base, itemTotals(D, [maxed('croakyangs')], 'DEX'));
  assert.equal(withPet.hp - bare.hp, 12);
  assert.equal(withPet.def - bare.def, 6);
  assert.equal(withPet.power - bare.power, 9);
  assert.equal(+(withPet.critRate - bare.critRate).toFixed(4), 0.015);
  assert.equal(+(withPet.critDamage - bare.critDamage).toFixed(4), 0.09);
  assert.equal(withPet.STR, bare.STR);
  assert.equal(withPet.DEX, bare.DEX);
  assert.equal(withPet.dropRate, 0);
  const cha: Item = { ...newItem(S, D.defs.get('pet-fairy-cha')!, 'cha'), bound: true, xp: 0, points: {} };
  assert.equal(derivedStats(S, 'slingshot', 20, base, itemTotals(D, [cha], 'DEX')).dropRate, 0.023);
  // The caps still hold: crit rate stays at 50% however much DEX.
  const huge = baseStats(S, 'slingshot', 20, { DEX: 100_000 });
  assert.equal(derivedStats(S, 'slingshot', 20, huge, itemTotals(D, [maxed('croakyangs')], 'DEX')).critRate, S.caps.critRate);
});

test('the sari-sari store\'s Pets tab: each common box 100 Kowens, Fairy Cha\'s 200; buying needs a free slot', () => {
  const pets = combatWares(D, 1).filter((w) => w.tab === 'pets');
  assert.equal(pets.length, 7);
  for (const w of pets) assert.equal(w.currency, 'kowens');
  assert.equal(pets.find((w) => w.def.id === 'pet-box-croakyangs')!.cost, 100);
  assert.equal(pets.find((w) => w.def.id === 'pet-box-fairy-cha')!.cost, 200);
  assert.equal(boxPrice(D, 'pet-box-fairy-cha'), 200);
  assert.equal(boxPrice(D, 'low-hp-potion'), null);
  let wallet = 250;
  const kowens = { get have() { return wallet; }, spend: (k: number) => (wallet >= k ? ((wallet -= k), true) : false) };
  const s = bagWith();
  assert.ok(buyCombat(D, s, 1, 'pet-box-fairy-cha', 1, kowens, uid).ok);
  assert.equal(wallet, 50);
  assert.equal(s.bag[0].defId, 'pet-box-fairy-cha');
  assert.equal(s.bag[0].bound, false, 'a box is tradable');
  const full = bagWith(...Array.from({ length: bagSlots(S) }, () => newItem(S, D.defs.get('low-hp-potion')!, uid(), 99)));
  wallet = 500;
  assert.equal(buyCombat(D, full, 1, 'pet-box-tamtam', 1, kowens, uid).ok, false);
  assert.equal(wallet, 500);
});

test('POST /town/pet bodies', () => {
  assert.deepEqual(parsePetAction({ action: 'open', item: 'abc' }), { action: 'open', item: 'abc' });
  assert.deepEqual(parsePetAction({ action: 'out', item: 'abc' }), { action: 'out', item: 'abc' });
  assert.deepEqual(parsePetAction({ action: 'back' }), { action: 'back' });
  assert.deepEqual(parsePetAction({ action: 'spend', node: 'critDmg' }), { action: 'spend', node: 'critDmg' });
  assert.equal(parsePetAction({ action: 'spend', node: 'luck' }), null);
  assert.equal(parsePetAction({ action: 'out' }), null);
});

test('schema v16: a pet\'s XP and points columns, nothing else changed', () => {
  const mem = new Database(':memory:');
  for (const sql of MIGRATIONS.slice(0, 15)) mem.exec(sql);
  mem.prepare("INSERT INTO items (uid, owner, def_id, level, rarity, place, created) VALUES ('a', 'm', 'rough-whetstone', 1, 'white', NULL, 1)").run();
  mem.exec(MIGRATIONS[15]);
  assert.deepEqual(mem.prepare('SELECT uid, xp, points FROM items').all(), [{ uid: 'a', xp: 0, points: null }]);
  mem.close();
});

test('over the town\'s socket: hits on monsters give the pet out their level, at most once a second; no pet, nothing', async () => {
  const map = loadMobMap('slums');
  // (Four skills, each its own cooldown: one swing every 0.6 s lands, well past the 0.4 s swing limit.)
  const room = new MobRoom(map, () => 0.5, { slingshot: [1, 1, 1, 1] }, { shapes: {} }, loadMobKinds());
  // A Scrap Crab (Lv 13: lots of HP, so four swings don't kill it; its shell may block, which still counts as a hit).
  const zone = map.mobZones!.find((z) => z.mob === 'scrap-crab')!;
  const crab = room.snapshot(0).find((m) => m.id.startsWith(`${zone.id}:`) && !m.id.includes(':mini:'))!;
  const gains: { who: string; n: number }[] = [];
  const pet: Item = { ...newItem(S, D.defs.get('pet-croakyangs')!, 'croak'), bound: true, xp: 0, points: {} };
  const server = createServer();
  attachTown(server, {
    map: { size: [4, 4], spawn: [1, 1], blocked: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
    rooms: { slums: () => ({ size: map.size, spawn: [crab.col + 1, crab.row], blocked: map.blocked }) },
    mobs: { slums: room },
    authenticate: async (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('as'),
    profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} as never, cls: 'slingshot', pet: name === 'Mara' ? 'croakyangs' : null }),
    progress: {
      fighter: () => ({ cls: 'slingshot', level: 20, points: {} }),
      kill: () => ({ progress: freshProgress(S, 'slingshot'), gained: 0, ups: 0 }),
    },
    pets: {
      xp: (who, k) => {
        gains.push({ who, n: k });
        gainPetXp(R, pet, k);
        return { pet, ups: 0 };
      },
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
  const mara = await open('Mara');
  const bob = await open('Bob');
  // (Whatever happens below, the sockets and the server close: a failed check must fail the run, never hang it.)
  try {
  await wait(100);
  // Bob sees Mara's pet in the room's list.
  const welcome = bob.got.find((m) => m.t === 'welcome') as Extract<TownServerMessage, { t: 'welcome' }>;
  assert.equal(welcome.players.find((p) => p.nickname === 'Mara')?.pet, 'croakyangs');
  // Four swings 0.6 s apart (the swing limit is 0.4 s); Bob (no pet) swings once too. The crab can fall before the last
  // (its shell open at the wrong moment), so what's expected comes from the swings of hers that landed: a gain at the
  // first, then at each one a second or more after the last gain (0 s and 1.2 s; 0.2 s or more of slack either way).
  bob.ws.send(JSON.stringify({ t: 'attack', mob: crab.id, skill: 0 }));
  for (let i = 0; i < 4; i++) {
    mara.ws.send(JSON.stringify({ t: 'attack', mob: crab.id, skill: i }));
    await wait(600);
  }
  await wait(150);
  const you = (mara.got.find((m) => m.t === 'welcome') as Extract<TownServerMessage, { t: 'welcome' }>).you;
  const hits = mara.got.filter((m): m is Extract<TownServerMessage, { t: 'mob-hit' }> => m.t === 'mob-hit' && m.by === you && m.hits.some((h) => !h.miss));
  assert.ok(hits.length >= 2, `at least two of her swings landed (${hits.length})`);
  let last = -Infinity;
  const expected = Array.from({ length: hits.length }, (_, i) => i * 600).filter((at) => (at - last >= 1000 ? ((last = at), true) : false)).length;
  const level = crab.level;
  assert.equal(level, 13, 'a Lv 13 monster gives 13');
  assert.deepEqual(gains, Array.from({ length: expected }, () => ({ who: 'Mara', n: level })), `Mara ${expected} times in ${hits.length} landed swings, Bob (no pet) never`);
  const told = mara.got.filter((m): m is Extract<TownServerMessage, { t: 'pet-xp' }> => m.t === 'pet-xp');
  assert.equal(told.length, expected);
  assert.equal(told.at(-1)!.pet.xp, expected * level);
  } finally {
    mara.ws.close();
    bob.ws.close();
    server.closeAllConnections();
    await new Promise<void>((ok) => server.close(() => ok()));
  }
});

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
