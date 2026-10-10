import { type EquipPlace, type EquipSlot, type InspectStats, type Item, type TownPlayer } from '@mikazuki/shared';
import type { Dir } from '../assets/types';
import { playSound } from '../audio/sound';
import { classInfo } from '../net/adventure';
import { RARITY_COLOUR } from './item-art';
import { itemPicture, itemTipFor, rarityOf } from './item-tip';
import { slotSilhouette } from './equipment';

// 🔍 Someone else's character (the player menu's Info, ui/target.ts): a window like your equipment panel, in the middle
// of the screen: their name and title, their character idling (a drag turns it) with its resting weapon, their class
// and level, the twelve places with what they wear (hover: its tooltip, named for their class) and their stats (ATK,
// DEF, HP, MP, STR, DEX, INT, Crit, buffs included). Read only. The gear and stats come from the server (`inspect`);
// the look is the one the town already drew for them. Esc, × or a click outside closes it.

const LEFT: EquipPlace[] = ['weapon', 'head', 'body', 'hands', 'bottoms', 'feet'];
const RIGHT: EquipPlace[] = ['necklace', 'earrings', 'bracers1', 'bracers2', 'ring1', 'ring2'];
const KIND: Record<EquipPlace, EquipSlot> = {
  weapon: 'weapon', head: 'head', body: 'body', hands: 'hands', bottoms: 'bottoms', feet: 'feet', necklace: 'necklace', earrings: 'earrings',
  bracers1: 'bracers', bracers2: 'bracers', ring1: 'ring', ring2: 'ring',
};
const NAME: Record<EquipSlot, string> = {
  weapon: 'Weapon', head: 'Head', body: 'Body', hands: 'Hands', bottoms: 'Bottoms', feet: 'Feet', necklace: 'Necklace', earrings: 'Earrings', bracers: 'Bracers', ring: 'Ring',
};
const DIRS: Dir[] = ['s', 'sw', 'w', 'nw', 'n', 'ne', 'e', 'se'];
const DOLL = 64;
const DOLL_PX = 3;

export interface InspectOptions {
  frame: { url: string; slice: number } | null;
  slot: { url: string; picked: string; slice: number } | null;
  badge: (cls: string) => string;
  /** Draws someone's character idling with its resting weapon (false: their look isn't loaded). */
  drawDoll: (id: string, ctx: CanvasRenderingContext2D, dir: Dir, f: number, t: number) => boolean;
  idle: { frames: number; fps: number };
  /** Asks the server for their gear and stats (false: no connection). */
  ask: (id: string) => boolean;
}

export class InspectWindow {
  private readonly root = el('div');
  private readonly title = el('span', 'eq-title');
  private readonly tag = el('span', 'in-title');
  private readonly slots = new Map<EquipPlace, HTMLButtonElement>();
  private readonly doll = el('canvas', 'eq-doll');
  private readonly ctx = this.doll.getContext('2d')!;
  private readonly who = el('div', 'eq-who');
  private readonly stats = el('div', 'eq-stats');
  private readonly tip = el('div', 'eq-tip');
  private dir = DIRS.indexOf('se');
  private raf = 0;
  private player: TownPlayer | null = null;
  private equipped: Partial<Record<EquipPlace, Item>> = {};
  private cls: string | null = null;

  constructor(private readonly o: InspectOptions) {
    this.root.id = 'inspect';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
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
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.close());
    head.append(this.title, this.tag, close);
    const column = (places: EquipPlace[], side: string) => {
      const col = el('div', `eq-col eq-${side}`);
      for (const p of places) col.append(this.slot(p));
      return col;
    };
    const middle = el('div', 'eq-middle');
    const stage = el('div', 'eq-stage');
    this.doll.width = this.doll.height = DOLL;
    this.doll.style.width = this.doll.style.height = `${DOLL * DOLL_PX}px`;
    // Dragging on the character turns it (one facing per 24 px).
    let dragX: number | null = null;
    this.doll.addEventListener('pointerdown', (e) => {
      dragX = e.clientX;
      this.doll.setPointerCapture(e.pointerId);
    });
    this.doll.addEventListener('pointermove', (e) => {
      if (dragX === null) return;
      const steps = Math.trunc((e.clientX - dragX) / 24);
      if (!steps) return;
      this.dir = (this.dir - steps + DIRS.length * 8) % DIRS.length;
      dragX += steps * 24;
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
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.root.hidden) this.close();
    });
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as Element;
      if (!this.root.hidden && !this.root.contains(t) && !t.closest?.('#target')) this.close();
    }, true);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /** Opens it for someone: their look at once, their gear and stats when the server answers. */
  show(p: TownPlayer): void {
    this.player = p;
    this.equipped = {};
    this.cls = p.cls ?? null;
    this.title.textContent = p.nickname;
    this.tag.textContent = `<${p.title.name}>`;
    this.tag.className = 'in-title';
    this.tag.style.color = '';
    if (p.title.color === 'prismatic') this.tag.classList.add('prismatic');
    else this.tag.style.color = p.title.color;
    this.root.setAttribute('aria-label', `${p.nickname}'s character`);
    this.renderSlots();
    this.renderWho(p.level ?? 1);
    this.stats.replaceChildren(el('div', 'in-wait', this.o.ask(p.id) ? 'Looking…' : "Couldn't reach the town"));
    this.stats.style.gridTemplateColumns = '1fr';
    this.dir = DIRS.indexOf('se');
    this.root.hidden = false;
    playSound('click');
    cancelAnimationFrame(this.raf);
    const start = performance.now();
    const tick = (now: number) => {
      if (this.root.hidden || !this.player) return;
      const t = now - start;
      this.ctx.clearRect(0, 0, DOLL, DOLL);
      this.o.drawDoll(this.player.id, this.ctx, DIRS[this.dir], Math.floor((t / 1000) * this.o.idle.fps) % this.o.idle.frames, t);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** The server's answer (only for the one shown). */
  answer(m: { id: string; gone?: boolean; cls?: string | null; level?: number; equipped?: Partial<Record<EquipPlace, Item>>; stats?: InspectStats | null }): void {
    if (this.root.hidden || m.id !== this.player?.id) return;
    if (m.gone) return void this.stats.replaceChildren(el('div', 'in-wait', 'They left.'));
    this.cls = m.cls ?? null;
    this.equipped = m.equipped ?? {};
    this.renderSlots();
    this.renderWho(m.level ?? 1);
    this.renderStats(m.stats ?? null);
  }

  /** They left town: closed. */
  check(here: (id: string) => boolean): void {
    if (this.player && !this.root.hidden && !here(this.player.id)) this.close();
  }

  close(): void {
    this.root.hidden = true;
    this.tip.hidden = true;
    this.player = null;
    cancelAnimationFrame(this.raf);
  }

  private slot(place: EquipPlace): HTMLButtonElement {
    const b = el('button', 'eq-slot');
    b.dataset.place = place;
    b.addEventListener('pointerenter', () => this.showTip(place, b));
    b.addEventListener('pointerleave', () => (this.tip.hidden = true));
    b.addEventListener('focus', () => this.showTip(place, b));
    b.addEventListener('blur', () => (this.tip.hidden = true));
    this.slots.set(place, b);
    return b;
  }

  private showTip(place: EquipPlace, at: HTMLElement): void {
    const item = this.equipped[place];
    this.tip.replaceChildren(...(item ? itemTipFor(item, { cls: this.cls }) : [el('div', 'eq-tip-name', NAME[KIND[place]])]));
    this.tip.hidden = false;
    const r = at.getBoundingClientRect();
    const box = this.root.getBoundingClientRect();
    const left = at.closest('.eq-left') ? r.right - box.left + 6 : r.left - box.left - 6;
    this.tip.style.top = `${Math.round(r.top - box.top + 8)}px`;
    this.tip.style.left = `${Math.round(left)}px`;
    this.tip.classList.toggle('eq-tip-left', !at.closest('.eq-left'));
  }

  private renderSlots(): void {
    for (const [place, b] of this.slots) {
      const item = this.equipped[place];
      b.replaceChildren();
      b.classList.toggle('eq-worn', !!item);
      b.classList.toggle('eq-broken', !!item?.broken);
      b.setAttribute('aria-label', item ? `${NAME[KIND[place]]}: worn` : `${NAME[KIND[place]]} (empty)`);
      if (item) {
        b.style.setProperty('--rarity', RARITY_COLOUR[rarityOf(item)]);
        b.append(itemPicture(item, 'icon', 2));
      } else {
        const icon = slotSilhouette(KIND[place]);
        if (icon) b.append(Object.assign(icon, { className: `${icon.className} eq-silhouette` }));
      }
    }
  }

  private renderWho(level: number): void {
    const c = classInfo(this.cls);
    this.who.replaceChildren();
    if (!c) return void this.who.append(el('span', 'eq-noclass', `No class yet · Lv ${level}`));
    const badge = el('img', 'eq-badge');
    badge.src = this.o.badge(c.id);
    badge.alt = '';
    this.who.append(badge, el('span', undefined, `${c.name} · Lv ${level}`));
  }

  private renderStats(st: InspectStats | null): void {
    this.stats.style.gridTemplateColumns = '';
    if (!st) return void this.stats.replaceChildren();
    const row = (label: string, value: string) => {
      const r = el('div', 'eq-stat');
      r.append(el('span', 'eq-stat-label', label), el('b', 'eq-stat-value', value));
      return r;
    };
    const left = el('div', 'eq-stats-col');
    left.append(row('ATK', String(Math.round(st.power))), row('DEF', String(Math.round(st.def))), row('HP', String(Math.round(st.hp))), row('MP', String(Math.round(st.mp))));
    const right = el('div', 'eq-stats-col');
    right.append(row('STR', String(st.STR)), row('DEX', String(st.DEX)), row('INT', String(st.INT)), row('Crit', `${+(st.critRate * 100).toFixed(1)}%`));
    // Their combat rating on top (the server's, buffs and all), as in your own stats box.
    const cp = el('div', 'eq-cp');
    cp.append(el('span', 'eq-cp-label', 'Combat rating'), el('b', 'eq-cp-value', st.cp.toLocaleString()));
    this.stats.replaceChildren(cp, left, right);
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
