import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { EVENT_POTIONS, type HalloweenData, type HalloweenReward, type Item, type TownServerMessage, addToBag, expireItems, isEventOn, mobStats, newItem, timeLeftText } from '@mikazuki/shared';
import { BIIKKO_ID, BIIKKO_KIND, Halloween, type HalloweenMap, type HalloweenSaved, UPPER_ID, hideTiles, loadHalloween } from './halloween.js';
import { loadItemData, loadStats } from './stats-data.js';
import { LootRoom, gotOf, splitKusing } from './town-loot.js';
import { MobRoom, loadMobKinds, loadMobMap } from './town-mobs.js';
import { attachTown } from './town.js';

// The Halloween event (CONTEXT.md Event, Timed cosmetic, Mikko Kalabasa, Biikko Kalabasa, Manananggal): the window (its
// +08:00 instants), timed cosmetics (their clock, running out, the time left), Mikko's hiding tiles and first click,
// Biikko on the Slums' real mob room (it wanders and never attacks, heals unhit), its loot's 10 s hold and the new
// loot kinds' party split, the Manananggal's round (spawn, carry, reunite, the legs' time up, the carrier gone), each
// schedule kept over a restart, and over the town's socket: a Mikko find (the first click wins) and a reunite.

const { data: DATA, maps: MAPS } = loadHalloween();
const ITEMS = loadItemData();
const MIN = 60_000;
const DAY = 86_400_000;
const START = Date.parse('2026-10-25T18:00:00+08:00');
const on = (patch: Partial<HalloweenData> = {}): HalloweenData => ({ ...DATA, startsAt: '2026-10-25T18:00:00+08:00', ...patch });
const lcg = (seed: number) => () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);

test('the window: off with no start; on from its start to its end, both instants in +08:00 (never local time); forced on (dev) until its end', () => {
  const end = Date.parse(DATA.endsAt);
  assert.equal(end, Date.UTC(2026, 10, 4, 15, 59, 59), 'Nov 4 23:59:59 in +08:00 is 15:59:59 UTC');
  assert.equal(START, Date.UTC(2026, 9, 25, 10, 0, 0));
  assert.equal(isEventOn(DATA, START), false, 'startsAt null: off');
  const ev = on();
  assert.equal(isEventOn(ev, START - 1), false, 'before');
  assert.equal(isEventOn(ev, START), true, 'from its start');
  assert.equal(isEventOn(ev, end - 1), true);
  assert.equal(isEventOn(ev, end), false, 'over at its end');
  assert.equal(isEventOn(DATA, START, true), true, 'forced');
  assert.equal(isEventOn(DATA, end, true), false, 'never past its end');
});

test('timed cosmetics: days from when one first enters a bag, bound then; gone wherever they are once past; time left in words; the data agrees', () => {
  const hat = newItem(ITEMS.stats, ITEMS.defs.get('witch-hat-5d')!, 'h1');
  const bag: Item[] = [];
  assert.ok(addToBag(ITEMS, bag, hat, () => 'x', 1000));
  assert.deepEqual([bag[0].expiresAt, bag[0].bound], [1000 + 5 * DAY, true]);
  // (Moved to another bag later: its clock doesn't start again.)
  const again: Item[] = [];
  addToBag(ITEMS, again, bag[0], () => 'y', 9999);
  assert.equal(again[0].expiresAt, 1000 + 5 * DAY);
  const robe = { ...newItem(ITEMS.stats, ITEMS.defs.get('witch-robe-5d')!, 'r1'), expiresAt: 500 };
  const plain = newItem(ITEMS.stats, ITEMS.defs.get('lamp-hat')!, 'l1');
  const s = { bag: [bag[0], plain], cosmetics: { body: robe } };
  assert.deepEqual(expireItems(s, 600), [{ item: robe, place: 'body' }], 'the worn robe ran out');
  assert.deepEqual(s.cosmetics, {});
  assert.equal(expireItems(s, 1000 + 5 * DAY).length, 1, 'the hat on its day');
  assert.deepEqual(s.bag, [plain], 'a cosmetic without a clock never runs out');
  assert.equal(timeLeftText(0 + 4 * DAY + 12 * 3600_000, 0), '4d 12h left');
  assert.equal(timeLeftText(35 * MIN, 0), '35m left');
  assert.equal(timeLeftText(5 * 3600_000 + 20 * MIN, 0), '5h 20m left');
  for (const [id, c] of Object.entries(DATA.cosmetics)) {
    const def = ITEMS.defs.get(id);
    assert.ok(def && 'lastsDays' in def && def.lastsDays === c.days, `${id}'s days match halloween.json`);
  }
});

test("the potions' names match the bot's (potions/potions.ts)", async () => {
  const { POTIONS } = await import('../potions/potions.js');
  for (const [id, p] of Object.entries(EVENT_POTIONS)) assert.equal(POTIONS[id as keyof typeof POTIONS].name, p.name);
});

test("Mikko's hiding tiles: right beside cover, never on the plaza, a path or road, a door, gate, the camp or the pit", () => {
  for (const name of ['town', 'slums'] as const) {
    const map = MAPS[name];
    const tiles = hideTiles(map);
    assert.ok(tiles.length > 50, `${name} has places to hide (${tiles.length})`);
    const doors = new Set(Object.values(map.doors ?? {}).flatMap((d) => (Array.isArray(d[0]) ? d : [d]) as [number, number][]).map(([c, r]) => `${c},${r}`));
    const gates = new Set(Object.values(map.gates ?? {}).flat().map(([c, r]) => `${c},${r}`));
    for (const [c, r] of tiles) {
      assert.ok(!map.blocked[r][c], 'walkable');
      assert.ok(!['plaza', 'path', 'concrete', 'plate', 'planks', 'water', 'canal', 'void'].includes(map.ground![r][c]), `not on ${map.ground![r][c]}`);
      assert.ok(!doors.has(`${c},${r}`) && !gates.has(`${c},${r}`), 'no door or gate');
      const z = map.safeZone;
      assert.ok(!z || !(c >= z[0] && c <= z[2] && r >= z[1] && r <= z[3]), 'not in the camp');
    }
  }
});

/** A Halloween with a saved state and a log of what it keeps. */
function event(data = on(), saved: HalloweenSaved | null = null, random = lcg(7)) {
  const kept: HalloweenSaved[] = [];
  const H = new Halloween(data, MAPS, saved, (s) => kept.push(structuredClone(s)), random);
  return { H, kept, last: () => kept.at(-1)! };
}

test('Mikko: hides as the event starts (never within 6 tiles of a player there), found by the first click within reach (its rewards), hidden again 15-30 min later; kept over a restart', () => {
  const { H, last } = event();
  const near = MAPS.town.objects!.find((o) => o.id.startsWith('tree-'))!;
  const player = { member: 'mara', map: 'town', at: [near.col, near.row] as [number, number] };
  assert.equal(H.tick(START, [player]).changed, true);
  const m = H.state.mikko!;
  assert.ok(m, 'hidden');
  assert.ok(m.map !== 'town' || Math.max(Math.abs(m.col - near.col), Math.abs(m.row - near.row)) > 6, 'not near the player');
  // A restart keeps it.
  const again = event(on(), last());
  assert.deepEqual(again.H.state.mikko, m);
  // Out of reach, another map: nothing.
  assert.equal(H.claimMikko(m.map, [m.col + 3, m.row], START + 1000), null);
  assert.equal(H.claimMikko(m.map === 'town' ? 'slums' : 'town', [m.col, m.row], START + 1000), null);
  const found = H.claimMikko(m.map, [m.col + 2, m.row], START + 2000)!;
  assert.ok(found, 'within 2 tiles: found');
  const R = DATA.mikko.rewards;
  assert.ok(found.reward.kowens >= R.kowens[0] && found.reward.kowens <= R.kowens[1]);
  assert.equal(found.reward.kusing, R.kusing);
  assert.ok([0, 1].includes(found.reward.repairKits));
  assert.ok(DATA.potions.includes(found.reward.potion!), 'a potion every time');
  assert.equal(H.claimMikko(m.map, [m.col, m.row], START + 2001), null, 'a second click: gone');
  const next = H.state.mikkoAt! - (START + 2000);
  assert.ok(next >= 15 * MIN && next <= 30 * MIN, 'the next one in 15-30 min');
});

test('the Manananggal: a round 10 min after the start (the legs at a usable spot, an hour), carried by the last hitter, reunited within reach; the legs time out; the carrier gone; each next round 60-180 min after', () => {
  const { H, last } = event();
  H.tick(START, []);
  assert.equal(H.state.round, null);
  assert.equal(H.state.roundAt, START + 10 * MIN);
  H.tick(START + 10 * MIN, []);
  const r = H.state.round!;
  assert.ok(H.lowerSpots().some(([c, rr]) => c === r.lower[0] && rr === r.lower[1]), 'one of lowerSpots, usable');
  assert.equal(r.until, START + 10 * MIN + 60 * MIN);
  assert.ok(H.lowerSpots().length >= 4, 'most of the spots are open floor');
  assert.deepEqual(H.view('town', START + 11 * MIN, () => 'x')!.lower, { col: r.lower[0], row: r.lower[1], until: r.until });
  assert.equal(H.view('slums', START + 11 * MIN, () => 'x')!.lower, undefined, 'the legs show in town only');
  H.upperKilled('mara');
  assert.equal(H.carrier, 'mara');
  assert.deepEqual(H.view('slums', START + 12 * MIN, (u) => (u === 'mara' ? 'town-id-m' : undefined))!.dazed, ['town-id-m'], 'everyone sees who carries it');
  // A restart keeps the round and its carrier.
  assert.deepEqual(event(on(), last()).H.state.round, H.state.round);
  assert.equal(H.reunite('bob', r.lower, START + 13 * MIN), null, "not Bob's");
  assert.equal(H.reunite('mara', [r.lower[0] + 3, r.lower[1]], START + 13 * MIN), null, 'too far');
  const done = H.reunite('mara', [r.lower[0] + 2, r.lower[1]], START + 13 * MIN)!;
  const R = DATA.manananggal.rewards;
  assert.ok(done.reward.kowens >= R.kowens[0] && done.reward.kowens <= R.kowens[1]);
  assert.deepEqual([done.reward.kusing, done.reward.repairKits, done.reward.potion], [R.kusing, 1, undefined]);
  assert.equal(H.state.round, null);
  const gap = H.state.roundAt! - (START + 13 * MIN);
  assert.ok(gap >= 60 * MIN && gap <= 180 * MIN);
  // The next round: its legs time out with it carried: it flies away.
  H.tick(H.state.roundAt!, []);
  H.upperKilled('bob');
  const flew = H.tick(H.state.round!.until, []);
  assert.deepEqual(flew.flew, ['bob']);
  assert.equal(H.state.round, null);
  // And the carrier gone too long.
  H.tick(H.state.roundAt!, []);
  H.upperKilled('cleo');
  assert.equal(H.carrierGone('dan', START), false);
  assert.equal(H.carrierGone('cleo', H.state.round!.until - 1), true);
  assert.equal(H.state.round, null);
});

test('the window closing: Mikko and the round go (no reward), the schedules stop', () => {
  const { H } = event();
  H.tick(START, []);
  H.tick(START + 10 * MIN, []);
  H.upperKilled('mara');
  const end = Date.parse(DATA.endsAt);
  const r = H.tick(end, []);
  assert.deepEqual([r.changed, r.flew, H.state.mikko, H.state.round, H.state.mikkoAt, H.state.roundAt, H.state.biikkoAt], [true, ['mara'], null, null, null, null, null]);
  assert.equal(H.view('town', end, () => undefined), null);
});

/** The Slums' real mob room with the event's zone and director. */
function slums(H: Halloween) {
  const map = loadMobMap('slums');
  map.mobZones = [...(map.mobZones ?? []), Halloween.eventZone(map.size)];
  const room = new MobRoom(map, lcg(3), {}, { shapes: {} }, loadMobKinds(), undefined, undefined, undefined, { director: H.director });
  H.attach(room);
  return room;
}

test('Biikko: out 10 min after the start; wanders (height 1, 4-10 tiles a walk) and never attacks, hit or not; full again 5 min unhit; its numbers; back 60-180 min after it falls; a restart while it waits keeps the wait, while it was up brings it straight back', () => {
  const { H, last } = event();
  const room = slums(H);
  H.tick(START, []);
  assert.equal(H.state.biikkoAt, START + 10 * MIN);
  assert.equal(room.mobInfo(BIIKKO_ID, START + 5 * MIN), null);
  room.tick(START + 10 * MIN);
  const b = room.mobInfo(BIIKKO_ID, START + 10 * MIN)!;
  assert.ok(b, 'out');
  assert.equal(H.state.biikkoAt, null, 'up: no wait kept (a restart brings it back)');
  const golemDef = mobStats(loadStats(), 'scrapheap-golem')!.def;
  assert.deepEqual([b.kind, b.maxHp, H.biikkoStats().def, H.biikkoStats().level], [BIIKKO_KIND, DATA.biikko.hp, golemDef, DATA.biikko.level]);
  // Someone right next to it hits it now and then for a minute: it walks on its own and never swings.
  const t0 = START + 10 * MIN;
  const moves: [number, number][][] = [];
  for (let t = t0; t <= t0 + 60_000; t += 250) {
    const at = room.mobInfo(BIIKKO_ID, t)!.at;
    const player = new Map([['p1', [at[0] + 1, at[1]] as [number, number]]]);
    const events = room.tick(t, player, new Map([['p1', { def: 10, level: 15, hp: 500 }]]));
    if (t % 5000 === 0) room.attack('p1', [at[0] + 1, at[1]], { cls: 'stick', level: 15 }, BIIKKO_ID, t, 0, 'Mara', 'mara');
    assert.ok(!events.some((e) => e.t === 'mob-attack'), 'never attacks');
    for (const e of events) if (e.t === 'mob-move' && e.id === BIIKKO_ID) moves.push(e.path);
  }
  assert.ok(moves.length >= 2, `it walked (${moves.length} walks)`);
  for (const path of moves) {
    const [from, to] = [path[0], path[path.length - 1]];
    const d = Math.max(Math.abs(from[0] - to[0]), Math.abs(from[1] - to[1]));
    assert.ok(d >= 4 && d <= 10, `a walk ${d} tiles`);
    for (const [c, r] of path.slice(1)) assert.equal(MAPS.slums.height![r][c], 1, 'height 1');
  }
  const hurt = room.mobInfo(BIIKKO_ID, t0 + 60_000)!;
  assert.ok(hurt.hp < hurt.maxHp, 'hurt');
  room.tick(t0 + 60_000 + 299_000);
  assert.ok(room.mobInfo(BIIKKO_ID, t0 + 359_000)!.hp < hurt.maxHp, 'not yet');
  room.tick(t0 + 60_000 + 301_000);
  assert.equal(room.mobInfo(BIIKKO_ID, t0 + 361_000)!.hp, hurt.maxHp, 'full again after 5 min unhit');
  // A restart while it's up: straight back.
  const up = event(on(), last());
  slums(up.H);
  up.H.tick(t0 + 400_000, []);
  assert.equal(up.H.state.biikkoAt, t0 + 400_000);
  // It falls: back 60-180 min later; a restart keeps the wait.
  H.biikkoKilled(t0 + 400_000);
  const wait = H.state.biikkoAt! - (t0 + 400_000);
  assert.ok(wait >= 60 * MIN && wait <= 180 * MIN);
  const later = event(on(), last());
  later.H.tick(t0 + 500_000, []);
  assert.equal(later.H.state.biikkoAt, H.state.biikkoAt, 'the wait kept');
});

test("the upper half: out with a round, passive until hit, then Claw Swipe on its target (flying straight over anything); gone once carried", () => {
  const { H } = event();
  const room = slums(H);
  H.tick(START, []);
  H.tick(START + 10 * MIN, []);
  room.tick(START + 10 * MIN);
  const u = room.mobInfo(UPPER_ID, START + 10 * MIN)!;
  assert.ok(u, 'out in the Slums');
  assert.equal(H.upperStats().atk, 6 + 3 * DATA.manananggal.upper.level, "the mob table's ATK for its level");
  // Someone stands beside it: nothing until they hit it.
  const t0 = START + 10 * MIN;
  let swings = 0;
  for (let t = t0; t <= t0 + 12_000; t += 250) {
    const at = room.mobInfo(UPPER_ID, t)!.at;
    const where = new Map([['p1', [at[0] + 1, at[1]] as [number, number]]]);
    const events = room.tick(t, where, new Map([['p1', { def: 10, level: 14, hp: 900 }]]));
    if (t === t0 + 6000) room.attack('p1', [at[0] + 1, at[1]], { cls: 'stick', level: 14 }, UPPER_ID, t, 0, 'Mara', 'mara');
    const sw = events.filter((e) => e.t === 'mob-attack' && e.id === UPPER_ID);
    if (t < t0 + 6000) assert.equal(sw.length, 0, 'passive until hit');
    swings += sw.length;
  }
  assert.ok(swings >= 2 && swings <= 4, `Claw Swipe every 1.8 s (${swings})`);
  H.upperKilled('mara');
  const gone = room.tick(t0 + 13_000);
  assert.ok(gone.some((e) => e.t === 'mob-remove'), 'carried: out of the Slums');
});

test("Biikko's loot: held 10 s for the last hitter's party then anyone's; Kowens and potions as loot (split like Kusing)", () => {
  const H = event().H;
  const contents = H.biikkoLoot(ITEMS, () => 'u');
  assert.ok('kowens' in contents[0] && contents[0].kowens >= 20 && contents[0].kowens <= 30);
  assert.deepEqual(contents[1], { kusing: DATA.biikko.loot.kusing });
  assert.ok(contents.some((c) => 'potion' in c), 'a potion every time');
  const L = new LootRoom(ITEMS);
  const now = 1000;
  const l = L.add(contents[0], [5, 5], ['mara', 'bob'], now, DATA.biikko.loot.openAfterSeconds * 1000);
  assert.ok(L.mayTake(l, 'bob', now) && !L.mayTake(l, 'cleo', now + 9999), "the party's for 10 s");
  assert.ok(L.mayTake(l, 'cleo', now + 10_000), "then anyone's");
  assert.deepEqual(L.view(l, 'cleo', now)?.kowens, (contents[0] as { kowens: number }).kowens);
  assert.deepEqual(gotOf({ potion: 'tago' }), { potion: 'tago' });
  assert.deepEqual([...splitKusing(25, ['mara', 'bob'])], [['mara', 13], ['bob', 12]]);
  // Over many kills: the witch cosmetics about half the time, a ticket about a quarter.
  const many = event(on(), null, lcg(11)).H;
  let witch = 0;
  let tickets = 0;
  for (let i = 0; i < 400; i++) {
    const c = many.biikkoLoot(ITEMS, () => 'u');
    if (c.some((x) => 'item' in x && x.item.defId.startsWith('witch-'))) witch++;
    if (c.some((x) => 'item' in x && x.item.defId === 'warren-ticket')) tickets++;
  }
  assert.ok(witch > 150 && witch < 250 && tickets > 60 && tickets < 140, `witch ${witch}, tickets ${tickets}`);
});

type Msg = TownServerMessage;
const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

test("over the town's socket: Mikko found by the first click (its pop-up, its burst for the map, an event line for everyone); a reunite (its reward)", async (t) => {
  // A tiny town where Mikko already hides and Mara already carries the upper half.
  const town: HalloweenMap = { size: [8, 8], blocked: Array.from({ length: 8 }, () => Array(8).fill(0)), ground: Array.from({ length: 8 }, () => Array(8).fill('grass')) };
  const data = on({ startsAt: '2026-01-01T00:00:00+08:00', manananggal: { ...DATA.manananggal, lowerSpots: [[6, 6]] } });
  const saved: HalloweenSaved = { mikko: { map: 'town', col: 3, row: 2 }, mikkoAt: null, biikkoAt: Date.now() + DAY, round: { lower: [3, 4], until: Date.now() + 30 * MIN, carrier: 'Mara' }, roundAt: null };
  const H = new Halloween(data, { town, slums: town }, saved);
  const given: [string, HalloweenReward][] = [];
  const server = createServer();
  attachTown(server, {
    map: { size: [8, 8], spawn: [3, 3], blocked: town.blocked },
    authenticate: async (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('as'),
    profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} as never }),
    halloween: { event: H, give: (u, r) => (given.push([u, r]), { kitsByMail: false }) },
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  const open = (as: string) =>
    new Promise<{ ws: WebSocket; got: Msg[]; send: (m: object) => void }>((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?as=${as}`);
      const got: Msg[] = [];
      ws.on('message', (d) => got.push(JSON.parse(String(d))));
      ws.on('open', () => ok({ ws, got, send: (m: object) => ws.send(JSON.stringify(m)) }));
    });
  const until = async <K extends Msg['t']>(c: { got: Msg[] }, t: K) => {
    for (let k = 0; k < 80 && !c.got.some((m) => m.t === t); k++) await wait(25);
    return c.got.find((m) => m.t === t) as Extract<Msg, { t: K }> | undefined;
  };
  const [mara, bob] = await Promise.all([open('Mara'), open('Bob')]);
  t.after(() => {
    for (const c of [mara, bob]) c.ws.terminate();
    server.close();
  });
  await wait(100);
  const view = (await until(bob, 'halloween'))!.view!;
  assert.deepEqual(view.mikko, { col: 3, row: 2 });
  assert.equal(view.dazed.length, 1, "Mara's dazed upper half");
  for (const c of [mara, bob]) c.send({ t: 'here', col: 3, row: 3, dir: 's' });
  await wait(80);
  bob.send({ t: 'mikko-claim' });
  mara.send({ t: 'mikko-claim' });
  const reward = await until(bob, 'halloween-reward');
  assert.equal(reward?.kind, 'mikko');
  assert.ok((await until(mara, 'mikko-found')) && (await until(mara, 'event-line')), 'the burst and the line for everyone');
  assert.equal((await until(mara, 'event-line'))!.text, 'Bob found Mikko Kalabasa!');
  await wait(100);
  assert.ok(!mara.got.some((m) => m.t === 'halloween-reward'), "Mara's click came second: nothing");
  assert.deepEqual(given.map(([u]) => u), ['Bob']);
  // Mara reunites at the legs (3,4), a tile away.
  mara.send({ t: 'reunite' });
  const back = await until(mara, 'halloween-reward');
  assert.equal(back?.kind, 'reunite');
  assert.ok(await until(bob, 'reunited'));
  assert.equal(H.state.round, null);
});
