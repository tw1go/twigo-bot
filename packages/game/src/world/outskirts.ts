import Phaser from 'phaser';
import type { Manifest, MapObject, Outskirts, PropDef, TownMap } from '../assets/types';
import { tileToScreen } from '../iso';
import { pick, tileRandom } from './rng';

// The forest around the town (map.outskirts), so the space the camera can see past the map isn't blank. It's made
// up on load (seeded, so the same every time) for the tiles whose centre falls in the camera's view of the town:
// grass beyond the edges (the `meadow` mix within `clear` tiles of an edge, the `ground` mix past it), the river
// carried on outward (`water` rectangles), a path on past a bridge (`lanes`: no undergrowth next to it, no tree whose
// crown would hide it), trees on a 2 × 2 grid with their shadow and tufts, and some undergrowth.
// None of it is walkable, and it doesn't widen the camera's bounds.

export interface OutTile {
  col: number;
  row: number;
  kind: 'grass' | 'water' | 'path' | 'dirt' | 'concrete' | 'canal';
  style: string; // grass mix name
}

const REACH = 50; // tiles beyond each edge that are considered
const MARGIN = { x: 48, top: 16, bottom: 130 }; // px around the view: trees just below it still reach up into it

export function outskirts(M: Manifest, map: TownMap, view: Phaser.Geom.Rectangle): { tiles: OutTile[]; objects: MapObject[] } {
  const o: Outskirts | undefined = map.outskirts;
  if (!o) return { tiles: [], objects: [] };
  const [cols, rows] = map.size;
  const inMap = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows;
  const isWater = (c: number, r: number) => o.water.some(([c0, r0, c1, r1]) => c >= c0 && c <= c1 && r >= r0 && r <= r1);
  /** A tree here would hide part of a lane: its crown rises up the screen, over the tiles behind it (col and row
   *  both smaller), up to about 6 of them. */
  const overLane = (c: number, r: number) => {
    for (let k = 0; k <= 6; k++) if (nearLane(c - k, r - k, 2)) return true;
    return false;
  };
  /** On a lane, or within `m` tiles of one. */
  const nearLane = (c: number, r: number, m = 0) => (o.lanes ?? []).some(([c0, r0, c1, r1]) => c >= c0 - m && c <= c1 + m && r >= r0 - m && r <= r1 + m);
  // Past `clear` on every side it's beyond: forest.
  const forest = (c: number, r: number) =>
    (c >= 0 || -c > o.clear.nw) && (r >= 0 || -r > o.clear.ne) && (c < cols || c - cols + 1 > o.clear.se) && (r < rows || r - rows + 1 > o.clear.sw);
  const seen = (c: number, r: number) => {
    const t = tileToScreen(c, r);
    const y = t.y + 8;
    return t.x >= view.left - MARGIN.x && t.x <= view.right + MARGIN.x && y >= view.top - MARGIN.top && y <= view.bottom + MARGIN.bottom;
  };

  const tiles: OutTile[] = [];
  const land = new Set<string>();
  for (let r = -REACH; r < rows + REACH; r++) {
    for (let c = -REACH; c < cols + REACH; c++) {
      if (inMap(c, r) || !seen(c, r)) continue;
      const water = isWater(c, r);
      tiles.push({ col: c, row: r, kind: water ? 'water' : nearLane(c, r) ? 'path' : 'grass', style: forest(c, r) ? o.ground : o.meadow });
      if (!water) land.add(`${c},${r}`);
    }
  }

  // Trees: at most one per 2 × 2 cell, at a seeded spot in it, never on the river's edge.
  const objects: MapObject[] = [];
  const taken = new Set<string>();
  const treeIds = Object.keys(o.trees);
  const tufts = (M.props['tree-tufts'] as { files?: string[] } | undefined)?.files ?? [];
  const nearWater = (c: number, r: number) => {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (isWater(c + dc, r + dr) || (inMap(c + dc, r + dr) && map.ground[r + dr][c + dc] === 'water')) return true;
    return false;
  };
  for (let cr = Math.floor(-REACH / 2); cr < (rows + REACH) / 2; cr++) {
    for (let cc = Math.floor(-REACH / 2); cc < (cols + REACH) / 2; cc++) {
      if (tileRandom(cc, cr, 21) >= o.treeChance) continue;
      const spot = Math.floor(tileRandom(cc, cr, 22) * 4);
      const c = cc * 2 + (spot % 2);
      const r = cr * 2 + (spot >> 1);
      if (!land.has(`${c},${r}`) || !forest(c, r) || nearWater(c, r) || overLane(c, r)) continue;
      const id = pick(treeIds, tileRandom(c, r, 23));
      objects.push({
        kind: 'prop',
        id,
        col: c,
        row: r,
        footprint: [1, 1],
        flip: tileRandom(c, r, 24) < 0.5,
        shadow: o.trees[id],
        tufts: tufts.length ? pick(tufts, tileRandom(c, r, 25)) : undefined,
      });
      taken.add(`${c},${r}`);
    }
  }
  // Undergrowth: bushes, ferns and rocks here and there (mostly seen in the meadow strips).
  for (const t of tiles) {
    const key = `${t.col},${t.row}`;
    if (!land.has(key) || taken.has(key) || nearLane(t.col, t.row, 1) || tileRandom(t.col, t.row, 26) >= o.undergrowthChance) continue;
    objects.push({
      kind: 'prop',
      id: pick(o.undergrowth, tileRandom(t.col, t.row, 27)),
      col: t.col,
      row: t.row,
      footprint: [1, 1],
      flip: tileRandom(t.col, t.row, 28) < 0.5,
    });
  }
  return { tiles, objects };
}

/** What's scattered round the Slums: [id prefix, weight] (the dead trees also line every edge, carrying on the map's own). */
const SLUMS_JUNK: [string, number][] = [
  ['slums-dead-tree-', 0.6],
  ['slums-junk-mound-', 0.12],
  ['slums-shanty-', 0.1],
  ['slums-power-pole-', 0.1],
  ['slums-car-wreck-', 0.08],
];
const CELL = 4; // tiles: at most one prop per CELL × CELL cell past the treeline (so props never meet, wherever they're made)

/** What a big map has round it (world/terrain.ts asks for its ground, WorldObjects for its props), streamed. */
export interface BigOutskirts {
  /** A tile past the map: its ground family. */
  kind(c: number, r: number): string;
  /** The props whose top tile is in [c0, c1] × [r0, r1] (only past the map). */
  objectsIn(c0: number, r0: number, c1: number, r1: number): MapObject[];
}

/**
 * Round the Slums (no forest there), asked tile by tile and region by region, so it can be made only near the camera
 * (the map is 256 × 192): its dirt past the map, the canal carried on north and south (the columns it has on the
 * map's first and last rows), a concrete road on out from each gate (back to town, on to the Palengke), and a seeded scatter of dead trees
 * (close along the edges, carrying on the map's own treeline), junk mounds, shanties, power poles and car wrecks: at
 * most one per 4 × 4 cell (2 × 2 in the treeline), its footprint inside the cell, off the canal and the road. Not
 * walkable, like the forest.
 */
export class SlumsOutskirts implements BigOutskirts {
  private readonly cols: number;
  private readonly rows: number;
  private readonly canalN: Set<number>;
  private readonly canalS: Set<number>;
  private readonly gate: [number, number][];
  private readonly pools: { ids: string[]; weight: number }[];
  private readonly total: number;
  private readonly deadTrees: string[];

  constructor(
    private readonly M: Manifest,
    map: TownMap,
  ) {
    [this.cols, this.rows] = map.size;
    const canalAt = (r: number) => new Set(map.ground[r].flatMap((k, c) => (k === 'canal' ? [c] : [])));
    this.canalN = canalAt(0);
    this.canalS = canalAt(this.rows - 1);
    this.gate = Object.values(map.gates ?? {}).flat() as [number, number][]; // (the town's, the Palengke's: each a road out)
    this.pools = SLUMS_JUNK.map(([prefix, weight]) => ({ ids: Object.keys(M.props).filter((id) => id.startsWith(prefix)), weight })).filter((p) => p.ids.length);
    this.total = this.pools.reduce((n, p) => n + p.weight, 0);
    this.deadTrees = this.pools.find((p) => p.ids[0].startsWith('slums-dead-tree-'))?.ids ?? [];
  }

  private inMap(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows;
  }

  private canal(c: number, r: number): boolean {
    return (r < 0 && this.canalN.has(c)) || (r >= this.rows && this.canalS.has(c));
  }

  /** The gate's tiles carried on past the edge they're on. */
  private road(c: number, r: number): boolean {
    const [cols, rows] = [this.cols, this.rows];
    return this.gate.some(([gc, gr]) => (gc === cols - 1 && c >= cols && r === gr) || (gc === 0 && c < 0 && r === gr) || (gr === rows - 1 && r >= rows && c === gc) || (gr === 0 && r < 0 && c === gc));
  }

  /** A tile past the map: its ground. */
  kind(c: number, r: number): 'canal' | 'concrete' | 'dirt' {
    return this.canal(c, r) ? 'canal' : this.road(c, r) ? 'concrete' : 'dirt';
  }

  /** How far past the map's edge (0 or less: on it). */
  private past(c: number, r: number): number {
    return Math.max(-c, -r, c - this.cols + 1, r - this.rows + 1);
  }

  /** The props whose top tile is in [c0, c1] × [r0, r1] (only past the map). */
  objectsIn(c0: number, r0: number, c1: number, r1: number): MapObject[] {
    const out: MapObject[] = [];
    const free = (c: number, r: number, fc: number, fr: number) => {
      for (let dr = -1; dr <= fr; dr++) for (let dc = -1; dc <= fc; dc++) if (this.inMap(c + dc, r + dr) || this.canal(c + dc, r + dr) || this.road(c + dc, r + dr)) return false;
      return true;
    };
    const add = (id: string, c: number, r: number) => {
      const def = this.M.props[id] as (PropDef & { footprint?: [number, number] }) | undefined;
      const [fc, fr] = def?.footprint ?? [1, 1];
      if (def?.file && free(c, r, fc, fr)) out.push({ kind: 'prop', id, col: c, row: r, footprint: [fc, fr], flip: tileRandom(c, r, 44) < 0.5 });
    };
    // The treeline: a dead tree in some 2 × 2 cells within 2 tiles of the edge.
    for (let cr = Math.floor(r0 / 2); cr <= Math.floor(r1 / 2); cr++) {
      for (let cc = Math.floor(c0 / 2); cc <= Math.floor(c1 / 2); cc++) {
        const c = cc * 2 + (tileRandom(cc, cr, 47) < 0.5 ? 0 : 1);
        const r = cr * 2 + (tileRandom(cc, cr, 48) < 0.5 ? 0 : 1);
        if (c < c0 || c > c1 || r < r0 || r > r1) continue;
        const d = this.past(c, r);
        if (d < 1 || d > 2 || !this.deadTrees.length || tileRandom(cc, cr, 41) >= 0.55) continue;
        const id = pick(this.deadTrees, tileRandom(cc, cr, 42));
        const fp = (this.M.props[id] as PropDef & { footprint?: [number, number] }).footprint ?? [1, 1];
        if (fp[0] === 1 && fp[1] === 1) add(id, c, r);
      }
    }
    // Past it: one in some CELL × CELL cells, its footprint inside the cell.
    for (let cr = Math.floor(r0 / CELL); cr <= Math.floor(r1 / CELL); cr++) {
      for (let cc = Math.floor(c0 / CELL); cc <= Math.floor(c1 / CELL); cc++) {
        if (tileRandom(cc, cr, 43) >= 0.22) continue;
        let roll = tileRandom(cc, cr, 45) * this.total;
        const pool = this.pools.find((p) => (roll -= p.weight) < 0) ?? this.pools[0];
        const id = pick(pool.ids, tileRandom(cc, cr, 46));
        const fp = (this.M.props[id] as PropDef & { footprint?: [number, number] }).footprint ?? [1, 1];
        if (fp[0] > CELL || fp[1] > CELL) continue;
        const c = cc * CELL + Math.floor(tileRandom(cc, cr, 49) * (CELL - fp[0] + 1));
        const r = cr * CELL + Math.floor(tileRandom(cc, cr, 50) * (CELL - fp[1] + 1));
        if (c < c0 || c > c1 || r < r0 || r > r1 || this.past(c, r) <= 2) continue;
        add(id, c, r);
      }
    }
    return out;
  }
}

/** The Lumang Palengke's border: how deep the market goes on past the map, rows of stalls on concrete (tiles). */
const PALENGKE_DEPTH = 12;
/** Its stalls (2 × 2) and now and then a stack of crates (1 × 1). */
const PALENGKE_STALLS = ['palengke-stall-empty', 'palengke-stall-collapsed'];
const PALENGKE_CRATES = 'palengke-crate-plastic-stack';

/**
 * Round the Lumang Palengke: the market seems to carry on into the dark. Past the map, its `semento` ground for
 * PALENGKE_DEPTH tiles (dirt-free: the map's own dark beyond that is nothing), the gate's tiles carried on out as a
 * road of the same, and rows of empty and collapsed stalls (2 × 2, one per 3 × 3 cell in aisle rows, seeded) with now
 * and then a stack of plastic crates. Nothing in it is walkable or reachable.
 */
export class PalengkeOutskirts implements BigOutskirts {
  private readonly cols: number;
  private readonly rows: number;
  private readonly gate: [number, number][];
  private readonly stalls: string[];
  private readonly crates: string | null;

  constructor(
    private readonly M: Manifest,
    map: TownMap,
  ) {
    [this.cols, this.rows] = map.size;
    this.gate = Object.values(map.gates ?? {}).flat() as [number, number][];
    this.stalls = PALENGKE_STALLS.filter((id) => (M.props[id] as PropDef | undefined)?.file);
    this.crates = (M.props[PALENGKE_CRATES] as PropDef | undefined)?.file ? PALENGKE_CRATES : null;
  }

  /** How far past the map's edge (0 or less: on it). */
  private past(c: number, r: number): number {
    return Math.max(-c, -r, c - this.cols + 1, r - this.rows + 1);
  }

  /** The gate's tiles carried on past the edge they're on, a tile either side (kept clear of stalls). */
  private road(c: number, r: number): boolean {
    const [cols, rows] = [this.cols, this.rows];
    return this.gate.some(([gc, gr]) => (gc === cols - 1 && c >= cols && Math.abs(r - gr) <= 1) || (gc === 0 && c < 0 && Math.abs(r - gr) <= 1) || (gr === rows - 1 && r >= rows && Math.abs(c - gc) <= 1) || (gr === 0 && r < 0 && Math.abs(c - gc) <= 1));
  }

  kind(_c: number, _r: number): string {
    return 'semento';
  }

  objectsIn(c0: number, r0: number, c1: number, r1: number): MapObject[] {
    const out: MapObject[] = [];
    const fits = (c: number, r: number, fc: number, fr: number) => {
      for (let dr = 0; dr < fr; dr++) for (let dc = 0; dc < fc; dc++) {
        const d = this.past(c + dc, r + dr);
        if (d < 2 || d > PALENGKE_DEPTH || this.road(c + dc, r + dr)) return false;
      }
      return true;
    };
    // One 3 × 3 cell each: a stall in two rows of three, an aisle between (a market's rows), a crate stack now and then.
    const STEP = 3;
    for (let cr = Math.floor(r0 / STEP); cr <= Math.floor(r1 / STEP); cr++) {
      for (let cc = Math.floor(c0 / STEP); cc <= Math.floor(c1 / STEP); cc++) {
        const c = cc * STEP;
        const r = cr * STEP;
        if (c < c0 || c > c1 || r < r0 || r > r1) continue;
        const roll = tileRandom(cc, cr, 61);
        if (this.stalls.length && roll < 0.62 && fits(c, r, 2, 2)) {
          out.push({ kind: 'prop', id: pick(this.stalls, tileRandom(cc, cr, 62)), col: c, row: r, footprint: [2, 2], flip: tileRandom(cc, cr, 63) < 0.5 });
        } else if (this.crates && roll < 0.72 && fits(c + 1, r + 1, 1, 1)) {
          out.push({ kind: 'prop', id: this.crates, col: c + 1, row: r + 1, footprint: [1, 1], flip: tileRandom(cc, cr, 64) < 0.5 });
        }
      }
    }
    return out;
  }
}
