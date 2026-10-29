import { bagRoom, kusingForKowens, newItem, voucherPrice } from '@mikazuki/shared';
import { adventure, exchangeAct, itemData } from '../net/adventure';
import { playSound } from '../audio/sound';
import { itemArt } from './item-art';
import { coinIcon, el, kusingIcon } from './reward';
import { confirmBox, gold } from './voucher';

// 🏦 The Bank's Exchange tab (CONTEXT.md Exchange, Kowen Voucher; stats.json `exchange`, shared exchange.ts; bot
// web/town-exchange.ts): Buy Kowen Vouchers (a card a voucher: its picture, name, price in Kusing, how many 1..99, Buy;
// greyed with the reason when it can't be afforded or the bag has no room) and Sell Kowens (your wallet, how many with
// − / + / Max, what they bring, Sell; a confirm over 10 Kowens). Every number from the data; big ones with thousands
// separators. No fighter: Kusing has nowhere to go, so selling is off and says so.

/** The sell confirm from this many Kowens up. */
const CONFIRM_FROM = 10;

export interface ExchangeDeps {
  /** The wallet as the bank last loaded it. */
  wallet: number;
  /** A line under the tabs (the bank's note). */
  tell(message: string, ok: boolean): void;
  /** Done: the bank reloads its numbers (the wallet changed). */
  done(): void;
}

export function renderExchange(panel: HTMLElement, deps: ExchangeDeps): void {
  const D = itemData();
  const X = D?.stats.exchange;
  const a = adventure();
  panel.replaceChildren();
  if (!D || !X) return void panel.append(el('p', 'bk-text', 'The exchange is closed for now.'));
  const kusing = a?.kusing ?? 0;
  const fighter = !!a?.cls;
  let busy = false;
  const run = async (kind: 'buy-voucher' | 'sell-kowens', body: { voucherId?: string; amount?: number; kowens?: number }) => {
    if (busy) return;
    busy = true;
    panel.classList.add('bk-busy');
    const r = await exchangeAct(kind, body);
    busy = false;
    panel.classList.remove('bk-busy');
    if (!r) {
      playSound('error');
      return deps.tell("Couldn't reach the bank. Try again in a moment.", false);
    }
    playSound(r.ok ? 'coin' : 'error');
    deps.tell(r.message, r.ok);
    if (r.ok) {
      window.dispatchEvent(new Event('mk-wallet')); // the HUD's Kowens
      deps.done();
    }
  };

  // ── Buy Kowen Vouchers ──
  const buy = el('div', 'bk-ex');
  const buyHead = el('div', 'bk-ex-head');
  buyHead.append(el('b', undefined, 'Buy Kowen Vouchers'), ' · you have ', kusingIcon(1), el('b', undefined, kusing.toLocaleString()), ' Kusing');
  const cards = el('div', 'bk-ex-cards');
  for (const v of X.vouchers) {
    const def = D.defs.get(v.id);
    const card = el('div', 'bk-ex-card');
    const pic = def ? itemArt(v.id, 'white', 'showcase', 2) : null;
    if (pic) card.append(pic);
    card.append(el('div', 'bk-ex-name', v.name));
    const price = el('div', 'bk-ex-price');
    const amount = Object.assign(el('input', 'bk-amount bk-ex-amount'), { type: 'number', min: '1', max: String(X.voucher.maxBuyPerClick), step: '1', value: '1', inputMode: 'numeric' });
    amount.setAttribute('aria-label', `How many ${v.name}s`);
    const button = el('button', 'bk-button', 'Buy');
    const refresh = () => {
      const n = Math.floor(Number(amount.value));
      const ok = Number.isInteger(n) && n >= 1 && n <= X.voucher.maxBuyPerClick;
      const cost = ok ? voucherPrice(D.stats, v, n) : 0;
      price.replaceChildren(kusingIcon(1), el('b', undefined, ok ? cost.toLocaleString() : '…'));
      const room = def && ok ? bagRoom(D, a?.bag ?? [], newItem(D.stats, def, 'x', n)) : 0;
      const why = !fighter ? 'Make a fighter first: vouchers go in the combat bag.' : !ok ? `Buy 1 to ${X.voucher.maxBuyPerClick} at a time.` : cost > kusing ? `Not enough Kusing: ${cost.toLocaleString()} needed.` : room < n ? (room ? `Only room for ${room} more in your bag.` : 'Your combat bag is full.') : '';
      button.disabled = !!why || busy;
      button.title = why;
      card.classList.toggle('bk-ex-cant', !!why);
    };
    amount.addEventListener('input', refresh);
    amount.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); if (!button.disabled) button.click(); } else amount.blur();
    });
    button.addEventListener('click', () => void run('buy-voucher', { voucherId: v.id, amount: Math.floor(Number(amount.value)) }));
    refresh();
    const row = el('div', 'bk-ex-row');
    row.append(amount, button);
    card.append(price, row);
    cards.append(card);
  }
  buy.append(buyHead, cards, el('p', 'bk-hint', `${X.kusingPerKowenBuy.toLocaleString()} Kusing a Kowen. Vouchers are items: trade them, or use them from your bag for their Kowens.`));

  // ── Sell Kowens ──
  const sell = el('div', 'bk-ex bk-ex-sell');
  const sellHead = el('div', 'bk-ex-head');
  sellHead.append(el('b', undefined, 'Sell Kowens'), ' · your wallet: ', coinIcon(1), el('b', undefined, deps.wallet.toLocaleString()));
  sell.append(sellHead);
  if (!fighter) sell.append(el('p', 'bk-text bk-late', 'Make a fighter first to hold Kusing.'));
  else {
    const n = Object.assign(el('input', 'bk-amount bk-ex-amount'), { type: 'number', min: String(X.sellKowens.min), max: String(deps.wallet), step: '1', value: String(Math.min(deps.wallet, X.sellKowens.min)), inputMode: 'numeric' });
    n.setAttribute('aria-label', 'Kowens to sell');
    const worth = el('span', 'bk-ex-worth');
    const go = el('button', 'bk-button', 'Sell');
    const value = () => Math.floor(Number(n.value));
    const refresh = () => {
      const k = value();
      const ok = Number.isInteger(k) && k >= X.sellKowens.min && k <= deps.wallet;
      worth.replaceChildren('= ', kusingIcon(1), el('b', undefined, ok ? kusingForKowens(D.stats, k).toLocaleString() : '…'), ' Kusing');
      go.disabled = !ok || busy;
      go.title = ok ? '' : deps.wallet < X.sellKowens.min ? 'No Kowens in your wallet.' : `Sell ${X.sellKowens.min} to ${deps.wallet.toLocaleString()}.`;
    };
    const step = (by: number) => { n.value = String(Math.max(X.sellKowens.min, Math.min(deps.wallet, value() + by))); refresh(); };
    const minus = el('button', 'bk-button bk-plain bk-ex-step', '−');
    const plus = el('button', 'bk-button bk-plain bk-ex-step', '+');
    const max = el('button', 'bk-button bk-plain', 'Max');
    minus.addEventListener('click', () => step(-1));
    plus.addEventListener('click', () => step(1));
    max.addEventListener('click', () => { n.value = String(deps.wallet); refresh(); });
    n.addEventListener('input', refresh);
    n.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); if (!go.disabled) go.click(); } else n.blur();
    });
    go.addEventListener('click', () => {
      void (async () => {
        const k = value();
        if (k > CONFIRM_FROM) {
          const yes = await confirmBox(['Sell ', gold(k), ` ${k === 1 ? 'Kowen' : 'Kowens'} for ${kusingForKowens(D.stats, k).toLocaleString()} Kusing?`], 'Sell');
          if (!yes) return;
        }
        await run('sell-kowens', { kowens: k });
      })();
    });
    refresh();
    const row = el('div', 'bk-row bk-ex-sellrow');
    row.append(minus, n, plus, max, worth, go);
    sell.append(row, el('p', 'bk-hint', `${X.kusingPerKowenSell.toLocaleString()} Kusing a Kowen, into your combat bag's purse.`));
  }
  panel.append(buy, sell);
}
