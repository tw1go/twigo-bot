import type { ExchangeData, StatsData } from './stats.js';
import { type Item, type ItemData, addToBag, bagRoom, countOf, newItem, takeKind } from './items.js';

// 🏦 The Bank's exchange (CONTEXT.md Kowen Voucher, Exchange; stats.json `exchange`, every number from there): Kowen
// Vouchers bought for Kusing (kowens × kusingPerKowenBuy each) and used from the bag for their Kowens, and Kowens sold
// for Kusing (kusingPerKowenSell each). A voucher is a plain consumable (tradeable, never bound, never sold back), so a
// voucher traded is the one way Kowens pass between players. Pure: the bot runs these on a member's items in one save,
// the dev town's pretend exchange the same code.

/** Whoever's items and Kusing an exchange works on (the bot's CombatItems, the page's AdventureState). */
export interface Purse {
  bag: Item[];
  kusing: number;
}

export type ExchangeResult<T = unknown> = ({ ok: true; message: string } & T) | { ok: false; message: string };

export const exchangeRules = (stats: StatsData): ExchangeData | null => stats.exchange ?? null;

/** The voucher a kind id is, or null. */
export const voucherOf = (stats: StatsData, defId: string | null | undefined) => (defId && stats.exchange?.vouchers.find((v) => v.id === defId)) || null;

export const isVoucher = (stats: StatsData, defId: string | null | undefined): boolean => !!voucherOf(stats, defId);

/** What `amount` of a voucher cost (Kusing). */
export const voucherPrice = (stats: StatsData, voucher: { kowens: number }, amount = 1): number => voucher.kowens * (stats.exchange?.kusingPerKowenBuy ?? 0) * amount;

/** What `kowens` sold bring (Kusing). */
export const kusingForKowens = (stats: StatsData, kowens: number): number => kowens * (stats.exchange?.kusingPerKowenSell ?? 0);

const whole = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;

export const CLOSED = 'The exchange is closed for now.';

/** Buys `amount` of a voucher into the purse: the Kusing off and the stack in, or nothing (a refusal says why). */
export function buyVouchers(data: ItemData, c: Purse, voucherId: string, amount: number, uid: () => string): ExchangeResult<{ item: Item; price: number }> {
  const X = exchangeRules(data.stats);
  if (!X) return { ok: false, message: CLOSED };
  const v = voucherOf(data.stats, voucherId);
  const def = v && data.defs.get(v.id);
  if (!v || !def) return { ok: false, message: 'No such voucher.' };
  const most = X.voucher.maxBuyPerClick;
  if (!whole(amount, 1, most)) return { ok: false, message: `Buy 1 to ${most} at a time.` };
  const price = voucherPrice(data.stats, v, amount);
  if (c.kusing < price) {
    const can = Math.floor(c.kusing / voucherPrice(data.stats, v));
    return { ok: false, message: `You need ${price.toLocaleString('en-US')} Kusing but have ${c.kusing.toLocaleString('en-US')}.${can > 0 ? ` You can afford ${can}.` : ''}` };
  }
  const item = newItem(data.stats, def, uid(), amount);
  const room = bagRoom(data, c.bag, item);
  if (room < amount) return { ok: false, message: room ? `Your combat bag only has room for ${room} more.` : 'Your combat bag is full.' };
  c.kusing -= price;
  addToBag(data, c.bag, item, uid);
  return { ok: true, message: `Bought ${amount > 1 ? `${amount}× ` : ''}${v.name} for ${price.toLocaleString('en-US')} Kusing.`, item, price };
}

/** Uses `amount` of a voucher out of the purse: the stack down, and how many Kowens they're owed (the caller pays them). */
export function useVouchers(data: ItemData, c: Purse, voucherId: string, amount: number): ExchangeResult<{ kowens: number; name: string }> {
  if (!exchangeRules(data.stats)) return { ok: false, message: CLOSED };
  const v = voucherOf(data.stats, voucherId);
  if (!v) return { ok: false, message: 'No such voucher.' };
  const have = countOf(c.bag, v.id);
  if (!have) return { ok: false, message: `You have no ${v.name}.` };
  if (!whole(amount, 1, have)) return { ok: false, message: have > 1 ? `Use 1 to ${have}.` : 'Use one.' };
  if (!takeKind(c.bag, v.id, amount)) return { ok: false, message: `You have no ${v.name}.` };
  const kowens = v.kowens * amount;
  return { ok: true, message: `Used ${amount > 1 ? `${amount}× ` : ''}${v.name}: +${kowens.toLocaleString('en-US')} Kowens.`, kowens, name: v.name };
}

/** Why `kowens` can't be sold from a wallet of `wallet` (a fighter holds the Kusing: `hasCharacter`), or null. */
export function sellKowensRefusal(stats: StatsData, kowens: unknown, wallet: number, hasCharacter: boolean): string | null {
  const X = exchangeRules(stats);
  if (!X) return CLOSED;
  if (X.sellKowens.needsCharacter && !hasCharacter) return 'Make a fighter first to hold Kusing.';
  if (!whole(kowens, X.sellKowens.min, Number.MAX_SAFE_INTEGER)) return `Sell at least ${X.sellKowens.min} ${X.sellKowens.min === 1 ? 'Kowen' : 'Kowens'}.`;
  if (kowens > wallet) return `You only have ${wallet.toLocaleString('en-US')} ${wallet === 1 ? 'Kowen' : 'Kowens'} in your wallet.`;
  return null;
}
