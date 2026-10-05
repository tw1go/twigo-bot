import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ArenaServerMessage, TownPlayer } from '@mikazuki/shared';
import { Arena, type ArenaResult, type ArenaSeat, INTRO_MS, PICK_MS, REMATCH_MS, REVEAL_MS, arenaLine, beats } from './town-arena.js';

// The Arena's jack en poy with a hand-cranked clock: timers only run when the test says so.
function setup(random = () => 0, bets: ConstructorParameters<typeof Arena>[2] = null, report: ConstructorParameters<typeof Arena>[3] = null) {
  let now = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let next = 1;
  const clock = {
    set: (fn: () => void, ms: number) => {
      const id = next++;
      timers.push({ at: now + ms, fn, id });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clear: (t: ReturnType<typeof setTimeout>) => (timers = timers.filter((x) => x.id !== (t as unknown as number))),
  };
  /** Moves time on, running whatever falls due (in order). */
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const due = timers.filter((x) => x.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((x) => x !== due);
      now = due.at;
      due.fn();
    }
    now = until;
  };
  const arena = new Arena(clock, random, bets, report);
  const seat = (name: string): ArenaSeat & { inbox: ArenaServerMessage[] } => {
    const inbox: ArenaServerMessage[] = [];
    const player = { id: `p-${name}`, nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} } as unknown as TownPlayer;
    return { key: name, player, inbox, send: (m) => inbox.push(m) };
  };
  return { arena, seat, advance };
}

const last = (s: { inbox: ArenaServerMessage[] }, t: ArenaServerMessage['t']) => [...s.inbox].reverse().find((m) => m.t === t);

test('the rules: bato > gunting > papel > bato', () => {
  assert.ok(beats('bato', 'gunting') && beats('gunting', 'papel') && beats('papel', 'bato'));
  assert.ok(!beats('bato', 'papel') && !beats('bato', 'bato'));
});

test('two players are matched, rounds reveal both hands together, a draw replays, first to 2 wins', () => {
  const { arena, seat, advance } = setup();
  const a = seat('Alice');
  const b = seat('Bob');
  arena.join(a);
  assert.equal(a.inbox[0].t, 'arena-queued');
  arena.join(b);
  assert.deepEqual([last(a, 'arena-start'), last(b, 'arena-start')].map((m) => m?.t === 'arena-start' && m.opponent.nickname), ['Bob', 'Alice']);

  advance(INTRO_MS);
  assert.equal(last(a, 'arena-round')?.t, 'arena-round');
  arena.pick('Alice', 'bato');
  assert.equal(last(b, 'arena-reveal'), undefined); // held until both have picked
  arena.pick('Alice', 'papel'); // no changing your mind
  arena.pick('Bob', 'bato');
  const draw = last(a, 'arena-reveal');
  assert.ok(draw?.t === 'arena-reveal' && draw.result === 'draw' && draw.you === 'bato' && draw.score[0] === 0);

  advance(REVEAL_MS);
  arena.pick('Alice', 'papel');
  arena.pick('Bob', 'bato');
  const r1 = last(b, 'arena-reveal');
  assert.ok(r1?.t === 'arena-reveal' && r1.result === 'lose' && r1.you === 'bato' && r1.them === 'papel' && r1.score.join() === '0,1' && !r1.over);

  advance(REVEAL_MS);
  arena.pick('Alice', 'gunting');
  arena.pick('Bob', 'papel');
  const end = last(a, 'arena-reveal');
  assert.ok(end?.t === 'arena-reveal' && end.result === 'win' && end.score.join() === '2,0' && end.over === 'you');
  const endB = last(b, 'arena-reveal');
  assert.ok(endB?.t === 'arena-reveal' && endB.over === 'them');
});

test('no pick in time: a random hand, and the round still ends', () => {
  const { arena, seat, advance } = setup(() => 0); // the random hand is bato
  const a = seat('Alice');
  const b = seat('Bob');
  arena.join(a);
  arena.join(b);
  advance(INTRO_MS);
  arena.pick('Alice', 'papel');
  advance(PICK_MS + 1000);
  const r = last(a, 'arena-reveal');
  assert.ok(r?.t === 'arena-reveal' && r.them === 'bato' && r.random.join() === 'false,true' && r.result === 'win');
});

test('a rematch is asked for and accepted (or declined); leaving mid-match gives the other the win', () => {
  const { arena, seat, advance } = setup();
  const a = seat('Alice');
  const b = seat('Bob');
  arena.join(a);
  arena.join(b);
  advance(INTRO_MS);
  for (let i = 0; i < 2; i++) {
    arena.pick('Alice', 'papel');
    arena.pick('Bob', 'bato');
    advance(REVEAL_MS);
  }
  arena.rematch('Alice');
  assert.equal(a.inbox.at(-1)?.t, 'arena-rematch-wait');
  assert.equal(b.inbox.at(-1)?.t, 'arena-rematch-ask');
  arena.decline('Bob');
  assert.equal(a.inbox.at(-1)?.t, 'arena-rematch-declined');
  arena.rematch('Alice'); // asks again
  arena.rematch('Bob'); // accepts
  const again = last(b, 'arena-start');
  assert.ok(again?.t === 'arena-start' && again.rematch);

  arena.leave('Bob'); // mid-match now
  const left = last(a, 'arena-left');
  assert.ok(left?.t === 'arena-left' && left.youWin);
  assert.equal(arena.playing, 0);
  arena.pick('Alice', 'bato'); // nothing happens: the match is gone
});

test('bets: the stake is the smaller bet, held at the start, and the winner gets both (a walk-out forfeits it)', () => {
  const wallet: Record<string, number> = { Alice: 50, Bob: 50 };
  const held: Record<string, number> = {};
  const bets = {
    hold: (x: string, y: string, want: number) => {
      const stake = Math.min(want, wallet[x], wallet[y]);
      wallet[x] -= stake;
      wallet[y] -= stake;
      held[[x, y].sort().join()] = stake;
      return stake;
    },
    pay: (winner: string, loser: string, stake: number) => {
      wallet[winner] += stake * 2;
      delete held[[winner, loser].sort().join()];
    },
    holdSolo: (x: string, want: number) => {
      const stake = Math.min(want, wallet[x]);
      wallet[x] -= stake;
      held[x] = stake;
      return stake;
    },
    paySolo: (x: string, stake: number, won: boolean) => {
      if (won) wallet[x] += stake * 2;
      delete held[x];
    },
  };
  const { arena, seat, advance } = setup(() => 0, bets);
  const a = seat('Alice');
  const b = seat('Bob');
  arena.join(a, 5);
  arena.join(b, 8);
  const start = last(a, 'arena-start');
  assert.ok(start?.t === 'arena-start' && start.stake === 5); // 5 against 8 plays for 5
  assert.deepEqual([wallet.Alice, wallet.Bob], [45, 45]);
  advance(INTRO_MS);
  for (let i = 0; i < 2; i++) {
    arena.pick('Bob', 'papel');
    arena.pick('Alice', 'bato');
    advance(REVEAL_MS);
  }
  assert.deepEqual([wallet.Alice, wallet.Bob], [45, 55]); // Bob won 5
  // A rematch at 8 each (both accept 8), then Alice walks out: Bob gets the stake.
  arena.rematch('Alice', 8);
  arena.rematch('Bob', 8);
  assert.deepEqual([wallet.Alice, wallet.Bob], [37, 47]);
  arena.leave('Alice');
  assert.deepEqual([wallet.Alice, wallet.Bob], [37, 63]);
  assert.deepEqual(held, {});

  // Against the bot (random 0: it always plays bato, and is named Juan): Alice bets 10 and wins with papel.
  arena.playBot(a, 10);
  const vsBot = last(a, 'arena-start');
  assert.ok(vsBot?.t === 'arena-start' && vsBot.opponent.bot && vsBot.opponent.nickname === 'Juan' && vsBot.stake === 10);
  assert.equal(wallet.Alice, 27);
  advance(INTRO_MS);
  for (let i = 0; i < 2; i++) {
    arena.pick('Alice', 'papel');
    advance(REVEAL_MS);
  }
  assert.equal(wallet.Alice, 47);
  arena.rematch('Alice', 20); // the bot always accepts
  assert.equal(wallet.Alice, 27);
  advance(REMATCH_MS);
  arena.pick('Alice', 'gunting'); // loses to bato
  advance(REVEAL_MS);
  arena.pick('Alice', 'gunting');
  assert.equal(wallet.Alice, 27); // the stake is kept
  assert.deepEqual(held, {});
});

test('every finished match is reported for the system feed, with a mocking line about the loser', () => {
  const results: ArenaResult[] = [];
  const { arena, seat, advance } = setup(() => 0, null, (r) => results.push(r));
  const a = seat('Alice');
  const b = seat('Bob');
  arena.join(a);
  arena.join(b);
  advance(INTRO_MS);
  for (let i = 0; i < 2; i++) {
    arena.pick('Alice', 'papel');
    arena.pick('Bob', 'bato');
    advance(REVEAL_MS);
  }
  assert.deepEqual(results[0], { winner: 'Alice', loser: 'Bob', win: 'papel', lose: 'bato', stake: 0 });
  assert.equal(arenaLine(results[0], 0), "Alice's papel wrapped up Bob's bato. Better luck next time, Bob.");
  arena.rematch('Alice');
  arena.rematch('Bob');
  advance(REMATCH_MS);
  arena.pick('Bob', 'papel');
  advance(REVEAL_MS); // a round played, then Bob walks out
  arena.leave('Bob');
  assert.deepEqual(results[1], { winner: 'Alice', loser: 'Bob', stake: 0, walkout: true });
  // Against the bot (random 0: it's Juan, playing bato): Alice's gunting loses twice.
  arena.playBot(a);
  advance(INTRO_MS);
  arena.pick('Alice', 'gunting');
  advance(REVEAL_MS);
  arena.pick('Alice', 'gunting');
  assert.deepEqual(results[2], { winner: 'Juan', loser: 'Alice', win: 'bato', lose: 'gunting', stake: 0, bot: 'winner' });
  assert.equal(arenaLine({ ...results[2], stake: 3 }, 0), 'Alice lost to the practice bot. The bot! 3 Kowens gone.');
});
