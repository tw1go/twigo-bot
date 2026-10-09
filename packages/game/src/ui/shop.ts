import type { TownShopBuyResponse, TownShopItem, TownShopResponse } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { bagSlots, countOf, pocketUsed } from '@mikazuki/shared';
import { fakeLogin, fakeName } from '../session';
import { adventure, itemData, onAdventure } from '../net/adventure';
import { itemArt } from './item-art';
import { coinIcon, el, followWallet, kusingIcon, showPopup } from './reward';

// 🎁 The sari-sari store (left click the store): what /redeem sells, in the reward box with tabs (Items, Potions, Bags,
// Passes). Each tab is a grid of the item art with prices; picking one shows what it does, a quantity for the ones
// that stack, and a Buy button (passes ask again first: they're expensive and sent by hand). Buying goes through
// the bot (POST /town/shop) with /redeem's checks. Item art: manifest `items` by reward id (ui/item-art.ts), in the
// common rarity frame.
// Healing and Smithing are the Slums' (bot web/combat-bag.ts): HP and MP Potions for Kusing, whetstones and Repair Kits
// for Kowens, into the combat bag; only the Low tier until you reach the next one. Buy 1, or type how many (up to a
// stack, what fits and what you can pay); the server says why not when it can't.

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const kowens = (n: number) => plural(n, 'Kowen', 'Kowens');

type Tab = 'items' | 'potions' | 'bags' | 'passes' | 'healing' | 'smithing';
const TABS: [Tab, string, TownShopItem['kind'][]][] = [
  ['items', 'Items', ['fence', 'shovel', 'key', 'megaphone', 'rename', 'classchange', 'vault']],
  ['potions', 'Potions', ['potion']],
  ['bags', 'Bags', ['bag']],
  ['passes', 'Passes', ['pass']],
  ['healing', 'Healing', ['healing']],
  ['smithing', 'Smithing', ['smithing']],
];
/** Combat items (into the combat bag): typed quantities. */
const combat = (it: TownShopItem) => it.kind === 'healing' || it.kind === 'smithing';
const kusing = (n: number) => `${n.toLocaleString()} Kusing`;
const price = (it: TownShopItem, n: number) => (it.currency === 'kusing' ? kusing(n) : kowens(n));
/** Item art is 32 px: shown at 2× in the grid. */
const ART_SCALE = 2;

async function load(): Promise<TownShopResponse | null> {
  if (fakeLogin()) return withCombat(structuredClone(fake));
  const res = await fetch('/town/shop', { credentials: 'same-origin' }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownShopResponse) : null;
}

async function buy(id: string, quantity: number): Promise<TownShopBuyResponse | null> {
  if (fakeLogin()) return FAKE_COMBAT.some((x) => x.id === id) ? fakeCombatBuy(id, quantity) : fakeBuy(id, quantity);
  const res = await fetch('/town/shop', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, quantity }),
  }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownShopBuyResponse) : null;
}

export function showShop(): void {
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
    const art = itemArt(id, 'common', 'showcase', scale);
    if (!art) return el('span', 'sh-art sh-missing', '?');
    art.classList.add('sh-art');
    return art;
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

  /** Your money in an item's currency. */
  const purse = (s: TownShopResponse, it: TownShopItem) => (it.currency === 'kusing' ? (s.kusing ?? 0) : s.kowens);

  /** Why an item can't be bought right now (null = it can). */
  const blocked = (s: TownShopResponse, it: TownShopItem): string | null => {
    if (combat(it)) {
      if (it.max === 0) return 'Your combat bag is full.';
      return purse(s, it) < it.cost ? `You need ${price(it, it.cost - purse(s, it))} more.` : null;
    }
    if (it.owned) return it.kind === 'vault' ? 'You have a vault. Use it at the bank.' : 'You have this bag.';
    if (it.testersOnly) return 'Passes are for testers only (the Tester role in Discord).';
    if (it.max === 0) return it.kind === 'shovel' ? 'No more shovels today. More tomorrow!' : it.kind === 'key' || it.kind === 'potion' || it.kind === 'megaphone' || it.kind === 'rename' || it.kind === 'classchange' ? 'Your bag is full.' : 'Not available right now.';
    if (it.kind === 'pass' && s.inDebt) return 'Pay off your loan at the bank first.';
    if (s.kowens < it.cost) return `You need ${kowens(it.cost - s.kowens)} more.`;
    return null;
  };

  const render = () => {
    const s = shop;
    if (!s) return;
    wallet.replaceChildren('You have ', coinIcon(2), el('b', undefined, kowens(s.kowens)), ' · ', kusingIcon(1), el('b', undefined, kusing(s.kusing ?? 0)));
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
        card.setAttribute('aria-label', `${it.name}, ${price(it, it.cost)}`);
        const tag = el('span', 'sh-price');
        tag.append(it.currency === 'kusing' ? kusingIcon(1) : coinIcon(1), it.cost.toLocaleString());
        card.append(picture(it.id, ART_SCALE), el('span', 'sh-name', it.name), tag);
        if (it.owned) card.append(el('span', 'sh-badge', 'Owned'));
        else if (it.testersOnly) card.append(el('span', 'sh-badge', 'Testers'));
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
    const max = Math.max(1, Math.min(it.max, Math.floor(purse(s, it) / it.cost) || 1));
    quantity = Math.min(quantity, max);
    const head = el('div', 'sh-detail-head');
    const text = el('div');
    text.append(el('div', 'sh-detail-name', it.name), el('div', 'sh-about', it.about));
    if (it.kind === 'fence' && s.fenceUntil) text.append(el('div', 'sh-about sh-up', `Your Bakod is up until ${new Date(s.fenceUntil).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.`));
    head.append(picture(it.id, 2), text);

    const row = el('div', 'sh-buy-row');
    if (combat(it) && !why) {
      // Buy 1, or type how many (the number box), with − and + beside it.
      const step = el('div', 'sh-qty');
      const minus = el('button', 'sh-step', '−');
      const box = el('input', 'sh-count sh-number');
      box.type = 'number';
      box.min = '1';
      box.max = String(max);
      box.value = String(quantity);
      box.setAttribute('aria-label', 'How many');
      const plus = el('button', 'sh-step', '+');
      minus.setAttribute('aria-label', 'One fewer');
      plus.setAttribute('aria-label', 'One more');
      minus.disabled = quantity <= 1;
      plus.disabled = quantity >= max;
      minus.addEventListener('click', () => ((quantity = Math.max(1, quantity - 1)), render()));
      plus.addEventListener('click', () => ((quantity = Math.min(max, quantity + 1)), render()));
      box.addEventListener('change', () => ((quantity = Math.max(1, Math.min(max, Math.floor(Number(box.value)) || 1))), render()));
      box.addEventListener('keydown', (e) => e.key === 'Enter' && box.dispatchEvent(new Event('change')));
      step.append(minus, box, plus);
      row.append(step);
    } else if (it.max > 1 && !why) {
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
    const buyButton = el('button', `sh-buy${confirming ? ' sh-confirm' : ''}`, why ? why : confirming ? `Confirm · ${price(it, total)}` : `${it.kind === 'pass' ? 'Redeem' : 'Buy'} · ${price(it, total)}`);
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
    playSound(res.ok ? (it.currency === 'kusing' ? 'combat-coins' : 'coin') : 'error');
    if (res.ok && it.currency !== 'kusing') window.dispatchEvent(new Event('mk-wallet')); // the HUD's Kowens (and shovels)
  };

  const closed = showPopup({ title: 'Sari-sari store', body: [wrap], button: 'Close', celebrate: false, sound: 'door' });
  followWallet(closed, () => !busy && void load().then((s) => s && !busy && ((shop = s), render())));
  // Kusing (loot picked up while it's open) and the combat bag's room follow the adventure state.
  const off = onAdventure((a) => {
    if (!shop || busy) return;
    shop.kusing = a.kusing;
    if (fakeLogin()) shop = withCombat(shop);
    render();
  });
  void closed.then(off);
  void load().then((s) => {
    if (!s) return void (note.textContent = "Couldn't load the shop. Try again in a moment.");
    shop = s;
    note.textContent = '';
    render();
  });
}

// ── Dev: a pretend shop (no bot behind the dev server) ──

/** Dev: &tester=0 shows the shop as a member without the Tester role sees it (passes locked). */
const notTester = new URLSearchParams(location.search).get('tester') === '0';
const testerMax = notTester ? 0 : 1;
const testerFlag = notTester ? { testersOnly: true } : {};

const fake: TownShopResponse = {
  kowens: Number(new URLSearchParams(location.search).get('kowens') ?? 1250),
  fenceUntil: null,
  inDebt: false,
  items: [
    { id: 'bakod', name: 'Bakod (Fence)', cost: 5, kind: 'fence', about: 'Blocks /steal against you for 1.5 days. Buy again to add time (up to 7 days).', max: 1 },
    { id: 'shovel', name: 'Shovel', cost: 2, kind: 'shovel', about: '3 digs with /dig. Up to 3 shovels a day.', max: 3 },
    { id: 'master-key', name: 'Master Key', cost: 5, kind: 'key', about: '50% chance to break through a Bakod when you /steal. Used only then.', max: 10, have: 1 },
    { id: 'megaphone', name: 'Megaphone', cost: 1, kind: 'megaphone', about: "Type /m and your message in the town's chat: it runs across everyone's screen in sky blue. One per message.", max: 10, have: 3 },
    { id: 'rename-card', name: 'Rename Card', cost: 5, kind: 'rename', about: 'Changes your town nickname: use it from your bag. All your cards share one bag slot.', max: 10, have: 0 },
    { id: 'class-ticket', name: 'Bagong Buhay Ticket', cost: 0, kind: 'classchange', about: "A fresh start: use it from your bag to change your class (you keep your quests and level, get your stat and skill points back, and your training gear becomes the new class's). All your tickets share one bag slot.", max: 10, have: 0 },
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
    { id: 'phantasium', name: 'Phantasium Pass', cost: 1_700, kind: 'pass', about: 'A Crystal of Atlan Phantasium Pass, sent to you by hand. Testers only; not while you have a loan.', max: testerMax, ...testerFlag },
    { id: 'basic-bp', name: 'Basic Battle Pass', cost: 2_450, kind: 'pass', about: 'A Crystal of Atlan Basic Battle Pass, sent to you by hand. Testers only; not while you have a loan.', max: testerMax, ...testerFlag },
    { id: 'advanced-bp', name: 'Advanced Battle Pass', cost: 3_650, kind: 'pass', about: 'A Crystal of Atlan Advanced Battle Pass, sent to you by hand. Testers only; not while you have a loan.', max: testerMax, ...testerFlag },
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
  if (it.kind === 'potion' || it.kind === 'key' || it.kind === 'megaphone' || it.kind === 'rename' || it.kind === 'classchange') it.have = (it.have ?? 0) + quantity;
  return { ...structuredClone(fake), ok: true, message: it.kind === 'pass' ? `Redeemed the ${it.name}! The owner has been told and will send it over.` : `Bought ${quantity > 1 ? `${quantity}× ` : ''}${it.name}!` };
}

// ── Dev: the Healing and Smithing tabs (the dev town buys them from your items there: /__shop) ──

const FAKE_COMBAT: TownShopItem[] = [
  { id: 'low-hp-potion', name: 'Low HP Potion', cost: 50, currency: 'kusing', kind: 'healing', about: 'Heals 150 HP at once. Put it on your hotbar; HP and MP Potions share a 10 s cooldown. For the Slums.', max: 99 },
  { id: 'low-mp-potion', name: 'Low MP Potion', cost: 50, currency: 'kusing', kind: 'healing', about: 'Heals 80 MP at once. Put it on your hotbar; HP and MP Potions share a 10 s cooldown. For the Slums.', max: 99 },
  { id: 'rough-whetstone', name: 'Rough Whetstone', cost: 3, kind: 'smithing', about: 'Enhances weapons, armor and accessories of item Lv 1-20 (the Low tier).', max: 999 },
  { id: 'low-repair-kit', name: 'Low Repair Kit', cost: 15, kind: 'smithing', about: 'Repairs a broken item of item Lv 1-20 (the Low tier).', max: 999 },
];

/** Dev: the pretend shop with the combat tabs, your Kusing and what you carry. */
function withCombat(s: TownShopResponse): TownShopResponse {
  const a = adventure();
  const D = itemData();
  const room = a && D ? bagSlots(D.stats) - pocketUsed(D, a.bag, 'bag') : 40;
  const items = s.items.filter((it) => !combat(it));
  return { ...s, kusing: a?.kusing ?? 0, items: [...items, ...FAKE_COMBAT.map((it) => ({ ...it, have: a ? countOf(a.bag, it.id) : 0, max: room > 0 || (a && countOf(a.bag, it.id)) ? it.max : 0 }))] };
}

async function fakeCombatBuy(id: string, quantity: number): Promise<TownShopBuyResponse | null> {
  const r = await fetch(`/__shop?${new URLSearchParams({ as: fakeName() })}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, quantity, kowens: fake.kowens }) })
    .then((x) => (x.ok ? (x.json() as Promise<{ ok: boolean; message: string; kusing: number; kowens: number }>) : null))
    .catch(() => null);
  if (!r) return null;
  fake.kowens = r.kowens;
  // (Your items come back from the dev town as an `items` message; Kusing shows at once.)
  return { ...withCombat(structuredClone(fake)), kusing: r.kusing, ok: r.ok, message: r.message };
}
