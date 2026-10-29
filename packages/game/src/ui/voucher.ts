import { type Item, voucherOf } from '@mikazuki/shared';
import { exchangeAct, itemData } from '../net/adventure';
import { playSound } from '../audio/sound';
import { el } from './reward';
import { toast } from './toast';

// 🎟️ Kowen Vouchers in the bag (CONTEXT.md Kowen Voucher; stats.json `exchange`, shared exchange.ts): Use (the bag's
// right-click row, its detail button, a double-click) asks how many of the stack and what they bring ("Use 2 × 50 Kowen
// Voucher for 100 Kowens?"), then POST /town/exchange/use-voucher (dev: the pretend exchange). Done: the coin sound, a
// toast, and 'mk-voucher-used' for the scene ("+N Kowens" over you in Kowen gold, a "Gained" line in your feed).

/** The Kowen coin's gold (the HUD's, the crit numbers'). */
export const KOWEN_GOLD = '#FCDA4A';

/** The voucher a kind is, or null (stats.json exchange.vouchers). */
export function voucherFor(defId: string | null | undefined) {
  const D = itemData();
  return D ? voucherOf(D.stats, defId) : null;
}

const plural = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'Kowen' : 'Kowens'}`;

/** A gold number: "150" in Kowen gold, bold. */
export function gold(n: number | string): HTMLElement {
  const b = el('b', undefined, typeof n === 'number' ? n.toLocaleString() : n);
  b.style.color = KOWEN_GOLD;
  return b;
}

/** A yes / no box in the forge's confirm look: `title` (text and elements), `rows` under it, the yes button's label.
 *  Enter is yes, Escape, Cancel or a click outside no. Resolves whether they said yes. */
export function confirmBox(title: (string | HTMLElement)[], yes: string, rows: HTMLElement[] = []): Promise<boolean> {
  return new Promise((resolve) => {
    const back = el('div', 'fg-confirm-back');
    const box = el('div', 'fg-confirm');
    box.setAttribute('role', 'alertdialog');
    const head = el('div', 'fg-confirm-title');
    head.append(...title);
    const actions = el('div', 'fg-actions');
    const go = el('button', 'fg-go fg-ready', yes);
    const no = el('button', 'fg-go', 'Cancel');
    const done = (ok: boolean) => {
      back.remove();
      document.removeEventListener('keydown', key, true);
      resolve(ok);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      done(e.key === 'Enter');
    };
    go.addEventListener('click', () => done(true));
    no.addEventListener('click', () => done(false));
    back.addEventListener('click', (e) => e.target === back && done(false));
    document.addEventListener('keydown', key, true);
    actions.append(go, no);
    box.append(head, ...rows, actions);
    back.append(box);
    document.body.append(back);
    go.focus();
  });
}

/** Use some of a voucher stack: how many (1..the stack), what they bring, then the exchange. */
export async function useVoucherPopup(item: Item): Promise<void> {
  const v = voucherFor(item.defId);
  if (!v) return;
  const count = Object.assign(el('input', 'dr-count'), { type: 'number', min: '1', max: String(item.count), value: '1' });
  const how = () => Math.floor(Number(count.value));
  const worth = gold(v.kowens);
  const title = el('span');
  const sum = () => {
    const n = how();
    const ok = n >= 1 && n <= item.count;
    worth.textContent = ok ? `${(v.kowens * n).toLocaleString()} Kowens` : '…';
    title.textContent = `Use ${ok ? n : '…'} × ${v.name} for `;
  };
  sum();
  count.addEventListener('input', sum);
  const row = el('label', 'fg-confirm-sub dr-row');
  row.append('How many ', count, ` of ${item.count} (${v.kowens} Kowens each)`);
  // (Enter in the box confirms through the document's key; a bad number is asked again.)
  const yes = await confirmBox([title, worth, '?'], 'Use', item.count > 1 ? [row] : []);
  if (!yes) return;
  const n = how();
  if (!(n >= 1 && n <= item.count)) return void toast(`Use 1 to ${item.count}.`, 2000, 'bad');
  const r = await exchangeAct('use-voucher', { voucherId: v.id, amount: n });
  if (!r?.ok) {
    playSound('error');
    return void toast(r?.message?.replace(/\.$/, '') ?? "Couldn't reach the bank", 2400, 'bad');
  }
  const kowens = r.kowens ?? v.kowens * n;
  playSound('coin');
  toast(`+${plural(kowens)}`, 2600, 'good');
  dispatchEvent(new CustomEvent('mk-voucher-used', { detail: { kowens, name: v.name, amount: n } }));
  dispatchEvent(new Event('mk-wallet')); // the HUD's Kowens
}
