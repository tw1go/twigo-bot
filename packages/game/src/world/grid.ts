import type { TownMap } from '../assets/types';
import { Heights } from './heights';

// Where players can walk: the map's blocked[row][col] grid (1 = blocked), plus fence edges, which block movement
// across that edge only, and raised ground (world/heights.ts: a step between levels only along a ramp). Click-to-move
// uses 8-way A* on this grid; a diagonal step never cuts a blocked corner, slips through a fence or rounds a ledge.

export interface Tile {
  col: number;
  row: number;
}

/** A* stops after expanding this many tiles (the town has 5,184, the Slums 49,152): a long click on a big map then walks
 *  to the closest tile it found on the way, and the next click carries on. */
const SEARCH_CAP = 30_000;

const STEPS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export class WalkGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly blocked: Uint8Array;
  private readonly fenced = new Set<string>(); // "c,r|c2,r2" for both directions
  readonly heights: Heights;
  /** Each tile's allowed steps (bit k: STEPS[k]), worked out once (`known`) and kept until the map changes: the search
   *  then only tests bits, not fences and heights. */
  private moves: Uint8Array = new Uint8Array(0);
  private known: Uint8Array = new Uint8Array(0);
  /** The search's working memory, kept between searches (a stamp per search instead of clearing it). */
  private g: Float64Array = new Float64Array(0);
  private came: Int32Array = new Int32Array(0);
  private seen: Uint32Array = new Uint32Array(0);
  private shut: Uint32Array = new Uint32Array(0);
  private stamp = 0;
  private heapF: Float64Array = new Float64Array(0);
  private heapI: Int32Array = new Int32Array(0);
  /** The tiles reachable from where the last flood started (kept until the map changes; moves go both ways, so one flood
   *  serves every tile in it). */
  private reach: Uint8Array | null = null;

  constructor(map: TownMap) {
    this.heights = new Heights(map);
    [this.cols, this.rows] = map.size;
    this.blocked = new Uint8Array(this.cols * this.rows);
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) this.blocked[r * this.cols + c] = map.blocked[r][c] ? 1 : 0;
    const n = this.cols * this.rows;
    this.moves = new Uint8Array(n);
    this.known = new Uint8Array(n);
    this.g = new Float64Array(n);
    this.came = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.shut = new Uint32Array(n);
    this.setFence(map.fence ?? []);
  }

  /** The map changed (a fence, a newly blocked tile): steps and reach are worked out again. */
  private changed(): void {
    this.known.fill(0);
    this.reach = null;
    this.warmAt = 0;
  }

  /** Where the warm-up has got to (tiles whose steps are worked out ahead of any click). */
  private warmAt = 0;

  /** Works out every tile's steps, then the reach from `from`, a few ms at a time (call it each frame until it says
   *  true): so the first long click doesn't pay for it. The map changing starts it over. */
  warmUp(from: Tile, budgetMs = 3): boolean {
    const n = this.cols * this.rows;
    if (this.warmAt >= n && this.reach) return true;
    const until = performance.now() + budgetMs;
    while (this.warmAt < n) {
      for (let k = 0; k < 256 && this.warmAt < n; k++) if (!this.known[this.warmAt]) this.stepsOf(this.warmAt++); else this.warmAt++;
      if (performance.now() >= until) return false;
    }
    if (!this.reach && this.walkable(from.col, from.row)) this.reachableFrom(from);
    return true;
  }

  /** A tile's allowed steps as bits (STEPS order). */
  private stepsOf(i: number): number {
    if (this.known[i]) return this.moves[i];
    const c = i % this.cols;
    const r = (i - c) / this.cols;
    let bits = 0;
    for (let k = 0; k < 8; k++) if (this.canStep({ col: c, row: r }, { col: c + STEPS[k][0], row: r + STEPS[k][1] })) bits |= 1 << k;
    this.moves[i] = bits;
    this.known[i] = 1;
    return bits;
  }

  /** The fence's edges from now on (all of them: a Bakod went up or came down). */
  setFence(fence: NonNullable<TownMap['fence']>): void {
    this.fenced.clear();
    this.changed();
    // fence-nw sits on the tile's top-left edge (shared with col − 1), fence-ne on its top-right edge (row − 1).
    for (const f of fence) {
      const other: Tile = f.edge === 'nw' ? { col: f.col - 1, row: f.row } : { col: f.col, row: f.row - 1 };
      this.fenced.add(`${f.col},${f.row}|${other.col},${other.row}`);
      this.fenced.add(`${other.col},${other.row}|${f.col},${f.row}`);
    }
  }

  inBounds(col: number, row: number): boolean {
    return col >= 0 && row >= 0 && col < this.cols && row < this.rows;
  }

  /** Blocks a tile from now on (a house built while the scene is up). */
  block(col: number, row: number): void {
    if (!this.inBounds(col, row)) return;
    this.blocked[row * this.cols + col] = 1;
    this.changed();
  }

  walkable(col: number, row: number): boolean {
    return this.inBounds(col, row) && !this.blocked[row * this.cols + col];
  }

  private crossesFence(a: Tile, b: Tile): boolean {
    return this.fenced.has(`${a.col},${a.row}|${b.col},${b.row}`);
  }

  /** Whether a single step from a to an adjacent tile b is allowed. */
  canStep(a: Tile, b: Tile): boolean {
    if (!this.walkable(b.col, b.row)) return false;
    const dc = b.col - a.col;
    const dr = b.row - a.row;
    const H = this.heights;
    if (dc === 0 || dr === 0) return !this.crossesFence(a, b) && H.canStep(a, b);
    // Diagonal: both orthogonal neighbours must be open, with no fence on either route around the corner.
    const viaC = { col: a.col + dc, row: a.row };
    const viaR = { col: a.col, row: a.row + dr };
    return (
      this.walkable(viaC.col, viaC.row) &&
      this.walkable(viaR.col, viaR.row) &&
      !this.crossesFence(a, viaC) &&
      !this.crossesFence(viaC, b) &&
      !this.crossesFence(a, viaR) &&
      !this.crossesFence(viaR, b) &&
      H.canStep(a, viaC) &&
      H.canStep(viaC, b) &&
      H.canStep(a, viaR) &&
      H.canStep(viaR, b)
    );
  }

  /** Shortest path from `from` to `to` (both included); past the search cap, the way to the closest tile found; null if
   *  there's no way (or no progress). */
  findPath(from: Tile, to: Tile, cap = SEARCH_CAP): Tile[] | null {
    if (!this.walkable(to.col, to.row)) return null;
    if (from.col === to.col && from.row === to.row) return [from];
    const cols = this.cols;
    const n = cols * this.rows;
    // A tile it can't get to at all: no search (it would look at every tile there is before giving up).
    if (this.reach && this.reach[from.row * cols + from.col] && !this.reach[to.row * cols + to.col]) return null;
    const stamp = ++this.stamp;
    if (stamp === 0xffffffff) {
      this.seen.fill(0);
      this.shut.fill(0);
      this.stamp = 1;
    }
    const { g, came, seen, shut } = this;
    const tc = to.col;
    const tr = to.row;
    const h = (c: number, r: number) => {
      const dx = Math.abs(c - tc);
      const dy = Math.abs(r - tr);
      return dx > dy ? dx + (Math.SQRT2 - 1) * dy : dy + (Math.SQRT2 - 1) * dx; // octile
    };
    // A binary heap of (f, index) on typed arrays (grown when it must be).
    let size = 0;
    const push = (f: number, i: number) => {
      if (size >= this.heapF.length) {
        const F = new Float64Array(Math.max(1024, this.heapF.length * 2));
        const I = new Int32Array(F.length);
        F.set(this.heapF);
        I.set(this.heapI);
        [this.heapF, this.heapI] = [F, I];
      }
      const HF = this.heapF;
      const HI = this.heapI;
      let k = size++;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (HF[p] <= f) break;
        HF[k] = HF[p];
        HI[k] = HI[p];
        k = p;
      }
      HF[k] = f;
      HI[k] = i;
    };
    const pop = (): number => {
      const HF = this.heapF;
      const HI = this.heapI;
      const top = HI[0];
      const lf = HF[--size];
      const li = HI[size];
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        if (l >= size) break;
        const m = l + 1 < size && HF[l + 1] < HF[l] ? l + 1 : l;
        if (HF[m] >= lf) break;
        HF[k] = HF[m];
        HI[k] = HI[m];
        k = m;
      }
      HF[k] = lf;
      HI[k] = li;
      return top;
    };

    const start = from.row * cols + from.col;
    const goal = to.row * cols + to.col;
    if (start < 0 || start >= n) return null;
    seen[start] = stamp;
    g[start] = 0;
    came[start] = -1;
    push(h(from.col, from.row), start);
    let expanded = 0;
    let best = start;
    let bestH = h(from.col, from.row);
    let capped = false;
    let found = false;
    while (size) {
      const cur = pop();
      if (cur === goal) {
        found = true;
        break;
      }
      if (shut[cur] === stamp) continue;
      shut[cur] = stamp;
      const c = cur % cols;
      const r = (cur - c) / cols;
      const ch = h(c, r);
      if (ch < bestH) {
        bestH = ch;
        best = cur;
      }
      if (++expanded > cap) {
        capped = true;
        break;
      }
      const bits = this.stepsOf(cur);
      if (!bits) continue;
      const gc = g[cur];
      for (let k = 0; k < 8; k++) {
        if (!(bits & (1 << k))) continue;
        const ni = cur + STEPS[k][1] * cols + STEPS[k][0];
        const cost = gc + (k >= 4 ? Math.SQRT2 : 1);
        if (seen[ni] === stamp && cost >= g[ni]) continue;
        seen[ni] = stamp;
        g[ni] = cost;
        came[ni] = cur;
        push(cost + h(c + STEPS[k][0], r + STEPS[k][1]), ni);
      }
    }
    const end = found ? goal : capped && best !== start ? best : -1;
    if (end < 0) return null;
    const path: Tile[] = [];
    for (let i = end; i >= 0; i = came[i]) {
      const c = i % cols;
      path.push({ col: c, row: (i - c) / cols });
      if (i === start) break;
    }
    return path.reverse();
  }

  /** Every tile reachable from `from` (one flood fill; 1 = reachable), kept while the map stays the same: moves go both
   *  ways, so it's the same set from anywhere in it. */
  reachableFrom(from: Tile): Uint8Array {
    const cols = this.cols;
    const i0 = from.row * cols + from.col;
    if (this.reach?.[i0]) return this.reach;
    const seen = new Uint8Array(cols * this.rows);
    if (!this.walkable(from.col, from.row)) return seen;
    const queue = new Int32Array(cols * this.rows);
    let tail = 0;
    queue[tail++] = i0;
    seen[i0] = 1;
    for (let q = 0; q < tail; q++) {
      const cur = queue[q];
      const bits = this.stepsOf(cur);
      for (let k = 0; k < 8; k++) {
        if (!(bits & (1 << k))) continue;
        const ni = cur + STEPS[k][1] * cols + STEPS[k][0];
        if (seen[ni]) continue;
        seen[ni] = 1;
        queue[tail++] = ni;
      }
    }
    this.reach = seen;
    return seen;
  }

  /** Whether `to` can be walked to from `from` at all. */
  reachable(from: Tile, to: Tile): boolean {
    return this.walkable(to.col, to.row) && !!this.reachableFrom(from)[to.row * this.cols + to.col];
  }

  /** The reachable tile closest to `target` (for clicks on blocked tiles), searching outward ring by ring. */
  nearestReachable(from: Tile, target: Tile): Tile | null {
    const reach = this.reachableFrom(from);
    for (let radius = 0; radius < Math.max(this.cols, this.rows); radius++) {
      let best: Tile | null = null;
      let bestD = Infinity;
      for (let dc = -radius; dc <= radius; dc++) {
        for (let dr = -radius; dr <= radius; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
          const c = target.col + dc;
          const r = target.row + dr;
          if (!this.inBounds(c, r) || !reach[r * this.cols + c]) continue;
          const d = Math.hypot(dc, dr);
          if (d < bestD) {
            best = { col: c, row: r };
            bestD = d;
          }
        }
      }
      if (best) return best;
    }
    return null;
  }
}
