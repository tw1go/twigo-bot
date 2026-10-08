import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

// Trading (web/trade.ts, @mikazuki/shared trade.ts) against the game's real data files: requests (answered, declined,
// lapsed), one trade at a time, any change unlocking both, Trade only once both are locked, what can go in (bound and
// training gear refused), settling (everything checked again: still owned and unchanged, Kusing, room in each bag with
// stacks; all or nothing); over the town's socket (distance, cancel on walking away, closing or leaving); and the
// `trades` log with both members' items saved in one transaction (adventure.ts tradeFor) on a throwaway database.
const dir = mkdtempSync(join(tmpdir(), 'trade-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { equipFromBag, newItem, rollGear, tradeRefusal, tradeRules } = await import('@mikazuki/shared');
type Item = import('@mikazuki/shared').Item;
type EquipmentDef = import('@mikazuki/shared').EquipmentDef;
type CombatItemDef = import('@mikazuki/shared').CombatItemDef;
type TownServerMessage = import('@mikazuki/shared').TownServerMessage;
const { loadItemData } = await import('./stats-data.js');
const { Trades, checkOffer, settleTrade } = await import('./trade.js');
const { attachTown } = await import('./town.js');
const { combatOf, freshAdventure, tradeFor, withItems } = await import('./adventure.js');
const { db } = await import('../db/db.js');
type HeldOffer = import('./trade.js').HeldOffer;

const D = loadItemData();
const S = D.stats;
const R = tradeRules(S);
const gear = (id: string) => D.defs.get(id) as EquipmentDef;
const thing = (id: string) => D.defs.get(id) as CombatItemDef;
let n = 0;
const uid = () => `u${++n}`;
/** A seeded random (the same rolls every run). */
const lcg = (seed: number) => () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const sword = (rarity: Item['rarity'] = 'darkBlue') => rollGear(S, gear('weapon-sturdy-stick'), rarity, uid(), lcg(n + 1));
const stones = (count: number) => newItem(S, thing('rough-whetstone'), uid(), count);
const holder = (bag: Item[] = [], kusing = 0) => ({ ...freshAdventure(), bag, kusing });

test('the numbers come from stats.json trading.flow: 5 tiles, 20 s to answer, 8 items a side', () => {
  assert.deepEqual(R, { range: 5, timeoutMs: 20_000, slots: 8 });
});

test('requests: answered yes opens a trade, no closes it, an unanswered one lapses; one at a time each', () => {
  const T = new Trades(R);
  assert.deepEqual(T.ask('alice', 'alice', 0), { ok: false, reason: 'self' });
  const a = T.ask('alice', 'bob', 0);
  assert.ok(a.ok);
  // One request out at a time, and one waiting for each player.
  assert.deepEqual(T.ask('alice', 'cara', 1), { ok: false, reason: 'asked' });
  assert.deepEqual(T.ask('cara', 'bob', 1), { ok: false, reason: 'busy' });
  // Declined: no trade, the request gone.
  const no = T.answer('bob', a.ask.id, false, 2);
  assert.ok(no.ok && !no.trade);
  assert.deepEqual(T.answer('bob', a.ask.id, true, 3), { ok: false, reason: 'expired' });
  assert.equal(T.of('alice'), null);
  // Only the one asked can answer.
  const b = T.ask('alice', 'bob', 10);
  assert.ok(b.ok);
  assert.deepEqual(T.answer('cara', b.ask.id, true, 11), { ok: false, reason: 'expired' });
  // Lapsed after 20 s: pruned (the asker hears), and too late to accept.
  assert.deepEqual(T.prune(10 + R.timeoutMs - 1), []);
  assert.deepEqual(T.prune(10 + R.timeoutMs).map((x) => x.id), [b.ask.id]);
  assert.deepEqual(T.answer('bob', b.ask.id, true, 10 + R.timeoutMs), { ok: false, reason: 'expired' });
  // Accepted: the trade opens for both, empty and unlocked.
  const c = T.ask('bob', 'alice', 100);
  assert.ok(c.ok);
  const yes = T.answer('alice', c.ask.id, true, 101);
  assert.ok(yes.ok && yes.trade);
  assert.deepEqual(yes.trade.users, ['bob', 'alice']);
  assert.equal(T.of('alice'), T.of('bob'));
  assert.deepEqual([yes.trade.locked, yes.trade.confirmed, yes.trade.offers], [[false, false], [false, false], [{ items: [], kusing: 0 }, { items: [], kusing: 0 }]]);
  // Trading already: nobody can ask either of them, nor they anyone.
  assert.deepEqual(T.ask('cara', 'alice', 102), { ok: false, reason: 'busy' });
  assert.deepEqual(T.ask('alice', 'cara', 102), { ok: false, reason: 'busy' });
  // Someone leaving: their requests go.
  const d = T.ask('cara', 'dan', 103);
  assert.ok(d.ok);
  assert.deepEqual(T.dropAsks('dan').map((x) => x.id), [d.ask.id]);
  assert.equal(T.end('alice')?.id, yes.trade.id);
  assert.equal(T.of('bob'), null);
});

test('locking: Trade only once both are locked; any change to a side (or an unlock) unlocks both and takes Trade back', () => {
  const T = new Trades(R);
  const a = T.ask('alice', 'bob', 0);
  assert.ok(a.ok);
  const r = T.answer('bob', a.ask.id, true, 1);
  assert.ok(r.ok && r.trade);
  const t = r.trade;
  assert.equal(T.confirm('alice'), null, 'nothing locked yet');
  T.lock('alice', true);
  assert.equal(T.confirm('alice'), null, 'only one side locked');
  T.lock('bob', true);
  assert.deepEqual(T.confirm('alice')?.both, false);
  assert.deepEqual(t.confirmed, [true, false]);
  // Bob changes his side: both unlocked, Alice's Trade taken back.
  T.offer('bob', { items: [], kusing: 5 });
  assert.deepEqual([t.locked, t.confirmed, t.offers[1].kusing], [[false, false], [false, false], 5]);
  T.lock('alice', true);
  T.lock('bob', true);
  T.confirm('bob');
  // An unlock takes Trade back too.
  T.lock('alice', false);
  assert.deepEqual([t.locked, t.confirmed], [[false, true], [false, false]]);
  T.lock('alice', true);
  assert.equal(T.confirm('alice')?.both, false);
  assert.equal(T.confirm('bob')?.both, true);
});

test('what can go in: items in the combat bag (not worn), never bound or training gear, up to the stack, 8 at most, Kusing they have', () => {
  const blue = sword();
  const orange = sword('darkOrange');
  const training = newItem(S, gear('weapon-training-stick'), uid());
  const pile = stones(30);
  const c = holder([blue, orange, training, pile], 100);
  assert.equal(tradeRefusal(D, blue), null);
  assert.equal(tradeRefusal(D, training), "Training gear can't be traded.");
  const ok = checkOffer(D, c, { items: [{ uid: blue.uid, count: 1 }, { uid: pile.uid, count: 12 }], kusing: 100 }, R.slots);
  assert.ok(ok.ok);
  assert.deepEqual(ok.offer.items.map((i) => [i.uid, i.count]), [[blue.uid, 1], [pile.uid, 12]]);
  assert.equal(pile.count, 30, 'the bag itself is untouched');
  const bad = (offer: { items: { uid: string; count: number }[]; kusing: number }) => {
    const r = checkOffer(D, c, offer, R.slots);
    return r.ok ? 'ok' : r.message;
  };
  assert.equal(bad({ items: [{ uid: training.uid, count: 1 }], kusing: 0 }), "Training gear can't be traded.");
  assert.equal(bad({ items: [{ uid: pile.uid, count: 31 }], kusing: 0 }), 'You have 30 of those.');
  assert.equal(bad({ items: [{ uid: pile.uid, count: 0 }], kusing: 0 }), 'You have 30 of those.');
  assert.equal(bad({ items: [{ uid: blue.uid, count: 1 }, { uid: blue.uid, count: 1 }], kusing: 0 }), "That can't go in.");
  assert.equal(bad({ items: [], kusing: 101 }), 'You have 100 Kusing.');
  assert.equal(bad({ items: [], kusing: 1.5 }), "That can't go in.");
  assert.equal(bad({ items: Array.from({ length: 9 }, () => ({ uid: pile.uid, count: 1 })), kusing: 0 }), '8 items at most.');
  // Worn: not in the bag. An orange item binds as it's worn, and stays bound once taken off.
  c.cls = 'stick';
  c.progress.level = 20;
  c.progress.points = { DEX: 200 };
  assert.ok(equipFromBag(D, c, orange.uid).ok, 'worn');
  assert.equal(bad({ items: [{ uid: orange.uid, count: 1 }], kusing: 0 }), 'Only items in your combat bag can be traded.');
  c.bag.push(c.equipped.weapon!);
  delete c.equipped.weapon;
  assert.equal(bad({ items: [{ uid: orange.uid, count: 1 }], kusing: 0 }), "Bound items can't be traded.");
});

/** A held side: copies of these items (with how many) and Kusing. */
const held = (items: [Item, number][], kusing = 0): HeldOffer => ({ items: items.map(([i, count]) => ({ ...structuredClone(i), count })), kusing });

test('settling: items and Kusing change hands; a whole stack keeps its uid, part of one leaves as a new item, stacks merge', () => {
  const blue = sword();
  const pile = stones(30);
  const potions = newItem(S, thing('low-hp-potion'), uid(), 5);
  const a = holder([blue, pile], 500);
  const b = holder([stones(10), potions], 40);
  const r = settleTrade(D, [a, b], [held([[blue, 1], [pile, 12]], 200), held([[potions, 5]], 40)], ['Alice', 'Bob'], uid);
  assert.ok(r.ok);
  assert.deepEqual(a.bag.map((i) => [i.defId, i.count]), [['rough-whetstone', 18], ['low-hp-potion', 5]]);
  assert.equal(a.bag[1].uid, potions.uid, 'a whole stack keeps its uid');
  assert.deepEqual(b.bag.map((i) => [i.defId, i.count]), [['rough-whetstone', 22], ['weapon-sturdy-stick', 1]], 'the stones onto Bob\'s stack');
  assert.equal(b.bag[1].uid, blue.uid);
  assert.deepEqual(b.bag[1].lines, blue.lines, 'rolls and all');
  assert.deepEqual([a.kusing, b.kusing], [500 - 200 + 40, 40 - 40 + 200]);
  assert.deepEqual(r.gave.map((g) => [g.items.map((i) => [i.uid, i.count]), g.kusing]), [[[[blue.uid, 1], [pile.uid, 12]], 200], [[[potions.uid, 5]], 40]]);
});

test('settling is all or nothing: no room, Kusing spent, an item gone, changed or bound since moves nothing at all', () => {
  const fill = (k: number) => Array.from({ length: k }, () => sword('brown'));
  const check = (a: ReturnType<typeof holder>, b: ReturnType<typeof holder>, offers: [HeldOffer, HeldOffer], want: RegExp) => {
    const before = structuredClone([a, b]);
    const r = settleTrade(D, [a, b], offers, ['Alice', 'Bob'], uid);
    assert.ok(!r.ok && want.test(r.message), r.ok ? 'went through' : r.message);
    assert.deepEqual([a, b], before, 'neither touched');
  };
  // Bob's bag is full (40); Alice's sword can't go in, though his stones go out to her.
  const blue = sword();
  {
    const a = holder([blue], 0);
    const bob = holder(fill(40), 0);
    check(a, bob, [held([[blue, 1]]), held([])], /Bob's combat bag has no room/);
    // …but it fits if something of his goes out in its place.
    const r = settleTrade(D, [a, bob], [held([[blue, 1]]), held([[bob.bag[0], 1]])], ['Alice', 'Bob'], uid);
    assert.ok(r.ok);
    assert.deepEqual([a.bag.length, bob.bag.length], [1, 40]);
  }
  // Stacks count: a full bag with room on its stone stack takes stones, not more than that.
  {
    const a = holder([stones(500)], 0);
    const bob = holder([...fill(39), stones(990)], 0);
    check(a, bob, [held([[a.bag[0], 10]]), held([])], /no room/);
    assert.ok(settleTrade(D, [a, bob], [held([[a.bag[0], 9]]), held([])], ['Alice', 'Bob'], uid).ok);
    assert.equal(bob.bag[39].count, 999);
  }
  // Kusing spent meanwhile.
  {
    const a = holder([], 50);
    check(a, holder([], 0), [held([], 60), held([])], /Alice doesn't have 60 Kusing anymore/);
  }
  // An item used up, gone or changed since it was put in (enhanced, broken, worn and bound…).
  {
    const pile = stones(5);
    const offer = held([[pile, 5]]);
    const a = holder([pile], 0);
    pile.count = 4;
    check(a, holder(), [offer, held([])], /isn't in their bag as it was/);
    const s2 = sword();
    const offer2 = held([[s2, 1]]);
    s2.plus = 3;
    check(holder([s2]), holder(), [offer2, held([])], /isn't in their bag as it was/);
    const s3 = sword();
    const offer3 = held([[s3, 1]]);
    check(holder([]), holder(), [offer3, held([])], /isn't in their bag as it was/);
  }
  // One side fine, the other's check fails: still nothing moves on either side.
  {
    const s4 = sword();
    const a = holder([s4], 100);
    const b = holder([stones(3)], 0);
    check(a, b, [held([[s4, 1]], 100), held([[b.bag[0], 4]])], /Bob's Rough Whetstone isn't in their bag as it was/);
  }
});

test('the town: ask within 5 tiles, accept, put in, lock, a change unlocks both, Trade by both moves it; walking away, cancelling, declining and leaving', async () => {
  const bags = new Map<string, ReturnType<typeof holder>>();
  const bagOf = (name: string) => bags.get(name) ?? bags.set(name, holder([], 0)).get(name)!;
  const blue = sword();
  bagOf('Alice').bag.push(blue, newItem(S, gear('weapon-training-stick'), uid()));
  bagOf('Alice').kusing = 300;
  bagOf('Bob').bag.push(stones(20));
  const size = 20;
  const server = createServer();
  attachTown(server, {
    map: { size: [size, size], spawn: [10, 10], blocked: Array.from({ length: size }, () => Array(size).fill(0)) },
    authenticate: async (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('as'),
    profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} as never }),
    items: {
      take: () => false,
      usePotion: () => null,
      state: (name) => bagOf(name),
      trade: (users, offers, names) => settleTrade(D, [bagOf(users[0]), bagOf(users[1])], offers, names, uid),
    },
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
  /** Connects someone and puts them at (col, row) (`here`, right after the welcome). */
  const open = async (as: string, col: number, row: number) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?as=${as}`);
    const got: TownServerMessage[] = [];
    ws.on('message', (d) => got.push(JSON.parse(String(d))));
    await new Promise((ok) => ws.on('open', ok));
    await wait(30);
    const send = (m: object) => ws.send(JSON.stringify(m));
    send({ t: 'here', col, row, dir: 's' });
    const id = (got.find((m) => m.t === 'welcome') as Extract<TownServerMessage, { t: 'welcome' }>).you;
    const last = <K extends TownServerMessage['t']>(t: K) => [...got].reverse().find((m) => m.t === t) as Extract<TownServerMessage, { t: K }> | undefined;
    return { ws, got, send, id, last };
  };
  const alice = await open('Alice', 10, 10);
  const bob = await open('Bob', 15, 10); // 5 tiles: near enough
  const cara = await open('Cara', 4, 10); // 6 from Alice: too far
  await wait(50);
  // Too far.
  cara.send({ t: 'trade-ask', to: alice.id });
  await wait(50);
  assert.deepEqual([cara.last('trade-refused')?.reason, alice.last('trade-asked')], ['far', undefined]);
  // Asked and declined.
  alice.send({ t: 'trade-ask', to: bob.id });
  await wait(50);
  const asked = bob.last('trade-asked')!;
  assert.deepEqual([asked.name, asked.from, asked.ms], ['Alice', alice.id, 20_000]);
  bob.send({ t: 'trade-answer', ask: asked.ask, accept: false });
  await wait(50);
  assert.deepEqual([alice.last('trade-refused')?.reason, alice.last('trade-refused')?.name], ['declined', 'Bob']);
  // Asked again (a second later: one request a second) and accepted: the window for both.
  await wait(1000);
  alice.send({ t: 'trade-ask', to: bob.id });
  await wait(50);
  bob.send({ t: 'trade-answer', ask: bob.last('trade-asked')!.ask, accept: true });
  await wait(50);
  assert.deepEqual([alice.last('trade')?.trade.them.name, bob.last('trade')?.trade.them.name, alice.last('trade')?.trade.with], ['Bob', 'Alice', bob.id]);
  // Training gear refused (the window stays); the sword and 120 Kusing go in; Bob puts in 8 stones.
  alice.send({ t: 'trade-offer', items: [{ uid: bagOf('Alice').bag[1].uid, count: 1 }], kusing: 0 });
  await wait(50);
  assert.equal(alice.last('trade-bad')?.message, "Training gear can't be traded.");
  alice.send({ t: 'trade-offer', items: [{ uid: blue.uid, count: 1 }], kusing: 120 });
  bob.send({ t: 'trade-offer', items: [{ uid: bagOf('Bob').bag[0].uid, count: 8 }], kusing: 0 });
  await wait(50);
  const seen = bob.last('trade')!.trade;
  assert.deepEqual([seen.them.items.map((i) => i.uid), seen.them.kusing, seen.you.items[0].count], [[blue.uid], 120, 8]);
  // Trade before locking: refused. Both lock; Bob changes his side: both unlocked, and both told.
  alice.send({ t: 'trade-confirm' });
  await wait(50);
  assert.equal(alice.last('trade-bad')?.message, 'Both sides lock first.');
  alice.send({ t: 'trade-lock', on: true });
  bob.send({ t: 'trade-lock', on: true });
  await wait(50);
  assert.deepEqual([alice.last('trade')!.trade.you.locked, alice.last('trade')!.trade.them.locked], [true, true]);
  bob.send({ t: 'trade-offer', items: [{ uid: bagOf('Bob').bag[0].uid, count: 10 }], kusing: 0 });
  await wait(50);
  const after = alice.last('trade')!;
  assert.deepEqual([after.trade.you.locked, after.trade.them.locked, after.note], [false, false, 'Bob changed their side: both unlocked.']);
  // Lock again, both press Trade: everything moves; both get their items and the end.
  alice.send({ t: 'trade-lock', on: true });
  bob.send({ t: 'trade-lock', on: true });
  await wait(50);
  alice.send({ t: 'trade-confirm' });
  await wait(50);
  assert.equal(alice.last('trade')!.trade.you.confirmed, true);
  assert.equal(bagOf('Bob').bag.length, 1, 'nothing moved yet');
  bob.send({ t: 'trade-confirm' });
  await wait(50);
  assert.deepEqual([alice.last('trade-end')?.reason, bob.last('trade-end')?.reason], ['done', 'done']);
  assert.deepEqual(bagOf('Alice').bag.map((i) => [i.defId, i.count]), [['weapon-training-stick', 1], ['rough-whetstone', 10]]);
  assert.deepEqual(bagOf('Bob').bag.map((i) => [i.defId, i.count]), [['rough-whetstone', 10], ['weapon-sturdy-stick', 1]]);
  assert.deepEqual([bagOf('Alice').kusing, bagOf('Bob').kusing], [180, 120]);
  assert.equal(bob.last('items')?.items.bag[1].uid, blue.uid);
  // Walking apart cancels it: Bob steps to 6 tiles away.
  await wait(1000);
  bob.send({ t: 'trade-ask', to: alice.id });
  await wait(50);
  alice.send({ t: 'trade-answer', ask: alice.last('trade-asked')!.ask, accept: true });
  await wait(50);
  assert.ok(bob.last('trade'));
  bob.send({ t: 'step', col: 16, row: 10 });
  await wait(50);
  assert.deepEqual([alice.last('trade-end')?.reason, bob.last('trade-end')?.reason], ['far', 'far']);
  // Back within range: cancelling (closing the window) ends it for both.
  bob.send({ t: 'step', col: 15, row: 10 });
  await wait(1000);
  alice.send({ t: 'trade-ask', to: bob.id });
  await wait(50);
  bob.send({ t: 'trade-answer', ask: bob.last('trade-asked')!.ask, accept: true });
  await wait(50);
  bob.send({ t: 'trade-cancel' });
  await wait(50);
  assert.deepEqual([alice.last('trade-end')?.reason, alice.last('trade-end')?.name], ['cancelled', 'Bob']);
  // Leaving (closing the page) ends it too, nothing moved; and a request to someone who left is gone.
  await wait(1000);
  alice.send({ t: 'trade-ask', to: bob.id });
  await wait(50);
  bob.send({ t: 'trade-answer', ask: bob.last('trade-asked')!.ask, accept: true });
  await wait(50);
  alice.send({ t: 'trade-offer', items: [], kusing: 10 });
  await wait(50);
  bob.ws.close();
  await wait(100);
  assert.deepEqual([alice.last('trade-end')?.reason, alice.last('trade-end')?.name], ['left', 'Bob']);
  assert.deepEqual([bagOf('Alice').kusing, bagOf('Bob').kusing], [180, 120]);
  alice.ws.close();
  cara.ws.close();
  server.close();
});

test('the trades table: a finished trade saves both members\' items in one go and logs who gave what; a failed one changes nothing', () => {
  const blue = sword();
  withItems('alice-id', (s) => {
    s.bag.push(blue, stones(30));
    s.kusing = 1000;
  });
  withItems('bob-id', (s) => {
    s.bag.push(newItem(S, thing('low-mp-potion'), uid(), 4));
  });
  const A = combatOf('alice-id');
  const B = combatOf('bob-id');
  const r = tradeFor(['alice-id', 'bob-id'], [held([[blue, 1], [A.bag[1], 10]], 250), held([[B.bag[0], 4]])], ['Alice', 'Bob']);
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(combatOf('alice-id').bag.map((i) => [i.defId, i.count]), [['rough-whetstone', 20], ['low-mp-potion', 4]]);
  assert.deepEqual(combatOf('bob-id').bag.map((i) => [i.defId, i.count, i.uid === blue.uid]), [['weapon-sturdy-stick', 1, true], ['rough-whetstone', 10, false]]);
  assert.deepEqual([combatOf('alice-id').kusing, combatOf('bob-id').kusing], [750, 250]);
  const owner = db.prepare<[string], { owner: string }>('SELECT owner FROM items WHERE uid = ?').get(blue.uid);
  assert.equal(owner?.owner, 'bob-id');
  type Row = { at: number; a: string; b: string; a_items: string; b_items: string; a_kusing: number; b_kusing: number };
  const rows = db.prepare<[], Row>('SELECT * FROM trades').all();
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.deepEqual([row.a, row.b, row.a_kusing, row.b_kusing], ['alice-id', 'bob-id', 250, 0]);
  const gave = JSON.parse(row.a_items) as Item[];
  assert.deepEqual(gave.map((i) => [i.uid, i.defId, i.count]), [[blue.uid, 'weapon-sturdy-stick', 1], [A.bag[1].uid, 'rough-whetstone', 10]]);
  assert.deepEqual(gave[0].lines, blue.lines, 'its details at the time');
  assert.deepEqual((JSON.parse(row.b_items) as Item[]).map((i) => i.defId), ['low-mp-potion']);
  assert.ok(Math.abs(row.at - Date.now()) < 5000);
  // The same again: the sword is Bob's now, so nothing moves and nothing is logged.
  const before = [combatOf('alice-id'), combatOf('bob-id')];
  const again = tradeFor(['alice-id', 'bob-id'], [held([[blue, 1]], 0), held([])], ['Alice', 'Bob']);
  assert.equal(again.ok, false);
  assert.deepEqual([combatOf('alice-id'), combatOf('bob-id')], before);
  assert.equal(db.prepare<[], { n: number }>('SELECT count(*) AS n FROM trades').get()!.n, 1);
});
