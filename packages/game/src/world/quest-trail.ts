import Phaser from 'phaser';
import type { GuideManifest } from '../assets/types';
import { tileToScreen } from '../iso';
import { FX_DEPTH } from './fx-layers';
import type { Tile } from './grid';

// ✨ The quest trail (CONTEXT.md "Quest trail"): a sparkling line on the ground from you toward a guided quest's hunt
// (TownScene `trailTick` picks where to and walks the walk grid's path there, its first TRAIL_TILES tiles). One dash
// (manifest guide.trail, 12 × 6, brightness steps 0 dim to 3 lit) on every path tile's middle, on the ground layer
// (under players, mobs and props, like the click marker) at 85%; a brightness wave runs along it toward the goal (every
// WAVE_MS the lit step moves a tile on, the tiles behind it at 2, 1, then 0) and every SPARK_MS a sparkle (guide.sparkle,
// 9 × 9, twinkling once) rises 2 to 6 px over a random dash, in front. Going away, it fades out over FADE_MS. Reduced
// motion: no wave (dim dashes) and a third of the sparkles. A light of its own, never tinted by the night (the
// fireflies' rule). Settings → Game → "Show the quest trail" (localStorage
// mk_guide_trail; on by default) turns it off.

export const TRAIL_TILES = 40;
const ALPHA = 0.85;
const WAVE_MS = 90;
const SPARK_MS = 250;
const FADE_MS = 333;
const STORE = 'mk_guide_trail';

/** Whether the quest trail is shown (Settings). */
export function trailOn(): boolean {
  try {
    return localStorage.getItem(STORE) !== '0';
  } catch {
    return true;
  }
}

export function setTrailOn(on: boolean): void {
  try {
    localStorage.setItem(STORE, on ? '1' : '0');
  } catch {
    // not remembered
  }
  window.dispatchEvent(new Event('mk-guide-trail'));
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export class QuestTrail {
  private dashes: Phaser.GameObjects.Image[] = [];
  private tiles: Tile[] = [];
  private type: 'main' | 'side' = 'main';
  private wave = 0;
  private waveAt = 0;
  private sparkAt = 0;
  private fading: Phaser.Tweens.Tween | null = null;
  /** The dashes fading out (dropped at once if the trail comes back meanwhile). */
  private going: Phaser.GameObjects.Image[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly guide: GuideManifest,
    /** How high the ground is at a point (raised ground), px. */
    private readonly lift: (col: number, row: number) => number,
  ) {}

  private file(kind: 'trail' | 'sparkle', type = this.type): string {
    return this.guide[kind].file.replace('{type}', type);
  }

  /** The tile's middle on screen. */
  private at(t: Tile): { x: number; y: number } {
    const top = tileToScreen(t.col, t.row);
    return { x: top.x, y: top.y + 8 - this.lift(t.col + 0.5, t.row + 0.5) };
  }

  /** The trail along these tiles (from the one after yours toward the goal), in a quest type's colour. */
  show(tiles: Tile[], type: 'main' | 'side'): void {
    const file = this.file('trail', type);
    if (!this.scene.textures.exists(file)) return;
    this.dropFading();
    if (type !== this.type) for (const d of this.dashes) d.setTexture(file, 0);
    this.type = type;
    this.tiles = tiles;
    while (this.dashes.length < tiles.length) {
      this.dashes.push(this.scene.add.image(0, 0, file, 0).setDepth(FX_DEPTH.ground).setAlpha(ALPHA));
    }
    for (const d of this.dashes.splice(tiles.length)) d.destroy();
    tiles.forEach((t, i) => {
      const p = this.at(t);
      this.dashes[i].setPosition(p.x, p.y).setAlpha(ALPHA).setVisible(true);
    });
    if (this.wave >= tiles.length + 3) this.wave = 0;
    this.paint();
  }

  /** Fades it out (it stopped: you're there, the hunt is done, or the trail is off). */
  hide(): void {
    if (!this.dashes.length || this.fading) return;
    this.going = this.dashes;
    this.dashes = [];
    this.tiles = [];
    this.fading = this.scene.tweens.add({ targets: this.going, alpha: 0, duration: FADE_MS, onComplete: () => this.dropFading() });
  }

  private dropFading(): void {
    this.fading?.stop();
    this.fading = null;
    for (const d of this.going) d.destroy();
    this.going = [];
  }

  get showing(): boolean {
    return this.dashes.length > 0;
  }

  /** Each frame: the wave and the sparkles. */
  update(time: number): void {
    if (!this.dashes.length) return;
    const still = reducedMotion();
    if (!still && time >= this.waveAt) {
      this.waveAt = time + WAVE_MS;
      this.wave = (this.wave + 1) % (this.tiles.length + 3);
      this.paint();
    }
    if (time >= this.sparkAt) {
      this.sparkAt = time + SPARK_MS * (still ? 3 : 1);
      this.spark();
    }
  }

  /** The brightness steps: the lit dash at the wave, the three behind it fading. */
  private paint(): void {
    const still = reducedMotion();
    this.dashes.forEach((d, i) => {
      const back = this.wave - i;
      d.setFrame(still ? 0 : back === 0 ? 3 : back === 1 ? 2 : back === 2 ? 1 : 0);
    });
  }

  private spark(): void {
    const file = this.file('sparkle');
    if (!this.scene.textures.exists(file) || !this.tiles.length) return;
    const S = this.guide.sparkle;
    const key = `anim:${file}`;
    if (!this.scene.anims.exists(key)) this.scene.anims.create({ key, frames: this.scene.anims.generateFrameNumbers(file, { start: 0, end: S.frames - 1 }), frameRate: S.fps, repeat: 0 });
    const p = this.at(this.tiles[Math.floor(Math.random() * this.tiles.length)]);
    const s = this.scene.add.sprite(p.x, p.y - 2 - Math.floor(Math.random() * 5), file, 0).setOrigin(0.5, 1).setDepth(FX_DEPTH.front);
    s.play(key).once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => s.destroy());
  }

  destroy(): void {
    this.dropFading();
    for (const d of this.dashes) d.destroy();
    this.dashes = [];
  }
}
