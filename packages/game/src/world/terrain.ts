import Phaser from 'phaser';
import type { Manifest, MapTiles, TownMap, Vec2 } from '../assets/types';
import { tileToScreen } from '../iso';
import { CHARACTER_BIAS, GROUND_DEPTH } from './depth';
import type { Heights } from './heights';
import { LEVEL_PX, RAMP_STEP } from './heights';
import type { BigOutskirts } from './outskirts';
import { pick, seedOf, tileRandom, variantAt } from './rng';

// 🏚️ The ground of a big map: the Slums and the Scrap Warrens (raised and low ground, manifest tiles.slums, rules in
// mikazuki-assets tiles/slums/slums-elevation-README.md and slums-high-terrain-README.md; words in CONTEXT.md "Ground")
// or the Lumang Palengke (flat, tiles.palengke): the map's `tileset`. A flat map has no walls, rims or ramps; its
// `animated` families (the Palengke's shallow flood and deep pools) are sprites on a shared clock like the canal, a
// variant per tile, with the river's bank overlays where a `banks` family meets other ground.
// Each tile's floor is drawn 16 px × its level higher; levels run from the map's lowest to its highest (Heights.min /
// max), below 0 being void (a chasm's floor). A tile shows a wall (cliff-<material>-l|r, a variant seeded by col,row)
// for every level its SW / SE neighbour is lower, stacked 16 px apart: the top step in the material's own pieces, every
// step below it in its `lower` pieces where it has them (rock, scrap), the foot line on the lowest step (`foot`); steps
// below 0 are a chasm's walls ('chasm' one level down, 'chasm-deep' below that), whatever the tile's material. A navy
// rim where its NW / NE neighbour is lower, a chasm lip (`lip`, variants) where that neighbour is void, and caps on
// corners above ground; ramps are pieces over their two tiles.
//
// Drawn in two ways. Ground that hides nothing (flat ground at any level, the walls down into chasms, lips) is baked
// into CHUNK-sized canvases under everything, in the README's order (per level from low to high: floors, then the walls
// of the step up; back to front). A tile that rises over ground behind it, high enough to hide what stands there (a
// level up per two tiles back: `column`), is a column of sprites (its floor, its walls down to each lower neighbour,
// rims, lips and caps) sorted with the characters and objects just under a character standing on it (`columnDepth`): so
// a player or mob behind a bluff, mesa or Warrens wall is hidden by it, while one standing on it, or in front, is drawn
// over it (`fadeFront` then fades the columns that hide the local player). The canal is animated sprites with the river's bank overlays, like
// the town's water. Past the map: its outskirts' dirt, canal and road (world/outskirts.ts).
//
// The map is big (256 × 192), so all of it is made only near the camera (stream): chunks and 16 × 16-tile regions of
// sprites as they come within reach, dropped again once well away.

const CHUNK = 512; // px of world per baked canvas
const REGION = 16; // tiles per side of a region of sprites
const NEAR = 256; // px round the view: made by then
const FAR = 1024; // px round the view: dropped past this
const BAKES_PER_FRAME = 3;

interface Piece {
  key: string;
  x: number;
  y: number;
  ox: number;
  oy: number;
  order: number;
}

/** A sprite of a raised column: its piece, where (the tile and level it's anchored at) and its depth under the column's. */
interface ColumnPiece {
  key: string;
  level: number;
  anchor: Vec2;
  size: Vec2;
  /** Taken off the column's depth (`columnDepth`): walls lowest, then caps, the floor, then rims and lips on top. */
  under: number;
}

interface Live {
  images: Phaser.GameObjects.Image[];
  rect: Phaser.Geom.Rectangle;
}

export class Terrain {
  /** Nothing for the scene's culler: what's made is what's near (stream). */
  readonly cullable: Phaser.GameObjects.Image[] = [];
  private readonly T: MapTiles;
  private readonly cols: number;
  private readonly rows: number;
  private readonly chunks = new Map<string, Live>();
  private readonly regions = new Map<string, Live>();
  private readonly canal = new Map<Phaser.GameObjects.Image, { frames: number; fps: number; kind: string }>(); // animated ground sprites
  /** Families running faster for a while (Ang Silong's belts in a Belt Rush): × `k` until the clock's `until`. */
  private fast: { kinds: Set<string>; k: number; until: number } | null = null;
  /** Every raised column's sprites by tile ("c,r"), while its region is made: what `fadeFront` fades. */
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
    private readonly out: BigOutskirts | null,
  ) {
    this.T = (M.tiles[map.tileset ?? 'slums'] ?? M.tiles.slums) as MapTiles;
    [this.cols, this.rows] = map.size;
    this.columns = new Uint8Array(this.cols * this.rows);
    this.overlays = Object.values(M.tiles.water.overlays).filter((o): o is { file: string; land: Vec2 } => typeof o === 'object');
  }

  /** Every image there is now (chunks and sprites), for the day/night tint. */
  get sprites(): Phaser.GameObjects.Image[] {
    return [...this.chunks.values(), ...this.regions.values()].flatMap((l) => l.images);
  }

  /** A ground tile's file: one of its kind's variants, picked by a well-mixed hash of col, row seeded per kind (rng.ts
   *  mix32), so no repeats line up. */
  private groundFile(kind: string, c: number, r: number): string {
    const base = this.T.ground.dirt ? 'dirt' : Object.keys(this.T.ground)[0];
    const name = kind in this.T.ground ? kind : base;
    return variantAt(this.T.ground[name], c, r, seedOf(name), this.T.plainVariants, this.T.plainWeight);
  }

  /** An animated family's sprite for a tile (the canal, the Palengke's water), or null: baked ground. */
  private animatedAt(kind: string): { file: (c: number, r: number) => string; frames: number; fps: number; size: Vec2; anchor: Vec2 } | null {
    const T = this.T;
    if (kind === 'canal' && T.canal) {
      const c = T.canal;
      return { file: () => c.file, frames: c.frames, fps: c.fps, size: c.size, anchor: c.anchor };
    }
    const a = T.animated?.[kind];
    return a ? { file: (c, r) => variantAt(a.files, c, r, seedOf(kind)), frames: a.frames, fps: a.fps, size: a.size, anchor: a.anchor } : null;
  }

  /** Whether a family gets the river's bank overlays where it meets other ground. */
  private banked(kind: string): boolean {
    return kind === 'canal' || !!this.T.banks?.includes(kind);
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

  /** Whether a tile rises over ground behind it high enough to hide what stands there, so it's a column of sorted
   *  sprites rather than baked: a tile `s` steps behind (col + row less by s, on the same screen column, give or take a
   *  tile) and lower by `d` levels is covered when s ≤ 2·d (a level is 16 px, a step back 8). Worked out once a tile. */
  private column(c: number, r: number): boolean {
    if (!this.inMap(c, r)) return false;
    const i = r * this.cols + c;
    if (this.columns[i]) return this.columns[i] === 2;
    const level = this.level(c, r);
    let yes = false;
    for (let s = 1; !yes && level > this.H.min && s <= 2 * (level - this.H.min); s++) {
      for (let dc = 0; dc <= s && !yes; dc++) {
        const dr = s - dc;
        if (Math.abs(dc - dr) > 1) continue;
        const behind = this.level(c - dc, r - dr);
        if (behind < level && s <= 2 * (level - behind)) yes = true;
      }
    }
    this.columns[i] = yes ? 2 : 1;
    return yes;
  }
  /** Each tile's `column` answer once worked out (0: not yet, 1: no, 2: yes). */
  private readonly columns: Uint8Array;

  /** The edge from (c, r) to (c2, r2) is where a ramp's part 2 meets the high tile it leads up to: no wall or rim. */
  private rampUp(c: number, r: number, c2: number, r2: number): boolean {
    const rp = this.H.ramp(c2, r2);
    if (!rp || rp.part !== 2) return false;
    const [dc, dr] = RAMP_STEP[rp.dir];
    return c2 + dc === c && r2 + dr === r;
  }

  /** The wall piece for one step of a tile's wall: step `S` (the level it stands on) of a wall whose top step is `top`,
   *  on side `side`; chasm pieces below 0, else the tile's material (its `lower` pieces under the top step). */
  private wallPiece(c: number, r: number, side: 'l' | 'r', S: number, top: number): string {
    const cliffs = this.T.cliffs!;
    const name = S < -1 ? 'chasm-deep' : S < 0 ? 'chasm' : this.map.walls?.[r]?.[c] || 'earth';
    const mat = cliffs[name] ?? cliffs.earth ?? Object.values(cliffs)[0];
    const set = S < top && mat.lower ? mat.lower : mat;
    return pick(set[side], tileRandom(c, r, (side === 'l' ? 32 : 36) + S + 8));
  }

  /** Every piece of a tile besides its floor and ramp: its walls (with their foot), caps, rims and lips. `add` takes
   *  the piece, the level it's anchored at, its phase in the baked order (1 walls, 2 rims) and its depth under a
   *  column's depth (sprites). */
  private edgePieces(c: number, r: number, add: (key: string, L: number, phase: number, under: number) => void): void {
    const T = this.T as Required<Pick<MapTiles, 'cliffs' | 'rim' | 'cap'>> & MapTiles;
    if (!T.cliffs || !T.rim || !T.cap) return; // (a flat map: nothing but floors)
    const level = this.level(c, r);
    const wall = (side: 'l' | 'r', c2: number, r2: number) => {
      const below = this.level(c2, r2);
      if (below >= level || this.rampUp(c, r, c2, r2)) return false;
      for (let S = below; S < level; S++) add(this.wallPiece(c, r, side, S, level - 1), S, 1, 0.34);
      // The foot line where the wall meets the ground (not a chasm's floor).
      if (T.foot && below >= 0) add(T.foot[side], below, 1, 0.33);
      return true;
    };
    const left = wall('l', c, r + 1);
    const right = wall('r', c + 1, r);
    // Corner edges, above ground.
    if (left && this.level(c - 1, r) < level && this.level(c - 1, r + 1) < level) {
      for (let S = Math.max(0, this.level(c, r + 1)); S < level; S++) add(T.cap.w, S, 1, 0.32);
    }
    if (right && this.level(c, r - 1) < level && this.level(c + 1, r - 1) < level) {
      for (let S = Math.max(0, this.level(c + 1, r)); S < level; S++) add(T.cap.e, S, 1, 0.32);
    }
    // Rims on the top where the NW / NE neighbour is lower (not where a ramp comes up); a chasm lip where it's void.
    for (const [which, c2, r2] of [['nw', c - 1, r], ['ne', c, r - 1]] as const) {
      const n = this.level(c2, r2);
      if (n >= level || this.rampUp(c, r, c2, r2)) continue;
      const lips = T.lip?.[which];
      const key = n < 0 && lips?.length ? pick(lips, tileRandom(c, r, which === 'nw' ? 40 : 41)) : T.rim[which];
      add(key, level - 1, 2, 0.3);
    }
  }

  /** A baked tile's pieces (any that isn't a column): its floor, its walls (down into a chasm too), caps, rims, lips. */
  private bakedPieces(c: number, r: number, out: Piece[]): void {
    const T = this.T;
    const level = this.level(c, r);
    if (this.column(c, r)) return; // (a column of sprites)
    const kind = this.kind(c, r);
    const order = (L: number, phase: number) => L * 1e6 + phase * 1e5 + (c + r + 1000) * 10;
    const add = (key: string, L: number, phase: number, anchor: Vec2) => {
      const p = this.at(c, r, L);
      out.push({ key, x: p.x, y: p.y, ox: anchor[0], oy: anchor[1], order: order(L, phase) });
    };
    if (!this.animatedAt(kind)) add(this.groundFile(kind, c, r), level, 0, T.anchor);
    if (!this.inMap(c, r)) return; // (the outskirts: a floor, nothing else)
    this.edgePieces(c, r, (key, L, phase) => add(key, L, phase, T.pieceAnchor!));
  }

  /** A raised tile's column (level 1 and up): its floor, walls, caps, rims and lips, as sorted sprites. */
  private columnPieces(c: number, r: number): ColumnPiece[] {
    const T = this.T;
    const level = this.level(c, r);
    const out: ColumnPiece[] = [{ key: this.groundFile(this.kind(c, r), c, r), level, anchor: T.anchor, size: T.size, under: 0.31 }];
    this.edgePieces(c, r, (key, L, _phase, under) => out.push({ key, level: L, anchor: T.pieceAnchor!, size: T.pieceSize!, under }));
    return out;
  }

  /** Bakes one chunk: every flat tile whose pieces can reach it, in the global order. */
  private bake(cx: number, cy: number): Live {
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    // A tile (c, r) draws within x (c − r)·16 ± 16 and y (c + r)·8 − 24 − 16·its level … (c + r)·8 + 24 + 16·(its depth
    // into a chasm).
    const down = 16 * Math.max(0, -this.H.min);
    const up = 16 * Math.max(0, this.H.max);
    const d0 = Math.floor((x0 - 16) / 16) - 1;
    const d1 = Math.ceil((x0 + CHUNK + 16) / 16) + 1;
    const s0 = Math.floor((y0 - 24 - down) / 8) - 1;
    const s1 = Math.ceil((y0 + CHUNK + 24 + up) / 8) + 1;
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

  /** The sprites of one region: raised columns, ramps, the canal and its banks. */
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
    for (let r = rr * REGION; r < (rr + 1) * REGION; r++) {
      for (let c = rc * REGION; c < (rc + 1) * REGION; c++) {
        const level = this.level(c, r);
        const kind = this.kind(c, r);
        const anim = this.animatedAt(kind);
        if (anim) {
          const s = sprite(anim.file(c, r), c, r, level, anim.anchor, anim.size, GROUND_DEPTH + 1 + (c + r) * 4, this.frameOf(anim.fps) % anim.frames);
          this.canal.set(s, { frames: anim.frames, fps: anim.fps, kind });
          // Banks: the river's overlays where the neighbour is other ground (a corner only when both sides are the same).
          if (this.banked(kind)) {
            const same = (c2: number, r2: number) => this.kind(c2, r2) === kind;
            for (const o of this.overlays) {
              const [dc, dr] = o.land;
              const corner = dc !== 0 && dr !== 0;
              if (!same(c + dc, r + dr) && (!corner || (same(c + dc, r) && same(c, r + dr)))) sprite(o.file, c, r, level, anim.anchor, anim.size, GROUND_DEPTH + 2 + (c + r) * 4);
            }
          }
        } else if (this.column(c, r)) {
          // A column: just under a character standing on it, over anyone behind it (whom it hides).
          const base = columnDepth(c, r);
          const column = this.columnPieces(c, r).map((p) => sprite(p.key, c, r, p.level, p.anchor, p.size, base - p.under));
          this.tops.set(`${c},${r}`, column);
        }
        const rp = this.H.ramp(c, r);
        if (rp && this.inMap(c, r) && T.ramps) {
          const set = T.ramps[rp.surface] ?? Object.values(T.ramps)[0];
          sprite(set[rp.dir][rp.part - 1], c, r, level, T.pieceAnchor!, T.pieceSize!, columnDepth(c, r) - 0.3); // (under whoever walks on it)
        }
      }
    }
    return { images, rect: this.regionRect(rc, rr) };
  }

  /** A region's screen box, with room for its tallest column and its ramps. */
  private regionRect(rc: number, rr: number): Phaser.Geom.Rectangle {
    const c0 = rc * REGION;
    const r0 = rr * REGION;
    const c1 = c0 + REGION - 1;
    const r1 = r0 + REGION - 1;
    const x0 = (c0 - r1) * 16 - 16;
    const x1 = (c1 - r0) * 16 + 16;
    const y0 = (c0 + r0) * 8 - 16 * this.H.max - 32;
    const y1 = (c1 + r1) * 8 + 32;
    return new Phaser.Geom.Rectangle(x0, y0, x1 - x0, y1 - y0);
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
    const t0 = screenToTileRange(near, this.H.max);
    let made = 0;
    for (let rr = Math.floor(t0.r0 / REGION); rr <= Math.floor(t0.r1 / REGION); rr++) {
      for (let rc = Math.floor(t0.c0 / REGION); rc <= Math.floor(t0.c1 / REGION); rc++) {
        const k = `${rc},${rr}`;
        if (this.regions.has(k) || !Phaser.Geom.Rectangle.Overlaps(near, this.regionRect(rc, rr))) continue;
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

  /** The raised columns just in front of `tile` (between it and the camera: as many tiles on as the map's highest level
   *  is tall, since a column one level tall covers one tile behind it) that overlap `box` (a player's sprite) at half
   *  alpha, and what was faded before back to whole (a bluff, a mesa, the Scrap Warrens' junk walls: nobody gets lost
   *  behind one). Null: nothing faded. */
  fadeFront(tile: { col: number; row: number } | null, box: Phaser.Geom.Rectangle | null): void {
    const was = this.faded;
    this.faded = [];
    if (tile && box) {
      const reach = Math.max(3, this.H.max + 1);
      for (let dc = 0; dc <= reach; dc++)
        for (let dr = 0; dr <= reach; dr++) {
          if (!dc && !dr) continue;
          for (const s of this.tops.get(`${tile.col + dc},${tile.row + dr}`) ?? []) if (Phaser.Geom.Rectangle.Overlaps(s.getBounds(), box)) this.faded.push(s);
        }
    }
    for (const s of was) if (!this.faded.includes(s)) s.setAlpha(1);
    for (const s of this.faded) s.setAlpha(0.5);
  }

  /** Advances the animated ground's shared clock (each family at its own fps; checked a tenth of a second at a time). */
  tick(timeMs: number): void {
    const f = Math.floor(timeMs / 100);
    if (f === this.frame) return;
    this.frame = f;
    this.now = timeMs;
    const fast = this.fast && timeMs < this.fast.until ? this.fast : null;
    for (const [s, a] of this.canal) {
      const want = this.frameOf(a.fps * (fast?.kinds.has(a.kind) ? fast.k : 1)) % a.frames;
      if (String(s.frame.name) !== String(want)) s.setFrame(want);
    }
  }
  private now = 0;
  /** These families × `k` as fast for `ms` (Belt Rush: the belts). */
  speedUp(kinds: string[], k: number, ms: number): void {
    this.fast = { kinds: new Set(kinds), k, until: this.now + ms };
  }
  /** The shared clock's frame at `fps`. */
  private frameOf(fps: number): number {
    return Math.max(0, Math.floor((this.now / 1000) * fps));
  }

  /** (Nothing to catch up: animated tiles are made on the current frame.) */
  refresh(_sprite: Phaser.GameObjects.Image): void {}
}

/** The tile ranges (cols and rows) that can show in a screen box: a column `maxLevel` high draws that many tiles' worth
 *  (two per level) above its own. */
export function screenToTileRange(b: Phaser.Geom.Rectangle, maxLevel = 2): { c0: number; c1: number; r0: number; r1: number } {
  // col = (y/8 + x/16) / 2, row = (y/8 − x/16) / 2, over the box's corners.
  const cs = [b.x / 16 + b.y / 8, b.right / 16 + b.y / 8, b.x / 16 + b.bottom / 8, b.right / 16 + b.bottom / 8].map((v) => v / 2);
  const rs = [b.y / 8 - b.x / 16, b.y / 8 - b.right / 16, b.bottom / 8 - b.x / 16, b.bottom / 8 - b.right / 16].map((v) => v / 2);
  const up = 2 + 2 * Math.max(0, maxLevel);
  return { c0: Math.floor(Math.min(...cs)) - 2, c1: Math.ceil(Math.max(...cs)) + up, r0: Math.floor(Math.min(...rs)) - 2, r1: Math.ceil(Math.max(...rs)) + up };
}

/** A column's depth: just under a character standing on its tile (whose feet sort at (col + row + 1)·8 + CHARACTER_BIAS),
 *  over every character behind it; its pieces go a little under this (walls lowest, rims on top). */
const columnDepth = (c: number, r: number): number => (c + r + 1) * 8 + CHARACTER_BIAS - 0.05;
