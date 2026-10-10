import Phaser from 'phaser';
import type { Manifest, SlumsTiles, TownMap, Vec2 } from '../assets/types';
import { tileToScreen } from '../iso';
import { GROUND_DEPTH, frontDepth } from './depth';
import type { Heights } from './heights';
import { LEVEL_PX, RAMP_STEP } from './heights';
import type { SlumsOutskirts } from './outskirts';
import { pick, seedOf, tileRandom, variantAt } from './rng';

// 🏚️ The ground of a map with raised and low ground (the Slums: manifest tiles.slums, rules in mikazuki-assets
// tiles/slums/slums-elevation-README.md). Each tile's floor is drawn 16 px × its level higher; a raised tile shows a wall
// (cliff-<material>-l|r, a variant seeded by col,row) for every level its SW / SE neighbour is lower, stacked 16 px
// apart, a navy rim where its NW / NE neighbour is lower, and caps on corners; ramps are pieces over their two tiles.
//
// Baked into CHUNK-sized canvases (under everything), in the README's order (per level from low to high: floors, then
// the walls of the step up; back to front): every floor, wall and cap. Kept as sprites sorted with the characters and
// objects (so the ground in front can hide them): the floor (and rims) of every tile that rises over a tile just behind
// it (one level over the 3 tiles behind, two over the 6), and the ramps. The canal is animated sprites with the river's
// bank overlays, like the town's water. Past the map: its outskirts' dirt, canal and road (world/outskirts.ts).
//
// The map is big (256 × 192), so all of it is made only near the camera (stream): chunks and 16 × 16-tile regions of
// sprites as they come within reach, dropped again once well away.

const CHUNK = 512; // px of world per baked canvas
const REGION = 16; // tiles per side of a region of sprites
const NEAR = 256; // px round the view: made by then
const FAR = 1024; // px round the view: dropped past this
const MAX_LEVEL = 2;
const BAKES_PER_FRAME = 3;

interface Piece {
  key: string;
  x: number;
  y: number;
  ox: number;
  oy: number;
  order: number;
}

interface Live {
  images: Phaser.GameObjects.Image[];
  rect: Phaser.Geom.Rectangle;
}

export class Terrain {
  /** Nothing for the scene's culler: what's made is what's near (stream). */
  readonly cullable: Phaser.GameObjects.Image[] = [];
  private readonly T: SlumsTiles;
  private readonly cols: number;
  private readonly rows: number;
  private readonly chunks = new Map<string, Live>();
  private readonly regions = new Map<string, Live>();
  private readonly canal = new Map<Phaser.GameObjects.Image, number>(); // sprite → frames
  /** Raised tops and their rims by tile ("c,r"), while their region is made: what `fadeFront` fades. */
  private readonly tops = new Map<string, Phaser.GameObjects.Image[]>();
  private faded: Phaser.GameObjects.Image[] = [];
  private readonly overlays: { file: string; land: Vec2 }[];
  private frame = -1;
  private lastRange = '';
  /** Every image made so far is tinted with this (the day/night tint), and new ones as they're made. */
  onSpawn: ((o: Phaser.GameObjects.Components.Tint) => void) | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    M: Manifest,
    private readonly map: TownMap,
    private readonly H: Heights,
    private readonly out: SlumsOutskirts | null,
  ) {
    this.T = M.tiles.slums as SlumsTiles;
    [this.cols, this.rows] = map.size;
    this.overlays = Object.values(M.tiles.water.overlays).filter((o): o is { file: string; land: Vec2 } => typeof o === 'object');
  }

  /** Every image there is now (chunks and sprites), for the day/night tint. */
  get sprites(): Phaser.GameObjects.Image[] {
    return [...this.chunks.values(), ...this.regions.values()].flatMap((l) => l.images);
  }

  /** A ground tile's file: one of its kind's variants, picked by a well-mixed hash of col, row seeded per kind (rng.ts
   *  mix32), so no repeats line up. */
  private groundFile(kind: string, c: number, r: number): string {
    const files = this.T.ground[kind] ?? this.T.ground.dirt;
    return variantAt(files, c, r, seedOf(kind in this.T.ground ? kind : 'dirt'));
  }

  private inMap(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows;
  }

  private kind(c: number, r: number): string {
    return this.inMap(c, r) ? this.map.ground[r][c] : (this.out?.kind(c, r) ?? 'dirt');
  }

  private level(c: number, r: number): number {
    return this.H.at(c, r);
  }

  /** Where a piece anchored on tile (c, r) at `level` lands (the diamond centre of that tile, raised). */
  private at(c: number, r: number, level: number): { x: number; y: number } {
    const t = tileToScreen(c, r);
    return { x: t.x, y: t.y + 8 - level * LEVEL_PX };
  }

  /** Rises over a tile just behind it, so it must sort with what stands there. */
  private raised(c: number, r: number): boolean {
    const level = this.level(c, r);
    if (level === 0 || !this.inMap(c, r)) return false;
    return (
      [[1, 0], [0, 1], [1, 1]].some(([dc, dr]) => this.level(c - dc, r - dr) < level) ||
      [[2, 1], [1, 2], [2, 2]].some(([dc, dr]) => this.level(c - dc, r - dr) <= level - 2)
    );
  }

  /** The edge from (c, r) to (c2, r2) is where a ramp's part 2 meets the high tile it leads up to: no wall or rim. */
  private rampUp(c: number, r: number, c2: number, r2: number): boolean {
    const rp = this.H.ramp(c2, r2);
    if (!rp || rp.part !== 2) return false;
    const [dc, dr] = RAMP_STEP[rp.dir];
    return c2 + dc === c && r2 + dr === r;
  }

  /** A tile's baked pieces: its floor (unless it's a sprite), its walls and caps. */
  private bakedPieces(c: number, r: number, out: Piece[]): void {
    const T = this.T;
    const level = this.level(c, r);
    const kind = this.kind(c, r);
    const order = (L: number, phase: number) => L * 1e6 + phase * 1e5 + (c + r + 1000) * 10;
    const add = (key: string, L: number, phase: number, anchor: Vec2) => {
      const p = this.at(c, r, L);
      out.push({ key, x: p.x, y: p.y, ox: anchor[0], oy: anchor[1], order: order(L, phase) });
    };
    if (kind !== 'canal' && !this.raised(c, r)) add(this.groundFile(kind, c, r), level, 0, T.anchor);
    const mat = T.cliffs[this.map.walls?.[r]?.[c] || 'earth'] ?? Object.values(T.cliffs)[0];
    const wall = (side: 'l' | 'r', c2: number, r2: number) => {
      const below = this.level(c2, r2);
      if (below >= level || this.rampUp(c, r, c2, r2)) return false;
      for (let L = below; L < level; L++) add(pick(mat[side], tileRandom(c, r, side === 'l' ? 32 + L : 36 + L)), L, 1, T.pieceAnchor);
      return true;
    };
    const left = wall('l', c, r + 1);
    const right = wall('r', c + 1, r);
    if (left && this.level(c - 1, r) < level && this.level(c - 1, r + 1) < level) for (let L = this.level(c, r + 1); L < level; L++) add(T.cap.w, L, 1, T.pieceAnchor);
    if (right && this.level(c, r - 1) < level && this.level(c + 1, r - 1) < level) for (let L = this.level(c + 1, r); L < level; L++) add(T.cap.e, L, 1, T.pieceAnchor);
  }

  /** Bakes one chunk: every tile whose pieces can reach it, in the global order. */
  private bake(cx: number, cy: number): Live {
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    // A tile (c, r) draws within x (c − r)·16 ± 16 and y (c + r)·8 − 16·MAX_LEVEL − 16 … (c + r)·8 + 16.
    const d0 = Math.floor((x0 - 16) / 16) - 1;
    const d1 = Math.ceil((x0 + CHUNK + 16) / 16) + 1;
    const s0 = Math.floor((y0 - 16) / 8) - 1;
    const s1 = Math.ceil((y0 + CHUNK + 16 + 16 * MAX_LEVEL + 16) / 8) + 1;
    const pieces: Piece[] = [];
    for (let s = s0; s <= s1; s++) {
      for (let d = d0; d <= d1; d++) {
        if ((s + d) & 1) continue;
        this.bakedPieces((s + d) / 2, (s - d) / 2, pieces);
      }
    }
    pieces.sort((a, b) => a.order - b.order);
    const canvas = document.createElement('canvas');
    canvas.width = CHUNK;
    canvas.height = CHUNK;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const source = new Map<string, HTMLImageElement>();
    for (const p of pieces) {
      let img = source.get(p.key);
      if (!img) {
        img = this.scene.textures.get(p.key).getSourceImage() as HTMLImageElement;
        source.set(p.key, img);
      }
      const left = Math.round(p.x - p.ox) - x0;
      const top = Math.round(p.y - p.oy) - y0;
      if (left >= CHUNK || top >= CHUNK || left + img.width <= 0 || top + img.height <= 0) continue;
      ctx.drawImage(img, left, top);
    }
    const tex = `terrain-chunk:${cx},${cy}`;
    if (this.scene.textures.exists(tex)) this.scene.textures.remove(tex);
    this.scene.textures.addCanvas(tex, canvas);
    const image = this.scene.add.image(x0, y0, tex).setOrigin(0, 0).setDepth(GROUND_DEPTH - 10_000);
    this.onSpawn?.(image);
    return { images: [image], rect: new Phaser.Geom.Rectangle(x0, y0, CHUNK, CHUNK) };
  }

  /** The sprites of one region: raised floors and their rims, ramps, the canal and its banks. */
  private region(rc: number, rr: number): Live {
    const T = this.T;
    const images: Phaser.GameObjects.Image[] = [];
    const sprite = (key: string, c: number, r: number, level: number, anchor: Vec2, size: Vec2, depth: number, frame?: number) => {
      const p = this.at(c, r, level);
      const s = this.scene.add.image(p.x, p.y, key, frame).setOrigin(anchor[0] / size[0], anchor[1] / size[1]).setDepth(depth);
      this.onSpawn?.(s);
      images.push(s);
      return s;
    };
    const isCanal = (c: number, r: number) => this.kind(c, r) === 'canal';
    for (let r = rr * REGION; r < (rr + 1) * REGION; r++) {
      for (let c = rc * REGION; c < (rc + 1) * REGION; c++) {
        const level = this.level(c, r);
        const front = frontDepth(c, r, 1, 1);
        if (isCanal(c, r)) {
          const s = sprite(T.canal.file, c, r, level, T.canal.anchor, T.canal.size, GROUND_DEPTH + 1 + (c + r) * 4, Math.max(0, this.frame) % T.canal.frames);
          this.canal.set(s, T.canal.frames);
          // Banks: the river's overlays where the neighbour is land (a corner only when both sides are canal).
          for (const o of this.overlays) {
            const [dc, dr] = o.land;
            const corner = dc !== 0 && dr !== 0;
            if (!isCanal(c + dc, r + dr) && (!corner || (isCanal(c + dc, r) && isCanal(c, r + dr)))) sprite(o.file, c, r, level, T.canal.anchor, T.canal.size, GROUND_DEPTH + 2 + (c + r) * 4);
          }
        } else if (this.raised(c, r)) {
          const top = [sprite(this.groundFile(this.kind(c, r), c, r), c, r, level, T.anchor, T.size, front - 0.32)];
          // Rims on the raised top where the NW / NE neighbour is lower (not where a ramp comes up).
          for (const [key, c2, r2] of [[T.rim.nw, c - 1, r], [T.rim.ne, c, r - 1]] as const) {
            if (this.level(c2, r2) < level && !this.rampUp(c, r, c2, r2)) top.push(sprite(key, c, r, level - 1, T.pieceAnchor, T.pieceSize, front - 0.31));
          }
          this.tops.set(`${c},${r}`, top);
        }
        const rp = this.H.ramp(c, r);
        if (rp && this.inMap(c, r)) {
          const set = T.ramps[rp.surface] ?? Object.values(T.ramps)[0];
          sprite(set[rp.dir][rp.part - 1], c, r, level, T.pieceAnchor, T.pieceSize, front - 0.3);
        }
      }
    }
    return { images, rect: regionRect(rc, rr) };
  }

  /** Makes what has come near the view and drops what's far from it (cheap while the view stays in the same cells):
   *  chunks nearest the view first and raised-ground regions, at most `budgetMs` a frame (at least one of each; the first
   *  call makes all it needs), so walking into new ground never stalls a frame. */
  stream(view: Phaser.Geom.Rectangle, budgetMs = 4): void {
    const start = performance.now();
    const spent = () => performance.now() - start >= budgetMs;
    const near = new Phaser.Geom.Rectangle(view.x - NEAR, view.y - NEAR, view.width + NEAR * 2, view.height + NEAR * 2);
    const far = new Phaser.Geom.Rectangle(view.x - FAR, view.y - FAR, view.width + FAR * 2, view.height + FAR * 2);
    const range = `${Math.floor(near.x / 128)},${Math.floor(near.y / 128)},${Math.floor(near.right / 128)},${Math.floor(near.bottom / 128)}`;
    if (range === this.lastRange && !this.pending) return;
    this.lastRange = range;
    for (const [k, l] of this.chunks) if (!Phaser.Geom.Rectangle.Overlaps(far, l.rect)) this.drop(this.chunks, k, true);
    for (const [k, l] of this.regions) if (!Phaser.Geom.Rectangle.Overlaps(far, l.rect)) this.drop(this.regions, k, false);
    // Chunks: a few a frame (nearest the view first), so walking into new ground never stalls.
    const want: [number, number][] = [];
    for (let cy = Math.floor(near.y / CHUNK); cy <= Math.floor(near.bottom / CHUNK); cy++)
      for (let cx = Math.floor(near.x / CHUNK); cx <= Math.floor(near.right / CHUNK); cx++) if (!this.chunks.has(`${cx},${cy}`)) want.push([cx, cy]);
    const mid = { x: view.centerX, y: view.centerY };
    want.sort((a, b) => Math.hypot((a[0] + 0.5) * CHUNK - mid.x, (a[1] + 0.5) * CHUNK - mid.y) - Math.hypot((b[0] + 0.5) * CHUNK - mid.x, (b[1] + 0.5) * CHUNK - mid.y));
    let baked = 0;
    // (The first time: every chunk the view shows, the margin round it after, a few a frame like the rest.)
    const inView = (cx: number, cy: number) => Phaser.Geom.Rectangle.Overlaps(view, new Phaser.Geom.Rectangle(cx * CHUNK, cy * CHUNK, CHUNK, CHUNK));
    for (const [cx, cy] of want) {
      if (this.first ? !inView(cx, cy) : baked >= BAKES_PER_FRAME || (baked && spent())) continue;
      this.chunks.set(`${cx},${cy}`, this.bake(cx, cy));
      baked++;
    }
    let left = want.length > baked;
    if (this.first && left) this.lastRange = ''; // (the margin's still to come)
    // Regions whose screen box meets the near view (one at least, then while there's time).
    const t0 = screenToTileRange(near);
    let made = 0;
    for (let rr = Math.floor(t0.r0 / REGION); rr <= Math.floor(t0.r1 / REGION); rr++) {
      for (let rc = Math.floor(t0.c0 / REGION); rc <= Math.floor(t0.c1 / REGION); rc++) {
        const k = `${rc},${rr}`;
        if (this.regions.has(k) || !Phaser.Geom.Rectangle.Overlaps(near, regionRect(rc, rr))) continue;
        if (!this.first && made && spent()) {
          left = true;
          continue;
        }
        this.regions.set(k, this.region(rc, rr));
        made++;
      }
    }
    this.pending = left && !this.first;
    this.first = false;
  }
  private pending = false;
  private first = true;
  /** Ground still to make round the view. */
  get streaming(): boolean {
    return this.pending;
  }

  private drop(set: Map<string, Live>, key: string, chunk: boolean): void {
    const l = set.get(key)!;
    if (!chunk) {
      const [rc, rr] = key.split(',').map(Number);
      for (let r = rr * REGION; r < (rr + 1) * REGION; r++) for (let c = rc * REGION; c < (rc + 1) * REGION; c++) this.tops.delete(`${c},${r}`);
      this.faded = this.faded.filter((s) => !l.images.includes(s));
    }
    for (const img of l.images) {
      this.canal.delete(img);
      const tex = chunk ? img.texture.key : null;
      img.destroy();
      if (tex && this.scene.textures.exists(tex)) this.scene.textures.remove(tex);
    }
    set.delete(key);
  }

  /** The raised ground just in front of `tile` (between it and the camera: up to 3 tiles on) that overlaps `box` (a
   *  player's sprite) at half alpha, and what was faded before back to whole (the Scrap Warrens' junk walls: nobody gets
   *  lost behind one). Null: nothing faded. */
  fadeFront(tile: { col: number; row: number } | null, box: Phaser.Geom.Rectangle | null): void {
    const was = this.faded;
    this.faded = [];
    if (tile && box) {
      for (let dc = 0; dc <= 3; dc++)
        for (let dr = 0; dr <= 3; dr++) {
          if (!dc && !dr) continue;
          for (const s of this.tops.get(`${tile.col + dc},${tile.row + dr}`) ?? []) if (Phaser.Geom.Rectangle.Overlaps(s.getBounds(), box)) this.faded.push(s);
        }
    }
    for (const s of was) if (!this.faded.includes(s)) s.setAlpha(1);
    for (const s of this.faded) s.setAlpha(0.5);
  }

  /** Advances the canal's shared clock. */
  tick(timeMs: number): void {
    const f = Math.floor((timeMs / 1000) * this.T.canal.fps);
    if (f === this.frame) return;
    this.frame = f;
    for (const [s, frames] of this.canal) s.setFrame(f % frames);
  }

  /** (Nothing to catch up: canal tiles are made on the current frame.) */
  refresh(_sprite: Phaser.GameObjects.Image): void {}
}

/** A region's screen box, with room for raised pieces and the tallest wall. */
function regionRect(rc: number, rr: number): Phaser.Geom.Rectangle {
  const c0 = rc * REGION;
  const r0 = rr * REGION;
  const c1 = c0 + REGION - 1;
  const r1 = r0 + REGION - 1;
  const x0 = (c0 - r1) * 16 - 16;
  const x1 = (c1 - r0) * 16 + 16;
  const y0 = (c0 + r0) * 8 - 16 * MAX_LEVEL - 32;
  const y1 = (c1 + r1) * 8 + 32;
  return new Phaser.Geom.Rectangle(x0, y0, x1 - x0, y1 - y0);
}

/** The tile ranges (cols and rows) that can show in a screen box. */
export function screenToTileRange(b: Phaser.Geom.Rectangle): { c0: number; c1: number; r0: number; r1: number } {
  // col = (y/8 + x/16) / 2, row = (y/8 − x/16) / 2, over the box's corners.
  const cs = [b.x / 16 + b.y / 8, b.right / 16 + b.y / 8, b.x / 16 + b.bottom / 8, b.right / 16 + b.bottom / 8].map((v) => v / 2);
  const rs = [b.y / 8 - b.x / 16, b.y / 8 - b.right / 16, b.bottom / 8 - b.x / 16, b.bottom / 8 - b.right / 16].map((v) => v / 2);
  return { c0: Math.floor(Math.min(...cs)) - 2, c1: Math.ceil(Math.max(...cs)) + 4, r0: Math.floor(Math.min(...rs)) - 2, r1: Math.ceil(Math.max(...rs)) + 4 };
}
