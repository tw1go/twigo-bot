import type { TownBagActionResponse, TownBagItem, TownInventoryResponse } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { fakeLogin, fakeName } from '../session';
import { type Rarity, RARITY_COLOUR, RARITY_TEXT, isRarity, itemArt } from './item-art';
import { installPixelTiles } from './pixel-tiles';
import { coinIcon } from './reward';
import type { EquipmentPanel } from './equipment';
import { adventure, itemDef } from '../net/adventure';
import { NICKNAME_RULE, parseNickname } from '../characters/nickname';

// 🎒 The inventory: a bag button just right of the chat box (or B) opens the bag on the right of the screen. The bag shows every
// slot a bag can ever have (5 × 10): the ones unlocked so far (bags from the shop add more) hold your items, one slot
// each — dug-up items, Master Keys, potions and equipment not being worn, as the bot counts them — and the rest are
// marked with an X. Tabs show all of it, the dug-up items, combat (weapons and gear not being worn), or the misc (keys,
// potions, megaphones); each item's slot is bordered in its rarity's colour. Picking a dug-up item offers Flex (/flex,
// in the games channel) and Sell (/sell's price); keys and potions say how they're used; a Rename Card offers Use: a
// new nickname (POST /town/rename, the creator's rules), which everyone in town sees at once ('mk-renamed' here).
// Several slots can be picked at once: Ctrl/⌘/Shift-click adds or removes one, or the Select toggle (top) makes every
// click do that (phones); then the details show how many, what the sellable ones are worth, and Sell selected (one
// POST /town/sell with all of them), or Select all on the tab.
// Your Kowens are at the bottom. Everything comes from the bot (GET /town/inventory, POST /town/sell and /town/flex).
// The equipment panel (ui/equipment.ts) opens on its left with it (B or I): double-click or drag a piece of equipment
// onto its place to wear it. On phones there's no room for both: Equipment / Bag in their heads switch between them.

const COLS = 5;
type Tab = 'all' | 'dug' | 'combat' | 'misc';
const TABS: [Tab, string][] = [['all', 'All'], ['dug', 'Dug up'], ['combat', 'Combat'], ['misc', 'Misc']];
/** Which tab shows an item: dug-up items, combat (weapons and gear), the rest (keys, potions, megaphones) in Misc. */
const tabOf = (it: TownBagItem): Tab => (it.kind === 'dig' ? 'dug' : it.kind === 'equipment' ? 'combat' : 'misc');
const inTab = (tab: Tab, it: TownBagItem) => tab === 'all' || tabOf(it) === tab;

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
  if (fakeLogin()) return withFakeEquipment(structuredClone(fake));
  const res = await fetch('/town/inventory', { credentials: 'same-origin' }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownInventoryResponse) : null;
}

type ActBody = { id: string; quantity?: number } | { items: { id: string; quantity: number }[] };

async function post(path: '/town/sell' | '/town/flex', body: ActBody): Promise<TownBagActionResponse | null> {
  if (fakeLogin()) return fakeAction(path, body);
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
  /** The picked slots (they light up), and the item that was in each. */
  private picked: { slot: number; id: string }[] = [];
  /** Select mode: every click adds or removes a slot (else Ctrl/⌘/Shift-click does). */
  private multi = false;
  private readonly multiButton = el('button', 'iv-multi', 'Select');
  private busy = false;
  private message: { text: string; ok: boolean } | null = null;
  private equipment: EquipmentPanel | null = null;
  /** The Rename Card's field is open in the details. */
  private renaming = false;

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
    this.multiButton.setAttribute('aria-pressed', 'false');
    this.multiButton.title = 'Pick several items (or Ctrl/⌘/Shift-click)';
    this.multiButton.addEventListener('click', () => {
      this.multi = !this.multi;
      this.multiButton.setAttribute('aria-pressed', String(this.multi));
      if (!this.multi && this.picked.length > 1) this.picked = [];
      this.message = null;
      this.render();
    });
    const toEquip = el('button', 'iv-to-equip', 'Equipment'); // phones: the equipment panel in the bag's place
    toEquip.addEventListener('click', () => document.body.classList.add('show-equipment'));
    head.append(el('span', 'iv-title', 'Inventory'), this.slots, toEquip, this.multiButton, close);
    this.tabs.setAttribute('role', 'tablist');
    for (const [t, label] of TABS) {
      const b = el('button', 'iv-tab', label);
      b.setAttribute('role', 'tab');
      b.dataset.tab = t;
      b.addEventListener('click', () => {
        this.tab = t;
        this.picked = [];
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
      // B (or I: the equipment) opens and closes the bag, unless you're typing (chat, a pop-up's field) or holding a modifier.
      if ((e.key.toLowerCase() === 'b' || e.key.toLowerCase() === 'i') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !typing()) {
        e.preventDefault();
        this.toggle();
      }
    });
    // Kowens or items changed elsewhere (a dig, the shop, the bank): refresh if it's open.
    window.addEventListener('mk-wallet', () => !this.root.hidden && void this.refresh());
  }

  /** The equipment panel, which opens and closes with the bag. */
  attachEquipment(panel: EquipmentPanel): void {
    this.equipment = panel;
    panel.onClose = () => this.toggle(false);
    new ResizeObserver(() => !this.root.hidden && panel.fit(this.root.getBoundingClientRect())).observe(this.root);
  }

  toggle(open = this.root.hidden): void {
    this.root.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
    this.equipment?.show(!!open);
    if (!open) document.body.classList.remove('show-equipment');
    if (open && this.equipment) requestAnimationFrame(() => this.equipment!.fit(this.root.getBoundingClientRect()));
    if (open) {
      playSound('click');
      this.message = null;
      void this.refresh();
    }
  }

  /** Free bag slots as last loaded (a full bag can't take worn equipment back). */
  get free(): number {
    return this.data ? Math.max(0, this.data.slots - this.data.used) : 1;
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
    // After a change a slot may hold something else: keep each pick only if the same item is still there (else another
    // slot of it that isn't picked yet).
    const kept: { slot: number; id: string }[] = [];
    for (const p of this.picked) {
      const taken = (i: number) => kept.some((k) => k.slot === i);
      const slot = units[p.slot]?.id === p.id && !taken(p.slot) ? p.slot : units.findIndex((it, i) => it.id === p.id && !taken(i));
      if (slot >= 0) kept.push({ slot, id: p.id });
    }
    this.picked = kept;
    const cells: HTMLElement[] = [];
    for (let i = 0; i < Math.max(d.maxSlots - (d.used - units.length), units.length); i++) {
      const it = units[i];
      if (i >= open && !it) {
        const locked = el('div', 'iv-cell iv-locked');
        locked.title = 'Locked: get a bigger bag at the sari-sari store';
        cells.push(locked);
        continue;
      }
      if (!it) {
        cells.push(el('div', 'iv-cell'));
        continue;
      }
      const rarity: Rarity = isRarity(it.rarity) ? it.rarity : 'common';
      const slot = i;
      const cell = el('button', `iv-cell iv-item${this.picked.some((p) => p.slot === slot) ? ' iv-picked' : ''}`);
      cell.style.setProperty('--rarity', RARITY_COLOUR[rarity]);
      cell.setAttribute('aria-label', `${it.name} (${LABEL[rarity]})`);
      cell.title = it.name;
      const art = itemArt(it.id, rarity, 'showcase', 2, true);
      cell.append(art ?? el('span', 'iv-emoji', it.emoji));
      if (it.stacked) cell.append(el('span', 'iv-count', String(it.count)));
      if (it.kind === 'equipment') {
        // Worn by a double-click, or dragged onto its place in the equipment panel.
        cell.draggable = true;
        cell.addEventListener('dragstart', (e) => e.dataTransfer?.setData('application/x-mk-equipment', it.id));
        cell.addEventListener('dblclick', () => void this.equipment?.wear(it.id));
      }
      cell.addEventListener('click', (e) => {
        const on = this.picked.some((p) => p.slot === slot);
        if (this.multi || e.ctrlKey || e.metaKey || e.shiftKey) this.picked = on ? this.picked.filter((p) => p.slot !== slot) : [...this.picked, { slot, id: it.id }];
        else this.picked = on && this.picked.length === 1 ? [] : [{ slot, id: it.id }];
        this.message = null;
        this.renaming = false;
        this.render();
      });
      cells.push(cell);
    }
    this.grid.style.setProperty('--cols', String(COLS));
    this.grid.replaceChildren(...cells);
    if (!units.length) {
      const empty =
        this.tab === 'misc' ? 'No keys or potions. Get them at the sari-sari store.'
        : this.tab === 'dug' ? 'Nothing dug up yet. Dig at the Mine!'
        : this.tab === 'combat' ? 'No weapons or gear in your bag. What you wear is in Equipment.'
        : 'Your bag is empty. Dig at the Mine!';
      this.grid.append(el('div', 'iv-empty-note', empty));
    }

    if (this.picked.length > 1) this.renderMany(d);
    else this.renderDetail(this.picked.length ? (d.items.find((it) => it.id === this.picked[0].id) ?? null) : null, units);
    this.wallet.replaceChildren(coinIcon(2), el('b', undefined, d.kowens.toLocaleString()), el('span', undefined, d.kowens === 1 ? 'Kowen' : 'Kowens'));
  }

  private action(text: string, cls: string, run: () => void): HTMLButtonElement {
    const b = el('button', `iv-act ${cls}`, text);
    b.disabled = this.busy;
    b.addEventListener('click', run);
    return b;
  }

  private note(): HTMLElement | null {
    return this.message ? el('div', `iv-note${this.message.ok ? '' : ' iv-bad'}`, this.message.text) : null;
  }

  /** Several picked: how many, what the sellable ones bring, Sell selected and Clear. */
  private renderMany(d: TownInventoryResponse): void {
    const counts = new Map<string, number>();
    for (const p of this.picked) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
    const sell = [...counts].flatMap(([id, n]) => {
      const it = d.items.find((x) => x.id === id);
      return it?.sellable ? [{ id, quantity: n, value: it.value * n }] : [];
    });
    const total = sell.reduce((s, x) => s + x.value, 0);
    const sellable = sell.reduce((s, x) => s + x.quantity, 0);
    const skipped = this.picked.length - sellable;
    const row = el('div', 'iv-actions');
    const sellButton = this.action(`Sell selected · ${total}`, 'iv-sell', () => void this.act('/town/sell', { items: sell.map(({ id, quantity }) => ({ id, quantity })) }));
    sellButton.disabled ||= !sellable;
    row.append(sellButton, this.action('Clear', 'iv-clear', () => ((this.picked = []), (this.message = null), this.render())));
    const meta = `${sellable ? `${sellable} to sell for ${kowens(total)}` : 'Nothing here can be sold'}${skipped ? ` · ${skipped} kept (keys, potions, megaphones)` : ''}`;
    this.detail.replaceChildren(...[el('div', 'iv-name', `${this.picked.length} items selected`), el('div', 'iv-meta', meta), row, this.note()].filter((x): x is HTMLElement => !!x));
  }

  /** The picked item: what it is, and Flex / Sell for dug-up items. With nothing picked, a hint (and in Select mode,
   *  Select all for the tab's sellable items). */
  private renderDetail(it: TownBagItem | null, units: TownBagItem[] = []): void {
    const note = this.note();
    if (!it) {
      const hint = this.multi ? 'Click items to select them.' : this.tab === 'misc' ? 'Pick an item to see how it\'s used.' : 'Pick an item to sell or flex it (Ctrl/Shift-click or Select for several).';
      const parts: HTMLElement[] = note ? [note] : [el('div', 'iv-hint', hint)];
      if (this.multi && units.some((u) => u.sellable)) {
        const row = el('div', 'iv-actions');
        row.append(this.action('Select all', 'iv-clear', () => {
          this.picked = units.flatMap((u, slot) => (u.sellable ? [{ slot, id: u.id }] : []));
          this.message = null;
          this.render();
        }));
        parts.push(row);
      }
      this.detail.replaceChildren(...parts);
      return;
    }
    const rarity: Rarity = isRarity(it.rarity) ? it.rarity : 'common';
    const name = el('div', 'iv-name', it.name);
    name.style.color = RARITY_TEXT[rarity];
    const meta = it.sellable
      ? `${LABEL[rarity]} · ${kowens(it.value)} each · you have ${it.count}`
      : `${it.kind === 'key' ? 'Master Key' : it.kind === 'megaphone' ? 'Megaphone' : it.kind === 'equipment' ? 'Equipment' : it.kind === 'rename' ? 'Rename Card' : 'Potion'} · you have ${it.count}`;
    const parts: HTMLElement[] = [name, el('div', 'iv-meta', meta)];
    if (it.sellable) {
      const row = el('div', 'iv-actions');
      const button = (text: string, cls: string, run: () => void) => this.action(text, cls, run);
      row.append(
        button('Flex', 'iv-flex', () => void this.act('/town/flex', { id: it.id })),
        button(`Sell 1 · ${it.value}`, 'iv-sell', () => void this.act('/town/sell', { id: it.id, quantity: 1 })),
      );
      if (it.count > 1) row.append(button(`Sell all · ${it.value * it.count}`, 'iv-sell', () => void this.act('/town/sell', { id: it.id, quantity: it.count })));
      parts.push(row);
    } else if (it.about) parts.push(el('div', 'iv-about', it.about));
    if (it.kind === 'rename') parts.push(this.renameControls());
    if (note) parts.push(note);
    this.detail.replaceChildren(...parts);
  }

  /** A Rename Card's Use, or (once pressed) the new name's field with Rename and Cancel. */
  private renameControls(): HTMLElement {
    const row = el('div', 'iv-actions');
    if (!this.renaming) {
      row.append(this.action('Use', 'iv-flex', () => ((this.renaming = true), (this.message = null), this.render(), this.root.querySelector<HTMLInputElement>('.iv-rename')?.focus())));
      return row;
    }
    const input = el('input', 'iv-rename');
    input.maxLength = 16;
    input.placeholder = 'New nickname';
    input.title = NICKNAME_RULE;
    input.setAttribute('aria-label', 'New nickname');
    const go = () => void this.rename(input.value);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // not the town's keys
      if (e.key === 'Enter') go();
      if (e.key === 'Escape') ((this.renaming = false), this.render());
    });
    row.append(input, this.action('Rename', 'iv-sell', go), this.action('Cancel', 'iv-clear', () => ((this.renaming = false), this.render())));
    return row;
  }

  /** Uses a Rename Card for `raw` (checked here first with the creator's rules; the bot has the last word). */
  private async rename(raw: string): Promise<void> {
    if (this.busy) return;
    const nickname = parseNickname(raw);
    if (!nickname) {
      playSound('error');
      this.message = { text: NICKNAME_RULE, ok: false };
      return this.render();
    }
    this.busy = true;
    this.render();
    const res = fakeLogin()
      ? ({ ok: true, nickname, cards: 0 } as const)
      : await fetch('/town/rename', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname }) })
          .then((r) => (r.ok ? (r.json() as Promise<{ ok: true; nickname: string } | { ok: false; error: string }>) : null))
          .catch(() => null);
    this.busy = false;
    if (!res) {
      playSound('error');
      this.message = { text: "Couldn't reach the bot. Try again in a moment.", ok: false };
      return this.render();
    }
    if (!res.ok) {
      playSound('error');
      this.message = { text: res.error, ok: false };
      return this.render();
    }
    playSound('coin');
    this.renaming = false;
    this.picked = [];
    this.message = { text: `You're now ${res.nickname}!`, ok: true };
    if (fakeLogin()) {
      fake.items = fake.items.filter((x) => x.kind !== 'rename'); // dev: the pretend card is used
      fake.used -= 1;
    }
    window.dispatchEvent(new CustomEvent('mk-renamed', { detail: res.nickname }));
    void this.refresh();
  }

  private async act(path: '/town/sell' | '/town/flex', body: ActBody): Promise<void> {
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
    if (res.ok && 'items' in body) this.picked = []; // sold the lot
    this.message = { text: res.message, ok: res.ok };
    playSound(res.ok ? (path === '/town/sell' ? 'coin' : 'click') : 'error');
    if (res.ok && path === '/town/sell') window.dispatchEvent(new Event('mk-wallet')); // the HUD's Kowens
    this.render();
  }
}

// ── Dev: a pretend bag (no bot behind the dev server) ──

/** Dev: the pretend equipment in the bag (net/adventure.ts keeps it in this browser). */
function withFakeEquipment(d: TownInventoryResponse): TownInventoryResponse {
  const counts = new Map<string, number>();
  for (const id of adventure()?.bag ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, count] of counts) {
    const item = itemDef(id);
    if (item) d.items.push({ id, name: item.name, emoji: '⚔️', rarity: item.rarity, value: 0, count, kind: 'equipment', sellable: false, about: `Lv ${item.level} ${item.slot}. Double-click or drag it onto its slot to wear it.` });
  }
  d.used += counts.size ? [...counts.values()].reduce((a, b) => a + b, 0) : 0;
  return d;
}

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
    { id: 'rename-card', name: 'Rename Card', emoji: '🪪', rarity: 'common', value: 0, count: 1, kind: 'rename', sellable: false, stacked: true, about: 'Use it to change your town nickname (3-16 letters or numbers; spaces, _ - . in between).' },
    { id: 'megaphone', name: 'Megaphone', emoji: '📢', rarity: 'common', value: 0, count: 3, kind: 'megaphone', sellable: false, stacked: true, about: "Type /m and your message in the town's chat: it runs across everyone's screen in sky blue. One per message." },
    { id: 'potion-tago', name: 'Tago Tonic', emoji: '🫥', rarity: 'common', value: 0, count: 2, kind: 'potion', sellable: false, about: "For 30 minutes the Tanod can't see you gamble: 0% bust chance. Use it with /potion use in Discord." },
  ],
  slots: Number(q.get('slots') ?? 18),
  maxSlots: 50,
  used: 0,
  kowens: Number(q.get('kowens') ?? 1250),
};
fake.used = fake.items.reduce((n, it) => n + (it.stacked ? 1 : it.count), 0);

function fakeAction(path: string, body: ActBody): TownBagActionResponse {
  const done = (ok: boolean, message: string) => ({ ...structuredClone(fake), ok, message });
  if ('items' in body) {
    let sold = 0;
    let earned = 0;
    for (const { id, quantity } of body.items) {
      const it = fake.items.find((x) => x.id === id);
      if (!it) continue;
      const n = Math.min(quantity, it.count);
      it.count -= n;
      sold += n;
      earned += n * it.value;
    }
    fake.items = fake.items.filter((x) => x.count > 0);
    fake.used -= sold;
    fake.kowens += earned;
    return done(sold > 0, sold ? `Sold ${sold} items for ${kowens(earned)}.` : "You don't have those items.");
  }
  const it = fake.items.find((x) => x.id === body.id);
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
