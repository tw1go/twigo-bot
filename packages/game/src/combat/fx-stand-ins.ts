import type { FxDef } from '../assets/types';

// 🧩 The Lv 21-40 skills' FX are being made in PixelLab (the art folder's docs/skills-21-40/lv21-40-fx-pixellab.md).
// The scripts (combat/skill-previews.ts) name the real ones; until a file lands (its manifest fx entry), the stand-in
// here plays, with its own tint and size. Once the manifest has the real one it plays instead, and its line here can go.
// `use: null`: nothing until the art comes.

export interface StandIn {
  use: string | null;
  /** A colour laid over it ('#rrggbb'): the stand-in's, not the real art's. */
  tint?: string;
  scale?: number;
  /** Turned and stretched (a sideways bolt stood up as a beam). */
  angle?: number;
  length?: number;
}

export const FX_STAND_INS: Record<string, StandIn> = {
  // (Every other Lv 21-40 FX is in: the art folder's fx/<class> and fx/shared, 22 Oct 2026.)
  'fx-hilot-spirit-smoke': { use: 'fx-hilot-puff', scale: 0.6 },
};

/** The fx to play for `name` (the manifest's own, else its stand-in) and the stand-in's tint and size; null: none. */
export function resolveFx(fx: Record<string, FxDef>, name: string): { name: string; tint?: string; scale?: number; angle?: number; length?: number } | null {
  if (fx[name]?.file) return { name };
  const s = FX_STAND_INS[name];
  if (!s) return fx[name] ? { name } : null;
  if (!s.use || !fx[s.use]?.file) return null;
  return { name: s.use, tint: s.tint, scale: s.scale, angle: s.angle, length: s.length };
}
