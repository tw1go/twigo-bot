import type { Manifest } from '../assets/types';

// The game's own cursor (manifest ui.cursor): a pointer and a hand, as CSS cursors scaled by a whole number with
// crisp pixels. The page (login, creator, HUD) uses PAGE_SCALE through CSS variables; the town scales them with
// the camera zoom.

export type CursorKind = 'pointer' | 'hand';

const PAGE_SCALE = 2;
const FALLBACK: Record<CursorKind, string> = { pointer: 'auto', hand: 'pointer' };

let sheet: HTMLImageElement | null = null;
let def: { size: [number, number]; frames: Record<CursorKind, number>; hotspot: Record<CursorKind, [number, number]> } | null = null;
const cache = new Map<string, string>();

/** Loads the cursor art once and puts the page cursors in place. */
export async function loadCursors(M: Manifest): Promise<void> {
  const ui = M.ui as unknown as { cursor?: typeof def & { file: string } };
  const c = ui.cursor;
  if (!c?.file || sheet) return;
  const img = new Image();
  img.src = `${import.meta.env.BASE_URL}assets/${c.file}`;
  try {
    await img.decode();
  } catch {
    return; // keep the system cursors
  }
  sheet = img;
  def = c;
  const root = document.documentElement.style;
  root.setProperty('--cur-pointer', cursor('pointer', PAGE_SCALE));
  root.setProperty('--cur-hand', cursor('hand', PAGE_SCALE));
}

/** A CSS cursor value for one frame at a whole-number scale (the system cursor until the art has loaded). */
export function cursor(kind: CursorKind, scale: number): string {
  if (!sheet || !def) return FALLBACK[kind];
  const key = `${kind}@${scale}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [w, h] = def.size;
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sheet, def.frames[kind] * w, 0, w, h, 0, 0, w * scale, h * scale);
  const [hx, hy] = def.hotspot[kind];
  const css = `url(${canvas.toDataURL()}) ${hx * scale} ${hy * scale}, ${FALLBACK[kind]}`;
  cache.set(key, css);
  return css;
}
