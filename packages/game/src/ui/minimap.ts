import type { TownMap } from '../assets/types';

// 🗺️ The minimap (top right, above the HUD's buttons; it goes in the HUD's .th-map slot): the map round you, centred on
// you and moving with you (26 Oct 2026: it showed the whole map, too small to read), about ZOOMS[n] tiles across: + and
// − at its corner zoom it in and out (kept per browser, localStorage `mk_minimap_zoom`; 40 to start). The map's ground
// from its file (the town's grass, paths, plaza, river and buildings' footprints; the Slums' dirt, concrete, planks and
// canal, raised ground a shade lighter and the basin darker; a map's own picture over it: manifest ui.minimapPictures),
// its Lantern Posts and dungeon entrance (`setMarks`), a green dot for everyone else (pink for your party), a gold one for
// you, and a faint box for what the camera shows. The whole map's ground is drawn once, at the 40-tile zoom's scale, and
// the part round you copied out of it each time. Smaller on phones.

const GROUND: Record<string, string> = {
  grass: '#2D5240', path: '#565C75', plaza: '#7A8099', water: '#1D3F6E',
  // The Slums
  dirt: '#4E3424', 'dirt-junk': '#553A28', weeds: '#4C3D26', mud: '#3B2A20', concrete: '#5A6078', plate: '#6E4836', planks: '#7A5634', canal: '#2E5A3E',
  // The Lumang Palengke (its stall blocks, being blocked, a shade darker: BLOCKED_SHADE)
  adobe: '#8A4B36', tarp: '#5B6B82', semento: '#6B6E78', gulay: '#3F6B3A', tuyo: '#9C8456', pula: '#6E2A2A', tiles: '#9AA0AC', blue: '#3B5BA0',
  baha: '#6FA8D8', lalim: '#1F3A6B', terrazzo: '#7A6E88',
};
/** On a map whose blocked tiles are its stalls and walls (the Palengke), they're drawn this much darker. */
const BLOCKED_SHADE = -0.32;
const BUILDING = '#7C2AE8';
const VOID = '#111827'; // a chasm's floor (level below 0): near black
const OTHER = '#22C55E';
const PARTY = '#F9A8D4'; // your party's pink (their names in town, the party panel)
const YOU = '#FCDA4A';
const OUTLINE = '#111827';
const PHONE = '(max-width: 760px), (max-height: 500px)';
/** How many tiles across it shows, by zoom step (+ goes left, − right); START the first time. */
const ZOOMS = [20, 30, 40, 60, 90];
const START = 2;
const ZOOM_STORE = 'mk_minimap_zoom';
/** The ground is drawn at the scale this many tiles across fills the minimap (a closer zoom stretches it a little). */
const GROUND_TILES = 40;
/** World px: a tile is 32 wide and 16 tall (its top corner at ((col − row) × 16, (col + row) × 8)). */
const TILE_W = 32;

/** A minimap icon: a Lantern Post (restored or not) or a dungeon entrance (by its id). */
export type MinimapIcon = 'post' | 'postBroken' | 'warrens' | 'silong';

export interface MinimapView {
  me: { col: number; row: number };
  /** Where you are in world px (your feet, as drawn: it follows you smoothly between tiles); else your tile's middle. */
  at?: { x: number; y: number };
  /** Everyone else; `party`: in your party (pink). */
  others: { col: number; row: number; party?: boolean }[];
  /** The camera's view, in world px (tile (col, row)'s top corner is at ((col - row) × 16, (col + row) × 8)). */
  camera: { x: number; y: number; width: number; height: number };
}

export class Minimap {
  /** The minimap and its zoom buttons, in the HUD's .th-map slot. */
  readonly box = document.createElement('div');
  readonly el = document.createElement('canvas');
  /** The whole map's ground (world px × `gk`), drawn once. */
  private readonly ground = document.createElement('canvas');
  private readonly phone = matchMedia(PHONE);
  private width = 0;
  private height = 0;
  private ratio = 1;
  /** The ground's device px per world px. */
  private gk = 1;
  /** The world x of the ground's left edge (the map's west corner: (col 0, row `rows`)). */
  private readonly x0: number;
  private zoom = START;
  private readonly zoomIn = document.createElement('button');
  private readonly zoomOut = document.createElement('button');
  /** The last view drawn (redrawn at once when the zoom changes). */
  private last: MinimapView | null = null;

  /** The map's own picture (manifest ui.minimapPictures: its diamond exactly, top corner at the top middle), once loaded. */
  private picture: HTMLImageElement | null = null;

  /** The map's Lantern Posts (restored or not: CONTEXT.md Restored Lantern Post) and its dungeon entrance, as icons on
   *  the ground under the dots (manifest ui.minimapIcons, drawn 1:1, their anchor on the spot). */
  private marks: { col: number; row: number; icon: MinimapIcon }[] = [];
  private readonly icons = new Map<MinimapIcon, { img: HTMLImageElement; size: [number, number]; anchor: [number, number] }>();

  constructor(private readonly map: TownMap, pictureUrl?: string) {
    this.x0 = -map.size[1] * (TILE_W / 2);
    try {
      const z = Number(localStorage.getItem(ZOOM_STORE));
      if (Number.isInteger(z) && z >= 0 && z < ZOOMS.length && localStorage.getItem(ZOOM_STORE) !== null) this.zoom = z;
    } catch {
      // private window: 40 tiles
    }
    if (pictureUrl) {
      const img = new Image();
      img.onload = () => {
        this.picture = img;
        this.paintPicture();
      };
      img.src = pictureUrl;
    }
    this.el.id = 'minimap';
    this.el.setAttribute('role', 'img');
    this.el.setAttribute('aria-label', 'Map round you: you in gold, your party in pink, everyone else in green; Lantern Posts and dungeon entrances marked');
    this.box.className = 'mm-mini';
    for (const [b, text, label, step] of [[this.zoomIn, '+', 'Zoom the minimap in', -1], [this.zoomOut, '−', 'Zoom the minimap out', 1]] as const) {
      b.className = 'mm-mini-zoom';
      b.textContent = text;
      b.setAttribute('aria-label', label);
      b.title = label;
      b.addEventListener('click', () => this.setZoom(this.zoom + step));
    }
    const zooms = document.createElement('div');
    zooms.className = 'mm-mini-zooms';
    zooms.append(this.zoomIn, this.zoomOut);
    this.box.append(this.el, zooms);
    (document.querySelector('#town-hud .th-map') ?? document.body).append(this.box);
    this.phone.addEventListener('change', () => this.layout());
    this.layout();
    this.setZoom(this.zoom);
  }

  /** The icons' art (manifest ui.minimapIcons). */
  setIcons(art: Partial<Record<MinimapIcon, { url: string; size: [number, number]; anchor: [number, number] }>>): void {
    for (const [k, a] of Object.entries(art) as [MinimapIcon, { url: string; size: [number, number]; anchor: [number, number] }][]) {
      const img = new Image();
      img.src = a.url;
      this.icons.set(k, { img, size: a.size, anchor: a.anchor });
    }
  }

  /** Where the posts and the entrance are, and which look (drawn from the next frame on). */
  setMarks(marks: { col: number; row: number; icon: MinimapIcon }[]): void {
    this.marks = marks;
  }

  /** A zoom step (clamped), kept for this browser; the buttons greyed at the ends. */
  private setZoom(z: number): void {
    this.zoom = Math.max(0, Math.min(ZOOMS.length - 1, z));
    this.zoomIn.disabled = this.zoom === 0;
    this.zoomOut.disabled = this.zoom === ZOOMS.length - 1;
    try {
      localStorage.setItem(ZOOM_STORE, String(this.zoom));
    } catch {
      // private window: not kept
    }
    if (this.last) this.draw(this.last);
  }

  /** Sizes the canvas for the screen (always half as tall as it's wide, as the whole map's diamond was) and draws the
   *  whole map's ground once. */
  private layout(): void {
    const [cols, rows] = this.map.size;
    this.width = this.phone.matches ? 132 : 216;
    this.height = Math.round(this.width / 2);
    this.ratio = Math.max(1, Math.round(window.devicePixelRatio || 1));
    this.el.width = this.width * this.ratio;
    this.el.height = this.height * this.ratio;
    this.el.style.width = `${this.width}px`;
    this.el.style.height = `${this.height}px`;
    // The ground at the scale GROUND_TILES across fills the minimap.
    this.gk = (this.width * this.ratio) / (GROUND_TILES * TILE_W);
    this.ground.width = Math.ceil((cols + rows) * (TILE_W / 2) * this.gk);
    this.ground.height = Math.ceil((cols + rows) * (TILE_W / 4) * this.gk);

    const g = this.ground.getContext('2d')!;
    const k = this.gk;
    const tile = (c: number, r: number, colour: string) => {
      const x = ((c - r) * (TILE_W / 2) - this.x0) * k;
      const y = (c + r + 1) * (TILE_W / 4) * k;
      g.fillStyle = colour;
      g.fillRect(x - (TILE_W / 2) * k, y - (TILE_W / 4) * k, TILE_W * k, (TILE_W / 2) * k); // its diamond's box: the tiles mesh into the map's shape
    };
    const H = this.map.height;
    // The map's usual level (its most common one above void) is the ground's own colour; each level up a shade lighter,
    // each level down darker; void (below 0: a chasm's floor) near black.
    const count = new Map<number, number>();
    if (H) for (const row of H) for (const v of row) if (v >= 0) count.set(v, (count.get(v) ?? 0) + 1);
    const base = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    const darkBlocked = this.map.tileset === 'palengke';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ground = GROUND[this.map.ground[r][c]] ?? GROUND.grass;
        const colour = darkBlocked && this.map.blocked[r]?.[c] ? shade(ground, BLOCKED_SHADE) : ground;
        const level = H?.[r]?.[c] ?? base;
        tile(c, r, level < 0 ? VOID : level === base ? colour : shade(colour, level > base ? 0.18 * (level - base) : -0.35 + 0.1 * (level - base + 1)));
      }
    }
    for (const o of this.map.objects) {
      if (o.kind !== 'building') continue;
      for (let dc = 0; dc < o.footprint[0]; dc++) for (let dr = 0; dr < o.footprint[1]; dr++) tile(o.col + dc, o.row + dr, BUILDING);
    }
    this.paintPicture();
    if (this.last) this.draw(this.last);
  }

  /** The map's picture over the tile colours (they show while it loads, or if it can't): its diamond is the ground's, so
   *  the dots and the camera box sit where they always do. Smoothed: it's drawn smaller than it is. */
  private paintPicture(): void {
    if (!this.picture) return;
    const g = this.ground.getContext('2d')!;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.picture, 0, 0, this.ground.width, this.ground.height);
  }

  /** The map round you: the ground, the posts and the entrance, the camera's view, everyone's dots and yours in the
   *  middle. */
  draw(v: MinimapView): void {
    this.last = v;
    const g = this.el.getContext('2d')!;
    const W = this.width;
    const H = this.height;
    g.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    g.clearRect(0, 0, W, H);
    // The view: ZOOMS[zoom] tiles across, centred on you (world px).
    const centre = v.at ?? { x: (v.me.col - v.me.row) * (TILE_W / 2), y: (v.me.col + v.me.row + 1) * (TILE_W / 4) };
    const vw = ZOOMS[this.zoom] * TILE_W;
    const vh = vw * (H / W);
    const left = centre.x - vw / 2;
    const top = centre.y - vh / 2;
    const s = W / vw; // minimap px per world px
    const px = (wx: number, wy: number) => ({ x: (wx - left) * s, y: (wy - top) * s });
    const tileAt = (col: number, row: number) => px((col - row) * (TILE_W / 2), (col + row) * (TILE_W / 4));
    // The ground under it (what's past the map's edge stays clear: the box's own dark).
    const sx = (left - this.x0) * this.gk;
    const sy = top * this.gk;
    const sw = vw * this.gk;
    const sh = vh * this.gk;
    const cx0 = Math.max(0, sx);
    const cy0 = Math.max(0, sy);
    const cx1 = Math.min(this.ground.width, sx + sw);
    const cy1 = Math.min(this.ground.height, sy + sh);
    if (cx1 > cx0 && cy1 > cy0) {
      g.imageSmoothingEnabled = true;
      g.drawImage(this.ground, cx0, cy0, cx1 - cx0, cy1 - cy0, ((cx0 - sx) / sw) * W, ((cy0 - sy) / sh) * H, ((cx1 - cx0) / sw) * W, ((cy1 - cy0) / sh) * H);
    }

    // The posts and the entrance (whole px, never smoothed), under the dots.
    g.imageSmoothingEnabled = false;
    for (const m of this.marks) {
      const icon = this.icons.get(m.icon);
      if (!icon?.img.complete || !icon.img.naturalWidth) continue;
      const { x, y } = tileAt(m.col, m.row);
      if (x < -icon.size[0] || x > W + icon.size[0] || y < -icon.size[1] || y > H + icon.size[1]) continue;
      g.drawImage(icon.img, Math.round(x - icon.anchor[0]), Math.round(y - icon.anchor[1]), icon.size[0], icon.size[1]);
    }

    // What the camera shows.
    const cam = px(v.camera.x, v.camera.y);
    g.strokeStyle = 'rgba(230, 233, 242, 0.55)';
    g.lineWidth = 1;
    g.strokeRect(Math.round(cam.x) + 0.5, Math.round(cam.y) + 0.5, Math.round(v.camera.width * s), Math.round(v.camera.height * s));

    const r = this.phone.matches ? 2 : 2.5;
    const dot = (p: { x: number; y: number }, colour: string, size: number) => {
      if (p.x < -size || p.x > W + size || p.y < -size || p.y > H + size) return;
      g.beginPath();
      g.arc(p.x, p.y, size, 0, Math.PI * 2);
      g.fillStyle = colour;
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = OUTLINE;
      g.stroke();
    };
    const middle = (p: { col: number; row: number }) => tileAt(p.col + 0.5, p.row + 0.5);
    for (const p of v.others) if (!p.party) dot(middle(p), OTHER, r);
    for (const p of v.others) if (p.party) dot(middle(p), PARTY, r); // (over the others)
    dot(px(centre.x, centre.y), YOU, r + 1); // last, on top: the middle
  }
}

/** A colour mixed toward white (amount > 0) or black (< 0). */
function shade(hex: string, amount: number): string {
  if (!hex.startsWith('#')) return hex; // (already mixed)
  const n = parseInt(hex.slice(1), 16);
  const mix = (v: number) => Math.round(amount > 0 ? v + (255 - v) * amount : v * (1 + amount));
  return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}
