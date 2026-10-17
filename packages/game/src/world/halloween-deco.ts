// 🕸️ The Halloween decorations (CONTEXT.md Decoration, Event look, Kapre): looks only, no collision, nothing to click,
// and only while the event is on (the server's `halloween` view; dev's ?halloween=on forces it there). Their art loads
// the first time the event is on (one pack of its own in builds), and everything goes when it ends.
//   • Event looks: each building's picture swapped for its Halloween one (manifest halloweenDeco.buildings, by file);
//     clicks still test the normal picture's pixels, so a cobweb never becomes a door. A missing one keeps the normal.
//   • Webs and spiders on props (props/halloween/halloween-deco.json): a web the prop's size at its position, anchor and
//     flip, just above it; a dangling spider tied at its attach point, just in front, each from a random frame. Matched
//     by manifest key or by the prop's file name (the deco's town-lantern-post is the lantern-post prop). Lamps keep their
//     web and spider as they switch on and off. Only the map's own objects, never the outskirts' forest.
//   • Neighbourhood houses (buildings/houses/house-halloween-deco.json): the type's fixed-colour top layer over the house,
//     its spiders, and bats for some houses (shared `houseBats`: one stable hash of the event and the lot).
//   • In town: the bat flocks (events/halloween.json townBats), the extra cobwebs (webSpots) and the Kapre (kapre.json):
//     one, in the tree shared `kapreTree` picks from the server's clock, moving every half hour with a quick fade.
// Spiders, bats and the Kapre aren't drawn past `decorationNearTiles` from you; the webs always are.

import Phaser from 'phaser';
import { type HalloweenData, houseBats, kapreSlot, kapreTree, kapreTrees, seeded } from '@mikazuki/shared';
import type { Manifest, PropDef, TownMap, Vec2 } from '../assets/types';
import { queueImage, queueSheet } from '../assets/queue';
import { slice } from '../assets/packs';
import { tileToScreen } from '../iso';
import { frontDepth } from './depth';
import type { WorldObjects } from './objects';

type Img = Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;

interface SpiderSheet {
  file: string;
  cell: Vec2;
  frames: number;
  fps: number;
  attach: Vec2;
}
interface DecoJson {
  spiderSheets: Record<string, SpiderSheet>;
  props: Record<string, { web: string; size: Vec2; spider?: { attach: Vec2; sheet: string } }>;
}
interface HouseDecoJson {
  bat: { file: string; cell: Vec2; frames: number; fps: number };
  batChance: number;
  batCount: [number, number];
  houses: Record<string, { layer: string; spiders?: { attach: Vec2; sheet: string }[]; bats?: { centre: Vec2; radius: Vec2 } }>;
}
interface KapreJson {
  kapre: {
    sheet: string;
    sheetMirrored: string;
    cell: Vec2;
    frames: number;
    fps: number;
    trees: Record<string, { side: 'e' | 'w'; offset: Vec2; leaves?: string }>;
    placement: { kapres: number; hopMinutes: number };
  };
}

/** A prop's web and spider: its prop's name now (a lamp's changes), its tile. */
interface PropDecor {
  name: string;
  col: number;
  row: number;
  web: Phaser.GameObjects.Image;
  spider: Phaser.GameObjects.Sprite | null;
}

/** A bat on its ellipse: round a centre (world px), its own pace and starting point, its own tile for the distance. */
interface Bat {
  sprite: Phaser.GameObjects.Sprite;
  centre: () => { x: number; y: number } | null;
  radius: Vec2;
  speed: number;
  angle: number;
  col: number;
  row: number;
}

/** A house's layer, spiders and bats. */
interface HouseDecor {
  layer: Phaser.GameObjects.Image | null;
  spiders: Phaser.GameObjects.Sprite[];
  bats: Bat[];
  col: number;
  row: number;
}

/** What the scene tells the decorations. */
export interface DecorHooks {
  /** This page's area ('town', 'slums', 'hood', 'warrens'). */
  area: string;
  data: HalloweenData;
  /** Your tile now (for the distance). */
  me: () => { col: number; row: number };
  /** The server's clock (ms). */
  now: () => number;
  /** A neighbourhood house by building id: its lot and type. */
  houseOf: (buildingId: string) => { lot: number; style: string } | null;
}

/** How often new props and houses are looked for (a streamed map's come and go). */
const SCAN_MS = 500;
/** Just above what they're on: a web over its prop, a spider in front, the Kapre, his leaves. */
const WEB_BUMP = 0.001;
const SPIDER_BUMP = 0.002;
const KAPRE_BUMP = 0.003;
const LEAVES_BUMP = 0.004;
const BAT_BUMP = 0.003;
/** Town bats over a building: well in front of its roof. */
const FLOCK_BUMP = 0.5;
/** The Kapre's hop: out, then in (ms each way). */
const HOP_FADE_MS = 400;
/** A bat's pace round its ellipse (radians a second), and how much it varies bat to bat. */
const BAT_SPEED = 1.5;
const BAT_SPREAD = 0.6;

export class HalloweenDecor {
  /** The night's tint on what's made (the scene's). */
  onSpawn: (obj: Img) => void = () => {};

  private on = false;
  private asked = false;
  private queued = false;
  private deco: DecoJson | null = null;
  private houseDeco: HouseDecoJson | null = null;
  private kapreData: KapreJson['kapre'] | null = null;
  /** Building pictures swapped for their event look: the normal key and its click test. */
  private readonly looks = new Map<Img, { normal: string; hit: Phaser.Types.Input.HitAreaCallback | undefined }>();
  private readonly props = new Map<Img, PropDecor>();
  private readonly houses = new Map<Img, HouseDecor>();
  private flocks: Bat[] = [];
  private spots: Phaser.GameObjects.Image[] = [];
  private kapre: { sprite: Phaser.GameObjects.Sprite; leaves: Phaser.GameObjects.Image | null; tree: Img | null; slot: number; col: number; row: number } | null = null;
  private scanAt = 0;
  /** Each prop texture's prop name (its still and its animation), for the props that have a deco. */
  private propOf: Map<string, string> | null = null;
  /** The map's own props by tile, as drawn (the Kapre's trees). */
  private readonly byTile = new Map<string, Img>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly M: Manifest,
    private readonly map: TownMap,
    private readonly objects: WorldObjects,
    private readonly hooks: DecorHooks,
  ) {}

  /** The event on or off (the server's word): on, its art loads (once) and it's all put up; off, it all comes down. */
  setOn(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    if (!on) return this.clear();
    this.scanAt = 0;
    if (this.asked || !this.M.halloweenDeco) return;
    this.asked = true;
    const L = this.scene.load;
    const D = this.M.halloweenDeco;
    for (const [key, file] of [['hw-deco', D.props], ['hw-houses', D.houses], ['hw-kapre', D.kapre]]) if (!this.scene.cache.json.exists(key)) L.json(key, file);
    if (!L.isLoading()) L.start();
  }

  get active(): boolean {
    return this.on;
  }

  /** Once the jsons are in: every picture they name, in the background (one pack in builds). */
  private queueArt(): void {
    const D = this.M.halloweenDeco!;
    const L = this.scene.load;
    const T = this.scene.textures;
    for (const f of Object.values(D.buildings)) queueImage(L, T, f);
    for (const p of Object.values(this.deco?.props ?? {})) queueImage(L, T, p.web);
    for (const s of Object.values(this.deco?.spiderSheets ?? {})) queueSheet(L, T, s.file, s.cell[0], s.cell[1]);
    if (this.hooks.area === 'town') {
      const K = this.kapreData;
      if (K) {
        for (const f of [K.sheet, K.sheetMirrored]) queueSheet(L, T, f, K.cell[0], K.cell[1]);
        for (const t of Object.values(K.trees)) if (t.leaves) queueImage(L, T, t.leaves);
      }
      for (const w of new Set(this.hooks.data.webSpots.map((s) => s.web))) if (D.webs[w]) queueImage(L, T, D.webs[w].file);
    }
    if (this.hooks.area === 'hood') for (const h of Object.values(this.houseDeco?.houses ?? {})) queueImage(L, T, h.layer);
    const B = this.houseDeco?.bat;
    if (B && (this.hooks.area === 'town' || this.hooks.area === 'hood')) queueSheet(L, T, B.file, B.cell[0], B.cell[1]);
    if (!L.isLoading()) L.start();
  }

  /** A looping sheet's animation (made once its texture is in), or null while it isn't. */
  private anim(file: string, cell: Vec2, frames: number, fps: number): string | null {
    const key = `hw-deco:${file}`;
    if (this.scene.anims.exists(key)) return key;
    if (!this.scene.textures.exists(file)) return null;
    slice(this.scene.textures, file, cell[0], cell[1]);
    this.scene.anims.create({ key, frames: this.scene.anims.generateFrameNumbers(file, { start: 0, end: frames - 1 }), frameRate: fps, repeat: -1 });
    return key;
  }

  /** A looping sprite from a random frame (so neighbours never bob in step). */
  private looping(file: string, cell: Vec2, frames: number, fps: number): Phaser.GameObjects.Sprite | null {
    const key = this.anim(file, cell, frames, fps);
    if (!key) return null;
    const s = this.scene.add.sprite(0, 0, file, 0);
    s.play({ key, startFrame: Math.floor(Math.random() * frames) });
    this.onSpawn(s);
    return s;
  }

  update(deltaMs: number): void {
    if (!this.on) return;
    if (!this.deco) this.deco = (this.scene.cache.json.get('hw-deco') as DecoJson | undefined) ?? null;
    if (!this.houseDeco) this.houseDeco = (this.scene.cache.json.get('hw-houses') as HouseDecoJson | undefined) ?? null;
    if (!this.kapreData) this.kapreData = (this.scene.cache.json.get('hw-kapre') as KapreJson | undefined)?.kapre ?? null;
    if (!this.deco || !this.houseDeco || !this.kapreData) return;
    if (!this.queued) {
      this.queued = true;
      this.queueArt();
    }
    const now = this.scene.time.now;
    if (now >= this.scanAt) {
      this.scanAt = now + SCAN_MS;
      this.dressBuildings();
      this.scanProps();
      if (this.hooks.area === 'hood') this.scanHouses();
      if (this.hooks.area === 'town') {
        this.makeSpots();
        this.makeFlocks();
      }
    }
    const me = this.hooks.me();
    const near = (col: number, row: number) => Math.max(Math.abs(col - me.col), Math.abs(row - me.row)) <= this.hooks.data.decorationNearTiles;
    for (const [base, d] of this.props) this.syncProp(base, d, near(d.col, d.row));
    for (const [base, h] of this.houses) this.syncHouse(base, h, near(h.col, h.row), deltaMs);
    for (const b of this.flocks) this.flyBat(b, near(b.col, b.row), deltaMs);
    if (this.hooks.area === 'town') this.syncKapre(near);
  }

  // ── Event looks ──

  /** Every building picture with an event look: swapped in once that look is loaded (its click test kept). */
  private dressBuildings(): void {
    const D = this.M.halloweenDeco!;
    for (const b of this.objects.buildings) {
      for (const part of b.parts) {
        if (this.looks.has(part)) continue;
        const normal = part.texture.key;
        const look = D.buildings[normal];
        if (!look || !this.scene.textures.exists(look)) continue;
        const hit = part.input?.hitAreaCallback;
        this.looks.set(part, { normal, hit });
        part.setTexture(look);
        // (Clicks test the normal picture's pixels: the cobwebs drawn in never become part of a door.)
        if (part.input) part.input.hitAreaCallback = (_area, x, y) => (this.scene.textures.getPixelAlpha(x, y, normal, '__BASE') ?? 0) >= 1;
      }
    }
  }

  // ── Props: webs and spiders ──

  /** Texture → prop name, for every prop with a deco (by manifest key, or by its file's name). */
  private propNames(): Map<string, string> {
    if (this.propOf) return this.propOf;
    const out = new Map<string, string>();
    const deco = this.deco!.props;
    for (const [id, p] of Object.entries(this.M.props)) {
      const def = p as PropDef;
      if (!def?.file) continue;
      const fileName = def.file.split('/').pop()!.replace(/^prop-/, '').replace(/\.png$/, '');
      const name = deco[id] ? id : deco[fileName] ? fileName : null;
      if (!name) continue;
      out.set(def.file, name);
      if (def.animation?.file) out.set(def.animation.file, name);
    }
    return (this.propOf = out);
  }

  /** The tile a map object's picture was put at (its top corner; flat or raised ground alike, near enough). */
  private tileOf(img: Img): { col: number; row: number } {
    const u = img.x / 16;
    const v = img.y / 8;
    return { col: Math.round((v + u) / 2), row: Math.round((v - u) / 2) };
  }

  private inMap(col: number, row: number): boolean {
    return col >= 0 && row >= 0 && col < this.map.size[0] && row < this.map.size[1];
  }

  /** New props with a deco get theirs; gone ones (a streamed region dropped) lose theirs. */
  private scanProps(): void {
    for (const [base, d] of this.props) if (!base.scene) this.dropProp(base, d);
    const names = this.propNames();
    for (const base of this.objects.sprites) {
      if (this.props.has(base) || !base.scene) continue;
      const name = names.get(base.texture.key);
      if (!name) continue;
      const { col, row } = this.tileOf(base);
      if (!this.inMap(col, row)) continue; // (the outskirts' forest: none)
      this.byTile.set(`${col},${row}`, base);
      const P = this.deco!.props[name];
      if (!this.scene.textures.exists(P.web)) continue; // (next look, once it's in)
      const web = this.scene.add.image(base.x, base.y, P.web);
      this.onSpawn(web);
      const S = P.spider && this.deco!.spiderSheets[P.spider.sheet];
      const spider = S ? this.looping(S.file, S.cell, S.frames, S.fps) : null;
      if (spider && S) spider.setOrigin(S.attach[0] / S.cell[0], S.attach[1] / S.cell[1]);
      this.props.set(base, { name, col, row, web, spider });
    }
  }

  private dropProp(base: Img, d: PropDecor): void {
    d.web.destroy();
    d.spider?.destroy();
    this.props.delete(base);
  }

  /** A web on its prop as it's drawn (position, anchor, flip, depth; shown while it is), a lamp's as it switches; its
   *  spider at the attach point (mirrored with a flipped prop), near you only. */
  private syncProp(base: Img, d: PropDecor, near: boolean): void {
    const name = this.propNames().get(base.texture.key) ?? d.name;
    const P = this.deco!.props[name];
    if (name !== d.name) {
      d.name = name; // (a lamp switching on or off: the same web and spider, its own picture)
      if (this.scene.textures.exists(P.web)) d.web.setTexture(P.web);
    }
    const shown = base.visible && base.alpha > 0;
    d.web.setVisible(shown);
    if (shown) d.web.setPosition(base.x, base.y).setOrigin(base.originX, base.originY).setFlipX(base.flipX).setScale(base.scaleX, base.scaleY).setDepth(base.depth + WEB_BUMP);
    const s = d.spider;
    if (!s) return;
    s.setVisible(shown && near);
    if (!shown || !near || !P.spider) return;
    const at = this.pointOn(base, P.spider.attach);
    s.setPosition(at.x, at.y).setScale(base.scaleX, base.scaleY).setDepth(base.depth + SPIDER_BUMP);
  }

  /** A pixel of a picture (its own px from its top-left, as the art has it) in the world, as it's drawn (flipped too). */
  private pointOn(base: Img, [px, py]: Vec2): { x: number; y: number } {
    const w = base.frame.width;
    const left = base.x - base.originX * w * base.scaleX;
    const top = base.y - base.originY * base.frame.height * base.scaleY;
    return { x: left + (base.flipX ? w - px : px) * base.scaleX, y: top + py * base.scaleY };
  }

  // ── Neighbourhood houses ──

  private scanHouses(): void {
    for (const [base, h] of this.houses) if (!base.scene) this.dropHouse(base, h);
    const H = this.houseDeco!;
    for (const b of this.objects.buildings) {
      if (this.houses.has(b.sprite)) continue;
      const house = this.hooks.houseOf(b.id);
      const T = house && H.houses[house.style];
      if (!house || !T || !this.scene.textures.exists(T.layer)) continue;
      const layer = this.scene.add.image(b.sprite.x, b.sprite.y, T.layer);
      this.onSpawn(layer);
      const spiders: Phaser.GameObjects.Sprite[] = [];
      for (const sp of T.spiders ?? []) {
        const S = this.deco!.spiderSheets[sp.sheet];
        const s = S && this.looping(S.file, S.cell, S.frames, S.fps);
        if (!s || !S) continue;
        s.setOrigin(S.attach[0] / S.cell[0], S.attach[1] / S.cell[1]).setData('attach', sp.attach);
        spiders.push(s);
      }
      const bats: Bat[] = [];
      const n = T.bats ? houseBats(this.hooks.data.id, house.lot, H.batChance, H.batCount) : 0;
      for (let i = 0; i < n; i++) {
        const bat = this.makeBat(`${house.lot}:${i}`, () => (b.sprite.scene ? this.pointOn(b.sprite, T.bats!.centre) : null), T.bats!.radius, b.obj.col, b.obj.row);
        if (bat) bats.push(bat);
      }
      this.houses.set(b.sprite, { layer, spiders, bats, col: b.obj.col, row: b.obj.row });
    }
  }

  private dropHouse(base: Img, h: HouseDecor): void {
    h.layer?.destroy();
    h.spiders.forEach((s) => s.destroy());
    h.bats.forEach((b) => b.sprite.destroy());
    this.houses.delete(base);
  }

  /** The house's layer on top of it as it's drawn (a house rising, or cut while it rises: the layer waits), its spiders
   *  and bats near you only. */
  private syncHouse(base: Img, h: HouseDecor, near: boolean, deltaMs: number): void {
    const shown = base.visible && base.alpha > 0 && !base.isCropped;
    if (h.layer) {
      h.layer.setVisible(shown);
      if (shown) h.layer.setPosition(base.x, base.y).setOrigin(base.originX, base.originY).setFlipX(base.flipX).setScale(base.scaleX, base.scaleY).setAlpha(base.alpha).setDepth(base.depth + WEB_BUMP);
    }
    for (const s of h.spiders) {
      s.setVisible(shown && near);
      if (!shown || !near) continue;
      const at = this.pointOn(base, s.getData('attach') as Vec2);
      s.setPosition(at.x, at.y).setDepth(base.depth + SPIDER_BUMP);
    }
    for (const b of h.bats) {
      b.sprite.setDepth(base.depth + BAT_BUMP);
      this.flyBat(b, shown && near, deltaMs);
    }
  }

  // ── Bats ──

  /** A bat round `centre` on its ellipse: its pace and starting point from its own seed. */
  private makeBat(seed: string, centre: Bat['centre'], radius: Vec2, col: number, row: number): Bat | null {
    const B = this.houseDeco?.bat;
    const s = B && this.looping(B.file, B.cell, B.frames, B.fps);
    if (!s) return null;
    const speed = BAT_SPEED * (1 - BAT_SPREAD / 2 + seeded(`${seed}:pace`) * BAT_SPREAD) * (seeded(`${seed}:way`) < 0.5 ? -1 : 1);
    return { sprite: s, centre, radius, speed, angle: seeded(`${seed}:start`) * Math.PI * 2, col, row };
  }

  private flyBat(b: Bat, shown: boolean, deltaMs: number): void {
    b.angle += (b.speed * deltaMs) / 1000;
    const c = shown ? b.centre() : null;
    b.sprite.setVisible(!!c);
    if (c) b.sprite.setPosition(Math.round(c.x + Math.cos(b.angle) * b.radius[0]), Math.round(c.y + Math.sin(b.angle) * b.radius[1]));
  }

  /** The town's flocks (events/halloween.json townBats), once the bat's sheet is in: over a building or a tile. */
  private makeFlocks(): void {
    if (this.flocks.length || !this.houseDeco || !this.scene.textures.exists(this.houseDeco.bat.file)) return;
    this.hooks.data.townBats.forEach((f, k) => {
      const b = f.over ? this.objects.buildings.find((x) => x.id === f.over) : undefined;
      if (f.over && !b) return;
      const col = b ? b.obj.col : f.tile![0];
      const row = b ? b.obj.row : f.tile![1];
      const ground = b ? { x: b.top.x, y: b.top.y } : { x: tileToScreen(col, row).x, y: tileToScreen(col, row).y + 8 };
      const depth = (b ? b.depth : frontDepth(col, row, 1, 1)) + FLOCK_BUMP;
      for (let i = 0; i < f.count; i++) {
        const bat = this.makeBat(`town:${k}:${i}`, () => ({ x: ground.x, y: ground.y - f.lift }), f.radius, col, row);
        if (!bat) continue;
        bat.sprite.setDepth(depth);
        this.flocks.push(bat);
      }
    });
  }

  // ── The extra cobwebs ──

  /** events/halloween.json webSpots, once their pictures are in: at their tile's top corner + offset, flipped for
   *  another corner, sorted at their tile like a prop. */
  private makeSpots(): void {
    if (this.spots.length) return;
    const W = this.M.halloweenDeco!.webs;
    const spots = this.hooks.data.webSpots.filter((s) => W[s.web]);
    if (!spots.every((s) => this.scene.textures.exists(W[s.web].file))) return;
    for (const s of spots) {
      const def = W[s.web];
      const [c, r] = s.tile;
      const t = tileToScreen(c, r);
      const fx = s.flip === 'x' || s.flip === 'xy';
      const fy = s.flip === 'y' || s.flip === 'xy';
      const [w, h] = def.size;
      const [ax, ay] = def.anchor;
      const img = this.scene.add
        .image(t.x + (s.offset?.[0] ?? 0), t.y + (s.offset?.[1] ?? 0), def.file)
        .setOrigin((fx ? w - ax : ax) / w, (fy ? h - ay : ay) / h)
        .setFlip(fx, fy)
        .setDepth(frontDepth(c, r, 1, 1) + WEB_BUMP);
      this.onSpawn(img);
      this.spots.push(img);
    }
  }

  // ── The Kapre ──

  /** His tree this half hour (the same for everyone), drawn in front of it near you, tucked into its front leaves on the
   *  thick trees; a quick fade as he moves to another. */
  private syncKapre(near: (col: number, row: number) => boolean): void {
    const K = this.kapreData!;
    const trees = kapreTrees(this.map.objects.filter((o) => this.inMap(o.col, o.row)), Object.keys(K.trees));
    const slot = kapreSlot(this.hooks.now(), K.placement.hopMinutes);
    const i = kapreTree(trees.length, slot);
    const tree = trees[i];
    if (!tree) return;
    const base = this.byTile.get(`${tree.col},${tree.row}`) ?? null;
    const T = K.trees[tree.id];
    const k = this.kapre;
    if (!k) {
      if (!base) return; // (his tree not drawn yet)
      const side = base?.flipX ? (T.side === 'e' ? 'w' : 'e') : T.side;
      const s = this.looping(side === 'w' ? K.sheetMirrored : K.sheet, K.cell, K.frames, K.fps);
      if (!s) return;
      s.setOrigin(0, 0);
      this.kapre = { sprite: s, leaves: null, tree: base, slot, col: tree.col, row: tree.row };
      return;
    }
    if (k.slot !== slot) {
      // Moving on: fade out where he is, then come back in his new tree.
      k.slot = slot;
      const parts = [k.sprite, ...(k.leaves ? [k.leaves] : [])];
      this.scene.tweens.add({
        targets: parts,
        alpha: 0,
        duration: HOP_FADE_MS,
        onComplete: () => {
          parts.forEach((p) => p.destroy());
          if (this.kapre === k) this.kapre = null; // (made again, in the new tree, on the next frame)
          this.fadeIn = true;
        },
      });
      return;
    }
    const tb = base;
    const shown = !!tb && tb.visible && near(k.col, k.row);
    k.sprite.setVisible(shown);
    k.leaves?.setVisible(shown);
    if (!shown || !tb) return;
    k.tree = tb;
    // The kapre frame's top-left: the tree picture's top-left + offset (on a flipped tree its right edge lands there).
    const at = this.pointOn(tb, [tb.flipX ? T.offset[0] + K.cell[0] : T.offset[0], T.offset[1]]);
    if (!k.leaves && T.leaves && this.scene.textures.exists(T.leaves)) {
      k.leaves = this.scene.add.image(0, 0, T.leaves);
      this.onSpawn(k.leaves);
    }
    k.sprite.setPosition(Math.round(at.x), Math.round(at.y)).setDepth(tb.depth + KAPRE_BUMP);
    if (this.fadeIn) {
      this.fadeIn = false;
      for (const p of [k.sprite, ...(k.leaves ? [k.leaves] : [])]) {
        p.setAlpha(0);
        this.scene.tweens.add({ targets: p, alpha: 1, duration: HOP_FADE_MS });
      }
    }
    k.leaves?.setPosition(tb.x, tb.y).setOrigin(tb.originX, tb.originY).setFlipX(tb.flipX).setScale(tb.scaleX, tb.scaleY).setDepth(tb.depth + LEAVES_BUMP);
  }
  private fadeIn = false;

  /** Where the Kapre is now (dev and the check): his tree's tile and kind, or null. */
  get kapreAt(): { col: number; row: number; tree: string } | null {
    const k = this.kapre;
    if (!k) return null;
    const o = this.map.objects.find((x) => x.col === k.col && x.row === k.row);
    return { col: k.col, row: k.row, tree: o?.id ?? '' };
  }

  /** What's up (dev and the check). */
  get counts() {
    let houseBatsN = 0;
    let withBats = 0;
    for (const h of this.houses.values()) {
      houseBatsN += h.bats.length;
      if (h.bats.length) withBats += 1;
    }
    return {
      looks: this.looks.size,
      webs: this.props.size,
      spiders: [...this.props.values()].filter((d) => d.spider).length,
      houses: this.houses.size,
      housesWithBats: withBats,
      houseBats: houseBatsN,
      townBats: this.flocks.length,
      spots: this.spots.length,
      kapre: this.kapreAt,
    };
  }

  /** What the night tints. */
  get tintables(): Img[] {
    const out: Img[] = [...this.spots, ...this.flocks.map((b) => b.sprite)];
    for (const d of this.props.values()) out.push(d.web, ...(d.spider ? [d.spider] : []));
    for (const h of this.houses.values()) out.push(...(h.layer ? [h.layer] : []), ...h.spiders, ...h.bats.map((b) => b.sprite));
    if (this.kapre) out.push(this.kapre.sprite, ...(this.kapre.leaves ? [this.kapre.leaves] : []));
    return out;
  }

  /** Everything down: the buildings' normal pictures (and click tests) back, every web, spider, bat and the Kapre gone. */
  private clear(): void {
    for (const [part, l] of this.looks) {
      if (!part.scene) continue;
      part.setTexture(l.normal);
      if (part.input) part.input.hitAreaCallback = l.hit!;
    }
    this.looks.clear();
    for (const [base, d] of this.props) this.dropProp(base, d);
    for (const [base, h] of this.houses) this.dropHouse(base, h);
    this.flocks.forEach((b) => b.sprite.destroy());
    this.flocks = [];
    this.spots.forEach((s) => s.destroy());
    this.spots = [];
    if (this.kapre) {
      this.kapre.sprite.destroy();
      this.kapre.leaves?.destroy();
      this.kapre = null;
    }
  }

  destroy(): void {
    this.clear();
  }
}
