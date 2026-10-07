import type Phaser from 'phaser';
import type { Vec2 } from '../assets/types';
import { tileToScreen } from '../iso';
import { GROUND_SHADOW_DEPTH } from './depth';

// 🌉 The bridges over the river (town.json `bridge`: the east road's, crossing along the cols; `bridges`: the south
// path's to the slums, along the rows): a plank deck drawn here in the palette's woods, one canvas over the water
// tiles, raised a little with its side showing. Their railings are the town's fence pieces (town.json `fence`), so
// they sort with the characters crossing them.

const PLANKS = ['#A57548', '#C0A888']; // oak, alternating
const SEAM = '#7E5533';
const SIDE = '#5C3A24';
const OUTLINE = '#3A2418';
const PLANKS_PER_TILE = 4;
const RAISE = 2; // the deck sits this far above the water
const THICK = 3; // and shows this much side

export function drawBridge(scene: Phaser.Scene, tiles: Vec2[], along: 'col' | 'row' = 'col', name = 'bridge'): Phaser.GameObjects.Image | null {
  if (!tiles.length) return null;
  const tops = tiles.map(([c, r]) => tileToScreen(c, r));
  const x0 = Math.min(...tops.map((t) => t.x)) - 16;
  const y0 = Math.min(...tops.map((t) => t.y)) - RAISE;
  const w = Math.max(...tops.map((t) => t.x)) + 16 - x0;
  const h = Math.max(...tops.map((t) => t.y)) + 16 + THICK - y0;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const on = new Set(tiles.map(([c, r]) => `${c},${r}`));

  /** Each pixel of a tile's diamond, with where it is along the bridge (u: 0–1 along the way across) and across it (v). */
  const each = (fn: (x: number, y: number, u: number, v: number, c: number, r: number) => void) => {
    for (const [c, r] of tiles) {
      const t = tileToScreen(c, r);
      for (let dy = 0; dy < 16; dy++) {
        for (let dx = -16; dx < 16; dx++) {
          const a = (dx + 0.5) / 32 + (dy + 0.5) / 16; // along the col axis
          const b = (dy + 0.5) / 16 - (dx + 0.5) / 32; // along the row axis
          if (a < 0 || a >= 1 || b < 0 || b >= 1) continue;
          fn(t.x + dx - x0, t.y + dy - y0, along === 'col' ? a : b, along === 'col' ? b : a, c, r);
        }
      }
    }
  };
  const px = (x: number, y: number, colour: string) => {
    ctx.fillStyle = colour;
    ctx.fillRect(x, y, 1, 1);
  };

  // The side: the deck's shape again, lower down, in the dark wood (only its lower rim stays in view).
  each((x, y) => {
    for (let d = 0; d < THICK; d++) px(x, y + RAISE + d, SIDE);
  });
  // The deck: planks across the way (every 1/4 tile along it), a seam between them, an outline round the edge.
  each((x, y, u, v, c, r) => {
    const t = u * PLANKS_PER_TILE;
    const k = Math.floor(t) + (along === 'col' ? c : r) * PLANKS_PER_TILE;
    // The outline runs along both sides (the tiles next to it across the way aren't bridge).
    const [sc, sr] = along === 'col' ? [0, 1] : [1, 0];
    const edge = (v < 0.06 && !on.has(`${c - sc},${r - sr}`)) || (v > 0.94 && !on.has(`${c + sc},${r + sr}`));
    px(x, y, edge ? OUTLINE : t - Math.floor(t) < 0.18 ? SEAM : PLANKS[k % 2]);
  });

  const key = `world:${name}`;
  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addCanvas(key, canvas);
  return scene.add.image(x0, y0, key).setOrigin(0, 0).setDepth(GROUND_SHADOW_DEPTH + 1);
}
