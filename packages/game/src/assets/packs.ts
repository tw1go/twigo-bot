import type Phaser from 'phaser';
import index from 'virtual:packs';

// In a build the images come packed into a few sheets (scripts/packs.ts). The game still asks for an image by its
// path under assets/: the loader fetches the sheet holding it, then every image on that sheet is cut back out
// into its own texture under its own path, so the rest of the game (and its pixel reads) can't tell the
// difference. In dev `index` is null and every image loads on its own.

const pageKey = (page: number) => `pack:${index!.pages[page]}`;
const queued = new Set<number>();
/** Frame sizes of the images that are sheets, so they can be sliced once cut out. */
const sheets = new Map<string, [number, number]>();
let byPage: Map<number, string[]> | null = null;

export const packed = (file: string): boolean => !!index?.files[file];

/** Numbered frames across a sheet, row by row (as Phaser's spritesheet loader names them). */
export function slice(textures: Phaser.Textures.TextureManager, file: string, w: number, h: number): void {
  const tex = textures.get(file);
  if (tex.has('0')) return;
  const { width, height } = tex.getSourceImage() as HTMLCanvasElement;
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
  load.image(pageKey(page), index!.pages[page]);
  load.once(`filecomplete-image-${pageKey(page)}`, () => unpack(textures, page));
}

/** Cuts every image on a loaded page into its own texture, then drops the page. */
function unpack(textures: Phaser.Textures.TextureManager, page: number): void {
  if (!byPage) {
    byPage = new Map();
    for (const [file, [p]] of Object.entries(index!.files)) byPage.set(p, [...(byPage.get(p) ?? []), file]);
  }
  const img = textures.get(pageKey(page)).getSourceImage() as HTMLImageElement;
  for (const file of byPage.get(page) ?? []) {
    if (textures.exists(file)) continue;
    const [, x, y, w, h] = index!.files[file];
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, x, y, w, h, 0, 0, w, h);
    textures.addCanvas(file, canvas);
    const frame = sheets.get(file);
    if (frame) slice(textures, file, frame[0], frame[1]);
  }
  textures.remove(pageKey(page));
  queued.delete(page);
}
