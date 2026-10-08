import Phaser from 'phaser';
import type { AuraTier } from '@mikazuki/shared';

// ✨ Weapon auras (combat-guide.md "Weapon auras", stats.json enhancement.weaponAura; the art folder's
// items/weapon-aura/weapon-aura-preview-v6.gif): a +15–17 weapon glows blue, +18–19 gold, +20 prismatic. All drawn
// here by code, from the weapon's own pixels:
//   • a steady 3 px glow outside its silhouette (the aura colour, then 50%, then 25%; no pulsing), its outline pixels
//     lit (the tier's second colour; prismatic: each pixel's colour by its angle round the weapon, turning slowly);
//   • thin spiral lines winding ~1.5 turns round it while rising from its bottom, fading out above its top, long and
//     short ones (weaponAura.smoke), the half behind the weapon drawn under it (so it hides them);
//   • +18 and +20: twinkling 4-point star glints on its edge.
// One effect for every place a weapon shows: traceAura() works a weapon frame's silhouette out once (cached by key: a
// pose's frame, an icon), paintUnder() / paintOver() draw the glow and spirals behind and in front of it at a moment `t`
// (ms). WeaponAura puts the two on a Phaser sprite's cell (in hand, the resting weapon, loot); auraIcon() is the DOM
// version for item icons (the bag, the equipment panel, tooltips, the forge).

/** Glow and outline in art pixels. */
const RING_ALPHA = [0, 1, 0.5, 0.25];
const PAD = 3;
/** A spiral line's trip from the bottom to past the top (ms), and the turns it winds. */
const RISE_MS = 2400;
const TURNS = 1.5;
/** How much of the trip a long and a short line trail. */
const LONG_TRAIL = 0.22;
const SHORT_TRAIL = 0.09;
/** The prismatic colours turn round the weapon this fast (turns a second). */
const PRISM_SPIN = 0.12;
/** A glint's life (ms). */
const GLINT_MS = 760;
/** Phaser auras redraw this often (ms): steady glow, smooth enough spirals, few texture uploads. */
const REDRAW_MS = 50;

/** A weapon frame's silhouette worked out: the glow rings round it, its outline pixels (those seen: a back layer's are
 *  only where nothing covers them), its box. Coordinates in the frame's pixels (rings may stick out by up to 3). */
export interface AuraTrace {
  w: number;
  h: number;
  /** [x, y, ring 1–3] for each glow pixel. */
  rings: Int16Array;
  /** [x, y, dark] for each outline pixel that shows (dark: the art's own outline, lit strongly; light ones softly). */
  edges: Int16Array;
  /** The silhouette's box, or null (nothing to glow round). */
  box: { x0: number; y0: number; x1: number; y1: number; cx: number; cy: number } | null;
}

const traces = new Map<string, AuraTrace>();
let scratch: CanvasRenderingContext2D | null = null;

function pixels(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): Uint8ClampedArray {
  if (!scratch) scratch = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  scratch.canvas.width = w;
  scratch.canvas.height = h;
  scratch.imageSmoothingEnabled = false;
  scratch.clearRect(0, 0, w, h);
  draw(scratch);
  return scratch.getImageData(0, 0, w, h).data;
}

/** What a frame's weapon is made of: its layers behind the body and in front, and (optionally) what's drawn over the
 *  back layers: `alpha` (anything there covers them: the doll and the front layers) or `composite` (the whole frame as
 *  shown: a back pixel shows where the frame has that same pixel). */
export interface AuraSource {
  w: number;
  h: number;
  back?: (ctx: CanvasRenderingContext2D) => void;
  front: (ctx: CanvasRenderingContext2D) => void;
  cover?: { mode: 'alpha' | 'composite'; draw: (ctx: CanvasRenderingContext2D) => void };
}

/** A weapon frame's trace (worked out once per `key`). */
export function traceAura(key: string, src: AuraSource): AuraTrace {
  const known = traces.get(key);
  if (known) return known;
  const { w, h } = src;
  const back = src.back ? pixels(w, h, src.back) : null;
  const front = pixels(w, h, src.front);
  const cover = src.cover ? pixels(w, h, src.cover.draw) : null;
  const solid = new Uint8Array(w * h);
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let i = 0; i < w * h; i++) {
    if (front[i * 4 + 3] >= 128 || (back && back[i * 4 + 3] >= 128)) {
      solid[i] = 1;
      const x = i % w;
      const y = (i / w) | 0;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && solid[y * w + x] === 1;
  // Outline pixels: solid with a see-through 4-neighbour; a back layer's only where it shows.
  const shows = (i: number) => {
    if (front[i * 4 + 3] >= 128 || !cover || !back) return true;
    if (src.cover!.mode === 'alpha') return cover[i * 4 + 3] < 128;
    return cover[i * 4] === back[i * 4] && cover[i * 4 + 1] === back[i * 4 + 1] && cover[i * 4 + 2] === back[i * 4 + 2] && cover[i * 4 + 3] >= 128;
  };
  const edges: number[] = [];
  const rings: number[] = [];
  for (let y = -PAD; y < h + PAD; y++) {
    for (let x = -PAD; x < w + PAD; x++) {
      if (at(x, y)) {
        const i = y * w + x;
        if ((!at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1)) && shows(i)) {
          const px = front[i * 4 + 3] >= 128 ? front : back!;
          edges.push(x, y, px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11 < 90 ? 1 : 0);
        }
        continue;
      }
      // The nearest weapon pixel within 3: rings at 1 (the 8 neighbours), 2 and 3 px.
      let best = Infinity;
      for (let dy = -PAD; dy <= PAD; dy++) for (let dx = -PAD; dx <= PAD; dx++) if (at(x + dx, y + dy)) best = Math.min(best, dx * dx + dy * dy);
      if (best === Infinity) continue;
      const d = Math.sqrt(best);
      const ring = d < 1.5 ? 1 : d < 2.5 ? 2 : d < 3.2 ? 3 : 0;
      if (ring) rings.push(x, y, ring);
    }
  }
  const trace: AuraTrace = { w, h, rings: Int16Array.from(rings), edges: Int16Array.from(edges), box: x1 < 0 ? null : { x0, y0, x1, y1, cx: (x0 + x1 + 1) / 2, cy: (y0 + y1 + 1) / 2 } };
  traces.set(key, trace);
  return trace;
}

// ── Colours ──

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const css = ([r, g, b]: [number, number, number]) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
const mix = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const WHITE: [number, number, number] = [255, 255, 255];

/** A prismatic colour at angle `a` (radians, turning with time): the cycle spread round the weapon, blended between. */
function prism(cycle: [number, number, number][], a: number): [number, number, number] {
  const u = (((a / (Math.PI * 2)) % 1) + 1) % 1;
  const f = u * cycle.length;
  const i = Math.floor(f);
  return mix(cycle[i % cycle.length], cycle[(i + 1) % cycle.length], f - i);
}

const palettes = new Map<string, { glow: [number, number, number]; lit: [number, number, number]; cycle: [number, number, number][] | null }>();
function paletteOf(tier: AuraTier) {
  let p = palettes.get(tier.aura);
  if (!p) {
    const cycle = tier.cycle?.map(rgb) ?? null;
    p = { glow: rgb(tier.colours[0] ?? '#FFFFFF'), lit: rgb(tier.colours[1] ?? tier.colours[0] ?? '#FFFFFF'), cycle };
    palettes.set(tier.aura, p);
  }
  return p;
}

/** A small seeded hash (the same glints and spirals on every screen at the same moment). */
const hash = (n: number) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

// ── Drawing ──

export interface AuraPaint {
  /** Where the frame's top-left is on the canvas (px), and its scale. */
  ox: number;
  oy: number;
  scale?: number;
  /** How far above the top the spiral lines fade out (px of art; 18 by default, less on small icons). */
  rise?: number;
  /** A seed so two weapons on screen don't spiral in step. */
  seed?: number;
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, colour: string, alpha: number): void {
  if (alpha <= 0.02) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.fillStyle = colour;
  ctx.fillRect(x * s, y * s, s, s);
}

/** The spiral lines' pixels, front (in front of the weapon) or back, at `t`. */
function spirals(ctx: CanvasRenderingContext2D, tr: AuraTrace, tier: AuraTier, t: number, p: AuraPaint, front: boolean): void {
  const b = tr.box;
  if (!b) return;
  const s = p.scale ?? 1;
  const pal = paletteOf(tier);
  const height = b.y1 - b.y0 + 1;
  const halfW = (b.x1 - b.x0 + 1) / 2;
  const rx = Math.max(4, halfW * 1.15 + 3);
  const ry = Math.max(1.5, rx * 0.42);
  const rise = p.rise ?? Math.min(18, Math.max(8, height * 0.8));
  const path = height + rise + ry;
  const lines = tier.long + tier.short;
  const seen = new Set<number>();
  for (let i = 0; i < lines; i++) {
    const long = i < tier.long;
    const phase = hash(i * 7 + (p.seed ?? 0) * 131);
    const period = RISE_MS * (0.85 + hash(i * 13 + 5) * 0.4);
    const head = ((t / period + phase) % 1 + 1) % 1;
    const trail = long ? LONG_TRAIL : SHORT_TRAIL;
    const turn0 = hash(i * 29 + 3) * Math.PI * 2;
    const colour = pal.cycle ? css(pal.cycle[i % pal.cycle.length]) : css(mix(pal.glow, pal.lit, 0.35));
    const steps = Math.ceil(path * trail * 2.5) + 4;
    for (let k = 0; k <= steps; k++) {
      const along = k / steps; // 0 = the head, 1 = the tail's end
      const u = head - along * trail;
      if (u < 0) continue;
      const a = turn0 + u * TURNS * Math.PI * 2;
      const inFront = Math.sin(a) > 0;
      if (inFront !== front) continue;
      const y = b.y1 + ry * 0.5 - u * path + Math.sin(a) * ry;
      const x = b.cx + Math.cos(a) * rx;
      const px = Math.round(x - 0.5);
      const py = Math.round(y - 0.5);
      const key = (px + 512) * 4096 + (py + 512);
      if (seen.has(key)) continue;
      seen.add(key);
      // Fades in off the bottom, out above the top, and along its trail.
      const above = b.y0 - y;
      const fadeTop = above > 0 ? 1 - above / rise : 1;
      const fadeIn = Math.min(1, u / 0.08);
      const alpha = 0.8 * (1 - along) ** 1.4 * fadeTop * fadeIn * (front ? 1 : 0.7);
      dot(ctx, p.ox / s + px, p.oy / s + py, s, colour, alpha);
    }
  }
}

/** Behind the weapon: the glow rings and the back half of the spiral lines. */
export function paintUnder(ctx: CanvasRenderingContext2D, tr: AuraTrace, tier: AuraTier, t: number, p: AuraPaint): void {
  const s = p.scale ?? 1;
  const pal = paletteOf(tier);
  const b = tr.box;
  const spin = (t / 1000) * PRISM_SPIN * Math.PI * 2;
  const glow = css(pal.glow);
  for (let i = 0; i < tr.rings.length; i += 3) {
    const x = tr.rings[i];
    const y = tr.rings[i + 1];
    const colour = pal.cycle && b ? css(prism(pal.cycle, Math.atan2(y + 0.5 - b.cy, x + 0.5 - b.cx) + spin)) : glow;
    dot(ctx, p.ox / s + x, p.oy / s + y, s, colour, RING_ALPHA[tr.rings[i + 2]]);
  }
  spirals(ctx, tr, tier, t, p, false);
  ctx.globalAlpha = 1;
}

/** In front of the weapon: its lit outline, the front half of the spiral lines, and the glints. */
export function paintOver(ctx: CanvasRenderingContext2D, tr: AuraTrace, tier: AuraTier, t: number, p: AuraPaint): void {
  const s = p.scale ?? 1;
  const pal = paletteOf(tier);
  const b = tr.box;
  const spin = (t / 1000) * PRISM_SPIN * Math.PI * 2;
  const lit = css(pal.lit);
  for (let i = 0; i < tr.edges.length; i += 3) {
    const x = tr.edges[i];
    const y = tr.edges[i + 1];
    const colour = pal.cycle && b ? css(mix(prism(pal.cycle, Math.atan2(y + 0.5 - b.cy, x + 0.5 - b.cx) + spin), WHITE, 0.35)) : lit;
    if (tr.edges[i + 2]) dot(ctx, p.ox / s + x, p.oy / s + y, s, colour, 0.85); // (the art's own outline; lighter edge pixels keep their colour)
  }
  spirals(ctx, tr, tier, t, p, true);
  // Glints: a 4-point star on an outline pixel, growing and shrinking, then somewhere else.
  const n = tr.edges.length / 3;
  for (let g = 0; g < tier.glints && n; g++) {
    const clock = t / GLINT_MS + g / tier.glints + (p.seed ?? 0) * 0.17;
    const life = clock - Math.floor(clock);
    const at = Math.floor(hash(Math.floor(clock) * 97 + g * 31 + (p.seed ?? 0)) * n);
    const x = p.ox / s + tr.edges[at * 3];
    const y = p.oy / s + tr.edges[at * 3 + 1];
    const size = Math.sin(life * Math.PI);
    const arm = size > 0.66 ? 2 : size > 0.25 ? 1 : 0;
    const star = pal.cycle ? '#FFFFFF' : lit;
    dot(ctx, x, y, s, '#FFFFFF', 0.4 + size * 0.6);
    for (let k = 1; k <= arm; k++) {
      const a = k === arm && arm > 1 ? 0.55 : 0.9;
      dot(ctx, x - k, y, s, star, a * size);
      dot(ctx, x + k, y, s, star, a * size);
      dot(ctx, x, y - k, s, star, a * size);
      dot(ctx, x, y + k, s, star, a * size);
    }
  }
  ctx.globalAlpha = 1;
}

// ── On a Phaser sprite ──

/** Room round the frame for the glow and the spirals (art px). */
const MARGIN = 22;
let auraIds = 0;

/**
 * A weapon's aura on a sprite's cell in the world: two canvas textures, one under the sprite (glow, back spirals) and
 * one over it (lit outline, front spirals, glints), drawn from the trace of whatever frame shows, redrawn a few times a
 * second. `place()` each frame with the cell's top-left and the sprite's depth; `set(null)` hides it.
 */
export class WeaponAura {
  private readonly under: Phaser.GameObjects.Image;
  private readonly over: Phaser.GameObjects.Image;
  private readonly texUnder: Phaser.Textures.CanvasTexture;
  private readonly texOver: Phaser.Textures.CanvasTexture;
  private tier: AuraTier | null = null;
  private drawnAt = -Infinity;
  private drawn: AuraTrace | null = null;
  private readonly seed = Math.floor(Math.random() * 1000);

  constructor(private readonly scene: Phaser.Scene, private readonly cell: [number, number]) {
    const id = ++auraIds;
    const [w, h] = [cell[0] + MARGIN * 2, cell[1] + MARGIN * 2];
    this.texUnder = scene.textures.createCanvas(`aura:${id}:u`, w, h)!;
    this.texOver = scene.textures.createCanvas(`aura:${id}:o`, w, h)!;
    this.under = scene.add.image(0, 0, this.texUnder.key).setOrigin(0, 0).setVisible(false);
    this.over = scene.add.image(0, 0, this.texOver.key).setOrigin(0, 0).setVisible(false);
  }

  /** The tier (null: no aura). */
  set(tier: AuraTier | null): void {
    if (tier?.aura === this.tier?.aura) return;
    this.tier = tier;
    this.drawn = null;
    if (!tier) for (const o of [this.under, this.over]) o.setVisible(false);
  }

  get on(): boolean {
    return !!this.tier;
  }

  /** Places it on the cell whose top-left is (x, y), under and over `depth`, for `trace` (null: hidden). */
  place(trace: AuraTrace | null, x: number, y: number, depthUnder: number, depthOver: number, alpha = 1): void {
    const tier = this.tier;
    if (!tier || !trace?.box) {
      for (const o of [this.under, this.over]) o.setVisible(false);
      return;
    }
    const now = this.scene.time.now;
    if (trace !== this.drawn || now - this.drawnAt >= REDRAW_MS) {
      this.drawn = trace;
      this.drawnAt = now;
      for (const [tex, paint] of [[this.texUnder, paintUnder], [this.texOver, paintOver]] as const) {
        const ctx = tex.getContext();
        ctx.clearRect(0, 0, tex.width, tex.height);
        paint(ctx, trace, tier, now, { ox: MARGIN, oy: MARGIN, seed: this.seed });
        tex.refresh();
      }
    }
    this.under.setPosition(x - MARGIN, y - MARGIN).setDepth(depthUnder).setVisible(true).setAlpha(alpha);
    this.over.setPosition(x - MARGIN, y - MARGIN).setDepth(depthOver).setVisible(true).setAlpha(alpha);
  }

  hide(): void {
    for (const o of [this.under, this.over]) o.setVisible(false);
  }

  /** Both images (to tint with the world at night: the aura stays bright, so callers usually don't). */
  get images(): Phaser.GameObjects.Image[] {
    return [this.under, this.over];
  }

  destroy(): void {
    this.under.destroy();
    this.over.destroy();
    this.texUnder.destroy();
    this.texOver.destroy();
  }
}

// ── On an item icon in the page ──

const icons = new Set<{ canvas: HTMLCanvasElement; img: HTMLImageElement | null; trace: AuraTrace | null; tier: AuraTier; size: number; m: number; seed: number; born: number; seen: boolean }>();
let ticking = 0;

function tickIcons(): void {
  ticking = 0;
  const t = performance.now();
  for (const a of icons) {
    if (!a.canvas.isConnected) {
      // Not in the page (yet): dropped once it has been and gone (or never came).
      if (a.seen || t - a.born > 5000) icons.delete(a);
      continue;
    }
    a.seen = true;
    if (!a.trace) continue;
    const ctx = a.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, a.canvas.width, a.canvas.height);
    paintUnder(ctx, a.trace, a.tier, t, { ox: a.m, oy: a.m, rise: a.size * 0.45, seed: a.seed });
    if (a.img) ctx.drawImage(a.img, a.m, a.m, a.size, a.size);
    paintOver(ctx, a.trace, a.tier, t, { ox: a.m, oy: a.m, rise: a.size * 0.45, seed: a.seed });
  }
  if (icons.size) ticking = window.setTimeout(() => requestAnimationFrame(tickIcons), REDRAW_MS);
}

/**
 * An item icon with its aura, for the page: a canvas (art pixels, shown at `scale`×, pixelated) with the glow, the icon
 * and the spirals and glints, room round it for them (it sits centred over the icon's own box and may spill past it).
 * `url`: the icon's file (`size` px square). Redrawn while it's in the page.
 */
export function auraIcon(url: string, size: number, tier: AuraTier, scale: number): HTMLCanvasElement {
  const m = Math.round(size * 0.5);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size + m * 2;
  canvas.className = 'aura-icon';
  canvas.style.width = canvas.style.height = `${(size + m * 2) * scale}px`;
  canvas.style.margin = `${-m * scale}px`;
  const a = { canvas, img: null as HTMLImageElement | null, trace: null as AuraTrace | null, tier, size, m, seed: Math.floor(Math.random() * 1000), born: performance.now(), seen: false };
  const img = new Image();
  img.onload = () => {
    a.img = img;
    a.trace = traceAura(`icon:${url}`, { w: size, h: size, front: (ctx) => ctx.drawImage(img, 0, 0, size, size) });
  };
  img.src = url;
  icons.add(a);
  if (!ticking) ticking = window.setTimeout(() => requestAnimationFrame(tickIcons), 0);
  return canvas;
}
