import type { HoodMap, HoodObject } from '@mikazuki/shared';

// 🏘️ The neighbourhood's layout, worked out from how many houses there are (pure: the bot's live server checks steps
// against it, the game draws it). Houses stand in bands down the map, 5 in one band and 4 (offset by half a lot) in
// the next, 5, 4… Every house's door is on its SE face (the art's), so each band faces east onto its own street; a
// main street across the top joins them all, and its west end is the way back to town.
//
//   cols: [entrance 2] then per band [house 3][yard 1 (the doors)][street 3][back 1 (bushes)]
// A house with a Bakod has a fence round its yard.
//   rows: [grass 1][main street 3][grass 1] then the lots, 5 rows each (3 for the house, 2 between)
// Benches sit on the top and bottom grass rows, facing the main street and each band's street.

const HOUSE = 3;
const BAND = 8;
const ENTRANCE = 2;
const TOP = 5; // first lot row (below the main street)
const PITCH = 5;
const MAIN = [1, 2, 3]; // the main street's rows
export const HOOD_ROWS = TOP + 5 * PITCH + 1; // 31
/** Houses per band: 5, 4, 5, 4… */
const capacity = (band: number) => (band % 2 ? 4 : 5);
/** Bands always shown (so a new neighbourhood isn't a lonely strip). */
const MIN_BANDS = 2;

/** Where lot `lot` is: its band and its house's top tile. */
export function lotTile(lot: number): { band: number; col: number; row: number } {
  let band = 0;
  let left = lot;
  while (left >= capacity(band)) left -= capacity(band++);
  const col = ENTRANCE + band * BAND;
  const row = TOP + (band % 2 ? 2 : 0) + left * PITCH;
  return { band, col, row };
}

/** How many bands `houses` houses need. */
function bandsFor(houses: number): number {
  let bands = 0;
  for (let room = 0; room < houses; room += capacity(bands)) bands++;
  return Math.max(MIN_BANDS, bands);
}

/** Bushes for the back strips (low, so they never hide the next band's houses behind them; the town's own). */
const BUSHES = ['bush-l-1', 'bush-m-2', 'bush-l-2', 'bush-m-1', 'bush-s-2'];

/** The map for `houses` houses (lots 0…houses-1 are built); `fenced` lots get a fence round them. */
export function hoodMap(houses: number, fenced: Set<number> = new Set()): HoodMap {
  const bands = bandsFor(houses);
  const cols = ENTRANCE + bands * BAND;
  const rows = HOOD_ROWS;
  const ground = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 'grass'));
  const blocked = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
  const objects: HoodObject[] = [];
  const doors: HoodMap['doors'] = {};
  const fence: HoodMap['fence'] = [];
  const block = (c: number, r: number) => (blocked[r][c] = 1);
  const bench = (id: string, c: number, r: number) => {
    objects.push({ kind: 'prop', id, col: c, row: r, footprint: [1, 1] });
    block(c, r);
  };

  for (const r of MAIN) for (let c = 0; c < cols; c++) ground[r][c] = 'path';
  for (let b = 0; b < bands; b++) {
    const bx = ENTRANCE + b * BAND;
    // Benches on the grass at the edges, facing the streets: two along the main street (their backs to the forest),
    // one where the band's street ends.
    for (const c of [bx + 1, bx + HOUSE + 2]) bench('bench-sw', c, 0);
    bench('bench-ne', bx + HOUSE + 2, rows - 1);
    for (let r = MAIN[0]; r < rows - 1; r++) for (let c = bx + HOUSE + 1; c < bx + HOUSE + 4; c++) ground[r][c] = 'path';
    // A lamp in the yard after each lot, and bushes along the back strip.
    for (let i = 0; i < capacity(b); i++) {
      const { row } = lotTile(lotOf(b, i));
      objects.push({ kind: 'prop', id: 'lamp-off', col: bx + HOUSE, row: row + HOUSE, footprint: [1, 1] });
      block(bx + HOUSE, row + HOUSE);
      for (const dr of [0, 2]) {
        objects.push({ kind: 'prop', id: BUSHES[(b * 7 + i * 2 + dr) % BUSHES.length], col: bx + BAND - 1, row: row + dr, footprint: [1, 1], decor: true, walkable: false });
        block(bx + BAND - 1, row + dr);
      }
    }
  }

  for (let lot = 0; lot < houses; lot++) {
    const { col, row } = lotTile(lot);
    const id = `house-${lot}`;
    objects.push({ kind: 'building', id, col, row, footprint: [HOUSE, HOUSE] });
    for (let r = row; r < row + HOUSE; r++) for (let c = col; c < col + HOUSE; c++) block(c, r);
    // The door's tile, or with a Bakod the street just outside the fence in front of it (fences block walking).
    doors[id] = fenced.has(lot) ? [col + HOUSE + 1, row + 1] : [col + HOUSE, row + 1];
    if (fenced.has(lot)) {
      // Round the yard, a tile out from the house (the door inside): west and east sides on tiles' nw edges, north and
      // south on their ne edges.
      const [c0, r0, c1, r1] = [col - 1, row - 1, col + HOUSE + 1, row + HOUSE + 1];
      for (let r = r0; r < r1; r++) fence.push({ col: c0, row: r, edge: 'nw' }, { col: c1, row: r, edge: 'nw' });
      for (let c = c0; c < c1; c++) fence.push({ col: c, row: r0, edge: 'ne' }, { col: c, row: r1, edge: 'ne' });
    }
  }

  return { size: [cols, rows], spawn: [1, MAIN[1]], ground, blocked, objects, doors, fence, exit: MAIN.map((r) => [0, r] as [number, number]) };
}

/** The lot number of band `band`'s `i`-th house. */
function lotOf(band: number, i: number): number {
  let lot = i;
  for (let b = 0; b < band; b++) lot += capacity(b);
  return lot;
}
