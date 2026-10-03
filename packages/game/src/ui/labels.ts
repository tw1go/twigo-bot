import Phaser from 'phaser';
import type { TitleData } from '@mikazuki/shared';
import { LABEL_DEPTH } from '../world/depth';

// Text in the town: a character's name with their <Title> under it, and building names. Drawn over the
// world (never tinted at night) in Pixelify Sans. Zoomed out, they keep at least MIN_SCALE screen pixels per art
// pixel (whole numbers, so the plate stays crisp), and the text is rendered at that scale so it stays sharp.

export const UI_FONT = "'Pixelify Sans', system-ui, sans-serif";
const MIN_SCALE = 3;

/** Scale for a label (in world units) and its text resolution at a camera zoom. */
const scaleFor = (zoom: number) => ({ scale: Math.max(zoom, MIN_SCALE) / zoom, resolution: Math.max(zoom, MIN_SCALE) });

const text = (scene: Phaser.Scene, s: string, size: number, color: string, extra: Phaser.Types.GameObjects.Text.TextStyle = {}) =>
  scene.add.text(0, 0, s, { fontFamily: UI_FONT, fontSize: `${size}px`, color, ...extra });

/** A title's text colour: its own, or white under a shifting rainbow tint for 'prismatic'. */
const PRISMATIC = 'prismatic';

/** HSV (s, v in 0–1) → 0xRRGGBB. */
function hsv(h: number, s: number, v: number): number {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return (f(5) << 16) | (f(3) << 8) | f(1);
}

/** A character's name in white with their <Title> under it in the title's colour. */
export class NameTag {
  private readonly box: Phaser.GameObjects.Container;
  private readonly texts: Phaser.GameObjects.Text[];
  private readonly baseHeight: number;
  private readonly tick: (() => void) | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    nickname: string,
    title: TitleData,
  ) {
    const outline = { stroke: '#1E1B3A', strokeThickness: 2 };
    const name = text(scene, nickname, 6, '#FFFFFF', outline).setOrigin(0.5, 0);
    const prismatic = title.color === PRISMATIC;
    const sub = text(scene, `<${title.name}>`, 4, prismatic ? '#FFFFFF' : title.color, outline).setOrigin(0.5, 0);
    // Local coordinates: the bottom centre of the stack is (0, 0).
    const subH = Math.ceil(sub.height);
    const nameH = Math.ceil(name.height);
    sub.setY(-subH);
    name.setY(-subH - nameH + 1);
    this.texts = [name, sub];
    this.baseHeight = subH + nameH - 1;
    this.box = scene.add.container(0, 0, [name, sub]).setDepth(LABEL_DEPTH);
    if (prismatic) {
      // A rainbow drifting across the title, one hue per corner.
      this.tick = () => {
        const h = (scene.time.now / 12) % 360;
        sub.setTint(hsv(h, 0.45, 1), hsv(h + 70, 0.45, 1), hsv(h + 30, 0.45, 1), hsv(h + 100, 0.45, 1));
      };
      scene.events.on(Phaser.Scenes.Events.UPDATE, this.tick);
    }
  }

  /** Height of the whole stack (name + title), in world units. */
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
    if (this.tick) this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.tick);
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
