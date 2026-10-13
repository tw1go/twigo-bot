// 🧱 PLACEHOLDER art for the high terrain (tiles/slums/slums-high-terrain-README.md in the art folder is the real
// thing; this stands in until the owner's mikazuki-assets has it). Run: npx tsx scripts/terrain/placeholders.ts (from
// packages/game). Makes, from the existing Slums cliff, rim and concrete art and from plain shapes:
//   tiles/slums: cliff-rock-l|r-1..3 (+ -lower), cliff-scrap-l|r-1..3 (+ -lower), cliff-chasm-l|r-1..3,
//               cliff-chasm-deep-l|r-1..3, cliff-foot-l|r, chasm-lip-nw|ne-1..2, void-1..4, cracked-1..8
//   props/slums: rubble-1..6 (1x1), slab-1..3 (2x2), boulder-1..3 (1x1), junk-spire-1..3 (1x1); all blocked.
// Writes each folder's _sheets-high-terrain.csv (the rows the art folder's would carry, every note starting
// PLACEHOLDER) and appends them to its _sheets.csv (once), and lists everything in manifest.json (tiles.slums.ground
// void / cracked, cliffs rock / scrap with `lower`, chasm, chasm-deep, foot, lip; the props with footprint from the csv
// note and the anchor moved to the footprint's top corner, like the other Slums props). Seeded: the same files each run.
// When the real art comes: copy its files over these (same names), replace the csv rows, and fix the manifest's sizes
// and anchors from its csv. Never packed any differently from the rest (scripts/packs.ts takes the folder).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const ROOT = new URL('../../', import.meta.url);
const ASSETS = new URL('public/assets/', ROOT);
const TILES = new URL('tiles/slums/', ASSETS);
const PROPS = new URL('props/slums/', ASSETS);

type Px = [number, number, number, number];
const read = (url: URL): PNG => PNG.sync.read(readFileSync(url));
const blank = (w: number, h: number): PNG => {
  const p = new PNG({ width: w, height: h });
  p.data.fill(0);
  return p;
};
const get = (p: PNG, x: number, y: number): Px => {
  const i = (y * p.width + x) * 4;
  return [p.data[i], p.data[i + 1], p.data[i + 2], p.data[i + 3]];
};
const set = (p: PNG, x: number, y: number, [r, g, b, a]: Px): void => {
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) return;
  const i = (y * p.width + x) * 4;
  p.data[i] = r;
  p.data[i + 1] = g;
  p.data[i + 2] = b;
  p.data[i + 3] = a;
};
const write = (url: URL, p: PNG): void => writeFileSync(url, PNG.sync.write(p));
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** A seeded random (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A copy of `src` with every opaque pixel's colour pushed toward `toward` by `mix` and scaled by `mul`. */
function recolour(src: PNG, mul: [number, number, number], toward: [number, number, number], mix: number): PNG {
  const out = blank(src.width, src.height);
  for (let y = 0; y < src.height; y++)
    for (let x = 0; x < src.width; x++) {
      const [r, g, b, a] = get(src, x, y);
      if (!a) continue;
      const m = (v: number, k: number, t: number) => clamp(v * k * (1 - mix) + t * mix);
      set(out, x, y, [m(r, mul[0], toward[0]), m(g, mul[1], toward[1]), m(b, mul[2], toward[2]), a]);
    }
  return out;
}

// ── Tiles ──

const tileRows: string[] = [];
const tileNote = (what: string) => `PLACEHOLDER (scripts/terrain/placeholders.ts): ${what}`;
const tileRow = (file: string, w: number, h: number, ax: number, ay: number, note: string) => tileRows.push(`${file},${w},${h},1,0,no,${ax},${ay},${tileNote(note)}`);

/** A material's existing cliff variant (its first ones again where it has fewer than three: sheet and concrete have two). */
const cliff = (mat: string, side: 'l' | 'r', n: number): PNG => {
  let count = 0;
  while (existsSync(new URL(`tile-slums-cliff-${mat}-${side}-${count + 1}.png`, TILES))) count++;
  return read(new URL(`tile-slums-cliff-${mat}-${side}-${((n - 1) % count) + 1}.png`, TILES));
};

/** Wall pieces of a new material from an existing one's three variants. */
function walls(name: string, from: string, mul: [number, number, number], toward: [number, number, number], mix: number, what: string, lower?: { mul: [number, number, number]; what: string }) {
  for (const side of ['l', 'r'] as const) {
    for (let n = 1; n <= 3; n++) {
      const top = recolour(cliff(from, side, n), mul, toward, mix);
      write(new URL(`tile-slums-cliff-${name}-${side}-${n}.png`, TILES), top);
      tileRow(`tile-slums-cliff-${name}-${side}-${n}.png`, 32, 32, 16, 24, `${what} on the ${side === 'l' ? 'SW (left)' : 'SE (right)'} side; draw when that neighbour is lower`);
      if (lower) {
        write(new URL(`tile-slums-cliff-${name}-lower-${side}-${n}.png`, TILES), recolour(top, lower.mul, [0, 0, 0], 0));
        tileRow(`tile-slums-cliff-${name}-lower-${side}-${n}.png`, 32, 32, 16, 24, `${lower.what} on the ${side === 'l' ? 'SW' : 'SE'} side: every step below the top one`);
      }
    }
  }
}
// Rock: the earth cliff gone grey; scrap: the rusty sheet gone browner and darker; chasm: earth in the dark, deeper darker.
walls('rock', 'earth', [0.9, 0.9, 0.95], [120, 118, 125], 0.45, 'rock bluff face (grey stone)', { mul: [0.78, 0.78, 0.82], what: 'rock face, lower step (darker)' });
walls('scrap', 'sheet', [1, 0.85, 0.7], [110, 70, 40], 0.3, 'stacked scrap wall face (rust)', { mul: [0.75, 0.75, 0.75], what: 'scrap face, lower step (darker)' });
walls('chasm', 'earth', [0.5, 0.48, 0.5], [20, 18, 30], 0.45, 'chasm wall, one level below the ground round a void');
walls('chasm-deep', 'earth', [0.3, 0.28, 0.32], [10, 10, 18], 0.6, 'chasm wall two levels down (under the chasm piece)');

// The foot line: a dark 2 px line along the bottom edge of a wall, where it meets the lower ground.
for (const side of ['l', 'r'] as const) {
  const p = blank(32, 32);
  for (let x = 0; x < 16; x++) {
    const y = side === 'l' ? 24 + x / 2 : 31.5 - x / 2;
    const px = side === 'l' ? x : x + 16;
    set(p, px, Math.floor(y), [22, 18, 26, 255]);
    set(p, px, Math.floor(y) + 1, [22, 18, 26, 200]);
  }
  write(new URL(`tile-slums-cliff-foot-${side}.png`, TILES), p);
  tileRow(`tile-slums-cliff-foot-${side}.png`, 32, 32, 16, 24, `foot line under a wall's lowest step on the ${side === 'l' ? 'SW' : 'SE'} side; anchored on the lower ground`);
}

// Chasm lips: the rim gone dark and jagged (two variants).
for (const which of ['nw', 'ne'] as const) {
  const rim = read(new URL(`tile-slums-cliff-rim-${which}.png`, TILES));
  for (let n = 1; n <= 2; n++) {
    const p = recolour(rim, [0.4, 0.38, 0.45], [14, 12, 22], 0.5);
    const rnd = rng(100 + n * 7 + (which === 'nw' ? 0 : 1));
    for (let k = 0; k < 10; k++) {
      // A few crumbs just inside the lip.
      const x = Math.floor(rnd() * 32);
      const y = 12 + Math.floor(rnd() * 14);
      if (get(rim, x, y)[3]) set(p, x, y + 1, [40, 36, 48, 255]);
    }
    write(new URL(`tile-slums-chasm-lip-${which}-${n}.png`, TILES), p);
    tileRow(`tile-slums-chasm-lip-${which}-${n}.png`, 32, 32, 16, 24, `chasm lip on a tile whose ${which.toUpperCase()} neighbour is void, in place of the rim`);
  }
}

/** Whether (x, y) is inside the 32x16 floor diamond. */
const inDiamond = (x: number, y: number) => Math.abs(x + 0.5 - 16) / 16 + Math.abs(y + 0.5 - 8) / 8 <= 1;

// Void: near black with a few specks.
for (let n = 1; n <= 4; n++) {
  const p = blank(32, 16);
  const rnd = rng(500 + n);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) if (inDiamond(x, y)) set(p, x, y, [11, 13, 22, 255]);
  for (let k = 0; k < 3 + n; k++) {
    const x = Math.floor(rnd() * 32);
    const y = Math.floor(rnd() * 16);
    if (inDiamond(x, y)) set(p, x, y, [20, 24, 39, 255]);
  }
  write(new URL(`tile-slums-void-${n}.png`, TILES), p);
  tileRow(`tile-slums-void-${n}.png`, 32, 16, 16, 8, "void: a chasm's floor, never walked on");
}

// Cracked: concrete with one or two dark cracks wandering across.
for (let n = 1; n <= 8; n++) {
  const base = read(new URL(`tile-slums-concrete-${((n - 1) % 12) + 1}.png`, TILES));
  const p = blank(base.width, base.height);
  p.data.set(base.data);
  const rnd = rng(900 + n);
  for (let crack = 0; crack < 1 + (n % 2); crack++) {
    let x = 4 + Math.floor(rnd() * 24);
    let y = 2 + Math.floor(rnd() * 12);
    for (let k = 0; k < 14; k++) {
      if (inDiamond(x, y)) set(p, x, y, [52, 50, 56, 255]);
      x += rnd() < 0.5 ? 1 : rnd() < 0.3 ? -1 : 0;
      y += rnd() < 0.45 ? 1 : rnd() < 0.2 ? -1 : 0;
      if (x < 0 || x >= 32 || y < 0 || y >= 16) break;
    }
  }
  write(new URL(`tile-slums-cracked-${n}.png`, TILES), p);
  tileRow(`tile-slums-cracked-${n}.png`, 32, 16, 16, 8, 'cracked ground: broken concrete, walkable');
}

// ── Props ──

const propRows: string[] = [];
const propRow = (file: string, w: number, h: number, ax: number, ay: number, foot: string, note: string) => propRows.push(`${file},${w},${h},1,0,no,${ax},${ay},${foot}; PLACEHOLDER (scripts/terrain/placeholders.ts): ${note}`);
const GREY: Px[] = [[92, 90, 98, 255], [118, 116, 124, 255], [140, 138, 146, 255], [64, 62, 70, 255]];
const RUST: Px[] = [[110, 62, 34, 255], [140, 84, 44, 255], [78, 44, 26, 255]];

/** A filled blob (an ellipse) with a darker outline. */
function blob(p: PNG, cx: number, cy: number, rx: number, ry: number, fill: Px, edge: Px) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
      if (d <= 1) set(p, x, y, d > 0.72 ? edge : fill);
    }
}

for (let n = 1; n <= 6; n++) {
  const p = blank(32, 32);
  const rnd = rng(2000 + n);
  for (let k = 0; k < 4 + (n % 3); k++) blob(p, 8 + rnd() * 16, 20 + rnd() * 6, 2.5 + rnd() * 3, 1.5 + rnd() * 2, GREY[k % 3], GREY[3]);
  write(new URL(`prop-slums-rubble-${n}.png`, PROPS), p);
  propRow(`prop-slums-rubble-${n}.png`, 32, 32, 16, 24, '1x1', 'rubble: a low heap of broken stone; blocked');
}
for (let n = 1; n <= 3; n++) {
  const p = blank(64, 48);
  const rnd = rng(3000 + n);
  const tilt = 2 + Math.floor(rnd() * 5);
  // A slab: a diamond-ish top, lighter, with a dark side face under its lower edges.
  for (let y = 0; y < 48; y++)
    for (let x = 0; x < 64; x++) {
      const top = Math.abs(x + 0.5 - 32) / 28 + Math.abs(y + 0.5 - 22 + (x - 32) / 64 * tilt) / 12 <= 1;
      const side = !top && Math.abs(x + 0.5 - 32) / 28 + Math.abs(y + 0.5 - 22 - 5 + (x - 32) / 64 * tilt) / 12 <= 1 && y > 22;
      if (top) set(p, x, y, GREY[2]);
      else if (side) set(p, x, y, GREY[3]);
    }
  write(new URL(`prop-slums-slab-${n}.png`, PROPS), p);
  propRow(`prop-slums-slab-${n}.png`, 64, 48, 32, 36, '2x2', 'heaved road slab: a concrete slab tilted up out of the ground; blocked');
}
for (let n = 1; n <= 3; n++) {
  const p = blank(32, 40);
  blob(p, 16, 26, 11 + n, 10, GREY[1], GREY[3]);
  blob(p, 13, 21, 4, 3, GREY[2], GREY[2]);
  write(new URL(`prop-slums-boulder-${n}.png`, PROPS), p);
  propRow(`prop-slums-boulder-${n}.png`, 32, 40, 16, 32, '1x1', 'boulder: a big round stone; blocked');
}
for (let n = 1; n <= 3; n++) {
  const p = blank(32, 64);
  const rnd = rng(4000 + n);
  // A thin spike with a few bits sticking out.
  for (let y = 8 + n * 2; y < 56; y++) {
    const w = 1 + Math.floor((y - 8) / 16);
    for (let dx = -w; dx <= w; dx++) set(p, 16 + dx, y, dx === w ? RUST[2] : RUST[y % 7 === 0 ? 1 : 0]);
  }
  for (let k = 0; k < 4; k++) {
    const y = 16 + Math.floor(rnd() * 32);
    const dir = rnd() < 0.5 ? -1 : 1;
    for (let dx = 1; dx <= 3 + Math.floor(rnd() * 3); dx++) set(p, 16 + dir * dx, y - (dx >> 1), RUST[1]);
  }
  write(new URL(`prop-slums-junk-spire-${n}.png`, PROPS), p);
  propRow(`prop-slums-junk-spire-${n}.png`, 32, 64, 16, 56, '1x1', "junk spire: a tall spike of scrap on a Warrens wall top; blocked");
}

// ── The csvs: the high-terrain rows, and appended to _sheets.csv once ──

const HEADER = 'file,cell_w,cell_h,frames,fps,loop,anchor_x,anchor_y,notes';
function csvs(folder: URL, rows: string[]) {
  writeFileSync(new URL('_sheets-high-terrain.csv', folder), `${HEADER}\n${rows.join('\n')}\n`);
  const main = new URL('_sheets.csv', folder);
  const have = new Set(readFileSync(main, 'utf8').split('\n').map((l) => l.split(',')[0]));
  const add = rows.filter((r) => !have.has(r.split(',')[0]));
  if (add.length) writeFileSync(main, readFileSync(main, 'utf8').replace(/\n*$/, '\n') + add.join('\n') + '\n');
  console.log(`${folder.pathname.split('/').slice(-3).join('/')}: ${rows.length} rows (${add.length} new in _sheets.csv)`);
}
csvs(TILES, tileRows);
csvs(PROPS, propRows);

// ── The manifest ──

const manifestUrl = new URL('manifest.json', ASSETS);
const M = JSON.parse(readFileSync(manifestUrl, 'utf8'));
const S = M.tiles.slums;
const t = (f: string) => `tiles/slums/${f}`;
const three = (name: string, side: string) => [1, 2, 3].map((n) => t(`tile-slums-cliff-${name}-${side}-${n}.png`));
S.ground.void = [1, 2, 3, 4].map((n) => t(`tile-slums-void-${n}.png`));
S.ground.cracked = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => t(`tile-slums-cracked-${n}.png`));
S.cliffs.rock = { l: three('rock', 'l'), r: three('rock', 'r'), lower: { l: three('rock-lower', 'l'), r: three('rock-lower', 'r') } };
S.cliffs.scrap = { l: three('scrap', 'l'), r: three('scrap', 'r'), lower: { l: three('scrap-lower', 'l'), r: three('scrap-lower', 'r') } };
S.cliffs.chasm = { l: three('chasm', 'l'), r: three('chasm', 'r') };
S.cliffs['chasm-deep'] = { l: three('chasm-deep', 'l'), r: three('chasm-deep', 'r') };
S.foot = { l: t('tile-slums-cliff-foot-l.png'), r: t('tile-slums-cliff-foot-r.png') };
S.lip = { nw: [1, 2].map((n) => t(`tile-slums-chasm-lip-nw-${n}.png`)), ne: [1, 2].map((n) => t(`tile-slums-chasm-lip-ne-${n}.png`)) };
S.highTerrainNote =
  'High terrain (tiles/slums/slums-high-terrain-README.md): ground void (a chasm floor, below level 0) and cracked (walkable); cliffs rock and scrap with `lower` (every step below the top one), chasm (one level below the ground) and chasm-deep (two); foot l/r = the line on a wall\'s lowest step; lip nw/ne = the chasm lip in place of the rim next to a void. PLACEHOLDER art until the art folder has its own (scripts/terrain/placeholders.ts).';
const prop = (id: string, file: string, size: [number, number], csvAnchor: [number, number], foot: number) => {
  M.props[id] = { file: `props/slums/${file}`, size, anchor: [csvAnchor[0], csvAnchor[1] - 8 * foot], footprint: [foot, foot], walkable: false, note: 'PLACEHOLDER high-terrain prop (scripts/terrain/placeholders.ts); anchor = the footprint\'s top corner (the csv gives its centre).' };
};
for (let n = 1; n <= 6; n++) prop(`slums-rubble-${n}`, `prop-slums-rubble-${n}.png`, [32, 32], [16, 24], 1);
for (let n = 1; n <= 3; n++) prop(`slums-slab-${n}`, `prop-slums-slab-${n}.png`, [64, 48], [32, 36], 2);
for (let n = 1; n <= 3; n++) prop(`slums-boulder-${n}`, `prop-slums-boulder-${n}.png`, [32, 40], [16, 32], 1);
for (let n = 1; n <= 3; n++) prop(`slums-junk-spire-${n}`, `prop-slums-junk-spire-${n}.png`, [32, 64], [16, 56], 1);
writeFileSync(manifestUrl, JSON.stringify(M, null, 2) + '\n');
if (!existsSync(new URL('tile-slums-cliff-rock-l-1.png', TILES))) mkdirSync(TILES, { recursive: true });
console.log('manifest: tiles.slums void/cracked/rock/scrap/chasm/chasm-deep/foot/lip, 15 props');
