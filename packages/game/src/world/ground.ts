import Phaser from 'phaser';
import type { Manifest, TownMap, Vec2 } from '../assets/types';
import { tileToScreen } from '../iso';
import { GROUND_DEPTH } from './depth';
import type { OutTile } from './outskirts';
import { pick, tileRandom } from './rng';

// The ground layer. Grass picks a category by the weights of the mix named in the map's groundStyle
// (tiles.grass.mixes; "" = default), then a file (both seeded per tile). Static tiles (plain grass, litter, path,
// plaza) are baked once into CHUNK × CHUNK canvas textures, back to front. Only the moving tiles stay sprites: the
// river (a seeded variant per tile, all on one frame clock, with bank overlays) and swaying grass (starting at
// frame (col + row) % 4). They are only animated while visible (the scene culls off-screen sprites). The outskirts'
// tiles (world/outskirts.ts) are laid the same way, after the map's.

const CHUNK = 512; // px of world per baked ground texture

interface Clocked {
  sprite: Phaser.GameObjects.Image;
  offset: number;
  frames: number;
}

interface GrassMixes {
  files: Record<string, string[]>;
  [mix: string]: Record<string, number> | Record<string, string[]> | string;
}

export class Ground {
  /** Every ground sprite (baked chunks and moving tiles), for the day/night tint. */
  readonly sprites: Phaser.GameObjects.Image[] = [];
  /** Moving tiles, which the scene hides while off screen. */
  readonly cullable: Phaser.GameObjects.Image[] = [];
  private readonly water: Clocked[] = [];
  private readonly sway: Clocked[] = [];
  private readonly clocked = new Map<Phaser.GameObjects.Image, Clocked & { kind: 'water' | 'sway' }>();
  private readonly waterFps: number;
  private readonly swayFps: number;
  private waterFrame = -1;
  private swayFrame = -1;

  constructor(scene: Phaser.Scene, M: Manifest, map: TownMap, outside: OutTile[] = []) {
    const [cols, rows] = map.size;
    const grass = M.tiles.grass;
    const mixes = (grass as unknown as { mixes: GrassMixes }).mixes;
    const swayFor = new Map(Object.values(grass.animated).map((a) => [a.replaces, a]));
    this.swayFps = Object.values(grass.animated)[0]?.fps ?? 4;
    this.waterFps = M.tiles.water.fps;
    const out = new Map(outside.map((t) => [`${t.col},${t.row}`, t]));
    // Past the map: the outskirts' tile, or water (no bank on the far side of the river where nothing is drawn).
    const isWater = (c: number, r: number) =>
      c < 0 || r < 0 || c >= cols || r >= rows ? (out.get(`${c},${r}`)?.kind ?? 'water') === 'water' : map.ground[r][c] === 'water';
    const overlays = Object.values(M.tiles.water.overlays).filter((o): o is { file: string; land: Vec2 } => typeof o === 'object');

    // Static tiles to bake, in back-to-front order.
    const baked: { key: string; x: number; y: number; ox: number; oy: number }[] = [];
    const bake = (key: string, c: number, r: number, anchor: Vec2) => {
      const top = tileToScreen(c, r);
      baked.push({ key, x: top.x, y: top.y + 8, ox: anchor[0], oy: anchor[1] }); // anchors are the diamond centre
    };
    const sprite = (key: string, c: number, r: number, size: Vec2, anchor: Vec2, layer: number, frame?: number) => {
      const top = tileToScreen(c, r);
      const s = scene.add.image(top.x, top.y + 8, key, frame);
      s.setOrigin(anchor[0] / size[0], anchor[1] / size[1]).setDepth(GROUND_DEPTH + 1 + (c + r) * 4 + layer);
      this.sprites.push(s);
      this.cullable.push(s);
      return s;
    };

    const tiles: { c: number; r: number; kind: string; style: string }[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) tiles.push({ c, r, kind: map.ground[r][c], style: map.groundStyle?.[r]?.[c] ?? '' });
    for (const t of outside) tiles.push({ c: t.col, r: t.row, kind: t.kind, style: t.style });
    tiles.sort((a, b) => a.r - b.r || a.c - b.c); // back to front

    for (const { c, r, kind, style } of tiles) {
      if (kind === 'grass') {
        const name = style || 'default';
        const mix = (mixes[name] ?? mixes.default) as Record<string, number>;
        let roll = tileRandom(c, r, 2);
        let category = Object.keys(mix)[0];
        for (const [cat, weight] of Object.entries(mix)) {
          category = cat;
          if (roll < weight) break;
          roll -= weight;
        }
        const file = pick(mixes.files[category] ?? grass.files, tileRandom(c, r, 3));
        const anim = swayFor.get(file);
        if (anim) {
          const offset = (c + r) % anim.frames; // a wind wave rolls across the meadow
          const t = { sprite: sprite(anim.file, c, r, anim.frameSize, grass.anchor, 0, offset), offset, frames: anim.frames };
          this.sway.push(t);
          this.clocked.set(t.sprite, { ...t, kind: 'sway' });
        } else {
          bake(file, c, r, grass.anchor);
        }
      } else if (kind === 'path') {
        bake(pick(M.tiles.path.files, tileRandom(c, r, 4)), c, r, M.tiles.path.anchor);
      } else if (kind === 'plaza') {
        const t = M.tiles.plaza;
        // mix: { "tile-plaza-1": 0.6, "others": 0.4 } — named files by weight, the rest share "others".
        const named = Object.entries(t.mix).filter(([k]) => k !== 'others');
        const others = t.files.filter((f) => !named.some(([k]) => f.endsWith(`/${k}.png`)));
        let roll = tileRandom(c, r, 5);
        let file: string | undefined;
        for (const [k, w] of named) {
          if (roll < w) {
            file = t.files.find((f) => f.endsWith(`/${k}.png`));
            break;
          }
          roll -= w;
        }
        file ??= pick(others, roll / (t.mix.others ?? 1));
        bake(file, c, r, t.anchor);
      } else {
        const t = M.tiles.water;
        const variant = pick(t.variants, tileRandom(c, r, 6));
        const w = { sprite: sprite(variant, c, r, t.size, t.anchor, 0, 0), offset: 0, frames: t.frames };
        this.water.push(w);
        this.clocked.set(w.sprite, { ...w, kind: 'water' });
        // Bank overlays: sides where the neighbour is land; a corner only when that diagonal is land and both
        // sides next to it are water.
        for (const o of overlays) {
          const [dc, dr] = o.land;
          const land = !isWater(c + dc, r + dr);
          const corner = dc !== 0 && dr !== 0;
          if (land && (!corner || (isWater(c + dc, r) && isWater(c, r + dr)))) sprite(o.file, c, r, t.size, t.anchor, 1);
        }
      }
    }
    this.bakeChunks(scene, baked);
  }

  /** Draws the static tiles into CHUNK-sized canvases (a tile on a seam is drawn into each chunk it touches). */
  private bakeChunks(scene: Phaser.Scene, tiles: { key: string; x: number; y: number; ox: number; oy: number }[]): void {
    const chunks = new Map<string, { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; cx: number; cy: number }>();
    const source = new Map<string, CanvasImageSource>();
    for (const t of tiles) {
      let img = source.get(t.key);
      if (!img) {
        img = scene.textures.get(t.key).getSourceImage() as CanvasImageSource;
        source.set(t.key, img);
      }
      const w = (img as HTMLImageElement).width;
      const h = (img as HTMLImageElement).height;
      const left = Math.round(t.x - t.ox);
      const top = Math.round(t.y - t.oy);
      for (let cy = Math.floor(top / CHUNK); cy <= Math.floor((top + h - 1) / CHUNK); cy++) {
        for (let cx = Math.floor(left / CHUNK); cx <= Math.floor((left + w - 1) / CHUNK); cx++) {
          const key = `${cx},${cy}`;
          let chunk = chunks.get(key);
          if (!chunk) {
            const canvas = document.createElement('canvas');
            canvas.width = CHUNK;
            canvas.height = CHUNK;
            const ctx = canvas.getContext('2d')!;
            ctx.imageSmoothingEnabled = false;
            chunk = { canvas, ctx, cx, cy };
            chunks.set(key, chunk);
          }
          chunk.ctx.drawImage(img, left - cx * CHUNK, top - cy * CHUNK);
        }
      }
    }
    for (const [key, c] of chunks) {
      const tex = `ground-chunk:${key}`;
      if (scene.textures.exists(tex)) scene.textures.remove(tex);
      scene.textures.addCanvas(tex, c.canvas);
      // Under every moving tile, including the outskirts' (whose col + row is negative).
      const img = scene.add.image(c.cx * CHUNK, c.cy * CHUNK, tex).setOrigin(0, 0).setDepth(GROUND_DEPTH - 10_000);
      this.sprites.push(img);
      this.cullable.push(img);
    }
  }

  /** Advances the shared river clock and the meadow sway, for tiles on screen. */
  tick(timeMs: number): void {
    const w = Math.floor((timeMs / 1000) * this.waterFps);
    if (w !== this.waterFrame) {
      this.waterFrame = w;
      for (const t of this.water) if (t.sprite.visible) t.sprite.setFrame(w % t.frames);
    }
    const s = Math.floor((timeMs / 1000) * this.swayFps);
    if (s !== this.swayFrame) {
      this.swayFrame = s;
      for (const t of this.sway) if (t.sprite.visible) t.sprite.setFrame((s + t.offset) % t.frames);
    }
  }

  /** Brings a tile that just came on screen up to the current frame. */
  refresh(sprite: Phaser.GameObjects.Image): void {
    const t = this.clocked.get(sprite);
    if (!t) return;
    const clock = Math.max(0, t.kind === 'water' ? this.waterFrame : this.swayFrame);
    sprite.setFrame((clock + t.offset) % t.frames);
  }
}
