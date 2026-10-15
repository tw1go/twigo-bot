import { type LanternMap, isLanternMap } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { type QuestMarkArt, drawQuestMarks } from './quest-marks';
import { toast } from './toast';
import { type MapLayout, type SlumsPlaces, loadWorldMap, middleOf, worldPx } from './world-map';

// 🗺️ The Map menu (M anywhere; a Lantern Post's click): the Slums and the Town drawn together (manifest ui.mapWorld,
// placed by ui/map/map-layout.json), their names and places written over it from the maps themselves (the Slums' zones,
// the Golem Pit, the Camp, the way to the neighbourhood), and every Lantern Post as a teleporter icon. Opened from a
// post, another post's icon asks to teleport there (the Teleport box: one Return Lantern); opened anywhere else it's only
// to look at. Built like the Equipment panel: its frame, a title bar with ×, the UI font. The picture is drawn at a
// whole-number scale (2× where it fits, else 1×), its labels with it. Under the posts and labels, every active quest's
// hunting area in the quest's colour (ui/quest-marks.ts, the quest map's marks).

export interface MapMenuArt {
  /** URLs: the picture, the teleporter icon (3 frames: normal, hover, here), the pin, the Return Lantern's 16 px icon. */
  world: string;
  layout: string;
  teleporter: string;
  pin: string;
  lantern: string;
  frame: { url: string; slice: number } | null;
  /** The two maps' files (the labels come from them). */
  slums: string;
  town: string;
  /** The quest marks' art (the quest map's pins, the quests' colours). */
  marks?: QuestMarkArt;
}

export interface MapOpen {
  /** The map you're on (its post is "You are here"); null: neither (the neighbourhood, a Warrens run). */
  here: LanternMap | null;
  /** Opened from a Lantern Post: the other posts' icons teleport. */
  fromPost: boolean;
  /** How many Return Lanterns you hold (read again whenever it's shown). */
  lanterns: () => number;
  /** Teleport there (after the Teleport box's yes). */
  travel: (to: LanternMap) => void;
  onClose?: () => void;
}

/** What the Teleport box says of each map. */
const PLACE: Record<LanternMap, { name: string; post: string }> = {
  slums: { name: 'the Slums', post: 'Lantern Post, middle of the Slums' },
  town: { name: 'the Town', post: 'Lantern Post, on the fountain plaza' },
};
const FRAME = { normal: 0, hover: 1, here: 2 } as const;
const ICON_W = 15;

export class MapMenu {
  private readonly root = el('div');
  private readonly stage = el('div', 'mm-stage');
  private readonly foot = el('div', 'mm-foot-text');
  private readonly dim = el('div', 'mm-dim');
  private layout: MapLayout | null = null;
  private places: { slums: SlumsPlaces; townHood: [number, number] | null } | null = null;
  private o: MapOpen | null = null;
  private k = 2;

  constructor(private readonly art: MapMenuArt) {
    this.root.id = 'map-menu';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Map');
    if (art.frame) {
      this.root.classList.add('mm-framed');
      this.root.style.setProperty('--frame', `url("${art.frame.url}")`);
      this.root.style.setProperty('--slice', String(art.frame.slice));
    }
    const head = el('div', 'mm-head');
    const close = el('button', 'mm-close', '×');
    close.setAttribute('aria-label', 'Close the map');
    close.addEventListener('click', () => this.close());
    head.append(el('span', 'mm-title', 'Map'), close);
    const inset = el('div', 'mm-inset');
    inset.append(this.stage);
    const foot = el('div', 'mm-foot');
    const icon = el('img', 'mm-foot-icon');
    icon.src = art.lantern;
    icon.alt = '';
    foot.append(icon, this.foot);
    this.dim.hidden = true;
    this.root.append(head, inset, foot, this.dim);
    document.body.append(this.root);
    document.addEventListener('keydown', (e) => {
      if (this.root.hidden) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        return this.dim.hidden ? this.close() : this.closeConfirm();
      }
      if ((e.key === 'Enter' || e.key === 'NumpadEnter') && !this.dim.hidden) {
        e.preventDefault();
        e.stopPropagation();
        (this.dim.querySelector('.mm-go') as HTMLButtonElement | null)?.click();
      }
    }, true);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }
  /** Opened from a Lantern Post (not just to look). */
  get atPost(): boolean {
    return this.isOpen && !!this.o?.fromPost;
  }

  async open(o: MapOpen): Promise<void> {
    this.o = o;
    this.closeConfirm();
    this.k = innerWidth >= 960 && innerHeight >= 660 ? 2 : 1;
    this.root.style.setProperty('--k', String(this.k));
    this.root.hidden = false;
    await this.load();
    if (this.o !== o) return;
    this.draw();
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.closeConfirm();
    const done = this.o?.onClose;
    this.o = null;
    done?.();
  }

  /** The lantern count changed (items): the bar and an open Teleport box follow. */
  refresh(): void {
    if (this.root.hidden || !this.o) return;
    this.footText();
    const to = this.dim.dataset.to;
    if (!this.dim.hidden && isLanternMap(to)) this.confirm(to);
  }

  private async load(): Promise<void> {
    if (this.layout && this.places) return;
    const world = await loadWorldMap(this.art);
    if (!world) return;
    this.layout = world.layout;
    this.places = { slums: world.slums, townHood: middleOf(world.town.gates?.hood) };
  }

  /** A map's tile as a pixel of the picture (map-layout.json's formula). */
  private px(map: string, col: number, row: number): [number, number] | null {
    return this.layout ? worldPx(this.layout, map, col, row) : null;
  }

  private draw(): void {
    const L = this.layout;
    const k = this.k;
    this.stage.replaceChildren();
    const img = el('img', 'mm-world');
    img.src = this.art.world;
    img.alt = 'The Slums and the Town';
    img.draggable = false;
    this.stage.append(img);
    if (!L) return void this.footText();
    if (this.art.marks && this.places) drawQuestMarks(this.stage, { layout: L, slums: this.places.slums, town: {} }, k, this.art.marks);
    // Writing on the picture: centred on its pixel (`left`: starting there instead).
    const label = (text: string, at: [number, number] | null, cls: string, left = false) => {
      if (!at) return;
      const t = el('span', `mm-label ${cls}${left ? ' mm-left' : ''}`, text);
      t.style.left = `${at[0] * k}px`;
      t.style.top = `${at[1] * k}px`;
      this.stage.append(t);
    };
    const S = this.places?.slums ?? {};
    for (const z of S.mobZones ?? []) if (z.name) label(z.name, this.px('slums', (z.rect[0] + z.rect[2]) / 2, (z.rect[1] + z.rect[3]) / 2), 'mm-zone');
    if (S.boss?.tile) label('Golem Pit', this.px('slums', S.boss.tile[0], S.boss.tile[1]), 'mm-pit');
    if (S.safeZone) label('Camp', this.px('slums', (S.safeZone[0] + S.safeZone[2]) / 2, (S.safeZone[1] + S.safeZone[3]) / 2), 'mm-camp');
    const hood = this.places?.townHood;
    const gate = hood && this.px('town', hood[0], hood[1]);
    if (gate) label('Hood ›', [gate[0] + 4, gate[1]], 'mm-hood', true);
    for (const [id, m] of Object.entries(L.maps)) if (m.label) label(id === 'slums' ? 'Slums' : id === 'town' ? 'Town' : id, this.px(id, m.label[0], m.label[1]), 'mm-map');

    // The Lantern Posts: yours "You are here" with the pin; the others teleport (from a post).
    const [aw, ah] = L.icon.anchor;
    for (const [id, post] of Object.entries(L.posts)) {
      if (!isLanternMap(id)) continue;
      const [x, y] = post.px;
      const mine = id === this.o?.here;
      const icon = el('button', 'mm-post');
      icon.setAttribute('aria-label', mine ? 'Lantern Post: you are here' : `Lantern Post in ${PLACE[id].name}`);
      icon.style.left = `${(x - aw) * k}px`;
      icon.style.top = `${(y - ah) * k}px`;
      icon.style.backgroundImage = `url("${this.art.teleporter}")`;
      const frame = (f: keyof typeof FRAME) => (icon.style.backgroundPositionX = `${-FRAME[f] * ICON_W * k}px`);
      frame(mine ? 'here' : 'normal');
      this.stage.append(icon);
      if (mine) {
        const pin = el('img', 'mm-pin');
        pin.src = this.art.pin;
        pin.alt = '';
        pin.style.left = `${(x - 4) * k}px`;
        pin.style.top = `${(y - ah - 13) * k}px`;
        this.stage.append(pin);
        label('You are here', [x + 9, y - 7], 'mm-here', true);
        this.clearOf(this.stage.lastElementChild as HTMLElement, (x - 9) * k);
        continue;
      }
      const tag = el('span', 'mm-label mm-post-tag', 'Lantern Post');
      tag.style.left = `${x * k}px`;
      tag.style.top = `${(y - ah - 5) * k}px`;
      tag.hidden = true;
      this.stage.append(tag);
      icon.addEventListener('pointerenter', () => {
        frame('hover');
        tag.hidden = false;
      });
      icon.addEventListener('pointerleave', () => {
        frame('normal');
        tag.hidden = true;
      });
      icon.addEventListener('focus', () => icon.dispatchEvent(new PointerEvent('pointerenter')));
      icon.addEventListener('blur', () => icon.dispatchEvent(new PointerEvent('pointerleave')));
      icon.addEventListener('click', () => {
        if (!this.o?.fromPost) {
          playSound('error');
          return toast('Go to a Lantern Post to travel.', 2400);
        }
        this.confirm(id);
      });
    }
    this.footText();
  }

  /** A label written right of its spot that runs into another: written left of it instead, ending at `right`. */
  private clearOf(t: HTMLElement, right: number): void {
    const box = t.getBoundingClientRect();
    const hits = (b: DOMRect) => !(b.right < box.left || b.left > box.right || b.bottom < box.top || b.top > box.bottom);
    if (![...this.stage.querySelectorAll<HTMLElement>('.mm-label')].some((o) => o !== t && !o.hidden && hits(o.getBoundingClientRect()))) return;
    t.classList.remove('mm-left');
    t.classList.add('mm-right');
    t.style.left = `${right}px`;
  }

  private footText(): void {
    const n = this.o?.lanterns() ?? 0;
    this.foot.textContent = `Click a Lantern Post to travel · Return Lanterns: ${n.toLocaleString()}`;
  }

  /** The Teleport box over the dimmed map: where to, what it costs, Cancel / Teleport. */
  private confirm(to: LanternMap): void {
    const n = this.o?.lanterns() ?? 0;
    const box = el('div', 'mm-confirm');
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-label', 'Teleport');
    if (this.art.frame) {
      box.classList.add('mm-framed');
      box.style.setProperty('--frame', `url("${this.art.frame.url}")`);
      box.style.setProperty('--slice', String(this.art.frame.slice));
    }
    const head = el('div', 'mm-head');
    const x = el('button', 'mm-close', '×');
    x.setAttribute('aria-label', 'Cancel');
    x.addEventListener('click', () => this.closeConfirm());
    head.append(el('span', 'mm-title', 'Teleport'), x);
    const where = el('div', 'mm-where');
    const icon = el('span', 'mm-where-icon');
    icon.style.backgroundImage = `url("${this.art.teleporter}")`;
    icon.style.backgroundPositionX = `${-FRAME.hover * ICON_W * 2}px`;
    const words = el('div');
    words.append(el('div', 'mm-where-name', `Travel to ${PLACE[to].name}?`), el('div', 'mm-where-post', PLACE[to].post));
    where.append(icon, words);
    const cost = el('div', `mm-cost${n < 1 ? ' mm-cost-none' : ''}`);
    const lantern = el('img', 'mm-cost-icon');
    lantern.src = this.art.lantern;
    lantern.alt = '';
    cost.append(lantern, el('span', '', n < 1 ? 'You need a Return Lantern' : `Uses 1 Return Lantern (you have ${n.toLocaleString()})`));
    const buttons = el('div', 'mm-buttons');
    const cancel = el('button', 'mm-cancel', 'Cancel');
    cancel.addEventListener('click', () => this.closeConfirm());
    const go = el('button', 'mm-go', 'Teleport');
    go.disabled = n < 1;
    go.addEventListener('click', () => {
      if (go.disabled || !this.o) return;
      const travel = this.o.travel;
      this.close();
      travel(to);
    });
    buttons.append(cancel, go);
    box.append(head, where, el('div', 'mm-rule'), cost, buttons);
    this.dim.dataset.to = to;
    this.dim.replaceChildren(box);
    this.dim.hidden = false;
    (go.disabled ? cancel : go).focus();
  }

  private closeConfirm(): void {
    this.dim.hidden = true;
    this.dim.replaceChildren();
    delete this.dim.dataset.to;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
