import Phaser from 'phaser';
import type { Dir, Manifest, MapObject, PropDef, TownMap, Vec2 } from '../assets/types';
import { tileToScreen } from '../iso';
import { GLOW_DEPTH, GROUND_SHADOW_DEPTH, frontDepth } from './depth';

// Everything that stands on the ground: buildings, props, trees (with their ground shadow and tufts), the fence,
// lamps (+ night glow) and looping effects. Each object's manifest anchor sits on the top corner of its tile
// (col, row); flipped objects mirror the anchor (x → width − x).

/** Buildings that get a looping coin sparkle. */
const SPARKLE_BUILDINGS = ['jackpot-booth', 'bank', 'rewards-shop'];

export interface Building {
  id: string;
  obj: MapObject;
  sprite: Phaser.GameObjects.Image;
  depth: number;
  doors: Vec2[]; // [col, row]
}

export interface Bench {
  col: number;
  row: number;
  faces: Dir; // se | sw | ne | nw
  depth: number;
}

export interface Lamp {
  sprite: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
}

/** A walkable tile strictly inside a building's footprint (the arena floor): characters there draw over it. */
export interface Interior {
  building: Building;
  depth: number;
}

export class WorldObjects {
  /** Every world sprite except lamp glows, for the day/night tint. */
  readonly sprites: Phaser.GameObjects.Image[] = [];
  readonly buildings: Building[] = [];
  readonly benches: Bench[] = [];
  readonly lamps: Lamp[] = [];
  private readonly interiors = new Map<string, Interior>();
  private lampsOn = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly M: Manifest,
    private readonly map: TownMap,
  ) {
    for (const o of map.objects) {
      if (o.kind === 'building') this.addBuilding(o);
      else this.addProp(o);
    }
    this.addFence();
  }

  /** The interior entry for a walkable tile inside a building (e.g. the arena's sand floor), if any. */
  interiorAt(col: number, row: number): Interior | undefined {
    return this.interiors.get(`${col},${row}`);
  }

  /** Places an image so the pixel `anchor` lands on the top corner of tile (col, row). */
  private place(key: string, col: number, row: number, anchor: Vec2, flip = false, frame?: number): Phaser.GameObjects.Image {
    const top = tileToScreen(col, row);
    const img = this.scene.add.image(top.x, top.y, key, frame);
    // Pixel anchors are measured on the real image (frame) size.
    const w = img.frame.width;
    const h = img.frame.height;
    img.setOrigin((flip ? w - anchor[0] : anchor[0]) / w, anchor[1] / h).setFlipX(flip);
    this.sprites.push(img);
    return img;
  }

  /**
   * Sort depth: the front corner of the footprint. When only part of the footprint is solid (the notice board's
   * back row), sort by the front-most blocked tile, so someone standing on the open part is drawn in front.
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
    return anyOpen && best >= 0 ? best : frontDepth(o.col, o.row, fc, fr);
  }

  private addBuilding(o: MapObject): void {
    const def = this.M.buildings[o.id];
    if (!def) return console.warn(`[town] unknown building ${o.id}`);
    const sprite = this.place(def.file, o.col, o.row, def.footprintTopCorner, o.flip);
    const depth = this.depthFor(o);
    sprite.setDepth(depth);
    const raw = this.map.doors[o.id];
    const doors: Vec2[] = !raw ? [] : Array.isArray(raw[0]) ? (raw as Vec2[]) : [raw as Vec2];
    const building: Building = { id: o.id, obj: o, sprite, depth, doors };
    this.buildings.push(building);
    // Walkable tiles strictly inside the footprint (the arena's sand floor).
    const [fc, fr] = o.footprint;
    for (let dc = 1; dc < fc - 1; dc++) {
      for (let dr = 1; dr < fr - 1; dr++) {
        const c = o.col + dc;
        const r = o.row + dr;
        if (!this.map.blocked[r]?.[c]) this.interiors.set(`${c},${r}`, { building, depth });
      }
    }
    if (SPARKLE_BUILDINGS.includes(o.id)) this.sparkle(sprite, depth);
  }

  private addProp(o: MapObject): void {
    const def = this.M.props[o.id] as PropDef | undefined;
    if (!def?.file) return console.warn(`[town] unknown prop ${o.id}`);
    const depth = this.depthFor(o);
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
      this.sprites.push(s);
      sprite = s;
    } else {
      sprite = this.place(def.file, o.col, o.row, def.anchor, o.flip);
    }
    sprite.setDepth(depth);

    // Trees: a shadow on the ground under the trunk, and a tufts strip just in front of the trunk base.
    const centre = tileToScreen(o.col, o.row);
    centre.y += 8; // trunk tile centre
    if (o.shadow) {
      const shadow = this.scene.add.image(centre.x + (o.flip ? -5 : 5), centre.y + 1, o.shadow).setDepth(GROUND_SHADOW_DEPTH);
      this.sprites.push(shadow);
    }
    if (o.tufts) {
      const tufts = this.scene.add.image(centre.x - 10, centre.y - 5, o.tufts).setOrigin(0, 0).setDepth(depth + 0.01);
      this.sprites.push(tufts);
    }

    if (def.faces) this.benches.push({ col: o.col, row: o.row, faces: def.faces.toLowerCase() as Dir, depth });
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
    this.lamps.push({ sprite, glow });
  }

  /** Dusk to dawn: lamp-on + glow; by day: lamp-off. */
  setLamps(on: boolean): void {
    if (on === this.lampsOn) return;
    this.lampsOn = on;
    const key = (on ? this.M.props['lamp-on'] : this.M.props['lamp-off']).file;
    for (const l of this.lamps) {
      l.sprite.setTexture(key);
      l.glow.setVisible(on);
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
    this.sprites.push(s);
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
    for (const f of this.map.fence) {
      const top = tileToScreen(f.col, f.row);
      const img = this.scene.add.image(top.x, top.y + 8, f.edge === 'nw' ? F.nw : F.ne);
      img.setOrigin(F.anchor[0] / F.size[0], F.anchor[1] / F.size[1]).setDepth(fenceDepth(f.col, f.row));
      this.sprites.push(img);
      bump(f.col, f.row); // both edges start at the tile's top corner
      if (f.edge === 'nw') bump(f.col, f.row + 1); // …and end at its left corner (= top corner of the tile below-left)
      else bump(f.col + 1, f.row); // …or at its right corner
    }
    for (const [key, n] of corners) {
      if (n !== 1) continue;
      const [c, r] = key.split(',').map(Number);
      const top = tileToScreen(c, r);
      const post = this.scene.add.image(top.x, top.y + 8, F.post);
      post.setOrigin(F.anchor[0] / F.size[0], F.anchor[1] / F.size[1]).setDepth(fenceDepth(c, r));
      this.sprites.push(post);
    }
  }
}

let lanternCache: { x: number; y: number } | null = null;

/** Offset from a lamp's anchor point to the centre of its lantern (pixels that differ between lamp-on and lamp-off). */
function lanternOffset(scene: Phaser.Scene, M: Manifest): { x: number; y: number } {
  if (lanternCache) return lanternCache;
  const on = M.props['lamp-on'] as PropDef;
  const off = M.props['lamp-off'] as PropDef;
  const read = (key: string) => {
    const img = scene.textures.get(key).getSourceImage() as HTMLImageElement;
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, img.width, img.height);
  };
  const a = read(on.file);
  const b = read(off.file);
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) {
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
