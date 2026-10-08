import type Phaser from 'phaser';

// 🌗 A prop's own shadow on the ground (the Slums: their junk, wrecks, shacks and dead trees came with none and looked
// pasted on): its silhouette, every pixel moved back along the light by its height above the bottom of its column
// (LEAN across, DROP down per px of height), so it falls down and to the right from where it stands (the sun in the
// north-west), darkest at its foot. Baked once per image (and flip) into a canvas texture whose top-left lines up with
// the image's, `extra` px wider to the right and `below` px taller; drawn on the ground under everyone, in the palette's
// outline colour.

const LEAN = 0.55; // px to the right per px of height
const DROP = 0.3; // px down per px of height (the shadow lies flatter than the thing, toward the viewer: sun in the north-west)
const COLOUR = [30, 27, 58]; // #1E1B3A, the palette's outline
const ALPHA = 0.42; // at its foot
const FADE = 0.55; // how much lighter at its far end

export interface CastShadow {
  key: string;
  /** How much wider than the image (px, to the right). */
  extra: number;
  /** Its height (px; taller than the image, the shadow reaching below its foot). */
  height: number;
}

const made = new Map<string, CastShadow | null>();

/** The shadow texture for an image (by its texture key), mirrored with it; null if it isn't loaded. */
export function castShadow(scene: Phaser.Scene, file: string, flip: boolean): CastShadow | null {
  const id = `${file}${flip ? ':flip' : ''}`;
  if (made.has(id)) return made.get(id)!;
  if (!scene.textures.exists(file)) return null;
  const src = scene.textures.get(file).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const frame = scene.textures.getFrame(file);
  const [w, h] = [frame.cutWidth, frame.cutHeight];
  const read = document.createElement('canvas');
  read.width = w;
  read.height = h;
  const rc = read.getContext('2d', { willReadFrequently: true })!;
  if (flip) rc.setTransform(-1, 0, 0, 1, w, 0);
  rc.drawImage(src, frame.cutX, frame.cutY, w, h, 0, 0, w, h);
  const px = rc.getImageData(0, 0, w, h).data;
  const solid = (x: number, y: number) => px[(y * w + x) * 4 + 3] > 96;
  // Each column's lowest solid pixel: where that part stands.
  const foot = new Int32Array(w).fill(-1);
  for (let x = 0; x < w; x++) for (let y = h - 1; y >= 0; y--) if (solid(x, y)) { foot[x] = y; break; }
  let tallest = 0;
  for (let x = 0; x < w; x++) if (foot[x] >= 0) for (let y = 0; y <= foot[x]; y++) if (solid(x, y)) { tallest = Math.max(tallest, foot[x] - y); break; }
  const extra = Math.ceil(tallest * LEAN) + 1;
  const W = w + extra;
  const H = h + Math.ceil(tallest * DROP) + 2;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const g = out.getContext('2d')!;
  const img = g.createImageData(W, H);
  const d = img.data;
  // Each pixel keeps the darkest shade that lands on it (overlapping rows don't add up into blotches).
  const put = (x: number, y: number, a: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    if (d[i + 3] >= a) return;
    [d[i], d[i + 1], d[i + 2], d[i + 3]] = [...COLOUR, a];
  };
  for (let x = 0; x < w; x++) {
    if (foot[x] < 0) continue;
    for (let y = 0; y <= foot[x]; y++) {
      if (!solid(x, y)) continue;
      const up = foot[x] - y;
      const a = Math.round(255 * ALPHA * (1 - FADE * (tallest ? up / tallest : 0)));
      const sx = Math.round(x + up * LEAN);
      const sy = Math.round(foot[x] + up * DROP);
      put(sx, sy, a);
      put(sx, sy + 1, a); // two px tall so the squashed rows leave no gaps
    }
  }
  g.putImageData(img, 0, 0);
  const shadow: CastShadow = { key: `cast-shadow:${id}`, extra, height: H };
  scene.textures.addCanvas(shadow.key, out);
  made.set(id, shadow);
  return shadow;
}
