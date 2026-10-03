import Phaser from 'phaser';
import type { Manifest, TownMap } from '../assets/types';
import { tileToScreen } from '../iso';
import { GROUND_DEPTH } from './depth';
import { pick, tileRandom } from './rng';

// The ground layer: one sprite per tile, drawn back to front. Grass uses the manifest mix (or the map's
// groundStyle: "lush" / "litter"); tall grass and flowers sway; the river picks a seeded water variant per tile,
// shares one frame clock, and gets bank overlays by the manifest rule.

/** groundStyle "lush" (maps/town.json treeGrounding note): 55% tall grass, 15% flowers, 30% plain. */
const LUSH_MIX = { plain: 0.3, tall: 0.55, flowers: 0.15 };

type GrassKind = 'plain' | 'tall' | 'flowers';
const grassKind = (file: string): GrassKind => (/-tall-/.test(file) ? 'tall' : /-flowers-/.test(file) ? 'flowers' : 'plain');

interface Clocked {
  sprite: Phaser.GameObjects.Image;
  offset: number;
  frames: number;
}

export class Ground {
  /** Every ground sprite, for the day/night tint. */
  readonly sprites: Phaser.GameObjects.Image[] = [];
  private readonly water: Clocked[] = [];
  private readonly sway: Clocked[] = [];
  private readonly waterFps: number;
  private readonly swayFps: number;
  private waterFrame = -1;
  private swayFrame = -1;

  constructor(scene: Phaser.Scene, M: Manifest, map: TownMap) {
    const [cols, rows] = map.size;
    const grass = M.tiles.grass;
    const byKind: Record<GrassKind, string[]> = { plain: [], tall: [], flowers: [] };
    for (const f of grass.files) byKind[grassKind(f)].push(f);
    const swayFor = new Map(Object.values(grass.animated).map((a) => [a.replaces, a]));
    this.swayFps = Object.values(grass.animated)[0]?.fps ?? 4;
    this.waterFps = M.tiles.water.fps;

    const isWater = (c: number, r: number) => c < 0 || r < 0 || c >= cols || r >= rows || map.ground[r][c] === 'water';
    const overlays = Object.values(M.tiles.water.overlays).filter((o): o is { file: string; land: [number, number] } => typeof o === 'object');

    const place = (key: string, c: number, r: number, size: [number, number], anchor: [number, number], layer: number, frame?: number) => {
      const top = tileToScreen(c, r);
      const s = scene.add.image(top.x, top.y + 8, key, frame); // anchors are the diamond centre
      s.setOrigin(anchor[0] / size[0], anchor[1] / size[1]).setDepth(GROUND_DEPTH + (c + r) * 4 + layer);
      this.sprites.push(s);
      return s;
    };

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const kind = map.ground[r][c];
        if (kind === 'grass') {
          const style = map.groundStyle?.[r]?.[c] ?? '';
          if (style === 'litter') {
            place(pick(grass.litter.files, tileRandom(c, r, 1)), c, r, grass.litter.size, grass.litter.anchor, 0);
            continue;
          }
          const mix = style === 'lush' ? LUSH_MIX : grass.mix;
          const roll = tileRandom(c, r, 2);
          const k: GrassKind = roll < mix.plain ? 'plain' : roll < mix.plain + mix.tall ? 'tall' : 'flowers';
          const file = pick(byKind[k], tileRandom(c, r, 3));
          const anim = swayFor.get(file);
          if (anim) {
            // Start at (col + row) % frames so a wind wave rolls across the meadow.
            const offset = (c + r) % anim.frames;
            this.sway.push({ sprite: place(anim.file, c, r, anim.frameSize, grass.anchor, 0, offset), offset, frames: anim.frames });
          } else {
            place(file, c, r, grass.size, grass.anchor, 0);
          }
        } else if (kind === 'path') {
          const t = M.tiles.path;
          place(pick(t.files, tileRandom(c, r, 4)), c, r, t.size, t.anchor, 0);
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
          place(file, c, r, t.size, t.anchor, 0);
        } else {
          const t = M.tiles.water;
          const variant = pick(t.variants, tileRandom(c, r, 6));
          this.water.push({ sprite: place(variant, c, r, t.size, t.anchor, 0, 0), offset: 0, frames: t.frames });
          // Bank overlays: sides where the neighbour is land; a corner only when that diagonal is land and both
          // sides next to it are water.
          for (const o of overlays) {
            const [dc, dr] = o.land;
            const land = !isWater(c + dc, r + dr);
            const corner = dc !== 0 && dr !== 0;
            if (land && (!corner || (isWater(c + dc, r) && isWater(c, r + dr)))) place(o.file, c, r, t.size, t.anchor, 1);
          }
        }
      }
    }
  }

  /** Advances the shared river clock and the meadow sway. */
  tick(timeMs: number): void {
    const w = Math.floor((timeMs / 1000) * this.waterFps);
    if (w !== this.waterFrame) {
      this.waterFrame = w;
      for (const t of this.water) t.sprite.setFrame(w % t.frames);
    }
    const s = Math.floor((timeMs / 1000) * this.swayFps);
    if (s !== this.swayFrame) {
      this.swayFrame = s;
      for (const t of this.sway) t.sprite.setFrame((s + t.offset) % t.frames);
    }
  }
}
