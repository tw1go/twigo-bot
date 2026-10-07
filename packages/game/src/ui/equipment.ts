import type { AdventureState, EquipPlace, EquipSlot, EquipmentDef } from '@mikazuki/shared';
import type { Dir } from '../assets/types';
import { playSound } from '../audio/sound';
import { statsFor } from '../combat/stats';
import { adventure, classInfo, equipItem, itemDef, onAdventure, placesFor, unequipPlace } from '../net/adventure';
import { type Rarity, RARITY_COLOUR, RARITY_TEXT, isRarity, itemArt } from './item-art';
import { toast } from './toast';

// 🛡️ The equipment panel, on the left of the bag (it opens and closes with it; I or B). Twelve places in the
// inventory's slot art: Weapon, Head, Body, Hands, Bottoms and Feet on the left; Necklace, Earrings, two Bracers and two
// Rings on the right. Empty ones show their grey silhouette (ui.equipSlots) and are named by your gear type on hover
// (combat-guide.md: Heavy, Light, Household); worn ones show the item's 16x16 icon in its rarity's colour. Your
// character idles in the middle (2×, with the resting weapon) over a faint crescent moon; ◀ ▶ or a drag turns it.
// Under it your class and level, and the stats box (combat/stats.ts: placeholders plus the worn items). Double-click
// or drag an item from the bag onto its place to wear it; right-click or double-click a worn one to take it off.

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
const DOLL = 64; // the character's cell
const DOLL_PX = 2;

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
  private dir = 0; // index into DIRS (S first)
  private raf = 0;
  private busy = false;

  constructor(private readonly o: EquipmentOptions) {
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
    const prev = el('button', 'eq-turn', '◀');
    const next = el('button', 'eq-turn', '▶');
    prev.setAttribute('aria-label', 'Turn left');
    next.setAttribute('aria-label', 'Turn right');
    prev.addEventListener('click', () => turn(-1));
    next.addEventListener('click', () => turn(1));
    // Dragging on the character turns it too (one facing per 24 px).
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
    turns.append(prev, this.who, next);
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

  /** Wears an item from the bag: in `place` (a drop) or the first place for its kind (a double-click). */
  async wear(id: string, place?: EquipPlace): Promise<void> {
    const item = itemDef(id);
    if (!item || this.busy) return;
    const target = place ?? placesFor(item.slot)[0];
    if (place && KIND[place] !== item.slot) return this.refuse(place, 'Wrong slot');
    const s = adventure();
    const cls = classInfo(s?.cls);
    if (item.class ? item.class !== s?.cls : item.gear ? item.gear !== cls?.gear : false) return this.refuse(target, "Your class can't use this");
    this.busy = true;
    const r = await equipItem(id, place);
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
    const item = itemDef(adventure()?.equipped[place]);
    this.tip.replaceChildren(...(item ? itemTip(item) : [el('div', 'eq-tip-name', this.placeName(place))]));
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
      const item = itemDef(s.equipped[place]);
      const kind = KIND[place];
      b.replaceChildren();
      b.classList.toggle('eq-worn', !!item);
      b.setAttribute('aria-label', item ? `${this.placeName(place)}: ${item.name}` : `${this.placeName(place)} (empty)`);
      if (item) {
        const rarity: Rarity = isRarity(item.rarity) ? item.rarity : 'common';
        b.style.setProperty('--rarity', RARITY_COLOUR[rarity]);
        b.append(itemArt(item.id, rarity, 'icon', 2, true) ?? el('span', 'eq-emoji', '⚔️'));
      } else if (sil) {
        const i = sil.frames.indexOf(kind);
        const icon = el('span', 'eq-silhouette');
        icon.style.backgroundImage = `url("${sil.url}")`;
        icon.style.backgroundSize = `${sil.frames.length * 32}px 32px`;
        icon.style.backgroundPosition = `-${Math.max(0, i) * 32}px 0`;
        b.append(icon);
      }
    }
    const c = classInfo(s.cls);
    this.who.replaceChildren();
    if (c) {
      const badge = el('img', 'eq-badge');
      badge.src = this.o.badge(c.id);
      badge.alt = '';
      this.who.append(badge, el('span', undefined, `${c.name} · Lv 1`));
    } else this.who.append(el('span', 'eq-noclass', 'No class yet'));
    const worn = Object.values(s.equipped).map((id) => itemDef(id)?.stats ?? {});
    const st = statsFor(s.cls, 1, worn);
    const row = (label: string, value: string) => {
      const r = el('div', 'eq-stat');
      r.append(el('span', 'eq-stat-label', label), el('b', 'eq-stat-value', value));
      return r;
    };
    const left = el('div', 'eq-stats-col');
    left.append(row('ATK', String(st.atk)), row('DEF', String(st.def)), row('HP', String(st.hp)), row('MP', String(st.mp)));
    const right = el('div', 'eq-stats-col');
    right.append(row('STR', String(st.str)), row('DEX', String(st.dex)), row('INT', String(st.int)), row('Crit', `${st.crit}%`));
    this.stats.replaceChildren(left, right);
  }
}

/** An item's tooltip: its name in its rarity's colour, Lv, who can use it, and its stats. */
export function itemTip(item: EquipmentDef): HTMLElement[] {
  const rarity: Rarity = isRarity(item.rarity) ? item.rarity : 'common';
  const name = el('div', 'eq-tip-name', item.name);
  name.style.color = RARITY_TEXT[rarity];
  const who = item.class ? (classInfo(item.class)?.name ?? item.class) : (item.gear ?? 'Anyone');
  const label = `${rarity[0].toUpperCase()}${rarity.slice(1)} · Lv ${item.level} · ${who}`;
  const stats = Object.entries(item.stats).map(([k, v]) => el('div', 'eq-tip-stat', `+${v} ${k === 'crit' ? 'Crit %' : k.toUpperCase()}`));
  const notes = item.starter ? [el('div', 'eq-tip-note', "Starter: can't be dropped, traded or sold")] : [];
  return [name, el('div', 'eq-tip-meta', label), ...stats, ...notes];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
