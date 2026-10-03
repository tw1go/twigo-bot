import Phaser from 'phaser';
import type { CharacterDefs, Dir, Manifest } from '../assets/types';
import { CHARACTER_BIAS } from '../world/depth';
import type { Tile } from '../world/grid';
import { type Outfit, sheetKey } from './doll';

// A walking paper doll. Position is in tile space (tile centre = col + 0.5); the sprite's feet anchor sits on it.
// Depth is the front corner of the tile the feet are on, refreshed every frame.

const SPEED = 4; // tiles per second

/** Facing for one grid step: col runs screen right-down, row runs screen left-down. */
export function dirForStep(dc: number, dr: number): Dir {
  const key = `${Math.sign(dc)},${Math.sign(dr)}`;
  const table: Record<string, Dir> = {
    '1,0': 'se', '0,1': 'sw', '1,1': 's', '-1,-1': 'n',
    '1,-1': 'e', '-1,1': 'w', '-1,0': 'nw', '0,-1': 'ne',
  };
  return table[key] ?? 's';
}

export class Character {
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly shadow: Phaser.GameObjects.Image | null;
  private alert: Phaser.GameObjects.Sprite | null = null;
  private col: number; // tile-space position of the feet (tile centre = integer + 0.5)
  private row: number;
  private path: Tile[] = [];
  /** The tile the current step started from: facing comes from the whole step, not the distance left. */
  private stepFrom: Tile = { col: 0, row: 0 };
  private dir: Dir = 's';
  private anim = 'idle';
  private sittingAt: { depth: number } | null = null;
  private lastWalkFrame = -1;
  private readonly boundsCache = new Phaser.Geom.Rectangle();
  /** Corrects the feet depth against big objects (set by the scene; see WorldObjects.sortAgainstBig). */
  depthFn: ((col: number, row: number, depth: number, bounds: Phaser.Geom.Rectangle) => number) | null = null;
  /** Called once the character stops on its destination tile. */
  onArrive: ((tile: Tile) => void) | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly M: Manifest,
    private readonly outfit: Outfit,
    start: Tile,
  ) {
    const C: CharacterDefs = M.characters;
    this.col = start.col + 0.5;
    this.row = start.row + 0.5;
    this.sprite = scene.add.sprite(0, 0, sheetKey(outfit, 'idle', 's'), 0).setOrigin(C.anchor[0] / C.cell[0], C.anchor[1] / C.cell[1]);
    const sh = M.fx.shadow;
    this.shadow = sh?.file ? scene.add.image(0, 0, sh.file).setOrigin((sh.anchor?.[0] ?? 0) / (sh.size?.[0] ?? 1), (sh.anchor?.[1] ?? 0) / (sh.size?.[1] ?? 1)) : null;
    this.play('idle');
    this.sync();
  }

  get tile(): Tile {
    return { col: Math.floor(this.col), row: Math.floor(this.row) };
  }

  get isSitting(): boolean {
    return !!this.sittingAt;
  }

  get facing(): Dir {
    return this.dir;
  }

  /** Follow a path (from the current tile). */
  walk(path: Tile[]): void {
    this.standUp();
    this.path = path.slice(path.length && path[0].col === this.tile.col && path[0].row === this.tile.row ? 1 : 0);
    this.stepFrom = this.tile;
    if (!this.path.length) this.arrive();
  }

  /** Snap onto a bench and sit facing the way it faces. */
  sit(tile: Tile, faces: Dir, benchDepth: number): void {
    this.path = [];
    this.col = tile.col + 0.5;
    this.row = tile.row + 0.5;
    this.dir = faces;
    this.sittingAt = { depth: benchDepth + CHARACTER_BIAS };
    this.play('sit');
    this.sync();
  }

  standUp(): void {
    if (!this.sittingAt) return;
    this.sittingAt = null;
    this.play('idle');
  }

  /** Teleport (spawn, debug). */
  place(tile: Tile, dir: Dir = this.dir): void {
    this.standUp();
    this.path = [];
    this.col = tile.col + 0.5;
    this.row = tile.row + 0.5;
    this.dir = dir;
    this.play('idle');
    this.sync();
  }

  /** Play wave or cheer once, then go back to idle. */
  emote(anim: 'wave' | 'cheer'): void {
    if (this.path.length || this.sittingAt) return;
    this.play(anim);
    this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => this.play('idle'));
  }

  /** fx-alert above the head while `on`. */
  setAlert(on: boolean): void {
    const fx = this.M.fx.alert;
    if (!on || !fx?.file) {
      this.alert?.destroy();
      this.alert = null;
      return;
    }
    if (this.alert) return;
    const key = `anim:${fx.file}`;
    if (!this.scene.anims.exists(key)) {
      this.scene.anims.create({ key, frames: this.scene.anims.generateFrameNumbers(fx.file, { start: 0, end: (fx.frames ?? 1) - 1 }), frameRate: fx.fps ?? 4, repeat: -1 });
    }
    this.alert = this.scene.add.sprite(0, 0, fx.file).setOrigin(0.5, 1);
    this.alert.play(key);
    this.sync();
  }

  update(deltaMs: number): void {
    if (this.path.length) {
      let budget = (SPEED * deltaMs) / 1000;
      while (budget > 0 && this.path.length) {
        const next = this.path[0];
        const tx = next.col + 0.5;
        const ty = next.row + 0.5;
        const dx = tx - this.col;
        const dy = ty - this.row;
        const dist = Math.hypot(dx, dy);
        if (next.col !== this.stepFrom.col || next.row !== this.stepFrom.row) this.dir = dirForStep(next.col - this.stepFrom.col, next.row - this.stepFrom.row);
        if (dist <= budget) {
          this.col = tx;
          this.row = ty;
          budget -= dist;
          this.stepFrom = next;
          this.path.shift();
        } else {
          this.col += (dx / dist) * budget;
          this.row += (dy / dist) * budget;
          budget = 0;
        }
      }
      this.play('walk');
      this.stepDust();
      if (!this.path.length) this.arrive();
    }
    this.sync();
  }

  /** Footstep dust on the first frame of each walk cycle: one puff every other step. (Polled, because a looping
   *  animation doesn't emit a frame update when it wraps back to its first frame.) */
  private stepDust(): void {
    const anims = this.sprite.anims;
    const frame = anims.currentFrame;
    const first = anims.currentAnim?.frames[0];
    if (!frame || !first) return;
    if (frame.index !== this.lastWalkFrame && frame === first) this.dust();
    this.lastWalkFrame = frame.index;
  }

  private arrive(): void {
    this.lastWalkFrame = -1;
    this.play('idle');
    this.onArrive?.(this.tile);
  }

  private play(anim: string): void {
    const C = this.M.characters;
    const dirs = C.animations[anim]?.directions ?? C.directions;
    const dir = dirs.includes(this.dir) ? this.dir : dirs[0];
    const key = sheetKey(this.outfit, anim, dir);
    this.anim = anim;
    if (this.sprite.anims.currentAnim?.key === key && this.sprite.anims.isPlaying) return;
    // Keep the walk cycle's phase when only the direction changes (keys are "doll:<outfit>:<anim>:<dir>").
    const current = this.sprite.anims.currentAnim?.key.split(':')[2];
    const progress = current === anim && anim === 'walk' ? this.sprite.anims.getProgress() : 0;
    this.sprite.play(key);
    if (progress) this.sprite.anims.setProgress(progress);
  }

  /** Screen position and depth from the tile-space position. */
  private sync(): void {
    const x = (this.col - this.row) * 16;
    const y = (this.col + this.row) * 8;
    const t = this.tile;
    this.sprite.setPosition(Math.round(x), Math.round(y));
    const feet = (this.col + this.row + 1) * 8 + CHARACTER_BIAS;
    const depth = this.sittingAt?.depth ?? (this.depthFn ? this.depthFn(t.col, t.row, feet, this.sprite.getBounds(this.boundsCache)) : feet);
    this.sprite.setDepth(depth);
    this.shadow?.setPosition(Math.round(x), Math.round(y)).setDepth(depth - 0.2);
    this.alert?.setPosition(Math.round(x), Math.round(y) - this.M.characters.cell[1] - 2).setDepth(depth + 0.1);
  }

  private dust(): void {
    const fx = this.M.fx['footstep-dust'];
    if (!fx?.file) return;
    const key = `anim:${fx.file}`;
    if (!this.scene.anims.exists(key)) {
      this.scene.anims.create({ key, frames: this.scene.anims.generateFrameNumbers(fx.file, { start: 0, end: (fx.frames ?? 1) - 1 }), frameRate: fx.fps ?? 12, repeat: 0 });
    }
    const puff = this.scene.add.sprite(this.sprite.x, this.sprite.y, fx.file).setOrigin(0.5, 1).setDepth(this.sprite.depth - 0.1);
    puff.play(key);
    puff.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => puff.destroy());
    this.onSpawn?.(puff);
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow?.destroy();
    this.alert?.destroy();
  }

  /** Lets the scene tint effects spawned later (night). */
  onSpawn: ((obj: Phaser.GameObjects.Sprite) => void) | null = null;

  /** Sprites to tint with the world. */
  get tintables(): Phaser.GameObjects.Components.Tint[] {
    return [this.sprite, ...(this.shadow ? [this.shadow] : [])];
  }
}
