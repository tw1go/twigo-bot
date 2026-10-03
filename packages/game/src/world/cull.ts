import Phaser from 'phaser';

// Hides world sprites that are off screen, so a 72×72 town with hundreds of objects only draws (and animates)
// what the camera can see. Sprites are bucketed into a coarse grid by their bounds once; the visible set is only
// recomputed when the camera's view moves into a different set of cells.

const CELL = 256; // px of world per bucket
const MARGIN = 96; // px around the view, so nothing pops in at the edge

export class Culler {
  private readonly cells = new Map<string, Phaser.GameObjects.Image[]>();
  private visible = new Set<Phaser.GameObjects.Image>();
  private lastRange = '';

  /** Called with each sprite that becomes visible again (e.g. to catch an animation up). */
  onShow: ((s: Phaser.GameObjects.Image) => void) | null = null;

  constructor(sprites: Phaser.GameObjects.Image[]) {
    for (const s of sprites) {
      const b = s.getBounds();
      for (let cy = Math.floor(b.top / CELL); cy <= Math.floor(b.bottom / CELL); cy++) {
        for (let cx = Math.floor(b.left / CELL); cx <= Math.floor(b.right / CELL); cx++) {
          const key = `${cx},${cy}`;
          const list = this.cells.get(key);
          if (list) list.push(s);
          else this.cells.set(key, [s]);
        }
      }
      s.setVisible(false);
    }
  }

  get visibleCount(): number {
    return this.visible.size;
  }

  update(view: Phaser.Geom.Rectangle): void {
    const x0 = Math.floor((view.x - MARGIN) / CELL);
    const x1 = Math.floor((view.right + MARGIN) / CELL);
    const y0 = Math.floor((view.y - MARGIN) / CELL);
    const y1 = Math.floor((view.bottom + MARGIN) / CELL);
    const range = `${x0},${x1},${y0},${y1}`;
    if (range === this.lastRange) return;
    this.lastRange = range;
    const next = new Set<Phaser.GameObjects.Image>();
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) for (const s of this.cells.get(`${cx},${cy}`) ?? []) next.add(s);
    for (const s of this.visible) if (!next.has(s)) s.setVisible(false);
    for (const s of next) {
      if (!this.visible.has(s)) {
        s.setVisible(true);
        this.onShow?.(s);
      }
    }
    this.visible = next;
  }
}
