import Phaser from 'phaser';
import { queueImage } from '../assets/queue';
import type { CharacterDefs, ClassArt, ClassLayer, ClassesDefs, Dir } from '../assets/types';
import { type Outfit, clothesFiles, dressLayer, headFiles, sheetKey } from './doll';

// ⚔️ A class's weapon on a character, drawn onto a canvas (the class cards, the skill preview, the equipment panel):
// the resting weapon over the doll's idle or walk (the same frame, or the Hilot's balm on its own clock), and the
// combat poses (walk-ready, the attacks: the body and face in the look's skin, the look's clothes moved
// onto the pose's body and trimmed to it, its hair, glasses and hat onto the pose's head, then the weapon layers). Everything is drawn in a 64x64 cell whose (bodyOffset) is the doll's 32x48 cell,
// back layers first, front layers last. Every direction has its own sheets: nothing is mirrored.

export const CELL = 64;

/** The resting weapon's back and front layers over the base `anim` facing `dir` (the Hilot's balm: its own). */
export function restLayers(art: ClassArt, anim: 'idle' | 'walk', dir: Dir): { back: ClassLayer[]; front: ClassLayer[] } | null {
  return (art.rest.own ? art.rest.dirs?.[dir] : art.rest.anims?.[anim]?.[dir]) ?? null;
}

/** Every resting-weapon sheet of a class (to load). */
export function restFiles(art: ClassArt): string[] {
  const sets = art.rest.own ? Object.values(art.rest.dirs ?? {}) : Object.values(art.rest.anims ?? {}).flatMap((a) => Object.values(a ?? {}));
  return sets.flatMap((s) => [...(s?.back ?? []), ...(s?.front ?? [])].map((l) => l.file));
}

/** Every combat-pose sheet of a class (to load). */
export function poseFiles(art: ClassArt): string[] {
  return Object.values(art.anims).flatMap((a) =>
    Object.values(a.dirs).flatMap((d) => (d ? [d.body, ...(d.face ? [d.face] : []), ...d.back.map((l) => l.file), ...d.front.map((l) => l.file)] : [])),
  );
}

/** Loads whichever of `files` aren't loaded yet. */
export function loadImages(scene: Phaser.Scene, files: string[]): Promise<void> {
  const missing = [...new Set(files)].filter((f) => !scene.textures.exists(f));
  if (!missing.length) return Promise.resolve();
  return new Promise((resolve) => {
    for (const f of missing) queueImage(scene.load, scene.textures, f);
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
    if (!scene.load.isLoading()) scene.load.start();
  });
}

const source = (scene: Phaser.Scene, file: string) => (scene.textures.exists(file) ? (scene.textures.get(file).getSourceImage() as CanvasImageSource) : null);

/** Frame `f` of a strip whose cells are `w`×`h`, at (x, y). */
function drawCell(ctx: CanvasRenderingContext2D, img: CanvasImageSource | null, w: number, h: number, f: number, x: number, y: number): void {
  if (img) ctx.drawImage(img, f * w, 0, w, h, x, y, w, h);
}

/** A weapon layer's frame, placed in the 64x64 cell (32x48 ones at the body's spot). */
function drawLayer(ctx: CanvasRenderingContext2D, scene: Phaser.Scene, K: ClassesDefs, l: ClassLayer, f: number, x: number, y: number): void {
  const [w, h] = l.size;
  const at = w === CELL ? [0, 0] : K.bodyOffset;
  drawCell(ctx, source(scene, l.file), w, h, f, x + at[0], y + at[1]);
}

/** Every image the look's layers on the poses need facing `dirs` (to load): the idle body, clothes and head. */
export function lookImages(C: CharacterDefs, o: Outfit, dirs: Dir[]): string[] {
  return dirs.flatMap((dir) => [
    C.layers.body.replaceAll('{anim}', 'idle').replaceAll('{dir}', dir),
    ...[...clothesFiles(C, o, dir), ...headFiles(C, o, dir)].flatMap((l) => (l.clip ? [l.file, l.clip] : [l.file])),
  ]);
}

const alphas = new Map<string, ImageData | null>();
function imageData(scene: Phaser.Scene, file: string): ImageData | null {
  if (alphas.has(file)) return alphas.get(file)!;
  const img = source(scene, file) as HTMLImageElement | HTMLCanvasElement | null;
  let data: ImageData | null = null;
  if (img) {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0);
    data = g.getImageData(0, 0, img.width, img.height);
  }
  alphas.set(file, data);
  return data;
}

/** Shifts worked out (the search is costly), kept in this browser too (localStorage mk_shifts, for this build: new
 *  art comes with a new build, so a deploy works them out afresh): each look's fit is found once per computer. */
declare const __BUILD__: { version: string };
const SHIFTS_KEY = 'mk_shifts';
const shifts = new Map<string, [number, number]>(
  (() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SHIFTS_KEY) ?? '{}') as { build?: string; shifts?: Record<string, [number, number]> };
      return saved.build === __BUILD__.version && __BUILD__.version !== 'dev' ? Object.entries(saved.shifts ?? {}) : [];
    } catch {
      return [];
    }
  })(),
);
let saveLater = 0;
function rememberShifts(): void {
  if (saveLater) return;
  saveLater = window.setTimeout(() => {
    saveLater = 0;
    try {
      localStorage.setItem(SHIFTS_KEY, JSON.stringify({ build: __BUILD__.version, shifts: Object.fromEntries([...shifts].slice(-20000)) }));
    } catch {
      // full or private: worked out again next visit
    }
  }, 2000);
}

/** A sheet's pixels as one number each: its colour (0xRRGGBB), or -1 where it's see-through (read once a sheet). */
const colours = new Map<string, Int32Array | null>();
function colourData(scene: Phaser.Scene, file: string): { c: Int32Array; width: number } | null {
  const d = imageData(scene, file);
  if (!d) return null;
  let c = colours.get(file);
  if (!c) {
    c = new Int32Array(d.width * d.height);
    for (let i = 0, p = 0; p < c.length; i += 4, p++) c[p] = d.data[i + 3] >= 128 ? (d.data[i] << 16) | (d.data[i + 1] << 8) | d.data[i + 2] : -1;
    colours.set(file, c);
  }
  return { c, width: d.width };
}
/** The first row of frame 0 with a pixel in it (−1: none). */
function topRow(d: ImageData, w: number, h: number): number {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d.data[(y * d.width + x) * 4 + 3] >= 128) return y;
  return -1;
}

/** How far a band of the town idle's body (rows y0 to y1 of its first frame) is in frame `f` of a combat body sheet:
 *  the shift that lays the band best over the pose's pixels, same colours counting most (raised arms and weapons can't
 *  pull it off). Within 10 px; none when either sheet is missing. */
function bandShift(scene: Phaser.Scene, C: CharacterDefs, idleBody: string, poseBody: string, f: number, y0: number, y1: number): [number, number] {
  const id = `${idleBody}|${poseBody}|${f}|${y0}|${y1}`;
  const known = shifts.get(id);
  if (known) return known;
  const [w, h] = C.cell;
  const band = bandOf(scene, C, idleBody, y0, y1);
  const b = colourData(scene, poseBody);
  let best: [number, number] = [0, 0];
  if (band && b) {
    // (Flat arrays: the band's x, y and colour; the pose's colours, -1 see-through.)
    const n = band.length;
    const bx = new Int32Array(n);
    const by = new Int32Array(n);
    const bc = new Int32Array(n);
    band.forEach(([x, y, rgb], k) => ((bx[k] = x), (by[k] = y), (bc[k] = rgb)));
    const pc = b.c;
    const stride = b.width;
    const fx = f * w;
    const score = (dx: number, dy: number) => {
      let s = 0;
      for (let k = 0; k < n; k++) {
        const px = bx[k] + dx;
        const py = by[k] + dy;
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        const v = pc[py * stride + fx + px];
        if (v < 0) continue;
        s += v === bc[k] ? 2 : 1;
      }
      return s - (Math.abs(dx) + Math.abs(dy)) * 0.01; // ties: the smaller move
    };
    // Every shift (a coarser search lands a shirt on a face now and then).
    let top = -Infinity;
    for (let dy = -10; dy <= 10; dy++)
      for (let dx = -10; dx <= 10; dx++) {
        const s = score(dx, dy);
        if (s > top) {
          top = s;
          best = [dx, dy];
        }
      }
  }
  shifts.set(id, best);
  rememberShifts();
  return best;
}

const bands = new Map<string, [number, number, number][] | null>();
/** The idle body's pixels in rows y0 to y1 of its first frame: x, y, rgb. */
function bandOf(scene: Phaser.Scene, C: CharacterDefs, idleBody: string, y0: number, y1: number): [number, number, number][] | null {
  const id = `${idleBody}|${y0}|${y1}`;
  if (bands.has(id)) return bands.get(id)!;
  const a = imageData(scene, idleBody);
  let band: [number, number, number][] | null = null;
  if (a) {
    band = [];
    for (let y = Math.max(0, y0); y < Math.min(C.cell[1], y1); y++)
      for (let x = 0; x < C.cell[0]; x++) {
        const i = (y * a.width + x) * 4;
        if (a.data[i + 3] >= 128) band.push([x, y, (a.data[i] << 16) | (a.data[i + 1] << 8) | a.data[i + 2]]);
      }
  }
  bands.set(id, band);
  return band;
}

/** The head's shift: the idle's top 13 rows. */
function headShift(scene: Phaser.Scene, C: CharacterDefs, idleBody: string, poseBody: string, f: number): [number, number] {
  const a = imageData(scene, idleBody);
  const top = a ? topRow(a, C.cell[0], C.cell[1]) : -1;
  return top < 0 ? [0, 0] : bandShift(scene, C, idleBody, poseBody, f, top, top + 13);
}

/** A piece of clothing's shift: the idle body's band its own pixels cover (the top's rows, the bottom's, the shoes'). */
function clothShift(scene: Phaser.Scene, C: CharacterDefs, idleBody: string, poseBody: string, f: number, cloth: string): [number, number] {
  const [w, h] = C.cell;
  const c = imageData(scene, cloth);
  if (!c) return [0, 0];
  let y0 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (c.data[(y * c.width + x) * 4 + 3] >= 128) {
        if (y0 < 0) y0 = y;
        y1 = y + 1;
        break;
      }
  return y0 < 0 ? [0, 0] : bandShift(scene, C, idleBody, poseBody, f, y0, y1);
}

let trim: CanvasRenderingContext2D | null = null;
/** A layer's first frame at (dx, dy) in the cell, kept only where frame `f` of the pose's body is (no sleeve where the
 *  arm isn't), drawn at (x, y). */
function drawTrimmed(ctx: CanvasRenderingContext2D, layer: CanvasImageSource | null, body: CanvasImageSource | null, w: number, h: number, f: number, dx: number, dy: number, x: number, y: number): void {
  if (!layer || !body) return;
  if (!trim) {
    const c = document.createElement('canvas');
    trim = c.getContext('2d')!;
  }
  trim.canvas.width = w;
  trim.canvas.height = h;
  trim.globalCompositeOperation = 'source-over';
  trim.drawImage(layer, 0, 0, w, h, dx, dy, w, h);
  trim.globalCompositeOperation = 'destination-in';
  trim.drawImage(body, f * w, 0, w, h, 0, 0, w, h);
  ctx.drawImage(trim.canvas, x, y);
}

/** A character resting in town at (x, y), the 64x64 cell's top left: back layers, the doll's frame, front layers.
 *  `t` (ms) drives the Hilot's balm, which floats on its own clock. Without `art`, just the doll. */
export function drawRested(
  ctx: CanvasRenderingContext2D,
  scene: Phaser.Scene,
  C: CharacterDefs,
  K: ClassesDefs,
  o: Outfit,
  art: ClassArt | null,
  anim: 'idle' | 'walk',
  dir: Dir,
  frame: number,
  t: number,
  x = 0,
  y = 0,
): void {
  const layers = art ? restLayers(art, anim, dir) : null;
  const own = art?.rest.own;
  const wf = own ? Math.floor((t / 1000) * own.fps) % own.frames : frame;
  for (const l of layers?.back ?? []) drawLayer(ctx, scene, K, l, wf, x, y);
  drawCell(ctx, source(scene, sheetKey(o, anim, dir)), C.cell[0], C.cell[1], frame, x + K.bodyOffset[0], y + K.bodyOffset[1]);
  for (const l of layers?.front ?? []) drawLayer(ctx, scene, K, l, wf, x, y);
}

/** A combat pose's frame at (x, y), the 64x64 cell's top left: back layers, the body and face in the look's skin, front
 *  layers. `hide`: weapon layers left out (a thrown lid or plank in flight), by a part of their file name. */
export function drawPose(
  ctx: CanvasRenderingContext2D,
  scene: Phaser.Scene,
  C: CharacterDefs,
  K: ClassesDefs,
  o: Outfit,
  art: ClassArt,
  anim: string,
  dir: Dir,
  frame: number,
  x = 0,
  y = 0,
  hide: string[] = [],
): void {
  const d = art.anims[anim]?.dirs[dir];
  if (!d) return;
  const shown = (l: ClassLayer) => !hide.some((h) => l.file.includes(h));
  for (const l of d.back.filter(shown)) drawLayer(ctx, scene, K, l, frame, x, y);
  drawCell(ctx, dressLayer(scene, C, o, d.body, 'body'), C.cell[0], C.cell[1], frame, x + K.bodyOffset[0], y + K.bodyOffset[1]);
  if (d.face) drawCell(ctx, dressLayer(scene, C, o, d.face, 'face'), C.cell[0], C.cell[1], frame, x + K.bodyOffset[0], y + K.bodyOffset[1]);
  // The look's clothes, hair, glasses and hat (the combat sheets have none): the town idle's first frame, each piece
  // moved to its part of the pose (clothes trimmed to the pose's body), the head's to the pose's head.
  const idleBody = C.layers.body.replaceAll('{anim}', 'idle').replaceAll('{dir}', dir);
  const poseBody = dressLayer(scene, C, o, d.body, 'body');
  for (const l of clothesFiles(C, o, dir)) {
    const [cx, cy] = clothShift(scene, C, idleBody, d.body, frame, l.file);
    drawTrimmed(ctx, dressLayer(scene, C, o, l.file, l.layer), poseBody, C.cell[0], C.cell[1], frame, cx, cy, x + K.bodyOffset[0], y + K.bodyOffset[1]);
  }
  const [dx, dy] = headShift(scene, C, idleBody, d.body, frame);
  for (const l of headFiles(C, o, dir)) drawCell(ctx, dressLayer(scene, C, o, l.file, l.layer, l.clip), C.cell[0], C.cell[1], 0, x + K.bodyOffset[0] + dx, y + K.bodyOffset[1] + dy);
  for (const l of d.front.filter(shown)) drawLayer(ctx, scene, K, l, frame, x, y);
}
