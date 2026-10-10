import type Phaser from 'phaser';
import type { TelegraphShape } from '@mikazuki/shared';
import type { FxHandle, FxLayers, Pt } from './fx-layers';

// 🟥 A boss move's warning on the ground (the Scrap Warrens; the brief's 9.1): every red circle, line, cone and set of
// tiles the server sends with a `boss-move` (its TelegraphShape, in grid tiles; its hit `ms` later), drawn flat on the
// iso floor on the ground fx layer: circles are 2:1 ellipses, cones fans projected from the grid. A fill at 20% with a
// 1 px brighter edge at 80%, and a second fill growing from the middle (circle, cone, tile) or from the start (line) to
// the full shape exactly at the hit, so you can read how long you have; its last 0.2 s the edge blinks once; on the hit
// it flashes white at 40% for 80 ms and fades out over 150 ms. Red (#EF4444, edge #FCA5A5), or yellow (#FACC15, edge
// #FEF08A) for Wire Wolf's Live Floor. One Graphics per telegraph, gone after its flash; a boss's go at once when it
// resets, dies or the run closes (`cancel`, `clear`). The hit itself is the server's (where everyone stands then).

const RED = { fill: 0xef4444, edge: 0xfca5a5 };
const YELLOW = { fill: 0xfacc15, edge: 0xfef08a };
const BLINK_MS = 200;
const FLASH_MS = 80;
const FADE_MS = 150;

/** A grid point (continuous: a tile's middle is col + 0.5) on the flat floor, in world px. */
export const iso = (col: number, row: number): Pt => ({ x: (col - row) * 16, y: (col + row) * 8 });
/** A tile's middle. */
const mid = ([c, r]: [number, number]): [number, number] => [c + 0.5, r + 0.5];

interface Live {
  owner: string;
  handle: FxHandle;
}

export class Telegraphs {
  private readonly live = new Map<string, Live>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly fx: FxLayers,
  ) {}

  /** A move's warning (its `key`), hitting `ms` from now; `owner`: the boss's id (its telegraphs go with it). */
  show(key: string, owner: string, shape: TelegraphShape, ms: number): void {
    this.drop(key);
    const colours = shape.kind === 'tiles' && shape.colour === 'yellow' ? YELLOW : RED;
    const total = ms + FLASH_MS + FADE_MS;
    const handle = this.fx.drawFx(
      'ground',
      (g, t) => {
        if (t < ms) {
          const p = Math.max(0, Math.min(1, t / Math.max(1, ms)));
          const blink = ms - t <= BLINK_MS ? (ms - t > BLINK_MS / 2 ? 1 : 0.6) : 0.8;
          paint(g, shape, 1, { colour: colours.fill, alpha: 0.2 }, { colour: colours.edge, alpha: blink });
          paint(g, shape, p, { colour: colours.fill, alpha: 0.2 });
          return true;
        }
        // The hit: white at 40% for a moment, then out.
        const after = t - ms;
        const alpha = after < FLASH_MS ? 0.4 : 0.4 * Math.max(0, 1 - (after - FLASH_MS) / FADE_MS);
        paint(g, shape, 1, { colour: 0xffffff, alpha });
        return after < FLASH_MS + FADE_MS;
      },
      total,
    );
    this.live.set(key, { owner, handle });
    this.scene.time.delayedCall(total + 50, () => this.live.get(key)?.handle === handle && this.live.delete(key));
  }

  /** A boss's warnings gone at once (it reset or fell). */
  cancel(owner: string): void {
    for (const [key, l] of [...this.live]) if (l.owner === owner) this.drop(key);
  }

  /** Every warning gone (the run closed, the scene ends). */
  clear(): void {
    for (const key of [...this.live.keys()]) this.drop(key);
  }

  private drop(key: string): void {
    this.live.get(key)?.handle.kill(0);
    this.live.delete(key);
  }
}

/** The shape at `k` of its size (a circle's, cone's or tile's from its middle; a line's from its start), filled and,
 *  with `edge`, outlined (1 px). */
function paint(g: Phaser.GameObjects.Graphics, s: TelegraphShape, k: number, fill: { colour: number; alpha: number }, edge?: { colour: number; alpha: number }): void {
  if (k <= 0) return;
  const polys: Pt[][] = [];
  const ellipses: { at: Pt; rx: number; ry: number }[] = [];
  const circle = (at: [number, number], radius: number) => {
    const [c, r] = mid(at);
    // A grid circle of radius R: 2:1 on screen, R·16√2 across each way, R·8√2 up and down.
    ellipses.push({ at: iso(c, r), rx: radius * k * 16 * Math.SQRT2, ry: radius * k * 8 * Math.SQRT2 });
  };
  switch (s.kind) {
    case 'circle':
      circle(s.at, s.radius);
      break;
    case 'circles':
      for (const c of s.circles) circle(c.at, c.radius);
      break;
    case 'line': {
      // From the start tile's middle toward the end's, half a tile past each end, `width` tiles wide; growing from the start.
      const [a0, b0] = mid(s.from);
      const [a1, b1] = mid(s.to);
      const len = Math.hypot(a1 - a0, b1 - b0) || 1;
      const [ux, uy] = [(a1 - a0) / len, (b1 - b0) / len];
      const [px, py] = [-uy * (s.width / 2), ux * (s.width / 2)];
      const start = [a0 - ux * 0.5, b0 - uy * 0.5];
      const end = [a0 + ux * (len * k + 0.5 * k), b0 + uy * (len * k + 0.5 * k)];
      polys.push([iso(start[0] + px, start[1] + py), iso(end[0] + px, end[1] + py), iso(end[0] - px, end[1] - py), iso(start[0] - px, start[1] - py)]);
      break;
    }
    case 'cone': {
      const [c, r] = mid(s.origin);
      const half = ((s.angle / 2) * Math.PI) / 180;
      const pts: Pt[] = [iso(c, r)];
      const steps = Math.max(6, Math.ceil(s.angle / 10));
      for (let i = 0; i <= steps; i++) {
        const a = s.facing - half + (2 * half * i) / steps;
        pts.push(iso(c + Math.cos(a) * s.length * k, r + Math.sin(a) * s.length * k));
      }
      polys.push(pts);
      break;
    }
    case 'tiles':
      for (const [c, r] of s.tiles) {
        const [mc, mr] = [c + 0.5, r + 0.5];
        const h = 0.5 * k;
        polys.push([iso(mc - h, mr - h), iso(mc + h, mr - h), iso(mc + h, mr + h), iso(mc - h, mr + h)]);
      }
      break;
  }
  g.fillStyle(fill.colour, fill.alpha);
  for (const e of ellipses) g.fillEllipse(Math.round(e.at.x), Math.round(e.at.y), e.rx * 2, e.ry * 2);
  for (const p of polys) poly(g, p, true);
  if (!edge) return;
  g.lineStyle(1, edge.colour, edge.alpha);
  for (const e of ellipses) g.strokeEllipse(Math.round(e.at.x), Math.round(e.at.y), e.rx * 2, e.ry * 2);
  for (const p of polys) poly(g, p, false);
}

function poly(g: Phaser.GameObjects.Graphics, pts: Pt[], fill: boolean): void {
  g.beginPath().moveTo(Math.round(pts[0].x), Math.round(pts[0].y));
  for (const p of pts.slice(1)) g.lineTo(Math.round(p.x), Math.round(p.y));
  g.closePath();
  if (fill) g.fillPath();
  else g.strokePath();
}
