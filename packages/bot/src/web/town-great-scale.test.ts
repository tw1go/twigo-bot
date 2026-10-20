import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type QuestDef, type Target, type PalengkeData, mobName, mobStats, palengkeQuests, questKill, advanceCollects, ringBell } from '@mikazuki/shared';
import { loadPalengkeLeveling, loadStats } from './stats-data.js';
import { type MobEvent, MobRoom, loadMobKinds, loadMobMap, loadSkillShapes } from './town-mobs.js';
import { type FieldBossDef, GreatScale, PAN_KIND, loadGreatScaleArt } from './town-great-scale.js';

// The Great Scale (the Lumang Palengke's field boss, CONTEXT.md Great Scale, Weigh-in, Bell) on the real map and numbers:
// asleep between fights, its schedule, its three moves (where everyone stands as they land), the pan's hold, the call
// and the enrage, its reset, its fall (XP for everyone who did 5%), its bell and back to sleep.

const stats = loadStats();
const map = loadMobMap('palengke');
const boss = map.boss as unknown as FieldBossDef;
const row = mobStats(stats, 'great-scale')!;
const MIN = 60_000;
const [bc, br] = boss.tile;
/** Beside its body (radius 2): reachable for a melee hit. */
const beside = (dc: number, dr = 0): [number, number] => [bc + dc, br + dr];
const guard: Target = { def: 60, level: 37 };
const of = <T extends MobEvent['t']>(events: MobEvent[], t: T) => events.filter((e): e is Extract<MobEvent, { t: T }> => e.t === t);

/** A room with the Great Scale (its next waking `at`), rolls that never miss or crit. */
function setup(at: number | null = 0) {
  const scale = new GreatScale(boss, stats, loadGreatScaleArt(), () => 0.4);
  const saved: (number | null)[] = [];
  scale.setSchedule(at, (t) => saved.push(t));
  const mobMap = { ...map, mobZones: [...(map.mobZones ?? []), GreatScale.zone(boss, map.height?.[br]?.[bc] ?? 0)] };
  const room = new MobRoom(mobMap, () => 0.99, {}, loadSkillShapes(), loadMobKinds(), undefined, undefined, loadPalengkeLeveling(), { area: 'palengke', director: scale });
  scale.attach(room);
  return { scale, room, saved };
}

/** Ticks the room from `from` to `to` every 250 ms with these players standing still; every event. */
function run(room: MobRoom, from: number, to: number, players: Record<string, [number, number]>, step = 250): MobEvent[] {
  const where = new Map(Object.entries(players));
  const guards = new Map(Object.keys(players).map((id) => [id, guard]));
  const out: MobEvent[] = [];
  for (let t = from; t <= to; t += step) out.push(...room.tick(t, where, guards), ...room.flush());
  return out;
}

test('asleep between fights: there, still, not to be hit; it wakes at its time with a line (and a warning before)', () => {
  const wakeAt = 10 * MIN;
  const { room, scale, saved } = setup(wakeAt);
  assert.ok(room.snapshot(0).some((m) => m.id === boss.id && m.dormant && m.field && m.untargetable), 'there from the start');
  run(room, 0, 0, {});
  assert.equal(room.attack('A', beside(3), { cls: 'stick', level: 37 }, boss.id, 100).ok, false);
  assert.equal(scale.state(0).riseIn, wakeAt);
  // The warning warnMinutes before, then it wakes.
  const warn = run(room, wakeAt - boss.warnMinutes * MIN, wakeAt - boss.warnMinutes * MIN, {});
  assert.ok(of(warn, 'system').some((e) => e.line.tone === 'stir'));
  const woke = run(room, wakeAt, wakeAt, {});
  assert.ok(of(woke, 'mob-flag').some((e) => e.id === boss.id && e.dormant === false));
  assert.ok(of(woke, 'great-scale').some((e) => e.change === 'wake' && e.scale.state === 'awake'));
  assert.ok(of(woke, 'system').some((e) => e.line.tone === 'rise'));
  assert.equal(saved.at(-1), wakeAt, 'awake: kept as now (a restart wakes it again)');
  assert.ok(room.attack('A', beside(3), { cls: 'stick', level: 37 }, boss.id, wakeAt + 100).ok);
});

test('only hit from its arena; solo it never weighs (Pan Slams and cones only), each hitting where they stand as it lands', () => {
  const { room } = setup(0);
  run(room, 0, 0, {});
  const [c0] = boss.arena;
  // From outside its arena: out of range (even beside it, were it there).
  assert.equal(room.attack('A', [c0 - 1, br], { cls: 'slingshot', level: 37 }, boss.id, 100).ok, false);
  room.attack('A', beside(3), { cls: 'stick', level: 37 }, boss.id, 100);
  const ev = run(room, 250, 60_000, { A: beside(3) });
  const moves = of(ev, 'boss-move');
  assert.ok(moves.length >= 5, `${moves.length}`);
  assert.ok(moves.every((m) => m.move !== 'weighIn'), 'solo: no Weigh-in');
  assert.ok(moves.some((m) => m.move === 'panSlam') && moves.some((m) => m.move === 'shortWeight'));
  // A Pan Slam: a 2-tile circle under them, its hit ×panSlam on them.
  const slam = moves.find((m) => m.move === 'panSlam')!;
  assert.equal(slam.shape?.kind, 'circles');
  const hit = of(ev, 'boss-hit').find((h) => h.key === slam.key)!;
  assert.equal(hit.hits.length, 1);
  // Moved out of each one before it lands (to its other side as each starts): missed.
  const r2 = setup(0);
  run(r2.room, 0, 0, {});
  r2.room.attack('A', beside(3), { cls: 'stick', level: 37 }, boss.id, 100);
  let side = 3;
  const ev2: MobEvent[] = [];
  for (let t = 250; t < 30_000; t += 250) {
    const e = [...r2.room.tick(t, new Map([['A', beside(side)]]), new Map([['A', guard]])), ...r2.room.flush()];
    ev2.push(...e);
    if (of(e, 'boss-move').length) side = -side;
  }
  assert.ok(of(ev2, 'boss-hit').length && of(ev2, 'boss-hit').every((h) => h.hits.length === 0), 'all dodged');
});

test('Pan Slam lands once (×3), Kulang sa Timbang strips a buff (×1.5)', () => {
  const { room } = setup(0);
  run(room, 0, 0, {});
  room.attack('A', beside(3), { cls: 'stick', level: 37 }, boss.id, 100);
  const base = room.rollFor('A', boss.id, 1);
  assert.equal(base, null, '(no guard known yet)');
  const ev = run(room, 250, 20_000, { A: beside(3) });
  const landed = room.landed(20_000).filter((l) => l.by === boss.id);
  const hits = of(ev, 'boss-hit').filter((h) => h.hits.length);
  assert.equal(landed.length, hits.length, 'each hit lands once');
  const slam = of(ev, 'boss-move').find((m) => m.move === 'panSlam')!;
  const cone = of(ev, 'boss-move').find((m) => m.move === 'shortWeight')!;
  const dmg = (key: string) => of(ev, 'boss-hit').find((h) => h.key === key)!.hits[0].damage;
  assert.ok(Math.abs(dmg(slam.key) / dmg(cone.key) - row.skillMult!.panSlam / row.skillMult!.shortWeight) < 0.05);
  assert.ok(landed.some((l) => l.strip), 'the cone takes a buff');
  assert.equal(cone.shape?.kind, 'cone');
  assert.equal(cone.shape?.kind === 'cone' && cone.shape.angle, 90);
});

test('Weigh-in (two in its fight): the one in its circle is held on the pan, squeezed each second, freed when the pan breaks', () => {
  const { room, scale } = setup(0);
  run(room, 0, 0, {});
  room.attack('A', beside(3), { cls: 'stick', level: 37 }, boss.id, 100);
  const players: Record<string, [number, number]> = { A: beside(3), B: beside(0, 3) };
  const ev: MobEvent[] = [];
  let t = 250;
  for (; t < 40_000 && !scale.state(t).held; t += 250) ev.push(...run(room, t, t, players));
  const weigh = of(ev, 'boss-move').find((m) => m.move === 'weighIn')!;
  assert.ok(weigh, 'it weighs');
  const held = scale.state(t).held!;
  assert.ok(held && held.id === weigh.data!.target);
  const pan = of(ev, 'mob-add').flatMap((a) => a.mobs).find((m) => m.id === held.pan)!;
  assert.equal(pan.kind, PAN_KIND);
  assert.equal(pan.maxHp, Math.round(row.hp * 0.08));
  const grabbed = room.landed(t).filter((l) => l.player === held.id);
  assert.ok(grabbed.some((l) => l.hold === 8000), 'held 8 s');
  // A second on: squeezed (5% of their most HP).
  run(room, t + 250, t + 1250, players);
  assert.ok(room.landed(t + 1250).some((l) => l.player === held.id && l.hpPct === 0.05));
  // The other breaks the pan: let go.
  const other = held.id === 'A' ? 'B' : 'A';
  room.devWound(held.pan, 1);
  const r = room.attack(other, players[other], { cls: 'slingshot', level: 37 }, held.pan, t + 1500);
  assert.ok(r.ok && r.hits[0].dead);
  const after = room.flush();
  assert.ok(of(after, 'mob-remove').some((e) => e.ids.includes(held.pan)));
  assert.ok(of(after, 'great-scale').some((e) => e.change === 'release' && !e.scale.held));
  assert.ok(room.landed(t + 1500).some((l) => l.player === held.id && l.hold === 0));
});

test('the hold lets go on its own after 8 s', () => {
  const { room, scale } = setup(0);
  run(room, 0, 0, {});
  room.attack('A', beside(3), { cls: 'stick', level: 37 }, boss.id, 100);
  const players: Record<string, [number, number]> = { A: beside(3), B: beside(0, 3) };
  let t = 250;
  for (; t < 40_000 && !scale.state(t).held; t += 250) run(room, t, t, players);
  const held = scale.state(t).held!;
  const ev = run(room, t + 250, t + 8500, players);
  assert.ok(of(ev, 'great-scale').some((e) => e.change === 'release'));
  assert.equal(scale.state(t + 8500).held, undefined);
  assert.ok(room.landed(t + 8500).filter((l) => l.player === held.id && l.hpPct).length >= 7, 'squeezed every second');
});

test('at 50% it calls 3 Timbangan Sentinels, at 25% it enrages; 30 s with nobody in its fight: it resets, the Sentinels go', () => {
  const { room, scale } = setup(0);
  run(room, 0, 0, {});
  room.devWound(boss.id, Math.round(row.hp * 0.5) + 20);
  room.attack('A', beside(3), { cls: 'stick', level: 37 }, boss.id, 100);
  const call = of(room.flush(), 'great-scale').find((e) => e.change === 'call')!;
  assert.equal(call?.spots?.length, 3);
  const later = run(room, 250, 1500, { A: beside(3) });
  const sentinels = of(later, 'mob-add').flatMap((a) => a.mobs).filter((m) => m.kind === 'timbangan-sentinel');
  assert.equal(sentinels.length, 3);
  room.devWound(boss.id, Math.round(row.hp * 0.25) + 20);
  room.attack('A', beside(3), { cls: 'stick', level: 37 }, boss.id, 2000);
  assert.ok(of(room.flush(), 'great-scale').some((e) => e.change === 'enrage' && e.scale.enraged));
  // Everyone leaves its arena.
  const gone = run(room, 2250, 2250 + 31_000, {});
  assert.ok(of(gone, 'great-scale').some((e) => e.change === 'reset' && !e.scale.enraged));
  assert.ok(of(gone, 'mob-remove').some((e) => sentinels.every((s) => e.ids.includes(s.id))));
  const info = room.mobInfo(boss.id, 34_000)!;
  assert.equal(info.hp, info.maxHp);
  assert.equal(scale.state(34_000).state, 'awake');
});

test('its fall: XP for everyone who did 5% (no party), its bell for 60 s, then asleep, waking everyMinutes after its fall', () => {
  const { room, scale, saved } = setup(0);
  run(room, 0, 0, {});
  room.attack('B', beside(0, 3), { cls: 'stick', level: 37 }, boss.id, 100); // (a little: under 5%)
  // A does the rest from 6% of its HP down: their share and the kill.
  room.devWound(boss.id, Math.round(row.hp * 0.06));
  let fellAt = 600;
  let r = room.attack('A', beside(3), { cls: 'stick', level: 37 }, boss.id, fellAt);
  while (r.ok && !r.kills.length && fellAt < 1_000_000) r = room.attack('A', beside(3), { cls: 'stick', level: 37 }, boss.id, (fellAt += 1000));
  assert.ok(r.ok && r.kills.length === 1);
  const k = r.kills[0];
  assert.ok(k.boss && k.kind === 'great-scale' && k.dealt?.has('A'));
  assert.deepEqual(k.to, ['A']);
  assert.equal(k.xp, row.xp);
  const fell = of(room.flush(), 'great-scale').find((e) => e.change === 'death')!;
  assert.deepEqual(fell.scale.bell?.at, boss.tile);
  assert.deepEqual(scale.bell(fellAt + 30_000), boss.tile);
  assert.equal(saved.at(-1), fellAt + boss.everyMinutes * MIN);
  const ev = run(room, fellAt + 30_000, fellAt + 61_000, {});
  assert.equal(scale.bell(fellAt + 61_000), null);
  assert.ok(of(ev, 'great-scale').some((e) => e.change === 'sleep' && e.scale.state === 'asleep'));
  assert.ok(of(ev, 'mob-add').flatMap((a) => a.mobs).some((m) => m.id === boss.id && m.dormant), 'back, asleep');
  assert.equal(scale.state(fellAt + 61_000).riseIn, boss.everyMinutes * MIN - 61_000);
});

test('30 minutes awake with no hit and no fight: it sinks back to sleep', () => {
  const { room, scale } = setup(0);
  const ev = run(room, 0, 30 * MIN + 1000, {}, 60_000);
  assert.ok(of(ev, 'great-scale').some((e) => e.change === 'sink'));
  assert.equal(scale.state(30 * MIN + 1000).state, 'asleep');
});

test('quest 14: help defeat it with the Honest Weight, then ring its bell, then report', () => {
  const P = loadPalengkeLeveling() as unknown as PalengkeData;
  const quests: QuestDef[] = palengkeQuests(P, mobName);
  const q = quests.find((x) => x.id === 'palengke-14')!;
  assert.deepEqual(q.objectives.map((o) => o.type), ['fieldBoss', 'bell', 'talk']);
  const s = { quests: { active: [{ id: 'palengke-14', step: 0 }], done: [] as string[] }, bag: [{ uid: 'w', defId: 'honest-weight', count: 1 }] } as never as Parameters<typeof questKill>[0] & { bag: never[] };
  assert.equal(ringBell(s, quests, 'great-scale'), false, 'not before its kill');
  assert.ok(questKill(s, quests, { kind: 'great-scale', mini: false }));
  advanceCollects(s as never, quests);
  assert.equal(s.quests.active[0].step, 1);
  assert.equal(ringBell(s, quests, 'great-scale'), true);
  assert.equal(s.quests.active[0].step, 2);
});

test("over the town's socket: arrivals hear its state; held, attacks are refused; its fall's line, its bell rung within 3 tiles moves on everyone near on that step", async () => {
  const { createServer } = await import('node:http');
  const { WebSocket } = await import('ws');
  const { attachTown } = await import('./town.js');
  const { freshProgress } = await import('./progress.js');
  type Msg = import('@mikazuki/shared').TownServerMessage;
  const { scale, room } = setup(0);
  const rang: string[] = [];
  const server = createServer();
  attachTown(server, {
    map: { size: [4, 4], spawn: [1, 1], blocked: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
    rooms: { palengke: () => ({ size: map.size, spawn: beside(3), blocked: map.blocked }) },
    mobs: { palengke: room },
    greatScale: { boss: scale, room: 'palengke' },
    authenticate: async (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('as'),
    profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} as never, cls: 'stick' }),
    progress: { fighter: () => ({ cls: 'stick', level: 37 }), kill: () => ({ progress: freshProgress(stats, 'stick'), gained: 0, ups: 0 }) },
    items: { take: () => ({ ok: true }) as never, usePotion: () => null as never, state: () => ({ equipped: {}, cosmetics: {}, bag: [], kusing: 0 }) },
    quests: { kill: () => null, bell: (name) => (rang.push(name), { active: [] }) },
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as import('node:net').AddressInfo).port;
  const sockets: InstanceType<typeof WebSocket>[] = [];
  const open = (as: string) =>
    new Promise<{ ws: InstanceType<typeof WebSocket>; got: Msg[] }>((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?as=${as}&room=palengke`);
      sockets.push(ws);
      const got: Msg[] = [];
      ws.on('message', (d) => got.push(JSON.parse(String(d))));
      ws.on('open', () => ok({ ws, got }));
    });
  const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
  try {
    const a = await open('Mara');
    const b = await open('Bob');
    // (Placed: arrivals spread round the spawn point.)
    await wait(100);
    a.ws.send(JSON.stringify({ t: 'here', col: beside(3)[0], row: beside(3)[1], dir: 'nw' }));
    b.ws.send(JSON.stringify({ t: 'here', col: beside(0, 3)[0], row: beside(0, 3)[1], dir: 'nw' }));
    for (let i = 0; i < 20 && !a.got.some((m) => m.t === 'great-scale' && m.change === 'wake'); i++) await wait(100);
    const mobs = a.got.find((m) => m.t === 'mobs') as Extract<Msg, { t: 'mobs' }>;
    assert.ok(mobs.greatScale && mobs.mobs.some((m) => m.id === boss.id && m.field));
    assert.ok(a.got.some((m) => m.t === 'great-scale' && m.change === 'wake'), 'it woke (its time was due)');
    const youA = (a.got.find((m) => m.t === 'welcome') as Extract<Msg, { t: 'welcome' }>).you;
    // Held on the pan: attacks refused.
    room.land(youA, boss.id, { damage: 0 }, Date.now(), { hold: 2000 });
    await wait(300);
    assert.ok(a.got.some((m) => m.t === 'stunned' && m.id === youA && m.ms === 2000));
    a.ws.send(JSON.stringify({ t: 'attack', mob: boss.id, skill: 0 }));
    await wait(150);
    assert.ok(a.got.some((m) => m.t === 'attack-refused' && m.reason === 'held'));
    room.land(youA, boss.id, { damage: 0 }, Date.now(), { hold: 0 });
    await wait(300);
    // Down: its line to the room, then its bell.
    room.devWound(boss.id, 1);
    // (Swinging until it falls: a busy machine's clock may be slow to place them.)
    for (let i = 0; i < 20 && !a.got.some((m) => m.t === 'great-scale' && m.change === 'death'); i++) {
      b.ws.send(JSON.stringify({ t: 'attack', mob: boss.id, skill: 0 }));
      await wait(450);
    }
    await wait(200);
    const why = JSON.stringify({ refused: b.got.filter((m) => m.t === 'attack-refused').map((m) => (m as { reason: string }).reason), death: a.got.some((m) => m.t === 'great-scale' && m.change === 'death'), changes: a.got.filter((m) => m.t === 'great-scale').map((m) => (m as { change?: string }).change), out: b.got.some((m) => m.t === 'knocked-out') });
    assert.ok(a.got.some((m) => m.t === 'system' && m.line.kind === 'golem' && m.line.tone === 'down'), `its line ${why}`);
    assert.ok(a.got.some((m) => m.t === 'great-scale' && m.change === 'death' && m.scale.bell));
    a.ws.send(JSON.stringify({ t: 'bell-ring' }));
    await wait(200);
    assert.ok(b.got.some((m) => m.t === 'bell-rung' && m.id === youA));
    assert.deepEqual(rang.sort(), ['Bob', 'Mara'], 'both within 3 tiles');
  } finally {
    for (const ws of sockets) ws.close();
    await new Promise((ok) => server.close(ok));
  }
});
