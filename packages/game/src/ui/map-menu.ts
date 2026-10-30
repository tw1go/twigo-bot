import { type LanternMap, type LanternMapData, type LanternPost, NOT_RESTORED, isLanternMap, lanternPostsOf } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { type QuestMarkArt, drawQuestMarks } from './quest-marks';
import { toast } from './toast';
import type { MapDungeonIcon } from '../assets/types';
import { type MapLayout, type SlumsPlaces, loadPlaces, loadWorldMap, middleOf, postsOf, shifted, worldPoint, worldPx } from './world-map';

// 🗺️ The Map menu (M anywhere; a Lantern Post's click): a tab per map (Town, Slums, Old Market), each its map alone, cut
// from the world picture (manifest ui.mapWorld, placed by ui/map/map-layout.json; the Old Market drawn in since 23 Oct
// 2026) to its own diamond and drawn at the largest whole-number scale that fits (3× at most), opening on the map you're
// in. Over it, its names and places from the map itself (the Slums' zones, the Golem Pit, the Camp; the Old Market's
// sections; the way to the neighbourhood), every Lantern Post as a teleporter icon (the Old Market has four) and its
// dungeon entrance (the Warren Gate, the Cellar Hatch: shared travel.ts DUNGEON_ENTRANCES) as a small picture of it,
// its gold glow pulsing (manifest ui.mapDungeons; lit up on hover; held still under reduced motion). Opened from
// a post, another post's icon or an entrance asks to teleport there (the Teleport box: one Return Lantern; another post
// of the same map too); opened anywhere else it's only to look at. Built like the Equipment
// panel: its frame, a title bar with ×, the UI font. Under the posts and labels, every active quest's hunting area in
// the quest's colour (ui/quest-marks.ts, the quest map's marks).

export interface MapMenuArt {
  /** URLs: the picture, the teleporter icon (3 frames: normal, hover, here), the pin, the Return Lantern's 16 px icon. */
  world: string;
  /** The picture's size (manifest ui.mapWorld.size). */
  size?: [number, number];
  layout: string;
  teleporter: string;
  /** A Lantern Post not restored yet (2 frames: normal, hover). */
  teleporterBroken?: string;
  pin: string;
  lantern: string;
  frame: { url: string; slice: number } | null;
  /** The maps' files (the labels and the dungeon entrances come from them). */
  slums: string;
  town: string;
  palengke: string;
  /** The quest marks' art (the quest map's pins, the quests' colours). */
  marks?: QuestMarkArt;
  /** The dungeon entrances' icons by entrance id (manifest ui.mapDungeons, `url` its sheet); one without: a diamond. */
  dungeons?: Record<string, MapDungeonIcon & { url: string }>;
}

export interface MapOpen {
  /** The map you're on, the post you're at (-1: none) and your tile: "You are here" on that post, else on your own spot
   *  (the Old Market is big: its nearest post could be far from you); null: none (the neighbourhood, a run). */
  here: { map: LanternMap; post: number; tile: [number, number] } | null;
  /** Opened from a Lantern Post: the other posts' icons teleport. */
  fromPost: boolean;
  /** How many Return Lanterns you hold (read again whenever it's shown). */
  lanterns: () => number;
  /** Teleport there (after the Teleport box's yes): a map and its post (a dungeon entrance: its place after the posts). */
  travel: (to: LanternMap, post: number) => void;
  /** The posts and dungeon entrances you've restored (CONTEXT.md Restored Lantern Post; shared postKey); the rest show
   *  broken and take you nowhere. Null: every one works. */
  restored?: ReadonlySet<string> | null;
  onClose?: () => void;
}

/** The tabs, in order. */
const TABS: { map: LanternMap; name: string }[] = [
  { map: 'town', name: 'Town' },
  { map: 'slums', name: 'Slums' },
  { map: 'palengke', name: 'Old Market' },
];
/** What the Teleport box says of each map. */
const PLACE: Record<LanternMap, { name: string; post: string }> = {
  slums: { name: 'the Slums', post: 'Lantern Post, middle of the Slums' },
  town: { name: 'the Town', post: 'Lantern Post, on the fountain plaza' },
  palengke: { name: 'the Old Market', post: 'Lantern Post' },
};
/** What the Teleport box says of each dungeon entrance. */
const ENTRANCE: Record<string, string> = {
  warrens: 'In the Slums, by the way into the Scrap Warrens',
  silong: "In the Old Market's Market Hall, by the way down into the Cellar",
};
/** What the picture writes for a map's name. */
const MAP_NAME: Record<string, string> = { slums: 'Slums', town: 'Town', palengke: 'Old Market' };
/** The picture's own size (ui-map-world.png) when the manifest doesn't say. */
const PICTURE: [number, number] = [534, 279];
const FRAME = { normal: 0, hover: 1, here: 2 } as const;
const ICON_W = 15;
/** Room round a map's diamond in its tab (the picture's px). */
const PAD = 8;
/** The scale the biggest tab is drawn at, at most (the frame every tab shares is its size). */
const MAX_K = 3;
/** The largest a smaller tab (the Town) is drawn, filling the frame. */
const FILL_K = 6;
/** Icons and writing are drawn at the tab's scale, but never bigger than this. */
const ICON_K = 3;

/** What the Old Market's map says that its tab uses. */
interface PalengkePlaces extends LanternMapData {
  sections?: { name?: string; rect: [number, number, number, number] }[];
}

export class MapMenu {
  private readonly root = el('div');
  private readonly tabs = el('div', 'mm-tabs');
  private readonly stage = el('div', 'mm-stage');
  private readonly foot = el('div', 'mm-foot-text');
  private readonly dim = el('div', 'mm-dim');
  private layout: MapLayout | null = null;
  private places: { slums: SlumsPlaces; townHood: [number, number] | null; files: Partial<Record<LanternMap, LanternMapData>>; palengke: PalengkePlaces | null } | null = null;
  private o: MapOpen | null = null;
  private k = 2;
  /** The tab showing. */
  private tab: LanternMap = 'town';

  constructor(private readonly art: MapMenuArt) {
    this.root.id = 'map-menu';
    this.root.hidden = true;
    const [pw, ph] = art.size ?? PICTURE;
    this.root.style.setProperty('--pw', String(pw));
    this.root.style.setProperty('--ph', String(ph));
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
    this.tabs.setAttribute('role', 'tablist');
    for (const t of TABS) {
      const b = el('button', 'mm-tab', t.name);
      b.setAttribute('role', 'tab');
      b.dataset.map = t.map;
      b.addEventListener('click', () => {
        if (this.tab === t.map) return;
        playSound('click');
        this.tab = t.map;
        this.closeConfirm();
        this.draw();
      });
      this.tabs.append(b);
    }
    const inset = el('div', 'mm-inset');
    inset.append(this.stage);
    this.dragToScroll(inset);
    const foot = el('div', 'mm-foot');
    const icon = el('img', 'mm-foot-icon');
    icon.src = art.lantern;
    icon.alt = '';
    foot.append(icon, this.foot);
    this.dim.hidden = true;
    this.root.append(head, this.tabs, inset, foot, this.dim);
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
    if (o.here) this.tab = o.here.map; // (the map you're in; elsewhere the tab last shown)
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
    if (!this.dim.hidden && isLanternMap(to)) this.confirm(to, Number(this.dim.dataset.post ?? 0));
  }

  private async load(): Promise<void> {
    if (this.layout && this.places) return;
    const [world, palengke] = await Promise.all([loadWorldMap(this.art), loadPlaces<PalengkePlaces>(this.art.palengke)]);
    if (!world) return;
    this.layout = world.layout;
    this.places = {
      slums: world.slums,
      townHood: middleOf(world.town.gates?.hood),
      files: { slums: world.slums as LanternMapData, town: world.town as LanternMapData, ...(palengke ? { palengke } : {}) },
      palengke,
    };
  }

  /** A map's box on the picture: its diamond (and its name's spot), with PAD round it. */
  private boxOf(L: MapLayout, map: string): [number, number, number, number] {
    const m = L.maps[map];
    const pts = [[0, 0], [m.size[0], 0], [m.size[0], m.size[1]], [0, m.size[1]], ...(m.label ? [m.label] : [])].map(([c, r]) => worldPoint(L, map, c, r)!);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return [Math.floor(Math.min(...xs) - PAD), Math.floor(Math.min(...ys) - PAD), Math.ceil(Math.max(...xs) + PAD), Math.ceil(Math.max(...ys) + PAD)];
  }

  /** The scale a box of w × h is drawn at: the largest whole number that fits the screen, MAX_K at most. */
  private scaleOf(w: number, h: number): number {
    return Math.max(1, Math.min(MAX_K, Math.floor(Math.min((innerWidth - 80) / w, (innerHeight - 280) / h))));
  }

  private draw(): void {
    this.stage.replaceChildren();
    for (const b of this.tabs.children) b.setAttribute('aria-selected', String((b as HTMLElement).dataset.map === this.tab));
    const layout = this.layout;
    if (!layout || !layout.maps[this.tab]) return void this.footText();
    // Every tab in a box of the same size (the biggest of them), so the menu keeps its size between tabs.
    const boxes = TABS.filter((t) => layout.maps[t.map]).map((t) => {
      const [x0, y0, x1, y1] = this.boxOf(layout, t.map);
      return { map: t.map, x0, y0, w: x1 - x0, h: y1 - y0 };
    });
    const [W, H] = [Math.max(...boxes.map((b) => b.w * this.scaleOf(b.w, b.h))), Math.max(...boxes.map((b) => b.h * this.scaleOf(b.w, b.h)))];
    // This tab as big as fills the frame (a whole-number scale), its icons and writing at ICON_K at most.
    const b = boxes.find((x) => x.map === this.tab)!;
    const k = (this.k = Math.max(1, Math.min(FILL_K, Math.floor(Math.min(W / b.w, H / b.h)))));
    const ik = Math.min(k, ICON_K);
    const v = { ...b, w: b.w * k, h: b.h * k };
    this.root.style.setProperty('--k', String(k));
    this.root.style.setProperty('--ik', String(ik));
    this.stage.style.width = `${W}px`;
    this.stage.style.height = `${H}px`;
    // This map alone: the picture (or its plain diamond) kept to its diamond, the box centred in the stage.
    const view = el('div', 'mm-view');
    view.style.left = `${Math.round((W - v.w) / 2)}px`;
    view.style.top = `${Math.round((H - v.h) / 2)}px`;
    view.style.width = `${v.w}px`;
    view.style.height = `${v.h}px`;
    this.stage.append(view);
    const L = shifted(layout, -v.x0, -v.y0);
    const m = L.maps[this.tab];
    const diamond = [[0, 0], [m.size[0], 0], [m.size[0], m.size[1]], [0, m.size[1]]].map(([c, r]) => worldPoint(L, this.tab, c, r)!);
    const clip = el('div', 'mm-clip');
    clip.style.clipPath = `polygon(${diamond.map(([x, y]) => `${x * k}px ${y * k}px`).join(', ')})`;
    view.append(clip);
    const img = el('img', 'mm-world');
    img.src = this.art.world;
    img.alt = `The ${MAP_NAME[this.tab] ?? this.tab}`;
    img.draggable = false;
    img.style.left = `${-v.x0 * k}px`;
    img.style.top = `${-v.y0 * k}px`;
    clip.append(img);
    if (this.art.marks && this.places) drawQuestMarks(clip, { layout: L, slums: this.places.slums, town: {}, ...(this.places.palengke ? { palengke: this.places.palengke as SlumsPlaces } : {}) }, k, this.art.marks, ik);
    const px = (col: number, row: number) => worldPx(L, this.tab, col, row);
    // Writing on the picture: centred on its pixel (`left`: starting there instead), `dx`, `dy` more (icon px).
    const label = (text: string, at: [number, number] | null, cls: string, left = false, dx = 0, dy = 0) => {
      if (!at) return;
      const t = el('span', `mm-label ${cls}${left ? ' mm-left' : ''}`, text);
      t.style.left = `${at[0] * k + dx * ik}px`;
      t.style.top = `${at[1] * k + dy * ik}px`;
      view.append(t);
      return t;
    };
    const mid = (r: [number, number, number, number]) => px((r[0] + r[2]) / 2, (r[1] + r[3]) / 2);
    if (this.tab === 'slums') {
      const S = this.places?.slums ?? {};
      for (const z of S.mobZones ?? []) if (z.name) label(z.name, mid(z.rect), 'mm-zone');
      if (S.boss?.tile) label('Golem Pit', px(S.boss.tile[0], S.boss.tile[1]), 'mm-pit');
      if (S.safeZone) label('Camp', mid(S.safeZone), 'mm-camp');
    } else if (this.tab === 'town') {
      const hood = this.places?.townHood;
      const gate = hood && px(hood[0], hood[1]);
      if (gate) label('Hood ›', gate, 'mm-hood', true, 4);
    } else {
      // (A section's name under a post that stands on it: moved down clear of the icon.)
      const posts = postsOf(L, this.tab).map((p) => p.at).filter((p): p is [number, number] => !!p);
      for (const s of this.places?.palengke?.sections ?? []) {
        const at = s.name ? mid(s.rect) : null;
        if (!at) continue;
        const near = posts.some(([x, y]) => Math.abs(x - at[0]) * k < 40 * ik && Math.abs(y - at[1]) * k < 14 * ik);
        label(s.name!, at, 'mm-zone', false, 0, near ? 14 : 0);
      }
    }
    if (m.label) label(MAP_NAME[this.tab] ?? this.tab, worldPx(L, this.tab, m.label[0], m.label[1]), 'mm-map');

    // The Lantern Posts: yours "You are here" with the pin; the others teleport (from a post). Then the dungeon entrance.
    const [aw, ah] = L.icon.anchor;
    const id = this.tab;
    const posts = postsOf(L, id);
    posts.forEach((post, index) => {
      if (!post.at) return;
      const [x, y] = post.at;
      const mine = id === this.o?.here?.map && index === this.o.here.post;
      const where = post.name ? `${PLACE[id].name} (${post.name})` : PLACE[id].name;
      // (Not restored yet: its broken icon, and it takes you nowhere: CONTEXT.md Restored Lantern Post.)
      const broken = !mine && !!this.o?.restored && !this.o.restored.has(`${id}:${index}`);
      const icon = el('button', 'mm-post');
      icon.setAttribute('aria-label', mine ? 'Lantern Post: you are here' : `Lantern Post in ${where}${broken ? ': not restored yet' : ''}`);
      icon.style.left = `${x * k - aw * ik}px`;
      icon.style.top = `${y * k - ah * ik}px`;
      icon.style.backgroundImage = `url("${broken && this.art.teleporterBroken ? this.art.teleporterBroken : this.art.teleporter}")`;
      const frame = (f: keyof typeof FRAME) => (icon.style.backgroundPositionX = `${-FRAME[f] * ICON_W * ik}px`);
      frame(mine ? 'here' : 'normal');
      view.append(icon);
      if (mine) {
        const pin = el('img', 'mm-pin');
        pin.src = this.art.pin;
        pin.alt = '';
        pin.style.left = `${x * k - 4 * ik}px`;
        pin.style.top = `${y * k - (ah + 13) * ik}px`;
        view.append(pin);
        const here = label('You are here', [x, y], 'mm-here', true, 9, -7);
        if (here) this.clearOf(view, here, x * k - 9 * ik);
        return;
      }
      const tag = el('span', 'mm-label mm-post-tag', `${post.name ? `Lantern Post · ${post.name}` : 'Lantern Post'}${broken ? ' · not restored yet' : ''}`);
      tag.style.left = `${x * k}px`;
      tag.style.top = `${y * k - (ah + 5) * ik}px`;
      tag.hidden = true;
      view.append(tag);
      this.hoverable(icon, tag, frame);
      icon.addEventListener('click', () => (broken ? this.notRestored() : this.pick(id, index)));
    });
    // Not at a post: the pin on your own spot (the map's formula: map-layout.json).
    const me = this.o?.here;
    if (me && me.map === id && me.post < 0) {
      const at = worldPx(L, id, me.tile[0], me.tile[1]);
      if (at) {
        const [x, y] = at;
        const pin = el('img', 'mm-pin');
        pin.src = this.art.pin;
        pin.alt = '';
        pin.style.left = `${x * k - 4 * ik}px`;
        pin.style.top = `${y * k - 13 * ik}px`;
        view.append(pin);
        const here = label('You are here', [x, y], 'mm-here', true, 9, -7);
        if (here) this.clearOf(view, here, x * k - 9 * ik);
      }
    }
    // Its dungeon entrance (after the posts in the map's list: their place is the post number a teleport takes).
    const file = this.places?.files[id];
    (file ? lanternPostsOf(file) : []).forEach((e: LanternPost, index) => {
      if (!e.entrance) return;
      const at = px(e.tile[0] + 1, e.tile[1] + 1);
      if (!at) return;
      const gate = el('button', 'mm-gate');
      // (Not reached on foot yet: still and dim, nothing to click: CONTEXT.md Restored Lantern Post.)
      const off = !!this.o?.restored && !!e.entrance && !this.o.restored.has(`${id}:${e.entrance}`);
      gate.setAttribute('aria-label', off ? `${e.name}: not restored yet` : `${e.name}: teleport there`);
      if (off) {
        gate.classList.add('mm-gate-off');
        gate.disabled = true;
      }
      // Its own art (the sheet at the icons' scale, its foot on the entrance's point), its name under its foot; an
      // entrance without art: the old gold diamond centred there.
      const art = e.entrance ? this.art.dungeons?.[e.entrance] : undefined;
      let below = 7;
      if (art) {
        const [fw, fh] = art.frame;
        gate.classList.add('mm-gate-art');
        gate.style.backgroundImage = `url("${art.url}")`;
        gate.style.backgroundSize = `${fw * art.frames * ik}px ${fh * ik}px`;
        gate.style.setProperty('--fw', `${fw * ik}px`);
        gate.style.width = `${fw * ik}px`;
        gate.style.height = `${fh * ik}px`;
        gate.style.left = `${at[0] * k - art.anchor[0] * ik}px`;
        gate.style.top = `${at[1] * k - art.anchor[1] * ik}px`;
        below = fh - art.anchor[1] + 5;
      } else {
        gate.style.left = `${at[0] * k}px`;
        gate.style.top = `${at[1] * k}px`;
      }
      view.append(gate);
      label(`${e.name ?? 'Dungeon'}${off ? ' · not restored yet' : ''}`, at, `mm-gate-tag${off ? ' mm-off' : ''}`, false, 0, below);
      if (!off) gate.addEventListener('click', () => this.pick(id, index));
    });
    this.footText();
  }

  /** The map scrolled by dragging it (no scrollbars: index.html hides them), when it's bigger than its box: a press
   *  that moves more than DRAG_PX is a drag (the click after it, on a post or an entrance, is swallowed); less, a click. */
  private dragToScroll(box: HTMLElement): void {
    const DRAG_PX = 4;
    let from: { x: number; y: number; left: number; top: number; id: number } | null = null;
    let dragged = false;
    const canScroll = () => box.scrollWidth > box.clientWidth || box.scrollHeight > box.clientHeight;
    new ResizeObserver(() => box.classList.toggle('mm-can-drag', canScroll())).observe(this.stage);
    box.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !canScroll()) return;
      from = { x: e.clientX, y: e.clientY, left: box.scrollLeft, top: box.scrollTop, id: e.pointerId };
      dragged = false;
    });
    box.addEventListener('pointermove', (e) => {
      if (!from || e.pointerId !== from.id) return;
      const [dx, dy] = [e.clientX - from.x, e.clientY - from.y];
      if (!dragged && Math.hypot(dx, dy) < DRAG_PX) return;
      if (!dragged) {
        dragged = true;
        box.setPointerCapture(e.pointerId);
        box.classList.add('mm-dragging');
      }
      box.scrollLeft = from.left - dx;
      box.scrollTop = from.top - dy;
    });
    const end = () => {
      from = null;
      box.classList.remove('mm-dragging');
    };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
    // (A drag's release isn't a click on whatever it ended over.)
    box.addEventListener('click', (e) => {
      if (!dragged) return;
      dragged = false;
      e.stopPropagation();
      e.preventDefault();
    }, true);
  }

  /** An icon's hover: its frame lit and its name tag shown (keyboard focus too). */
  private hoverable(icon: HTMLElement, tag: HTMLElement, frame: (f: keyof typeof FRAME) => void): void {
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
  }

  /** A post not restored yet clicked: why it takes you nowhere. */
  private notRestored(): void {
    playSound('error');
    toast(NOT_RESTORED, 2800, 'bad');
  }

  /** A post or entrance clicked: the Teleport box (from a post), else why not. */
  private pick(map: LanternMap, post: number): void {
    if (!this.o?.fromPost) {
      playSound('error');
      return toast('Go to a Lantern Post to travel.', 2400);
    }
    this.confirm(map, post);
  }

  /** A label written right of its spot that runs into another: written left of it instead, ending at `right`. */
  private clearOf(within: HTMLElement, t: HTMLElement, right: number): void {
    const box = t.getBoundingClientRect();
    const hits = (b: DOMRect) => !(b.right < box.left || b.left > box.right || b.bottom < box.top || b.top > box.bottom);
    if (![...within.querySelectorAll<HTMLElement>('.mm-label')].some((o) => o !== t && !o.hidden && hits(o.getBoundingClientRect()))) return;
    t.classList.remove('mm-left');
    t.classList.add('mm-right');
    t.style.left = `${right}px`;
  }

  private footText(): void {
    const n = this.o?.lanterns() ?? 0;
    this.foot.textContent = `Click a Lantern Post or a dungeon entrance to travel · Return Lanterns: ${n.toLocaleString()}`;
  }

  /** The Teleport box over the dimmed map: where to, what it costs, Cancel / Teleport. */
  private confirm(to: LanternMap, post: number): void {
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
    const file = this.places?.files[to];
    const entrance = file ? lanternPostsOf(file)[post] : undefined;
    const name = this.layout ? postsOf(this.layout, to)[post]?.name : undefined;
    const sameMap = to === this.o?.here?.map;
    if (entrance?.entrance) {
      icon.className = 'mm-where-gate';
      icon.style.backgroundImage = '';
      words.append(el('div', 'mm-where-name', `Travel to the ${entrance.name}?`), el('div', 'mm-where-post', ENTRANCE[entrance.entrance] ?? PLACE[to].name));
    } else words.append(el('div', 'mm-where-name', sameMap ? 'Travel to another Lantern Post?' : `Travel to ${PLACE[to].name}?`), el('div', 'mm-where-post', name ? `${PLACE[to].post}, ${name}` : PLACE[to].post));
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
      travel(to, post);
    });
    buttons.append(cancel, go);
    box.append(head, where, el('div', 'mm-rule'), cost, buttons);
    this.dim.dataset.to = to;
    this.dim.dataset.post = String(post);
    this.dim.replaceChildren(box);
    this.dim.hidden = false;
    (go.disabled ? cancel : go).focus();
  }

  private closeConfirm(): void {
    this.dim.hidden = true;
    this.dim.replaceChildren();
    delete this.dim.dataset.to;
    delete this.dim.dataset.post;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
