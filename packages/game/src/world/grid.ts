import type { TownMap } from '../assets/types';
import { Heights } from './heights';

// Where players can walk: the map's blocked[row][col] grid (1 = blocked), plus fence edges, which block movement
// across that edge only, and raised ground (world/heights.ts: a step between levels only along a ramp). Click-to-move
// uses 8-way A* on this grid; a diagonal step never cuts a blocked corner, slips through a fence or rounds a ledge.

export interface Tile {
  col: number;
  row: number;
}

/** A* gives up after expanding this many tiles per tile of map (the town has 5,184, the Slums 12,288). */
const SEARCH_CAP_PER_TILE = 2.5;

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

  constructor(map: TownMap) {
    this.heights = new Heights(map);
    [this.cols, this.rows] = map.size;
    this.blocked = new Uint8Array(this.cols * this.rows);
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) this.blocked[r * this.cols + c] = map.blocked[r][c] ? 1 : 0;
    this.setFence(map.fence ?? []);
  }

  /** The fence's edges from now on (all of them: a Bakod went up or came down). */
  setFence(fence: NonNullable<TownMap['fence']>): void {
    this.fenced.clear();
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
    if (this.inBounds(col, row)) this.blocked[row * this.cols + col] = 1;
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

  /** Shortest path from `from` to `to` (both included), or null. */
  findPath(from: Tile, to: Tile): Tile[] | null {
    if (!this.walkable(to.col, to.row)) return null;
    if (from.col === to.col && from.row === to.row) return [from];
    const idx = (c: number, r: number) => r * this.cols + c;
    const n = this.cols * this.rows;
    const g = new Float64Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const h = (c: number, r: number) => {
      const dx = Math.abs(c - to.col);
      const dy = Math.abs(r - to.row);
      return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy); // octile
    };
    // Small binary heap of [f, index].
    const heap: [number, number][] = [];
    const push = (f: number, i: number) => {
      heap.push([f, i]);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heap[p][0] <= heap[k][0]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]];
        k = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1;
          const r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };

    const start = idx(from.col, from.row);
    const goal = idx(to.col, to.row);
    g[start] = 0;
    push(h(from.col, from.row), start);
    let expanded = 0;
    while (heap.length) {
      const [, cur] = pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (++expanded > n * SEARCH_CAP_PER_TILE) return null;
      const c = cur % this.cols;
      const r = (cur - c) / this.cols;
      for (const [dc, dr] of STEPS) {
        const nc = c + dc;
        const nr = r + dr;
        if (!this.canStep({ col: c, row: r }, { col: nc, row: nr })) continue;
        const ni = idx(nc, nr);
        const cost = g[cur] + (dc && dr ? Math.SQRT2 : 1);
        if (cost < g[ni]) {
          g[ni] = cost;
          came[ni] = cur;
          push(cost + h(nc, nr), ni);
        }
      }
    }
    if (came[goal] < 0) return null;
    const path: Tile[] = [];
    for (let i = goal; i >= 0; i = came[i]) {
      const c = i % this.cols;
      path.push({ col: c, row: (i - c) / this.cols });
      if (i === start) break;
    }
    return path.reverse();
  }

  /** Every tile reachable from `from` (one flood fill; 1 = reachable). */
  reachableFrom(from: Tile): Uint8Array {
    const seen = new Uint8Array(this.cols * this.rows);
    if (!this.walkable(from.col, from.row)) return seen;
    const queue = [from];
    seen[from.row * this.cols + from.col] = 1;
    for (let i = 0; i < queue.length; i++) {
      const t = queue[i];
      for (const [dc, dr] of STEPS) {
        const n = { col: t.col + dc, row: t.row + dr };
        if (!this.inBounds(n.col, n.row) || seen[n.row * this.cols + n.col] || !this.canStep(t, n)) continue;
        seen[n.row * this.cols + n.col] = 1;
        queue.push(n);
      }
    }
    return seen;
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
