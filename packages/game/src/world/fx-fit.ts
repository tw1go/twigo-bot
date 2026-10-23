import type Phaser from 'phaser';
import type { FxDef } from '../assets/types';
import { iso } from './telegraph';

// 📏 Fitting an effect's art to the area it marks (the boss moves' red warning shapes, world/telegraph.ts): how far its
// pixels reach from its anchor, over every frame, worked out once per sheet; then the one scale (x and y alike, the
// game's nearest-neighbour filtering) that puts its outer edge on the shape's.

interface Reach {
  /** The farthest a pixel reaches left or right of the anchor (px). */
  half: number;
  /** The farthest a pixel's corner is from the anchor, any way (px). */
  far: number;
}

const reaches = new Map<string, Reach | null>();

/** How far an effect's pixels reach from its anchor, over all its frames (null: its sheet isn't loaded). */
function reachOf(scene: Phaser.Scene, def: FxDef): Reach | null {
  const file = def.file;
  if (!file || !scene.textures.exists(file)) return null;
  if (reaches.has(file)) return reaches.get(file)!;
  const [w, h] = def.frame ?? def.size ?? [0, 0];
  const [ax, ay] = def.anchor ?? [w / 2, h / 2];
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  let reach: Reach | null = null;
  for (let i = 0; i < (def.frames ?? 1); i++) {
    const f = scene.textures.getFrame(file, i);
    if (!f) continue;
    g.clearRect(0, 0, w, h);
    // (A trimmed frame's pixels start f.x, f.y into it.)
    g.drawImage(f.source.image as CanvasImageSource, f.cutX, f.cutY, f.cutWidth, f.cutHeight, f.x, f.y, f.cutWidth, f.cutHeight);
    const d = g.getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] < 128) continue;
        reach ??= { half: 0, far: 0 };
        reach.half = Math.max(reach.half, ax - x, x + 1 - ax);
        reach.far = Math.max(reach.far, Math.hypot(Math.max(ax - x, x + 1 - ax), Math.max(ay - y, y + 1 - ay)));
      }
  }
  reaches.set(file, reach);
  return reach;
}

/** The scale that puts an effect's outer edge on a grid circle of `radius` tiles (drawn 2:1, radius·16√2 to each side);
 *  1 when its sheet isn't loaded. `grow`: only ever larger (art already as big as its circle stays as drawn). */
export function circleScale(scene: Phaser.Scene, def: FxDef, radius: number, grow = false): number {
  const r = reachOf(scene, def);
  if (!r?.half) return 1;
  const k = (radius * 16 * Math.SQRT2) / r.half;
  return grow ? Math.max(1, k) : k;
}

/** The scale that takes a cone's art (its anchor the narrow end) out to the far edge of a grid cone `length` tiles long,
 *  `angle` degrees wide, facing `facing` (radians, grid): the cone's farthest point on screen from its origin. */
export function coneScale(scene: Phaser.Scene, def: FxDef, length: number, angle: number, facing: number): number {
  const r = reachOf(scene, def);
  if (!r?.far) return 1;
  const half = ((angle / 2) * Math.PI) / 180;
  let far = 0;
  for (let i = 0; i <= 16; i++) {
    const a = facing - half + (2 * half * i) / 16;
    const p = iso(Math.cos(a) * length, Math.sin(a) * length);
    far = Math.max(far, Math.hypot(p.x, p.y));
  }
  return far / r.far;
}
