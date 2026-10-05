import Phaser from 'phaser';
import type { BuildingDef, Dir, Manifest, MapObject, PropDef, TownMap, Vec2 } from '../assets/types';
import { assetProblems } from '../characters/doll';
import { tileToScreen } from '../iso';
import { CHARACTER_BIAS, GLOW_DEPTH, GROUND_SHADOW_DEPTH, frontDepth } from './depth';
import { differs, visible } from '../util/pixels';
import { hash, rng } from './rng';

// Everything that stands on the ground: buildings, props, trees (with their ground shadow and tufts), the fence,
// lamps (+ night glow) and looping effects. Each object's manifest anchor sits on the top corner of its tile
// (col, row); flipped objects mirror the anchor (x → width − x).
//
// Depth: the front corner of the footprint, (col + cols + row + rows) × 8. That alone goes wrong beside big
// footprints (someone standing at a 3×3 building's SW wall has a smaller front corner than the building), so
// anything overlapping a big object on screen is also checked with the footprint rule: entirely past its far
// col/row → in front; entirely before its col/row → behind. See BigObject / sortAgainstBig.

/** Buildings that get a looping coin sparkle. */
const SPARKLE_BUILDINGS = ['jackpot-booth', 'bank', 'rewards-shop'];

export interface Building {
  id: string;
  obj: MapObject;
  sprite: Phaser.GameObjects.Image; // its image (the arena's front layer)
  /** Every image of it that can be clicked (the arena: its back and front layers). */
  parts: Phaser.GameObjects.Image[];
  depth: number;
  doors: Vec2[]; // [col, row]
  top: { x: number; y: number }; // centre top: the image's centre, its highest visible pixel (both layers if hollow)
}

/** A fence piece's key in WorldObjects.fencePieces: `nw:col,row`, `ne:col,row` or `post:col,row`. */
export type FenceKey = string;

export interface Bench {
  col: number;
  row: number;
  faces: Dir; // se | sw | ne | nw
  depth: number;
  sprite: Phaser.GameObjects.Image; // clickable (left click: sit)
}

export interface Lamp {
  sprite: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  /** Whether it shows lamp-on (with its glow) right now. */
  lit: boolean;
  /** An unreliable lamp (some are): now and then it flickers, or goes out for a while. */
  faulty?: Fault;
}

/** A faulty lamp's next trouble, and the trouble it's in. */
interface Fault {
  next: number; // when the next trouble starts (ms, scene time; 0 = not planned yet)
  mode: 'flicker' | 'out' | null;
  until: number;
  toggleAt: number;
  dark: boolean;
}

/** Share of lamps that are faulty (seeded by position), and how they misbehave at night. */
const FAULTY_LAMPS = 0.2;
const FAULT_EVERY: Vec2 = [10_000, 45_000]; // ms between troubles
const FLICKER_MS: Vec2 = [400, 1300];
const OUT_MS: Vec2 = [3_000, 20_000];
const OUT_CHANCE = 0.3; // of a trouble being a blackout rather than a flicker
const between = ([a, b]: Vec2) => a + Math.random() * (b - a);

/** A footprint bigger than one tile, for the in-front/behind check. */
interface BigObject {
  col: number;
  row: number;
  cols: number;
  rows: number;
  back: number; // depth of its rear-most layer (= front for single images)
  front: number; // depth of its front-most layer
  bounds: Phaser.Geom.Rectangle;
}

export class WorldObjects {
  /** Every world sprite except lamp glows, for the day/night tint. */
  readonly sprites: Phaser.GameObjects.Image[] = [];
  /** Sprites that can be hidden while off screen (everything except glows). */
  readonly cullable: Phaser.GameObjects.Image[] = [];
  readonly buildings: Building[] = [];
  /** Every fence piece drawn, by edge and tile (a Bakod's pieces turn rusty for a moment: ui/bakod-fx.ts). */
  readonly fencePieces = new Map<FenceKey, Phaser.GameObjects.Image>();
  readonly benches: Bench[] = [];
  readonly lamps: Lamp[] = [];
  private readonly big: BigObject[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly M: Manifest,
    private readonly map: TownMap,
  ) {
    // Big objects first, so smaller ones can be sorted against them.
    const isBig = (o: MapObject) => o.footprint[0] * o.footprint[1] > 1;
    const ordered = [...map.objects.filter(isBig), ...map.objects.filter((o) => !isBig(o))];
    for (const o of ordered) {
      if (o.kind === 'building') this.addBuilding(o);
      else this.addProp(o);
    }
    this.addFence();
  }

  /** The outskirts' trees and undergrowth (world/outskirts.ts), after the town's own objects. */
  addOutskirts(objects: MapObject[]): void {
    for (const o of objects) this.addProp(o);
  }

  private track<T extends Phaser.GameObjects.Image>(img: T): T {
    this.sprites.push(img);
    this.cullable.push(img);
    return img;
  }

  /** Places an image so the pixel `anchor` lands on the top corner of tile (col, row). */
  private place(key: string, col: number, row: number, anchor: Vec2, flip = false, frame?: number): Phaser.GameObjects.Image {
    const top = tileToScreen(col, row);
    if (!this.scene.textures.exists(key)) assetProblems.add(`texture not loaded: ${key}`);
    const img = this.scene.add.image(top.x, top.y, key, frame);
    // Pixel anchors are measured on the real image (frame) size.
    const w = img.frame.width;
    const h = img.frame.height;
    img.setOrigin((flip ? w - anchor[0] : anchor[0]) / w, anchor[1] / h).setFlipX(flip);
    return this.track(img);
  }

  /**
   * Front-corner depth. When only part of the footprint is solid (the notice board's back row), sort by the
   * front-most blocked tile, so someone standing on the open part is drawn in front.
   */
  private depthFor(o: MapObject): number {
    const [fc, fr] = o.footprint;
    let best = -1;
    let anyOpen = false;
    for (let dc = 0; dc < fc; dc++) {
      for (let dr = 0; dr < fr; dr++) {
        if (this.map.blocked[o.row + dr]?.[o.col + dc]) best = Math.max(best, (o.col + dc + 1 + o.row + dr + 1) * 8);
        else anyOpen = true;
      }
    }
    // A partly-open footprint that isn't hollow (hollow ones — the arena — use layers instead).
    return anyOpen && best >= 0 && o.footprint[0] <= 2 ? best : frontDepth(o.col, o.row, fc, fr);
  }

  /**
   * Corrects a depth for something with footprint (col, row, cols × rows) and screen bounds, against every big
   * object it overlaps on screen.
   */
  sortAgainstBig(col: number, row: number, cols: number, rows: number, depth: number, bounds: Phaser.Geom.Rectangle, bias = 0.25): number {
    let d = depth;
    for (const b of this.big) {
      if (b.col === col && b.row === row && b.cols === cols && b.rows === rows) continue; // itself
      if (!Phaser.Geom.Rectangle.Overlaps(b.bounds, bounds)) continue;
      if (col >= b.col + b.cols || row >= b.row + b.rows) d = Math.max(d, b.front + bias); // in front
      else if (col + cols <= b.col || row + rows <= b.row) d = Math.min(d, b.back - bias); // behind
      else if (b.back !== b.front) d = Math.min(Math.max(d, b.back + bias), b.front - bias); // inside a hollow one
    }
    return d;
  }

  private addBuilding(o: MapObject): void {
    const def: BuildingDef & { layers?: { back?: string; front?: string } } = this.M.buildings[o.id];
    if (!def) return console.warn(`[town] unknown building ${o.id}`);
    const [fc, fr] = o.footprint;
    const front = this.depthFor(o);
    let sprite: Phaser.GameObjects.Image;
    let parts: Phaser.GameObjects.Image[];
    let back = front;
    let extent: Phaser.Geom.Rectangle;
    let roof: number;
    if (def.layers?.back && def.layers.front) {
      // Hollow building (the arena): the back layer at the footprint's top corner, the front layer at the front
      // corner, so players on the sand go behind the front rim.
      back = (o.col + o.row) * 8;
      const rear = this.place(def.layers.back, o.col, o.row, def.footprintTopCorner, o.flip).setDepth(back);
      sprite = this.place(def.layers.front, o.col, o.row, def.footprintTopCorner, o.flip).setDepth(front);
      parts = [rear, sprite];
      extent = Phaser.Geom.Rectangle.Union(rear.getBounds(), sprite.getBounds());
      roof = Math.min(visibleTop(this.scene, rear), visibleTop(this.scene, sprite));
    } else {
      sprite = this.place(def.file, o.col, o.row, def.footprintTopCorner, o.flip).setDepth(front);
      parts = [sprite];
      extent = sprite.getBounds();
      roof = visibleTop(this.scene, sprite);
    }
    this.big.push({ col: o.col, row: o.row, cols: fc, rows: fr, back, front, bounds: sprite.getBounds(new Phaser.Geom.Rectangle()) });
    const raw = this.map.doors[o.id];
    const doors: Vec2[] = !raw ? [] : Array.isArray(raw[0]) ? (raw as Vec2[]) : [raw as Vec2];
    this.buildings.push({ id: o.id, obj: o, sprite, parts, depth: front, doors, top: { x: extent.centerX, y: roof } });
    if (SPARKLE_BUILDINGS.includes(o.id)) this.sparkle(sprite, front);
  }

  private addProp(o: MapObject): void {
    const def = this.M.props[o.id] as PropDef | undefined;
    if (!def?.file) return console.warn(`[town] unknown prop ${o.id}`);
    const [fc, fr] = o.footprint;
    let sprite: Phaser.GameObjects.Image;
    if (o.animated && def.animation) {
      // Looping animation in place of the still (same anchor and footprint).
      const s = this.scene.add.sprite(0, 0, def.animation.file, 0);
      const top = tileToScreen(o.col, o.row);
      const w = s.frame.width;
      s.setPosition(top.x, top.y).setOrigin((o.flip ? w - def.anchor[0] : def.anchor[0]) / w, def.anchor[1] / s.frame.height).setFlipX(!!o.flip);
      const key = `anim:${def.animation.file}`;
      if (!this.scene.anims.exists(key)) {
        this.scene.anims.create({
          key,
          frames: this.scene.anims.generateFrameNumbers(def.animation.file, { start: 0, end: def.animation.frames - 1 }),
          frameRate: def.animation.fps,
          repeat: def.animation.loop === false ? 0 : -1,
        });
      }
      s.play(key);
      sprite = this.track(s);
    } else {
      sprite = this.place(def.file, o.col, o.row, def.anchor, o.flip);
    }
    const base = this.depthFor(o);
    const bounds = sprite.getBounds(new Phaser.Geom.Rectangle());
    const big = fc * fr > 1;
    const depth = big ? base : this.sortAgainstBig(o.col, o.row, fc, fr, base, bounds);
    sprite.setDepth(depth);
    if (big) this.big.push({ col: o.col, row: o.row, cols: fc, rows: fr, back: depth, front: depth, bounds });

    // Trees: a shadow on the ground under the trunk, and a tufts strip just in front of the trunk base.
    const centre = tileToScreen(o.col, o.row);
    centre.y += 8; // trunk tile centre
    if (o.shadow) this.track(this.scene.add.image(centre.x + (o.flip ? -5 : 5), centre.y + 1, o.shadow).setDepth(GROUND_SHADOW_DEPTH));
    if (o.tufts) this.track(this.scene.add.image(centre.x - 10, centre.y - 5, o.tufts).setOrigin(0, 0).setDepth(depth + 0.01));

    if (def.faces) this.benches.push({ col: o.col, row: o.row, faces: def.faces.toLowerCase() as Dir, depth, sprite });
    if (o.id === 'lamp-off' || o.id === 'lamp-on') this.addLamp(sprite);
  }

  /** Lamp glow, centred on the lantern: found by comparing the lit and unlit sprites pixel by pixel. */
  private addLamp(sprite: Phaser.GameObjects.Image): void {
    const on = this.M.props['lamp-on'] as PropDef;
    const glowFile = on.glow?.file ?? 'fx/fx-lamp-glow.png';
    const lantern = lanternOffset(this.scene, this.M);
    const glow = this.scene.add
      .image(sprite.x + lantern.x, sprite.y + lantern.y, glowFile)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(GLOW_DEPTH)
      .setVisible(false);
    const faulty = rng(hash(Math.round(sprite.x), Math.round(sprite.y), 41))() < FAULTY_LAMPS;
    this.lamps.push({ sprite, glow, lit: false, ...(faulty ? { faulty: { next: 0, mode: null, until: 0, toggleAt: 0, dark: false } } : {}) });
  }

  /** Dusk to dawn: lamp-on + glow (only for lamps on screen); by day: lamp-off. With the scene's `time` (each frame),
   *  faulty lamps act up at night. */
  setLamps(on: boolean, time?: number): void {
    const onKey = this.M.props['lamp-on'].file;
    const offKey = this.M.props['lamp-off'].file;
    for (const l of this.lamps) {
      const f = l.faulty;
      if (f) {
        if (on && time !== undefined) this.fault(f, time);
        else if (!on) Object.assign(f, { next: 0, mode: null, dark: false }); // daylight fixes everything
      }
      const lit = on && !f?.dark;
      if (lit !== l.lit) {
        l.lit = lit;
        l.sprite.setTexture(lit ? onKey : offKey);
      }
      l.glow.setVisible(lit && l.sprite.visible);
    }
  }

  /** A faulty lamp's night: fine for a while, then a flicker (rapid on/off) or a blackout that sputters back on. */
  private fault(f: Fault, time: number): void {
    if (!f.next) f.next = time + between(FAULT_EVERY);
    if (!f.mode) {
      if (time < f.next) return;
      const out = Math.random() < OUT_CHANCE;
      f.mode = out ? 'out' : 'flicker';
      f.until = time + between(out ? OUT_MS : FLICKER_MS);
      f.toggleAt = time;
    }
    if (time >= f.until) {
      if (f.mode === 'out') {
        f.mode = 'flicker'; // coming back: a short sputter first
        f.until = time + between([300, 800]);
      } else {
        f.mode = null;
        f.dark = false;
        f.next = time + between(FAULT_EVERY);
      }
      return;
    }
    if (f.mode === 'out') f.dark = true;
    else if (time >= f.toggleAt) {
      f.dark = !f.dark;
      f.toggleAt = time + 40 + Math.random() * (f.dark ? 90 : 160); // dark blinks shorter than lit ones
    }
  }

  private sparkle(sprite: Phaser.GameObjects.Image, depth: number): void {
    const fx = this.M.fx['coin-sparkle'];
    if (!fx?.file) return;
    const key = `anim:${fx.file}`;
    if (!this.scene.anims.exists(key)) {
      this.scene.anims.create({ key, frames: this.scene.anims.generateFrameNumbers(fx.file, { start: 0, end: (fx.frames ?? 1) - 1 }), frameRate: fx.fps ?? 10, repeat: -1 });
    }
    const b = sprite.getBounds();
    const s = this.scene.add.sprite(Math.round(b.centerX), Math.round(b.top - 2), fx.file).setDepth(depth + 0.1);
    s.play(key);
    this.track(s);
  }

  /**
   * Fence pieces on tile back edges (nw = top-left edge, ne = top-right edge), drawn before characters on that
   * tile. Open run ends get a post: a corner point used by only one fence piece.
   */
  private addFence(): void {
    const F = this.M.props.fence;
    if (!F || !this.map.fence?.length) return;
    const corners = new Map<string, number>(); // tile top-corner points as "col,row"
    const bump = (c: number, r: number) => corners.set(`${c},${r}`, (corners.get(`${c},${r}`) ?? 0) + 1);
    const fenceDepth = (c: number, r: number) => (c + r) * 8 + 8.75; // after characters behind, before characters on it
    const put = (key: string, c: number, r: number) => {
      const top = tileToScreen(c, r);
      const img = this.scene.add.image(top.x, top.y + 8, key);
      img.setOrigin(F.anchor[0] / F.size[0], F.anchor[1] / F.size[1]).setDepth(fenceDepth(c, r));
      this.track(img);
      return img;
    };
    for (const f of this.map.fence) {
      this.fencePieces.set(`${f.edge}:${f.col},${f.row}`, put(f.edge === 'nw' ? F.nw : F.ne, f.col, f.row));
      bump(f.col, f.row); // both edges start at the tile's top corner
      if (f.edge === 'nw') bump(f.col, f.row + 1); // …and end at its left corner (= top corner of the tile below-left)
      else bump(f.col + 1, f.row); // …or at its right corner
    }
    for (const [key, n] of corners) {
      if (n !== 1) continue;
      const [c, r] = key.split(',').map(Number);
      this.fencePieces.set(`post:${c},${r}`, put(F.post, c, r));
    }
  }
}

/** A character's depth: the front corner of its tile, corrected against big objects it overlaps. */
export const characterDepth = (objects: WorldObjects, col: number, row: number, feetDepth: number, bounds: Phaser.Geom.Rectangle) =>
  objects.sortAgainstBig(col, row, 1, 1, feetDepth, bounds, CHARACTER_BIAS);

function readPixels(scene: Phaser.Scene, key: string): ImageData {
  const img = scene.textures.get(key).getSourceImage() as HTMLImageElement;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
}

/** Screen y of an image's first row with any visible pixel (the roof, not the empty space above it). */
function visibleTop(scene: Phaser.Scene, img: Phaser.GameObjects.Image): number {
  const d = readPixels(scene, img.texture.key);
  for (let y = 0; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) if (visible(d.data[(y * d.width + x) * 4 + 3])) return img.getBounds().top + y;
  }
  return img.getBounds().top;
}

let lanternCache: { x: number; y: number } | null = null;

/** Offset from a lamp's anchor point to the centre of its lantern (pixels that differ between lamp-on and lamp-off). */
function lanternOffset(scene: Phaser.Scene, M: Manifest): { x: number; y: number } {
  if (lanternCache) return lanternCache;
  const on = M.props['lamp-on'] as PropDef;
  const off = M.props['lamp-off'] as PropDef;
  const a = readPixels(scene, on.file);
  const b = readPixels(scene, off.file);
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (differs(a.data, b.data, i)) {
        sx += x + 0.5;
        sy += y + 0.5;
        n++;
      }
    }
  }
  if (!n) console.warn('[town] lamp-on and lamp-off are identical; glow centred on the sprite');
  const cx = n ? sx / n : a.width / 2;
  const cy = n ? sy / n : a.height / 2;
  lanternCache = { x: Math.round(cx - on.anchor[0]), y: Math.round(cy - on.anchor[1]) };
  return lanternCache;
}
