import Phaser from 'phaser';
import type { Manifest, SlumsTiles, TownMap, Vec2 } from '../assets/types';
import { tileToScreen } from '../iso';
import { GROUND_DEPTH, frontDepth } from './depth';
import { type Baked, bakeChunks } from './ground';
import { type Heights, LEVEL_PX, RAMP_STEP } from './heights';
import type { OutTile } from './outskirts';
import { pick, tileRandom } from './rng';

// 🏚️ The ground of a map with raised and low ground (the Slums: manifest tiles.slums, rules in mikazuki-assets
// tiles/slums/slums-elevation-README.md). Each tile's floor is drawn 16 px × its level higher; a raised tile shows a wall
// (cliff-<material>-l|r, a variant seeded by col,row) for every level its SW / SE neighbour is lower, stacked 16 px
// apart, a navy rim where its NW / NE neighbour is lower, and caps on corners; ramps are pieces over their two tiles.
// The README's order (per level from low to high: floors, then the walls and ramps of the step up) is the baking order.
//
// Baked into chunks like the town's ground (under everything): every floor, wall and cap. Kept as sprites sorted with
// the characters and objects (so the ground in front can hide them): the floor (and rims) of every tile whose floor
// rises over a tile just behind it (one level over the 3 tiles behind, two over the 6), and the ramps. The canal is
// animated sprites with the river's bank overlays, like the town's water.

interface Clocked {
  sprite: Phaser.GameObjects.Image;
  frames: number;
}

export class Terrain {
  /** Every ground sprite (baked chunks and pieces), for the day/night tint. */
  readonly sprites: Phaser.GameObjects.Image[] = [];
  /** What the scene hides while off screen. */
  readonly cullable: Phaser.GameObjects.Image[] = [];
  private readonly canal: Clocked[] = [];
  private readonly clocked = new Map<Phaser.GameObjects.Image, Clocked>();
  private readonly fps: number;
  private frame = -1;

  constructor(scene: Phaser.Scene, M: Manifest, map: TownMap, H: Heights, outside: OutTile[] = []) {
    const T = M.tiles.slums as SlumsTiles;
    const [cols, rows] = map.size;
    this.fps = T.canal.fps;
    const inMap = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows;
    const out = new Map(outside.map((t) => [`${t.col},${t.row}`, t]));
    const kindAt = (c: number, r: number): string => (inMap(c, r) ? map.ground[r][c] : (out.get(`${c},${r}`)?.kind ?? 'dirt'));
    const isCanal = (c: number, r: number) => kindAt(c, r) === 'canal';
    const h = (c: number, r: number) => H.at(c, r);
    /** A neighbour's level for walls and rims (off the map and its outskirts: level with this tile). */
    const near = (c: number, r: number, self: number) => (inMap(c, r) || out.has(`${c},${r}`) ? h(c, r) : self);

    /** Where a piece anchored on tile (c, r) at `level` lands (the diamond centre of that tile, raised). */
    const at = (c: number, r: number, level: number) => {
      const t = tileToScreen(c, r);
      return { x: t.x, y: t.y + 8 - level * LEVEL_PX };
    };
    const baked: (Baked & { order: number })[] = [];
    // Sort key: level first (README), then floors before the walls of that level's step up, then back to front.
    const bake = (key: string, c: number, r: number, level: number, phase: 0 | 1, anchor: Vec2) => {
      const p = at(c, r, level);
      baked.push({ key, x: p.x, y: p.y, ox: anchor[0], oy: anchor[1], order: level * 1e6 + phase * 1e5 + (c + r + 1000) * 10 });
    };
    const sprite = (key: string, c: number, r: number, level: number, anchor: Vec2, size: Vec2, depth: number, frame?: number) => {
      const p = at(c, r, level);
      const s = scene.add.image(p.x, p.y, key, frame).setOrigin(anchor[0] / size[0], anchor[1] / size[1]).setDepth(depth);
      this.sprites.push(s);
      this.cullable.push(s);
      return s;
    };

    /** Rises over a tile just behind it, so it must sort with what stands there. */
    const overBehind = (c: number, r: number, level: number) =>
      [[1, 0], [0, 1], [1, 1]].some(([dc, dr]) => near(c - dc, r - dr, level) < level) ||
      [[2, 1], [1, 2], [2, 2]].some(([dc, dr]) => near(c - dc, r - dr, level) <= level - 2);
    /** The ramp tile leading up onto (c, r) from (c2, r2), if it is one: the edge between them has no wall or rim. */
    const rampUp = (c: number, r: number, c2: number, r2: number) => {
      const rp = H.ramp(c2, r2);
      if (!rp || rp.part !== 2) return false;
      const [dc, dr] = RAMP_STEP[rp.dir];
      return c2 + dc === c && r2 + dr === r;
    };

    const all: { c: number; r: number }[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) all.push({ c, r });
    for (const t of outside) all.push({ c: t.col, r: t.row });

    const W = this.overlays(M);
    for (const { c, r } of all) {
      const level = h(c, r);
      const kind = kindAt(c, r);
      const front = frontDepth(c, r, 1, 1);
      // The floor.
      if (kind === 'canal') {
        const s = sprite(T.canal.file, c, r, level, T.canal.anchor, T.canal.size, GROUND_DEPTH + 1 + (c + r) * 4, 0);
        const k = { sprite: s, frames: T.canal.frames };
        this.canal.push(k);
        this.clocked.set(s, k);
        // Banks: the river's overlays where the neighbour is land (a corner only when both sides are canal).
        for (const o of W) {
          const [dc, dr] = o.land;
          const land = !isCanal(c + dc, r + dr);
          const corner = dc !== 0 && dr !== 0;
          if (land && (!corner || (isCanal(c + dc, r) && isCanal(c, r + dr)))) sprite(o.file, c, r, level, T.canal.anchor, T.canal.size, GROUND_DEPTH + 2 + (c + r) * 4);
        }
      } else {
        const file = pick(T.ground[kind] ?? T.ground.dirt, tileRandom(c, r, 31));
        const raised = level > 0 && overBehind(c, r, level) && inMap(c, r);
        if (raised) sprite(file, c, r, level, T.anchor, T.size, front - 0.32);
        else bake(file, c, r, level, 0, T.anchor);
        // Rims on the raised top (always on such a tile: its NW / NE neighbour is one of those behind it).
        const rim = (key: string, c2: number, r2: number) => {
          if (near(c2, r2, level) >= level || rampUp(c, r, c2, r2)) return;
          if (raised) sprite(key, c, r, level - 1, T.pieceAnchor, T.pieceSize, front - 0.31);
          else bake(key, c, r, level - 1, 1, T.pieceAnchor);
        };
        rim(T.rim.nw, c - 1, r);
        rim(T.rim.ne, c, r - 1);
      }
      // Walls: one piece per level of drop toward the SW (left) and SE (right) neighbours, and the corner caps.
      const mat = T.cliffs[map.walls?.[r]?.[c] || 'earth'] ?? Object.values(T.cliffs)[0];
      const wall = (side: 'l' | 'r', c2: number, r2: number) => {
        const below = near(c2, r2, level);
        if (below >= level || rampUp(c, r, c2, r2)) return false;
        for (let L = below; L < level; L++) bake(pick(mat[side], tileRandom(c, r, side === 'l' ? 32 + L : 36 + L)), c, r, L, 1, T.pieceAnchor);
        return true;
      };
      const left = wall('l', c, r + 1);
      const right = wall('r', c + 1, r);
      if (left && near(c - 1, r, level) < level && near(c - 1, r + 1, level) < level) for (let L = near(c, r + 1, level); L < level; L++) bake(T.cap.w, c, r, L, 1, T.pieceAnchor);
      if (right && near(c, r - 1, level) < level && near(c + 1, r - 1, level) < level) for (let L = near(c + 1, r, level); L < level; L++) bake(T.cap.e, c, r, L, 1, T.pieceAnchor);
    }

    // Ramps: over their two tiles at the low level, sorted with what stands on and around them.
    for (const rp of map.ramps ?? []) {
      const set = T.ramps[rp.surface] ?? Object.values(T.ramps)[0];
      sprite(set[rp.dir][rp.part - 1], rp.col, rp.row, h(rp.col, rp.row), T.pieceAnchor, T.pieceSize, frontDepth(rp.col, rp.row, 1, 1) - 0.3);
    }

    baked.sort((a, b) => a.order - b.order);
    for (const img of bakeChunks(scene, baked)) {
      this.sprites.push(img);
      this.cullable.push(img);
    }
  }

  /** The river's bank overlays (tiles.water.overlays), reused for the canal. */
  private overlays(M: Manifest): { file: string; land: Vec2 }[] {
    return Object.values(M.tiles.water.overlays).filter((o): o is { file: string; land: Vec2 } => typeof o === 'object');
  }

  /** Advances the canal's shared clock, for tiles on screen. */
  tick(timeMs: number): void {
    const f = Math.floor((timeMs / 1000) * this.fps);
    if (f === this.frame) return;
    this.frame = f;
    for (const t of this.canal) if (t.sprite.visible) t.sprite.setFrame(f % t.frames);
  }

  /** Brings a tile that just came on screen up to the current frame. */
  refresh(sprite: Phaser.GameObjects.Image): void {
    const t = this.clocked.get(sprite);
    if (t) sprite.setFrame(Math.max(0, this.frame) % t.frames);
  }
}
