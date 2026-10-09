import Phaser from 'phaser';
import { queueImage } from '../assets/queue';
import type { CharacterDefs, Dir, Vec2 } from '../assets/types';
import { isColour, visible } from '../util/pixels';

// Paper-doll characters. Each layer (body, face, shoes, bottom, top, hair, glasses, hat — manifest drawOrder) is a
// sheet of 32×48 frames with zero offset. For an outfit we recolour every layer's grey key ramps, clip the hair
// under beanies and caps, and composite the layers into one sheet per (animation, direction), so a character is a
// single sprite: cheap to draw and simple to depth-sort.

export interface Outfit {
  skin: string; // skinTones key
  hair: string;
  hairColour: string; // colourPresets key
  top: string;
  topColour: string;
  topTrim: string;
  bottom: string;
  bottomColour: string;
  bottomTrim: string;
  shoes: string;
  shoesColour: string; // shoes are all on the TRIM ramp
  glasses?: string;
  glassesColour?: string;
  hat?: string;
  hatColour?: string;
}

export const ANIMS = ['rot', 'walk', 'idle', 'sit', 'wave', 'cheer'] as const;
export type Anim = (typeof ANIMS)[number];

const hex = (s: string) => parseInt(s.replace('#', ''), 16);

export const dirsFor = (C: CharacterDefs, anim: string): Dir[] => C.animations[anim]?.directions ?? C.directions;
const hasFace = (C: CharacterDefs, dir: Dir) => C.layers.face.directions.includes(dir);

/** The hair style actually drawn: buns become crop under a clipping hat (wardrobe.hatHairFallback). */
export function hairDrawn(C: CharacterDefs, o: Outfit): string {
  const clips = !!(o.hat && C.wardrobe.hatClips[o.hat]);
  return clips ? (C.wardrobe.hatHairFallback[o.hair] ?? o.hair) : o.hair;
}

interface LayerFile {
  layer: string;
  file: string;
  clip?: string; // hat clip mask, for the hair layer
}

/** The files drawn for one (anim, dir), in draw order. */
export function layerFiles(C: CharacterDefs, o: Outfit, anim: string, dir: Dir): LayerFile[] {
  const W = C.wardrobe;
  const fill = (pattern: string, vars: Record<string, string>) => pattern.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
  const slot = (s: string, item: string) => fill(W.pattern, { slot: s, item, anim, dir });
  const clips = !!(o.hat && W.hatClips[o.hat]);
  const out: LayerFile[] = [];
  for (const layer of C.drawOrder) {
    switch (layer) {
      case 'body':
        out.push({ layer, file: fill(C.layers.body, { anim, dir }) });
        break;
      case 'face':
        if (hasFace(C, dir)) out.push({ layer, file: fill(C.layers.face.pattern, { anim, dir }) });
        break;
      case 'shoes':
        out.push({ layer, file: slot('shoes', o.shoes) });
        break;
      case 'bottom':
        out.push({ layer, file: slot('bottom', o.bottom) });
        break;
      case 'top':
        out.push({ layer, file: slot('top', o.top) });
        break;
      case 'hair':
        out.push({
          layer,
          file: fill(W.hairPattern, { item: hairDrawn(C, o), anim, dir }),
          clip: clips ? fill(W.hatClipPattern, { item: o.hat!, anim, dir }) : undefined,
        });
        break;
      case 'glasses':
        if (o.glasses && hasFace(C, dir)) out.push({ layer, file: slot('glasses', o.glasses) });
        break;
      case 'hat':
        if (o.hat) out.push({ layer, file: fill(W.hatPattern, { item: o.hat, anim, dir }) });
        break;
    }
  }
  return out;
}

/** What a look wears on its head facing `dir` (hair, glasses, hat): the town idle's files, laid over the combat poses. */
export function headFiles(C: CharacterDefs, o: Outfit, dir: Dir): LayerFile[] {
  return layerFiles(C, o, 'idle', dir).filter((l) => l.layer === 'hair' || l.layer === 'glasses' || l.layer === 'hat');
}

/** What a look wears on its body facing `dir` (shoes, bottom, top): the town idle's files, laid over the combat poses. */
export function clothesFiles(C: CharacterDefs, o: Outfit, dir: Dir): LayerFile[] {
  return layerFiles(C, o, 'idle', dir).filter((l) => l.layer === 'shoes' || l.layer === 'bottom' || l.layer === 'top');
}

/** Every image an outfit needs, for the loader. */
export function outfitFiles(C: CharacterDefs, o: Outfit): string[] {
  const files = new Set<string>();
  for (const anim of ANIMS) {
    for (const dir of dirsFor(C, anim)) {
      for (const l of layerFiles(C, o, anim, dir)) {
        files.add(l.file);
        if (l.clip) files.add(l.clip);
      }
    }
  }
  return [...files];
}

/** The swap for the pixel at i: its grey key's new colour (give or take a nudge; see util/pixels), if any. */
function swapAt(swaps: Map<number, number>, d: Uint8ClampedArray, i: number): number | undefined {
  const exact = swaps.get((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  if (exact !== undefined) return exact;
  for (const [key, to] of swaps) if (isColour(d, i, key >> 16, (key >> 8) & 255, key & 255)) return to;
  return undefined;
}

/** Colour swaps for one layer: grey key → outfit colour (exact matches only; the outline is never swapped). */
function swapsFor(C: CharacterDefs, o: Outfit, layer: string): Map<number, number> {
  const m = new Map<number, number>();
  const ramp = (keys: string[], to: string[] | undefined) => {
    if (!to) return;
    keys.forEach((k, i) => {
      if (to[i]) m.set(hex(k), hex(to[i]));
    });
  };
  const preset = (name?: string) => (name ? C.colourPresets[name] : undefined);
  const K = C.colourKeys;
  switch (layer) {
    case 'body':
      ramp(K.skin, C.skinTones[o.skin]);
      break;
    case 'face':
      ramp(K.skin, C.skinTones[o.skin]); // the mouth uses a skin key on purpose
      for (const [from, to] of Object.entries(C.skinTones.faceTweak?.[o.skin] ?? {})) m.set(hex(from), hex(to));
      break;
    case 'hair':
      ramp(K.hair, preset(o.hairColour));
      break;
    case 'top':
      ramp(K.clothMain, preset(o.topColour));
      ramp(K.clothTrim, preset(o.topTrim));
      break;
    case 'bottom':
      ramp(K.clothMain, preset(o.bottomColour));
      ramp(K.clothTrim, preset(o.bottomTrim));
      break;
    case 'shoes':
      ramp(K.clothTrim, preset(o.shoesColour));
      break;
    case 'glasses':
      ramp(K.clothMain, preset(o.glassesColour));
      break;
    case 'hat':
      ramp(K.clothMain, preset(o.hatColour));
      break;
  }
  return m;
}

/** A texture's pixels, read back once (a canvas readback is slow) and copied for each use: the layers never change. */
const read = new Map<string, ImageData>();
function pixels(scene: Phaser.Scene, key: string): ImageData | null {
  if (!scene.textures.exists(key)) return null;
  let r = read.get(key);
  if (!r) {
    const img = scene.textures.get(key).getSourceImage() as HTMLImageElement;
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    r = ctx.getImageData(0, 0, img.width, img.height);
    read.set(key, r);
  }
  return new ImageData(new Uint8ClampedArray(r.data), r.width, r.height);
}

/** A layer's pixels with its colour swaps done, each colour looked up once (most of a sheet is a few colours). */
function swapPixels(d: Uint8ClampedArray, swaps: Map<number, number>): void {
  if (!swaps.size) return;
  const seen = new Map<number, number>(); // colour → its new colour, or -1: kept
  for (let i = 0; i < d.length; i += 4) {
    if (!visible(d[i + 3])) continue;
    const rgb = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let to = seen.get(rgb);
    if (to === undefined) {
      to = swapAt(swaps, d, i) ?? -1;
      seen.set(rgb, to);
    }
    if (to < 0) continue;
    d[i] = to >> 16;
    d[i + 1] = (to >> 8) & 255;
    d[i + 2] = to & 255;
  }
}

/** One canvas for putting a layer's pixels before drawing it onto a sheet (made once). */
let scratch: CanvasRenderingContext2D | null = null;
function scratchFor(w: number, h: number): CanvasRenderingContext2D {
  if (!scratch) scratch = document.createElement('canvas').getContext('2d')!;
  if (scratch.canvas.width !== w || scratch.canvas.height !== h) {
    scratch.canvas.width = w;
    scratch.canvas.height = h;
  }
  return scratch;
}

export const outfitKey = (o: Outfit) =>
  'doll:' +
  [o.skin, o.hair, o.hairColour, o.top, o.topColour, o.topTrim, o.bottom, o.bottomColour, o.bottomTrim, o.shoes, o.shoesColour, o.glasses ?? '-', o.glassesColour ?? '-', o.hat ?? '-', o.hatColour ?? '-'].join('.');

/** Texture / animation key for one composited sheet. */
export const sheetKey = (o: Outfit, anim: string, dir: Dir) => `${outfitKey(o)}:${anim}:${dir}`;

/** Problems found while compositing (missing layers, mismatched sheet sizes), for the asset report. */
export const assetProblems = new Set<string>();

/**
 * Builds the composited sheets and animations for an outfit (once per outfit). All layer images must already be
 * loaded (see outfitFiles).
 */
export function buildOutfit(scene: Phaser.Scene, C: CharacterDefs, o: Outfit): void {
  for (const [anim, dir] of outfitSheets(C)) buildSheet(scene, C, o, anim, dir);
}

/** Every sheet an outfit has: each anim facing each of its directions. */
function outfitSheets(C: CharacterDefs): [string, Dir][] {
  return ANIMS.filter((a) => C.animations[a]).flatMap((anim) => dirsFor(C, anim).map((dir): [string, Dir] => [anim, dir]));
}

/**
 * The same, a few sheets at a time between frames (at most `budgetMs` of work a frame), so another player arriving
 * never stalls everyone's game. Resolves once every sheet is made.
 */
export async function buildOutfitSlowly(scene: Phaser.Scene, C: CharacterDefs, o: Outfit, budgetMs = 4): Promise<void> {
  await new Promise((r) => requestAnimationFrame(r)); // (not in the loader's own task: its files came in just now)
  let start = performance.now();
  for (const [anim, dir] of outfitSheets(C)) {
    if (performance.now() - start > budgetMs) {
      await new Promise((r) => requestAnimationFrame(r));
      if (!scene.sys.isActive() && !scene.sys.isSleeping()) return; // (the scene went: nothing to build for)
      start = performance.now();
    }
    buildSheet(scene, C, o, anim, dir);
  }
}

/** One composited sheet (an anim facing a direction) and its animation, once. */
function buildSheet(scene: Phaser.Scene, C: CharacterDefs, o: Outfit, anim: string, dir: Dir): void {
  const [cw, ch] = C.cell;
  const spec = C.animations[anim];
  const key = sheetKey(o, anim, dir);
  if (scene.textures.exists(key) || !spec) return;
  const width = spec.frames * cw;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  for (const l of layerFiles(C, o, anim, dir)) {
    const data = pixels(scene, l.file);
    if (!data) {
      assetProblems.add(`missing layer ${l.file}`);
      continue;
    }
    if (data.width !== width || data.height !== ch) assetProblems.add(`${l.file} is ${data.width}×${data.height}, expected ${width}×${ch}`);
    const d = data.data;
    swapPixels(d, swapsFor(C, o, l.layer));
    if (l.clip) {
      // Hide the hair wherever the hat's clip mask is white.
      const mask = pixels(scene, l.clip);
      if (!mask) assetProblems.add(`missing hat clip ${l.clip}`);
      else {
        if (mask.width !== data.width || mask.height !== data.height) assetProblems.add(`${l.clip} does not match ${l.file}`);
        const md = mask.data;
        for (let i = 0; i < d.length && i < md.length; i += 4) if (visible(md[i + 3]) && md[i] > 127 && md[i + 1] > 127 && md[i + 2] > 127) d[i + 3] = 0;
      }
    }
    const layer = scratchFor(data.width, data.height);
    layer.putImageData(data, 0, 0);
    ctx.drawImage(layer.canvas, 0, 0);
  }
  const tex = scene.textures.addCanvas(key, canvas)!;
  for (let f = 0; f < spec.frames; f++) tex.add(f, 0, f * cw, 0, cw, ch);
  scene.anims.create({
    key,
    frames: Array.from({ length: spec.frames }, (_, f) => ({ key, frame: f })),
    frameRate: spec.fps || 1,
    repeat: spec.loop ? -1 : 0,
  });
}

/**
 * A copy of a sheet in someone's colours: skin keys → their skin ramp, cloth-main keys → their top's colour (the
 * jack en poy hands: a hand and its cuff). Frames are cut like the source (`frame` px square). Made once per look.
 */
export function recolourSheet(scene: Phaser.Scene, C: CharacterDefs, o: Outfit, src: string, frame: Vec2): string | null {
  const key = `${src}:${outfitKey(o)}`;
  if (scene.textures.exists(key)) return key;
  const data = pixels(scene, src);
  if (!data) return null;
  swapPixels(data.data, new Map([...swapsFor(C, o, 'body'), ...swapsFor(C, o, 'top')]));
  const canvas = document.createElement('canvas');
  canvas.width = data.width;
  canvas.height = data.height;
  canvas.getContext('2d')!.putImageData(data, 0, 0);
  const tex = scene.textures.addCanvas(key, canvas)!;
  const [fw, fh] = frame;
  for (let f = 0; f * fw < data.width; f++) tex.add(f, 0, f * fw, 0, fw, fh);
  return key;
}

const heads = new Map<string, number>();

/** Where an outfit's head (or hat) starts in its cell: the first row with a visible pixel in the idle sheet facing
 *  south, over all frames. Name plates sit just above it. */
export function headTop(scene: Phaser.Scene, o: Outfit): number {
  const key = sheetKey(o, 'idle', 's');
  const cached = heads.get(key);
  if (cached !== undefined) return cached;
  const data = pixels(scene, key);
  let top = 0;
  if (data) {
    top = data.height;
    for (let i = 3; i < data.data.length; i += 4) {
      if (visible(data.data[i])) {
        top = Math.floor((i - 3) / 4 / data.width);
        break;
      }
    }
  }
  heads.set(key, top === (data?.height ?? 0) ? 0 : top);
  return heads.get(key)!;
}

/** The look's head as a small square picture (idle, facing south, first frame), for avatars. */
export function headPortrait(scene: Phaser.Scene, C: CharacterDefs, o: Outfit, size = 24): HTMLCanvasElement | null {
  const key = sheetKey(o, 'idle', 's');
  if (!scene.textures.exists(key)) return null;
  const src = scene.textures.get(key).getSourceImage() as HTMLCanvasElement;
  const [cw, ch] = C.cell;
  const top = Math.max(0, headTop(scene, o) - 1);
  const h = Math.min(size, ch - top);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  c.getContext('2d')!.drawImage(src, Math.round((cw - size) / 2), top, size, h, 0, 0, size, h);
  return c;
}

/** Loads any layers an outfit still needs (with the scene's loader), then builds it a few sheets a frame. */
export function loadOutfit(scene: Phaser.Scene, C: CharacterDefs, o: Outfit): Promise<void> {
  const missing = outfitFiles(C, o).filter((f) => !scene.textures.exists(f));
  return new Promise((resolve) => {
    const done = () => void buildOutfitSlowly(scene, C, o).then(resolve);
    if (!missing.length) return done();
    for (const f of missing) queueImage(scene.load, scene.textures, f);
    scene.load.once(Phaser.Loader.Events.COMPLETE, done);
    scene.load.start();
  });
}

/** A starter outfit: seeded, so the same seed always dresses the same way. */
export function randomOutfit(C: CharacterDefs, random: () => number): Outfit {
  const W = C.wardrobe;
  const any = <T>(xs: T[]) => xs[Math.floor(random() * xs.length)];
  const presets = Object.keys(C.colourPresets).filter((k) => k !== 'note');
  const naturalHair = presets.filter((p) => ['brown', 'stone', 'gold', 'cream'].includes(p));
  const hat = random() < 0.35 ? any(W.hats) : undefined;
  return {
    skin: any(Object.keys(C.skinTones).filter((k) => k !== 'keys' && k !== 'faceTweak')),
    hair: any(W.hair),
    hairColour: any(naturalHair.length ? naturalHair : presets),
    top: any(W.top),
    topColour: any(presets),
    topTrim: any(presets),
    bottom: any(W.bottom),
    bottomColour: any(presets),
    bottomTrim: any(presets),
    shoes: any(W.shoes),
    shoesColour: any(presets),
    glasses: random() < 0.25 ? any(W.glasses) : undefined,
    glassesColour: 'stone',
    hat,
    hatColour: hat ? any(presets) : undefined,
  };
}

/** One layer sheet in someone's colours (the class combat poses' body and face: only those exist for them), made once
 *  per look. Null if the sheet isn't loaded. */
export function dressLayer(scene: Phaser.Scene, C: CharacterDefs, o: Outfit, file: string, layer: string, clip?: string): HTMLCanvasElement | null {
  const key = `${file}:${clip ?? ''}:${outfitKey(o)}`;
  const done = dressed.get(key);
  if (done) return done;
  const data = pixels(scene, file);
  if (!data) return null;
  const swaps = swapsFor(C, o, layer);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!visible(d[i + 3])) continue;
    const to = swapAt(swaps, d, i);
    if (to !== undefined) {
      d[i] = to >> 16;
      d[i + 1] = (to >> 8) & 255;
      d[i + 2] = to & 255;
    }
  }
  // Hair under a clipping hat: hidden wherever the hat's clip mask is white (as buildOutfit).
  const mask = clip ? pixels(scene, clip) : null;
  if (mask) for (let i = 0; i < d.length && i < mask.data.length; i += 4) if (visible(mask.data[i + 3]) && mask.data[i] > 127 && mask.data[i + 1] > 127 && mask.data[i + 2] > 127) d[i + 3] = 0;
  const canvas = document.createElement('canvas');
  canvas.width = data.width;
  canvas.height = data.height;
  canvas.getContext('2d')!.putImageData(data, 0, 0);
  dressed.set(key, canvas);
  return canvas;
}
const dressed = new Map<string, HTMLCanvasElement>();
