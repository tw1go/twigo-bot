import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { type TownServerMessage, baseStats, chargeMult, crowdShare, derivedStats, hitDamage, mobStats, shapeParts, skillEffects, skillHits, skillPct, skillTier } from '@mikazuki/shared';
import { loadStats } from './stats-data.js';
import { type MobEvent, MobRoom, type SkillShapes, loadMobMap, loadSkillShapes } from './town-mobs.js';
import { attachTown } from './town.js';
import { freshProgress, killXp } from './progress.js';

// The Lv 21-40 skills' mechanics (combat-guide.md "Lv 21-40 skills"; CONTEXT.md Stun, Taunt, Damage over time, Channel,
// Charge-up, Windup, Leap, Debuff): several hits, channels and hits on the move, stuns, taunts, damage over time, seeking
// projectiles, the charge-up, the windup and the leap, on the Slums' real map with made-up skill rows.

const map = loadMobMap('slums');
const stats = loadStats();
const active = (map.mobZones ?? []).filter((z) => z.active);
const zoneOf = (id: string) => active.find((z) => id.startsWith(`${z.id}:`))!;
const kindOf = (id: string) => mobStats(stats, zoneOf(id).mob)!;
const cheb = (a: readonly number[], b: readonly number[]) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
/** A Lv `level` class's first-skill hit on a mob at `share` of the skill's % (no crit: the rolls are 0.9). */
const hitAt = (cls: string, id: string, share = 1, level = 1, def?: number) => {
  const by = { ...derivedStats(stats, cls, level, baseStats(stats, cls, level)), level };
  const kind = kindOf(id);
  return hitDamage(stats, by, def === undefined ? kind : { ...kind, def }, skillPct(stats, skillTier(0)) * share);
};
/** A room whose skills are these rows (each class's skill 0 the plain one, the rest as given). */
const room = (rows: Partial<SkillShapes>, random = () => 0.9) => new MobRoom(map, random, {}, { shapes: {}, ...rows });
/** An open tile on a mob's zone level `d` tiles from it (east first). */
function near(r: MobRoom, m: { id: string; col: number; row: number }, d: number): [number, number] {
  for (const [dc, dr] of [[d, 0], [0, d], [-d, 0], [0, -d], [d, d], [-d, -d], [d, -d], [-d, d]])
    if (r.canStand({ zone: zoneOf(m.id), spawn: [m.col, m.row] }, m.col + dc, m.row + dr, 10)) return [m.col + dc, m.row + dr];
  throw new Error(`no tile ${d} from ${m.id}`);
}
const wireOf = (r: MobRoom) => r.snapshot(0).find((m) => m.id.startsWith('wire-ridge:') && !m.mini)!; // (sturdy: one hit leaves it up)

test('the skill-hits.json strings read as the guide says', () => {
  assert.deepEqual(skillEffects('dot:4:500:0.15,taunt:3000'), [{ kind: 'dot', ticks: 4, every: 500, share: 0.15 }, { kind: 'taunt', ms: 3000 }]);
  assert.deepEqual(skillHits('6:300:channel'), { count: 6, every: 300, mode: 'channel' });
  assert.equal(skillHits('1:300'), null, 'one hit is a plain hit');
  assert.deepEqual(shapeParts('area:6:3'), { kind: 'area', count: 6, radius: 3 });
  assert.deepEqual(shapeParts('area:6'), { kind: 'area', count: 6, radius: 2 });
  assert.equal(chargeMult({ ms: 1500, min: 0.6 }, 0), 0.6);
  assert.equal(chargeMult({ ms: 1500, min: 0.6 }, 9000), 1);
  assert.deepEqual([crowdShare({}), crowdShare({ mini: true }), crowdShare({ field: true }), crowdShare({ last: true })], [1, 0.5, 0, 0]);
  // Every new row in the game's data reads (no unknown effect or hits string).
  const data = loadSkillShapes();
  for (const [cls, rows] of Object.entries(data.effects ?? {}))
    for (const [i, text] of rows.entries()) if (text) assert.equal(skillEffects(text).length, text.split(',').length, `${cls} ${i}: ${text}`);
  for (const [cls, rows] of Object.entries(data.hits ?? {})) {
    assert.equal(rows.length, data.shapes[cls].length, `${cls}: a hits entry per skill`);
    for (const text of rows) if (text) assert.ok(skillHits(text) || text.startsWith('1:'), `${cls}: ${text}`);
  }
});

test('several hits: the skill\'s % split over N hits EVERY ms apart, the first at once; a dead target\'s later hits go to the nearest live mob in reach', () => {
  const r = room({ shapes: { slingshot: ['single', 'single'] }, hits: { slingshot: [null, '3:300'] } });
  const w = wireOf(r);
  const at = near(r, w, 2);
  const first = r.attack('p1', at, 'slingshot', w.id, 0, 1);
  assert.ok(first.ok && first.hits.length === 1 && first.more?.left === 2 && first.more.every === 300, JSON.stringify(first));
  const by = { ...derivedStats(stats, 'slingshot', 1, baseStats(stats, 'slingshot', 1)), level: 1 };
  const third = hitDamage(stats, by, kindOf(w.id), skillPct(stats, skillTier(1)) / 3);
  assert.equal(first.hits[0].damage, third);
  const players = new Map([['p1', at]]);
  assert.deepEqual(r.skillTick(299, players).hits, []);
  const two = r.skillTick(300, players);
  assert.equal(two.hits.length, 1);
  assert.deepEqual([two.hits[0].by, two.hits[0].skill, two.hits[0].hits[0].id, two.hits[0].hits[0].damage], ['p1', 1, w.id, third]);
  assert.equal(r.skillTick(600, players).hits.length, 1);
  assert.equal(r.skillTick(5000, players).hits.length, 0, 'three, then done');

  // The target falls between hits: the rest go to the nearest live mob within the skill's reach of the caster.
  const s = room({ shapes: { slingshot: ['single', 'single'] }, hits: { slingshot: [null, '3:300'] } });
  const mobs = s.snapshot(0);
  const pair = mobs.filter((m) => !m.mini).flatMap((a) => mobs.filter((b) => b !== a && cheb([a.col, a.row], [b.col, b.row]) <= 3).map((b) => [a, b] as const))[0];
  assert.ok(pair, 'two mobs near each other');
  const [a] = pair;
  const from = near(s, a, 1);
  assert.ok(s.attack('p1', from, 'slingshot', a.id, 0, 1).ok);
  let t = 0;
  let dead = false;
  while (!dead && t < 60000) {
    const k = s.attack('p2', near(s, a, 1), { cls: 'stick', level: 20 }, a.id, (t += 1000), 0);
    dead = k.ok && k.hits[0].dead;
  }
  assert.ok(dead, 'p2 felled it');
  const later = s.skillTick(t + 1, new Map([['p1', from]]));
  assert.ok(later.hits.length >= 1, 'the rest landed');
  for (const h of later.hits) assert.notEqual(h.hits[0].id, a.id, 'never on the dead one');
  for (const h of later.hits) {
    const m = s.snapshot(t + 1).find((x) => x.id === h.hits[0].id)!;
    assert.ok(cheb([m.col, m.row], from) <= 6, 'within its reach (and a tile of slack)');
  }
});

test('a channel: moving, a knock-out or another skill stops the rest; hits on the move find their mobs again where the caster stands', () => {
  const rows = { shapes: { stick: ['single', 'single'] }, hits: { stick: [null, '4:300:channel'] } };
  const r = room(rows);
  const w = wireOf(r);
  const at = near(r, w, 1);
  const players = new Map([['p1', at]]);
  assert.ok(r.attack('p1', at, 'stick', w.id, 0, 1).ok);
  assert.equal(r.onTheMove('p1'), false, 'a channel stands still');
  assert.equal(r.skillTick(300, players).hits.length, 1);
  assert.equal(r.stopCasts('p1'), true, 'they moved');
  assert.equal(r.skillTick(2000, players).hits.length, 0, 'nothing more');
  assert.equal(r.stopCasts('p1'), false, 'nothing left to stop');

  // Knocked out (not among the players the clock is given): it stops.
  const k = room(rows);
  assert.ok(k.attack('p1', at, 'stick', w.id, 0, 1).ok);
  assert.equal(k.skillTick(2000, new Map()).hits.length, 0);

  // Another skill stops it.
  const o = room(rows);
  assert.ok(o.attack('p1', at, 'stick', w.id, 0, 1).ok);
  assert.ok(o.attack('p1', at, 'stick', w.id, 500, 0).ok);
  assert.equal(o.skillTick(2000, players).hits.length, 0, 'the channel was cut by the next skill');

  // On the move (Whirlwind): round wherever they stand when each hit lands.
  const m = room({ shapes: { stick: ['single', 'around:4'] }, hits: { stick: [null, '3:300:move'] } });
  const mobs = m.snapshot(0).filter((x) => !x.mini);
  const [a, b] = mobs.flatMap((x) => mobs.filter((y) => cheb([x.col, x.row], [y.col, y.row]) >= 6 && cheb([x.col, x.row], [y.col, y.row]) <= 12).map((y) => [x, y] as const))[0];
  const nextA = near(m, a, 1);
  const first = m.attack('p1', nextA, 'stick', a.id, 0, 1);
  assert.ok(first.ok && first.more?.mode === 'move');
  assert.equal(m.onTheMove('p1'), true, 'they walk while it spins');
  const moved = m.skillTick(300, new Map([['p1', near(m, b, 1)]]));
  assert.deepEqual(moved.hits.map((h) => h.hits[0].id), [b.id], 'it hit what was round them then');
  assert.equal(m.stopCasts('p1'), false, 'walking never stops a spin');
});

test('a stun: no moving or attacking for its time (5% longer a skill level); a mini boss half of it', () => {
  const rows = { shapes: { stick: ['single', 'single'] }, effects: { stick: [null, 'stun:1000'] } };
  const r = room(rows);
  const w = wireOf(r);
  const at = near(r, w, 1);
  const hit = r.attack('p1', at, 'stick', w.id, 0, 1);
  assert.ok(hit.ok && !hit.hits[0].miss);
  assert.deepEqual(r.flush().filter((e) => e.t === 'mob-stun').map((e) => e.t === 'mob-stun' && [e.id, e.ms]), [[w.id, 1000]]);
  const players = new Map([['p1', at]]);
  const during: MobEvent[] = [];
  for (let t = 50; t < 1000; t += 100) during.push(...r.tick(t, players));
  assert.ok(!during.some((e) => (e.t === 'mob-attack' || e.t === 'mob-move') && e.id === w.id), 'still and quiet while stunned');
  const after: MobEvent[] = [];
  for (let t = 1000; t < 6000; t += 100) after.push(...r.tick(t, players));
  assert.ok(after.some((e) => e.t === 'mob-attack' && e.id === w.id && e.target === 'p1'), 'fighting again after');

  // Lv 11: 50% longer.
  const l = room(rows);
  assert.ok(l.attack('p1', at, { cls: 'stick', level: 11, skills: [1, 11] }, w.id, 0, 1).ok);
  assert.deepEqual(l.flush().filter((e) => e.t === 'mob-stun').map((e) => e.t === 'mob-stun' && e.ms), [1500]);

  // A mini boss: half.
  const mr = room(rows);
  const mini = mr.snapshot(0).find((m) => m.mini)!;
  const res = mr.attack('p1', near(mr, mini, 1), { cls: 'stick', level: 20 }, mini.id, 0, 1);
  assert.ok(res.ok && !res.hits[0].miss, JSON.stringify(res));
  assert.deepEqual(mr.flush().filter((e) => e.t === 'mob-stun').map((e) => e.t === 'mob-stun' && e.ms), [500]);
});

test('a taunt: the mob fights the caster for its time, over the one who hit it first', () => {
  const r = room({ shapes: { stick: ['single', 'single'] }, effects: { stick: [null, 'taunt:4000'] } });
  const w = wireOf(r);
  const p1 = near(r, w, 1);
  const p2 = near(r, w, 2);
  assert.ok(r.attack('p2', p2, 'stick', w.id, 0, 0).ok, 'p2 hit it first (two tiles: a stick\'s reach and its tile of slack)');
  assert.ok(r.attack('p1', p1, 'stick', w.id, 100, 1).ok);
  assert.deepEqual(r.flush().filter((e) => e.t === 'mob-debuff').map((e) => e.t === 'mob-debuff' && [e.id, e.name, e.ms]), [[w.id, 'taunt', 4000]]);
  const players = new Map([['p1', p1], ['p2', p2]]);
  const events: MobEvent[] = [];
  for (let t = 200; t < 4000; t += 100) events.push(...r.tick(t, players));
  const swings = events.filter((e) => e.t === 'mob-attack' && e.id === w.id);
  assert.ok(swings.length && swings.every((e) => e.t === 'mob-attack' && e.target === 'p1'), JSON.stringify(swings));
});

test('damage over time: ticks on the mob wherever it goes, a share of the hit each; it stops when the mob dies', () => {
  const rows = { shapes: { stick: ['single', 'single'] }, effects: { stick: [null, 'dot:4:500:0.25'] } };
  const r = room(rows);
  const w = wireOf(r);
  const at = near(r, w, 1);
  assert.ok(r.attack('p1', at, 'stick', w.id, 0, 1).ok);
  const by = { ...derivedStats(stats, 'stick', 1, baseStats(stats, 'stick', 1)), level: 1 };
  const tick = hitDamage(stats, by, kindOf(w.id), skillPct(stats, skillTier(1)) * 0.25);
  const none = new Map<string, [number, number]>(); // (the caster gone: a dot keeps ticking)
  assert.deepEqual(r.skillTick(499, none).dots, []);
  const ticks = [500, 1000, 1500, 2000].flatMap((t) => r.skillTick(t, none).dots);
  assert.deepEqual(ticks.map((d) => [d.by, d.hits[0].id, d.hits[0].damage]), Array(4).fill(['p1', w.id, tick]));
  assert.deepEqual(r.skillTick(9000, none).dots, [], 'four, then gone');

  // Felled before its ticks: they stop.
  const s = room(rows);
  const can = s.snapshot(0).find((m) => m.id.startsWith('tin-can') && !m.mini)!;
  const by1 = near(s, can, 1);
  assert.ok(s.attack('p1', by1, 'stick', can.id, 0, 1).ok);
  let t = 0;
  let dead = false;
  while (!dead && t < 60000) {
    const k = s.attack('p2', by1, { cls: 'stick', level: 20 }, can.id, (t += 100), 0);
    dead = k.ok && k.hits[0].dead;
    if (!k.ok) t += 900;
  }
  assert.ok(dead);
  assert.deepEqual(s.skillTick(t + 5000, none).dots, []);
});

test('seeking projectiles: one at the target, the rest at the nearest other mobs, 1/N of the hit each', () => {
  const r = room({ shapes: { slingshot: ['single', 'single'] }, effects: { slingshot: [null, 'seek:3:8'] } });
  const mobs = r.snapshot(0);
  const [a, b] = mobs.filter((m) => !m.mini).flatMap((x) => mobs.filter((y) => y !== x && cheb([x.col, x.row], [y.col, y.row]) <= 4).map((y) => [x, y] as const))[0];
  const from = near(r, a, 1);
  const res = r.attack('p1', from, 'slingshot', a.id, 0, 1);
  assert.ok(res.ok && res.hits.length === 3 && res.hits[0].id === a.id, JSON.stringify(res));
  assert.ok(res.hits.some((h) => h.id === b.id), 'one went at the other mob');
  const by = { ...derivedStats(stats, 'slingshot', 1, baseStats(stats, 'slingshot', 1)), level: 1 };
  assert.equal(res.hits[0].damage, hitDamage(stats, by, kindOf(a.id), skillPct(stats, skillTier(1)) / 3));
});

test('a charge-up: × (min + (1 − min) × held / ms); nothing sent counts as full (a tap on a touch screen)', () => {
  const rows = { shapes: { slingshot: ['single', 'single'] }, effects: { slingshot: [null, 'charge:1500:0.6'] } };
  const by = { ...derivedStats(stats, 'slingshot', 1, baseStats(stats, 'slingshot', 1)), level: 1 };
  const damageWith = (held?: number) => {
    const r = room(rows);
    const w = wireOf(r);
    const res = r.attack('p1', near(r, w, 2), 'slingshot', w.id, 0, 1, 'p1', 'p1', held === undefined ? {} : { held });
    assert.ok(res.ok);
    return [res.hits[0].damage, w.id] as const;
  };
  const [none, id] = damageWith(0);
  const pct = skillPct(stats, skillTier(1));
  assert.equal(none, hitDamage(stats, by, kindOf(id), pct * 0.6));
  assert.equal(damageWith(750)[0], hitDamage(stats, by, kindOf(id), pct * 0.8));
  assert.equal(damageWith(1500)[0], hitDamage(stats, by, kindOf(id), pct));
  assert.equal(damageWith(99999)[0], hitDamage(stats, by, kindOf(id), pct), 'held to its time');
  assert.equal(damageWith()[0], hitDamage(stats, by, kindOf(id), pct));
});

test('a windup lands its ms later (its MP then); moving first cancels it at no cost, cooldown and all', () => {
  const rows = { shapes: { stick: ['single', 'single'] }, effects: { stick: [null, 'windup:800'] } };
  const r = room(rows);
  const w = wireOf(r);
  const at = near(r, w, 1);
  const players = new Map([['p1', at]]);
  const res = r.attack('p1', at, 'stick', w.id, 0, 1, 'p1', 'm1', { mp: 12 });
  assert.ok(res.ok && res.windup === 800 && res.hits.length === 0);
  assert.deepEqual(r.skillTick(799, players).hits, []);
  const landed = r.skillTick(800, players);
  assert.deepEqual(landed.hits.map((h) => h.hits[0].id), [w.id]);
  assert.deepEqual(landed.spent, [{ member: 'm1', mp: 12 }]);

  const c = room(rows);
  assert.ok(c.attack('p1', at, 'stick', w.id, 0, 1, 'p1', 'm1', { mp: 12 }).ok);
  assert.equal(c.stopCasts('p1'), true);
  const after = c.skillTick(800, players);
  assert.deepEqual([after.hits, after.spent], [[], []], 'no hit, no MP');
  assert.ok(c.attack('p1', at, 'stick', w.id, 500, 1).ok, 'its cooldown cleared (only the swing gap left)');
});

test('a leap: next to the target (up to N tiles), on its level; nowhere to land is out of reach, at no cost', () => {
  const rows = { shapes: { stick: ['single', 'single'] }, effects: { stick: [null, 'leap:4'] }, range: { stick: [1, 8] } };
  const r = room(rows);
  const w = wireOf(r);
  const from = near(r, w, 4);
  const res = r.attack('p1', from, 'stick', w.id, 0, 1);
  assert.ok(res.ok && res.leap, JSON.stringify(res));
  assert.ok(cheb(res.leap!, [w.col, w.row]) === 1, 'next to it');
  assert.ok(cheb(res.leap!, from) <= 4);
  assert.equal(res.hits[0].id, w.id);
  // Already next to it: no leap.
  const n = room(rows);
  const beside = n.attack('p1', near(n, w, 1), 'stick', w.id, 0, 1);
  assert.ok(beside.ok && !beside.leap);
  // 7 tiles off: no tile next to it within 4. Refused, and nothing spent (the next skill at once).
  const f = room(rows);
  const far = near(f, w, 7);
  assert.deepEqual(f.attack('p1', far, 'stick', w.id, 0, 1), { ok: false, reason: 'range' });
  assert.ok(f.attack('p1', near(f, w, 1), 'stick', w.id, 0, 0).ok);
});

test('a heal skill gives the party its share of Power, +2% a skill level', () => {
  const r = room({ shapes: { hilot: ['single', 'single'] }, effects: { hilot: [null, 'heal:0.15'] } });
  const w = wireOf(r);
  const one = r.attack('p1', near(r, w, 1), 'hilot', w.id, 0, 1);
  assert.ok(one.ok && one.heal === 0.15);
  const eleven = r.attack('p2', near(r, w, 1), { cls: 'hilot', level: 11, skills: [1, 11] }, w.id, 0, 1);
  assert.ok(eleven.ok && Math.abs(eleven.heal! - 0.18) < 1e-9);
});

test('debuffs: on the target in range (else the nearest), one of each name a mob, its DEF cut and its taunt; nobody in range: nothing', () => {
  const r = room({ shapes: {} });
  const w = wireOf(r);
  const at = near(r, w, 2);
  assert.deepEqual(r.debuff('p1', at, 'armor-crack', { defPct: -0.3 }, 8000, w.id, 6, 0), [w.id]);
  assert.deepEqual(r.flush().filter((e) => e.t === 'mob-debuff').map((e) => e.t === 'mob-debuff' && [e.id, e.name, e.ms]), [[w.id, 'armor-crack', 8000]]);
  const hit = r.attack('p1', at, 'slingshot', w.id, 100, 0);
  assert.ok(hit.ok);
  assert.equal(hit.hits[0].damage, hitAt('slingshot', w.id, 1, 1, kindOf(w.id).def * 0.7), '30% of its DEF off');
  // Gone after its time.
  const later = r.attack('p1', at, 'slingshot', w.id, 9000, 0);
  assert.ok(later.ok && later.hits[0].damage === hitAt('slingshot', w.id));
  // No target: the nearest within range; none in range: nothing (the town refuses it, no cost).
  assert.deepEqual(r.debuff('p1', at, 'marked', { damageTakenPct: 0.2 }, 8000, null, 6, 0, true), [w.id]);
  assert.deepEqual(r.debuff('p1', [0, 0], 'marked', { damageTakenPct: 0.2 }, 8000, w.id, 6, 0), []);
  // A taunt in seconds: it fights the caster.
  const t = room({ shapes: {} });
  const p1 = near(t, w, 2);
  const p2 = near(t, w, 1);
  assert.ok(t.attack('p2', p2, 'stick', w.id, 0, 0).ok);
  t.debuff('p1', p1, 'provoke', { taunt: 5, defPct: -0.1 }, 5000, w.id, 6, 100);
  const events: MobEvent[] = [];
  for (let s = 200; s < 4500; s += 100) events.push(...t.tick(s, new Map([['p1', p1], ['p2', p2]])));
  const swings = events.filter((e) => e.t === 'mob-attack' && e.id === w.id);
  assert.ok(swings.length && swings.every((e) => e.t === 'mob-attack' && e.target === 'p1'), JSON.stringify(swings));
  // tauntAround (Iron Kitchen): every mob within that many tiles of the caster, no target needed.
  const k = room({ shapes: {} });
  const mobs = k.snapshot(0);
  const [a, b] = mobs.filter((m) => !m.mini).flatMap((x) => mobs.filter((y) => y !== x && cheb([x.col, x.row], [y.col, y.row]) <= 4).map((y) => [x, y] as const))[0];
  const on = k.debuff('p1', [a.col, a.row], 'iron-kitchen', { taunt: 4, tauntAround: 5 }, 4000, null, 0, 0);
  assert.ok(on.includes(a.id) && on.includes(b.id), JSON.stringify(on));
});

test('over the town\'s socket: a debuff with no mob in range is refused at no cost; in range it lands for the room; a step cuts a channel', async () => {
  const slums = loadMobMap('slums');
  let mobs = new MobRoom(slums, () => 0.9, {}, loadSkillShapes(), {});
  const w = wireOf(mobs);
  const beside = near(mobs, w, 1);
  const cls: Record<string, string> = { Ash: 'slingshot', Tess: 'slingshot' };
  // (Tess at Lv 1, the room's skills all unlocked from Lv 1.)
  const level: Record<string, number> = { Ash: 40, Tess: 1 };
  const start = async (spawn: [number, number]) => {
    const map = { size: slums.size, spawn, blocked: slums.blocked };
    const server = createServer();
    attachTown(server, {
      map,
      rooms: { slums: () => map },
      mobs: { slums: mobs },
      authenticate: async (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('as'),
      profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} as never, cls: cls[name], level: level[name] }),
      progress: { fighter: (name) => ({ cls: cls[name], level: level[name], points: {} }), kill: (name, mob) => killXp(stats, cls[name], freshProgress(stats, cls[name]), mob) },
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    return server;
  };
  const open = (port: number, as: string) =>
    new Promise<{ ws: WebSocket; got: TownServerMessage[] }>((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?as=${as}&room=slums`);
      const got: TownServerMessage[] = [];
      ws.on('message', (d) => got.push(JSON.parse(String(d))));
      ws.on('open', () => ok({ ws, got }));
    });
  const wait = (ms = 150) => new Promise((ok) => setTimeout(ok, ms));
  const portOf = (s: ReturnType<typeof createServer>) => (s.address() as AddressInfo).port;

  // Far from every mob (the map's corner): refused, nothing spent, no cooldown.
  const far = await start([1, 1]);
  const a = await open(portOf(far), 'Ash');
  await wait();
  a.ws.send(JSON.stringify({ t: 'buff', buff: 'Armor Crack' }));
  await wait();
  assert.deepEqual(a.got.filter((m) => m.t === 'buff-refused'), [{ t: 'buff-refused', buff: 'Armor Crack', reason: 'target' }]);
  assert.ok(!a.got.some((m) => m.t === 'buff-cast'));
  a.ws.close();
  await new Promise((ok) => far.close(ok));

  // Beside the Wire Tangle: it lands on it, the room hears mob-debuff and the cast.
  const there = await start(beside);
  const b = await open(portOf(there), 'Ash');
  await wait();
  b.ws.send(JSON.stringify({ t: 'buff', buff: 'Armor Crack', target: w.id }));
  await wait();
  const deb = b.got.find((m) => m.t === 'mob-debuff');
  assert.deepEqual(deb, { t: 'mob-debuff', id: w.id, name: 'Armor Crack', ms: 10000 });
  assert.ok(b.got.some((m) => m.t === 'buff-cast'));
  b.ws.close();
  await new Promise((ok) => there.close(ok));

  // A channel of 10 every 180 ms (the slingshot's second skill made one here: its reach covers wherever she's put round
  // the spawn): a step stops it. (Beside a passive Tin Can of a fresh room: the Wire Tangle went after Ash.)
  const rows = loadSkillShapes();
  mobs = new MobRoom(slums, () => 0.9, {}, { ...rows, hits: { ...rows.hits, slingshot: [null, '10:180:channel'] } }, {});
  const can = mobs.snapshot(0).find((m) => m.id.startsWith('tin-can') && !m.mini)!;
  const side = near(mobs, can, 1);
  const here = await start(side);
  const t = await open(portOf(here), 'Tess');
  await wait();
  const me = (t.got.find((m) => m.t === 'welcome') as Extract<TownServerMessage, { t: 'welcome' }>).you;
  const [pc, pr] = (t.got.find((m) => m.t === 'welcome') as Extract<TownServerMessage, { t: 'welcome' }>).spawn; // (where she's put)
  const pos = { col: pc, row: pr };
  t.ws.send(JSON.stringify({ t: 'attack', mob: can.id, skill: 1 }));
  await wait(100);
  const first = t.got.filter((m) => m.t === 'mob-hit' && m.by === me);
  assert.equal(first.length, 1, JSON.stringify(t.got.filter((m) => m.t === 'attack-refused')));
  const open1 = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([dc, dr]) => [pos.col + dc, pos.row + dr]).find(([c, r]) => !slums.blocked[r]?.[c])!;
  t.ws.send(JSON.stringify({ t: 'step', col: open1[0], row: open1[1] }));
  await wait(1200);
  assert.ok(!t.got.some((m) => m.t === 'snap'), 'the step was taken');
  const later = t.got.filter((m) => m.t === 'mob-hits' && m.by === me);
  assert.ok(later.length <= 1, `stopped after the step (${later.length} later hits)`);
  t.ws.close();
  await new Promise((ok) => here.close(ok));
});
