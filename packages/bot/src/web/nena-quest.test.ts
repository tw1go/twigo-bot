import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 🔭 Aling Nena's quest (side-nena-binoculars) and practice runs, against the game's real data files and a throwaway
// database (never the real .env or data/): offered from Lv 16; talking starts it with a Practice Warren Ticket; the
// binoculars arriving in the bag move it on; handing them over completes it (its XP, Kusing and Kowens; the tickets go);
// another ticket only when she may hand one over; quest items never sold, traded, dropped or taken apart; real runs need
// the quest done; practice runs are solo, weaker, their Kusing halved, and nobody else gets in.
const dir = mkdtempSync(join(tmpdir(), 'nena-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { QUESTS, freshAdventure, questStep, startQuests, warrensAccessOf, withItems, practiceDropFor } = await import('./adventure.js');
const { closeDatabase } = await import('../db/db.js');
const { loadDungeons, loadItemData, loadStats } = await import('./stats-data.js');
const { Run, Warrens, loadWarrensMap } = await import('./town-warrens.js');
const { loadMobKinds } = await import('./town-mobs.js');
const { disassembleRefusal, dropRefusal, heldCount, newItem, offeredBy, sellPrice, tradeRefusal, xpToNext } = await import('@mikazuki/shared');
type AdventureState = import('@mikazuki/shared').AdventureState;

const D = loadItemData();
const S = loadStats();
const W = loadDungeons().warrens;
const P = W.practice!;
const QID = 'side-nena-binoculars';
const quest = QUESTS.find((q) => q.id === QID)!;
const TICKET = P.ticket;
const BINOCULARS = P.drop!;

/** A character at a level with 0 XP into it, with a class. */
function at(level: number): AdventureState {
  const s = freshAdventure();
  s.cls = 'slingshot';
  s.progress = { ...s.progress, level, xp: 0 };
  return s;
}
const talk = (s: AdventureState, ctx = {}) => questStep(s, { quest: QID, action: 'talk', npc: 'nena' }, ctx);
const item = (id: string) => newItem(S, D.defs.get(id)!, `t-${id}-${Math.random()}`);
const stepOf = (s: AdventureState) => s.quests.active.find((p) => p.id === QID)?.step;

test('offered from Lv 16 (not at 15), by Aling Nena only', () => {
  assert.equal(quest.minLevel, 16);
  assert.equal(offeredBy(at(15), QUESTS, 'nena'), null);
  assert.equal(offeredBy(at(16), QUESTS, 'nena')?.id, QID);
  assert.equal(offeredBy(at(20), QUESTS, 'nena')?.id, QID, 'already above it: offered too');
  assert.equal(offeredBy(at(16), QUESTS, 'tanod'), null);
  // Never started on its own.
  const s = at(16);
  startQuests(s);
  assert.equal(stepOf(s), undefined);
  // Under Lv 16, talking to her starts nothing.
  assert.equal(talk(at(15)).ok, false);
});

test('talking starts it: the talk done, a Practice Warren Ticket in the bag', () => {
  const s = at(16);
  const r = talk(s, { now: 1000 });
  assert.ok(r.ok);
  assert.equal(r.handed, TICKET);
  assert.equal(stepOf(s), 1, 'on to the collect objective');
  assert.equal(heldCount(s.bag, TICKET), 1);
  // The ticket is bound and in no shop: never sold, traded or dropped.
  const ticket = s.bag.find((i) => i.defId === TICKET)!;
  assert.equal(ticket.bound, true);
  assert.equal(sellPrice(D, ticket), null);
  assert.ok(tradeRefusal(D, ticket));
  assert.ok(dropRefusal(D, ticket));
});

test('another ticket: only with none, no binoculars, no practice run going, after retryHours', () => {
  const s = at(16);
  talk(s, { now: 0 });
  // Still holding one: just her reminder.
  assert.deepEqual(talk(s, { now: 1 }), { ok: true });
  s.bag = s.bag.filter((i) => i.defId !== TICKET); // (used on a run that ended without the binoculars)
  assert.deepEqual(talk(s, { now: 2, inPracticeRun: true }), { ok: true }, 'a practice run going: none');
  const soon = talk(s, { now: 1000 });
  assert.equal(soon.ok, true);
  assert.equal(soon.handed, undefined);
  assert.match(soon.message ?? '', /Come back in \d+ hours?/);
  const later = talk(s, { now: (P.retryHours ?? 0) * 3_600_000 + 5 });
  assert.equal(later.handed, TICKET);
  assert.equal(heldCount(s.bag, TICKET), 1);
});

test('the binoculars: a quest item never sold, traded, dropped or taken apart; arriving, the quest moves on', () => {
  const b = item(BINOCULARS);
  assert.equal(sellPrice(D, b), null);
  assert.equal(tradeRefusal(D, b), "Quest items can't be traded.");
  assert.equal(dropRefusal(D, b), "Quest items can't be dropped.");
  assert.ok(disassembleRefusal(D, { bag: [b], equipped: {} }, b.uid));
  const s = at(16);
  talk(s, { now: 0 });
  s.bag.push(b);
  startQuests(s); // (as /me, or any change to their items: withItems)
  assert.equal(stepOf(s), 2, 'collected: on to bringing them back');
});

test('handing them over: her quest done, its XP (Lv 16 → 17 exactly), Kusing and Kowens; binoculars and tickets gone', () => {
  const s = at(16);
  talk(s, { now: 0 });
  s.bag.push(item(TICKET)); // (a spare)
  s.bag.push(item(BINOCULARS));
  const kusing = s.kusing;
  const r = talk(s, { now: 10 });
  assert.ok(r.ok);
  assert.equal(r.completed, QID);
  assert.equal(r.taken, BINOCULARS);
  assert.equal(quest.rewardXP, xpToNext(S, 16), "quests.json's XP is Lv 16's whole level");
  assert.equal(r.xp, quest.rewardXP);
  assert.equal(s.progress.level, 17);
  assert.equal(s.progress.xp, 0);
  assert.equal(s.kusing - kusing, quest.rewardKusing);
  assert.equal(r.kowens, quest.rewardKowens, 'the Kowens (the server puts them in the wallet)');
  assert.equal(heldCount(s.bag, BINOCULARS), 0);
  assert.equal(heldCount(s.bag, TICKET), 0);
  assert.ok(s.quests.done.includes(QID));
  // Without them she takes nothing.
  const t = at(16);
  talk(t, { now: 0 });
  t.quests.active.find((p) => p.id === QID)!.step = 2;
  assert.equal(talk(t).ok, false);
});

test("the Warren Gate's access: a real run needs her quest done, a practice run needs the binoculars still", () => {
  const user = 'nena-user';
  withItems(user, (s) => {
    s.progress = { ...s.progress, level: 16, xp: 0 };
    s.cls = 'slingshot';
  });
  assert.deepEqual(warrensAccessOf(user), { done: false, needs: false, practiceTickets: 0 });
  withItems(user, (s) => talk(s, { now: 0 }));
  assert.deepEqual(warrensAccessOf(user), { done: false, needs: true, practiceTickets: 1 });
  assert.equal(practiceDropFor(user)?.defId, BINOCULARS);
  // The binoculars in: the quest moves on (withItems), so no more drops.
  withItems(user, (s) => s.bag.push(item(BINOCULARS)));
  assert.equal(warrensAccessOf(user).needs, false);
  assert.equal(practiceDropFor(user), null);
});

// ── The Warrens ──

const map = loadWarrensMap();
const deps = () => ({ kinds: loadMobKinds(), levels: {}, shapes: { shapes: {} }, fightData: D, leveling: null, slamMs: 500, random: () => 0.5 });

test('a real run: Lv 16 and her quest done, to open and to join', () => {
  const parties: Record<string, string> = { a: 'p', b: 'p' };
  const w = new Warrens(W, map, deps(), (m) => parties[m] ?? null);
  assert.equal(W.entry.minLevel, 16);
  assert.deepEqual(w.open('a', 'Ana', 15, () => true, 0, { done: true }), { ok: false, reason: 'level', message: 'Reach Lv 16, then help Aling Nena on the plaza.' });
  assert.deepEqual(w.open('a', 'Ana', 16, () => true, 0, { done: false }), { ok: false, reason: 'quest', message: "Help Aling Nena first: she's lost something in the Warrens." });
  const gate = w.gate('a', 16, 1, { done: false });
  assert.equal(gate.blocked, 'quest');
  assert.equal(gate.questLine, "Help Aling Nena first: she's lost something in the Warrens.");
  const r = w.open('a', 'Ana', 16, () => true, 0, { done: true, notReady: ['Kiko'] });
  assert.ok(r.ok);
  // A party member who hasn't helped her can't walk in; one who has can.
  assert.equal(w.join('b', 16, r.run.id, { done: false }).ok, false);
  assert.ok(w.join('b', 16, r.run.id, { done: true }).ok);
  assert.deepEqual(w.gate('a', 16, 1, { done: true, notReady: ['Kiko'] }).notReady, ['Kiko']);
});

test('a practice run: solo even in a party, its own ticket, nobody joins; the gate offers it while the quest needs it', () => {
  const parties: Record<string, string> = { a: 'p', b: 'p' };
  const w = new Warrens(W, map, deps(), (m) => parties[m] ?? null);
  assert.equal(w.gate('a', 16, 0, { done: false, needs: true, practiceTickets: 1 }).practice?.tickets, 1);
  assert.equal(w.gate('a', 16, 0, { done: false, needs: false, practiceTickets: 1 }).practice, undefined, 'binoculars found: no practice');
  assert.equal(w.openPractice('a', 'Ana', 15, () => true, 0).ok, false, 'Lv 16 and up');
  assert.equal(w.openPractice('a', 'Ana', 16, () => false, 0).ok, false, 'no ticket');
  const r = w.openPractice('a', 'Ana', 16, () => true, 0);
  assert.ok(r.ok);
  assert.equal(r.run.party, null, 'solo, though Ana is in a party');
  assert.ok(r.run.practice);
  assert.deepEqual(w.join('b', 16, r.run.id, { done: true }), { ok: false, reason: 'party', message: 'Practice runs are solo.' });
  assert.equal(w.runOf('b'), undefined);
  assert.equal(w.openPractice('a', 'Ana', 16, () => true, 0).ok, false, 'one run at a time');
  assert.equal(w.gate('a', 16, 0, { done: false, needs: true, practiceTickets: 1 }).practice?.blocked, 'run');
  assert.equal(r.run.view(0).practice, true, '"Practice" under its timer');
});

test("a practice run's numbers: HP, ATK and XP × the practice block's; Kusing × kusingMult; the same loot otherwise", () => {
  const real = new Run('real', W, map, deps(), { member: 'a', name: 'Ana' }, null, 0);
  const practice = new Run('prac', W, map, deps(), { member: 'a', name: 'Ana' }, null, 0, P);
  const boss = `boss:${W.lastBoss.id}`;
  const stats = (run: InstanceType<typeof Run>, id: string) => (run.mobs as unknown as { byId: Map<string, { maxHp: number; stats: { atk: number; xp: number } }> }).byId.get(id)!;
  const [rb, pb] = [stats(real, boss), stats(practice, boss)];
  assert.equal(pb.maxHp, Math.round(rb.maxHp * P.hpMult));
  assert.equal(pb.stats.atk, Math.round(rb.stats.atk * P.atkMult));
  assert.equal(pb.stats.xp, Math.round(rb.stats.xp * P.xpMult));
  // The same rolls, its Kusing halved (the same random numbers on both).
  const kill = { id: boss, kind: W.lastBoss.id, at: W.lastBoss.tile, level: W.lastBoss.level, xp: 0, to: ['a'], warrens: { id: W.lastBoss.id, boss: 'last' as const } };
  const roll = (run: InstanceType<typeof Run>) => {
    let n = 0;
    const random = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
    let u = 0;
    return run.lootFor(kill, ['slingshot'], () => `u${++u}`, random).contents;
  };
  const [a, b] = [roll(real), roll(practice)];
  assert.equal(a.length, b.length, 'the same drops');
  a.forEach((x, i) => {
    const y = b[i];
    if ('kusing' in x) assert.equal((y as { kusing: number }).kusing, Math.max(1, Math.round(x.kusing * P.kusingMult)));
    else assert.equal((y as { item: { defId: string } }).item.defId, x.item.defId);
  });
  assert.ok(practice.isLastBoss(boss));
});

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
