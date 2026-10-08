import Phaser from 'phaser';
import type { TitleData } from '@mikazuki/shared';
import { LABEL_DEPTH } from '../world/depth';
import { isColour, visible } from '../util/pixels';

// Text in the town: a character's name with their <Title> under it, and building names. Drawn over the
// world (never tinted at night) in Pixelify Sans. Zoomed out, they keep at least MIN_SCALE screen pixels per art
// pixel (whole numbers, so the plate stays crisp), and the text is rendered at that scale so it stays sharp.

export const UI_FONT = "'Mk Numbers', 'Pixelify Sans', system-ui, sans-serif"; // digits in Jersey 10 (index.html)
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

/** A party member's name (only the party sees it: ui/party.ts). */
export const PARTY_PINK = '#F9A8D4';

/** A character's name in white (party pink for your party) with their <Title> under it in the title's colour (an
 *  NPC's: the name only). */
export class NameTag {
  private readonly box: Phaser.GameObjects.Container;
  private readonly texts: Phaser.GameObjects.Text[];
  private baseHeight: number;
  private readonly tick: (() => void) | null = null;
  private readonly name: Phaser.GameObjects.Text;
  private readonly sub: Phaser.GameObjects.Text;

  constructor(
    private readonly scene: Phaser.Scene,
    nickname: string,
    title: TitleData,
    opts: { nameOnly?: boolean } = {},
  ) {
    const outline = { stroke: '#1E1B3A', strokeThickness: 2 };
    const name = text(scene, nickname, 6, '#FFFFFF', outline).setOrigin(0.5, 0);
    const prismatic = title.color === PRISMATIC;
    const sub = text(scene, `<${title.name}>`, 4, prismatic ? '#FFFFFF' : title.color, outline).setOrigin(0.5, 0);
    this.name = name;
    this.sub = sub;
    this.texts = [name, sub];
    this.baseHeight = 0;
    this.layout(!opts.nameOnly);
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

  private layout(withTitle: boolean): void {
    // Local coordinates: the bottom centre of the stack is (0, 0).
    const subH = withTitle ? Math.ceil(this.sub.height) : 0;
    const nameH = Math.ceil(this.name.height);
    this.sub.setVisible(withTitle).setY(-subH);
    this.name.setY(-subH - nameH + (withTitle ? 1 : 0));
    this.baseHeight = subH + nameH - (withTitle ? 1 : 0);
  }

  /** The name in party pink (a party member, as the party sees them) or white. */
  setParty(on: boolean): void {
    this.name.setColor(on ? PARTY_PINK : '#FFFFFF');
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

/** The speech bubble art (manifest ui.speechBubble): a nine-slice box and a tail under it. */
export interface BubbleArt {
  file: string;
  slice: number;
  tail: string;
  tailAnchor: [number, number];
}

/** How wide (world pixels) a bubble's text may get before it wraps, and the room around the text. */
const BUBBLE_WRAP = 96;
const BUBBLE_PAD_X = 5;
const BUBBLE_PAD_Y = 4;
/** The bubble's inside, and the text on it. */
const BUBBLE_FILL = '#F8F7FF';
const BUBBLE_TEXT = '#1E1B3A';

/** The bubble art with its dark fill (the colour at the box's centre) repainted light; made once per scene. */
export function lightBubble(scene: Phaser.Scene, art: BubbleArt): BubbleArt {
  const repaint = (key: string, fillAt: [number, number] | null): string => {
    const out = `${key}#light`;
    if (scene.textures.exists(out)) return out;
    const src = scene.textures.get(key).getSourceImage() as HTMLImageElement;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(src, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    const d = data.data;
    const [fx, fy] = fillAt ?? [Math.floor(c.width / 2), Math.floor(c.height / 2)];
    const at = (fy * c.width + fx) * 4;
    const fill = [d[at], d[at + 1], d[at + 2]];
    const to = Phaser.Display.Color.HexStringToColor(BUBBLE_FILL);
    for (let i = 0; i < d.length; i += 4) {
      if (visible(d[i + 3]) && isColour(d, i, fill[0], fill[1], fill[2])) [d[i], d[i + 1], d[i + 2]] = [to.red, to.green, to.blue];
    }
    ctx.putImageData(data, 0, 0);
    scene.textures.addCanvas(out, c);
    return out;
  };
  // The tail's fill shows at its top middle pixel (that row joins the box).
  const tailWidth = (scene.textures.get(art.tail).getSourceImage() as HTMLImageElement).width;
  return { ...art, file: repaint(art.file, null), tail: repaint(art.tail, [Math.floor(tailWidth / 2), 0]) };
}

/** Someone's words in a bubble over their head: the bubble art stretched to the text, its tail pointing down. */
export class SpeechBubble {
  private readonly box: Phaser.GameObjects.Container;
  private readonly words: Phaser.GameObjects.Text;
  private readonly baseHeight: number;

  constructor(scene: Phaser.Scene, art: BubbleArt, text: string) {
    this.words = scene.add
      .text(0, 0, text, { fontFamily: UI_FONT, fontSize: '5px', color: BUBBLE_TEXT, align: 'center', wordWrap: { width: BUBBLE_WRAP } })
      .setOrigin(0.5, 0);
    const tail = scene.textures.get(art.tail).getSourceImage() as HTMLImageElement;
    const w = Math.max(art.slice * 2 + 1, Math.ceil(this.words.width) + BUBBLE_PAD_X * 2);
    const h = Math.max(art.slice * 2 + 1, Math.ceil(this.words.height) + BUBBLE_PAD_Y * 2);
    // Local coordinates: the tail's tip is (0, 0); the box sits on top of the tail (one shared outline row).
    const boxBottom = -tail.height + 1;
    const parts: Phaser.GameObjects.GameObject[] = [
      scene.add.nineslice(0, boxBottom, art.file, undefined, w, h, art.slice, art.slice, art.slice, art.slice).setOrigin(0.5, 1),
      scene.add.image(0, -tail.height, art.tail).setOrigin(art.tailAnchor[0] / tail.width, 0),
    ];
    this.words.setY(boxBottom - h + BUBBLE_PAD_Y);
    parts.push(this.words);
    this.baseHeight = h + tail.height - 1;
    this.box = scene.add.container(0, 0, parts).setDepth(LABEL_DEPTH + 1);
  }

  get height(): number {
    return Math.ceil(this.baseHeight * this.box.scale);
  }

  place(x: number, bottom: number): void {
    this.box.setPosition(x, bottom);
  }

  setZoom(zoom: number): void {
    const { scale, resolution } = scaleFor(zoom);
    this.box.setScale(scale);
    this.words.setResolution(resolution);
  }

  /** Fades out, then is gone. */
  fade(scene: Phaser.Scene, done: () => void): void {
    scene.tweens.add({ targets: this.box, alpha: 0, duration: 400, onComplete: () => (this.destroy(), done()) });
  }

  destroy(): void {
    this.box.destroy();
  }
}

/** An emote icon popping up over someone's head: it bounces in, holds for a moment, then floats up and fades. */
export class EmotePop {
  private readonly box: Phaser.GameObjects.Container;
  private readonly icon: Phaser.GameObjects.Image;
  private zoomScale = 1;

  constructor(
    private readonly scene: Phaser.Scene,
    sheet: string,
    frame: number,
    done: () => void,
  ) {
    this.icon = scene.add.image(0, 0, sheet, frame).setOrigin(0.5, 1);
    this.box = scene.add.container(0, 0, [this.icon]).setDepth(LABEL_DEPTH + 2);
    this.icon.setScale(0.3);
    scene.tweens.add({ targets: this.icon, scale: 1, duration: 260, ease: 'Back.easeOut' });
    scene.tweens.add({ targets: this.icon, y: -4, alpha: 0, delay: 1700, duration: 400, onComplete: () => (this.box.destroy(), done()) });
  }

  get height(): number {
    return Math.ceil(this.icon.height * this.zoomScale);
  }

  place(x: number, bottom: number): void {
    this.box.setPosition(x, bottom);
  }

  setZoom(zoom: number): void {
    this.zoomScale = scaleFor(zoom).scale;
    this.box.setScale(this.zoomScale);
  }

  destroy(): void {
    this.scene.tweens.killTweensOf(this.icon);
    this.box.destroy();
  }
}

/** "Level up!" over someone who just went up a level: gold, it pops in, rises a little, holds and fades (~2.2 s). */
export class LevelUpPop {
  private readonly box: Phaser.GameObjects.Container;
  private readonly word: Phaser.GameObjects.Text;
  private zoomScale = 1;

  constructor(
    private readonly scene: Phaser.Scene,
    done: () => void,
  ) {
    this.word = text(scene, 'Level up!', 8, '#FCDA4A', { stroke: '#1E1B3A', strokeThickness: 3, fontStyle: 'bold' }).setOrigin(0.5, 1);
    this.box = scene.add.container(0, 0, [this.word]).setDepth(LABEL_DEPTH + 2);
    this.word.setScale(0.4);
    scene.tweens.add({ targets: this.word, scale: 1, duration: 280, ease: 'Back.easeOut' });
    scene.tweens.add({ targets: this.word, y: -6, duration: 2200, ease: 'Sine.easeOut' });
    scene.tweens.add({ targets: this.word, alpha: 0, delay: 1700, duration: 500, onComplete: () => (this.box.destroy(), done()) });
  }

  get height(): number {
    return Math.ceil(this.word.height * this.zoomScale);
  }

  place(x: number, bottom: number): void {
    this.box.setPosition(x, bottom);
  }

  setZoom(zoom: number): void {
    const { scale, resolution } = scaleFor(zoom);
    this.zoomScale = scale;
    this.box.setScale(scale);
    this.word.setResolution(resolution);
  }

  destroy(): void {
    this.scene.tweens.killTweensOf(this.word);
    this.box.destroy();
  }
}

/** A quest giver's marker over their name: a bobbing "!" (talk to them) or "…" (they're waiting on you), in the
 *  quest's colour. Only the player whose quest it is sees it. */
export class QuestMarker {
  private readonly box: Phaser.GameObjects.Container;
  private readonly mark: Phaser.GameObjects.Text;
  private zoomScale = 1;

  constructor(
    private readonly scene: Phaser.Scene,
    symbol: string,
    color: string,
  ) {
    this.mark = text(scene, symbol, 10, color, { stroke: '#1E1B3A', strokeThickness: 3, fontStyle: 'bold' }).setOrigin(0.5, 1);
    this.box = scene.add.container(0, 0, [this.mark]).setDepth(LABEL_DEPTH + 1);
    scene.tweens.add({ targets: this.mark, y: -3, duration: 520, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });
  }

  get height(): number {
    return Math.ceil((this.mark.height + 3) * this.zoomScale);
  }

  place(x: number, bottom: number): void {
    this.box.setPosition(x, bottom);
  }

  setZoom(zoom: number): void {
    const { scale, resolution } = scaleFor(zoom);
    this.zoomScale = scale;
    this.box.setScale(scale);
    this.mark.setResolution(resolution);
  }

  destroy(): void {
    this.scene.tweens.killTweensOf(this.mark);
    this.box.destroy();
  }
}
