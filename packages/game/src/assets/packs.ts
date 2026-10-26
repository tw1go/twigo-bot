import type Phaser from 'phaser';
import index from 'virtual:packs';
import { lagMark } from '../net/lag';

// In a build the images come packed into a few sheets (scripts/packs.ts). The game still asks for an image by its
// path under assets/: the loader fetches the sheet holding it, then every image on that sheet is cut back out
// into its own texture under its own path, so the rest of the game (and its pixel reads) can't tell the
// difference. In dev `index` is null and every image loads on its own.
// Cutting out is a canvas and a GPU upload an image: a big page (a weapon skin's 192 sheets) took 400+ ms in one frame
// (the lag report). Behind a loading screen that's fine; once the town is up (`unpackInSlices`) a page is decoded off the
// main thread first and cut out a few ms a frame, and whoever waits for its images waits for that too (`loaded`).

const pageKey = (page: number) => `pack:${index!.pages[page]}`;
const queued = new Set<number>();
/** Frame sizes of the images that are sheets, so they can be sliced once cut out. */
const sheets = new Map<string, [number, number]>();
/** Sheets the build trimmed (scripts/packs.ts): their cell, and the box of it each frame was cut to. */
const trims = new Map<string, number[]>();
let byPage: Map<number, string[]> | null = null;
/** Loaders already told what to do when a page fails. */
const watched = new WeakSet<Phaser.Loader.LoaderPlugin>();
let missing: (() => void) | null = null;
/** Pages are cut out a few ms a frame (once the town is up: nothing waits behind a loading screen then). */
let inSlices = false;
const SLICE_MS = 4;
/** Pages being cut out now, and who waits for them all. */
const cutting = new Set<number>();
let waiters: (() => void)[] = [];

/** From now on pages are cut out a few ms a frame (TownScene, once its own first load is done). */
export function unpackInSlices(): void {
  inSlices = true;
}

/** Resolves once no page is being cut out (its images all in). */
export function unpacked(): Promise<void> {
  return cutting.size ? new Promise((r) => waiters.push(r)) : Promise.resolve();
}

/** Resolves once `load` has finished its run and every page it brought is cut out: what waiting for images means now. */
export function loaded(load: Phaser.Loader.LoaderPlugin): Promise<void> {
  return new Promise<void>((r) => load.once('complete', () => r())).then(unpacked); // (Phaser.Loader.Events.COMPLETE)
}

/** `fn` whenever a page can't be loaded (main.ts: look for a newer version, whose notice says to reload: a game left on an
 *  older build asks for pages a deploy has since replaced). */
export function onPackMissing(fn: () => void): void {
  missing = fn;
}

export const packed = (file: string): boolean => !!index?.files[file];

/** Numbered frames across a sheet, row by row (as Phaser's spritesheet loader names them). A trimmed sheet's frames are
 *  its box-sized ones, each put back in its `w × h` cell where it was cut from (Phaser's trim: the anchor's unchanged). */
export function slice(textures: Phaser.Textures.TextureManager, file: string, w: number, h: number): void {
  const tex = textures.get(file);
  if (tex.has('0')) return;
  const { width, height } = tex.getSourceImage() as HTMLCanvasElement;
  const t = trims.get(file);
  if (t) {
    const [cw, ch, bx, by, bw, bh] = t;
    const per = Math.max(1, Math.floor(width / bw));
    for (let i = 0; Math.floor(i / per) * bh + bh <= height; i++) tex.add(i, 0, (i % per) * bw, Math.floor(i / per) * bh, bw, bh)?.setTrim(cw, ch, bx, by, bw, bh);
    return;
  }
  let n = 0;
  for (let y = 0; y + h <= height; y += h) for (let x = 0; x + w <= width; x += w) tex.add(n++, 0, x, y, w, h);
}

/** Queues the sheet holding `file`; `frame` marks it as a sheet of that frame size. */
export function queuePacked(load: Phaser.Loader.LoaderPlugin, textures: Phaser.Textures.TextureManager, file: string, frame?: [number, number]): void {
  if (frame) sheets.set(file, frame);
  if (textures.exists(file)) {
    if (frame) slice(textures, file, frame[0], frame[1]);
    return;
  }
  const page = index!.files[file][0];
  if (queued.has(page)) return;
  queued.add(page);
  watch(load);
  load.image(pageKey(page), index!.pages[page]);
  load.once(`filecomplete-image-${pageKey(page)}`, () => unpack(textures, page));
}

/** A page that fails is forgotten (asked for again by whoever needs it next) and reported. */
function watch(load: Phaser.Loader.LoaderPlugin): void {
  if (watched.has(load)) return;
  watched.add(load);
  load.on('loaderror', (file: Phaser.Loader.File) => {
    const page = file.key.startsWith('pack:') ? index!.pages.indexOf(file.key.slice('pack:'.length)) : -1;
    if (page < 0) return;
    load.off(`filecomplete-image-${file.key}`);
    queued.delete(page);
    missing?.();
  });
}

/** Cuts every image on a loaded page into its own texture, then drops the page: at once, or (unpackInSlices) a few ms a
 *  frame after the page is decoded. */
function unpack(textures: Phaser.Textures.TextureManager, page: number): void {
  if (!byPage) {
    byPage = new Map();
    for (const [file, [p]] of Object.entries(index!.files)) byPage.set(p, [...(byPage.get(p) ?? []), file]);
  }
  const img = textures.get(pageKey(page)).getSourceImage() as HTMLImageElement;
  const files = byPage.get(page) ?? [];
  const name = `unpack ${index!.pages[page].split('/').pop()}`;
  if (!inSlices) {
    const t = performance.now();
    for (const file of files) cut(textures, img, file);
    done(textures, page);
    return lagMark(`${name} (${files.length} images)`, performance.now() - t); // (the lag report)
  }
  cutting.add(page);
  // (One page at a time: several at once each took their few ms, and a frame paid for all of them.)
  turns = turns.then(async () => {
    await img.decode().catch(() => {}); // (off the main thread: drawing it undecoded decodes it there, all at once)
    let start = performance.now();
    for (const file of files) {
      if (performance.now() - start > SLICE_MS) {
        lagMark(name, performance.now() - start);
        await new Promise((r) => requestAnimationFrame(r));
        start = performance.now();
      }
      if (textures.exists(pageKey(page))) cut(textures, img, file);
    }
    lagMark(name, performance.now() - start);
    done(textures, page);
    cutting.delete(page);
    if (!cutting.size) {
      const w = waiters;
      waiters = [];
      for (const r of w) r();
    }
  }).catch(() => {});
}
/** The pages being cut out, one after another. */
let turns: Promise<void> = Promise.resolve();

/** One image of a page into its own texture (sliced into frames if it's a sheet). */
function cut(textures: Phaser.Textures.TextureManager, img: HTMLImageElement, file: string): void {
  if (textures.exists(file)) return;
  const [, x, y, w, h, ...trim] = index!.files[file];
  if (trim.length) trims.set(file, trim);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  // (Kept in memory, not on the GPU: the looks and combat poses read its pixels back, which on integrated graphics was a
  // slow round trip a layer.)
  canvas.getContext('2d', { willReadFrequently: true })!.drawImage(img, x, y, w, h, 0, 0, w, h);
  textures.addCanvas(file, canvas);
  const frame = sheets.get(file);
  if (frame) slice(textures, file, frame[0], frame[1]);
}

/** A page cut out: dropped, and asked for again if anyone needs one of its images later. */
function done(textures: Phaser.Textures.TextureManager, page: number): void {
  if (textures.exists(pageKey(page))) textures.remove(pageKey(page));
  queued.delete(page);
}
