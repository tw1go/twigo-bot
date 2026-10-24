import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import type { Plugin } from 'vite';
import { content } from '../src/front/content.ts';
import { gameFacts } from '../src/front/facts.ts';
import { renderBody, renderHead } from '../src/front/render.ts';

// 🌐 The front page's build step: front.html gets its head (title, sharing, icons) and its whole body from
// src/front/content.ts and the game's own data (src/front/facts.ts: levels, stats, the dungeon, counts), read fresh each
// time (in dev, each page load), plus the few manifest entries its script draws from (the splash, the paper doll, the
// classes' idle-ready poses, the mobs, the Warren Gate) as JSON, so the page fetches no manifest. Barong-Barong's
// canvas is cropped to its idle frames' shared box, measured here from its sheet.

const MOBS = ['tin-can', 'bottle-caps', 'tire-roller', 'plastic-bag-spook', 'wire-tangle', 'scrap-crab', 'scrapheap-golem', 'barong-barong',
  'payong-flapper', 'sibuyas-sobber', 'garapon-jars', 'sako-slammer', 'monobloc-stack', 'sangkalan-chomper', 'banyera-lurker', 'timbangan-sentinel', 'great-scale', 'makinang-yelo'];
/** Sprites cropped to their idle's box on the page (their cells are far bigger than the art): the last bosses whole,
 *  in the facing their sheet has, the Great Scale, and the Old Market's mobs on their cards (in the look and facing the page shows). */
const CROPPED: { id: string; variant: string; dir: string }[] = [
  { id: 'barong-barong', variant: '', dir: 's' },
  { id: 'makinang-yelo', variant: '', dir: 'sw' },
  { id: 'great-scale', variant: '', dir: 'se' }, // (its art sits off-centre in its cell: a phone's stage cut into it)
  ...content.market.mobs.map((m) => ({ id: m.id, variant: m.variant, dir: 'se' })),
];

/** The box (x, y, w, h) in a `w`×`h` cell that every one of a sheet's `frames` fits in (row by row). */
function framesBox(file: string, w: number, h: number, frames: number): [number, number, number, number] {
  const png = PNG.sync.read(readFileSync(file));
  const cols = Math.max(1, Math.floor(png.width / w));
  let [x0, y0, x1, y1] = [w, h, 0, 0];
  for (let f = 0; f < frames; f++) {
    const [ox, oy] = [(f % cols) * w, Math.floor(f / cols) * h];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (png.data[((oy + y) * png.width + ox + x) * 4 + 3] > 16) {
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (x >= x1) x1 = x + 1;
          if (y >= y1) y1 = y + 1;
        }
  }
  return x1 > x0 ? [x0, y0, x1 - x0, y1 - y0] : [0, 0, w, h];
}

export function frontPage(): Plugin {
  let base = '/play/';
  let assets = '';
  return {
    name: 'mikazuki-front-page',
    configResolved(config) {
      base = config.base;
      assets = join(config.publicDir, 'assets');
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (!ctx.filename.endsWith('front.html')) return html;
        const json = (f: string) => JSON.parse(readFileSync(join(assets, f), 'utf8'));
        const manifest = json('manifest.json');
        const K = manifest.classes;
        const facts = gameFacts({ manifest, stats: json(K.stats), classes: json(K.data), leveling: json(K.leveling), dungeons: json(K.dungeons), slums: json('maps/slums.json'), warrens: json('maps/warrens.json'), palengke: json('maps/palengke.json'), palengkeLeveling: json(K.palengkeLeveling), halloween: json(manifest.events.halloween) });
        const crops = Object.fromEntries(CROPPED.map(({ id, variant, dir }) => {
          const m = manifest.mobs[id];
          const [w, h] = (variant && m.variants?.[variant]?.size) || m.size;
          return [id, framesBox(join(assets, m.file.replace('{variant}', variant).replace('{anim}', 'idle').replace('{dir}', dir)), w, h, m.animations.idle.frames)];
        }));
        const input = { content, facts, manifest, crops, base, now: Date.now() };
        // What the page's script draws from: only these manifest entries.
        const data = {
          ui: { splashAnim: manifest.ui.splashAnim, splashBg: manifest.ui.splashBg },
          characters: manifest.characters,
          classes: { ...K, list: Object.fromEntries(Object.entries(K.list).map(([id, c]) => [id, { ...(c as object), anims: { 'idle-ready': (c as { anims: Record<string, unknown> }).anims['idle-ready'] } }])) },
          mobs: Object.fromEntries(MOBS.map((id) => [id, manifest.mobs[id]])),
          props: { 'slums-warren-gate': manifest.props['slums-warren-gate'], 'palengke-silong-hatch': manifest.props['palengke-silong-hatch'] },
        };
        const preload = [
          `<link rel="preload" href="/assets/font/Pixelify_Sans/PixelifySans-VariableFont_wght.ttf" as="font" type="font/ttf" crossorigin>`, // (Vite adds the base)
          `<link rel="preload" href="/assets/font/Nunito/Nunito-Latin-Variable.woff2" as="font" type="font/woff2" crossorigin>`,
        ].join('\n    ');
        return html
          .replace('<!--front:head-->', `${renderHead(input)}\n    ${preload}`)
          .replace('<!--front:body-->', `${renderBody(input)}\n<script type="application/json" id="front-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`);
      },
    },
  };
}
