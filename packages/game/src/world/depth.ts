// Draw order. Ground tiles are far below everything; objects and characters sort by the screen y of their
// footprint's front corner, (col + footprintCols + row + footprintRows) × 8 — see frontDepth().

export const GROUND_DEPTH = -1_000_000; // + (col + row) × 4 + layer, so tiles overlap back to front
export const GROUND_SHADOW_DEPTH = -10_000; // tree shadows: on the ground, under every object
export const GLOW_DEPTH = 1_000_000; // lamp glows: additive light over the whole world
export const LABEL_DEPTH = 2_000_000; // name plates and building names: over everything, glows included

/** A character drawn at the same front corner as an object is in front of it (e.g. standing at a door). */
export const CHARACTER_BIAS = 0.5;

export const frontDepth = (col: number, row: number, cols: number, rows: number) => (col + cols + row + rows) * 8;
