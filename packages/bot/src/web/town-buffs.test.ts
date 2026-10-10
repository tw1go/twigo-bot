import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { type TownServerMessage, baseCooldown, buffMpCost, buffsStack, buffValue, hitDamage, rollHit, skillCooldown, skillPct, withBuffs } from '@mikazuki/shared';
import { loadStats } from './stats-data.js';
import { type Caster, type Nearby, Buffs } from './town-buffs.js';
import { MobRoom, fighterStats, loadFightData, loadMobKinds, loadMobMap } from './town-mobs.js';
import { Vitals } from './town-vitals.js';
import { attachTown } from './town.js';

// Buffs (stats.json skills.buffs; combat-guide.md "Buffs"): every number from the file.

const stats = loadStats();
const B = stats.skills.buffs!;
const R = { range: Number(B.rules.partyRangeTiles), stance: Number(B.rules.stanceSwitchSec) * 1000 };
const fight = loadFightData();
/** A caster: a Lv 20 of this class on a battle map with plenty of MP, at (10, 10). */
const caster = (cls: string, o: Partial<Caster> = {}): Caster => ({ member: 'me', cls, level: 20, skillLevel: 1, out: false, battle: true, mp: 1000, at: [10, 10], ...o });
const near = (member: string, dc: number, out = false): Nearby => ({ member, at: [10 + dc, 10], out });

test('a cast is refused off a battle map, for another class\'s buff, under its unlock level, knocked out, on cooldown and without the MP', () => {
  const b = new Buffs(stats);
  const now = 1000;
  assert.deepEqual(b.cast(caster('slingshot', { battle: false }), 'Rally', [], undefined, now), { ok: false, reason: 'here' });
  assert.deepEqual(b.cast(caster('stick'), 'Rally', [], undefined, now), { ok: false, reason: 'skill' });
  assert.deepEqual(b.cast(caster('slingshot'), 'Nothing', [], undefined, now), { ok: false, reason: 'skill' });
  assert.deepEqual(b.cast(caster('slingshot', { level: B.list.Rally.unlock - 1 }), 'Rally', [], undefined, now), { ok: false, reason: 'locked' });
  assert.deepEqual(b.cast(caster('slingshot', { out: true }), 'Rally', [], undefined, now), { ok: false, reason: 'out' });
  const mp = buffMpCost(stats, 'Rally', 1);
  assert.deepEqual(b.cast(caster('slingshot', { mp: mp - 1 }), 'Rally', [], undefined, now), { ok: false, reason: 'mp' });
  const ok = b.cast(caster('slingshot', { mp }), 'Rally', [], undefined, now);
  assert.ok(ok.ok && ok.mp === mp, 'exactly enough MP');
  const again = b.cast(caster('slingshot'), 'Rally', [], undefined, now + 1000);
  assert.ok(!again.ok && again.reason === 'slow' && again.ms === B.list.Rally.cooldownSec * 1000 - 1000);
});

test('MP and cooldown: buffMpCost and cooldownSec at its skill level (+3% MP, −1% cooldown a level)', () => {
  const b = new Buffs(stats);
  const r = b.cast(caster('slingshot', { skillLevel: 11 }), 'Rally', [], undefined, 0);
  assert.ok(r.ok);
  assert.equal(r.mp, Math.round(stats.skills.mpCost!.buffs!.slingshot.Rally * 1.3));
  assert.equal(r.cooldownMs, Math.round(skillCooldown(stats, B.list.Rally.cooldownSec, 11) * 1000)); // 9 s
  assert.equal(r.cooldownMs, 9000);
  assert.ok(!b.cast(caster('slingshot'), 'Rally', [], undefined, 8999).ok);
  assert.ok(b.cast(caster('slingshot'), 'Rally', [], undefined, 9000).ok, 'ready again');
});

test('who gets it: self; one ally + self (the one asked for in range, else the nearest, else only you); the whole party in range; never the knocked out', () => {
  const b = new Buffs(stats);
  const party = [near('ann', 2), near('bob', 5), near('cy', R.range + 1), near('dee', 1, true)];
  // (One-ally buffs as the guide has them: stats.json allyBuffsReachParty off.)
  const oneAlly = { ...stats, skills: { ...stats.skills, buffs: { ...B, rules: { ...B.rules, allyBuffsReachParty: false } } } } as unknown as typeof stats;
  const to = (cls: string, name: string, p: Nearby[], target?: string, data = oneAlly) => {
    const r = new Buffs(data).cast(caster(cls), name, p, target, 0);
    return r.ok ? r.to : r.reason;
  };
  assert.deepEqual(to('hilot', 'Calm Mind', party), ['me']);
  assert.deepEqual(to('slingshot', 'Rally', party, 'bob'), ['me', 'bob'], 'the one asked for');
  assert.deepEqual(to('slingshot', 'Rally', party, 'cy'), ['me', 'ann'], 'asked for one out of range: the nearest');
  assert.deepEqual(to('slingshot', 'Rally', party, 'dee'), ['me', 'ann'], 'knocked out: the nearest instead');
  assert.deepEqual(to('slingshot', 'Rally', party), ['me', 'ann']);
  assert.deepEqual(to('slingshot', 'Rally', [near('cy', R.range + 1)]), ['me'], 'nobody near: only you');
  // As the game has it (allyBuffsReachParty on): a one-ally buff is shared with the whole party in range, like a party
  // buff; a self buff stays yours.
  assert.equal((B.rules as { allyBuffsReachParty?: boolean }).allyBuffsReachParty, true);
  assert.deepEqual(to('slingshot', 'Rally', party, undefined, stats), ['me', 'ann', 'bob'], 'everyone in range');
  assert.deepEqual(to('slingshot', 'Steady Aim', party, 'bob', stats), ['me', 'ann', 'bob']);
  assert.deepEqual(to('stick', 'Keen Stance', party, undefined, stats), ['me'], 'a self buff');
  assert.deepEqual(to('greatstick', 'Hearty Cheer', party), ['me', 'ann', 'bob'], `within ${R.range} tiles, not knocked out`);
  assert.deepEqual(to('greatstick', 'Hearty Cheer', [near('far', R.range)]), ['me', 'far'], 'the edge of the range counts');
  // Those it reaches have it; the rest don't.
  b.cast(caster('greatstick'), 'Hearty Cheer', party, undefined, 0);
  assert.deepEqual(['me', 'ann', 'bob', 'cy', 'dee'].map((m) => b.has(m, 'Hearty Cheer')), [true, true, true, false, false]);
});

test('buffs stack (rules.stack): Rally and Vital Rub on ATK add up, held to the caps; the same buff never stacks with itself', () => {
  assert.equal(buffsStack(stats), true);
  const b = new Buffs(stats);
  const sling = caster('slingshot', { member: 's' });
  const hilot = caster('hilot', { member: 'h' });
  b.cast(sling, 'Rally', [near('h', 1)], 'h', 0);
  b.cast(hilot, 'Vital Rub', [near('s', 1)], undefined, 0);
  const both = B.list.Rally.stats.atkPct + B.list['Vital Rub'].stats.atkPct;
  assert.ok(Math.abs(b.effective('h').atkPct - both) < 1e-9, `${b.effective('h').atkPct}`);
  // Rally from a second Slingshot: still one Rally (it restarts), not two.
  b.cast(caster('slingshot', { member: 't' }), 'Rally', [near('h', 1)], 'h', 1000);
  assert.ok(Math.abs(b.effective('h').atkPct - both) < 1e-9);
  // Crit rate added up is still held to its cap.
  const d = { power: 100, hp: 100, def: 10, amp: 0, critRate: 0.3, defRate: 0 } as never;
  const capped = withBuffs(stats, d, { critRate: 5 }).critRate;
  assert.ok(capped < 1, `${capped}`);
  assert.equal(withBuffs(stats, d, b.effective('h')).critRate <= capped, true);
  assert.equal(withBuffs(stats, d, { critRate: 0.4 + 0.4 }).critRate, capped, 'two big crit buffs added up stop at the cap');
});

test('same stat with rules.stack off: only the strongest counts (Rally 8% over Vital Rub 6%); different stats add up; casting again restarts the timer', () => {
  const b = new Buffs({ ...stats, skills: { ...stats.skills, buffs: { ...B, rules: { ...B.rules, stack: false } } } } as typeof stats);
  const sling = caster('slingshot', { member: 's' });
  const hilot = caster('hilot', { member: 'h' });
  b.cast(sling, 'Rally', [near('h', 1)], 'h', 0);
  b.cast(hilot, 'Vital Rub', [near('s', 1)], undefined, 0);
  assert.equal(b.effective('h').atkPct, B.list.Rally.stats.atkPct, "only Rally's");
  assert.equal(b.effective('h').atkPct, 0.08);
  b.cast(caster('greatstick', { member: 'g' }), 'Hearty Cheer', [near('h', 1)], undefined, 0);
  assert.deepEqual(b.effective('h'), { atkPct: 0.08, maxHpPct: B.list['Hearty Cheer'].stats.maxHpPct });
  // Rally again at 200 s: it runs its whole time from then.
  const T = B.list.Rally.durationSec! * 1000;
  b.cast(sling, 'Rally', [near('h', 1)], 'h', 200_000);
  assert.equal(b.list('h').filter((x) => x.name === 'Rally').length, 1, 'one Rally, not two');
  assert.deepEqual(b.tick(T + 1).sort(), ['g', 'h', 's'], 'Vital Rub and Hearty Cheer ran out (on s, h and g)');
  assert.ok(b.has('h', 'Rally') && b.has('s', 'Rally'), 'Rally restarted');
  assert.equal(b.effective('h').atkPct, 0.08);
  b.tick(200_000 + T);
  assert.ok(!b.has('h', 'Rally'));
});

test('timed buffs end on time, on leaving the battle map and on a knock-out; a stance stays', () => {
  const b = new Buffs(stats);
  b.cast(caster('stick'), 'Keen Stance', [], undefined, 0);
  const g = caster('greatstick', { member: 'g' });
  b.cast(g, 'Battle Roar', [near('me', 1)], undefined, 0);
  assert.ok(b.has('me', 'Battle Roar') && b.has('me', 'Keen Stance'));
  assert.deepEqual(b.tick(B.list['Battle Roar'].durationSec! * 1000 - 1), []);
  assert.deepEqual(b.tick(B.list['Battle Roar'].durationSec! * 1000).sort(), ['g', 'me']);
  assert.ok(b.has('me', 'Keen Stance'), 'a stance never times out');
  b.cast(g, 'Hearty Cheer', [near('me', 1)], undefined, 0);
  assert.ok(b.endTimed('me'), 'leaving the map (or knocked out)');
  assert.deepEqual(b.list('me').map((x) => x.name), ['Keen Stance']);
  assert.ok(!b.endTimed('me'), 'nothing more to end');
  assert.ok(b.endStances('me'), 'a class change');
  assert.deepEqual(b.list('me'), []);
});

test('a stance: on, and cast again off (no MP); switching waits rules.stanceSwitchSec', () => {
  const b = new Buffs(stats);
  const on = b.cast(caster('stick', { skillLevel: 7 }), 'Keen Stance', [], undefined, 0);
  assert.ok(on.ok && !on.off && on.cooldownMs === R.stance);
  assert.deepEqual(b.effective('me'), { critRate: 0.104 });
  assert.deepEqual(b.view('me', 999_999), [{ name: 'Keen Stance', cls: 'stick', level: 7, stats: { critRate: 0.104 }, ms: null }]);
  const soon = b.cast(caster('stick'), 'Keen Stance', [], undefined, R.stance - 1);
  assert.ok(!soon.ok && soon.reason === 'slow');
  const off = b.cast(caster('stick', { mp: 0 }), 'Keen Stance', [], undefined, R.stance);
  assert.ok(off.ok && off.off && off.mp === 0);
  assert.deepEqual(b.list('me'), []);
});

test('Soothing Touch: an instant heal for the caster\'s Power × healPctOfPower (+2% a level) on them and the party in range; nothing stays on', () => {
  const b = new Buffs(stats);
  const r = b.cast(caster('hilot'), 'Soothing Touch', [near('ann', 2), near('far', R.range + 1)], undefined, 0);
  assert.ok(r.ok && r.heal === B.list['Soothing Touch'].stats.healPctOfPower);
  assert.deepEqual(r.ok && r.to, ['me', 'ann']);
  assert.deepEqual([b.list('me'), b.list('ann')], [[], []], 'no buff stays');
  const lv11 = new Buffs(stats).cast(caster('hilot', { skillLevel: 11 }), 'Soothing Touch', [], undefined, 0);
  assert.ok(lv11.ok && Math.abs(lv11.heal! - 0.96) < 1e-9);
  // The host heals each through the vitals: Power × 0.8.
  const power = fighterStats(fight, { cls: 'hilot', level: 20 }).power;
  const v = new Vitals(stats.regen);
  v.fill('ann', { hp: 2000, mp: 100, mpRegen: 0 }, 0);
  v.hurt('ann', 1500, 0);
  assert.equal(v.heal('ann', 'hp', power * r.heal!), Math.ceil(500 + power * 0.8) - 500);
});

test('what buffs do: Rally\'s 8% more damage, DEF rate held to its cap, max HP up with the buff and back down after, regen in combat, accuracy off the miss chance', () => {
  // Rally: Power × 1.08, so a hit 8% bigger (to the rounding).
  const me = { cls: 'slingshot', level: 20, points: {}, gear: ['weapon-training-slingshot'] };
  const plain = fighterStats(fight, me);
  const rallied = fighterStats(fight, { ...me, buffs: { atkPct: 0.08 } });
  assert.equal(rallied.power, plain.power * 1.08);
  const tin = { def: 10, level: 1 };
  assert.ok(Math.abs(hitDamage(stats, rallied, tin, 10) / hitDamage(stats, plain, tin, 10) - 1.08) < 0.01);
  // DEF rate: gear's and Warding Dust's together, never over caps.defRate; the hit comes down by that share.
  const geared = { ...plain, defRate: stats.caps.defRate - 0.01 };
  assert.equal(withBuffs(stats, geared, { defRate: 0.04 }).defRate, stats.caps.defRate);
  const mob = { power: 100, level: 1 };
  const bare = hitDamage(stats, mob, { def: 0, level: 1 }, 1);
  assert.equal(hitDamage(stats, mob, { def: 0, level: 1, defRate: 0.04 }, 1), Math.round(bare * 0.96));
  assert.equal(hitDamage(stats, mob, { def: 0, level: 1, defRate: 0.9 }, 1), Math.round(bare * (1 - stats.caps.defRate)), 'held to the cap');
  // Max HP: Hearty Cheer's 6% raises the most and what they have by as much; when it ends, HP over the most drops to it.
  const v = new Vitals(stats.regen);
  const max = { hp: 1000, mp: 100, mpRegen: 0 };
  v.fill('me', max, 0);
  v.hurt('me', 100, 0); // 900 / 1000
  v.setMax('me', { ...max, hp: withBuffs(stats, { ...plain, hp: 1000 }, { maxHpPct: 0.06 }).hp }, true);
  assert.deepEqual([v.get('me')!.hp, v.get('me')!.max.hp], [960, 1060]);
  v.setMax('me', { ...max, hp: 1060 }, true); // (again: nothing more)
  assert.equal(v.get('me')!.hp, 960);
  v.heal('me', 'hp', 1000); // full: 1060
  v.setMax('me', max, true); // it ended
  assert.deepEqual([v.get('me')!.hp, v.get('me')!.max.hp], [1000, 1000]);
  // Steady Breath: 0.5% of the most a second, in combat too (no out-of-combat regen yet).
  const w = new Vitals(stats.regen);
  w.fill('me', { ...max, hpRegenPct: buffValue(stats, 'Steady Breath', 1).hpRegenPctPerSec }, 0);
  w.hurt('me', 500, 0);
  w.fought('me', 0);
  w.tick(1000, ['me']);
  assert.equal(w.get('me')!.hp, 505, 'in combat: only the buff');
  // Accuracy: points off the level gap's miss chance, never below 0.
  const lowMiss = () => 0.12; // a roll that misses a 15% chance but not a 5% one
  const gap = { def: 0, level: 4 }; // 3 levels above a Lv 1: 15%
  assert.ok(rollHit(stats, { power: 10, level: 1 }, gap, 1, lowMiss).miss);
  assert.ok(!rollHit(stats, { power: 10, level: 1, accuracy: 0.1 }, gap, 1, lowMiss).miss);
  assert.ok(!rollHit(stats, { power: 10, level: 1, accuracy: 0.5 }, { def: 0, level: 1 }, 1, () => 0).miss, 'never below 0');
});

test('Calm Mind takes its share off damage skill cooldowns (not off moves): a Lv 18 skill is ready 6% sooner', () => {
  const map = loadMobMap('slums');
  const room = new MobRoom(map, () => 0.5, { stick: [1, 3, 6, 9, 12, 15, 18] }, { shapes: {} }, loadMobKinds());
  const mob = room.snapshot(0).find((m) => m.id.startsWith('crab-basin:'))!; // (a sturdy one: its shell takes the hits)
  const at: [number, number] = [mob.col + 1, mob.row];
  const full = skillCooldown(stats, baseCooldown(stats, 18)) * 1000;
  const calm = { cls: 'stick', level: 18, buffs: { cooldownPct: 0.06 } };
  assert.ok(room.attack('p1', at, calm, mob.id, 0, 6).ok);
  assert.ok(!room.attack('p1', at, calm, mob.id, full * 0.94 - 200, 6).ok);
  assert.ok(room.attack('p1', at, calm, mob.id, full * 0.94, 6).ok, 'ready at 94%');
});

test('the town: a buff on a battle map reaches the party member in range, both see the cast and their trays, Hearty Cheer lifts HP; refused in town; Soothing Touch heals in green', async () => {
  const map = { size: [12, 12] as [number, number], spawn: [2, 2] as [number, number], blocked: Array.from({ length: 12 }, () => Array(12).fill(0)) };
  const cls: Record<string, string> = { Gus: 'greatstick', Hana: 'hilot' };
  const server = createServer();
  attachTown(server, {
    map,
    rooms: { slums: () => map },
    mobs: { slums: new MobRoom(loadMobMap('slums'), () => 0.5, {}, { shapes: {} }, {}) },
    authenticate: async (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('as'),
    profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} as never, cls: cls[name], level: 20 }),
    progress: { fighter: (name) => ({ cls: cls[name], level: 20, points: {} }), kill: () => ({ progress: null as never, gained: 0, ups: 0 }) },
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  const open = (as: string, room: string) =>
    new Promise<{ ws: WebSocket; got: TownServerMessage[] }>((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?as=${as}&room=${room}`);
      const got: TownServerMessage[] = [];
      ws.on('message', (d) => got.push(JSON.parse(String(d))));
      ws.on('open', () => ok({ ws, got }));
    });
  const wait = (ms = 150) => new Promise((ok) => setTimeout(ok, ms));
  const idOf = (c: { got: TownServerMessage[] }) => (c.got.find((m) => m.t === 'welcome') as Extract<TownServerMessage, { t: 'welcome' }>).you;
  const last = <T extends TownServerMessage['t']>(c: { got: TownServerMessage[] }, t: T) => c.got.filter((m) => m.t === t).at(-1) as Extract<TownServerMessage, { t: T }> | undefined;
  // In town first: refused.
  const town = await open('Gus', 'town');
  await wait();
  town.ws.send(JSON.stringify({ t: 'buff', buff: 'Hearty Cheer' }));
  await wait();
  assert.deepEqual(last(town, 'buff-refused'), { t: 'buff-refused', buff: 'Hearty Cheer', reason: 'here' });
  town.ws.close();
  await wait();
  // In the Slums, a party of two side by side.
  const gus = await open('Gus', 'slums');
  const hana = await open('Hana', 'slums');
  await wait();
  gus.ws.send(JSON.stringify({ t: 'party-invite', to: idOf(hana) }));
  await wait();
  const inv = last(hana, 'party-invited')!;
  hana.ws.send(JSON.stringify({ t: 'party-answer', invite: inv.invite, accept: true }));
  await wait();
  const hanaHp = () => hana.got.filter((m) => m.t === 'vitals' && m.id === idOf(hana)).at(-1) as Extract<TownServerMessage, { t: 'vitals' }>;
  const hpBefore = hanaHp();
  gus.ws.send(JSON.stringify({ t: 'buff', buff: 'Hearty Cheer' }));
  await wait();
  for (const c of [gus, hana]) {
    assert.deepEqual(c.got.filter((m) => m.t === 'buff-cast').map((m) => m.t === 'buff-cast' && [m.id, m.buff]), [[idOf(gus), 'Hearty Cheer']]);
    const tray = last(c, 'buffs')!;
    assert.deepEqual(tray.buffs.map((x) => [x.name, x.stats]), [['Hearty Cheer', B.list['Hearty Cheer'].stats]]);
  }
  const hpAfter = hanaHp();
  assert.equal(hpAfter.maxHp, Math.round(hpBefore.maxHp * (1 + B.list['Hearty Cheer'].stats.maxHpPct)));
  assert.equal(hpAfter.hp - hpBefore.hp, hpAfter.maxHp - hpBefore.maxHp, 'HP up by as much as the most');
  assert.ok((last(gus, 'buff-cast')?.cooldown ?? 0) > 0, 'the caster hears its cooldown');
  // Soothing Touch at full HP: heals nothing, but goes, green for the room.
  hana.ws.send(JSON.stringify({ t: 'buff', buff: 'Soothing Touch' }));
  await wait();
  const heal = last(gus, 'buff-heal');
  assert.ok(heal && heal.by === idOf(hana) && heal.heals.length === 2, JSON.stringify(heal));
  for (const c of [gus, hana]) c.ws.close();
  await new Promise((ok) => server.close(ok));
});

test('the player you\'ve picked gets it too, in your party or not: a one-ally buff goes to them first, a party buff reaches them as well; out of range or knocked out: not', () => {
  const b = new Buffs(stats);
  const party = [near('pal', 1)];
  // Rally (shared with the party, stats.json allyBuffsReachParty): the party in range and the picked stranger.
  const r = b.cast(caster('slingshot'), 'Rally', party, near('stranger', 2), 0);
  assert.ok(r.ok && r.to.join() === 'me,pal,stranger');
  // Too far, or knocked out: the nearest party member instead.
  const far = new Buffs(stats).cast(caster('slingshot'), 'Rally', party, near('stranger', R.range + 1), 0);
  assert.ok(far.ok && far.to.join() === 'me,pal');
  const down = new Buffs(stats).cast(caster('slingshot'), 'Rally', party, near('stranger', 2, true), 0);
  assert.ok(down.ok && down.to.join() === 'me,pal');
  // Hearty Cheer (you and your party): the party and the picked stranger; never twice.
  const p = new Buffs(stats).cast(caster('greatstick'), 'Hearty Cheer', party, near('stranger', 3), 0);
  assert.ok(p.ok && p.to.join() === 'me,pal,stranger');
  const twice = new Buffs(stats).cast(caster('greatstick'), 'Hearty Cheer', party, near('pal', 1), 0);
  assert.ok(twice.ok && twice.to.join() === 'me,pal');
  // Not in a party at all: the picked one alone.
  const solo = new Buffs(stats).cast(caster('greatstick'), 'Hearty Cheer', [], near('stranger', 1), 0);
  assert.ok(solo.ok && solo.to.join() === 'me,stranger');
});

test('a buff can be taken off by its wearer (right-click in the tray): that one goes, the rest stay; a stance too', () => {
  const b = new Buffs(stats);
  b.cast(caster('greatstick'), 'Hearty Cheer', [], undefined, 0);
  b.cast(caster('greatstick'), 'Battle Roar', [], undefined, 0);
  assert.equal(b.remove('me', 'Hearty Cheer'), true);
  assert.deepEqual(b.list('me').map((x) => x.name), ['Battle Roar']);
  assert.equal(b.remove('me', 'Hearty Cheer'), false, 'not on any more');
  const s = new Buffs(stats);
  s.cast(caster('stick'), 'Keen Stance', [], undefined, 0);
  assert.equal(s.remove('me', 'Keen Stance'), true);
  assert.equal(s.has('me', 'Keen Stance'), false);
});
