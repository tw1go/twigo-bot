import type { TownShopBuyResponse, TownShopItem, TownShopResponse } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { fakeLogin } from '../session';
import { coinIcon, el, showPopup } from './reward';

// 🎁 The rewards shop (left click the shop): what /redeem sells, in the reward box with tabs (Items, Potions, Bags,
// Passes). Each tab is a grid of the item art with prices; picking one shows what it does, a quantity for the ones
// that stack, and a Buy button (passes ask again first: they're expensive and sent by hand). Buying goes through
// the bot (POST /town/shop) with /redeem's checks. Item art: manifest `items`, by reward id.

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const kowens = (n: number) => plural(n, 'Kowen', 'Kowens');

type Tab = 'items' | 'potions' | 'bags' | 'passes';
const TABS: [Tab, string, TownShopItem['kind'][]][] = [
  ['items', 'Items', ['fence', 'shovel', 'key', 'vault']],
  ['potions', 'Potions', ['potion']],
  ['bags', 'Bags', ['bag']],
  ['passes', 'Passes', ['pass']],
];
/** Item art is 32 px: shown at 2× in the grid. */
const ART_SCALE = 2;

async function load(): Promise<TownShopResponse | null> {
  if (fakeLogin()) return structuredClone(fake);
  const res = await fetch('/town/shop', { credentials: 'same-origin' }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownShopResponse) : null;
}

async function buy(id: string, quantity: number): Promise<TownShopBuyResponse | null> {
  if (fakeLogin()) return fakeBuy(id, quantity);
  const res = await fetch('/town/shop', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, quantity }),
  }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownShopBuyResponse) : null;
}

/** `art(id)`: the item's picture URL (manifest items), or null. */
export function showShop(art: (id: string) => { url: string; size: [number, number] } | null): void {
  const wallet = el('div', 'sh-wallet');
  const bar = el('div', 'bk-tabs sh-tabs');
  bar.setAttribute('role', 'tablist');
  const grid = el('div', 'sh-grid');
  grid.setAttribute('role', 'tabpanel');
  const detail = el('div', 'sh-detail');
  const note = el('div', 'bk-note', 'Loading…');
  note.setAttribute('role', 'status');
  const wrap = el('div', 'sh-body');
  wrap.append(wallet, bar, grid, detail, note);

  let shop: TownShopResponse | null = null;
  let tab: Tab = 'items';
  let picked: string | null = null;
  let quantity = 1;
  let confirming = false;
  let busy = false;

  const picture = (id: string, scale: number) => {
    const a = art(id);
    if (!a) return el('span', 'sh-art sh-missing', '?');
    const img = el('img', 'sh-art');
    img.src = a.url;
    img.alt = '';
    img.width = a.size[0] * scale;
    img.height = a.size[1] * scale;
    return img;
  };

  const tabs = new Map<Tab, HTMLButtonElement>();
  for (const [t, label] of TABS) {
    const b = el('button', 'bk-tab', label);
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => {
      tab = t;
      picked = null;
      note.textContent = '';
      note.classList.remove('sh-ask');
      render();
    });
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const i = TABS.findIndex(([x]) => x === tab);
      tab = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0];
      picked = null;
      render();
      tabs.get(tab)!.focus();
    });
    tabs.set(t, b);
    bar.append(b);
  }

  /** Why an item can't be bought right now (null = it can). */
  const blocked = (s: TownShopResponse, it: TownShopItem): string | null => {
    if (it.owned) return it.kind === 'vault' ? 'You have a vault. Use it at the bank.' : 'You have this bag.';
    if (it.max === 0) return it.kind === 'shovel' ? 'No more shovels today. More tomorrow!' : 'Not available right now.';
    if (it.kind === 'pass' && s.inDebt) return 'Pay off your loan at the bank first.';
    if (s.kowens < it.cost) return `You need ${kowens(it.cost - s.kowens)} more.`;
    return null;
  };

  const render = () => {
    const s = shop;
    if (!s) return;
    wallet.replaceChildren('You have ', coinIcon(2), el('b', undefined, kowens(s.kowens)));
    for (const [t, b] of tabs) {
      b.setAttribute('aria-selected', String(t === tab));
      b.tabIndex = t === tab ? 0 : -1;
    }
    const kinds = TABS.find(([t]) => t === tab)![2];
    const items = s.items.filter((it) => kinds.includes(it.kind));
    if (!picked || !items.some((it) => it.id === picked)) {
      picked = items[0]?.id ?? null;
      quantity = 1;
      confirming = false;
    }

    grid.replaceChildren(
      ...items.map((it) => {
        const card = el('button', `sh-card${it.id === picked ? ' sh-picked' : ''}${blocked(s, it) ? ' sh-dim' : ''}`);
        card.setAttribute('aria-pressed', String(it.id === picked));
        card.setAttribute('aria-label', `${it.name}, ${kowens(it.cost)}`);
        const price = el('span', 'sh-price');
        price.append(coinIcon(1), it.cost.toLocaleString());
        card.append(picture(it.id, ART_SCALE), el('span', 'sh-name', it.name), price);
        if (it.owned) card.append(el('span', 'sh-badge', 'Owned'));
        else if (it.have) card.append(el('span', 'sh-badge sh-have', `×${it.have}`));
        card.addEventListener('click', () => {
          if (picked === it.id) return;
          picked = it.id;
          quantity = 1;
          confirming = false;
          note.textContent = '';
          note.classList.remove('sh-ask');
          render();
        });
        return card;
      }),
    );

    // The picked item: what it does, how many, and Buy.
    const it = items.find((x) => x.id === picked);
    detail.replaceChildren();
    if (!it) return;
    const why = blocked(s, it);
    const max = Math.max(1, Math.min(it.max, Math.floor(s.kowens / it.cost) || 1));
    quantity = Math.min(quantity, max);
    const head = el('div', 'sh-detail-head');
    const text = el('div');
    text.append(el('div', 'sh-detail-name', it.name), el('div', 'sh-about', it.about));
    if (it.kind === 'fence' && s.fenceUntil) text.append(el('div', 'sh-about sh-up', `Your Bakod is up until ${new Date(s.fenceUntil).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.`));
    head.append(picture(it.id, 2), text);

    const row = el('div', 'sh-buy-row');
    if (it.max > 1 && !why) {
      const step = el('div', 'sh-qty');
      const minus = el('button', 'sh-step', '−');
      const count = el('span', 'sh-count', String(quantity));
      const plus = el('button', 'sh-step', '+');
      minus.setAttribute('aria-label', 'One fewer');
      plus.setAttribute('aria-label', 'One more');
      minus.disabled = quantity <= 1;
      plus.disabled = quantity >= max;
      minus.addEventListener('click', () => ((quantity = Math.max(1, quantity - 1)), render()));
      plus.addEventListener('click', () => ((quantity = Math.min(max, quantity + 1)), render()));
      step.append(minus, count, plus);
      row.append(step);
    }
    const total = it.cost * quantity;
    const buyButton = el('button', `sh-buy${confirming ? ' sh-confirm' : ''}`, why ? why : confirming ? `Confirm · ${kowens(total)}` : `${it.kind === 'pass' ? 'Redeem' : 'Buy'} · ${kowens(total)}`);
    buyButton.disabled = !!why || busy;
    buyButton.addEventListener('click', () => {
      if (it.kind === 'pass' && !confirming) {
        confirming = true;
        note.textContent = `${it.name} for ${kowens(total)}? Press again to confirm.`;
        note.classList.remove('bk-refused');
        note.classList.add('sh-ask');
        return render();
      }
      void purchase(it, quantity);
    });
    row.append(buyButton);
    detail.append(head, row);
  };

  const purchase = async (it: TownShopItem, n: number) => {
    if (busy) return;
    busy = true;
    confirming = false;
    render();
    const res = await buy(it.id, n);
    busy = false;
    if (!res) {
      playSound('error');
      note.textContent = "Couldn't reach the shop. Try again in a moment.";
      note.classList.add('bk-refused');
      return render();
    }
    shop = res;
    quantity = 1;
    render();
    note.textContent = res.message;
    note.classList.remove('sh-ask');
    note.classList.toggle('bk-refused', !res.ok);
    playSound(res.ok ? 'coin' : 'error');
    if (res.ok) window.dispatchEvent(new Event('mk-wallet')); // the HUD's Kowens (and shovels)
  };

  void showPopup({ title: 'Rewards shop', body: [wrap], button: 'Close', celebrate: false, sound: 'door' });
  void load().then((s) => {
    if (!s) return void (note.textContent = "Couldn't load the shop. Try again in a moment.");
    shop = s;
    note.textContent = '';
    render();
  });
}

// ── Dev: a pretend shop (no bot behind the dev server) ──

const fake: TownShopResponse = {
  kowens: Number(new URLSearchParams(location.search).get('kowens') ?? 1250),
  fenceUntil: null,
  inDebt: false,
  items: [
    { id: 'bakod', name: 'Bakod (Fence)', cost: 5, kind: 'fence', about: 'Blocks /steal against you for 1.5 days. Buy again to add time (up to 7 days).', max: 1 },
    { id: 'shovel', name: 'Shovel', cost: 2, kind: 'shovel', about: '3 digs with /dig. Up to 3 shovels a day.', max: 3 },
    { id: 'master-key', name: 'Master Key', cost: 5, kind: 'key', about: '50% chance to break through a Bakod when you /steal. Used only then.', max: 10, have: 1 },
    { id: 'vault', name: 'Vault', cost: 50, kind: 'vault', about: 'Store up to 30% of your Kowens, safe from /steal and bail. Use it at the bank.', max: 0, owned: true },
    { id: 'potion-kalawang', name: 'Kalawang Potion', cost: 8, kind: 'potion', about: "Rusts someone's Bakod: cuts its remaining time in half. Use it with /potion use in Discord.", max: 10 },
    { id: 'potion-tago', name: 'Tago Tonic', cost: 6, kind: 'potion', about: "For 30 minutes the Tanod can't see you gamble: 0% bust chance. Use it with /potion use in Discord.", max: 10, have: 2 },
    { id: 'potion-swerte', name: 'Swerte Elixir', cost: 5, kind: 'potion', about: 'Your next 3 digs: any junk gets rerolled once. Use it with /potion use in Discord.', max: 10 },
    { id: 'potion-marites', name: 'Marites Tea', cost: 3, kind: 'potion', about: 'Aling Marites spills a hint about a hidden Easter egg. Use it with /potion use in Discord.', max: 10 },
    { id: 'bag-supot', name: 'Supot (Plastic Bag)', cost: 5, kind: 'bag', about: '+8 inventory slots for what you dig up. Each bag once.', max: 0, owned: true },
    { id: 'bag-bayong', name: 'Bayong', cost: 10, kind: 'bag', about: '+8 inventory slots for what you dig up. Each bag once.', max: 1 },
    { id: 'bag-backpack', name: 'School Backpack', cost: 20, kind: 'bag', about: '+8 inventory slots for what you dig up. Each bag once.', max: 1 },
    { id: 'bag-balikbayan', name: 'Balikbayan Box', cost: 35, kind: 'bag', about: '+8 inventory slots for what you dig up. Each bag once.', max: 1 },
    { id: 'bag-lola', name: "Lola's Bottomless Bag", cost: 50, kind: 'bag', about: '+8 inventory slots for what you dig up. Each bag once.', max: 1 },
    { id: 'phantasium', name: 'Phantasium Pass', cost: 1_700, kind: 'pass', about: 'A Crystal of Atlan Phantasium Pass, sent to you by hand. Not while you have a loan.', max: 1 },
    { id: 'basic-bp', name: 'Basic Battle Pass', cost: 2_450, kind: 'pass', about: 'A Crystal of Atlan Basic Battle Pass, sent to you by hand. Not while you have a loan.', max: 1 },
    { id: 'advanced-bp', name: 'Advanced Battle Pass', cost: 3_650, kind: 'pass', about: 'A Crystal of Atlan Advanced Battle Pass, sent to you by hand. Not while you have a loan.', max: 1 },
  ],
};

function fakeBuy(id: string, quantity: number): TownShopBuyResponse {
  const it = fake.items.find((x) => x.id === id)!;
  const total = it.cost * quantity;
  if (fake.kowens < total) return { ...structuredClone(fake), ok: false, message: `You need ${kowens(total)} but have ${kowens(fake.kowens)}.` };
  fake.kowens -= total;
  if (it.kind === 'vault' || it.kind === 'bag') {
    it.owned = true;
    it.max = 0;
  }
  if (it.kind === 'shovel') it.max -= quantity;
  if (it.kind === 'potion' || it.kind === 'key') it.have = (it.have ?? 0) + quantity;
  return { ...structuredClone(fake), ok: true, message: it.kind === 'pass' ? `Redeemed the ${it.name}! The owner has been told and will send it over.` : `Bought ${quantity > 1 ? `${quantity}× ` : ''}${it.name}!` };
}
