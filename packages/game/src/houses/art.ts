import type Phaser from 'phaser';
import type { HouseLook } from '@mikazuki/shared';
import type { Manifest } from '../assets/types';

// 🏠 Players' houses: each house type is a stack of layers (buildings/houses/parts.json, bottom to top), each layer one
// slot (walls, roof, door…) drawn in key colours. A look picks a swatch per slot (swatches.json) and the layers are
// recoloured and stacked into one canvas (a texture the town draws as a building):
//   • a layer's own family (main, stone or trim: whichever it has most of) takes its slot's swatch — main and stone
//     shade for shade, trim's three shades onto the swatch's last three;
//   • glow (lit windows) takes the windows swatch, leaf and flower the plants swatch;
//   • trim in any other layer takes the house's trimSlot swatch; the outline and the door knob stay as drawn.

type Ramp = string[];
export interface HouseParts {
  keys: Record<'main' | 'trim' | 'stone' | 'glow' | 'leaf', Ramp>;
  flowerKey: string;
  houses: Record<string, { outline: string; trimSlot: string; layers: { order: string; file: string; slot: string }[]; slots: string[]; default: Record<string, string> }>;
}
export interface HouseSwatches {
  solid: Record<string, Ramp>;
  glow: Record<string, Ramp>;
  plants: Record<string, { leaf: Ramp; flower: string }>;
  combos: (Record<string, string> & { name: string })[];
}
export interface HouseArt {
  parts: HouseParts;
  swatches: HouseSwatches;
  /** Folder of the layer files (relative to assets/). */
  dir: string;
  def: NonNullable<Manifest['houses']>;
}

/** Fetches parts.json and swatches.json (named by the manifest); null without them. */
export async function loadHouseArt(M: Manifest): Promise<HouseArt | null> {
  const H = M.houses;
  if (!H) return null;
  const base = `${import.meta.env.BASE_URL}assets/`;
  const get = (f: string) => fetch(base + f).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [parts, swatches] = await Promise.all([get(H.parts), get(H.swatches)]);
  if (!parts || !swatches) return null;
  return { parts, swatches, dir: H.parts.slice(0, H.parts.lastIndexOf('/') + 1), def: H };
}

export const houseStyles = (art: HouseArt) => Object.keys(art.parts.houses);

/** Every layer file of a house type (paths under assets/, as textures are keyed). */
export const houseFiles = (art: HouseArt, style: string): string[] => (art.parts.houses[style]?.layers ?? []).map((l) => art.dir + l.file);

/** Which swatches a slot picks from. */
export const swatchKind = (slot: string): 'glow' | 'plants' | 'solid' => (slot === 'windows' ? 'glow' : slot === 'plants' ? 'plants' : 'solid');

/** A look the art can draw: a known house type, each slot a swatch of the right kind (else the type's default). */
export function tidyLook(art: HouseArt, look: Partial<HouseLook> | null | undefined): HouseLook {
  const styles = houseStyles(art);
  const style = look?.style && art.parts.houses[look.style] ? look.style : styles[0];
  const def = art.parts.houses[style];
  const colours: Record<string, string> = {};
  for (const slot of def.slots) {
    const want = look?.colours?.[slot];
    const pool = art.swatches[swatchKind(slot)] as Record<string, unknown>;
    colours[slot] = want && pool[want] ? want : def.default[slot] ?? Object.keys(pool)[0];
  }
  return { style, colours };
}

/** A combo (a named colour scheme) on a house type: its swatch for each of the type's slots. */
export function comboLook(art: HouseArt, style: string, combo: Record<string, string>): HouseLook {
  return tidyLook(art, { style, colours: Object.fromEntries(art.parts.houses[style].slots.map((s) => [s, combo[s]])) });
}

const hex = (r: number, g: number, b: number) => `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`;
const rgb = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

/** A layer's pixels and its own family, read once per file. */
const layers = new Map<string, { data: ImageData; own: string | null }>();

function layerPixels(scene: Phaser.Scene, art: HouseArt, file: string): { data: ImageData; own: string | null } | null {
  const hit = layers.get(file);
  if (hit) return hit;
  if (!scene.textures.exists(file)) return null;
  const img = scene.textures.get(file).getSourceImage() as HTMLImageElement;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const keyOf = keyTable(art);
  const count: Record<string, number> = {};
  for (let i = 0; i < data.data.length; i += 4) {
    if (!data.data[i + 3]) continue;
    const k = keyOf.get(hex(data.data[i], data.data[i + 1], data.data[i + 2]));
    if (k && (k[0] === 'main' || k[0] === 'stone' || k[0] === 'trim')) count[k[0]] = (count[k[0]] ?? 0) + 1;
  }
  const own = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const layer = { data, own };
  layers.set(file, layer);
  return layer;
}

let keys: Map<string, [string, number]> | null = null;
function keyTable(art: HouseArt): Map<string, [string, number]> {
  if (keys) return keys;
  keys = new Map();
  for (const [family, ramp] of Object.entries(art.parts.keys)) ramp.forEach((c, i) => keys!.set(c.toUpperCase(), [family, i]));
  keys.set(art.parts.flowerKey.toUpperCase(), ['flower', 0]);
  return keys;
}

/** The house in its look, as a canvas the size of the art (null until its layers have loaded). */
export function composeHouse(scene: Phaser.Scene, art: HouseArt, look: HouseLook): HTMLCanvasElement | null {
  const house = art.parts.houses[look.style];
  if (!house) return null;
  const [w, h] = art.def.size;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d')!;
  const frame = ctx.createImageData(w, h);
  const S = art.swatches;
  const keyOf = keyTable(art);
  const plants = S.plants[look.colours.plants] ?? Object.values(S.plants)[0];
  for (const l of house.layers) {
    const layer = layerPixels(scene, art, art.dir + l.file);
    if (!layer) return null;
    const solid = (slot: string) => S.solid[look.colours[slot]] ?? S.solid[house.default[slot]];
    // Each key colour of this layer → its new colour.
    const swap = new Map<string, string>();
    for (const [c, [family, i]] of keyOf) {
      let to: string | undefined;
      if (family === 'glow') to = (S.glow[look.colours.windows] ?? Object.values(S.glow)[0])?.[i];
      else if (family === 'leaf') to = plants?.leaf[i];
      else if (family === 'flower') to = plants?.flower;
      else {
        const ramp = solid(family === layer.own ? l.slot : family === 'trim' ? house.trimSlot : l.slot);
        to = ramp?.[family === 'trim' ? i + 1 : i];
      }
      if (to) swap.set(c, to);
    }
    const src = layer.data.data;
    for (let p = 0; p < src.length; p += 4) {
      if (!src[p + 3]) continue;
      const to = swap.get(hex(src[p], src[p + 1], src[p + 2]));
      const [r, g, b] = to ? rgb(to) : [src[p], src[p + 1], src[p + 2]];
      frame.data[p] = r;
      frame.data[p + 1] = g;
      frame.data[p + 2] = b;
      frame.data[p + 3] = 255;
    }
  }
  ctx.putImageData(frame, 0, 0);
  return out;
}

/** A swatch's two main shades (for the picker's buttons). */
export function swatchShades(art: HouseArt, slot: string, name: string): [string, string] {
  const kind = swatchKind(slot);
  if (kind === 'plants') {
    const p = art.swatches.plants[name];
    return [p.leaf[1], p.flower];
  }
  const ramp = art.swatches[kind][name];
  return kind === 'glow' ? [ramp[0], ramp[1]] : [ramp[1], ramp[2]];
}
