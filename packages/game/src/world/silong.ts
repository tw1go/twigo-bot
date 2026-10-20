import Phaser from 'phaser';
import type { SilongBlock, SilongFloor, TownSilongRun } from '@mikazuki/shared';
import type { Manifest, MapObject, PropDef, TownMap } from '../assets/types';
import { tileToScreen } from '../iso';
import { frontDepth } from './depth';
import type { FxHandle, FxLayers } from './fx-layers';
import type { WalkGrid } from './grid';

// 🧊 An Ang Silong floor in the game (maps/silong-<floor>.json; the server runs the run: bot web/town-silong.ts). This
// draws what changes and keeps the walking grid in step:
// - The freight elevators (CONTEXT.md Freight elevator): each block's floor plate, the arrival's cage open (E), the cage
//   down shut (X) until the floor's mini bosses are down, then open (and its tiles walkable). Riding down, the cage
//   slides up out of view over 1 s and leaves its plate (`rideDown`), then the next floor loads.
// - B3's Ice Tanks door: shut until Frosty Tubbs falls, then fx-silong-frost-crack over it and the open door in its
//   place (its tiles walkable).
// - A warm glow under every work lamp (fx-silong-lamp-glow: the 2 tiles that clear Chill).
// The props it draws are left out of the map's own (net/hood.ts silongTownMap: `silongDrawn`).

const RIDE_MS = 1000;

interface Piece {
  o: MapObject;
  img: Phaser.GameObjects.Image;
  plate: Phaser.GameObjects.Image | null;
}

export class SilongView {
  private readonly cages: Piece[] = [];
  private readonly doors: Piece[] = [];
  private readonly glows: (FxHandle | null)[] = [];
  private open = false;
  private doorOpen = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly M: Manifest,
    private readonly map: TownMap,
    private readonly fx: FxLayers,
    private readonly grid: WalkGrid,
  ) {
    for (const o of map.silongDrawn ?? []) {
      if (o.id === 'silong-elevator-plate') continue; // (each cage lays its own)
      if (o.id.startsWith('silong-elevator-')) this.cages.push(this.piece(o, true));
      else if (o.id.startsWith('silong-door-')) this.doors.push(this.piece(o, false));
    }
    // The arrival elevator's tiles are walkable as they are; its cage stays open. The way down is shut till it opens.
    for (const [c, r] of this.block.down) this.grid.block(c, r);
    for (const d of this.block.doors) for (const [c, r] of d.tiles) this.grid.block(c, r);
    const glow = this.M.fx['fx-silong-lamp-glow'];
    for (const [c, r] of this.block.lamps) {
      const t = tileToScreen(c, r);
      this.glows.push(this.fx.play(glow, { x: t.x, y: t.y + 8 }, { layer: 'ground', life: Infinity }));
    }
  }

  get block(): SilongBlock {
    return this.map.silong!;
  }

  get floor(): SilongFloor {
    return this.block.floor;
  }

  /** A cage (with its plate under it) or a door, at its map spot. */
  private piece(o: MapObject, cage: boolean): Piece {
    const img = (id: string, under = false) => {
      const def = this.M.props[id] as PropDef | undefined;
      const t = tileToScreen(o.col, o.row);
      const i = this.scene.add.image(t.x, t.y, def?.file ?? id).setOrigin((def?.anchor[0] ?? 0) / (def?.size[0] ?? 1), (def?.anchor[1] ?? 0) / (def?.size[1] ?? 1));
      i.setDepth(under ? frontDepth(o.col, o.row, 1, 1) - 1000 : frontDepth(o.col, o.row, o.footprint[0], o.footprint[1]));
      return i;
    };
    const plate = cage ? img('silong-elevator-plate', true) : null;
    // (The down cage starts shut; the arrival's stays open.)
    const down = cage && this.isDown(o);
    return { o, img: img(cage ? (down ? 'silong-elevator-closed' : 'silong-elevator-open') : 'silong-door-closed'), plate };
  }

  /** Whether a cage stands on the way down (X) rather than the arrival (E). */
  private isDown(o: MapObject): boolean {
    const down = new Set(this.block.down.map(([c, r]) => `${c},${r}`));
    return down.has(`${o.col + 1},${o.row + 1}`) || down.has(`${o.col},${o.row}`);
  }

  /** The run as the server has it: the way down open once this floor's mini bosses are down, the B3 door once Frosty
   *  Tubbs is. */
  run(r: TownSilongRun): void {
    const f = r.floors.find((x) => x.floor === this.floor);
    if (f?.open && !this.open) {
      this.open = true;
      for (const [c, r2] of this.block.down) this.grid.unblock(c, r2);
      for (const p of this.cages) if (this.isDown(p.o)) p.img.setTexture((this.M.props['silong-elevator-open'] as PropDef | undefined)?.file ?? 'silong-elevator-open');
    }
    if (r.door && !this.doorOpen && this.block.doors.length) {
      this.doorOpen = true;
      for (const d of this.block.doors) for (const [c, r2] of d.tiles) this.grid.unblock(c, r2);
      const crack = this.M.fx['fx-silong-frost-crack'];
      for (const p of this.doors) {
        this.fx.play(crack, { x: p.img.x, y: p.img.y }, { layer: 'front' });
        this.scene.time.delayedCall(500, () => p.img.setTexture((this.M.props['silong-door-open'] as PropDef | undefined)?.file ?? 'silong-door-open'));
      }
    }
  }

  /** Riding down: the cage you stand in slides up out of view over 1 s, leaving its plate; `then` once it's gone. */
  rideDown(at: { col: number; row: number }, then: () => void): void {
    const p = this.cages.filter((x) => this.isDown(x.o)).sort((a, b) => Math.hypot(a.o.col - at.col, a.o.row - at.row) - Math.hypot(b.o.col - at.col, b.o.row - at.row))[0];
    if (!p || matchMedia('(prefers-reduced-motion: reduce)').matches) return void this.scene.time.delayedCall(p ? 200 : 0, then);
    this.scene.tweens.add({ targets: p.img, y: p.img.y - 160, alpha: 0, duration: RIDE_MS, ease: 'Quad.easeIn', onComplete: then });
  }

  /** Whether a tile is in the arrival elevator (riding up starts there). */
  onArrival(col: number, row: number): boolean {
    return this.block.arrive.some(([c, r]) => c === col && r === row);
  }

  destroy(): void {
    for (const p of [...this.cages, ...this.doors]) {
      p.img.destroy();
      p.plate?.destroy();
    }
    for (const g of this.glows) g?.kill(0);
  }
}
