import { add, balance, take } from '../credits/store.js';
import { kvLoad, kvSave } from '../db/db.js';
import type { ArenaBets } from './town-arena.js';

// 🪙 The Arena's bets (town-arena.ts decides the matches and announces them; the money is here). When a betting match
// starts, both stakes are taken from the wallets and written down as held (kv 'arena-held', one entry per pair); the
// winner gets both and the entry goes. If the bot stops mid-match, the next start gives everyone their held stake back
// (refundHeldBets).

type Held = Record<string, { a: string; b: string; stake: number }>;
const KEY = 'arena-held';
let held: Held = kvLoad<Held>(KEY, {});
const pair = (a: string, b: string) => [a, b].sort().join('|');

export function arenaBets(): ArenaBets {
  return {
    hold(a, b, want) {
      const stake = Math.min(want, balance(a), balance(b));
      if (stake <= 0) return 0;
      take(a, stake);
      take(b, stake);
      held = { ...held, [pair(a, b)]: { a, b, stake } };
      kvSave(KEY, held);
      return stake;
    },
    holdSolo(player, want) {
      const stake = Math.min(want, balance(player));
      if (stake <= 0) return 0;
      take(player, stake);
      held = { ...held, [`${player}|house`]: { a: player, b: '', stake } };
      kvSave(KEY, held);
      return stake;
    },
    paySolo(player, stake, won) {
      const k = `${player}|house`;
      if (!held[k]) return;
      const { [k]: _, ...rest } = held;
      held = rest;
      kvSave(KEY, held);
      if (!won) return void console.log(`[arena] ${player} lost a ${stake}-Kowen jack en poy to the bot`);
      add(player, stake * 2, { garnish: false });
      console.log(`[arena] ${player} won ${stake * 2} from a ${stake}-Kowen jack en poy against the bot`);
    },
    pay(winner, loser, stake) {
      const k = pair(winner, loser);
      if (!held[k]) return; // already settled
      const { [k]: _, ...rest } = held;
      held = rest;
      kvSave(KEY, held);
      add(winner, stake * 2, { garnish: false });
      console.log(`[arena] ${winner} won ${stake * 2} from a ${stake}-Kowen jack en poy against ${loser}`);
    },
  };
}

/** At start: stakes held by a match the bot didn't finish go back to both players. */
export function refundHeldBets(): void {
  const left = Object.values(held);
  if (!left.length) return;
  for (const h of left) {
    add(h.a, h.stake, { garnish: false });
    if (h.b) add(h.b, h.stake, { garnish: false }); // (none against the bot)
  }
  held = {};
  kvSave(KEY, held);
  console.log(`[arena] refunded ${left.length} unfinished jack en poy bet(s)`);
}
