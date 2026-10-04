// Pixels read back from a canvas aren't always exact: Brave (and other anti-fingerprinting browsers) nudge the
// values a little, so an exact colour match misses some pixels. Colours are compared with a small tolerance —
// far smaller than the gap between any two colours we look for — and "visible" means clearly not transparent.

const TOLERANCE = 8;

/** The pixel at byte offset i is (r, g, b), give or take a nudge. */
export function isColour(d: Uint8ClampedArray, i: number, r: number, g: number, b: number): boolean {
  return Math.abs(d[i] - r) <= TOLERANCE && Math.abs(d[i + 1] - g) <= TOLERANCE && Math.abs(d[i + 2] - b) <= TOLERANCE;
}

/** Two pixels (same offset in two images) differ by more than a nudge. */
export function differs(a: Uint8ClampedArray, b: Uint8ClampedArray, i: number): boolean {
  return Math.abs(a[i] - b[i]) > TOLERANCE || Math.abs(a[i + 1] - b[i + 1]) > TOLERANCE || Math.abs(a[i + 2] - b[i + 2]) > TOLERANCE || Math.abs(a[i + 3] - b[i + 3]) > TOLERANCE;
}

/** An alpha value that's really there (not a nudged transparent pixel). */
export const visible = (alpha: number): boolean => alpha > 24;
