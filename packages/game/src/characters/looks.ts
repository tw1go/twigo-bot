import type { OutfitData } from '@mikazuki/shared';
import type { CharacterDefs } from '../assets/types';
import { rng } from '../world/rng';
import { type Outfit, randomOutfit } from './doll';
import type { MeResult } from '../session';

// Which look the player starts with, and the choices the wardrobe offers — all from the manifest.

const LOCAL_KEY = 'mk_outfit';
const SEED_KEY = 'mk_outfit_seed';

export interface Choices {
  skin: string[];
  colours: string[];
  hair: string[];
  top: string[];
  bottom: string[];
  shoes: string[];
  glasses: string[];
  hats: string[];
}

export function choices(C: CharacterDefs): Choices {
  const W = C.wardrobe;
  return {
    skin: Object.keys(C.skinTones).filter((k) => Array.isArray(C.skinTones[k])),
    colours: Object.keys(C.colourPresets).filter((k) => Array.isArray(C.colourPresets[k])),
    hair: W.hair,
    top: W.top,
    bottom: W.bottom,
    shoes: W.shoes,
    glasses: W.glasses,
    hats: W.hats,
  };
}

/** Keeps every field the manifest knows; anything else falls back to `fallback` (old saves, renamed items). */
export function sanitize(C: CharacterDefs, saved: Partial<OutfitData> | null | undefined, fallback: Outfit): Outfit {
  if (!saved) return fallback;
  const c = choices(C);
  const one = (v: unknown, list: string[], dflt: string) => (typeof v === 'string' && list.includes(v) ? v : dflt);
  const opt = (v: unknown, list: string[]) => (typeof v === 'string' && list.includes(v) ? v : undefined);
  return {
    skin: one(saved.skin, c.skin, fallback.skin),
    hair: one(saved.hair, c.hair, fallback.hair),
    hairColour: one(saved.hairColour, c.colours, fallback.hairColour),
    top: one(saved.top, c.top, fallback.top),
    topColour: one(saved.topColour, c.colours, fallback.topColour),
    topTrim: one(saved.topTrim, c.colours, fallback.topTrim),
    bottom: one(saved.bottom, c.bottom, fallback.bottom),
    bottomColour: one(saved.bottomColour, c.colours, fallback.bottomColour),
    bottomTrim: one(saved.bottomTrim, c.colours, fallback.bottomTrim),
    shoes: one(saved.shoes, c.shoes, fallback.shoes),
    shoesColour: one(saved.shoesColour, c.colours, fallback.shoesColour),
    glasses: opt(saved.glasses, c.glasses),
    glassesColour: one(saved.glassesColour, c.colours, fallback.glassesColour ?? c.colours[0]),
    hat: opt(saved.hat, c.hats),
    hatColour: one(saved.hatColour, c.colours, fallback.hatColour ?? c.colours[0]),
  };
}

function localSeed(): number {
  const param = new URLSearchParams(location.search).get('outfit');
  if (param) return Number(param) >>> 0;
  try {
    const saved = localStorage.getItem(SEED_KEY);
    if (saved) return Number(saved) >>> 0;
    const seed = Math.floor(Math.random() * 2 ** 31);
    localStorage.setItem(SEED_KEY, String(seed));
    return seed;
  } catch {
    return Math.floor(Math.random() * 2 ** 31);
  }
}

export function loadLocal(): Partial<OutfitData> | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as Partial<OutfitData>) : null;
  } catch {
    return null;
  }
}

export function saveLocal(o: Outfit): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(o));
  } catch {
    // private mode: the look just won't persist in this browser
  }
}

/** Saved on the account → saved in this browser → a stable random look. (?outfit=N forces a random seed.) */
export function startingOutfit(C: CharacterDefs, me: MeResult | null): Outfit {
  const random = randomOutfit(C, rng(localSeed()));
  if (new URLSearchParams(location.search).has('outfit')) return random;
  if (me?.status === 'ok' && me.me.outfit) return sanitize(C, me.me.outfit, random);
  return sanitize(C, loadLocal(), random);
}

/** Saves the look: on the account when logged in (and always in this browser). */
export async function saveOutfit(o: Outfit, loggedIn: boolean): Promise<'account' | 'browser' | 'error'> {
  saveLocal(o);
  if (!loggedIn) return 'browser';
  const res = await fetch('/outfit', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(o),
  }).catch(() => null);
  return res?.ok ? 'account' : 'error';
}
