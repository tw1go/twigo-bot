import Phaser from 'phaser';
import type { CharacterDefs, Dir, Manifest } from '../assets/types';
import { CHARACTER_BIAS, LABEL_DEPTH } from '../world/depth';
import type { Tile } from '../world/grid';
import { type Outfit, headTop, sheetKey } from './doll';
import type { TitleData } from '@mikazuki/shared';
import { type BubbleArt, EmotePop, NameTag, SpeechBubble } from '../ui/labels';

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
  /** A one-off effect over the head (a big win's coin burst, a bust's siren), drawn over the world. */
  private overhead: Phaser.GameObjects.Sprite | null = null;
  /** fx jailBars over the character while they're in jail. */
  private bars: Phaser.GameObjects.Sprite | null = null;
  private tag: NameTag | null = null;
  private bubble: SpeechBubble | null = null;
  private bubbleTimer: Phaser.Time.TimerEvent | null = null;
  private pop: EmotePop | null = null;
  private zoom = 1;
  private head = 0; // rows of empty cell above the head (headTop)
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
  /** Supplies the next tile while a movement key is held (keyboard walking), or null to stop. */
  nextStep: (() => Tile | null) | null = null;
  /** Called as each step to a neighbouring tile begins (the town tells the server). */
  onStep: ((to: Tile) => void) | null = null;
  private announced: Tile | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly M: Manifest,
    private outfit: Outfit,
    start: Tile,
  ) {
    const C: CharacterDefs = M.characters;
    this.col = start.col + 0.5;
    this.row = start.row + 0.5;
    this.sprite = scene.add.sprite(0, 0, sheetKey(outfit, 'idle', 's'), 0).setOrigin(C.anchor[0] / C.cell[0], C.anchor[1] / C.cell[1]);
    const sh = M.fx.shadow;
    this.shadow = sh?.file ? scene.add.image(0, 0, sh.file).setOrigin((sh.anchor?.[0] ?? 0) / (sh.size?.[0] ?? 1), (sh.anchor?.[1] ?? 0) / (sh.size?.[1] ?? 1)) : null;
    this.head = headTop(scene, outfit);
    this.play('idle');
    this.sync();
  }

  /** Name and <Title> over the head (null removes them). */
  setNameTag(nickname: string | null, title: TitleData): void {
    this.tag?.destroy();
    this.tag = nickname ? new NameTag(this.scene, nickname, title) : null;
    this.tag?.setZoom(this.zoom);
    this.sync();
  }

  /** Jail bars over the character (manifest fx jailBars, in the same cell, on top of their layers), or off. */
  setJailed(on: boolean): void {
    if (!on) {
      this.bars?.destroy();
      this.bars = null;
      return;
    }
    const fx = this.M.fx.jailBars;
    if (this.bars || !fx?.file || !this.scene.textures.exists(fx.file)) return;
    const [w, h] = fx.size ?? this.M.characters.cell;
    const [ax, ay] = fx.anchor ?? this.M.characters.anchor;
    this.bars = this.scene.add.sprite(0, 0, fx.file).setOrigin(ax / w, ay / h);
    this.onSpawn?.(this.bars); // tinted with the world at night
    this.sync();
  }

  /** Sizes the name tag (and any speech bubble) for the camera zoom. */
  setZoom(zoom: number): void {
    this.zoom = zoom;
    this.tag?.setZoom(zoom);
    this.bubble?.setZoom(zoom);
    this.pop?.setZoom(zoom);
    this.sync();
  }

  /** An emote icon over the head (above any speech bubble) for about 2 s; a new one replaces it. */
  showEmote(sheet: string, frame: number): void {
    this.pop?.destroy();
    const pop = new EmotePop(this.scene, sheet, frame, () => {
      if (this.pop === pop) this.pop = null;
    });
    pop.setZoom(this.zoom);
    this.pop = pop;
    this.sync();
  }

  /** Says something: a bubble over the name for a few seconds (longer for longer messages). A new one replaces it. */
  say(text: string, art: BubbleArt): void {
    this.bubbleTimer?.remove();
    this.bubble?.destroy();
    const bubble = new SpeechBubble(this.scene, art, text);
    bubble.setZoom(this.zoom);
    this.bubble = bubble;
    this.sync();
    this.bubbleTimer = this.scene.time.delayedCall(4000 + text.length * 60, () => {
      bubble.fade(this.scene, () => {
        if (this.bubble === bubble) this.bubble = null;
      });
    });
  }

  get tile(): Tile {
    return { col: Math.floor(this.col), row: Math.floor(this.row) };
  }

  /** Standing still (no steps left to walk). */
  get isIdle(): boolean {
    return !this.path.length;
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
    // Facing the camera (se/sw), the sitter is in front of the bench. Facing away (ne/nw), the backrest is
    // nearer the camera than the sitter, so the bench draws over them.
    const away = faces === 'ne' || faces === 'nw';
    this.sittingAt = { depth: benchDepth + (away ? -CHARACTER_BIAS : CHARACTER_BIAS) };
    this.play('sit');
    this.sync();
  }

  standUp(): void {
    if (!this.sittingAt) return;
    this.sittingAt = null;
    this.play('idle');
  }

  /** Another player's step, from the server: walked after any still queued. Too far behind, it jumps there. */
  queueStep(tile: Tile): void {
    this.standUp();
    if (this.path.length >= 4) return this.place(tile);
    if (!this.path.length) this.stepFrom = this.tile;
    this.path.push(tile);
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

  /** Plays an fx over the head `times` times (the manifest's `name`, else `fallback`), then removes it; a new one
   *  replaces it. Not tinted at night: these are light. */
  flash(name: string, fallback: string, times: number): void {
    const fx = this.M.fx[name]?.file ? this.M.fx[name] : this.M.fx[fallback];
    if (!fx?.file || !this.scene.textures.exists(fx.file)) return;
    const key = `anim:${fx.file}:x${times}`;
    if (!this.scene.anims.exists(key)) {
      this.scene.anims.create({ key, frames: this.scene.anims.generateFrameNumbers(fx.file, { start: 0, end: (fx.frames ?? 1) - 1 }), frameRate: fx.fps ?? 8, repeat: times - 1 });
    }
    this.overhead?.destroy();
    const sprite = this.scene.add.sprite(0, 0, fx.file).setOrigin(0.5, 1).setDepth(LABEL_DEPTH - 1);
    sprite.play(key).once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      sprite.destroy();
      if (this.overhead === sprite) this.overhead = null;
    });
    this.overhead = sprite;
    this.sync();
  }

  update(deltaMs: number): void {
    if (!this.path.length) this.takeNextStep();
    if (this.path.length) {
      let budget = (SPEED * deltaMs) / 1000;
      while (budget > 0 && (this.path.length || this.takeNextStep())) {
        const next = this.path[0];
        const tx = next.col + 0.5;
        const ty = next.row + 0.5;
        const dx = tx - this.col;
        const dy = ty - this.row;
        const dist = Math.hypot(dx, dy);
        if (next.col !== this.stepFrom.col || next.row !== this.stepFrom.row) this.dir = dirForStep(next.col - this.stepFrom.col, next.row - this.stepFrom.row);
        if (next !== this.announced) {
          this.announced = next;
          this.onStep?.(next);
        }
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

  /** Keyboard walking: queue the next tile from the held direction (at a tile centre, so steps chain smoothly). */
  private takeNextStep(): boolean {
    const next = this.nextStep?.();
    if (!next) return false;
    this.standUp();
    this.stepFrom = this.tile;
    this.path.push(next);
    return true;
  }

  /** Switch to another (already built) look, keeping position, facing and animation. */
  setOutfit(o: Outfit): void {
    this.outfit = o;
    this.head = headTop(this.scene, o);
    const anim = this.anim;
    this.sprite.anims.stop();
    this.play(anim);
  }

  /** Drops the rest of a click path, keeping only the step in progress (a movement key takes over). */
  cancelPath(): void {
    this.path = this.path.slice(0, 1);
  }

  /** Turn on the spot (a movement key pressed against a wall). */
  face(dir: Dir): void {
    if (this.path.length || this.sittingAt || this.dir === dir) return;
    this.dir = dir;
    this.play('idle');
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
    this.bars?.setPosition(Math.round(x), Math.round(y)).setDepth(depth + 0.05);
    // The name sits just over the head (2 px above its first visible row); an alert goes above it.
    const plateBottom = Math.round(y) - this.M.characters.anchor[1] + this.head - 2;
    this.tag?.place(Math.round(x), plateBottom);
    const alertY = this.tag ? plateBottom - this.tag.height - 1 : Math.round(y) - this.M.characters.cell[1] - 2;
    this.bubble?.place(Math.round(x), alertY);
    this.pop?.place(Math.round(x), alertY - (this.bubble ? this.bubble.height + 1 : 0));
    this.alert?.setPosition(Math.round(x), alertY).setDepth(depth + 0.1);
    this.overhead?.setPosition(Math.round(x), alertY - (this.bubble ? this.bubble.height + 1 : 0));
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
    this.bars?.destroy();
    this.overhead?.destroy();
    this.tag?.destroy();
    this.bubbleTimer?.remove();
    this.bubble?.destroy();
    this.pop?.destroy();
  }

  /** Lets the scene tint effects spawned later (night). */
  onSpawn: ((obj: Phaser.GameObjects.Sprite) => void) | null = null;

  /** Sprites to tint with the world. */
  get tintables(): Phaser.GameObjects.Components.Tint[] {
    return [this.sprite, ...(this.shadow ? [this.shadow] : []), ...(this.bars ? [this.bars] : [])];
  }
}
