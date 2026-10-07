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
// (tiles, props, buildings, fx, ui); NPC sheets one per NPC. Images too big for a page stay loose. In dev nothing
// is packed.

const MAX_PAGE = 2048;
const OUT_DIR = 'packs'; // under assets/, which the server caches for good (the names carry a content hash)

/** [page, x, y, w, h] for each packed path, plus the page files (relative to assets/). */
export interface PackIndex {
  pages: string[];
  files: Record<string, [number, number, number, number, number]>;
}

interface Img {
  file: string; // path under assets/
  png: PNG;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

/** Character layers group by item (the name without -{anim}-{dir}); a class's combat poses by class and anim
 *  (characters/classes/<class>/<anim>), the class fx by their folder (fx/<class>); the rest by top folder. */
function groupOf(file: string, anims: string[], dirs: string[]): string {
  const parts = file.split('/');
  if (parts[0] === 'characters' && parts[1] === 'classes' && parts.length > 4) return `class-${parts[2]}-${parts[3]}`;
  if (parts[0] === 'fx' && parts.length > 2) return `fx-${parts[1]}`;
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
  for (const path of walk(assetsDir)) {
    if (!path.endsWith('.png')) continue;
    const file = relative(assetsDir, path).split('\\').join('/');
    const png = PNG.sync.read(readFileSync(path));
    if (png.width > MAX_PAGE || png.height > MAX_PAGE) continue;
    const g = groupOf(file, anims, dirs);
    groups.set(g, [...(groups.get(g) ?? []), { file, png }]);
  }

  const index: PackIndex = { pages: [], files: {} };
  const out: { fileName: string; source: Buffer }[] = [];
  for (const [group, imgs] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const pages = shelves(imgs);
    pages.forEach((placed, i) => {
      const w = Math.max(...placed.map((p) => p.x + p.img.png.width));
      const h = Math.max(...placed.map((p) => p.y + p.img.png.height));
      const page = new PNG({ width: w, height: h });
      for (const p of placed) PNG.bitblt(p.img.png, page, 0, 0, p.img.png.width, p.img.png.height, p.x, p.y);
      const source = PNG.sync.write(page, { deflateLevel: 9 });
      const hash = createHash('sha256').update(source).digest('hex').slice(0, 8);
      const name = `${group}${pages.length > 1 ? `-${i + 1}` : ''}-${hash}.png`;
      const n = index.pages.push(`${OUT_DIR}/${name}`) - 1;
      for (const p of placed) index.files[p.img.file] = [n, p.x, p.y, p.img.png.width, p.img.png.height];
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
