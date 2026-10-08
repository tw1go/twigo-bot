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

/** A tile's 32-bit hash for picking a variant: murmur3's mixing of col and row into a seed, then its finaliser, so
 *  every input bit reaches every output bit. Neighbours, rows, columns and diagonals all get unrelated numbers: no
 *  stripes or repeats lining up (as (col + row) % n or col·a + row·b would). */
export function mix32(col: number, row: number, seed: number): number {
  let h = seed | 0;
  for (const part of [col, row]) {
    let k = Math.imul(part | 0, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  h ^= 8;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A seed from a name (FNV-1a), e.g. a ground kind's, so each kind's variants fall independently of the others'. */
export function seedOf(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The variant a tile shows: seeded by (col, row) and its kind's seed. */
export const variantAt = <T>(items: readonly T[], col: number, row: number, seed: number): T => items[mix32(col, row, seed) % items.length];
