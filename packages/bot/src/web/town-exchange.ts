import type { TownExchangeResponse } from '@mikazuki/shared';
import { buyVouchers, kusingForKowens, sellKowensRefusal, useVouchers, voucherOf } from '@mikazuki/shared';
import { add, balance, take } from '../credits/store.js';
import { debtOf } from '../loans/loans.js';
import { loadItemData, loadStats } from './stats-data.js';
import { newUid, withItems } from './adventure.js';

// 🏦 The Bank's exchange (CONTEXT.md Kowen Voucher, Exchange; shared exchange.ts has the rules, stats.json `exchange`
// the numbers): POST /town/exchange/buy-voucher (Kusing off, the vouchers into the combat bag, one save: nothing
// changes when a check fails), /sell-kowens (the Kowens out of the wallet, the Kusing into the bag's purse) and
// /use-voucher (the vouchers out, the Kowens into the wallet; one at a time a member, so a double click never pays
// twice). Every one is a line in the bot's log with the Kusing and Kowens before and after. Kowens coming in go through
// the credits store's `add`, so a late loan's garnish takes its share as from any earning; selling is refused while a
// loan is owed, as /give was.

/** Members with a voucher use under way (a second request meanwhile is refused, not queued). */
const using = new Set<string>();

export function buyVoucherFor(userId: string, voucherId: unknown, amount: unknown): TownExchangeResponse {
  if (typeof voucherId !== 'string' || typeof amount !== 'number') return { ok: false, message: 'Pick a voucher and how many.' };
  let before = 0;
  const r = withItems(
    userId,
    (s) => {
      before = s.kusing;
      return { ...buyVouchers(loadItemData(), s, voucherId, amount, newUid), after: s.kusing };
    },
    (x) => x.ok,
  );
  if (r.ok) console.log(`[exchange] ${userId} bought ${amount}× ${voucherId}: Kusing ${before} → ${r.after}, Kowens ${balance(userId)} (unchanged)`);
  return { ok: r.ok, message: r.message };
}

export function sellKowensFor(userId: string, kowens: unknown): TownExchangeResponse {
  const stats = loadStats();
  if (debtOf(userId)) return { ok: false, message: "You can't sell Kowens while you have a loan. Pay it off at the bank first." };
  const hasCharacter = withItems(userId, (s) => !!s.cls, () => false);
  const wallet = balance(userId);
  const why = sellKowensRefusal(stats, kowens, wallet, hasCharacter);
  if (why) return { ok: false, message: why };
  const n = kowens as number;
  const kusing = kusingForKowens(stats, n);
  if (take(userId, n) < n) return { ok: false, message: `You only have ${balance(userId).toLocaleString('en-US')} Kowens in your wallet.` }; // (changed under us: the store took what it could; put it back)
  let kusingBefore = 0;
  let kusingAfter = 0;
  try {
    withItems(userId, (s) => {
      kusingBefore = s.kusing;
      s.kusing += kusing;
      kusingAfter = s.kusing;
      return true;
    });
  } catch (err) {
    add(userId, n, { garnish: false }); // (the save failed: their Kowens back)
    throw err;
  }
  console.log(`[exchange] ${userId} sold ${n} Kowens for ${kusing} Kusing: Kowens ${wallet} → ${balance(userId)}, Kusing ${kusingBefore} → ${kusingAfter}`);
  return { ok: true, message: `Sold ${n.toLocaleString('en-US')} ${n === 1 ? 'Kowen' : 'Kowens'} for ${kusing.toLocaleString('en-US')} Kusing.` };
}

export function useVoucherFor(userId: string, voucherId: unknown, amount: unknown): TownExchangeResponse {
  if (typeof voucherId !== 'string' || typeof amount !== 'number') return { ok: false, message: 'Pick a voucher and how many.' };
  if (!voucherOf(loadStats(), voucherId)) return { ok: false, message: 'No such voucher.' };
  if (using.has(userId)) return { ok: false, message: 'One moment: your last voucher is still being counted.' };
  using.add(userId);
  try {
    const r = withItems(userId, (s) => useVouchers(loadItemData(), s, voucherId, amount), (x) => x.ok);
    if (!r.ok) return r;
    const before = balance(userId);
    const after = add(userId, r.kowens); // (a late loan's garnish takes its share, as from any earning)
    console.log(`[exchange] ${userId} used ${amount}× ${voucherId}: Kowens ${before} → ${after} (+${r.kowens})`);
    return { ok: true, message: r.message, kowens: r.kowens };
  } finally {
    using.delete(userId);
  }
}
