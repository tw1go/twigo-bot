import type { TownBankAction, TownBankActionResponse, TownBankResponse } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { fakeLogin } from '../session';
import { coinIcon, el, showPopup } from './reward';

// 🏦 The bank (left click the bank): your wallet and vault side by side, moving Kowens in and out of the vault, and
// loans — what you owe and paying it back, or borrowing from the Tanod Bank — in the reward box. Every action goes
// through the bot (POST /town/bank) with the same rules as /vault and /loan. Lending to members stays in Discord.

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const kowens = (n: number) => plural(n, 'Kowen', 'Kowens');
const pct = (n: number) => `${Math.round(n * 100)}%`;

/** "2d 4h", "3h 05m", "12m" until `ms`. */
function timeLeft(ms: number): string {
  const m = Math.max(0, Math.floor((ms - Date.now()) / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d) return `${d}d ${h}h`;
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

async function load(): Promise<TownBankResponse | null> {
  if (fakeLogin()) return structuredClone(fake);
  const res = await fetch('/town/bank', { credentials: 'same-origin' }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownBankResponse) : null;
}

async function act(action: TownBankAction, amount?: number): Promise<TownBankActionResponse | null> {
  if (fakeLogin()) return fakeAct(action, amount);
  const res = await fetch('/town/bank', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, amount }),
  }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownBankActionResponse) : null;
}

/** A Kowens field: whole numbers only; Enter runs `submit` (and doesn't close the pop-up). */
function amountField(label: string, submit: () => void): HTMLInputElement {
  const input = el('input', 'bk-amount');
  input.type = 'number';
  input.min = '1';
  input.step = '1';
  input.inputMode = 'numeric';
  input.placeholder = 'Kowens';
  input.setAttribute('aria-label', label);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else input.blur();
  });
  return input;
}

const amountOf = (input: HTMLInputElement) => {
  const n = Number(input.value);
  return Number.isInteger(n) && n >= 1 ? n : null;
};

export function showBank(): void {
  const cards = el('div', 'bk-cards');
  const vault = el('section', 'bk-section');
  const loan = el('section', 'bk-section');
  const note = el('div', 'bk-note', 'Loading…');
  note.setAttribute('role', 'status');
  const wrap = el('div', 'bk-body');
  wrap.append(cards, vault, loan, note);

  let busy = false;
  const tell = (message: string) => {
    note.textContent = message;
    note.classList.add('bk-refused');
  };

  const run = async (action: TownBankAction, amount?: number) => {
    if (busy) return;
    busy = true;
    wrap.classList.add('bk-busy');
    const res = await act(action, amount);
    busy = false;
    wrap.classList.remove('bk-busy');
    if (!res) {
      playSound('error');
      note.textContent = "Couldn't reach the bank. Try again in a moment.";
      return;
    }
    render(res);
    note.textContent = res.message;
    note.classList.toggle('bk-refused', !res.ok);
    playSound(res.ok ? 'coin' : 'error');
    if (res.ok) window.dispatchEvent(new Event('mk-wallet')); // the HUD's Kowens
  };

  const button = (text: string, onClick: () => void, kind = '') => {
    const b = el('button', `bk-button${kind ? ` ${kind}` : ''}`, text);
    b.addEventListener('click', onClick);
    return b;
  };

  const render = (b: TownBankResponse) => {
    // Wallet and vault.
    const card = (label: string, amount: string, sub: string, icon: HTMLElement | null) => {
      const c = el('div', 'bk-card');
      const line = el('div', 'bk-card-amount');
      if (icon) line.append(icon);
      line.append(el('span', undefined, amount));
      c.append(el('div', 'bk-card-label', label), line, el('div', 'bk-card-sub', sub));
      return c;
    };
    cards.replaceChildren(
      card('Wallet', b.wallet.toLocaleString(), 'Spend, bet, pay', coinIcon(2)),
      b.vault
        ? card('Vault', b.vault.inside.toLocaleString(), 'Safe from /steal', coinIcon(2))
        : card('Vault', '—', 'Not bought yet', null),
    );

    // The vault.
    vault.replaceChildren(el('h3', 'bk-heading', 'Vault'));
    if (!b.vault) {
      vault.append(el('p', 'bk-text', `Kowens in a vault are safe from /steal and don't count for bail. Get one with /redeem reward:Vault in Discord (${kowens(b.vaultPrice)}).`));
    } else {
      const v = b.vault;
      const go = (action: 'deposit' | 'withdraw') => {
        const n = amountOf(amount);
        if (!n) return tell('Type how many Kowens first.');
        void run(action, n);
      };
      const amount = amountField('Kowens to move', () => go('deposit'));
      const row = el('div', 'bk-row');
      row.append(amount, button('Store', () => go('deposit')), button('Take out', () => go('withdraw'), 'bk-plain'));
      const room = Math.max(0, v.capacity - v.inside);
      vault.append(
        row,
        el('p', 'bk-hint', `${kowens(room)} more fits (up to ${pct(b.vaultCap)} of all you own)` +
          (v.inside ? ` · take out at least ${v.minWithdraw.toLocaleString()} (${pct(b.vaultMinWithdraw)} of what's inside)` : '')),
      );
    }

    // Loans.
    loan.replaceChildren(el('h3', 'bk-heading', 'Loan'));
    if (b.loan) {
      const l = b.loan;
      const owe = el('p', `bk-text${l.overdue ? ' bk-late' : ''}`);
      owe.append('You owe ', el('b', undefined, kowens(l.owed)), ` to ${l.lender === 'Tanod Bank' ? 'the Tanod Bank' : l.lender} · `,
        l.defaulted ? 'defaulted: earnings are garnished until it\'s paid'
        : l.overdue ? `overdue: ${pct(b.bank.garnish)} of your earnings go to your lender`
        : `due in ${timeLeft(l.due)}`);
      const pay = () => {
        const n = amountOf(amount);
        if (!n) return tell('Type how many Kowens, or pay it all.');
        void run('repay', n);
      };
      const amount = amountField('Kowens to pay', pay);
      const row = el('div', 'bk-row');
      row.append(
        amount,
        button('Pay', pay),
        button(`Pay all (${l.owed.toLocaleString()})`, () => void run('repay'), 'bk-plain'),
      );
      loan.append(owe, row);
    } else if (b.bank.blacklistedUntil) {
      loan.append(el('p', 'bk-text bk-late', `The Tanod Bank won't lend to you until ${new Date(b.bank.blacklistedUntil).toLocaleDateString()} (you defaulted on a loan).`));
    } else {
      const amount = amountField('Kowens to borrow', () => borrow());
      const borrow = () => {
        const n = amountOf(amount);
        if (!n) return tell('Type how many Kowens to borrow.');
        void run('borrow', n);
      };
      amount.max = String(b.bank.limit);
      const row = el('div', 'bk-row');
      row.append(amount, button('Borrow', borrow));
      loan.append(
        el('p', 'bk-text', `No loan. The Tanod Bank lends you up to ${kowens(b.bank.limit)}.`),
        row,
        el('p', 'bk-hint', `+${pct(b.bank.interest)} interest, due in ${b.bank.dueDays} days. If you're late, ${pct(b.bank.garnish)} of your earnings go to the bank until it's paid. Borrowing is posted in Discord.`),
      );
    }
    if (b.lent.length) {
      const list = el('div', 'bk-lent');
      list.append(el('div', 'bk-lent-title', 'You lent'));
      for (const l of b.lent) {
        list.append(el('div', 'bk-lent-row', `${l.name} owes ${kowens(l.owed)} · ${l.defaulted ? 'defaulted' : Date.now() > l.due ? 'overdue' : `due in ${timeLeft(l.due)}`}`));
      }
      loan.append(list);
    }
  };

  void showPopup({ title: 'Bank', body: [wrap], button: 'Close', celebrate: false, sound: 'door' });
  void load().then((b) => {
    if (!b) return void (note.textContent = "Couldn't load the bank. Try again in a moment.");
    note.textContent = '';
    render(b);
  });
}

// ── Dev: a pretend bank (no bot behind the dev server) ──

const q = new URLSearchParams(location.search);
const fake: TownBankResponse = {
  wallet: Number(q.get('kowens') ?? 1250),
  vault: q.get('vault') === '0' ? null : { inside: 120, capacity: 411, minWithdraw: 84 },
  vaultPrice: 50,
  vaultCap: 0.3,
  vaultMinWithdraw: 0.7,
  loan: q.get('loan') === '1' ? { owed: 33, lender: 'Tanod Bank', due: Date.now() + 50 * 3600_000, overdue: false, defaulted: false } : null,
  bank: { limit: 40, blacklistedUntil: null, interest: 0.1, dueDays: 3, garnish: 0.5 },
  lent: q.get('loan') === '1' ? [{ name: 'Fae', owed: 22, due: Date.now() + 20 * 3600_000, defaulted: false }] : [],
};

function fakeAct(action: TownBankAction, amount?: number): TownBankActionResponse {
  const done = (ok: boolean, message: string) => ({ ...structuredClone(fake), ok, message });
  const v = fake.vault;
  const refreshVault = () => {
    if (!fake.vault) return;
    fake.vault.capacity = Math.floor((fake.wallet + fake.vault.inside) * fake.vaultCap);
    fake.vault.minWithdraw = Math.max(1, Math.ceil(fake.vault.inside * fake.vaultMinWithdraw));
  };
  if (action === 'deposit' && v && amount) {
    if (amount > fake.wallet) return done(false, `You only have ${kowens(fake.wallet)} in your wallet.`);
    if (amount > v.capacity - v.inside) return done(false, `Your vault can only take ${kowens(v.capacity - v.inside)} more right now.`);
    fake.wallet -= amount;
    v.inside += amount;
    refreshVault();
    return done(true, `Stored ${kowens(amount)} in your vault.`);
  }
  if (action === 'withdraw' && v && amount) {
    if (amount > v.inside) return done(false, `Your vault only has ${kowens(v.inside)}.`);
    if (amount < v.minWithdraw) return done(false, `Take out at least ${kowens(v.minWithdraw)}.`);
    v.inside -= amount;
    fake.wallet += amount;
    refreshVault();
    return done(true, `Took ${kowens(amount)} out of your vault.`);
  }
  if (action === 'borrow' && amount) {
    if (amount > fake.bank.limit) return done(false, `The Tanod Bank will lend you up to ${kowens(fake.bank.limit)} right now.`);
    fake.wallet += amount;
    fake.loan = { owed: Math.ceil(amount * 1.1), lender: 'Tanod Bank', due: Date.now() + 3 * 86_400_000, overdue: false, defaulted: false };
    return done(true, `Borrowed ${kowens(amount)}. You owe ${kowens(fake.loan.owed)}, due in 3 days.`);
  }
  if (action === 'repay' && fake.loan) {
    const paid = Math.min(amount ?? fake.loan.owed, fake.loan.owed, fake.wallet);
    fake.wallet -= paid;
    fake.loan.owed -= paid;
    const left = fake.loan.owed;
    if (left <= 0) fake.loan = null;
    return done(true, left <= 0 ? `Paid ${kowens(paid)}. Your loan is fully paid!` : `Paid ${kowens(paid)}. You still owe ${kowens(left)}.`);
  }
  return done(false, "That didn't work.");
}
