import Phaser from 'phaser';
import type { Manifest, MapObject, Outskirts, TownMap } from '../assets/types';
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
  kind: 'grass' | 'water' | 'path';
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
