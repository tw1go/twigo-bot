// 🎃 The Halloween event in the world (CONTEXT.md Mikko Kalabasa, Manananggal, Dazed, Reunite; the server's word is bot
// web/halloween.ts, sent as `halloween` views): Mikko Kalabasa where it hides on your map (manifest props.mikko-kalabasa,
// looping, sorted like a prop; no marker: finding it is the game), the Manananggal's lower half in town (props.
// manananggal-lower on a small shadow, "Manananggal (lower half)" on hover), and the dazed upper half floating behind
// whoever carries it (mobs.manananggal-upper's `carried` anim, facing their way, about a tile behind them), everyone's.
// Biikko Kalabasa and the flying upper half are mobs (world/mobs.ts). The bursts: fx-mikko-found where Mikko was,
// fx-manananggal-reunite on the legs, then the Manananggal flies up and off.

import Phaser from 'phaser';
import type { HalloweenView } from '@mikazuki/shared';
import type { Dir, Manifest, MobDef, Vec2 } from '../assets/types';
import { queueSheet } from '../assets/queue';
import { slice } from '../assets/packs';
import { BuildingLabel } from '../ui/labels';
import { CHARACTER_BIAS, HEIGHT_DEPTH } from './depth';
import type { FxLayers } from './fx-layers';
import { type WorldObjects, characterDepth } from './objects';

const UPPER = 'manananggal-upper';
/** How far behind its carrier the dazed upper half floats (tiles), and how quickly it eases after them (ms). */
const BEHIND_TILES = 1;
const EASE_MS = 160;
/** Flying off: up this far (px) over this long (ms), fading. */
const FLY_PX = 90;
const FLY_MS = 1100;

/** One screen direction's way in tile space (screen x = (col − row) × 16, y = (col + row) × 8). */
const DIR_VEC: Record<Dir, [number, number]> = {
  se: [1, 0], sw: [0, 1], nw: [-1, 0], ne: [0, -1], s: [0.7, 0.7], n: [-0.7, -0.7], e: [0.7, -0.7], w: [-0.7, 0.7],
};
/** The upper half's sheets face the four diagonals (SE for S and E, SW for W, NE for N, as the mobs). */
const SHEET_DIR: Record<Dir, 'se' | 'sw' | 'ne' | 'nw'> = { se: 'se', s: 'se', e: 'se', sw: 'sw', w: 'sw', ne: 'ne', n: 'ne', nw: 'nw' };

/** Who carries a dazed upper half, as the scene finds them (their feet in tiles, their facing), or null (not drawn). */
export interface Carrier {
  spot: { col: number; row: number };
  facing: Dir;
  visible: boolean;
}

interface Dazed {
  sprite: Phaser.GameObjects.Sprite;
  col: number;
  row: number;
}

interface PropArt {
  file: string;
  size: Vec2;
  anchor: Vec2;
  animation?: { frames: number; fps: number; loop: boolean };
  shadow?: Vec2;
  /** Drawn at this scale (the lower half: 0.6), its shadow too. */
  scale?: number;
}

export class HalloweenWorld {
  private view: HalloweenView | null = null;
  private mikko: Phaser.GameObjects.Sprite | null = null;
  private lower: { sprite: Phaser.GameObjects.Sprite; shadow: Phaser.GameObjects.Image | null; label: BuildingLabel; col: number; row: number } | null = null;
  private readonly dazed = new Map<string, Dazed>();
  /** Set by the scene: the night's tint on what it adds, and the town id that's you. */
  onSpawn: (obj: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image) => void = () => {};

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly M: Manifest,
    private readonly objects: WorldObjects,
    private readonly fx: FxLayers,
    /** A carrier by town id (yours included), or null when they aren't here. */
    private readonly carrier: (id: string) => Carrier | null,
  ) {
    this.load();
  }

  private prop(id: string): PropArt | null {
    return (this.M.props[id] as PropArt | undefined) ?? null;
  }

  private get upperDef(): MobDef | null {
    const d = this.M.mobs?.[UPPER];
    return d && typeof d !== 'string' ? d : null;
  }

  /** Mikko's and the lower half's sheets, and the upper half's carried ones (only those: its fighting art loads with
   *  the Slums' mobs), in the background. */
  private load(): void {
    const L = this.scene.load;
    const T = this.scene.textures;
    for (const id of ['mikko-kalabasa', 'manananggal-lower']) {
      const p = this.prop(id);
      if (p) queueSheet(L, T, p.file, p.size[0], p.size[1]);
    }
    const U = this.upperDef;
    if (U) for (const dir of U.directions) queueSheet(L, T, this.carriedFile(U, dir), U.size[0], U.size[1]);
    // (The mobs' rules, for the upper half's scale: the Slums load them anyway, the town doesn't.)
    if (!this.scene.cache.json.exists('mob-data') && typeof this.M.mobs?.data === 'string') L.json('mob-data', this.M.mobs.data);
    if (!L.isLoading()) L.start();
  }

  /** The upper half's scale (mobs.json, as it's drawn fighting), once its rules are in. */
  private get upperScale(): number {
    return ((this.scene.cache.json.get('mob-data') ?? {})[UPPER] as { scale?: number } | undefined)?.scale ?? 1;
  }

  private carriedFile(U: MobDef, dir: string): string {
    return U.file.replace('{anim}', 'carried').replace('{dir}', dir);
  }

  /** A sheet's looping anim (made once its texture is in), or null while it isn't. */
  private anim(key: string, file: string, size: Vec2, a: { frames: number; fps: number; loop: boolean }): string | null {
    if (this.scene.anims.exists(key)) return key;
    if (!this.scene.textures.exists(file)) return null;
    slice(this.scene.textures, file, size[0], size[1]);
    this.scene.anims.create({ key, frames: this.scene.anims.generateFrameNumbers(file, { start: 0, end: a.frames - 1 }), frameRate: a.fps, repeat: a.loop ? -1 : 0 });
    return key;
  }

  /** The event as the server has it now (null: off): Mikko, the lower half and who's carrying the upper half. */
  set(view: HalloweenView | null): void {
    this.view = view;
    const m = view?.mikko;
    if (!m) this.dropMikko();
    else if (!this.mikko || this.mikko.getData('at') !== `${m.col},${m.row}`) this.makeMikko(m.col, m.row);
    const l = view?.lower;
    if (!l) this.dropLower(true);
    else if (!this.lower || this.lower.col !== l.col || this.lower.row !== l.row) this.makeLower(l.col, l.row);
    const dazed = new Set(view?.dazed ?? []);
    for (const id of [...this.dazed.keys()]) if (!dazed.has(id)) this.dropDazed(id, true); // (flown away)
    for (const id of dazed) if (!this.dazed.has(id)) this.makeDazed(id);
  }

  /** Mikko or the lower half, if it's among what the pointer is over (a click on it: the scene walks you over and asks
   *  the server). */
  pick(over: Phaser.GameObjects.GameObject[]): 'mikko' | 'lower' | null {
    if (this.mikko && over.includes(this.mikko)) return 'mikko';
    if (this.lower && over.includes(this.lower.sprite)) return 'lower';
    return null;
  }

  /** Where Mikko hides on your map, or null. */
  get mikkoAt(): { col: number; row: number } | null {
    return this.view?.mikko ?? null;
  }

  get lowerAt(): { col: number; row: number } | null {
    return this.view?.lower ?? null;
  }

  /** A tile's ground point (its centre) and its depth among characters there. */
  private place(obj: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image, col: number, row: number): void {
    const ground = this.objects.heights.lift(col, row);
    obj.setPosition(Math.round((col - row) * 16), Math.round((col + row) * 8 - ground));
    const feet = (col + row + 1) * 8 + CHARACTER_BIAS + ground * HEIGHT_DEPTH;
    obj.setDepth(characterDepth(this.objects, Math.floor(col), Math.floor(row), feet, obj.getBounds()));
  }

  private sprite(id: string, col: number, row: number): Phaser.GameObjects.Sprite | null {
    const p = this.prop(id);
    if (!p) return null;
    const s = this.scene.add.sprite(0, 0, p.file).setOrigin(p.anchor[0] / p.size[0], p.anchor[1] / p.size[1]).setScale(p.scale ?? 1);
    if (!this.scene.textures.exists(p.file)) s.setVisible(false); // (shown once its sheet is in: update)
    this.place(s, col + 0.5, row + 0.5);
    this.onSpawn(s);
    s.setInteractive({ cursor: 'pointer', pixelPerfect: id !== 'mikko-kalabasa' }); // (the little pumpkin: its whole box)
    return s;
  }

  /** Plays a prop's loop once its sheet is in (the sheet may still be loading as it's made). */
  private animate(s: Phaser.GameObjects.Sprite, id: string): void {
    if (s.anims.isPlaying) return;
    const p = this.prop(id);
    const a = p?.animation;
    if (!p || !a) return;
    const key = this.anim(`hw:${id}`, p.file, p.size, a);
    if (!key) return;
    s.setTexture(p.file).setVisible(true).play(key);
  }

  private makeMikko(col: number, row: number): void {
    this.dropMikko();
    const s = this.sprite('mikko-kalabasa', col, row);
    if (!s) return;
    s.setData('at', `${col},${row}`);
    this.mikko = s;
    this.animate(s, 'mikko-kalabasa');
  }

  private dropMikko(): void {
    this.mikko?.destroy();
    this.mikko = null;
  }

  private makeLower(col: number, row: number): void {
    this.dropLower(false);
    const s = this.sprite('manananggal-lower', col, row);
    if (!s) return;
    const p = this.prop('manananggal-lower')!;
    const k = p.scale ?? 1;
    const shadow = p.shadow ? this.shadowImage([Math.round(p.shadow[0] * k), Math.round(p.shadow[1] * k)]) : null;
    if (shadow) {
      this.place(shadow, col + 0.5, row + 0.5);
      shadow.setDepth(s.depth - 0.2);
    }
    const label = new BuildingLabel(this.scene, 'Manananggal (lower half)', s.x);
    s.on('pointerover', () => label.show(s.y - (p.anchor[1] - 6) * k));
    s.on('pointerout', () => label.show(null));
    this.lower = { sprite: s, shadow, label, col, row };
    this.animate(s, 'manananggal-lower');
  }

  /** The lower half gone: faded (its time ran out) or at once. */
  private dropLower(fade: boolean): void {
    const l = this.lower;
    if (!l) return;
    this.lower = null;
    l.label.show(null);
    const parts = [l.sprite, ...(l.shadow ? [l.shadow] : [])];
    const drop = () => {
      parts.forEach((p) => p.destroy());
      this.scene.time.delayedCall(300, () => l.label.text.destroy());
    };
    if (fade) this.scene.tweens.add({ targets: parts, alpha: 0, duration: 600, onComplete: drop });
    else drop();
  }

  /** The shadow's look (fx.shadow's colour) as a pixel ellipse of this size, like the mobs'. */
  private shadowImage([w, h]: Vec2): Phaser.GameObjects.Image | null {
    const art = this.M.fx.shadow?.file;
    if (!art || !this.scene.textures.exists(art)) return null;
    const key = `mob-shadow:${w}x${h}`;
    if (!this.scene.textures.exists(key)) {
      const src = this.scene.textures.get(art).getSourceImage() as HTMLImageElement;
      const c = this.scene.textures.getPixel(Math.floor(src.width / 2), Math.floor(src.height / 2), art);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = c ? `rgba(${c.red}, ${c.green}, ${c.blue}, ${c.alpha / 255})` : 'rgba(30, 27, 58, 0.4)';
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (((x + 0.5 - w / 2) / (w / 2)) ** 2 + ((y + 0.5 - h / 2) / (h / 2)) ** 2 <= 1) ctx.fillRect(x, y, 1, 1);
      this.scene.textures.addCanvas(key, canvas);
    }
    const img = this.scene.add.image(0, 0, key);
    this.onSpawn(img);
    return img;
  }

  private makeDazed(id: string): void {
    const U = this.upperDef;
    if (!U) return;
    const c = this.carrier(id);
    const at = c ? this.behind(c) : { col: 0, row: 0 };
    const s = this.scene.add.sprite(0, 0, this.carriedFile(U, 'se')).setOrigin(U.anchor[0] / U.size[0], U.anchor[1] / U.size[1]).setVisible(false);
    this.onSpawn(s);
    this.dazed.set(id, { sprite: s, col: at.col, row: at.row });
  }

  /** Its float ends: flown off (`fly`: up and fading) or just gone. */
  private dropDazed(id: string, fly: boolean): void {
    const d = this.dazed.get(id);
    if (!d) return;
    this.dazed.delete(id);
    if (fly && d.sprite.visible) this.flyOff([d.sprite]);
    else d.sprite.destroy();
  }

  private flyOff(parts: (Phaser.GameObjects.Sprite | Phaser.GameObjects.Image)[]): void {
    this.scene.tweens.add({ targets: parts, y: `-=${FLY_PX}`, alpha: 0, duration: FLY_MS, ease: 'Quad.easeIn', onComplete: () => parts.forEach((p) => p.destroy()) });
  }

  /** About a tile behind them, the other way from where they face. */
  private behind(c: Carrier): { col: number; row: number } {
    const [dc, dr] = DIR_VEC[c.facing] ?? [0, 0];
    return { col: c.spot.col - dc * BEHIND_TILES, row: c.spot.row - dr * BEHIND_TILES };
  }

  /** Mikko was found where it hid: its burst there, and it's gone. */
  found(col: number, row: number): void {
    this.dropMikko();
    this.burst('fx-mikko-found', col, row);
  }

  /** The Manananggal reunited: the burst on its legs, then both halves fly up and off. */
  reunited(carrier: string, col: number, row: number): void {
    this.burst('fx-manananggal-reunite', col, row);
    const fx = this.M.fx['fx-manananggal-reunite'];
    const wait = fx?.frames && fx.fps ? (fx.frames / fx.fps) * 1000 * 0.6 : 400;
    const l = this.lower;
    const d = this.dazed.get(carrier);
    this.dazed.delete(carrier);
    if (l && l.col === col && l.row === row) {
      this.lower = null;
      l.label.show(null);
      l.shadow?.destroy();
      this.scene.time.delayedCall(300, () => l.label.text.destroy());
    }
    // The upper half comes down onto the legs as the light gathers, then they go up together.
    if (d) this.scene.tweens.add({ targets: d.sprite, x: l?.sprite.x ?? d.sprite.x, y: l?.sprite.y ?? d.sprite.y, duration: wait * 0.8, ease: 'Sine.easeOut' });
    this.scene.time.delayedCall(wait, () => this.flyOff([...(l && l.sprite.active ? [l.sprite] : []), ...(d ? [d.sprite] : [])]));
  }

  /** Your dazed upper half flew away (no reward). */
  flew(myId: string): void {
    this.dropDazed(myId, true);
  }

  private burst(id: string, col: number, row: number): void {
    const ground = this.objects.heights.lift(col + 0.5, row + 0.5);
    this.fx.play(this.M.fx[id], { x: (col - row) * 16, y: (col + row + 1) * 8 - ground });
  }

  /** What the night tints. */
  get tintables(): (Phaser.GameObjects.Sprite | Phaser.GameObjects.Image)[] {
    return [...(this.mikko ? [this.mikko] : []), ...(this.lower ? [this.lower.sprite, ...(this.lower.shadow ? [this.lower.shadow] : [])] : []), ...[...this.dazed.values()].map((d) => d.sprite)];
  }

  update(deltaMs: number): void {
    if (this.mikko) this.animate(this.mikko, 'mikko-kalabasa');
    if (this.lower) this.animate(this.lower.sprite, 'manananggal-lower');
    const U = this.upperDef;
    const carried = U?.animations.carried;
    if (!U || !carried) return;
    const k = 1 - Math.exp(-deltaMs / EASE_MS);
    for (const [id, d] of this.dazed) {
      const c = this.carrier(id);
      if (!c || !c.visible) {
        d.sprite.setVisible(false);
        continue;
      }
      const to = this.behind(c);
      // Far off (a teleport, a new map): straight there; else it eases after them.
      if (!d.sprite.visible || Math.hypot(to.col - d.col, to.row - d.row) > 4) [d.col, d.row] = [to.col, to.row];
      else {
        d.col += (to.col - d.col) * k;
        d.row += (to.row - d.row) * k;
      }
      const dir = SHEET_DIR[c.facing] ?? 'se';
      const key = this.anim(`hw:carried:${dir}`, this.carriedFile(U, dir), U.size, carried);
      if (!key) continue;
      if (d.sprite.anims.currentAnim?.key !== key) d.sprite.play(key, true);
      d.sprite.setScale(this.upperScale).setVisible(true);
      this.place(d.sprite, d.col, d.row);
    }
  }

  destroy(): void {
    this.dropMikko();
    this.dropLower(false);
    for (const id of [...this.dazed.keys()]) this.dropDazed(id, false);
  }
}
