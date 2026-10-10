import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { PNG } from 'pngjs';
import type { Plugin } from 'vite';

// Build step: packs the loose images under public/assets into a few sheets, so the first visit downloads a
// handful of files instead of a few hundred. The game still asks for images by their path under assets/ (the
// manifest stays the source of truth); src/assets/packs.ts maps a path to its sheet and cuts it back out.
//
// Character layers go one sheet per item (char-top-jacket, char-hair-bob, char-body, …: every animation and
// direction of it), so an outfit loads only what it wears. Everything else goes one sheet per top folder
// (tiles, props, buildings, fx, ui); NPC sheets one per NPC. Images too big for a page stay loose, except a mob's sheets
// drawn on canvases wider than a page (Barong-Barong: 768×512 cells, five a row, most of each cell empty round its body):
// each is cut to the one box its frames all fit in and laid out again as many a row as fit a page, a page of its own
// (so a sheet loads only when it's asked for); the index keeps the cell and the box, and the game puts each frame back in
// its cell (src/assets/packs.ts: trimmed frames, anchors unchanged). Barong-Barong's 241 MB decoded comes to about 152.
// In dev nothing is packed.

const MAX_PAGE = 2048;
/** A trimmed sheet's own page may be this big (the untrimmed ones were 3840 wide already). */
const TRIM_PAGE = 4096;
const OUT_DIR = 'packs'; // under assets/, which the server caches for good (the names carry a content hash)

/** [page, x, y, w, h] for each packed path (a trimmed sheet: + [cellW, cellH, boxX, boxY, boxW, boxH]), plus the page
 *  files (relative to assets/). */
export interface PackIndex {
  pages: string[];
  files: Record<string, number[]>;
}

interface Img {
  file: string; // path under assets/
  png: PNG;
  /** A trimmed sheet's cell and box (see trim). */
  trim?: number[];
}

/** Every mob sheet's cell size and frame count (manifest mobs: its anims × directions, the enraged set), by path. */
function mobCells(manifest: { mobs?: Record<string, unknown> }): Map<string, [number, number, number]> {
  const cells = new Map<string, [number, number, number]>();
  type Def = { file: string; size: [number, number]; directions: string[]; animations: Record<string, { frames: number }>; variants?: Record<string, unknown>; enraged?: { file: string; animations: string[] } };
  for (const def of Object.values(manifest.mobs ?? {}) as Def[]) {
    if (typeof def !== 'object' || !def.file || def.variants) continue;
    for (const [anim, a] of Object.entries(def.animations)) for (const dir of def.directions) cells.set(def.file.replace('{anim}', anim).replace('{dir}', dir), [...def.size, a.frames]);
    for (const anim of def.enraged?.animations ?? []) for (const dir of def.directions) cells.set(def.enraged!.file.replace('{anim}', anim).replace('{dir}', dir), [...def.size, def.animations[anim]?.frames ?? 0]);
  }
  return cells;
}

/** A sheet of `cw × ch` cells cut to the box all its frames fit in, its `frames` laid out again in that box's size (in
 *  order, as square as fits). Null: nothing drawn, or still too big. */
function trim(png: PNG, [cw, ch, frames]: [number, number, number]): { png: PNG; trim: number[] } | null {
  const [cols, rows] = [Math.floor(png.width / cw), Math.floor(png.height / ch)];
  let [x0, y0, x1, y1] = [cw, ch, -1, -1];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      for (let y = 0; y < ch; y++)
        for (let x = 0; x < cw; x++) {
          if (!png.data[((r * ch + y) * png.width + c * cw + x) * 4 + 3]) continue;
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (x > x1) x1 = x;
          if (y > y1) y1 = y;
        }
  if (x1 < 0) return null;
  const [bw, bh] = [x1 - x0 + 1, y1 - y0 + 1];
  const n = Math.min(cols * rows, frames || cols * rows);
  // As square as it can be within a page (a big one on a page of its own up to TRIM_PAGE).
  let per = Math.max(1, Math.floor(MAX_PAGE / bw));
  while (per > 1 && Math.ceil(n / per) * bh < (per - 1) * bw) per--;
  if (Math.ceil(n / per) * bh > MAX_PAGE) per = Math.max(per, Math.ceil(n / Math.floor(TRIM_PAGE / bh)));
  const out = new PNG({ width: Math.min(n, per) * bw, height: Math.ceil(n / per) * bh });
  if (out.width > TRIM_PAGE || out.height > TRIM_PAGE) return null;
  for (let i = 0; i < n; i++) PNG.bitblt(png, out, (i % cols) * cw + x0, Math.floor(i / cols) * ch + y0, bw, bh, (i % per) * bw, Math.floor(i / per) * bh);
  return { png: out, trim: [cw, ch, x0, y0, bw, bh] };
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

/** Character layers group by item (the name without -{anim}-{dir}); a class's combat poses by class and anim
 *  (characters/classes/<class>/<anim>), the class fx by their folder (fx/<class>), mobs by mob (mobs/<mob>, its fx
 *  folder apart); the rest by top folder. */
function groupOf(file: string, anims: string[], dirs: string[]): string {
  const parts = file.split('/');
  if (parts[0] === 'characters' && parts[1] === 'classes' && parts.length > 4) return `class-${parts[2]}-${parts[3]}`;
  if (parts[0] === 'fx' && parts.length > 2) return `fx-${parts[1]}`;
  if (parts[0] === 'mobs' && parts.length > 2) return parts.length > 3 ? `mobs-${parts[1]}-${parts[2]}` : `mobs-${parts[1]}`;
  const m = basename(file).match(new RegExp(`^(.+)-(?:${anims.join('|')})-(?:${dirs.join('|')})\\.png$`));
  return m ? m[1] : parts[0];
}

/** Shelf packing, tallest first: fine for pixel art of similar heights. Returns one list of placements per page. */
function shelves(imgs: Img[]): { img: Img; x: number; y: number }[][] {
  const sorted = [...imgs].sort((a, b) => b.png.height - a.png.height || b.png.width - a.png.width);
  const area = sorted.reduce((s, i) => s + i.png.width * i.png.height, 0);
  const width = Math.min(MAX_PAGE, Math.max(Math.ceil(Math.sqrt(area * 1.1)), ...sorted.map((i) => i.png.width)));
  const pages: { img: Img; x: number; y: number }[][] = [[]];
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const img of sorted) {
    const { width: w, height: h } = img.png;
    if (x + w > width) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    if (y + h > MAX_PAGE) {
      pages.push([]);
      x = y = shelf = 0;
    }
    pages[pages.length - 1].push({ img, x, y });
    x += w;
    shelf = Math.max(shelf, h);
  }
  return pages;
}

export function buildPacks(assetsDir: string): { index: PackIndex; out: { fileName: string; source: Buffer }[] } {
  const manifest = JSON.parse(readFileSync(join(assetsDir, 'manifest.json'), 'utf8'));
  const C = manifest.characters;
  // NPC sheets (npc-<id>-<anim>-<dir>) group the same way: one sheet per NPC, the Tanod's whistle with his.
  const anims = [...new Set([...Object.keys(C.animations), ...Object.keys(manifest.npcs?.animations ?? {})])];
  const dirs: string[] = C.directions;
  const groups = new Map<string, Img[]>();
  const cells = mobCells(manifest);
  // Images only the page draws (manifest ui entries marked `dom`: the title screen's) stay loose: no pack carries them.
  const dom = new Set(Object.values(manifest.ui ?? {}).flatMap((u) => (u && typeof u === 'object' && (u as { dom?: boolean }).dom ? [(u as { file: string }).file] : [])));
  for (const path of walk(assetsDir)) {
    if (!path.endsWith('.png')) continue;
    const file = relative(assetsDir, path).split('\\').join('/');
    if (dom.has(file)) continue;
    const png = PNG.sync.read(readFileSync(path));
    if (png.width > MAX_PAGE || png.height > MAX_PAGE) {
      const cell = cells.get(file);
      const t = cell && trim(png, cell);
      if (t) groups.set(`trim-${basename(file, '.png')}`, [{ file, png: t.png, trim: t.trim }]);
      continue;
    }
    const g = groupOf(file, anims, dirs);
    groups.set(g, [...(groups.get(g) ?? []), { file, png }]);
  }

  const index: PackIndex = { pages: [], files: {} };
  const out: { fileName: string; source: Buffer }[] = [];
  for (const [group, imgs] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const pages = group.startsWith('trim-') ? [[{ img: imgs[0], x: 0, y: 0 }]] : shelves(imgs); // (a trimmed sheet: a page of its own)
    pages.forEach((placed, i) => {
      const w = Math.max(...placed.map((p) => p.x + p.img.png.width));
      const h = Math.max(...placed.map((p) => p.y + p.img.png.height));
      const page = new PNG({ width: w, height: h });
      for (const p of placed) PNG.bitblt(p.img.png, page, 0, 0, p.img.png.width, p.img.png.height, p.x, p.y);
      // Pixel art packs best unfiltered with plain deflate (pngjs's own default, run-length only, wrote every page about
      // five times bigger: all the packs came to 16 MB, now 3).
      const source = PNG.sync.write(page, { deflateLevel: 9, deflateStrategy: 0, filterType: 0 });
      const hash = createHash('sha256').update(source).digest('hex').slice(0, 8);
      const name = `${group}${pages.length > 1 ? `-${i + 1}` : ''}-${hash}.png`;
      const n = index.pages.push(`${OUT_DIR}/${name}`) - 1;
      for (const p of placed) index.files[p.img.file] = [n, p.x, p.y, p.img.png.width, p.img.png.height, ...(p.img.trim ?? [])];
      out.push({ fileName: `assets/${OUT_DIR}/${name}`, source });
    });
  }
  return { index, out };
}

/** `import packs from 'virtual:packs'`: the pack index in a build, null in dev (loose files). */
export function packs(): Plugin {
  const id = 'virtual:packs';
  let build = false;
  let assetsDir = '';
  return {
    name: 'mikazuki-packs',
    configResolved(config) {
      build = config.command === 'build';
      assetsDir = join(config.publicDir, 'assets');
    },
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load(resolved) {
      if (resolved !== `\0${id}`) return;
      if (!build) return 'export default null;';
      const { index, out } = buildPacks(assetsDir);
      for (const f of out) this.emitFile({ type: 'asset', fileName: f.fileName, source: f.source });
      return `export default ${JSON.stringify(index)};`;
    },
  };
}
