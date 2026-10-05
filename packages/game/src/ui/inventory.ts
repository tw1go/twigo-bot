import type { TownBagActionResponse, TownBagItem, TownInventoryResponse } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { fakeLogin, fakeName } from '../session';
import { type Rarity, RARITY_COLOUR, RARITY_TEXT, isRarity, itemArt } from './item-art';
import { installPixelTiles } from './pixel-tiles';
import { coinIcon } from './reward';

// 🎒 The inventory: a bag button just right of the chat box (or B) opens the bag on the right of the screen. The bag shows every
// slot a bag can ever have (5 × 10): the ones unlocked so far (bags from the shop add more) hold your items, one slot
// each — dug-up items, Master Keys and potions, as the bot counts them — and the rest are marked with an X. Tabs show
// all of it, the dug-up items, or the misc (keys and potions); each item's slot is bordered in its rarity's colour. Picking a
// dug-up item offers Flex (/flex, in the games channel) and Sell (/sell's price); keys and potions say how they're used.
// Your Kowens are at the bottom. Everything comes from the bot (GET /town/inventory, POST /town/sell and /town/flex).

const COLS = 5;
type Tab = 'all' | 'dug' | 'misc';
const TABS: [Tab, string][] = [['all', 'All'], ['dug', 'Dug up'], ['misc', 'Misc']];
const inTab = (tab: Tab, it: TownBagItem) => tab === 'all' || (tab === 'dug') === (it.kind === 'dig');

/** True while a page field has the keyboard (chat, a pop-up's input), so B is a letter there. */
function typing(): boolean {
  if (document.body.classList.contains('town-locked')) return true; // in the casino
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const kowens = (n: number) => plural(n, 'Kowen', 'Kowens');
const LABEL: Record<Rarity, string> = { junk: 'Junk', common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', mythical: 'Mythical', legendary: 'Legendary', secret: 'Secret' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function load(): Promise<TownInventoryResponse | null> {
  if (fakeLogin()) return structuredClone(fake);
  const res = await fetch('/town/inventory', { credentials: 'same-origin' }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownInventoryResponse) : null;
}

async function post(path: '/town/sell' | '/town/flex', body: object): Promise<TownBagActionResponse | null> {
  if (fakeLogin()) return fakeAction(path, body as { id: string; quantity?: number });
  const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownBagActionResponse) : null;
}

export class Inventory {
  /** The bag button (the town puts it beside the chat box). */
  readonly button = el('button', 'iv-open');
  private readonly root = el('div');
  private readonly tabs = el('div', 'iv-tabs');
  private tab: Tab = 'all';
  private readonly grid = el('div', 'iv-grid');
  private readonly detail = el('div', 'iv-detail');
  private readonly slots = el('span', 'iv-slots');
  private readonly wallet = el('div', 'iv-wallet');
  private data: TownInventoryResponse | null = null;
  /** The picked slot (only that slot lights up), and the item that was in it. */
  private picked: { slot: number; id: string } | null = null;
  private busy = false;
  private message: { text: string; ok: boolean } | null = null;

  /** `icon`: the bag art (manifest ui.inventoryIcon); `frame`: the item frame the panel is drawn in; `slot`: the slot
   *  art and its picked version (manifest ui.inventory, nine-slice). */
  constructor(icon: string | null, frame: { url: string; slice: number } | null, slot: { url: string; picked: string; slice: number } | null) {
    installPixelTiles();
    if (icon) {
      const img = el('img', 'iv-icon');
      img.src = icon;
      img.alt = '';
      this.button.append(img);
    } else this.button.textContent = 'Bag';
    if (frame) {
      this.button.classList.add('iv-framed-button');
      this.button.style.setProperty('--frame', `url("${frame.url}")`);
      this.button.style.setProperty('--slice', String(frame.slice));
    }
    this.button.id = 'bag-button';
    this.button.title = 'Inventory (B)';
    this.button.setAttribute('aria-label', 'Inventory');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.addEventListener('click', () => this.toggle());

    this.root.id = 'inventory';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Inventory');
    if (slot) {
      this.root.style.setProperty('--slot', `url("${slot.url}")`);
      this.root.style.setProperty('--slot-picked', `url("${slot.picked}")`);
      this.root.style.setProperty('--slot-slice', String(slot.slice));
    }
    if (frame) {
      this.root.classList.add('iv-framed');
      this.root.style.setProperty('--frame', `url("${frame.url}")`);
      this.root.style.setProperty('--slice', String(frame.slice));
    }
    const head = el('div', 'iv-head');
    const close = el('button', 'iv-close', '×');
    close.setAttribute('aria-label', 'Close the inventory');
    close.addEventListener('click', () => this.toggle(false));
    head.append(el('span', 'iv-title', 'Inventory'), this.slots, close);
    this.tabs.setAttribute('role', 'tablist');
    for (const [t, label] of TABS) {
      const b = el('button', 'iv-tab', label);
      b.setAttribute('role', 'tab');
      b.dataset.tab = t;
      b.addEventListener('click', () => {
        this.tab = t;
        this.picked = null;
        this.message = null;
        this.render();
      });
      this.tabs.append(b);
    }
    this.grid.setAttribute('role', 'grid');
    this.root.append(head, this.tabs, this.grid, this.detail, this.wallet);
    document.body.append(this.root);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.root.hidden) this.toggle(false);
      // B opens and closes the bag, unless you're typing (chat, a pop-up's field) or holding a modifier.
      if (e.key.toLowerCase() === 'b' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !typing()) {
        e.preventDefault();
        this.toggle();
      }
    });
    // Kowens or items changed elsewhere (a dig, the shop, the bank): refresh if it's open.
    window.addEventListener('mk-wallet', () => !this.root.hidden && void this.refresh());
  }

  toggle(open = this.root.hidden): void {
    this.root.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
    if (open) {
      playSound('click');
      this.message = null;
      void this.refresh();
    }
  }

  private async refresh(): Promise<void> {
    const d = await load();
    if (!d) {
      this.grid.replaceChildren(el('div', 'iv-empty', "Couldn't load your bag. Try again in a moment."));
      return;
    }
    this.data = d;
    this.render();
  }

  private render(): void {
    const d = this.data;
    if (!d) return;
    this.slots.textContent = `${d.used}/${d.slots}`;
    this.slots.classList.toggle('iv-full', d.used >= d.slots);

    for (const b of this.tabs.querySelectorAll<HTMLElement>('.iv-tab')) {
      const t = b.dataset.tab as Tab;
      const n = d.items.filter((it) => inTab(t, it)).reduce((sum, it) => sum + (it.stacked ? 1 : it.count), 0);
      b.textContent = `${TABS.find(([x]) => x === t)![1]} ${n}`;
      b.setAttribute('aria-selected', String(t === this.tab));
    }

    // One slot per item (this tab's; a stacked kind, megaphones, in one with its count), then the free slots, then the
    // locked ones up to the most a bag can have.
    const units = d.items.filter((it) => inTab(this.tab, it)).flatMap((it) => Array.from({ length: it.stacked ? 1 : it.count }, () => it));
    const free = Math.max(0, d.slots - d.used);
    const open = units.length + free;
    // After a sale the slot may hold something else: keep the pick only if the same item is still there.
    if (this.picked && units[this.picked.slot]?.id !== this.picked.id) {
      const again = units.findIndex((it) => it.id === this.picked!.id);
      this.picked = again >= 0 ? { slot: again, id: this.picked.id } : null;
    }
    const cells: HTMLElement[] = [];
    for (let i = 0; i < Math.max(d.maxSlots - (d.used - units.length), units.length); i++) {
      const it = units[i];
      if (i >= open && !it) {
        const locked = el('div', 'iv-cell iv-locked');
        locked.title = 'Locked: get a bigger bag at the rewards shop';
        cells.push(locked);
        continue;
      }
      if (!it) {
        cells.push(el('div', 'iv-cell'));
        continue;
      }
      const rarity: Rarity = isRarity(it.rarity) ? it.rarity : 'common';
      const slot = i;
      const cell = el('button', `iv-cell iv-item${this.picked?.slot === slot ? ' iv-picked' : ''}`);
      cell.style.setProperty('--rarity', RARITY_COLOUR[rarity]);
      cell.setAttribute('aria-label', `${it.name} (${LABEL[rarity]})`);
      cell.title = it.name;
      const art = itemArt(it.id, rarity, 'showcase', 2, true);
      cell.append(art ?? el('span', 'iv-emoji', it.emoji));
      if (it.stacked) cell.append(el('span', 'iv-count', String(it.count)));
      cell.addEventListener('click', () => {
        this.picked = this.picked?.slot === slot ? null : { slot, id: it.id };
        this.message = null;
        this.render();
      });
      cells.push(cell);
    }
    this.grid.style.setProperty('--cols', String(COLS));
    this.grid.replaceChildren(...cells);
    if (!units.length) {
      const empty = this.tab === 'misc' ? 'No keys or potions. Get them at the rewards shop.' : this.tab === 'dug' ? 'Nothing dug up yet. Dig at the Mine!' : 'Your bag is empty. Dig at the Mine!';
      this.grid.append(el('div', 'iv-empty-note', empty));
    }

    this.renderDetail(this.picked ? (d.items.find((it) => it.id === this.picked!.id) ?? null) : null);
    this.wallet.replaceChildren(coinIcon(2), el('b', undefined, d.kowens.toLocaleString()), el('span', undefined, d.kowens === 1 ? 'Kowen' : 'Kowens'));
  }

  /** The picked item: what it is, and Flex / Sell for dug-up items. */
  private renderDetail(it: TownBagItem | null): void {
    const note = this.message ? el('div', `iv-note${this.message.ok ? '' : ' iv-bad'}`, this.message.text) : null;
    if (!it) {
      const hint = this.tab === 'misc' ? 'Pick an item to see how it\'s used.' : 'Pick an item to sell or flex it.';
      this.detail.replaceChildren(...(note ? [note] : [el('div', 'iv-hint', hint)]));
      return;
    }
    const rarity: Rarity = isRarity(it.rarity) ? it.rarity : 'common';
    const name = el('div', 'iv-name', it.name);
    name.style.color = RARITY_TEXT[rarity];
    const meta = it.sellable
      ? `${LABEL[rarity]} · ${kowens(it.value)} each · you have ${it.count}`
      : `${it.kind === 'key' ? 'Master Key' : it.kind === 'megaphone' ? 'Megaphone' : 'Potion'} · you have ${it.count}`;
    const parts: HTMLElement[] = [name, el('div', 'iv-meta', meta)];
    if (it.sellable) {
      const row = el('div', 'iv-actions');
      const button = (text: string, cls: string, run: () => void) => {
        const b = el('button', `iv-act ${cls}`, text);
        b.disabled = this.busy;
        b.addEventListener('click', run);
        return b;
      };
      row.append(
        button('Flex', 'iv-flex', () => void this.act('/town/flex', { id: it.id })),
        button(`Sell 1 · ${it.value}`, 'iv-sell', () => void this.act('/town/sell', { id: it.id, quantity: 1 })),
      );
      if (it.count > 1) row.append(button(`Sell all · ${it.value * it.count}`, 'iv-sell', () => void this.act('/town/sell', { id: it.id, quantity: it.count })));
      parts.push(row);
    } else if (it.about) parts.push(el('div', 'iv-about', it.about));
    if (note) parts.push(note);
    this.detail.replaceChildren(...parts);
  }

  private async act(path: '/town/sell' | '/town/flex', body: { id: string; quantity?: number }): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    const res = await post(path, body);
    this.busy = false;
    if (!res) {
      playSound('error');
      this.message = { text: "Couldn't reach the bot. Try again in a moment.", ok: false };
      return this.render();
    }
    this.data = res;
    this.message = { text: res.message, ok: res.ok };
    playSound(res.ok ? (path === '/town/sell' ? 'coin' : 'click') : 'error');
    if (res.ok && path === '/town/sell') window.dispatchEvent(new Event('mk-wallet')); // the HUD's Kowens
    this.render();
  }
}

// ── Dev: a pretend bag (no bot behind the dev server) ──

const q = new URLSearchParams(location.search);
const fake: TownInventoryResponse = {
  items: [
    { id: 'twigo-treasure', name: "twigo's Treasure", emoji: '💰', rarity: 'legendary', value: 500, count: 1, kind: 'dig', sellable: true },
    { id: 'barong', name: 'Barong', emoji: '👔', rarity: 'mythical', value: 120, count: 1, kind: 'dig', sellable: true },
    { id: 'karaoke-mic', name: 'Karaoke Mic', emoji: '🎤', rarity: 'epic', value: 40, count: 2, kind: 'dig', sellable: true },
    { id: 'nokia-3310', name: 'Nokia 3310', emoji: '📱', rarity: 'rare', value: 15, count: 1, kind: 'dig', sellable: true },
    { id: 'kalamansi', name: 'Kalamansi', emoji: '🍋', rarity: 'uncommon', value: 4, count: 1, kind: 'dig', sellable: true },
    { id: 'bottle-cap', name: 'Bottle Cap', emoji: '🧢', rarity: 'common', value: 1, count: 3, kind: 'dig', sellable: true },
    { id: 'rock', name: 'Rock', emoji: '🪨', rarity: 'junk', value: 0, count: 2, kind: 'dig', sellable: true },
    { id: 'master-key', name: 'Master Key', emoji: '🗝️', rarity: 'common', value: 0, count: 1, kind: 'key', sellable: false, about: '50% chance to break through a Bakod when you /steal. Used only then.' },
    { id: 'megaphone', name: 'Megaphone', emoji: '📢', rarity: 'common', value: 0, count: 3, kind: 'megaphone', sellable: false, stacked: true, about: "Type /m and your message in the town's chat: it runs across everyone's screen in sky blue. One per message." },
    { id: 'potion-tago', name: 'Tago Tonic', emoji: '🫥', rarity: 'common', value: 0, count: 2, kind: 'potion', sellable: false, about: "For 30 minutes the Tanod can't see you gamble: 0% bust chance. Use it with /potion use in Discord." },
  ],
  slots: Number(q.get('slots') ?? 18),
  maxSlots: 50,
  used: 0,
  kowens: Number(q.get('kowens') ?? 1250),
};
fake.used = fake.items.reduce((n, it) => n + (it.stacked ? 1 : it.count), 0);

function fakeAction(path: string, body: { id: string; quantity?: number }): TownBagActionResponse {
  const it = fake.items.find((x) => x.id === body.id);
  const done = (ok: boolean, message: string) => ({ ...structuredClone(fake), ok, message });
  if (!it) return done(false, "You don't have that item.");
  if (path === '/town/flex') {
    // Through the dev town, so the chat line and bubble come back as they do live.
    void fetch(`/__flex?${new URLSearchParams({ as: fakeName(), itemId: it.id, itemName: it.name, rarity: it.rarity })}`).catch(() => null);
    return done(true, `You flexed ${it.name}! It's in the games channel.`);
  }
  const n = Math.min(body.quantity ?? 1, it.count);
  it.count -= n;
  fake.items = fake.items.filter((x) => x.count > 0);
  fake.used -= n;
  fake.kowens += n * it.value;
  return done(true, `Sold ${n > 1 ? `${n}× ` : ''}${it.name} for ${kowens(n * it.value)}.`);
}
