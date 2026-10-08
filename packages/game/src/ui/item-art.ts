import type { GearRarity } from '@mikazuki/shared';
import type { ItemArtDef } from '../assets/types';

// Item art in the page (pop-ups, the shop, the dig panel): an item's picture in a rarity frame — a 1 px border and a
// glow behind it in the rarity's colours (legendary and secret shimmer, two frames) — drawn at whole-number scales
// with crisp pixels. Pictures come from the manifest's `items` (set once by the town); an id without art gives null,
// so callers keep their emoji or text.

export type Rarity = 'junk' | 'common' | 'uncommon' | 'rare' | 'epic' | 'mythical' | 'legendary' | 'secret' | GearRarity;

/** Border and glow per rarity (the bot's rarity colours; junk has no glow), then equipment's (classes/stats.json
 *  `rarity`, which names them but has no colours: these are ours). */
const FRAMES: Record<Rarity, { border: string; glow: string | null; shimmer?: boolean }> = {
  junk: { border: '#3D4256', glow: null },
  common: { border: '#7A8099', glow: '#7A8099' },
  uncommon: { border: '#22C55E', glow: '#22C55E' },
  rare: { border: '#5B8FD1', glow: '#5B8FD1' },
  epic: { border: '#7C2AE8', glow: '#B794F6' },
  mythical: { border: '#F59E0B', glow: '#FFC46B' },
  legendary: { border: '#F8BF27', glow: '#FCFC64', shimmer: true },
  secret: { border: '#D946EF', glow: '#F0ABFC', shimmer: true },
  brown: { border: '#8A5A34', glow: '#C68B59' },
  white: { border: '#C8CCD8', glow: '#F2F3F7' },
  grey: { border: '#6B7180', glow: '#A3A9B8' },
  lightBlue: { border: '#5BB8E8', glow: '#9EDCFB' },
  darkBlue: { border: '#3B5FC0', glow: '#6E8EF0' },
  lightOrange: { border: '#E8A04A', glow: '#FFC98A' },
  darkOrange: { border: '#D2621C', glow: '#FF8F45' },
};
/** Each rarity's name, for labels. */
export const RARITY_LABEL: Record<Rarity, string> = {
  junk: 'Junk', common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', mythical: 'Mythical', legendary: 'Legendary', secret: 'Secret',
  brown: 'Brown', white: 'White', grey: 'Grey', lightBlue: 'Light blue', darkBlue: 'Dark blue', lightOrange: 'Light orange', darkOrange: 'Dark orange',
};
export const RARITY_COLOUR: Record<Rarity, string> = Object.fromEntries(Object.entries(FRAMES).map(([r, f]) => [r, f.border])) as Record<Rarity, string>;
/** The rarity's colour for text on the dark dig panel: its glow (lighter), and a readable grey for junk. */
export const RARITY_TEXT: Record<Rarity, string> = Object.fromEntries(Object.entries(FRAMES).map(([r, f]) => [r, f.glow ?? '#9AA1B8'])) as Record<Rarity, string>;
export const isRarity = (s: string): s is Rarity => s in FRAMES;

let items: Record<string, ItemArtDef> = {};
let base = '';

/** The manifest's item art, and where assets are served from. */
export function setItemArt(art: Record<string, ItemArtDef> | undefined, assetsUrl: string): void {
  items = art ?? {};
  base = assetsUrl;
}

/** More item art (the equipment's, from items/equipment.json), next to the manifest's. */
export function addItemArt(art: Record<string, ItemArtDef>): void {
  items = { ...items, ...art };
}

/** Whether an item has a picture of this size. */
export const hasItemArt = (id: string, size: 'icon' | 'showcase') => (size === 'icon' ? !!items[id]?.icon : !!(items[id]?.showcase || items[id]?.anim));

/** The frame behind a picture (`inner` art pixels square): two cells side by side — the glow, and the glow with its
 *  shimmer — each with a 1 px border. Cached per rarity and size. */
const frames = new Map<string, string>();
function frameStrip(rarity: Rarity, inner: number, bare = false): string {
  const key = `${rarity}:${inner}:${bare}`;
  const done = frames.get(key);
  if (done) return done;
  const f = FRAMES[rarity];
  const cell = inner + 2;
  const c = document.createElement('canvas');
  c.width = cell * 2;
  c.height = cell;
  const ctx = c.getContext('2d')!;
  const px = (x: number, y: number, color: string, alpha = 1) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  };
  const mid = cell / 2;
  for (let n = 0; n < 2; n++) {
    const ox = n * cell;
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const edge = x === 0 || y === 0 || x === cell - 1 || y === cell - 1;
        if (edge) {
          if (!bare) px(ox + x, y, f.border);
          continue;
        }
        if (!bare) px(ox + x, y, '#1E1B3A'); // the slot
        if (!f.glow) continue;
        // A stepped round glow (three rings, fading out), a ring wider on the shimmer frame.
        const d = Math.hypot(x + 0.5 - mid, y + 0.5 - mid) / (inner / 2);
        const reach = n && f.shimmer ? 1.05 : 0.95;
        const a = d < reach * 0.45 ? 0.55 : d < reach * 0.7 ? 0.35 : d < reach ? 0.18 : 0;
        if (a) px(ox + x, y, f.glow, a);
      }
    }
    if (n && f.shimmer && f.glow) {
      // Sparkles in two corners.
      for (const [sx, sy] of [[3, 3], [cell - 4, cell - 5]]) {
        px(ox + sx, sy, '#FFFFFF');
        px(ox + sx - 1, sy, f.glow, 0.8);
        px(ox + sx + 1, sy, f.glow, 0.8);
        px(ox + sx, sy - 1, f.glow, 0.8);
        px(ox + sx, sy + 1, f.glow, 0.8);
      }
    }
  }
  ctx.globalAlpha = 1;
  const url = c.toDataURL();
  frames.set(key, url);
  return url;
}

/** An item's picture in its rarity frame at `scale`× ('showcase' = 32 px for pop-ups, 'icon' = 16 px for rows), or
 *  null when it has no art of that size. Animated items play their sheet. `bare`: the glow only, without the slot and
 *  border (the dig panel's find, out of the ground). */
export function itemArt(id: string, rarity: Rarity = 'common', size: 'icon' | 'showcase' = 'showcase', scale = size === 'icon' ? 1 : 2, bare = false): HTMLElement | null {
  const a = items[id];
  const anim = size === 'showcase' ? a?.anim : undefined;
  const still = size === 'icon' ? a?.icon : a?.showcase;
  if (!anim && !still) return null;
  const inner = size === 'icon' ? 16 : 32;
  const cell = (inner + 2) * scale;
  const f = FRAMES[rarity];

  const box = document.createElement('span');
  box.className = `it-frame${f.shimmer ? ' it-shimmer' : ''}`;
  box.style.width = box.style.height = `${cell}px`;
  box.style.backgroundImage = `url("${frameStrip(rarity, inner, bare)}")`;
  box.style.backgroundSize = `${cell * 2}px ${cell}px`;
  box.style.setProperty('--cell', `${cell}px`);

  const pic = document.createElement('span');
  pic.className = 'it-pic';
  pic.style.width = pic.style.height = `${inner * scale}px`;
  pic.style.left = pic.style.top = `${scale}px`;
  if (anim) {
    pic.classList.add('it-anim');
    pic.style.backgroundImage = `url("${base}${anim.file}")`;
    pic.style.backgroundSize = `${anim.frames * inner * scale}px ${inner * scale}px`;
    pic.style.setProperty('--strip', `${-anim.frames * inner * scale}px`);
    pic.style.animationDuration = `${anim.frames / anim.fps}s`;
    pic.style.animationTimingFunction = `steps(${anim.frames})`;
  } else {
    pic.style.backgroundImage = `url("${base}${still}")`;
    pic.style.backgroundSize = `${inner * scale}px ${inner * scale}px`;
  }
  box.append(pic);
  return box;
}
