import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

// The Tanod's leveling chain and the Slums' mini bosses (classes/leveling.json, the art folder's data/leveling-plan.md),
// on the game's real data and a throwaway database (never the real .env or data/).
const dir = mkdtempSync(join(tmpdir(), 'leveling-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { gainXp, isGearDef, kusingRange, miniBossRules, questDropFor, agimatSlots, mobStats, mobXp, nearestGearLevel, questKill, readyToReport } = await import('@mikazuki/shared');
type TownServerMessage = import('@mikazuki/shared').TownServerMessage;
const { loadItemData, loadLeveling } = await import('./stats-data.js');
const { miniLoot } = await import('./loot.js');
const { LootRoom } = await import('./town-loot.js');
const { MobRoom, loadMobKinds, loadMobMap } = await import('./town-mobs.js');
const { attachTown } = await import('./town.js');
const { QUESTS, adventureOf, combatOf, fighterOf, freshAdventure, killFor, questKillFor, questStep, startQuests, takeLootFor, townQuest, usePotionFor } = await import('./adventure.js');
const { freshProgress } = await import('./progress.js');
const { closeDatabase } = await import('../db/db.js');

const D = loadItemData();
const S = D.stats;
const L = loadLeveling();
const R = miniBossRules(L);
const map = loadMobMap('slums');
const lcg = (seed: number) => () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const CHAIN = L.quests.map((q) => q.id);

test('the chain: the 12 quests after the class quest, in order, main, kill or miniBoss, numbers from leveling.json, 10 HP + 10 MP Potions each', () => {
  const order: string[] = [];
  for (let q = QUESTS.find((x) => x.autoStart); q; q = QUESTS.find((x) => x.id === q!.next)) order.push(q.id);
  assert.deepEqual(order, ['main-01-class', ...CHAIN]);
  for (const l of L.quests) {
    const q = QUESTS.find((x) => x.id === l.id)!;
    assert.equal(q.type, 'main');
    assert.equal(q.giver, 'tanod');
    assert.equal(q.title, l.title);
    assert.deepEqual([q.objectives[0].type, q.objectives[0].mob, q.objectives[0].count], [l.kind, l.mob, l.kind === 'kill' ? l.count : 1]);
    assert.deepEqual([q.rewardXP, q.rewardKusing], [l.rewardXP, l.rewardKusing]);
    assert.deepEqual(q.rewards, [{ item: 'low-hp-potion', count: 10 }, { item: 'low-mp-potion', count: 10 }]);
    // The Tanod's own lines (quests.json, over leveling.json's one each) and the log's storyline.
    assert.ok((q.dialogue?.give?.length ?? 0) >= 2 && (q.dialogue?.report?.length ?? 0) >= 2, `${q.id}: his lines`);
    assert.ok((q.story?.length ?? 0) > 80, `${q.id}: its story`);
  }
  assert.equal(QUESTS.find((x) => x.id === CHAIN[0])!.objectives[0].text, 'Tin Cans');
  assert.equal(QUESTS.find((x) => x.id === CHAIN[1])!.objectives[0].text, 'Beat a Tin Can mini boss');
});

test('counting: a kill objective counts its kind (any look, never its mini bosses), a miniBoss one only its mini bosses; then Report', () => {
  const s = { quests: { active: [{ id: CHAIN[0], step: 0 }, { id: CHAIN[1], step: 0 }] as { id: string; step: number; count?: number }[], done: [] as string[] } };
  assert.equal(questKill(s, QUESTS, { kind: 'bottle-caps', mini: false }), false);
  assert.equal(questKill(s, QUESTS, { kind: 'tin-can', mini: true }), true); // the mini boss quest only
  assert.deepEqual(s.quests.active.map((p) => p.count), [undefined, 1]);
  for (let i = 0; i < 25; i++) questKill(s, QUESTS, { kind: 'tin-can', mini: false });
  assert.deepEqual(s.quests.active.map((p) => p.count), [20, 1], 'never past the count');
  assert.ok(readyToReport(QUESTS.find((q) => q.id === CHAIN[0]), s.quests.active[0]));
});

test('Report: fixed XP and Kusing whatever the level, the potions, the next quest; refused before the count', () => {
  for (const level of [1, 9]) {
    const s = { ...freshAdventure(), cls: 'stick', quests: { active: [{ id: CHAIN[0], step: 0, count: 19 }], done: ['main-01-class'], rewarded: ['main-01-class'] } };
    s.progress = { ...s.progress, level };
    assert.equal(questStep(s, { quest: CHAIN[0], action: 'report' }).ok, false);
    s.quests.active[0].count = 20;
    const r = questStep(s, { quest: CHAIN[0], action: 'report' });
    assert.deepEqual([r.ok, r.completed, r.xp, r.kusing], [true, CHAIN[0], L.quests[0].rewardXP, L.quests[0].rewardKusing], `Lv ${level}`);
    assert.equal(s.kusing, L.quests[0].rewardKusing);
    assert.deepEqual(s.bag.map((i) => [i.defId, i.count]), [['low-hp-potion', 10], ['low-mp-potion', 10]]);
    assert.deepEqual(s.quests.active, [{ id: CHAIN[1], step: 0 }]);
  }
  // Someone who finished the class quest before the chain: quest 1 on their next visit.
  const old = { ...freshAdventure(), cls: 'broom', quests: { active: [], done: ['main-01-class'] } };
  assert.deepEqual(startQuests(old).map((q) => q.id), [CHAIN[0]]);
  assert.deepEqual(startQuests(old), []);
  // Through the route: a quest that isn't under way is refused (their class quest starts first).
  townQuest('chain', { quest: CHAIN[0], action: 'report' }); // (starts the class quest; nothing to report)
  const s = adventureOf('chain');
  assert.ok(s.quests.active.some((p) => p.id === 'main-01-class'));
});

test('Lv 1 to 15 on the quests alone: each quest reaches its target level (solo, and in a party of 2 sharing the kills), never past it', () => {
  const kindXp = (kind: string) => mobStats(S, kind)!;
  for (const party of [1, 2]) {
    let level = 1;
    let xp = 0;
    for (const q of L.quests) {
      // Its kills (a party of 2: half each), or the lowest of its mini bosses (each who hits it gets its XP).
      let gained = 0;
      if (q.kind === 'kill') for (let k = 0; k < Math.ceil(q.count / party); k++) gained += mobXp(S, kindXp(q.mob), level);
      else gained += mobXp(S, [...L.miniBosses[q.mob]].sort((a, b) => a.level - b.level)[0], level);
      const after = gainXp(S, level, xp, gained + q.rewardXP);
      [level, xp] = [after.level, after.xp];
      assert.equal(level, q.targetLevel, `${q.id}${party > 1 ? ' (party of 2)' : ''}: Lv ${level}, not ${q.targetLevel}`);
    }
    assert.equal(level, 15);
  }
});

test('mini bosses: one each at its spot in its zone, its own level and HP, not in the zone count; back at its spot 3 min after it dies', () => {
  const room = new MobRoom(map, lcg(3), {}, { shapes: {} }, loadMobKinds());
  const minis = room.snapshot(0).filter((m) => m.mini);
  const spots = (map.mobZones ?? []).filter((z) => z.active).flatMap((z) => (z.miniBosses ?? []).map((s) => ({ z, s })));
  assert.equal(minis.length, Object.values(L.miniBosses).flat().length);
  for (const { z, s } of spots) {
    const m = minis.find((x) => x.mini === s.id)!;
    const def = L.miniBosses[z.mob].find((x) => x.id === s.id)!;
    assert.deepEqual([m.id, m.col, m.row, m.level, m.maxHp, m.hp], [`${z.id}:mini:${s.id}`, s.tile[0], s.tile[1], def.level, def.hp, def.hp]);
    // At least 6 tiles from the zone's others.
    for (const o of (z.miniBosses ?? []).filter((x) => x !== s)) assert.ok(Math.max(Math.abs(o.tile[0] - s.tile[0]), Math.abs(o.tile[1] - s.tile[1])) >= 6, `${s.id} / ${o.id}`);
  }
  // One looks the same every time (seeded by its id).
  assert.deepEqual(minis.map((m) => m.variant), new MobRoom(map, lcg(9), {}, { shapes: {} }, loadMobKinds()).snapshot(0).filter((m) => m.mini).map((m) => m.variant));
  // Killed (by a hitter far stronger than it): back after miniBoss.respawnSeconds at its own spot, full.
  const jus = minis.find((m) => m.mini === 'tin-can-jus-tin')!;
  const strong = { cls: 'slingshot', level: 20, points: { DEX: 100_000 } };
  const r = room.attack('mara', [jus.col + 1, jus.row], strong, jus.id, 1000, 0, 'Mara', 'm-mara');
  assert.ok(r.ok && r.kills[0]?.mini === 'tin-can-jus-tin');
  room.tick(1000 + R.respawnMs - 100);
  assert.ok(room.snapshot(1000 + R.respawnMs - 100).find((m) => m.id === jus.id)!.dead);
  const ev = room.tick(1000 + R.respawnMs + 10);
  assert.deepEqual(ev.find((e) => e.t === 'mob-spawn' && e.id === jus.id), { t: 'mob-spawn', id: jus.id, col: jus.col, row: jus.row, hp: jus.maxHp });
});

test('mini boss credit: everyone who did 10% of its HP (the killer if nobody did); its XP to each', () => {
  const room = new MobRoom(map, lcg(5), {}, { shapes: {} }, loadMobKinds());
  const jus = room.snapshot(0).find((m) => m.mini === 'tin-can-jus-tin')!;
  const weak = { cls: 'slingshot', level: 1 };
  const strong = { cls: 'slingshot', level: 20, points: { DEX: 100_000 } };
  const from: [number, number] = [jus.col + 1, jus.row];
  // A little (a hit or two of a Lv 1): under 10%, no credit.
  const bob = room.attack('bob', from, weak, jus.id, 0, 0, 'Bob', 'm-bob');
  assert.ok(bob.ok && bob.hits[0].damage < jus.maxHp * R.creditShare);
  const k = room.attack('mara', from, strong, jus.id, 10, 0, 'Mara', 'm-mara');
  assert.ok(k.ok);
  assert.deepEqual([k.kills[0].to, k.kills[0].xp, k.kills[0].level], [['m-mara'], L.miniBosses['tin-can'][0].xp, L.miniBosses['tin-can'][0].level]);
  // Back, then Bob does over 10% before she finishes it: both.
  room.tick(R.respawnMs + 100);
  let t = R.respawnMs + 200;
  let done = 0;
  while (done < jus.maxHp * R.creditShare) {
    const h = room.attack('bob', from, weak, jus.id, (t += 1100), 0, 'Bob', 'm-bob');
    assert.ok(h.ok);
    done += h.hits[0].damage;
  }
  const both = room.attack('mara', from, strong, jus.id, (t += 1100), 0, 'Mara', 'm-mara');
  assert.ok(both.ok && both.kills[0]);
  assert.deepEqual(both.kills[0].to.sort(), ['m-bob', 'm-mara']);
});

test('mini boss loot: its mob\'s Kusing × 10, one gear piece at the nearest gear level (brown/white/grey), a fragment 1 in 3; personal', () => {
  const random = lcg(11);
  let fragments = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) {
    const level = [4, 10, 14, 15, 18][i % 5];
    const got = miniLoot(D, 'tin-can', level, R, random, () => `u${i}`);
    const [lo, hi] = kusingRange(S, mobStats(S, 'tin-can')!.level);
    const kusing = (got[0] as { kusing: number }).kusing;
    assert.ok(kusing >= lo * 10 && kusing <= hi * 10 && kusing % 10 === 0, String(kusing));
    const gear = got.filter((g) => 'item' in g && isGearDef(D.defs.get(g.item.defId)));
    assert.equal(gear.length, 1);
    const it = (gear[0] as { item: { level: number; rarity: string; plus: number } }).item;
    assert.equal(it.level, level < 15 ? 10 : 20);
    assert.ok(['brown', 'white', 'grey'].includes(it.rarity) && it.plus <= 3);
    if (got.some((g) => 'item' in g && g.item.defId === 'rough-whetstone-fragment')) fragments++;
  }
  assert.ok(Math.abs(fragments / N - 1 / 3) < 0.04, String(fragments / N));
  assert.equal(nearestGearLevel([10, 20], 15), 20);
  // Each earner's own, never seen by the other.
  const room = new LootRoom(D, lcg(2));
  const lots = room.drop({ kind: 'tin-can', level: 4, at: [200, 100], to: ['a', 'b'], mini: 'tin-can-jus-tin' }, [], (_at, n) => Array.from({ length: n }, (_, i) => [200 + i, 100] as [number, number]), 0);
  assert.ok(lots.every((l) => l.personal && l.owners.length === 1));
  assert.ok(lots.filter((l) => l.owners[0] === 'a').every((l) => !room.view(l, 'b', 0)));
});

test('quest pieces: each mob\'s slot and agimat (classes/leveling.json miniBoss.questDrop), your gear type, grey, +5, bound, no lines', () => {
  const want: Record<string, [string, string]> = {
    'tin-can': ['body', 'hp'], 'bottle-caps': ['hands', 'critRate'], 'tire-roller': ['bottoms', 'atkRate'],
    'plastic-bag-spook': ['weapon', 'critDmg'], 'wire-tangle': ['head', 'critDmg'], 'scrap-crab': ['feet', 'amp'],
  };
  for (const [kind, [slot, stat]] of Object.entries(want)) {
    for (const [cls, type] of [['stick', 'heavy'], ['broom', 'light'], ['potlid', 'household']] as const) {
      const it = questDropFor(D, L, kind, L.miniBosses[kind][0].level, cls, `q-${kind}-${cls}`, lcg(4))!;
      const def = D.defs.get(it.defId) as { slot: string; gear?: string; level: number };
      assert.deepEqual([def.slot, it.rarity, it.plus, it.bound, it.lines, it.agimats.length, it.agimats[0]], [slot, 'grey', 5, true, [], 2, { stat, level: it.level }], `${kind} ${cls}`);
      if (slot === 'weapon') assert.equal((def as { class?: string }).class, cls, `${kind}: the ${cls}'s own weapon`);
      else assert.equal(def.gear?.toLowerCase(), type, `${kind}: the ${cls}'s own gear type`);
      // (Its agimat fits where it sits: crit stats on weapons, heads and hands, damage amp on weapons, bodies and feet.)
      assert.ok(!agimatSlots(S, stat) || agimatSlots(S, stat)!.includes(def.slot as never), `${kind}: ${stat} on ${slot}`);
    }
  }
  assert.equal(questDropFor(D, L, 'scrapheap-golem', 15, 'stick', 'q', lcg(1)), null);
});

/** A town over a socket with the Slums' mobs, two players (Mara, who one-shots anything, and Bob) arriving next to `at`,
 *  in a party; what each kill's XP and quest count went to. */
async function partyTown(room: InstanceType<typeof MobRoom>, at: [number, number]) {
  const kills: { who: string; xp: number }[] = [];
  const counted: string[] = [];
  const server = createServer();
  attachTown(server, {
    map: { size: [4, 4], spawn: [1, 1], blocked: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
    rooms: { slums: () => ({ size: map.size, spawn: at, blocked: map.blocked }) },
    mobs: { slums: room },
    authenticate: async (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('as'),
    profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} as never, cls: 'slingshot' }),
    progress: {
      fighter: (name) => ({ cls: 'slingshot', level: 20, points: name === 'Mara' ? { DEX: 100_000 } : {} }),
      kill: (name, k) => (kills.push({ who: name, xp: k.xp }), { progress: freshProgress(S, 'slingshot'), gained: k.xp, ups: 0 }),
    },
    items: { take: () => ({ ok: true }) as never, usePotion: () => null as never, state: () => ({ equipped: {}, bag: [], kusing: 0 }) },
    quests: { kill: (name, k) => (counted.push(`${name}:${k.kind}:${k.mini}`), { active: [{ id: CHAIN[1], step: 0, count: 1 }], questDrop: k.mini, cls: 'slingshot' }) },
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
  const a = await open('Mara');
  const b = await open('Bob');
  await wait(100);
  const bobId = (b.got.find((m) => m.t === 'welcome') as Extract<TownServerMessage, { t: 'welcome' }>).you;
  a.ws.send(JSON.stringify({ t: 'party-invite', to: bobId }));
  await wait(100);
  const invite = b.got.find((m) => m.t === 'party-invited') as Extract<TownServerMessage, { t: 'party-invited' }>;
  b.ws.send(JSON.stringify({ t: 'party-answer', invite: invite.invite, accept: true }));
  await wait(100);
  const close = async () => {
    for (const c of [a, b]) c.ws.close();
    await new Promise((ok) => server.close(ok));
  };
  return { a, b, kills, counted, close };
}
const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

test('over the town\'s socket: a party of 2 both get a mini boss\'s XP, their own loot and quest credit; a normal kill counts for both', async () => {
  const room = new MobRoom(map, lcg(16), {}, { shapes: {} }, loadMobKinds());
  const jus = room.snapshot(0).find((m) => m.mini === 'tin-can-jus-tin')!;
  // Mara alone takes the mini boss down: Bob, in her party nearby, gets its XP and his own loot too.
  const t = await partyTown(room, [jus.col + 1, jus.row]);
  t.a.ws.send(JSON.stringify({ t: 'attack', mob: jus.id, skill: 0 }));
  await wait(200);
  assert.deepEqual(t.kills.map((k) => k.who).sort(), ['Bob', 'Mara']);
  assert.ok(t.kills.every((k) => k.xp === L.miniBosses['tin-can'][0].xp));
  const mine = t.a.got.find((m) => m.t === 'loot-drop') as Extract<TownServerMessage, { t: 'loot-drop' }>;
  const his = t.b.got.find((m) => m.t === 'loot-drop') as Extract<TownServerMessage, { t: 'loot-drop' }>;
  assert.ok(mine && his, 'each sees loot');
  assert.ok(mine.loot.every((l) => l.mine) && his.loot.every((l) => l.mine), 'each only their own');
  assert.ok(!mine.loot.some((l) => his.loot.some((h) => h.id === l.id)));
  assert.deepEqual(t.counted.sort(), ['Bob:tin-can:true', 'Mara:tin-can:true']);
  // The kill completed both players' mini boss quest: each gets their quest piece too, theirs alone (a Slingshot's Light
  // body armor at the nearest gear level, grey, +5, bound, an HP agimat in its first slot).
  const pieces = (got: TownServerMessage[]) =>
    got.filter((m): m is Extract<TownServerMessage, { t: 'loot-drop' }> => m.t === 'loot-drop').flatMap((m) => m.loot).filter((l) => l.item?.plus === 5);
  for (const c of [t.a, t.b]) {
    const [p, ...more] = pieces(c.got);
    assert.ok(p && !more.length, 'one quest piece each');
    const def = D.defs.get(p.item!.defId) as { slot: string; gear?: string; level: number };
    assert.deepEqual([def.slot, def.gear?.toLowerCase(), p.item!.rarity, p.item!.bound, p.item!.lines, p.item!.agimats[0]?.stat, p.item!.agimats.length], ['body', 'light', 'grey', true, [], 'hp', 2]);
    assert.equal(def.level, 10, 'Jus Tin (Lv 4): the Lv 10 gear');
  }
  assert.notEqual(pieces(t.a.got)[0].id, pieces(t.b.got)[0].id);
  assert.ok(t.b.got.some((m) => m.t === 'quests'), 'Bob told his counts');
  await t.close();
  // A normal Tin Can she kills counts for Bob's quest too (its XP is hers alone).
  const room2 = new MobRoom(map, lcg(16), {}, { shapes: {} }, loadMobKinds());
  const can = room2.snapshot(0).find((m) => m.id.startsWith('tin-can-alley:') && !m.mini)!;
  const u = await partyTown(room2, [can.col + 1, can.row]);
  u.a.ws.send(JSON.stringify({ t: 'attack', mob: can.id, skill: 0 }));
  await wait(200);
  assert.deepEqual(u.kills.map((k) => k.who), ['Mara']);
  assert.deepEqual(u.counted.sort(), ['Bob:tin-can:false', 'Mara:tin-can:false']);
  await u.close();
});

test('the real quests: a party on Just In Time kills Jus Tin; each gets their own +5 piece on a tile of its own (never under their other loot), and can pick it up', async () => {
  // Two members on tanod-02 (as on the live server, 9 Oct: the Pot lid's piece fell on its Kusing's tile and hid).
  for (const [u, cls] of [['qPot', 'potlid'], ['qBroom', 'broom']] as const) {
    adventureOf(u);
    townQuest(u, { quest: 'main-01-class', action: 'talk', npc: 'tanod' } as never);
    townQuest(u, { quest: 'main-01-class', action: 'chooseClass', cls } as never);
    for (let i = 0; i < 20; i++) questKillFor(u, { kind: 'tin-can', mini: false });
    assert.ok(townQuest(u, { quest: CHAIN[0], action: 'report' } as never).ok);
  }
  const room = new MobRoom(map, lcg(16), {}, { shapes: {} }, loadMobKinds());
  const jus = room.snapshot(0).find((m) => m.mini === 'tin-can-jus-tin')!;
  const server = createServer();
  attachTown(server, {
    map: { size: [4, 4], spawn: [1, 1], blocked: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
    rooms: { slums: () => ({ size: map.size, spawn: [jus.col + 1, jus.row], blocked: map.blocked }) },
    mobs: { slums: room },
    authenticate: async (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('as'),
    profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} as never, cls: adventureOf(name).cls }),
    // (The Pot lid hits from range here and one-shots it; the quests, loot and bags are the bot's own.)
    progress: { fighter: (name) => ({ ...fighterOf(name), cls: 'slingshot', level: 20, points: name === 'qPot' ? { DEX: 100_000 } : {} }), kill: (name, k) => killFor(name, k) },
    items: { take: takeLootFor, usePotion: usePotionFor, state: combatOf },
    quests: { kill: questKillFor },
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
  const pot = await open('qPot');
  const broom = await open('qBroom');
  await wait(150);
  const broomId = (broom.got.find((m) => m.t === 'welcome') as Extract<TownServerMessage, { t: 'welcome' }>).you;
  pot.ws.send(JSON.stringify({ t: 'party-invite', to: broomId }));
  await wait(150);
  const invite = broom.got.find((m) => m.t === 'party-invited') as Extract<TownServerMessage, { t: 'party-invited' }>;
  broom.ws.send(JSON.stringify({ t: 'party-answer', invite: invite.invite, accept: true }));
  await wait(150);
  pot.ws.send(JSON.stringify({ t: 'attack', mob: jus.id, skill: 0 }));
  await wait(300);
  for (const [name, c, gear] of [['qPot', pot, 'household'], ['qBroom', broom, 'light']] as const) {
    const drops = c.got.filter((m): m is Extract<TownServerMessage, { t: 'loot-drop' }> => m.t === 'loot-drop').flatMap((m) => m.loot);
    const pieces = drops.filter((l) => l.item?.plus === 5 && l.item.bound);
    assert.equal(pieces.length, 1, `${name}: one quest piece`);
    const p = pieces[0];
    assert.equal((D.defs.get(p.item!.defId) as { gear?: string }).gear?.toLowerCase(), gear, `${name}: their own gear type`);
    assert.ok(!drops.some((l) => l !== p && l.col === p.col && l.row === p.row), `${name}: nothing else on its tile`);
  }
  // The Pot lid walks to it and picks it up: it's in the bag.
  const p = pot.got.filter((m): m is Extract<TownServerMessage, { t: 'loot-drop' }> => m.t === 'loot-drop').flatMap((m) => m.loot).find((l) => l.item?.plus === 5)!;
  let [col, row] = (pot.got.find((m) => m.t === 'welcome') as Extract<TownServerMessage, { t: 'welcome' }>).spawn;
  while (col !== p.col || row !== p.row) {
    col += Math.sign(p.col - col);
    row += Math.sign(p.row - row);
    pot.ws.send(JSON.stringify({ t: 'step', col, row }));
    await wait(180);
  }
  pot.ws.send(JSON.stringify({ t: 'pick', id: p.id }));
  await wait(150);
  assert.ok(combatOf('qPot').bag.some((i) => i.uid === p.item!.uid && i.plus === 5), 'in the bag');
  for (const c of [pot, broom]) c.ws.close();
  await new Promise((ok) => server.close(ok));
});

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
