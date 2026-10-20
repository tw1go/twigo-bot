import type { TownShopBuyResponse, TownShopItem, TownShopResponse } from '@mikazuki/shared';
import { api } from '../net/endpoints';
import { playSound } from '../audio/sound';
import { bagSlots, boxPrice, cosmeticShopItem, cosmeticWares, countOf, isGearDef, pocketUsed } from '@mikazuki/shared';
import { fakeLogin, fakeName } from '../session';
import { adventure, anyDef, itemData, onAdventure } from '../net/adventure';
import { RARITY_TEXT, itemArt } from './item-art';
import { coinIcon, el, followWallet, kusingIcon, showPopup } from './reward';
import { halloweenShopEvents } from './halloween';

// 🎁 The sari-sari store (left click the store): what /redeem sells, in the reward box with tabs (Items, Potions, Bags).
// Each tab is a grid of the item art with prices; picking one shows what it does, a quantity for the ones that stack,
// and a Buy button. Buying goes through
// the bot (POST /town/shop) with /redeem's checks. Item art: manifest `items` by reward id (ui/item-art.ts), in the
// common rarity frame.
// Healing, Smithing, Dungeons (the Warren Ticket for Kusing), Travel (the Return Lantern for Kusing) and Pets (the pet boxes for Kowens, stats.json pets.boxPrice) are the Slums' (bot web/combat-bag.ts): HP and MP Potions for Kusing, whetstones and Repair Kits
// for Kowens, into the combat bag; only the Low tier until you reach the next one. Buy 1, or type how many (up to a
// stack, what fits and what you can pay); the server says why not when it can't.
// Cosmetics (shared cosmetic-shop.ts; CONTEXT.md Cosmetic, Set): sub-tabs All / Head / Body / Weapon, one at a time into
// the Costume tab; All ends with a card per Set (the Body's picture with the Head's over its corner); an event's (the
// Witch Hat and Robe) tagged Limited. The detail shows the piece worn on your own character (TownScene's
// `setShopPreview`) and a piece of a Set you have neither of offers the Set too.

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const kowens = (n: number) => plural(n, 'Kowen', 'Kowens');

type Tab = 'items' | 'potions' | 'bags' | 'healing' | 'smithing' | 'dungeons' | 'travel' | 'pets' | 'cosmetics';
const TABS: [Tab, string, TownShopItem['kind'][]][] = [
  ['items', 'Items', ['fence', 'shovel', 'key', 'megaphone', 'rename', 'classchange', 'vault']],
  ['potions', 'Potions', ['potion']],
  ['bags', 'Bags', ['bag']],
  ['healing', 'Healing', ['healing']],
  ['smithing', 'Smithing', ['smithing']],
  ['dungeons', 'Dungeons', ['dungeons']],
  ['travel', 'Travel', ['travel']],
  ['pets', 'Pets', ['pets']],
  ['cosmetics', 'Cosmetics', ['cosmetic']],
];
/** The Cosmetics tab's sub-tabs (a cosmetic's place; All: every piece, then the Sets). */
type Sub = 'all' | 'head' | 'body' | 'weapon';
const SUBS: [Sub, string][] = [
  ['all', 'All'],
  ['head', 'Head'],
  ['body', 'Body'],
  ['weapon', 'Weapon'],
];

/** The worn preview: your character facing south-east wearing these cosmetics (with whatever else you wear), as a
 *  64x64 canvas; set by the town. Null: none. */
type Preview = (ids: string[]) => Promise<HTMLCanvasElement | null>;
let previewOf: Preview | null = null;
export const setShopPreview = (f: Preview | null) => (previewOf = f);
/** Cosmetics and Sets (into the Costume tab, one at a time). */
const cosmetic = (it: TownShopItem) => it.kind === 'cosmetic';
/** Combat items (into the combat bag): typed quantities. */
const combat = (it: TownShopItem) => it.kind === 'healing' || it.kind === 'smithing' || it.kind === 'dungeons' || it.kind === 'travel' || it.kind === 'pets';
const kusing = (n: number) => `${n.toLocaleString()} Kusing`;
const price = (it: TownShopItem, n: number) => (it.currency === 'kusing' ? kusing(n) : kowens(n));
/** Item art is 32 px: shown at 2× in the grid. */
const ART_SCALE = 2;

async function load(): Promise<TownShopResponse | null> {
  if (fakeLogin()) return withCombat(structuredClone(fake));
  const res = await api('/town/shop', { credentials: 'same-origin' }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownShopResponse) : null;
}

/** Whether an item kind is a cosmetic (the dev town buys those). */
const isCosmeticKind = (id: string) => {
  const d = anyDef(id);
  return !!d && !isGearDef(d) && d.kind === 'cosmetic';
};

async function buy(id: string, quantity: number): Promise<TownShopBuyResponse | null> {
  if (fakeLogin()) return fakeCombat().some((x) => x.id === id) || id.startsWith('set:') || isCosmeticKind(id) ? fakeCombatBuy(id, quantity) : fakeBuy(id, quantity);
  const res = await api('/town/shop', {
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
  const subBar = el('div', 'sh-subtabs');
  subBar.setAttribute('role', 'tablist');
  const detail = el('div', 'sh-detail');
  const note = el('div', 'bk-note', 'Loading…');
  note.setAttribute('role', 'status');
  const wrap = el('div', 'sh-body');
  wrap.append(wallet, bar, subBar, grid, detail, note);

  let shop: TownShopResponse | null = null;
  let tab: Tab = 'items';
  let sub: Sub = 'all';
  /** Worn previews by the ids worn ('loading' while their layers load). */
  const previews = new Map<string, HTMLCanvasElement | 'loading' | null>();
  let picked: string | null = null;
  let quantity = 1;
  let busy = false;

  const picture = (id: string, scale: number) => {
    const art = itemArt(id, 'common', 'showcase', scale);
    if (!art) return el('span', 'sh-art sh-missing', '?');
    art.classList.add('sh-art');
    return art;
  };
  /** A Set's card picture: its Body with its Head over the top corner. */
  const setPicture = (pieces: string[], scale: number) => {
    const box = el('span', 'sh-art sh-set-art');
    const body = picture(pieces[1], scale);
    const head = picture(pieces[0], Math.max(1, scale / 2));
    head.classList.add('sh-set-head');
    box.append(body, head);
    return box;
  };
  const artOf = (it: TownShopItem, scale: number) => (it.pieces ? setPicture(it.pieces, scale) : picture(it.id, scale));

  const subTabs = new Map<Sub, HTMLButtonElement>();
  for (const [t, label] of SUBS) {
    const b = el('button', 'sh-subtab', label);
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => {
      sub = t;
      picked = null;
      render();
    });
    subTabs.set(t, b);
    subBar.append(b);
  }

  const tabs = new Map<Tab, HTMLButtonElement>();
  for (const [t, label] of TABS) {
    const b = el('button', 'bk-tab', label);
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => {
      tab = t;
      picked = null;
      note.textContent = '';
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
    if (cosmetic(it)) {
      if (it.owned) return 'You have this.';
      return s.kowens < it.cost ? `You need ${kowens(it.cost - s.kowens)} more.` : null;
    }
    if (combat(it)) {
      if (it.max === 0) return 'Your combat bag is full.';
      return purse(s, it) < it.cost ? `You need ${price(it, it.cost - purse(s, it))} more.` : null;
    }
    if (it.owned) return it.kind === 'vault' ? 'You have a vault. Use it at the bank.' : 'You have this bag.';
    if (it.max === 0) return it.kind === 'shovel' ? 'No more shovels today. More tomorrow!' : it.kind === 'key' || it.kind === 'potion' || it.kind === 'megaphone' || it.kind === 'rename' || it.kind === 'classchange' ? 'Your bag is full.' : 'Not available right now.';
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
    subBar.hidden = tab !== 'cosmetics';
    for (const [t, b] of subTabs) b.setAttribute('aria-selected', String(t === sub));
    // (the Cosmetics tab: by its sub-tab, a Set only under All)
    const items = s.items.filter((it) => kinds.includes(it.kind) && (tab !== 'cosmetics' || (sub === 'all' ? true : it.cosmeticPlace === sub)));
    if (!picked || !items.some((it) => it.id === picked)) {
      picked = items[0]?.id ?? null;
      quantity = 1;
    }

    grid.replaceChildren(
      ...items.map((it) => {
        const card = el('button', `sh-card${it.id === picked ? ' sh-picked' : ''}${blocked(s, it) ? ' sh-dim' : ''}`);
        card.setAttribute('aria-pressed', String(it.id === picked));
        card.setAttribute('aria-label', `${it.name}, ${price(it, it.cost)}`);
        const tag = el('span', 'sh-price');
        tag.append(it.currency === 'kusing' ? kusingIcon(1) : coinIcon(1), it.cost.toLocaleString());
        // (A pet box's name in its rarity's colour: Fairy Cha's is rare.)
        const name = el('span', 'sh-name', it.name);
        const def = it.kind === 'pets' ? anyDef(it.id) : undefined;
        if (def && def.rarity !== 'white') name.style.color = RARITY_TEXT[def.rarity];
        card.append(artOf(it, ART_SCALE), name, tag);
        if (it.pieces) card.append(el('span', 'sh-badge sh-set', 'Set'));
        if (it.owned) card.append(el('span', 'sh-badge', 'Owned'));
        else if (it.limited) card.append(el('span', 'sh-badge sh-limited', 'Limited'));
        else if (it.have) card.append(el('span', 'sh-badge sh-have', `×${it.have}`));
        card.addEventListener('click', () => {
          if (picked === it.id) return;
          picked = it.id;
          quantity = 1;
              note.textContent = '';
          render();
        });
        return card;
      }),
    );
    if (!items.length && tab === 'cosmetics') grid.append(el('div', 'sh-empty', sub === 'weapon' ? 'No weapon cosmetics yet.' : 'Nothing here right now.'));

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
    if (it.limited) text.append(el('div', 'sh-about sh-limited-line', it.limited));
    head.append(artOf(it, 2), text);
    if (cosmetic(it)) head.append(preview(it.pieces ?? [it.id]));

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
    const buyButton = el('button', 'sh-buy', why ? why : `Buy · ${price(it, total)}`);
    buyButton.disabled = !!why || busy;
    buyButton.addEventListener('click', () => {
      void purchase(it, quantity);
    });
    // A piece of a Set you have neither of: the Set too.
    const set = cosmetic(it) && !it.pieces && it.set ? s.items.find((x) => x.pieces && x.set === it.set) : undefined;
    if (set) {
      const setWhy = blocked(s, set);
      const setButton = el('button', 'sh-buy sh-buy-set', `Buy the set: ${price(set, set.cost)}`);
      setButton.title = set.name;
      setButton.disabled = !!setWhy || busy;
      setButton.addEventListener('click', () => void purchase(set, 1));
      row.append(setButton);
    }
    row.append(buyButton);
    detail.append(head, row);
  };

  /** The worn preview for these cosmetics (2×), drawn once its layers are in; nothing without the town's hook. */
  const preview = (ids: string[]): HTMLElement => {
    const box = el('span', 'sh-preview');
    if (!previewOf) return box;
    const key = ids.join('+');
    const done = previews.get(key);
    if (done === undefined) {
      previews.set(key, 'loading');
      void previewOf(ids).then((c) => {
        previews.set(key, c);
        render();
      });
    } else if (done && done !== 'loading') box.append(done);
    return box;
  };

  const purchase = async (it: TownShopItem, n: number) => {
    if (busy) return;
    busy = true;
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
    { id: 'potion-kalawang', name: 'Kalawang Potion', cost: 8, kind: 'potion', about: "Rusts someone's Bakod: cuts its remaining time in half. Throw it at a house's Bakod from its menu in the neighbourhood, or with /potion use in Discord.", max: 10 },
    { id: 'potion-tago', name: 'Tago Tonic', cost: 6, kind: 'potion', about: "For 30 minutes the Tanod can't see you gamble: 0% bust chance. Drink it from your bag (Misc tab), or with /potion use in Discord.", max: 10, have: 2 },
    { id: 'potion-swerte', name: 'Swerte Elixir', cost: 5, kind: 'potion', about: 'Your next 3 digs: any junk gets rerolled once. Drink it from your bag (Misc tab), or with /potion use in Discord.', max: 10 },
    { id: 'potion-marites', name: 'Marites Tea', cost: 3, kind: 'potion', about: 'Aling Marites spills a hint about a hidden Easter egg. Drink it from your bag (Misc tab), or with /potion use in Discord.', max: 10 },
    { id: 'bag-supot', name: 'Supot (Plastic Bag)', cost: 5, kind: 'bag', about: '+8 inventory slots for what you dig up. Each bag once.', max: 0, owned: true },
    { id: 'bag-bayong', name: 'Bayong', cost: 10, kind: 'bag', about: '+8 inventory slots for what you dig up. Each bag once.', max: 1 },
    { id: 'bag-backpack', name: 'School Backpack', cost: 20, kind: 'bag', about: '+8 inventory slots for what you dig up. Each bag once.', max: 1 },
    { id: 'bag-balikbayan', name: 'Balikbayan Box', cost: 35, kind: 'bag', about: '+8 inventory slots for what you dig up. Each bag once.', max: 1 },
    { id: 'bag-lola', name: "Lola's Bottomless Bag", cost: 50, kind: 'bag', about: '+8 inventory slots for what you dig up. Each bag once.', max: 1 },
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
  return { ...structuredClone(fake), ok: true, message: `Bought ${quantity > 1 ? `${quantity}× ` : ''}${it.name}!` };
}

// ── Dev: the Healing and Smithing tabs (the dev town buys them from your items there: /__shop) ──

const FAKE_COMBAT: TownShopItem[] = [
  { id: 'low-hp-potion', name: 'Low HP Potion', cost: 50, currency: 'kusing', kind: 'healing', about: 'Heals 150 HP at once. Put it on your hotbar; HP and MP Potions share a 10 s cooldown. For the Slums.', max: 99 },
  { id: 'low-mp-potion', name: 'Low MP Potion', cost: 50, currency: 'kusing', kind: 'healing', about: 'Heals 80 MP at once. Put it on your hotbar; HP and MP Potions share a 10 s cooldown. For the Slums.', max: 99 },
  { id: 'mid-hp-potion', name: 'Medium HP Potion', cost: 150, currency: 'kusing', kind: 'healing', about: 'Heals 250 HP at once. Put it on your hotbar; HP and MP Potions share a 10 s cooldown. For the Slums.', max: 99 },
  { id: 'mid-mp-potion', name: 'Medium MP Potion', cost: 150, currency: 'kusing', kind: 'healing', about: 'Heals 140 MP at once. Put it on your hotbar; HP and MP Potions share a 10 s cooldown. For the Slums.', max: 99 },
  { id: 'rough-whetstone', name: 'Rough Whetstone', cost: 3, kind: 'smithing', about: 'Enhances weapons, armor and accessories of item Lv 1-20 (the Low tier).', max: 999 },
  { id: 'low-repair-kit', name: 'Low Repair Kit', cost: 15, kind: 'smithing', about: 'Repairs a broken item of item Lv 1-20 (the Low tier).', max: 999 },
  { id: 'agimat-pliers', name: 'Agimat Pliers', cost: 10, kind: 'smithing', about: 'Pulls one agimat out of a weapon or armor piece without breaking it.', max: 99 },
  { id: 'temper-stone', name: 'Temper Stone', cost: 30, kind: 'smithing', about: "Draws an item's + into the stone, to put onto another item of the same type and item level.", max: 99 },
  { id: 'warren-ticket', name: 'Warren Ticket', cost: 500000, currency: 'kusing', kind: 'dungeons', about: 'Opens a run of the Scrap Warrens for you, or for your whole party. Use it at the Warren Gate by the golem pit.', max: 99 },
  { id: 'return-lantern', name: 'Return Lantern', cost: 200, currency: 'kusing', kind: 'travel', about: 'Light it at a Lantern Post to travel to another map.', max: 99 },
];

/** Dev: the pretend combat wares, the pet boxes with them (their prices from stats.json pets.boxPrice, as the bot's). */
function fakeCombat(): TownShopItem[] {
  const D = itemData();
  const boxes = D ? [...D.defs.values()].flatMap((d): TownShopItem[] => {
    const cost = !isGearDef(d) && d.opens ? boxPrice(D, d.id) : null;
    return cost ? [{ id: d.id, name: d.name, cost, kind: 'pets', about: !isGearDef(d) ? (d.about ?? '') : '', max: 99 }] : [];
  }) : [];
  return [...FAKE_COMBAT, ...boxes];
}

/** Dev: the pretend shop with the combat tabs, your Kusing and what you carry. */
function withCombat(s: TownShopResponse): TownShopResponse {
  const a = adventure();
  const D = itemData();
  const room = a && D ? bagSlots(D.stats) - pocketUsed(D, a.bag, 'bag') : 40;
  const items = s.items.filter((it) => !combat(it) && !cosmetic(it));
  // (the Cosmetics tab by the shared rules: your Costume tab and what you wear, the dev town's Halloween)
  const cosmetics = a && D ? cosmeticWares(D, a, halloweenShopEvents(), Date.now()).map(cosmeticShopItem) : [];
  return { ...s, kusing: a?.kusing ?? 0, items: [...items, ...fakeCombat().map((it) => ({ ...it, have: a ? countOf(a.bag, it.id) : 0, max: room > 0 || (a && countOf(a.bag, it.id)) ? it.max : 0 })), ...cosmetics] };
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
