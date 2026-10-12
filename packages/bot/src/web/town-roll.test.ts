import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { type EquipmentDef, type Item, type TownServerMessage, lootRollRules, rollGear, rollWorthy } from '@mikazuki/shared';
import { loadItemData } from './stats-data.js';
import { MobRoom, loadMobKinds, loadMobMap } from './town-mobs.js';
import { LootRolls } from './town-roll.js';
import { attachTown, loadTownMap } from './town.js';

// Rolls for rare loot: which items (shared loot-roll.ts rollWorthy), the roll itself (LootRolls), and over the town's
// socket: a party's drop asked of both, the highest roll gets it in their bag, everyone passing leaves it for them all,
// and alone there's no roll.

const D = loadItemData();
const gear = (id: string) => D.defs.get(id) as EquipmentDef;
let n = 0;
const uid = () => `r${++n}`;
const lcg = (seed: number) => () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
/** Gear of a rarity whose third line is `stat` (its name's). */
const named = (id: string, rarity: Item['rarity'], stat: string, seed = 1): Item => {
  const it = rollGear(D.stats, gear(id), rarity, uid(), lcg(seed));
  if (it.lines[2]) it.lines[2] = { ...it.lines[2], stat: stat as never };
  return it;
};

test('rollWorthy: orange two-slot gear of Calamity / Flamboyance and orange accessories of Calamity / Bloodlust; nothing else', () => {
  assert.deepEqual(lootRollRules(D.stats), { seconds: 10, max: 1000 });
  assert.equal(rollWorthy(D, named('weapon-sturdy-slingshot', 'darkOrange', 'critDmg')), true, 'of Calamity, two slots');
  assert.equal(rollWorthy(D, named('weapon-sturdy-slingshot', 'darkOrange', 'critRate')), true);
  assert.equal(rollWorthy(D, named('armor-copper-body', 'darkOrange', 'amp')), true, 'of Flamboyance');
  assert.equal(rollWorthy(D, named('weapon-sturdy-slingshot', 'darkOrange', 'atk')), false, 'of Havoc: not a roll');
  assert.equal(rollWorthy(D, named('weapon-sturdy-slingshot', 'lightOrange', 'critDmg')), false, 'one slot');
  assert.equal(rollWorthy(D, named('weapon-sturdy-slingshot', 'darkBlue', 'critDmg')), false, 'blue');
  assert.equal(rollWorthy(D, named('acc-bone-ring', 'darkOrange', 'critRate')), true, 'a ring of Calamity (no slots)');
  assert.equal(rollWorthy(D, named('acc-bone-earrings', 'lightOrange', 'lifesteal')), true, 'earrings of Bloodlust');
  assert.equal(rollWorthy(D, named('acc-bone-bracers', 'darkOrange', 'atkRate')), false, 'bracers of Frenzy');
  assert.equal(rollWorthy(D, rollGear(D.stats, gear('weapon-sturdy-slingshot'), 'brown', uid(), lcg(2))), false, 'no lines');
  assert.equal(rollWorthy(D, { ...named('weapon-sturdy-slingshot', 'darkOrange', 'critDmg'), broken: true }), false, 'broken');
});

test('LootRolls: answers once each, the highest roll wins (a tie: the earlier), passing and silence lose, time runs out', () => {
  const R = new LootRolls(1000);
  const item = named('weapon-sturdy-slingshot', 'darkOrange', 'critDmg');
  const members = [{ member: 'a', name: 'Ana' }, { member: 'b', name: 'Bob' }, { member: 'c', name: 'Cy' }];
  const r = R.start('slums', item, [3, 4], members, 1000, 10_000);
  assert.equal(R.get(r.id), r);
  assert.equal(R.answer(r.id, 'z', true, () => 0.5), null, 'not asked');
  assert.deepEqual(R.answer(r.id, 'a', true, () => 0.5), { roll: r, value: 501, done: false });
  assert.equal(R.answer(r.id, 'a', true, () => 0.9), null, 'once');
  assert.deepEqual(R.answer(r.id, 'b', false, () => 0.9), { roll: r, value: null, done: false });
  assert.equal(R.winner(r)?.member, 'a');
  assert.deepEqual(R.due(5000), [], 'not yet');
  assert.deepEqual(R.due(11_000), [r], 'time up: out (Cy silent)');
  assert.equal(R.get(r.id), undefined);
  assert.deepEqual(R.winner(r), { member: 'a', name: 'Ana', value: 501 });
  // A tie goes to the earlier roll; 1 and 1000 are the ends.
  const t = R.start('slums', item, [3, 4], members, 0, 10_000);
  R.answer(t.id, 'c', true, () => 0.5);
  R.answer(t.id, 'a', true, () => 0.5);
  const last = R.answer(t.id, 'b', true, () => 0);
  assert.equal(last?.value, 1);
  assert.equal(last?.done, true, 'the last answer');
  assert.equal(R.winner(t)?.member, 'c');
  assert.equal(R.answer(R.start('slums', item, [0, 0], members, 0, 1).id, 'a', true, () => 0.9999999)?.value, 1000);
  // Everyone passed: no winner.
  const p = R.start('slums', item, [3, 4], members.slice(0, 2), 0, 10_000);
  R.answer(p.id, 'a', false, () => 0.5);
  R.answer(p.id, 'b', false, () => 0.5);
  assert.equal(R.winner(p), null);
  assert.equal(R.finish(p.id), p);
});

// ── Over the town's socket ──

type Msg = TownServerMessage;
const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const heard = async (c: { last: (t: never) => unknown }, t: string) => {
  for (let k = 0; k < 80 && !c.last(t as never); k++) await wait(25);
};

async function town(opts: { rollRandom: () => number; take: (user: string, item: Item) => boolean }) {
  const slums = loadMobMap('slums');
  const server = createServer();
  const T = attachTown(server, {
    map: { size: [4, 4], spawn: [1, 1], blocked: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
    rooms: { slums: () => loadTownMap('slums') },
    mobs: { slums: new MobRoom(slums, () => 0.5, {}, { shapes: {} }, loadMobKinds()) },
    authenticate: async (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('as'),
    profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} as never, cls: 'slingshot' }),
    items: {
      take: (user, loot) => ('item' in loot ? opts.take(user, loot.item) : true),
      usePotion: () => null,
      state: () => ({ equipped: {}, cosmetics: {}, bag: [], kusing: 0 }),
    },
    rollRandom: opts.rollRandom,
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  const open = (as: string) =>
    new Promise<{ ws: WebSocket; got: Msg[]; send: (m: object) => void; id: () => string; last: <K extends Msg['t']>(t: K) => Extract<Msg, { t: K }> | undefined }>((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?as=${as}&room=slums`);
      const got: Msg[] = [];
      ws.on('message', (d) => got.push(JSON.parse(String(d))));
      const c = {
        ws, got, send: (m: object) => ws.send(JSON.stringify(m)),
        id: () => (got.find((m) => m.t === 'welcome') as Extract<Msg, { t: 'welcome' }>).you,
        last: <K extends Msg['t']>(t: K) => got.filter((m): m is Extract<Msg, { t: K }> => m.t === t).at(-1),
      };
      ws.on('open', () => ok(c));
    });
  return { T, open, close: () => new Promise((ok) => server.close(ok)) };
}

test("over the town's socket: a party's rare drop is rolled for; the highest roll gets it in their bag; all passing leaves it for the party; alone, no roll", async () => {
  const taken: Record<string, Item[]> = {};
  const rolls = [0.2, 0.9]; // Mara's, then Bob's
  const T = await town({ rollRandom: () => rolls.shift() ?? 0.5, take: (u, item) => ((taken[u] ??= []).push(item), true) });
  const mara = await T.open('Mara');
  const bob = await T.open('Bob');
  await wait(80);
  for (const c of [mara, bob]) c.send({ t: 'here', col: 20, row: 20, dir: 's' });
  mara.send({ t: 'party-invite', to: bob.id() });
  await heard(bob, 'party-invited');
  bob.send({ t: 'party-answer', invite: bob.last('party-invited')!.invite, accept: true });
  await heard(mara, 'party');
  await wait(80);
  const item = named('weapon-sturdy-slingshot', 'darkOrange', 'critDmg', 7);
  assert.equal(T.T.rollLoot('Mara', item), true);
  await heard(mara, 'loot-roll');
  await heard(bob, 'loot-roll');
  const ask = mara.last('loot-roll')!;
  assert.deepEqual([...ask.players].sort(), ['Bob', 'Mara']);
  assert.equal(ask.ms, 10_000);
  assert.equal(ask.item.uid, item.uid);
  assert.ok(!mara.got.some((m) => m.t === 'loot-drop'), 'not on the ground');
  mara.send({ t: 'loot-roll', id: ask.id, roll: true }); // 201
  await heard(bob, 'loot-rolled');
  assert.deepEqual(bob.last('loot-rolled'), { t: 'loot-rolled', id: ask.id, name: 'Mara', roll: 201 });
  assert.equal(mara.last('loot-rolled')?.you, true);
  bob.send({ t: 'loot-roll', id: ask.id, roll: true }); // 901: the last answer ends it
  await heard(mara, 'loot-roll-end');
  await heard(bob, 'loot-roll-end');
  const end = mara.last('loot-roll-end')!;
  assert.equal(end.winner, 'Bob');
  assert.equal(end.roll, 901);
  assert.ok(!end.yours);
  assert.equal(bob.last('loot-roll-end')?.yours, true);
  assert.deepEqual(Object.keys(taken), ['Bob']);
  assert.equal(taken.Bob[0].uid, item.uid);
  await heard(bob, 'items');
  assert.equal(bob.last('items')?.got?.item?.uid, item.uid, "in Bob's bag: his items line");
  assert.equal(mara.send({ t: 'loot-roll', id: ask.id, roll: true }), undefined, 'over: ignored');
  // Everyone passes: it lies there for them both.
  const other = named('armor-copper-body', 'darkOrange', 'amp', 8);
  T.T.rollLoot('Bob', other);
  for (let k = 0; k < 80 && bob.got.filter((m) => m.t === 'loot-roll').length < 2; k++) await wait(25);
  const ask2 = bob.last('loot-roll')!;
  assert.notEqual(ask2.id, ask.id, 'a second roll');
  mara.send({ t: 'loot-roll', id: ask2.id, roll: false });
  bob.send({ t: 'loot-roll', id: ask2.id, roll: false });
  for (let k = 0; k < 80 && !mara.got.some((m) => m.t === 'loot-roll-end' && m.id === ask2.id); k++) await wait(25);
  const end2 = mara.got.find((m): m is Extract<Msg, { t: 'loot-roll-end' }> => m.t === 'loot-roll-end' && m.id === ask2.id)!;
  assert.equal(end2.winner, undefined);
  const onGround = (c: { got: Msg[] }, uid: string) => c.got.some((m) => m.t === 'loot-drop' && m.loot.some((l) => l.item?.uid === uid && l.mine));
  for (let k = 0; k < 80 && !onGround(mara, other.uid); k++) await wait(25);
  assert.ok(onGround(mara, other.uid), 'on the ground, hers to take');
  assert.ok(onGround(bob, other.uid), 'and his');
  assert.deepEqual(Object.keys(taken), ['Bob'], 'nobody got it');
  // Alone (no party): no roll, straight on the ground.
  const far = await T.open('Far');
  await wait(80);
  far.send({ t: 'here', col: 30, row: 30, dir: 's' });
  await wait(50);
  const solo = named('weapon-sturdy-slingshot', 'darkOrange', 'critRate', 9);
  T.T.rollLoot('Far', solo);
  for (let k = 0; k < 80 && !onGround(far, solo.uid); k++) await wait(25);
  assert.ok(onGround(far, solo.uid));
  assert.ok(!far.got.some((m) => m.t === 'loot-roll'));
  for (const c of [mara, bob, far]) c.ws.close();
  await T.close();
});
