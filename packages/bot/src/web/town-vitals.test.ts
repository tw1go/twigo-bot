import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { type Target, type TownServerMessage, hitDamage, levelGap, mobStats } from '@mikazuki/shared';
import { loadStats } from './stats-data.js';
import { Golem, type GolemEvent, type GolemHost, loadGolemArt } from './town-golem.js';
import { MobRoom, type PlayerLanding, fighterStats, loadFightData, loadMobKinds, loadMobMap } from './town-mobs.js';
import { RESPAWN_MS, Vitals, shown } from './town-vitals.js';
import { attachTown, loadTownMap } from './town.js';

// Players' HP and MP (town-vitals.ts), mobs' and the golem's hits on them (town-mobs.ts, town-golem.ts) and what the
// town does with them (town.ts): knocked out, respawn at the way in, regen, the safe areas, the Bag's slow, blindness.

const stats = loadStats();
const R = stats.regen;
const map = loadMobMap('slums');
const kinds = loadMobKinds();
const art = loadGolemArt();
const boss = map.boss!;
const lcg = (seed = 11) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const at = (dc: number, dr: number): [number, number] => [boss.tile[0] + dc, boss.tile[1] + dr];
/** A Lv 1 Broom's most HP, MP and MP a second (the stats rules). */
const broom = fighterStats(loadFightData(), { cls: 'broom' });
const MAX = { hp: broom.hp, mp: broom.mp, mpRegen: broom.mpRegen };

// ── HP and MP (pure) ──

test('a safe room fills them up; a battle map keeps what they had (a reload), full if new there or knocked out', () => {
  const v = new Vitals(R);
  assert.deepEqual(shown(v.arrive('u', MAX, true, 0)), { hp: MAX.hp, maxHp: MAX.hp, mp: MAX.mp, maxMp: MAX.mp }, 'new: full');
  v.hurt('u', 30, 100);
  assert.equal(shown(v.arrive('u', MAX, true, 200)).hp, MAX.hp - 30, 'a reload in the Slums: as they were');
  assert.equal(shown(v.arrive('u', MAX, false, 300)).hp, MAX.hp, 'the town or the neighbourhood: full');
  v.hurt('u', 9999, 400);
  assert.equal(shown(v.arrive('u', MAX, true, 500)).hp, MAX.hp, 'knocked out, then back: full');
  assert.equal(v.out('u'), false);
});

test('at 0 HP they are knocked out (nothing more lands), and 3 s later respawn with full HP and MP', () => {
  const v = new Vitals(R);
  v.arrive('u', MAX, true, 0);
  assert.equal(v.hurt('u', MAX.hp - 1, 1000), 'hurt');
  assert.equal(v.hurt('u', 5, 1100), 'out');
  assert.equal(v.out('u'), true);
  assert.equal(shown(v.get('u')!).hp, 0);
  assert.equal(v.hurt('u', 5, 1200), null, 'no more hits while out');
  assert.equal(RESPAWN_MS, 3000);
  assert.deepEqual(v.tick(1100 + 2999, ['u']).respawned, []);
  assert.deepEqual(v.tick(1100 + 3000, ['u']).respawned, ['u']);
  assert.deepEqual(shown(v.get('u')!), { hp: MAX.hp, maxHp: MAX.hp, mp: MAX.mp, maxMp: MAX.mp });
  assert.equal(v.out('u'), false);
});

test('regen in the Slums: no HP while in combat, from 5 s after it 2% of the most a second; MP 1 + 0.05×INT a second all along', () => {
  assert.deepEqual([R.outOfCombatAfterSec, R.outOfCombatPctPerSec, R.inCombat.hp], [5, 0.02, 0]);
  assert.equal(MAX.mpRegen, 1 + 0.05 * broom.INT, 'derivedStats reads "1 + 0.05 * INT"');
  const v = new Vitals(R);
  const big = { hp: 1000, mp: 100, mpRegen: 2 };
  v.arrive('u', big, true, 0);
  v.hurt('u', 500, 0);
  v.get('u')!.mp = 10;
  v.tick(4000, ['u']);
  assert.deepEqual([shown(v.get('u')!).hp, shown(v.get('u')!).mp], [500, 18], '4 s: no HP yet, 8 MP');
  v.fought('u', 4000); // hitting a mob: in combat again
  v.tick(8000, ['u']);
  assert.equal(shown(v.get('u')!).hp, 500, 'in combat till 9 s');
  v.tick(11_000, ['u']);
  assert.deepEqual([shown(v.get('u')!).hp, shown(v.get('u')!).mp], [540, 32], '2 s out of combat: 2 × 2% of 1000; MP all along');
  v.tick(60_000, ['u']);
  assert.deepEqual([shown(v.get('u')!).hp, shown(v.get('u')!).mp], [1000, 100], 'never past the most');
  // Outside a battle map nothing ticks (and arriving there fills them anyway).
  v.hurt('u', 100, 61_000);
  assert.deepEqual(v.tick(200_000, []), { changed: [], respawned: [] });
});

test('the Bag\'s slow and the Lamp Glare\'s blindness last their ms', () => {
  const v = new Vitals(R);
  v.arrive('u', MAX, true, 0);
  v.slow('u', 2500, 1000);
  v.blind('u', 3000, 1000);
  assert.deepEqual([v.slowed('u', 3499), v.slowed('u', 3500), v.blinded('u', 3999), v.blinded('u', 4000)], [true, false, true, false]);
});

// ── Mobs' hits on players ──

/** A mob of a zone and a tile next to it where a player can stand (on its level, in its zone). */
function nextTo(room: MobRoom, zoneId: string) {
  const zone = map.mobZones!.find((z) => z.id === zoneId)!;
  const m = room.snapshot(0).find((x) => x.id.startsWith(`${zoneId}:`))!;
  for (const [dc, dr] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const t: [number, number] = [m.col + dc, m.row + dr];
    if (room.canStand({ zone, spawn: [m.col, m.row] }, t[0], t[1], 1)) return { m, p: t };
  }
  throw new Error(`nowhere next to ${m.id}`);
}

/** Ticks a quarter second at a time, gathering what's sent. */
function run(room: MobRoom, from: number, to: number, players: Map<string, [number, number]>, guards: Map<string, Target>) {
  const out: { at: number; e: ReturnType<MobRoom['tick']>[number] }[] = [];
  for (let t = from; t <= to; t += 250) for (const e of room.tick(t, players, guards)) out.push({ at: t, e });
  return out;
}

test('a mob\'s hit on a player: its ATK as Power against their DEF, the level gap (a player above it takes less and is missed now and then), landing on its attack frame', () => {
  let r = 0.99; // no misses
  const room = new MobRoom(map, () => r, {}, { shapes: {} }, kinds);
  const { m, p } = nextTo(room, 'tin-can-alley');
  const can = mobStats(stats, 'tin-can')!;
  const guard: Target = { def: 2, level: 1 };
  assert.ok(room.attack('p1', p, 'stick', m.id, 1000).ok); // it fights back
  const evs = run(room, 1000, 4000, new Map([['p1', p]]), new Map([['p1', guard]])).filter((x) => x.e.t === 'mob-attack');
  assert.ok(evs.length >= 1);
  const a = evs[0];
  assert.ok(a.e.t === 'mob-attack');
  assert.deepEqual(a.e.hit, { damage: hitDamage(stats, { power: can.atk, level: can.level }, guard, 1) });
  // It lands on its attack frame (mobs.json attackFrame at the manifest's fps): not before.
  const hitMs = kinds['tin-can'].hitMs!;
  assert.equal(hitMs, Math.round((2 / 12) * 1000));
  assert.deepEqual(room.landed(a.at + hitMs - 1), []);
  assert.deepEqual(room.landed(a.at + hitMs), [{ player: 'p1', by: m.id, damage: a.e.hit!.damage }]);
  // A player 5 levels above it: less damage, and a 25% miss chance.
  const high: Target = { def: 2, level: can.level + 5 };
  const gap = levelGap(stats, can.level, high.level);
  assert.deepEqual(gap, { mult: 1 + 5 * stats.damage.levelGap.perLevelAboveYou, miss: 5 * stats.damage.levelGap.missPerLevelAboveYou });
  r = 0.99;
  const hit = run(room, 4250, 7000, new Map([['p1', p]]), new Map([['p1', high]])).find((x) => x.e.t === 'mob-attack')!.e;
  assert.ok(hit.t === 'mob-attack' && hit.hit?.damage === hitDamage(stats, { power: can.atk, level: can.level }, high, 1) && hit.hit.damage < a.e.hit!.damage);
  r = 0.01;
  const miss = run(room, 7250, 10_000, new Map([['p1', p]]), new Map([['p1', high]])).find((x) => x.e.t === 'mob-attack')!.e;
  assert.ok(miss.t === 'mob-attack');
  assert.deepEqual(miss.hit, { damage: 0, miss: true });
  // No DEF known for them (no HP here): its attacks are only shown.
  const shownOnly = run(room, 10_250, 13_000, new Map([['p1', p]]), new Map()).find((x) => x.e.t === 'mob-attack')!.e;
  assert.ok(shownOnly.t === 'mob-attack' && shownOnly.hit === undefined);
});

test('the Bag\'s slow comes with a hit only, and lands with it', () => {
  let r = 0.99;
  const room = new MobRoom(map, () => r, {}, { shapes: {} }, kinds);
  const { m, p } = nextTo(room, 'bag-flats');
  const bag = mobStats(stats, 'plastic-bag-spook')!;
  room.attack('p1', p, 'stick', m.id, 1000);
  const low: Target = { def: 0, level: 1 };
  const hit = run(room, 1000, 4000, new Map([['p1', p]]), new Map([['p1', low]])).find((x) => x.e.t === 'mob-attack')!;
  assert.ok(hit.e.t === 'mob-attack' && hit.e.slow === kinds['plastic-bag-spook'].slowMs && hit.e.hit?.damage === hitDamage(stats, { power: bag.atk, level: bag.level }, low, 1));
  const slows = room.landed(hit.at + 10_000).map((l) => l.slow);
  assert.ok(slows.length && slows.every((ms) => ms === 2500), String(slows));
  r = 0.01; // a player far above it: it misses, and nothing slows
  const missed = run(room, 4250, 8000, new Map([['p1', p]]), new Map([['p1', { def: 0, level: bag.level + 10 }]])).find((x) => x.e.t === 'mob-attack')!;
  assert.ok(missed.e.t === 'mob-attack' && missed.e.hit?.miss && missed.e.slow === undefined);
});

test('a player left out of a tick (knocked out) is dropped: the mob walks home, nothing still on its way lands on them', () => {
  const room = new MobRoom(map, lcg(), {}, { shapes: {} }, kinds);
  const { m, p } = nextTo(room, 'tin-can-alley');
  room.attack('p1', p, 'stick', m.id, 1000);
  const guards = new Map([['p1', { def: 2, level: 1 }]]);
  const a = run(room, 1000, 2000, new Map([['p1', p]]), guards).find((x) => x.e.t === 'mob-attack')!;
  room.forget('p1', true); // knocked out (town.ts): its hit on its way is dropped
  assert.deepEqual(room.landed(a.at + 5000), []);
  const after = run(room, 2250, 6000, new Map(), guards);
  assert.ok(!after.some((x) => x.e.t === 'mob-attack'), 'no more attacks');
  // Next to its spawn already: it has nowhere to walk, or walks home; either way it wanders again later.
  const mob = room.snapshot(6000).find((x) => x.id === m.id)!;
  assert.ok(Math.max(Math.abs(mob.col - m.col), Math.abs(mob.row - m.row)) <= 3);
});

test('blinded, every hit misses: on a mob (it still fights back) and on the golem (its fight still starts)', () => {
  const room = new MobRoom(map, lcg(), {}, { shapes: {} }, kinds, art);
  const { m, p } = nextTo(room, 'tin-can-alley');
  const r = room.attack('p1', p, { cls: 'stick', level: 20, blinded: true }, m.id, 1000);
  assert.ok(r.ok);
  assert.deepEqual(r.hits.map((h) => [h.damage, h.miss, h.hp]), [[0, true, mobStats(stats, 'tin-can')!.hp]]);
  assert.ok(run(room, 1000, 4000, new Map([['p1', p]]), new Map()).some((x) => x.e.t === 'mob-attack'), 'it came after them');
  room.riseGolem(10_000);
  for (let t = 10_000; t <= 12_000; t += 250) room.tick(t);
  const g = room.attack('p1', at(art.radius + 1, 0), { cls: 'stick', level: 15, blinded: true }, boss.id, 12_000);
  assert.ok(g.ok && g.hits[0].miss && g.hits[0].damage === 0);
  assert.equal(room.golemState(12_000)?.state, 'fight');
});

// ── The golem's hits ──

test('the golem\'s attacks: Tire Slam ×3 on everyone within 2 tiles of where its fist lands, Scrap Toss ×2 on the target\'s tile and the tiles next to it, Lamp Glare no damage', () => {
  assert.deepEqual(art.mult, { slam: 3, toss: 2 });
  assert.deepEqual(mobStats(stats, boss.id)!.skillMult, { tireSlam: 3, scrapToss: 2 });
  assert.deepEqual(art.hitMs, { slam: 500, toss: 400 + 600, glare: 300 }, 'its frames at 10 fps; the toss\'s flight');
  const rolled: [string, number][] = [];
  const host: GolemHost = {
    open: () => true,
    callAdds: () => [],
    dropAdds: () => [],
    roll: (id, mult) => (rolled.push([id, mult]), { damage: 10 * mult }),
  };
  const golem = new Golem(boss, art, host, lcg());
  golem.riseNow(0);
  const Rr = art.radius;
  const tick = (from: number, to: number, players: Map<string, [number, number]>) => {
    const out: GolemEvent[] = [];
    for (let t = from; t <= to; t += 250) out.push(...golem.tick(t, players));
    return out.filter((e) => e.t === 'golem-attack') as Extract<GolemEvent, { t: 'golem-attack' }>[];
  };
  tick(0, 1750, new Map());
  golem.hit('p1', 'Mara', 20, 2000);
  // Slam: its fist lands a tile past its body toward p1 (at(R+1, 0)): p2 two tiles past it is caught, p3 three isn't.
  const near = new Map<string, [number, number]>([['p1', at(Rr + 1, 0)], ['p2', at(Rr + 3, 1)], ['p3', at(Rr + 4, 0)]]);
  const slam = tick(2000, 4000, near).find((a) => a.attack === 'slam')!;
  assert.deepEqual(slam.at, at(Rr + 1, 0));
  assert.deepEqual(slam.hits, [{ id: 'p1', damage: 30 }, { id: 'p2', damage: 30 }]);
  // Toss at p1 far off: p2 on the next tile (a corner) is caught, p3 two tiles off isn't.
  rolled.length = 0;
  const far = new Map<string, [number, number]>([['p1', at(Rr + 5, 0)], ['p2', at(Rr + 6, 1)], ['p3', at(Rr + 7, 0)]]);
  const toss = tick(4250, 8000, far).find((a) => a.attack === 'toss')!;
  assert.deepEqual(toss.hits, [{ id: 'p1', damage: 20 }, { id: 'p2', damage: 20 }]);
  assert.deepEqual(rolled.slice(0, 2).map(([, m]) => m), [2, 2], 'rolled at ×2');
  // Its glare (every 4th) only blinds.
  const glare = tick(8250, 14_000, near).find((a) => a.attack === 'glare')!;
  assert.ok(glare.blinded?.includes('p1') && glare.hits === undefined);
});

test('in a Slums room the golem\'s slam is the stats rules\' hit (its ATK ×3, the level gap) and lands with its frame; its glare blinds as it lights', () => {
  const room = new MobRoom(map, () => 0.99, {}, { shapes: {} }, kinds, art);
  const g = mobStats(stats, boss.id)!;
  room.riseGolem(0);
  for (let t = 0; t <= 2000; t += 250) room.tick(t);
  const p = at(art.radius + 1, 0);
  room.attack('p1', p, { cls: 'stick', level: 15 }, boss.id, 2000, 0, 'Mara', 'u1');
  const guard = { def: 10, level: 1 };
  const evs = run(room, 2000, 9000, new Map([['p1', p]]), new Map([['p1', guard]]));
  const slam = evs.find((x) => x.e.t === 'golem-attack' && x.e.attack === 'slam')!;
  assert.ok(slam.e.t === 'golem-attack');
  const dmg = hitDamage(stats, { power: g.atk, level: g.level }, guard, 3);
  assert.deepEqual(slam.e.hits, [{ id: 'p1', damage: dmg }]);
  const glare = evs.find((x) => x.e.t === 'golem-attack' && x.e.attack === 'glare')!;
  const landed: PlayerLanding[] = [];
  for (let t = 2000; t <= 10_000; t += 50) landed.push(...room.landed(t).map((l) => ({ ...l, at: t }) as PlayerLanding));
  const first = landed[0] as PlayerLanding & { at: number };
  assert.deepEqual([first.damage, first.at - slam.at], [dmg, art.hitMs!.slam]);
  assert.ok(landed.some((l) => l.blind === 3000 && (l as PlayerLanding & { at: number }).at - glare.at === art.hitMs!.glare));
});

test('the golem\'s XP credit is by member: a reload mid-fight (a new town id) keeps what they did', () => {
  const host: GolemHost = { open: () => true, callAdds: () => [], dropAdds: () => [] };
  const golem = new Golem(boss, art, host, lcg());
  golem.riseNow(0);
  for (let t = 0; t <= 2000; t += 250) golem.tick(t, new Map());
  const share = 0.05 * art.hp;
  golem.hit('id-before', 'Mara', Math.floor(share / 2) + 1, 3000, 'u-mara');
  golem.hit('id-after', 'Mara', Math.floor(share / 2) + 1, 3100, 'u-mara'); // the same member after a reload
  const last = golem.hit('id-bob', 'Bob', art.hp, 3200, 'u-bob')!;
  assert.ok(last.dead);
  assert.ok(last.dealt!.get('u-mara')! >= share && !last.dealt!.has('id-before'), 'counted together, by member');
  // Through the room: kills' XP goes to members.
  const room = new MobRoom(map, () => 0.99, {}, { shapes: {} }, kinds);
  const { m, p } = nextTo(room, 'tin-can-alley');
  let r = room.attack('p1', p, { cls: 'stick', level: 20 }, m.id, 1000, 0, 'Mara', 'u-mara');
  for (let t = 2000; r.ok && !r.kills.length; t += 1000) r = room.attack('p1', p, { cls: 'stick', level: 20 }, m.id, t, 0, 'Mara', 'u-mara');
  assert.ok(r.ok);
  assert.deepEqual(r.kills[0].to, ['u-mara']);
});

// ── The town: knocked out, respawn, the safe areas, the slow ──

/** A Slums room whose landings a test adds by hand (as if mobs had hit). */
class Scripted extends MobRoom {
  readonly queue: PlayerLanding[] = [];
  override landed(now: number): PlayerLanding[] {
    return [...super.landed(now), ...this.queue.splice(0)];
  }
}

async function townWithSlums() {
  const room = new Scripted(map, lcg(), {}, { shapes: {} }, kinds);
  const server = createServer();
  const slums = loadTownMap('slums');
  attachTown(server, {
    map: { size: [4, 4], spawn: [1, 1], blocked: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
    rooms: { slums: () => slums },
    mobs: { slums: room },
    authenticate: async (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('as'),
    profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} as never, cls: 'broom' }),
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  const open = (as: string, roomName?: string) =>
    new Promise<{ ws: WebSocket; got: TownServerMessage[]; id: string; spawn: [number, number] }>((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?as=${as}${roomName ? `&room=${roomName}` : ''}`);
      const c = { ws, got: [] as TownServerMessage[], id: '', spawn: [0, 0] as [number, number] };
      ws.on('message', (d) => {
        const m = JSON.parse(String(d)) as TownServerMessage;
        c.got.push(m);
        if (m.t === 'welcome') {
          Object.assign(c, { id: m.you, spawn: m.spawn });
          ok(c);
        }
      });
    });
  const close = () => new Promise((ok) => server.close(ok));
  return { room, slums, open, close };
}

const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const lastVitals = (got: TownServerMessage[], id: string) => got.filter((m): m is Extract<TownServerMessage, { t: 'vitals' }> => m.t === 'vitals' && m.id === id).at(-1);
const send = (ws: WebSocket, m: unknown) => ws.send(JSON.stringify(m));

test('knocked out in the Slums: no steps or attacks, everyone there sees it, and 3 s later they respawn at the way in, full', async () => {
  const { room, slums, open, close } = await townWithSlums();
  const a = await open('Mara', 'slums');
  const b = await open('Bob', 'slums');
  await wait(150);
  assert.deepEqual(lastVitals(a.got, a.id), { t: 'vitals', id: a.id, hp: MAX.hp, maxHp: MAX.hp, mp: MAX.mp, maxMp: MAX.mp });
  room.queue.push({ player: a.id, by: 'tin-can-alley:0', damage: 10 });
  await wait(250);
  assert.equal(lastVitals(a.got, a.id)?.hp, MAX.hp - 10);
  assert.deepEqual(lastVitals(b.got, a.id), { t: 'vitals', id: a.id, hp: MAX.hp - 10, maxHp: MAX.hp }, 'the room sees the bar (no MP)');
  room.queue.push({ player: a.id, by: 'tin-can-alley:0', damage: 9999 });
  await wait(250);
  const outAt = Date.now();
  assert.ok(a.got.some((m) => m.t === 'knocked-out' && m.id === a.id) && b.got.some((m) => m.t === 'knocked-out' && m.id === a.id));
  assert.equal(lastVitals(a.got, a.id)?.hp, 0);
  const before = a.got.length;
  send(a.ws, { t: 'step', col: a.spawn[0] - 1, row: a.spawn[1] });
  send(a.ws, { t: 'attack', mob: 'tin-can-alley:0', skill: 0 });
  await wait(200);
  const replies = a.got.slice(before);
  assert.ok(replies.some((m) => m.t === 'snap'), 'no steps');
  assert.ok(replies.some((m) => m.t === 'attack-refused' && m.reason === 'out'), 'no attacks');
  while (!a.got.some((m) => m.t === 'respawn')) await wait(50);
  const back = a.got.find((m) => m.t === 'respawn')!;
  assert.ok(back.t === 'respawn');
  assert.ok(Date.now() - outAt >= RESPAWN_MS - 300, 'after 3 s');
  assert.ok(Math.abs(back.col - slums.spawn[0]) <= 3 && Math.abs(back.row - slums.spawn[1]) <= 3, 'at the way in (where arrivals land)');
  assert.ok(b.got.some((m) => m.t === 'respawn' && m.id === a.id), 'everyone there sees them reappear');
  await wait(150);
  assert.deepEqual(lastVitals(a.got, a.id), { t: 'vitals', id: a.id, hp: MAX.hp, maxHp: MAX.hp, mp: MAX.mp, maxMp: MAX.mp });
  // Up again: steps go.
  const n = a.got.length;
  const to = slums.blocked[back.row][back.col - 1] ? [back.col + 1, back.row] : [back.col - 1, back.row];
  send(a.ws, { t: 'step', col: to[0], row: to[1] });
  await wait(150);
  assert.ok(!a.got.slice(n).some((m) => m.t === 'snap'));
  a.ws.close();
  b.ws.close();
  await close();
});

test('a reload in the Slums keeps their HP; the town fills it up again', async () => {
  const { room, open, close } = await townWithSlums();
  const a = await open('Mara', 'slums');
  await wait(100);
  room.queue.push({ player: a.id, by: 'tin-can-alley:0', damage: 30 });
  await wait(250);
  a.ws.close();
  await wait(100);
  const again = await open('Mara', 'slums');
  await wait(100);
  assert.equal(lastVitals(again.got, again.id)?.hp, MAX.hp - 30, 'kept');
  const welcome = again.got.find((m) => m.t === 'welcome');
  again.ws.close();
  await wait(100);
  const town = await open('Mara');
  await wait(100);
  assert.equal(lastVitals(town.got, town.id)?.hp, MAX.hp, 'the town: full');
  assert.ok(welcome);
  town.ws.close();
  await close();
});

test('the Bag\'s slow holds their steps to half: 3 at once instead of 6, then back', async () => {
  const { room, open, close } = await townWithSlums();
  const a = await open('Mara', 'slums');
  const [c, r] = a.spawn;
  const steps = async (n: number) => {
    const before = a.got.length;
    for (let i = 0; i < n; i++) send(a.ws, { t: 'step', col: i % 2 ? c : c - 1, row: r });
    await wait(150);
    return a.got.slice(before).filter((m) => m.t === 'snap').length;
  };
  assert.equal(await steps(6), 0, 'a full budget: 6');
  room.queue.push({ player: a.id, by: 'bag-flats:0', damage: 1, slow: 2500 });
  await wait(1200); // a second slowed: refilled to its half (3)
  // (Back on the spawn tile after an even number of steps.)
  assert.equal(await steps(6), 3, 'slowed: 3 go, 3 snap back');
  await wait(2600); // the slow is over, a second's refill at the full rate
  const ok = await steps(6);
  assert.ok(ok <= 1, `back to the full budget (${ok} refused)`);
  a.ws.close();
  await close();
});
