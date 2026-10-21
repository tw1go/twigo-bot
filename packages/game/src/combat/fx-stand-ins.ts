import type { FxDef } from '../assets/types';

// 🧩 The Lv 21-40 skills' FX are being made in PixelLab (the art folder's docs/skills-21-40/lv21-40-fx-pixellab.md).
// The scripts (combat/skill-previews.ts) name the real ones; until a file lands (its manifest fx entry), the stand-in
// here plays, with its own tint and size. Once the manifest has the real one it plays instead, and its line here can go.
// `use: null`: nothing until the art comes (the world draws its own mark meanwhile: stun stars, taunt marks).

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
  // Slingshot
  'fx-slingshot-crit-star': { use: 'fx-slingshot-hit' },
  'fx-slingshot-marble': { use: 'fx-pebble-bullet-small' },
  'fx-slingshot-marble-burst': { use: 'fx-slingshot-hit', scale: 1.4 },
  'fx-slingshot-charge': { use: 'fx-slingshot-launch' },
  'fx-slingshot-charge-full': { use: 'fx-slingshot-launch', scale: 1.5, tint: '#FDE68A' },
  'fx-slingshot-hail': { use: 'fx-pebble-volley' },
  'fx-slingshot-homing': { use: 'fx-pebble-bullet-small' },
  // Stick
  'fx-stick-crosscut': { use: 'fx-wind-rise-se' },
  'fx-stick-thunder-hit': { use: 'fx-wind-hit', tint: '#FEF08A' },
  'fx-stick-flurry': { use: 'fx-wind-hit' },
  'fx-stick-shatter-impact': { use: 'fx-wind-hit', scale: 1.3 },
  'fx-stick-shatter-ring': { use: 'fx-crimson-quake', tint: '#A3E635' },
  'fx-stick-phantom-fade': { use: null },
  // Greatstick
  'fx-greatstick-quake-crack': { use: 'fx-crimson-quake', scale: 0.5 },
  'fx-greatstick-cyclone': { use: 'fx-crimson-cleave-se' },
  'fx-greatstick-bleed': { use: 'fx-hilot-burn', tint: '#EF4444' },
  'fx-greatstick-timber-slam': { use: 'fx-crimson-quake' },
  // Broom
  'fx-broom-moonbeam': { use: 'fx-broom-chain-bolt', tint: '#C4B5FD', angle: -Math.PI / 2, length: 90 },
  'fx-broom-moonbeam-ground': { use: null },
  'fx-broom-leaf-storm': { use: 'fx-broom-dust-devil' },
  'fx-broom-firefly': { use: 'fx-broom-dust-bolt', tint: '#FDE047' },
  'fx-broom-firefly-pop': { use: 'fx-broom-dust-hit' },
  'fx-broom-star': { use: 'fx-broom-leaf-bolt', tint: '#FDE68A' },
  'fx-broom-star-impact': { use: 'fx-broom-dust-hit' },
  'fx-broom-tempest-ground': { use: 'fx-broom-gust-cone', scale: 1.6 },
  'fx-broom-bolt': { use: 'fx-broom-chain-spark' },
  'fx-broom-thunder-line': { use: 'fx-broom-chain-bolt' },
  // Pot lid
  'fx-potlid-pressure': { use: 'fx-potlid-clang-waves', scale: 0.5 },
  'fx-potlid-oil-pool': { use: 'fx-potlid-splash-puddle', tint: '#F59E0B' },
  'fx-potlid-gong-wave': { use: 'fx-potlid-clang-waves' },
  'fx-potlid-simmer': { use: 'fx-potlid-steam-burst-back' },
  'fx-potlid-searing-hit': { use: 'fx-potlid-hit', tint: '#FB923C' },
  'fx-potlid-scream-ring': { use: 'fx-potlid-clang-waves' },
  // Hilot
  'fx-hilot-nettle-burst': { use: 'fx-hilot-puff' },
  'fx-hilot-spirit-smoke': { use: 'fx-hilot-puff', scale: 0.6 },
  'fx-hilot-herb-storm': { use: 'fx-hilot-puff', scale: 1.5 },
  'fx-hilot-fever-wave': { use: 'fx-hilot-jab', tint: '#FCA5A5' },
  'fx-hilot-wildroot-burst': { use: 'fx-hilot-root-back' },
  'fx-hilot-spirit-vine': { use: 'fx-hilot-jab' },
  // Shared (marks over mobs and the utilities' looks: drawn by the world until they come)
  'fx-stun-stars': { use: null },
  'fx-taunt-mark': { use: null },
};

/** The fx to play for `name` (the manifest's own, else its stand-in) and the stand-in's tint and size; null: none. */
export function resolveFx(fx: Record<string, FxDef>, name: string): { name: string; tint?: string; scale?: number; angle?: number; length?: number } | null {
  if (fx[name]?.file) return { name };
  const s = FX_STAND_INS[name];
  if (!s) return fx[name] ? { name } : null;
  if (!s.use || !fx[s.use]?.file) return null;
  return { name: s.use, tint: s.tint, scale: s.scale, angle: s.angle, length: s.length };
}
