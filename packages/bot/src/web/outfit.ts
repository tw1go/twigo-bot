import type { OutfitData } from '@mikazuki/shared';
import { db } from '../db/db.js';

// Character looks for the web game. The bot doesn't know the wardrobe (that's the game's manifest), so it checks
// the shape strictly — known fields, short lowercase names — and the game ignores anything it can't draw.

const REQUIRED = ['skin', 'hair', 'hairColour', 'top', 'topColour', 'topTrim', 'bottom', 'bottomColour', 'bottomTrim', 'shoes', 'shoesColour'] as const;
const OPTIONAL = ['glasses', 'glassesColour', 'hat', 'hatColour'] as const;
const NAME = /^[a-z0-9-]{1,24}$/;

/** The outfit if `body` is a valid one, else null. */
export function parseOutfit(body: unknown): OutfitData | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;
  const allowed = new Set<string>([...REQUIRED, ...OPTIONAL]);
  if (Object.keys(o).some((k) => !allowed.has(k))) return null;
  const out: Record<string, string> = {};
  for (const k of REQUIRED) {
    if (typeof o[k] !== 'string' || !NAME.test(o[k] as string)) return null;
    out[k] = o[k] as string;
  }
  for (const k of OPTIONAL) {
    if (o[k] === undefined || o[k] === null) continue;
    if (typeof o[k] !== 'string' || !NAME.test(o[k] as string)) return null;
    out[k] = o[k] as string;
  }
  return out as unknown as OutfitData;
}

const getStmt = db.prepare<[string], { outfit: string }>('SELECT outfit FROM outfits WHERE user_id = ?');
const setStmt = db.prepare('INSERT INTO outfits (user_id, outfit, updated) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET outfit = excluded.outfit, updated = excluded.updated');

export function getOutfit(userId: string): OutfitData | null {
  const row = getStmt.get(userId);
  return row ? parseOutfit(JSON.parse(row.outfit)) : null;
}

export function saveOutfit(userId: string, outfit: OutfitData): void {
  setStmt.run(userId, JSON.stringify(outfit), Date.now());
}
