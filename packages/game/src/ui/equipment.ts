import { type AdventureState, type EquipPlace, type EquipSlot, type EquipmentDef, type StatName, STAT_NAMES, baseStats, canEquip, derivedStats, itemTotals, pointStats, requirements } from '@mikazuki/shared';
import type { Dir } from '../assets/types';
import { playSound } from '../audio/sound';
import { adventure, adventureData, cantWear, classInfo, equipItem, itemDef, onAdventure, placesFor, resetPoints, spendPoint, unequipPlace } from '../net/adventure';
import { type Rarity, RARITY_COLOUR, RARITY_LABEL, RARITY_TEXT, isRarity } from './item-art';
import { itemPicture, itemTipFor, myMainStat, nameOf, rarityOf } from './item-tip';
import { toast } from './toast';
import { forgeTake } from './forge';

// 🛡️ The equipment panel, on the left of the bag (it opens and closes with it; I or B). Twelve places in the
// inventory's slot art: Weapon, Head, Body, Hands, Bottoms and Feet on the left; Necklace, Earrings, two Bracers and two
// Rings on the right. Empty ones show their grey silhouette (ui.equipSlots) and are named by your gear type on hover
// (combat-guide.md: Heavy, Light, Household); worn ones show the item's 16x16 icon in its rarity's colour (an item
// without art yet: its place's silhouette). Your character idles in the middle (3×, facing SE, with the resting weapon)
// over a faint crescent moon; a drag turns it. Under it your class and level, and the stats box (the stats rules,
// @mikazuki/shared: ATK = Power, DEF, HP, MP, STR, DEX, INT, Crit from your class, level, stat points and what's worn),
// with your unspent stat points: a + on your class's main and second stat (POST /town/points), and a free Reset;
// before a class they're banked. Double-click or drag an item from the bag onto its place to wear it (if its
// requirements are met: base stats only; refused with what's missing, "Needs DEX 26"); right-click or double-click a
// worn one to take it off. While the forge popup (ui/forge.ts) is open, a click or a drag puts a worn item into it.

const LEFT: EquipPlace[] = ['weapon', 'head', 'body', 'hands', 'bottoms', 'feet'];
const RIGHT: EquipPlace[] = ['necklace', 'earrings', 'bracers1', 'bracers2', 'ring1', 'ring2'];
const KIND: Record<EquipPlace, EquipSlot> = {
  weapon: 'weapon', head: 'head', body: 'body', hands: 'hands', bottoms: 'bottoms', feet: 'feet', necklace: 'necklace', earrings: 'earrings',
  bracers1: 'bracers', bracers2: 'bracers', ring1: 'ring', ring2: 'ring',
};
const NAME: Record<EquipSlot, string> = {
  weapon: 'Weapon', head: 'Head', body: 'Body', hands: 'Hands', bottoms: 'Bottoms', feet: 'Feet', necklace: 'Necklace', earrings: 'Earrings', bracers: 'Bracers', ring: 'Ring',
};
/** The armour pieces' names by gear type (combat-guide.md). */
const GEAR: Record<string, Partial<Record<EquipSlot, string>>> = {
  Heavy: { head: 'Hard hat', body: 'Armor', hands: 'Gauntlets', bottoms: 'Legguards', feet: 'Greaves' },
  Light: { head: 'Headpiece', body: 'Suit', hands: 'Gloves', bottoms: 'Pants', feet: 'Boots' },
  Household: { head: 'Headwrap', body: 'Robe', hands: 'Wraps', bottoms: 'Trousers', feet: 'Sandals' },
};
const DIRS: Dir[] = ['s', 'sw', 'w', 'nw', 'n', 'ne', 'e', 'se'];

/** The empty-slot silhouettes (set by the panel), which also stand in for an item without art yet. */
let silhouettes: EquipmentOptions['silhouettes'] = null;

/** A kind's grey silhouette at `px` px square (16x16 art), or null without the sheet. */
export function slotSilhouette(kind: EquipSlot, px = 32): HTMLElement | null {
  if (!silhouettes) return null;
  const i = Math.max(0, silhouettes.frames.indexOf(kind));
  const icon = el('span', 'gear-silhouette');
  icon.style.width = icon.style.height = `${px}px`;
  icon.style.backgroundImage = `url("${silhouettes.url}")`;
  icon.style.backgroundSize = `${silhouettes.frames.length * px}px ${px}px`;
  icon.style.backgroundPosition = `-${i * px}px 0`;
  return icon;
}

/** A piece of equipment's 32x32 picture (toasts): its showcase art, else its place's silhouette. */
export function gearPicture(item: EquipmentDef, assets: (file: string) => string): HTMLElement | null {
  if (!item.showcase) return slotSilhouette(item.slot);
  return Object.assign(document.createElement('img'), { src: assets(item.showcase), alt: '' });
}
const DOLL = 64; // the character's cell
const DOLL_PX = 3;

export interface EquipmentOptions {
  /** The window frame (the inventory's). */
  frame: { url: string; slice: number } | null;
  /** The slot art and its picked version (the inventory's nine-slice). */
  slot: { url: string; picked: string; slice: number } | null;
  /** The empty-slot silhouettes: one 16x16 frame per kind, in `frames` order. */
  silhouettes: { url: string; frames: string[] } | null;
  /** A class badge's URL (16 px). */
  badge: (cls: string) => string;
  /** Draws your character idling with its resting weapon into a 64x64 canvas (facing `dir`, idle frame `f`, `t` ms). */
  drawDoll: (ctx: CanvasRenderingContext2D, dir: Dir, f: number, t: number) => void;
  idle: { frames: number; fps: number };
  /** The bag's free slots, to say a full bag can't take a worn item back. */
  freeSlots: () => number;
}

export class EquipmentPanel {
  private readonly root = el('div');
  private readonly slots = new Map<EquipPlace, HTMLButtonElement>();
  private readonly doll = el('canvas', 'eq-doll');
  private readonly ctx = this.doll.getContext('2d')!;
  private readonly who = el('div', 'eq-who');
  private readonly stats = el('div', 'eq-stats');
  private readonly tip = el('div', 'eq-tip');
  private dir = DIRS.indexOf('se'); // index into DIRS: facing SE to start
  private raf = 0;
  private busy = false;

  constructor(private readonly o: EquipmentOptions) {
    silhouettes = o.silhouettes;
    this.root.id = 'equipment';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Equipment');
    if (o.frame) {
      this.root.classList.add('eq-framed');
      this.root.style.setProperty('--frame', `url("${o.frame.url}")`);
      this.root.style.setProperty('--slice', String(o.frame.slice));
    }
    if (o.slot) {
      this.root.style.setProperty('--slot', `url("${o.slot.url}")`);
      this.root.style.setProperty('--slot-picked', `url("${o.slot.picked}")`);
      this.root.style.setProperty('--slot-slice', String(o.slot.slice));
    }
    const head = el('div', 'eq-head');
    const close = el('button', 'eq-close', '×');
    close.setAttribute('aria-label', 'Close the bag and equipment');
    close.addEventListener('click', () => this.onClose());
    const toBag = el('button', 'eq-to-bag', 'Bag'); // phones: back to the bag in its place
    toBag.addEventListener('click', () => document.body.classList.remove('show-equipment'));
    head.append(el('span', 'eq-title', 'Equipment'), toBag, close);

    const column = (places: EquipPlace[], side: string) => {
      const col = el('div', `eq-col eq-${side}`);
      for (const p of places) col.append(this.slot(p));
      return col;
    };
    const middle = el('div', 'eq-middle');
    const stage = el('div', 'eq-stage');
    this.doll.width = this.doll.height = DOLL;
    this.doll.style.width = this.doll.style.height = `${DOLL * DOLL_PX}px`;
    const turn = (by: number) => {
      this.dir = (this.dir + by + DIRS.length) % DIRS.length;
    };
    // Dragging on the character turns it (one facing per 24 px).
    let dragX: number | null = null;
    this.doll.addEventListener('pointerdown', (e) => {
      dragX = e.clientX;
      this.doll.setPointerCapture(e.pointerId);
    });
    this.doll.addEventListener('pointermove', (e) => {
      if (dragX === null) return;
      const steps = Math.trunc((e.clientX - dragX) / 24);
      if (steps) {
        turn(-steps);
        dragX += steps * 24;
      }
    });
    this.doll.addEventListener('pointerup', () => (dragX = null));
    stage.append(el('span', 'eq-moon'), this.doll);
    const turns = el('div', 'eq-turns');
    turns.append(this.who);
    middle.append(stage, turns);
    const body = el('div', 'eq-body');
    body.append(column(LEFT, 'left'), middle, column(RIGHT, 'right'));
    this.tip.hidden = true;
    this.root.append(head, body, this.stats, this.tip);
    document.body.append(this.root);
    onAdventure((s) => this.render(s));
  }

  /** Called when the panel's × is pressed (the bag closes them both). */
  onClose: () => void = () => {};

  get open(): boolean {
    return !this.root.hidden;
  }

  show(on: boolean): void {
    this.root.hidden = !on;
    cancelAnimationFrame(this.raf);
    if (!on) return void (this.tip.hidden = true);
    const s = adventure();
    if (s) this.render(s);
    const start = performance.now();
    const tick = (now: number) => {
      const t = now - start;
      this.ctx.clearRect(0, 0, DOLL, DOLL);
      this.o.drawDoll(this.ctx, DIRS[this.dir], Math.floor((t / 1000) * this.o.idle.fps) % this.o.idle.frames, t);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Lines its top up with the bag's, on its left (as tall as its slots need, no taller). */
  fit(bag: DOMRect): void {
    if (matchMedia('(max-width: 900px)').matches) {
      for (const p of ['top', 'right']) this.root.style.removeProperty(p); // in the bag's place (CSS)
      return;
    }
    this.root.style.top = `${Math.round(bag.top)}px`;
    this.root.style.right = `${Math.round(innerWidth - bag.left + 10)}px`;
  }

  /** Wears an item from the combat bag (by uid): in `place` (a drop) or the first place for its kind (a double-click). */
  async wear(uid: string, place?: EquipPlace): Promise<void> {
    const it = adventure()?.bag.find((b) => b.uid === uid);
    const item = itemDef(it?.defId);
    if (!it || this.busy) return;
    if (!item) return void toast("That can't be worn.", 2200, 'bad');
    const target = place ?? placesFor(item.slot)[0];
    if (place && KIND[place] !== item.slot) return this.refuse(place, 'Wrong slot');
    if (it.broken) return this.refuse(target, "It's broken: repair it first");
    const cant = cantWear({ ...item, level: it.level }); // the server checks it too
    if (cant) return this.refuse(target, cant);
    this.busy = true;
    const r = await equipItem(uid, place);
    this.busy = false;
    if (!r?.ok) return this.refuse(target, r?.message?.replace(/\.$/, '') ?? "Couldn't reach the bot");
    playSound('click');
    window.dispatchEvent(new Event('mk-wallet')); // the bag reloads
  }

  private async takeOff(place: EquipPlace): Promise<void> {
    if (this.busy || !adventure()?.equipped[place]) return;
    if (this.o.freeSlots() < 1) return this.refuse(place, 'Your bag is full');
    this.busy = true;
    const r = await unequipPlace(place);
    this.busy = false;
    if (!r?.ok) return this.refuse(place, r?.message?.replace(/\.$/, '') ?? "Couldn't reach the bot");
    playSound('click');
    window.dispatchEvent(new Event('mk-wallet'));
  }

  /** A stat point into `stat`, or (null) all of them back. */
  private async points(stat: StatName | null): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const r = await (stat ? spendPoint(stat) : resetPoints());
    this.busy = false;
    if (!r?.ok) {
      playSound('error');
      return toast(r?.message?.replace(/\.$/, '') ?? "Couldn't reach the bot", 2200, 'bad');
    }
    playSound('click');
  }

  /** The place flashes warm orange and says why. */
  private refuse(place: EquipPlace, why: string): void {
    playSound('error');
    const b = this.slots.get(place);
    b?.classList.remove('eq-refused');
    void b?.offsetWidth; // restart the flash
    b?.classList.add('eq-refused');
    toast(why, 2200, 'bad');
  }

  private slot(place: EquipPlace): HTMLButtonElement {
    const b = el('button', 'eq-slot');
    b.dataset.place = place;
    b.addEventListener('dblclick', () => void this.takeOff(place));
    // While the forge popup is open, a click (or a drag) puts the worn item into it.
    b.addEventListener('click', () => {
      const worn = adventure()?.equipped[place];
      if (worn) forgeTake(worn.uid);
    });
    b.addEventListener('dragstart', (e) => {
      const worn = adventure()?.equipped[place];
      if (worn) e.dataTransfer?.setData('application/x-mk-worn', worn.uid);
    });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      void this.takeOff(place);
    });
    b.addEventListener('pointerenter', () => this.showTip(place, b));
    b.addEventListener('pointerleave', () => (this.tip.hidden = true));
    b.addEventListener('focus', () => this.showTip(place, b));
    b.addEventListener('blur', () => (this.tip.hidden = true));
    // Drops from the bag.
    b.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('application/x-mk-equipment')) return;
      e.preventDefault();
      b.classList.add('eq-over');
    });
    b.addEventListener('dragleave', () => b.classList.remove('eq-over'));
    b.addEventListener('drop', (e) => {
      b.classList.remove('eq-over');
      const id = e.dataTransfer?.getData('application/x-mk-equipment');
      if (!id) return;
      e.preventDefault();
      void this.wear(id, place);
    });
    this.slots.set(place, b);
    return b;
  }

  /** What a place is called for your gear type (Hard hat, Suit, Wraps…; Head before you have a class). */
  private placeName(place: EquipPlace): string {
    const kind = KIND[place];
    const gear = classInfo(adventure()?.cls)?.gear;
    return (gear && GEAR[gear]?.[kind]) ?? NAME[kind];
  }

  private showTip(place: EquipPlace, at: HTMLElement): void {
    const item = adventure()?.equipped[place];
    this.tip.replaceChildren(...(item ? itemTipFor(item) : [el('div', 'eq-tip-name', this.placeName(place))]));
    this.tip.hidden = false;
    const r = at.getBoundingClientRect();
    const box = this.root.getBoundingClientRect();
    const left = at.closest('.eq-left') ? r.right - box.left + 6 : r.left - box.left - 6;
    this.tip.style.top = `${Math.round(r.top - box.top + 8)}px`;
    this.tip.style.left = `${Math.round(left)}px`;
    this.tip.classList.toggle('eq-tip-left', !at.closest('.eq-left'));
  }

  private render(s: AdventureState): void {
    const sil = this.o.silhouettes;
    for (const [place, b] of this.slots) {
      const item = s.equipped[place];
      const kind = KIND[place];
      b.replaceChildren();
      b.classList.toggle('eq-worn', !!item);
      b.classList.toggle('eq-broken', !!item?.broken);
      b.draggable = !!item;
      b.setAttribute('aria-label', item ? `${this.placeName(place)}: ${nameOf(item)}` : `${this.placeName(place)} (empty)`);
      if (item) {
        b.style.setProperty('--rarity', RARITY_COLOUR[rarityOf(item)]);
        b.append(itemPicture(item, 'icon', 2));
      } else if (sil) {
        const icon = slotSilhouette(kind)!;
        icon.classList.add('eq-silhouette');
        b.append(icon);
      }
    }
    const c = classInfo(s.cls);
    this.who.replaceChildren();
    if (c) {
      const badge = el('img', 'eq-badge');
      badge.src = this.o.badge(c.id);
      badge.alt = '';
      this.who.append(badge, el('span', undefined, `${c.name} · Lv ${s.progress.level}`));
    } else this.who.append(el('span', 'eq-noclass', `No class yet · Lv ${s.progress.level}`));
    this.renderStats(s);
  }

  /** The stats box: ATK (Power), DEF, HP, MP | STR, DEX, INT, Crit, and your stat points. */
  private renderStats(s: AdventureState): void {
    const D = adventureData();
    const S = D?.stats;
    if (!D || !S) return void this.stats.replaceChildren();
    const p = s.progress;
    const st = derivedStats(S, s.cls, p.level, baseStats(S, s.cls, p.level, p.points), itemTotals(D, Object.values(s.equipped).filter((i) => !!i), myMainStat()));
    const plus = s.cls && p.statPoints > 0 ? pointStats(S, s.cls) : [];
    const row = (label: string, value: string, stat?: StatName) => {
      const r = el('div', 'eq-stat');
      const name = el('span', 'eq-stat-label', label);
      if (stat && plus.includes(stat)) {
        const add = el('button', 'eq-plus', '+');
        add.setAttribute('aria-label', `Put a stat point into ${stat}`);
        add.title = `Put a point into ${stat}`;
        add.addEventListener('click', () => void this.points(stat));
        name.append(add);
      }
      r.append(name, el('b', 'eq-stat-value', value));
      return r;
    };
    const left = el('div', 'eq-stats-col');
    left.append(row('ATK', String(st.power)), row('DEF', String(st.def)), row('HP', String(st.hp)), row('MP', String(st.mp)));
    const right = el('div', 'eq-stats-col');
    right.append(...STAT_NAMES.map((n) => row(n, String(st[n]), n)), row('Crit', `${+(st.critRate * 100).toFixed(1)}%`));
    const foot = el('div', 'eq-points');
    foot.append(el('span', 'eq-points-label', 'Points:'), el('b', 'eq-points-n', String(p.statPoints)));
    if (!s.cls) foot.append(el('span', 'eq-points-hint', 'Choose a class to spend points'));
    else {
      const reset = el('button', 'eq-reset', 'Reset');
      reset.title = 'Get every stat point back (free)';
      reset.disabled = !Object.values(p.points).some((n) => n);
      reset.addEventListener('click', () => void this.points(null));
      foot.append(reset);
    }
    this.stats.replaceChildren(left, right, foot);
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
