import Phaser from 'phaser';
import type { LeaderboardRow } from '@mikazuki/shared';
import { TILE_H, TILE_W, screenToTile, tileToScreen } from '../iso';

// Placeholder town: a diamond grid of plain tiles, a draggable camera with whole-number zoom, and a hover
// highlight to prove the projection works both ways. No art yet.
const SIZE = 12;
const ZOOMS = [1, 2, 3, 4];

// Proves the @mikazuki/shared workspace link: a fake leaderboard row typed by the bot's room API.
const SAMPLE_TOP: LeaderboardRow = { rank: 1, name: 'Mikazuki', avatar: '', kowens: 0 };

export class TownScene extends Phaser.Scene {
  private hover!: Phaser.GameObjects.Graphics;
  private label!: Phaser.GameObjects.Text;
  private zoomIndex = 1;

  constructor() {
    super('town');
  }

  create(): void {
    const grid = this.add.graphics();
    for (let row = 0; row < SIZE; row++) {
      for (let col = 0; col < SIZE; col++) {
        const { x, y } = tileToScreen(col, row);
        const shade = (col + row) % 2 === 0 ? 0x3b4261 : 0x2f354f;
        this.diamond(grid, x, y, shade, 0x565f89);
      }
    }
    this.hover = this.add.graphics();

    this.label = this.add
      .text(8, 8, '', { fontFamily: 'monospace', fontSize: '12px', color: '#c0caf5' })
      .setScrollFactor(0)
      .setDepth(10);

    // Centre the camera on the middle of the grid.
    const centre = tileToScreen(SIZE / 2, SIZE / 2);
    const cam = this.cameras.main;
    cam.setZoom(ZOOMS[this.zoomIndex]).centerOn(centre.x, centre.y);
    cam.roundPixels = true;

    // Drag to pan (in world units, so it feels the same at every zoom).
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown) {
        cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
        cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
      }
      this.updateHover(p);
    });

    // Wheel zooms in whole steps only (1×–4×), keeping pixels crisp.
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.zoomIndex = Phaser.Math.Clamp(this.zoomIndex + (dy < 0 ? 1 : -1), 0, ZOOMS.length - 1);
      cam.setZoom(ZOOMS[this.zoomIndex]);
    });

    this.updateLabel(null);
  }

  private diamond(g: Phaser.GameObjects.Graphics, x: number, y: number, fill: number, line: number): void {
    const pts = [
      new Phaser.Math.Vector2(x, y),
      new Phaser.Math.Vector2(x + TILE_W / 2, y + TILE_H / 2),
      new Phaser.Math.Vector2(x, y + TILE_H),
      new Phaser.Math.Vector2(x - TILE_W / 2, y + TILE_H / 2),
    ];
    g.fillStyle(fill, 1).fillPoints(pts, true);
    g.lineStyle(1, line, 1).strokePoints(pts, true);
  }

  private updateHover(p: Phaser.Input.Pointer): void {
    const world = this.cameras.main.getWorldPoint(p.x, p.y);
    const { col, row } = screenToTile(world.x, world.y);
    this.hover.clear();
    if (col < 0 || row < 0 || col >= SIZE || row >= SIZE) return this.updateLabel(null);
    const { x, y } = tileToScreen(col, row);
    this.diamond(this.hover, x, y, 0x7aa2f7, 0xc0caf5);
    this.updateLabel({ col, row });
  }

  private updateLabel(tile: { col: number; row: number } | null): void {
    this.label.setText(
      [
        `Mikazuki town (placeholder) · zoom ${ZOOMS[this.zoomIndex]}×`,
        tile ? `tile ${tile.col},${tile.row}` : 'hover a tile · drag to pan · wheel to zoom',
        `shared type OK: #${SAMPLE_TOP.rank} ${SAMPLE_TOP.name}`,
      ].join('\n'),
    );
  }
}
