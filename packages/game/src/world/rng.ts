// Seeded randomness, so the same tile always gets the same grass, flower or water variant on every load.

/** A stable 32-bit hash of a few integers (e.g. col, row, salt). */
export function hash(...parts: number[]): number {
  let h = 2166136261;
  for (const p of parts) {
    h ^= p | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

/** mulberry32: a small, fast, seedable generator returning [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One seeded draw for a tile: the same (col, row, salt) always gives the same number. */
export const tileRandom = (col: number, row: number, salt: number) => rng(hash(col, row, salt))();

export const pick = <T>(items: readonly T[], r: number): T => items[Math.min(items.length - 1, Math.floor(r * items.length))];
