import Phaser from 'phaser';
import type { Manifest } from '../assets/types';
import { assetProblems } from '../characters/doll';
import { LABEL_DEPTH } from '../world/depth';

// Text in the town: a character's name plate with their <Title> under it, and building names. Drawn over the
// world (never tinted at night) in Pixelify Sans. Zoomed out, they keep at least MIN_SCALE screen pixels per art
// pixel (whole numbers, so the plate stays crisp), and the text is rendered at that scale so it stays sharp.

export const UI_FONT = "'Pixelify Sans', system-ui, sans-serif";
const MIN_SCALE = 3;

/** Scale for a label (in world units) and its text resolution at a camera zoom. */
const scaleFor = (zoom: number) => ({ scale: Math.max(zoom, MIN_SCALE) / zoom, resolution: Math.max(zoom, MIN_SCALE) });

const text = (scene: Phaser.Scene, s: string, size: number, color: string, extra: Phaser.Types.GameObjects.Text.TextStyle = {}) =>
  scene.add.text(0, 0, s, { fontFamily: UI_FONT, fontSize: `${size}px`, color, ...extra });

/** The manifest's name plate (three-slice, own name in lime) with the title under it. */
export class Nameplate {
  private readonly box: Phaser.GameObjects.Container;
  private readonly texts: Phaser.GameObjects.Text[];
  private readonly baseHeight: number;

  constructor(scene: Phaser.Scene, M: Manifest, nickname: string, title: string, self = true) {
    const P = M.ui.nameplate;
    const plateH = P?.height ?? 9;
    const name = text(scene, nickname, 5, self ? '#A3E635' : '#E6E9F2').setOrigin(0.5, 0.5);
    const sub = text(scene, `<${title}>`, 4, '#B794F6').setOrigin(0.5, 0);
    // Local coordinates: the bottom centre of the stack is (0, 0).
    const titleY = -Math.ceil(sub.height);
    const plateY = titleY - 1 - plateH;
    sub.setPosition(0, titleY);
    name.setPosition(0, plateY + plateH / 2);
    const parts: Phaser.GameObjects.GameObject[] = [];
    const key = P && (self ? P.self : P.file);
    if (key && scene.textures.exists(key)) {
      const w = Math.max(P.threeSlice * 2 + 1, Math.ceil(name.width) + 6);
      parts.push(scene.add.nineslice(0, plateY, key, undefined, w, plateH, P.threeSlice, P.threeSlice, 0, 0).setOrigin(0.5, 0));
    } else assetProblems.add(`name plate not loaded: ${key ?? 'manifest ui.nameplate'}`);
    parts.push(name, sub);
    this.texts = [name, sub];
    this.baseHeight = -plateY;
    this.box = scene.add.container(0, 0, parts).setDepth(LABEL_DEPTH);
  }

  /** Height of the whole stack (plate + title), in world units. */
  get height(): number {
    return Math.ceil(this.baseHeight * this.box.scale);
  }

  /** Puts the stack's bottom centre at (x, bottom). */
  place(x: number, bottom: number): void {
    this.box.setPosition(x, bottom);
  }

  setZoom(zoom: number): void {
    const { scale, resolution } = scaleFor(zoom);
    this.box.setScale(scale);
    for (const t of this.texts) t.setResolution(resolution);
  }

  destroy(): void {
    this.box.destroy();
  }
}

/** How far (art pixels) a building name rises while it fades in, and how long that takes. */
const RISE = 4;
const FADE_IN_MS = 180;
const FADE_OUT_MS = 120;

/** A building's name over its roof: fades up into place while the building is hovered, fades out after. */
export class BuildingLabel {
  readonly text: Phaser.GameObjects.Text;
  private bottom: number | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    name: string,
    x: number,
  ) {
    this.text = text(scene, name, 6, '#FCDA4A', { stroke: '#1E1B3A', strokeThickness: 2 })
      .setOrigin(0.5, 1)
      .setPosition(Math.round(x), 0)
      .setDepth(LABEL_DEPTH)
      .setAlpha(0)
      .setVisible(false);
  }

  /** Shows the label with its bottom at `bottom` (world y), or hides it. */
  show(bottom: number | null): void {
    const y = bottom === null ? null : Math.round(bottom);
    if (y === this.bottom) return;
    const was = this.bottom;
    this.bottom = y;
    this.scene.tweens.killTweensOf(this.text);
    if (y === null) {
      this.scene.tweens.add({ targets: this.text, alpha: 0, duration: FADE_OUT_MS, onComplete: () => this.text.setVisible(false) });
      return;
    }
    if (was !== null) {
      // Already showing (an alert appeared under it): just move up.
      this.text.setAlpha(1).setY(y);
      return;
    }
    const rise = RISE * this.text.scale;
    this.text.setVisible(true).setAlpha(0).setY(y + rise);
    this.scene.tweens.add({ targets: this.text, alpha: 1, y, duration: FADE_IN_MS, ease: 'Quad.easeOut' });
  }

  setZoom(zoom: number): void {
    const { scale, resolution } = scaleFor(zoom);
    this.text.setScale(scale).setResolution(resolution);
  }
}
