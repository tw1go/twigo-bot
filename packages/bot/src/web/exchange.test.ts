import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type Item, bagSlots, buyVouchers, countOf, kusingForKowens, newItem, sellKowensRefusal, useVouchers, voucherOf, voucherPrice } from '@mikazuki/shared';
import { loadItemData, loadStats } from './stats-data.js';

// The Bank's exchange on the real data (stats.json `exchange`, items.json's vouchers; shared exchange.ts): a voucher's
// price, buying (Kusing, amount, room: nothing changes on a refusal), using (the Kowens owed, never more than held), and
// selling Kowens (a fighter, the wallet).

const D = loadItemData();
const S = loadStats();
const X = S.exchange!;
let n = 0;
const uid = () => `u${++n}`;
const purse = (kusing: number, bag: Item[] = []) => ({ kusing, bag });

test('the four vouchers are items and each costs its Kowens × kusingPerKowenBuy; a sale brings kusingPerKowenSell a Kowen', () => {
  assert.equal(X.vouchers.length, 4);
  for (const v of X.vouchers) {
    assert.ok(D.defs.get(v.id), v.id);
    assert.equal(voucherOf(S, v.id), v);
    assert.equal(voucherPrice(S, v), v.kowens * X.kusingPerKowenBuy);
    assert.equal(voucherPrice(S, v, 3), 3 * v.kowens * X.kusingPerKowenBuy);
  }
  assert.equal(voucherPrice(S, voucherOf(S, 'kowen-voucher-10')!), 5_000_000);
  assert.equal(voucherPrice(S, voucherOf(S, 'kowen-voucher-100')!), 50_000_000);
  assert.equal(kusingForKowens(S, 25), 10_000_000);
  assert.equal(voucherOf(S, 'low-hp-potion'), null);
});

test('buying: the Kusing off and the stack in; not enough Kusing, a full bag, 0 or 100, a made-up id: refused and nothing changes', () => {
  const c = purse(60_000_000);
  const r = buyVouchers(D, c, 'kowen-voucher-10', 3, uid);
  assert.ok(r.ok && r.price === 15_000_000);
  assert.equal(c.kusing, 45_000_000);
  assert.equal(countOf(c.bag, 'kowen-voucher-10'), 3);
  assert.equal(c.bag.length, 1, 'one stack');
  const was = JSON.stringify(c);
  assert.ok(!buyVouchers(D, c, 'kowen-voucher-100', 1, uid).ok, '50M for 45M');
  assert.ok(!buyVouchers(D, c, 'kowen-voucher-10', 0, uid).ok);
  assert.ok(!buyVouchers(D, c, 'kowen-voucher-10', 100, uid).ok);
  assert.ok(!buyVouchers(D, c, 'kowen-voucher-10', 1.5, uid).ok);
  assert.ok(!buyVouchers(D, c, 'kowen-voucher-7', 1, uid).ok);
  assert.ok(!buyVouchers(D, c, 'low-hp-potion', 1, uid).ok, 'not a voucher');
  assert.equal(JSON.stringify(c), was, 'nothing changed');
  // A full bag: every slot taken by other stacks (vouchers stack to 99: a 99 stack with room for none).
  const full = purse(999_000_000, Array.from({ length: bagSlots(S) }, () => newItem(S, D.defs.get('low-hp-potion')!, uid(), 1)));
  const before = JSON.stringify(full);
  const f = buyVouchers(D, full, 'kowen-voucher-25', 1, uid);
  assert.ok(!f.ok && /full/.test(f.message));
  assert.equal(JSON.stringify(full), before);
  // Room counts stacking: 99 on one stack, the 100th needs a slot.
  const c2 = purse(999_000_000, Array.from({ length: bagSlots(S) - 1 }, () => newItem(S, D.defs.get('low-hp-potion')!, uid(), 1)));
  assert.ok(buyVouchers(D, c2, 'kowen-voucher-10', 99, uid).ok);
  const g = buyVouchers(D, c2, 'kowen-voucher-10', 1, uid);
  assert.ok(!g.ok && /full/.test(g.message));
});

test('using: exactly amount × the voucher\'s Kowens owed, the stack down; more than held, 0, a made-up id: refused', () => {
  const c = purse(0);
  assert.ok(buyVouchers(D, purse(0), 'kowen-voucher-50', 1, uid).ok === false);
  c.bag.push(newItem(S, D.defs.get('kowen-voucher-50')!, uid(), 5));
  const r = useVouchers(D, c, 'kowen-voucher-50', 3);
  assert.ok(r.ok && r.kowens === 150 && r.name === '50 Kowen Voucher');
  assert.equal(countOf(c.bag, 'kowen-voucher-50'), 2);
  const was = JSON.stringify(c);
  assert.ok(!useVouchers(D, c, 'kowen-voucher-50', 3).ok, 'only 2 left');
  assert.ok(!useVouchers(D, c, 'kowen-voucher-50', 0).ok);
  assert.ok(!useVouchers(D, c, 'kowen-voucher-25', 1).ok, 'none held');
  assert.ok(!useVouchers(D, c, 'nope', 1).ok);
  assert.equal(JSON.stringify(c), was);
  const last = useVouchers(D, c, 'kowen-voucher-50', 2);
  assert.ok(last.ok && last.kowens === 100);
  assert.equal(c.bag.length, 0, 'the empty stack is gone');
});

test('selling Kowens: a whole number from the minimum, no more than the wallet, a fighter to hold the Kusing', () => {
  assert.equal(sellKowensRefusal(S, 25, 30, true), null);
  assert.equal(sellKowensRefusal(S, 30, 30, true), null);
  assert.match(sellKowensRefusal(S, 31, 30, true)!, /only have 30 Kowens/);
  assert.match(sellKowensRefusal(S, 0, 30, true)!, /at least 1 Kowen/);
  assert.ok(sellKowensRefusal(S, 2.5, 30, true));
  assert.ok(sellKowensRefusal(S, 'x', 30, true));
  assert.match(sellKowensRefusal(S, 1, 30, false)!, /fighter/);
});
