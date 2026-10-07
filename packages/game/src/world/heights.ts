import type { Ramp, RampDir, TownMap } from '../assets/types';
import type { Tile } from './grid';

// ⛰️ Raised and low ground (the Slums' map.height, map.ramps): one level = 16 px. Everything on a tile is drawn 16 px ×
// its height higher. A step between two tiles of different heights is only possible along a ramp: 2 tiles, part 1
// (low) then part 2, both at the low level, then the high tile; a ramp tile links only to the tile before part 1, the
// other part and the tile after part 2 (its sides are walls). Someone on a ramp rises smoothly from 0 to 16 px across
// its two tiles. Maps without heights (the town, the neighbourhood) are flat: every answer is 0 / allowed.

export const LEVEL_PX = 16;

/** One step "up" a ramp: ne = row − 1, nw = col − 1, se = col + 1, sw = row + 1 (the town's screen directions). */
export const RAMP_STEP: Record<RampDir, [number, number]> = { ne: [0, -1], nw: [-1, 0], se: [1, 0], sw: [0, 1] };

export class Heights {
  readonly flat: boolean;
  private readonly cols: number;
  private readonly rows: number;
  private readonly h: Uint8Array;
  private readonly ramps = new Map<string, Ramp>();

  constructor(map: TownMap) {
    [this.cols, this.rows] = map.size;
    this.flat = !map.height;
    this.h = new Uint8Array(this.cols * this.rows);
    if (map.height) for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) this.h[r * this.cols + c] = map.height[r]?.[c] ?? 0;
    for (const rp of map.ramps ?? []) this.ramps.set(`${rp.col},${rp.row}`, rp);
  }

  /** A tile's level (off the map: its nearest edge tile's, so the outskirts sit level with the map's edge). */
  at(col: number, row: number): number {
    if (this.flat) return 0;
    const c = Math.min(this.cols - 1, Math.max(0, col));
    const r = Math.min(this.rows - 1, Math.max(0, row));
    return this.h[r * this.cols + c];
  }

  ramp(col: number, row: number): Ramp | undefined {
    return this.ramps.get(`${col},${row}`);
  }

  /** Whether a straight or diagonal step from a to the next tile b is allowed by the ground's levels. */
  canStep(a: Tile, b: Tile): boolean {
    if (this.flat) return true;
    const ra = this.ramp(a.col, a.row);
    const rb = this.ramp(b.col, b.row);
    if (!ra && !rb) return this.at(a.col, a.row) === this.at(b.col, b.row);
    return this.rampLink(a, b, ra) || this.rampLink(b, a, rb);
  }

  /** From ramp tile `t` (part `r.part`) the step to `o` is one of its links: back off the low end, on to the other
   *  part, off the high end. */
  private rampLink(t: Tile, o: Tile, r: Ramp | undefined): boolean {
    if (!r) return false;
    const [dc, dr] = RAMP_STEP[r.dir];
    const up = o.col === t.col + dc && o.row === t.row + dr;
    const down = o.col === t.col - dc && o.row === t.row - dr;
    const other = this.ramp(o.col, o.row);
    if (r.part === 1) {
      if (down) return !other && this.at(o.col, o.row) === this.at(t.col, t.row); // the low tile before it
      if (up) return other?.part === 2 && other.dir === r.dir;
    } else {
      if (down) return other?.part === 1 && other.dir === r.dir;
      if (up) return !other && this.at(o.col, o.row) === this.at(t.col, t.row) + 1; // the high tile after it
    }
    return false;
  }

  /** How high the feet are at a point in tiles (col, row; a tile's centre is +0.5), in px: its tile's level, rising
   *  smoothly along a ramp. */
  lift(col: number, row: number): number {
    if (this.flat) return 0;
    const c = Math.floor(col);
    const r = Math.floor(row);
    const base = this.at(c, r) * LEVEL_PX;
    const rp = this.ramp(c, r);
    if (!rp) return base;
    // How far along the tile toward its high end (0 at the low edge, 1 at the high edge).
    const fc = col - c;
    const fr = row - r;
    const f = rp.dir === 'se' ? fc : rp.dir === 'nw' ? 1 - fc : rp.dir === 'sw' ? fr : 1 - fr;
    return base + (rp.part - 1 + Math.min(1, Math.max(0, f))) * (LEVEL_PX / 2);
  }
}
