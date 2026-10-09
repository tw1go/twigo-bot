import { keyLabel, matches, onKeybinds } from './keybinds';
import { type Item, type Pocket, type TownBagActionResponse, type TownBagItem, type TownInventoryResponse, agimatPocket, bagSlots, isGearDef, pocketOf, pocketSlots, pocketUsed, sellPrice } from '@mikazuki/shared';
import { hotbarDragItem, hotbarItem } from './hotbar';
import { playSound } from '../audio/sound';
import { fakeLogin, fakeName } from '../session';
import { type Rarity, RARITY_COLOUR, RARITY_LABEL as LABEL, RARITY_TEXT, isRarity, itemArt } from './item-art';
import { installPixelTiles } from './pixel-tiles';
import { coinIcon, kusingIcon } from './reward';
import type { EquipmentPanel } from './equipment';
import { adventure, anyDef, cantWear, itemData, onAdventure } from '../net/adventure';
import { chatItem, itemKeys, itemPicture, itemTipFor, nameOf, rarityOf, wearDiff, wornFor } from './item-tip';
import { potionCooldownKey } from './hotbar';
import { showRename } from './rename';
import { type ForgePopup, confirmCombine, confirmDisassemble, confirmDisassembleMany, confirmSell, confirmSellMany, forgeFromBag, mountForge } from './forge';
import { fragmentsPerWhetstone } from '@mikazuki/shared';
import { inTrade, tradeBlocked, tradeDrag, tradePut, trading } from './trade';

// 🎒 The inventory: a bag button just right of the chat box (or B) opens the bag on the right of the screen. The bag shows every
// slot a bag can ever have (5 × 10): the ones unlocked so far (bags from the shop add more) hold your items, one slot
// each — dug-up items, Master Keys, potions and equipment not being worn, as the bot counts them — and the rest are
// marked with an X. Tabs show all of it, the dug-up items, combat (weapons and gear not being worn), or the misc (keys,
// potions, megaphones); each item's slot is bordered in its rarity's colour. Picking a dug-up item offers Flex (/flex,
// in the games channel) and Sell (/sell's price); keys and potions say how they're used; a Rename Card offers Use (the
// rename pop-up, ui/rename.ts).
// Several slots can be picked at once: Ctrl/⌘/Shift-click adds or removes one, or the Select toggle (top) makes every
// click do that (phones); then the details show how many, what the sellable ones are worth, and Sell selected (one
// POST /town/sell with all of them), or Select all on the tab.
// Your Kowens and Kusing are at the bottom. Everything comes from the bot (GET /town/inventory, POST /town/sell and
// /town/flex).
// The Combat tab is the combat bag (stats.json inventory.slots, 40): gear not worn, whetstones, fragments, Repair Kits,
// agimats, HP/MP Potions and cosmetics, one slot each (a stack with its count), as the server keeps them (/me's
// adventure and the town's `items` messages: net/adventure.ts). Hover or pick one for its tooltip; gear is worn by a
// double-click or a drag onto its place; HP/MP Potions are dragged onto the hotbar.
// The forge (ui/forge.ts): clicking a whetstone, Repair Kit or agimat opens the forge popup beside the bag (enhance,
// repair, embed); gear clicked or dragged while it's open goes into it. Right-click gear for Disassemble (a confirm box
// first), a fragment stack for Combine (ten into a whetstone).
// The Agimats tab is the agimats' own pocket (stats.json inventory.agimatSlots, 40): they don't take the Combat tab's
// slots (hidden when there's no such pocket: agimats are in Combat then).
// Trading (ui/trade.ts): while the trade window is open the bag shows the Combat tab beside it; what can't be traded
// (bound) is greyed, what's in the trade dimmed, and a click or drag puts an item in.
// The equipment panel (ui/equipment.ts) opens on its left with it (B or I): double-click or drag a piece of equipment
// onto its place to wear it. On phones there's no room for both: Equipment / Bag in their heads switch between them.

const COLS = 5;
type Tab = 'all' | 'dug' | 'combat' | 'agimats' | 'misc';
const TABS: [Tab, string][] = [['all', 'All'], ['dug', 'Dug up'], ['combat', 'Combat'], ['agimats', 'Agimats'], ['misc', 'Misc']];
/** Which tab shows an item of the old bag: dug-up items, the rest (keys, potions, megaphones) in Misc. (Combat is the
 *  combat bag's own.) */
const tabOf = (it: TownBagItem): Tab => (it.kind === 'dig' ? 'dug' : 'misc');
const inTab = (tab: Tab, it: TownBagItem) => tab === 'all' || tabOf(it) === tab;

/** True while a page field has the keyboard (chat, a pop-up's input), so B is a letter there. */
function typing(): boolean {
  if (document.body.classList.contains('town-locked')) return true; // in the casino
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const kowens = (n: number) => plural(n, 'Kowen', 'Kowens');

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
  /** The combat bag's picked slot (its item's uid). */
  private pickedUid: string | null = null;
  /** The combat bag's items picked together (Select, or Ctrl/⌘/Shift-click): taken apart or sold at once. */
  private readonly pickedMany = new Set<string>();
  /** The combat bag's hover tooltip. */
  private readonly tip = el('div', 'eq-tip iv-tip');
  /** Shift held over gear: what you wear in its place, beside its tooltip. */
  private readonly compareTip = el('div', 'eq-tip iv-tip iv-compare');
  /** The combat item under the pointer (Shift pressed or let go redraws its tooltip). */
  private hovered: { it: Item; at: HTMLElement } | null = null;
  /** The forge popup (enhance, repair, embed). */
  private readonly forge: ForgePopup;
  /** The right-click menu (Disassemble, Combine). */
  private readonly menu = el('div', 'iv-menu');

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
    onKeybinds(() => (this.button.title = keyLabel('bag') ? `Inventory (${keyLabel('bag')})` : 'Inventory'));
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
      if (!this.multi) this.pickedMany.clear();
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
        this.pickedMany.clear();
        this.message = null;
        this.render();
      });
      this.tabs.append(b);
    }
    this.grid.setAttribute('role', 'grid');
    this.hideTip();
    this.root.append(head, this.tabs, this.grid, this.detail, this.wallet);
    this.menu.hidden = true;
    this.menu.setAttribute('role', 'menu');
    this.compareTip.hidden = true;
    document.body.append(this.root, this.tip, this.compareTip, this.menu); // (the tooltip over the equipment panel too)
    // Shift pressed or let go over a combat item: its comparison on or off.
    const shift = (e: KeyboardEvent) => e.key === 'Shift' && this.hovered && !this.tip.hidden && this.showTip(this.hovered.it, this.hovered.at, e.type === 'keydown');
    addEventListener('keydown', shift);
    addEventListener('keyup', shift);
    document.addEventListener('pointerdown', (e) => !this.menu.contains(e.target as Node) && (this.menu.hidden = true));
    this.forge = mountForge(frame, slot);
    this.forge.besides = () => {
      const eq = document.getElementById('equipment');
      return eq && !eq.hidden && eq.offsetWidth ? eq.getBoundingClientRect() : this.root.hidden ? null : this.root.getBoundingClientRect();
    };
    // The combat bag and Kusing live in the adventure state: redraw as they change (loot, potions, the shop).
    onAdventure(() => !this.root.hidden && this.render());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.root.hidden) this.toggle(false);
      // The bag's keys (B or I by default: ui/keybinds.ts) open and close it, unless you're typing (chat, a pop-up's field).
      if (matches('bag', e) && !e.repeat && !typing()) {
        e.preventDefault();
        this.toggle();
      }
    });
    // Kowens or items changed elsewhere (a dig, the shop, the bank): refresh if it's open.
    window.addEventListener('mk-wallet', () => !this.root.hidden && void this.refresh());
    // The trade window opened, changed or closed: what's greyed and dimmed follows.
    window.addEventListener('mk-trade', () => !this.root.hidden && this.render());
    // A ticket spent on a new class (the town's class choice): dev's pretend one goes; the bag shows one fewer.
    window.addEventListener('mk-bag-changed', () => {
      if (fakeLogin()) {
        fake.items = fake.items.filter((x) => x.kind !== 'classchange');
        fake.used -= 1;
      }
      if (!this.root.hidden) void this.refresh();
    });
  }

  /** The equipment panel, which opens and closes with the bag. */
  attachEquipment(panel: EquipmentPanel): void {
    this.equipment = panel;
    panel.onClose = () => this.toggle(false);
    new ResizeObserver(() => !this.root.hidden && panel.fit(this.root.getBoundingClientRect())).observe(this.root);
  }

  toggle(open = this.root.hidden): void {
    this.root.hidden = !open;
    this.hideTip();
    this.menu.hidden = true;
    if (!open) this.forge.close();
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

  /** For a trade: the bag on its Combat tab, without the equipment panel (the trade window goes beside it). */
  openForTrade(): void {
    this.tab = 'combat';
    if (this.root.hidden) this.toggle(true);
    else this.render();
    this.equipment?.show(false);
    document.body.classList.remove('show-equipment');
  }

  /** Free combat bag slots (a full bag can't take worn equipment back). */
  get free(): number {
    const D = itemData();
    const s = adventure();
    return D && s ? Math.max(0, bagSlots(D.stats) - pocketUsed(D, s.bag, 'bag')) : 1;
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
      const D = itemData();
      const a = adventure();
      const n = t === 'combat' || t === 'agimats' ? (D && a ? pocketUsed(D, a.bag, t === 'agimats' ? 'agimats' : 'bag') : 0) : d.items.filter((it) => inTab(t, it)).reduce((sum, it) => sum + (it.stacked ? 1 : it.count), 0);
      if (t === 'agimats') b.hidden = !D || !agimatPocket(D.stats); // (no pocket of their own: agimats are in Combat)
      b.textContent = `${TABS.find(([x]) => x === t)![1]} ${n}`;
      b.setAttribute('aria-selected', String(t === this.tab));
    }
    this.renderWallet(d);
    if (this.tab === 'combat' || this.tab === 'agimats') return this.renderCombat();
    this.hideTip();

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
      cell.append(itemArt(it.id, rarity, 'showcase', 2, true) ?? el('span', 'iv-emoji', it.emoji));
      if (it.stacked) cell.append(el('span', 'iv-count', String(it.count)));
      if (hotbarItem(it.kind)) {
        // Potions go on the hotbar (its - = ~ slots or the top row).
        cell.draggable = true;
        cell.addEventListener('dragstart', (e) => hotbarDragItem(e, { id: it.id, name: it.name, emoji: it.emoji, rarity }));
      }
      cell.addEventListener('click', (e) => {
        const on = this.picked.some((p) => p.slot === slot);
        if (this.multi || e.ctrlKey || e.metaKey || e.shiftKey) this.picked = on ? this.picked.filter((p) => p.slot !== slot) : [...this.picked, { slot, id: it.id }];
        else this.picked = on && this.picked.length === 1 ? [] : [{ slot, id: it.id }];
        this.message = null;
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
        : 'Your bag is empty. Dig at the Mine!';
      this.grid.append(el('div', 'iv-empty-note', empty));
    }

    if (this.picked.length > 1) this.renderMany(d);
    else this.renderDetail(this.picked.length ? (d.items.find((it) => it.id === this.picked[0].id) ?? null) : null, units);
  }

  /** Kowens and Kusing at the bottom (Kusing's coin, the numbers in Jersey 10 like every number). */
  private renderWallet(d: TownInventoryResponse): void {
    const k = adventure()?.kusing ?? 0;
    const kusing = el('span', 'iv-kusing');
    kusing.append(kusingIcon(2), el('b', undefined, k.toLocaleString()), el('span', undefined, 'Kusing'));
    const kowens = el('span', 'iv-kowens');
    kowens.append(coinIcon(2), el('b', undefined, d.kowens.toLocaleString()), el('span', undefined, d.kowens === 1 ? 'Kowen' : 'Kowens'));
    this.wallet.replaceChildren(kowens, kusing);
  }

  /** The combat bag: its 40 slots, items in order, then the empty ones; the picked one's tooltip and what it can do. */
  private renderCombat(): void {
    const D = itemData();
    const s = adventure();
    if (!D || !s) return void this.grid.replaceChildren(el('div', 'iv-empty', 'Choose a class with the Tanod to fill your combat bag.'));
    // This tab's pocket: the Agimats tab's own, the Combat tab the rest.
    const pocket: Pocket = this.tab === 'agimats' ? 'agimats' : 'bag';
    const bag = s.bag.filter((b) => pocketOf(D, b) === pocket);
    const slots = pocketSlots(D, pocket);
    this.slots.textContent = `${bag.length}/${slots}`;
    this.slots.classList.toggle('iv-full', bag.length >= slots);
    if (this.pickedUid && !bag.some((b) => b.uid === this.pickedUid)) this.pickedUid = null;
    for (const uid of [...this.pickedMany]) if (!bag.some((b) => b.uid === uid)) this.pickedMany.delete(uid);
    const cells: HTMLElement[] = [];
    for (let i = 0; i < Math.max(slots, bag.length); i++) {
      const it = bag[i];
      if (!it) {
        cells.push(el('div', 'iv-cell'));
        continue;
      }
      const def = anyDef(it.defId);
      // Trading: what can't go in greyed, what's in already dimmed.
      const blocked = trading() ? tradeBlocked(it) : null;
      // Gear you can't wear (another class's, or above what your stats meet): a red slot.
      const unusable = isGearDef(def) && !!cantWear({ ...def, level: it.level });
      const cell = el('button', `iv-cell iv-item${it.uid === this.pickedUid || this.pickedMany.has(it.uid) ? ' iv-picked' : ''}${it.broken ? ' iv-broken' : ''}${unusable ? ' iv-unusable' : ''}${blocked ? ' iv-no-trade' : ''}${trading() && inTrade(it.uid) ? ' iv-in-trade' : ''}`);
      if (blocked) cell.title = blocked;
      cell.style.setProperty('--rarity', RARITY_COLOUR[rarityOf(it)]);
      cell.setAttribute('aria-label', nameOf(it));
      cell.dataset.uid = it.uid;
      cell.append(itemPicture(it, 'showcase', 2));
      if (it.count > 1) cell.append(el('span', 'iv-count', String(it.count)));
      if (isGearDef(def)) {
        // Worn by a double-click, or dragged onto its place in the equipment panel (or into the forge popup).
        cell.draggable = true;
        cell.addEventListener('dragstart', (e) => e.dataTransfer?.setData('application/x-mk-equipment', it.uid));
        cell.addEventListener('dblclick', () => !this.forge.isOpen && !trading() && void this.equipment?.wear(it.uid));
      } else if (def && (def.kind === 'agimat' || def.forge === 'whetstone' || def.forge === 'repairKit')) {
        // Forge tools: dragged onto the forge popup's slots.
        cell.draggable = true;
        cell.addEventListener('dragstart', (e) => e.dataTransfer?.setData('application/x-mk-tool', it.uid));
      } else if (def?.kind === 'potion') {
        // HP and MP Potions go on the hotbar (its - = ~ slots or the top row).
        cell.draggable = true;
        cell.addEventListener('dragstart', (e) => hotbarDragItem(e, { id: it.defId, name: def.name, emoji: '🧪', rarity: it.rarity, cooldown: potionCooldownKey }));
      }
      // Anything can be dragged into the trade window.
      cell.draggable = true;
      cell.addEventListener('dragstart', (e) => tradeDrag(e, it.uid));
      cell.addEventListener('pointerenter', (e) => this.showTip(it, cell, e.shiftKey));
      cell.addEventListener('pointerleave', () => this.hideTip());
      cell.addEventListener('click', (e) => {
        // Alt+click: shown in the chat (ui/chat.ts).
        if (e.altKey) return chatItem(it);
        // Several at once (Select, or Ctrl/⌘/Shift-click): picked or let go, to take apart or sell together.
        if (!trading() && (this.multi || e.ctrlKey || e.metaKey || e.shiftKey)) {
          if (this.pickedUid && this.pickedUid !== it.uid) this.pickedMany.add(this.pickedUid);
          this.pickedUid = null;
          if (!this.pickedMany.delete(it.uid)) this.pickedMany.add(it.uid);
          this.message = null;
          return this.render();
        }
        // Trading: it goes into the trade.
        if (tradePut(it.uid)) return;
        // A whetstone, Repair Kit or agimat opens the forge popup; gear goes into it while it's open.
        if (!isGearDef(def) && this.openForge(it)) return;
        if (isGearDef(def) && this.forge.put(it.uid)) return;
        this.pickedUid = this.pickedUid === it.uid ? null : it.uid;
        this.message = null;
        this.render();
      });
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showMenu(it, cell, e.clientX, e.clientY);
      });
      cells.push(cell);
    }
    this.grid.style.setProperty('--cols', String(COLS));
    this.grid.replaceChildren(...cells);
    if (!bag.length) this.grid.append(el('div', 'iv-empty-note', pocket === 'agimats' ? 'No agimats yet. Take slotted gear apart, or find them on the golem.' : 'Nothing in your combat bag. Loot from the Slums lands here; what you wear is in Equipment.'));
    if (this.pickedMany.size > 1 || (this.multi && !this.pickedUid)) return this.renderCombatMany(bag);
    const it = s.bag.find((b) => b.uid === this.pickedUid);
    if (!it) return void this.detail.replaceChildren(this.note() ?? el('div', 'iv-hint', 'Pick an item for what it is. Double-click gear to wear it; drag HP and MP Potions onto your hotbar.'));
    const def = anyDef(it.defId);
    const parts = itemTipFor(it);
    const row = el('div', 'iv-actions');
    if (isGearDef(def)) {
      // Gear you can't wear (another class's, above your stats, broken): Wear greyed, the reason on hover.
      const wear = this.action('Wear', 'iv-flex', () => void this.equipment?.wear(it.uid));
      const why = this.cantWearWhy(it);
      if (why) Object.assign(wear, { disabled: true, title: why });
      row.append(wear);
      const price = this.priceOf(it);
      if (!def.training) row.append(this.action('Disassemble', 'iv-sell', () => void this.disassemble(it, null)));
      else if (price !== null) row.append(this.action(`Sell · ${price} Kusing`, 'iv-sell', () => void this.sell(it, null, price)));
    } else if (def?.kind === 'potion') parts.push(el('div', 'iv-about', 'Drag it onto your hotbar (the - = ~ slots) and use it in the Slums.'));
    else if (def?.forge === 'whetstone') row.append(this.action('Enhance…', 'iv-flex', () => void this.openForge(it)));
    else if (def?.forge === 'repairKit') row.append(this.action('Repair…', 'iv-flex', () => void this.openForge(it)));
    else if (def?.kind === 'agimat') {
      row.append(this.action('Embed…', 'iv-flex', () => void this.openForge(it)));
      const price = this.priceOf(it);
      if (price !== null) row.append(this.action(`Sell · ${price.toLocaleString()} Kusing`, 'iv-sell', () => void this.sell(it, null, price)));
    }
    else if (def?.forge === 'fragment') row.append(this.action('Combine', 'iv-flex', () => void this.combine(it, null)));
    if (row.childElementCount) parts.push(row);
    const note = this.note();
    if (note) parts.push(note);
    this.detail.replaceChildren(...parts);
  }

  /** Opens the forge popup for a whetstone (enhance), Repair Kit (repair) or agimat (embed); false for anything else. */
  private openForge(it: Item): boolean {
    const def = anyDef(it.defId);
    if (!def || isGearDef(def)) return false;
    if (def.kind === 'agimat') this.forge.open('embed', it.uid);
    else if (def.forge === 'whetstone') this.forge.open('enhance', def.id);
    else if (def.forge === 'repairKit') this.forge.open('repair', def.id);
    else return false;
    this.hideTip();
    return true;
  }

  /** The right-click menu: Disassemble for gear (not training gear), Combine for fragments, the forge for its tools. */
  private showMenu(it: Item, cell: HTMLElement, x: number, y: number): void {
    const def = anyDef(it.defId);
    const items: [string, () => void][] = [];
    const off = new Set<number>(); // greyed rows
    if (isGearDef(def)) {
      if (this.cantWearWhy(it)) off.add(items.length);
      items.push(['Wear', () => void this.equipment?.wear(it.uid)]);
      // Training gear sells for Kusing (it can't be taken apart); the rest is taken apart.
      const price = this.priceOf(it);
      if (def.training && price !== null) items.push([`Sell (${price} Kusing)`, () => void this.sell(it, cell, price)]);
      else if (def.training) {
        off.add(items.length);
        items.push(["Training gear can't be sold", () => {}]);
      } else items.push(['Disassemble', () => void this.disassemble(it, cell)]);
    } else if (def?.forge === 'fragment') {
      const D = itemData();
      const per = D ? fragmentsPerWhetstone(D.stats) : 10;
      items.push([`Combine (${per} → 1 whetstone)`, () => void this.combine(it, cell)]);
    } else if (def && (def.kind === 'agimat' || def.forge)) {
      items.push([def.kind === 'agimat' ? 'Embed…' : def.forge === 'repairKit' ? 'Repair…' : 'Enhance…', () => void this.openForge(it)]);
      const price = def.kind === 'agimat' ? this.priceOf(it) : null;
      if (price !== null) items.push([`Sell (${price.toLocaleString()} Kusing)`, () => void this.sell(it, cell, price)]);
    }
    // Every item: into the chat (as Alt/Option+click does).
    items.push(['Show in chat', () => chatItem(it)]);
    this.menu.replaceChildren(
      ...items.map(([label, run], i) => {
        const b = el('button', 'iv-menu-item', label);
        b.setAttribute('role', 'menuitem');
        b.disabled = off.has(i);
        if (i === 0 && off.has(0) && isGearDef(def)) b.title = this.cantWearWhy(it) ?? '';
        b.addEventListener('click', () => {
          this.menu.hidden = true;
          run();
        });
        return b;
      }),
    );
    this.menu.hidden = false;
    this.hideTip();
    this.menu.style.left = `${Math.round(Math.min(x, innerWidth - this.menu.offsetWidth - 8))}px`;
    this.menu.style.top = `${Math.round(Math.min(y, innerHeight - this.menu.offsetHeight - 8))}px`;
  }

  /** Takes gear apart once they've said yes in the confirm box. */
  private async disassemble(it: Item, cell: HTMLElement | null): Promise<void> {
    if (this.busy || !(await confirmDisassemble(it))) return;
    this.busy = true;
    const r = await forgeFromBag({ action: 'disassemble', item: it.uid }, cell ?? this.grid);
    this.busy = false;
    if (r) this.message = { text: r.message, ok: r.ok };
    if (this.pickedUid === it.uid && r?.ok) this.pickedUid = null;
    this.render();
  }

  /** What an item sells for in Kusing (training gear, agimats: the whole stack), or null. */
  private priceOf(it: Item): number | null {
    const D = itemData();
    return D ? sellPrice(D, it) : null;
  }

  /** Several combat items picked (or Select on with none yet): how many, what can be taken apart and what sells (and
   *  for how much), Disassemble N / Sell N, Clear; Select all gear while nothing is picked. */
  private renderCombatMany(bag: Item[]): void {
    const picked = bag.filter((b) => this.pickedMany.has(b.uid));
    const canApart = (b: Item) => {
      const d = anyDef(b.defId);
      return isGearDef(d) && !d.training;
    };
    const apart = picked.filter(canApart);
    const sold = picked.flatMap((b) => {
      const price = this.priceOf(b);
      return price === null ? [] : [{ b, price }];
    });
    const total = sold.reduce((n, x) => n + x.price, 0);
    const row = el('div', 'iv-actions');
    const parts: HTMLElement[] = [];
    if (!picked.length) {
      parts.push(el('div', 'iv-hint', 'Click items to select them: gear to take apart, training gear and agimats to sell.'));
      // (Gear only: agimats are picked one by one.)
      const all = bag.filter((b) => isGearDef(anyDef(b.defId)) && (canApart(b) || this.priceOf(b) !== null));
      if (all.length) {
        row.append(this.action(`Select all gear (${all.length})`, 'iv-clear', () => {
          for (const b of all) this.pickedMany.add(b.uid);
          this.message = null;
          this.render();
        }));
      }
    } else {
      parts.push(el('div', 'iv-name', `${picked.length} item${picked.length === 1 ? '' : 's'} selected`));
      const kept = picked.length - apart.length - sold.length;
      const meta = [apart.length ? `${apart.length} to take apart` : '', sold.length ? `${sold.length} to sell for ${total.toLocaleString()} Kusing` : '', kept ? `${kept} can't be taken apart or sold` : ''].filter(Boolean).join(' · ');
      parts.push(el('div', 'iv-meta', meta));
      if (apart.length) row.append(this.action(`Disassemble ${apart.length}`, 'iv-sell', () => void this.disassembleMany(apart)));
      if (sold.length) row.append(this.action(`Sell ${sold.length} · ${total.toLocaleString()} Kusing`, 'iv-sell', () => void this.sellMany(sold.map((x) => x.b), total)));
      row.append(this.action('Clear', 'iv-clear', () => ((this.pickedMany.clear(), (this.message = null)), this.render())));
    }
    if (row.childElementCount) parts.push(row);
    const note = this.note();
    if (note) parts.push(note);
    this.detail.replaceChildren(...parts);
  }

  /** Several pieces taken apart at once, once they've said yes. */
  private async disassembleMany(items: Item[]): Promise<void> {
    if (this.busy || !(await confirmDisassembleMany(items))) return;
    this.busy = true;
    const r = await forgeFromBag({ action: 'disassemble-many', items: items.map((i) => i.uid) }, this.grid);
    this.busy = false;
    if (r) this.message = { text: r.message, ok: r.ok };
    if (r?.ok) for (const i of items) this.pickedMany.delete(i.uid);
    this.render();
  }

  /** Training gear and agimats sold at once, once they've said yes. */
  private async sellMany(items: Item[], total: number): Promise<void> {
    if (this.busy || !(await confirmSellMany(items, total))) return;
    this.busy = true;
    const r = await forgeFromBag({ action: 'sell-many', items: items.map((i) => i.uid) }, this.grid);
    this.busy = false;
    if (r) this.message = { text: r.message, ok: r.ok };
    if (r?.ok) for (const i of items) this.pickedMany.delete(i.uid);
    this.render();
  }

  /** Training gear sold for Kusing, once they've said yes. */
  private async sell(it: Item, cell: HTMLElement | null, price: number): Promise<void> {
    if (this.busy || !(await confirmSell(it, price))) return;
    this.busy = true;
    const r = await forgeFromBag({ action: 'sell', item: it.uid }, cell ?? this.grid);
    this.busy = false;
    if (r) this.message = { text: r.message, ok: r.ok };
    if (this.pickedUid === it.uid && r?.ok) this.pickedUid = null;
    this.render();
  }

  /** Every ten fragments of a stack's kind into a whetstone, once they've said yes in the Combine box. */
  private async combine(it: Item, cell: HTMLElement | null): Promise<void> {
    if (this.busy || !(await confirmCombine(it))) return;
    this.busy = true;
    const r = await forgeFromBag({ action: 'combine', item: it.uid }, cell);
    this.busy = false;
    if (r) this.message = { text: r.message, ok: r.ok };
    this.render();
  }

  /** A combat item's tooltip beside its slot, with what its keys do at the foot. `compare` (Shift held, gear): how your
   *  stats would change wearing it, and what you wear in its place in a box beside it. */
  private showTip(it: Item, at: HTMLElement, compare = false): void {
    this.hovered = { it, at };
    const diff = compare ? wearDiff(it) : null;
    this.tip.replaceChildren(...itemTipFor(it), ...(diff ? [diff] : []), itemKeys(it, 'bag'));
    this.tip.hidden = false;
    const r = at.getBoundingClientRect();
    this.tip.style.right = `${Math.round(innerWidth - r.left + 6)}px`;
    this.tip.style.top = `${Math.round(Math.max(8, Math.min(r.top, innerHeight - this.tip.offsetHeight - 8)))}px`;
    const worn = compare ? wornFor(it) : [];
    this.compareTip.hidden = !worn.length;
    if (!worn.length) return;
    this.compareTip.replaceChildren(...worn.flatMap((w, i) => [el('div', 'eq-tip-equipped', worn.length > 1 ? `Equipped (${i + 1})` : 'Equipped'), ...itemTipFor(w)]));
    const t = this.tip.getBoundingClientRect();
    this.compareTip.style.right = `${Math.round(innerWidth - t.left + 6)}px`;
    this.compareTip.style.top = `${Math.round(Math.max(8, Math.min(t.top, innerHeight - this.compareTip.offsetHeight - 8)))}px`;
  }

  private hideTip(): void {
    this.hovered = null;
    this.tip.hidden = true;
    this.compareTip.hidden = true;
  }

  /** Why a piece of gear can't be worn now (its requirements on your base stats, or broken), or null. */
  private cantWearWhy(it: Item): string | null {
    const def = anyDef(it.defId);
    if (!isGearDef(def)) return null;
    if (it.broken) return "It's broken: repair it first.";
    return cantWear({ ...def, level: it.level });
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
      : `${it.kind === 'key' ? 'Master Key' : it.kind === 'megaphone' ? 'Megaphone' : it.kind === 'equipment' ? 'Equipment' : it.kind === 'rename' ? 'Rename Card' : it.kind === 'classchange' ? 'Bagong Buhay Ticket' : 'Potion'} · you have ${it.count}`;
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
    if (it.kind === 'classchange') parts.push(this.ticketControls());
    if (note) parts.push(note);
    this.detail.replaceChildren(...parts);
  }

  /** A Bagong Buhay Ticket's Use: the class choice (the town opens it; the bag closes meanwhile). */
  private ticketControls(): HTMLElement {
    const row = el('div', 'iv-actions');
    row.append(
      this.action('Use', 'iv-flex', () => {
        this.toggle(false);
        dispatchEvent(new Event('mk-class-ticket'));
      }),
    );
    return row;
  }

  /** A Rename Card's Use: the rename pop-up (ui/rename.ts). */
  private renameControls(): HTMLElement {
    const row = el('div', 'iv-actions');
    row.append(
      this.action('Use', 'iv-flex', () =>
        showRename((nickname) => {
          this.picked = [];
          this.message = { text: `You're now ${nickname}!`, ok: true };
          if (fakeLogin()) {
            fake.items = fake.items.filter((x) => x.kind !== 'rename'); // dev: the pretend card is used
            fake.used -= 1;
          }
          void this.refresh();
        }),
      ),
    );
    return row;
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
    { id: 'class-ticket', name: 'Bagong Buhay Ticket', emoji: '🎫', rarity: 'common', value: 0, count: 1, kind: 'classchange', sellable: false, stacked: true, about: "A fresh start: use it to change your class. You keep your quests and level, get your stat and skill points back, and your training gear becomes the new class's." },
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
