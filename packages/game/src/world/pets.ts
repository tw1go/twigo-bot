import Phaser from 'phaser';
import type { PetRules } from '@mikazuki/shared';
import { queueSheet } from '../assets/queue';
import { slice } from '../assets/packs';
import { CHARACTER_BIAS, GLOW_DEPTH, HEIGHT_DEPTH } from './depth';

// 🐾 Pets in the world (CONTEXT.md "Pets"): everyone's pet out follows them, in town and on battle maps alike. A pet is
// scenery: it never blocks anyone, can't be targeted and takes no hits. Art (manifest `pets`, the frame data in
// pets/sheets/pets.json): 40 × 40 cells, the anchor (20, 35) the ground point under it; idle and special exist facing se
// and sw only, move se, sw, ne and nw (sw and nw already drawn mirrored). Each sheet loads the first time it's needed.
//
// Following (stats.json pets.follow): a pet rests while its owner is near, however they move about (a click a tile or
// two away never sets it off). Once they're `distanceTiles` + START_EXTRA off it walks toward them (never to a set spot
// beside them, so it never slides across to their other side), keeping about `distanceTiles` behind while they walk on,
// and stops once they've stopped and it's within it: so it trails behind them as they go. It never sprints: at most a
// touch quicker than them. Fallen behind past FAR_TILES (a dash, a teleport), it fades out and fades back in right behind
// them (FADE_MS each way), walking on if they still are; on a new map it's simply put there. It walks straight, on the move sheet of its screen quarter (se, sw, ne, nw; straight east or west: se or sw);
// only heading north or south on screen, where no sheet fits, it weaves: mostly straight at them at their pace, drifting
// to one side for `zigzagEverySteps` tiles (and the walk cycle under way: a hop is never cut short), then the other, on
// the diagonal sheet of the side it drifts to. Drawn at the manifest's pets.scale (smaller than its 40 × 40
// art). Stopped, it turns to the camera: se if it was heading east-ish, sw if west-ish. Every pet stands on a ground
// shadow like the characters' and mobs' (the shadow art's colour as a pixel ellipse; manifest pets.shadow, smaller under a
// hovering pet, a pet's own in pets.shadows), tinted with the world at night; one with a `glow` a soft light round it. A click on your own pet plays its special (others' pets ignore
// clicks).

/** pets/sheets/pets.json. */
export interface PetSheetData {
  cell: [number, number];
  anchor: [number, number];
  animations: Record<'idle' | 'move' | 'special', { fps: number; loop: boolean; dirs: string[] }>;
  pets: Record<string, Record<'idle' | 'move' | 'special', Record<string, number>>>;
}

/** The manifest's `pets` block. */
export interface PetManifest {
  data: string;
  file: string;
  icon: string;
  box: string;
  node: string;
  nodeLocked: string;
  nodeStats: Record<string, string>;
  ids: string[];
  /** How big a pet is drawn against its art (1 = 40 × 40 art px). */
  scale?: number;
  /** The sheet to draw for a way, where the art's names don't match where it faces (way → sheet's direction). */
  sheetDirs?: Record<string, string>;
  /** The ground shadow under a pet (world px, w × h), under a hovering one, and a pet's own size by id. */
  shadow?: [number, number];
  shadowHover?: [number, number];
  shadows?: Record<string, [number, number]>;
  /** The shadow's colour (else the shadow art's) and its opacity (at least this). */
  shadowColour?: string;
  shadowAlpha?: number;
}

type Anim = 'idle' | 'move' | 'special';
type MoveDir = 'se' | 'sw' | 'ne' | 'nw';

/** Past this many tiles from its owner a pet fades out and back in behind them. */
const FAR_TILES = 5;
/** How long that fade takes each way (ms). */
const FADE_MS = 220;
/** How far to one side of the spot right behind its owner a pet keeps. */
const SIDE_TILES = 0.9;
/** Within this much of straight north or south on screen (|x| ≤ this × |y|, in screen px), a pet zigzags. */
const NORTH_SOUTH = 0.4;
/** How far a weave leans off the straight way (tile space; 0.25 ≈ 27° on screen). */
const WEAVE = 0.25;
/** A resting pet sets off once its owner is this many tiles past `distanceTiles`. */
const START_EXTRA = 1.8;

/** Who a pet follows: where their feet are (tile space), which way they face, and whether they're walking. */
export interface PetOwner {
  spot: { col: number; row: number };
  facing: string;
  walking: boolean;
}

/** One screen direction's way in tile space (screen x = (col − row) × 16, y = (col + row) × 8). */
const DIR_VEC: Record<string, [number, number]> = {
  se: [1, 0], sw: [0, 1], nw: [-1, 0], ne: [0, -1],
  s: [Math.SQRT1_2, Math.SQRT1_2], n: [-Math.SQRT1_2, -Math.SQRT1_2], e: [Math.SQRT1_2, -Math.SQRT1_2], w: [-Math.SQRT1_2, Math.SQRT1_2],
};

class PetView {
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly shadow: Phaser.GameObjects.Image | null;
  private readonly glow: Phaser.GameObjects.Image | null;
  col: number;
  row: number;
  private anim: Anim = 'idle';
  private dir: MoveDir = 'se';
  /** The leg it's walking: along a column or a row, how much of it is left (tiles). */
  /** The weave under way (heading north or south): which side it drifts to and how much of its leg is left (tiles). */
  private leg: { side: number; left: number } | null = null;
  /** Walking toward its owner (else resting where it stopped). */
  private following = false;
  /** Fading out to come back behind its owner ('out'), or in again ('in'); its parts' alpha follows `seen`. */
  private fade: 'out' | 'in' | null = null;
  private seen = 1;
  /** The walk is on its first frame: a cycle just ended (or began), the only time it changes sheet. */
  private get cycleStart(): boolean {
    return !!this.sprite.anims.currentFrame?.isFirst;
  }
  private specialEnds = 0;
  private sparkle: Phaser.GameObjects.Particles.ParticleEmitter | null = null;

  constructor(
    private readonly host: Pets,
    readonly petId: string,
    readonly mine: boolean,
    at: { col: number; row: number },
  ) {
    const scene = host.scene;
    const [cw, ch] = host.sheets.cell;
    const [ax, ay] = host.sheets.anchor;
    this.col = at.col;
    this.row = at.row;
    const kind = host.rules.list[petId];
    const size = host.M.shadows?.[petId] ?? (kind?.hover ? host.M.shadowHover : host.M.shadow);
    const shadowKey = size ? host.shadowTexture(size[0], size[1]) : null;
    this.shadow = shadowKey ? scene.add.image(0, 0, shadowKey) : null;
    if (this.shadow) host.onSpawn?.(this.shadow as unknown as Phaser.GameObjects.Sprite);
    this.glow = kind?.glow ? scene.add.image(0, 0, host.glowTexture()).setScale(host.scale).setBlendMode(Phaser.BlendModes.ADD).setTint(Phaser.Display.Color.HexStringToColor(kind.glow).color).setAlpha(0.5) : null;
    this.sprite = scene.add.sprite(0, 0, '__DEFAULT').setOrigin(ax / cw, ay / ch).setScale(host.scale).setVisible(false);
    host.onSpawn?.(this.sprite);
    // Your own pet can be clicked (the scene's click asks `pick`: its special); others' never are.
    if (mine) this.sprite.setInteractive({ useHandCursor: true });
    this.play('idle');
  }

  /** Plays its special once (then idle again). */
  special(): void {
    const frames = this.host.frames(this.petId, 'special', this.dir === 'sw' || this.dir === 'nw' ? 'sw' : 'se');
    if (!frames) return;
    this.anim = 'special';
    this.play('special', true);
    this.specialEnds = this.host.scene.time.now + (frames / this.host.sheets.animations.special.fps) * 1000;
  }

  /** A level-up: a burst of sparkles round it. */
  levelUp(): void {
    const scene = this.host.scene;
    const key = this.host.sparkTexture();
    this.sparkle?.destroy();
    this.sparkle = scene.add.particles(this.sprite.x, this.sprite.y - 14 * this.host.scale, key, {
      speed: { min: 20, max: 55 },
      angle: { min: 200, max: 340 },
      lifespan: 700,
      scale: { start: 1, end: 0 },
      alpha: { start: 1, end: 0 },
      gravityY: 40,
      quantity: 14,
      emitting: false,
      blendMode: Phaser.BlendModes.ADD,
      tint: [0xfff3a0, 0xffffff, 0xb6f05a],
    });
    this.sparkle.setDepth(this.sprite.depth + 0.05).explode(18);
    scene.time.delayedCall(900, () => {
      this.sparkle?.destroy();
      this.sparkle = null;
    });
  }

  /** Its parts the world's tint reaches besides the sprite (its shadow). */
  get tintables(): Phaser.GameObjects.Sprite[] {
    return this.shadow ? [this.shadow as unknown as Phaser.GameObjects.Sprite] : [];
  }

  /** Plays what it's doing again (its sheets just loaded). */
  refresh(): void {
    this.play(this.anim, true);
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow?.destroy();
    this.glow?.destroy();
    this.sparkle?.destroy();
  }

  /** Puts it right behind its owner (arriving, a new map, fallen too far behind). */
  placeBehind(o: PetOwner): void {
    const t = this.behind(o);
    this.col = t.col;
    this.row = t.row;
    this.leg = null;
    this.following = false;
    this.stop();
  }

  /** Its spot: `distanceTiles` behind its owner's facing and SIDE_TILES to one side, so standing still facing the camera
   *  they don't hide it. */
  private behind(o: PetOwner): { col: number; row: number } {
    const [dc, dr] = DIR_VEC[o.facing] ?? DIR_VEC.s;
    const d = this.host.rules.follow.distanceTiles;
    return { col: o.spot.col - dc * d - dr * SIDE_TILES, row: o.spot.row - dr * d + dc * SIDE_TILES };
  }

  update(dt: number, o: PetOwner, speed: number): void {
    const F = this.host.rules.follow;
    const d: [number, number] = [o.spot.col - this.col, o.spot.row - this.row];
    const dist = Math.hypot(d[0], d[1]);
    // Too far behind: fade out where it is, then in again behind them (walking on if they still are).
    if (this.fade === 'out') {
      this.seen = Math.max(0, this.seen - dt / FADE_MS);
      if (this.seen > 0) return;
      this.placeBehind(o);
      this.fade = 'in';
      this.following = o.walking;
    } else if (this.fade === 'in') {
      this.seen = Math.min(1, this.seen + dt / FADE_MS);
      if (this.seen >= 1) this.fade = null;
    } else if (dist > FAR_TILES) {
      this.fade = 'out';
      return;
    }
    // Resting while they're near; off once they're START_EXTRA past its distance; stopping again within it.
    if (!this.following && dist > F.distanceTiles + START_EXTRA) this.following = true;
    // (While they walk on it keeps going, easing to their pace at its distance: never a stop-start.)
    if (this.following && !o.walking && dist <= F.distanceTiles) {
      this.following = false;
      this.leg = null;
    }
    if (!this.following) return this.stop();
    // Its way on screen (px): x = (col − row) × 16, y = (col + row) × 8. A little quicker than them until it's at its
    // distance, a little slower inside it; never more.
    const x = (d[0] - d[1]) * 16;
    const y = (d[0] + d[1]) * 8;
    const gap = dist - F.distanceTiles;
    const pace = speed * (gap > 0.5 ? 1.1 : gap > 0 ? 1 : 0.85) * (dt / 1000);
    let dir: MoveDir;
    // (A weave under way carries on while the way stays roughly north or south: no flicking between the two.)
    const weaving = Math.abs(x) <= (this.leg ? 0.8 : NORTH_SOUTH) * Math.abs(y);
    if (weaving) {
      // North or south, where no move sheet fits: a gentle weave at their pace, mostly straight at them, drifting to one
      // side then the other every `zigzagEverySteps` tiles, on the diagonal sheet of the side it drifts to.
      // (A side that's done waits for the walk cycle under way to end: Croakyangs' hop is 13 frames, about a second.)
      if (!this.leg || (this.leg.left <= 0 && (this.cycleStart || this.anim !== 'move'))) {
        this.leg = { side: this.leg ? -this.leg.side : 1, left: F.zigzagEverySteps };
      }
      const leg = this.leg;
      const u: [number, number] = [d[0] / dist, d[1] / dist];
      const v: [number, number] = [u[0] - WEAVE * leg.side * u[1], u[1] + WEAVE * leg.side * u[0]];
      const n = Math.hypot(v[0], v[1]);
      const step = Math.min(pace * (n / (u[0] * v[0] + u[1] * v[1])), dist);
      this.col += (v[0] / n) * step;
      this.row += (v[1] / n) * step;
      leg.left -= step;
      const axis = Math.abs(v[0]) >= Math.abs(v[1]) ? 0 : 1;
      const sign = Math.sign(v[axis]);
      dir = axis === 0 ? (sign > 0 ? 'se' : 'nw') : sign > 0 ? 'sw' : 'ne';
    } else {
      // Anywhere else: straight toward them, on its screen quarter's sheet (on the level: the camera-facing one).
      this.leg = null;
      const step = Math.min(pace, dist);
      this.col += (d[0] / dist) * step;
      this.row += (d[1] / dist) * step;
      const south = Math.abs(y) < 0.35 * Math.abs(x) || y > 0;
      dir = x >= 0 ? (south ? 'se' : 'ne') : south ? 'sw' : 'nw';
    }
    // Setting off: its way's sheet at once. Already walking: a new way's sheet waits for the cycle under way to end (a
    // hop or a stride is never cut short), then starts at its first frame.
    if (this.anim !== 'move' || (dir !== this.dir && this.cycleStart)) {
      this.dir = dir;
      this.anim = 'move';
      this.play('move');
    }
  }

  /** Stopped: idle, facing the camera on the side it was heading (east-ish se, west-ish sw); a special plays out first. */
  private stop(): void {
    this.leg = null;
    if (this.anim === 'special' && this.host.scene.time.now < this.specialEnds) return;
    const face: MoveDir = this.dir === 'se' || this.dir === 'ne' ? 'se' : 'sw';
    if (this.anim !== 'idle' || this.dir !== face) {
      this.dir = face;
      this.anim = 'idle';
      this.play('idle');
    }
  }

  private play(anim: Anim, restart = false): void {
    const dir = anim === 'move' ? this.dir : this.dir === 'se' || this.dir === 'ne' ? 'se' : 'sw';
    const key = this.host.animKey(this.petId, anim, dir);
    if (!key) {
      this.sprite.setVisible(false);
      return;
    }
    this.sprite.setVisible(true);
    this.sprite.play(key, !restart);
    if (anim === 'special') {
      this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        this.anim = 'move'; // (so the next stop turns it back to idle)
        this.stop();
      });
    }
  }

  /** Screen position and depth (as a character's, a hair behind one on the same spot). */
  sync(): void {
    if (this.anim === 'special' && this.host.scene.time.now >= this.specialEnds && !this.sprite.anims.isPlaying) this.stop();
    const ground = this.host.elevation?.(this.col, this.row) ?? 0;
    const x = Math.round((this.col - this.row) * 16);
    const y = Math.round((this.col + this.row) * 8 - ground);
    const depth = (this.col + this.row + 1) * 8 + CHARACTER_BIAS + ground * HEIGHT_DEPTH - 0.01;
    this.sprite.setPosition(x, y).setDepth(depth).setAlpha(this.seen);
    this.shadow?.setPosition(x, y).setDepth(depth - 0.2).setAlpha(this.seen);
    if (this.glow) {
      this.glow.setPosition(x, y - Math.round(14 * this.host.scale)).setDepth(GLOW_DEPTH - 1);
      this.glow.setAlpha((0.42 + 0.12 * Math.sin(this.host.scene.time.now / 420)) * this.seen);
    }
  }
}

export class Pets {
  /** Each owner's pet (made once the owner is drawn: someone arriving takes a moment to build). */
  private readonly views = new Map<string, { pet: string; owner: () => PetOwner | null; mine: boolean; view: PetView | null }>();
  private readonly loading = new Set<string>();
  /** How big a pet is drawn against its art (manifest pets.scale; 1 without it). */
  readonly scale: number;
  /** The shadow art (manifest fx.shadow), whose colour the pets' shadows take. */
  shadowArt: string | null = null;
  /** Tints a new sprite with the world (night). */
  onSpawn: ((s: Phaser.GameObjects.Sprite) => void) | null = null;
  /** How high the ground is at a point (raised ground), px. */
  elevation: ((col: number, row: number) => number) | null = null;

  constructor(
    readonly scene: Phaser.Scene,
    readonly M: PetManifest,
    readonly sheets: PetSheetData,
    readonly rules: PetRules,
    /** An owner's walking pace (tiles a second). */
    private readonly speed: number,
  ) {
    this.scale = M.scale ?? 1;
  }

  /** A pet's frames in a sheet (pets.json), or 0. */
  frames(pet: string, anim: Anim, dir: string): number {
    return this.sheets.pets[pet]?.[anim]?.[this.sheetDir(dir)] ?? 0;
  }

  /** The sheet drawn for a way (manifest pets.sheetDirs: the art's se and sw sheets face the other way). */
  private sheetDir(dir: string): string {
    return this.M.sheetDirs?.[dir] ?? dir;
  }

  private fileOf(pet: string, anim: Anim, dir: string): string {
    return this.M.file.replace('{id}', pet).replace('{anim}', anim).replace('{dir}', this.sheetDir(dir));
  }

  /** The animation for a pet's sheet, made once it's loaded (null meanwhile: it's being loaded). */
  animKey(pet: string, anim: Anim, dir: string): string | null {
    const file = this.fileOf(pet, anim, dir);
    const key = `pet:${pet}:${anim}:${dir}`;
    if (this.scene.anims.exists(key)) return key;
    if (!this.scene.textures.exists(file)) {
      this.load(pet);
      return null;
    }
    const [w, h] = this.sheets.cell;
    slice(this.scene.textures, file, w, h);
    const n = this.frames(pet, anim, dir);
    const a = this.sheets.animations[anim];
    this.scene.anims.create({ key, frames: this.scene.anims.generateFrameNumbers(file, { start: 0, end: Math.max(0, n - 1) }), frameRate: a.fps, repeat: a.loop ? -1 : 0 });
    return key;
  }

  /** Loads every sheet of a pet (in the background), then starts its views over. */
  private load(pet: string): void {
    if (this.loading.has(pet)) return;
    this.loading.add(pet);
    const [w, h] = this.sheets.cell;
    for (const anim of ['idle', 'move', 'special'] as Anim[]) for (const dir of this.sheets.animations[anim].dirs) queueSheet(this.scene.load, this.scene.textures, this.fileOf(pet, anim, dir), w, h);
    this.scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
      for (const { view } of this.views.values()) if (view?.petId === pet) view.refresh();
    });
    if (!this.scene.load.isLoading()) this.scene.load.start();
  }

  /** A pet for an owner (by key: 'me', or a town player's id), or none (null). */
  set(key: string, pet: string | null, owner: () => PetOwner | null, mine = false): void {
    const had = this.views.get(key);
    if (had && had.pet === pet) {
      had.owner = owner;
      return;
    }
    had?.view?.destroy();
    this.views.delete(key);
    if (pet && this.rules.list[pet]) this.views.set(key, { pet, owner, mine, view: null });
  }

  /** Every owner but yours forgotten (a new list of who's here). */
  clearOthers(): void {
    for (const key of [...this.views.keys()]) if (key !== 'me') this.set(key, null, () => null);
  }

  has(key: string): boolean {
    return this.views.has(key);
  }

  /** Your pet, if it's among what the pointer is over (a click on it: its special). */
  pick(over: Phaser.GameObjects.GameObject[]): boolean {
    const v = this.views.get('me')?.view;
    return !!v && over.includes(v.sprite);
  }

  /** Plays an owner's pet's special. */
  special(key: string): void {
    this.views.get(key)?.view?.special();
  }

  /** A pet's sparkle (its level-up). */
  levelUp(key: string): void {
    this.views.get(key)?.view?.levelUp();
  }

  update(delta: number): void {
    for (const v of this.views.values()) {
      const o = v.owner();
      if (!o) {
        v.view?.destroy();
        v.view = null;
        continue;
      }
      if (!v.view) {
        v.view = new PetView(this, v.pet, v.mine, o.spot);
        v.view.placeBehind(o);
      } else v.view.update(Math.min(delta, 100), o, this.speed);
      v.view.sync();
    }
  }

  /** Every sprite the world's tint reaches. */
  get tintables(): Phaser.GameObjects.Sprite[] {
    return [...this.views.values()].flatMap((v) => (v.view ? [v.view.sprite, ...v.view.tintables] : []));
  }

  clear(): void {
    for (const v of this.views.values()) v.view?.destroy();
    this.views.clear();
  }

  /** A `w × h` ground shadow like the shadow art (a pixel ellipse in its colour, taken from its middle), made once: the
   *  mobs' look (world/mobs.ts shadowSheet). */
  shadowTexture(w: number, h: number): string {
    const key = `pet-shadow:${w}x${h}`;
    if (this.scene.textures.exists(key)) return key;
    const art = this.shadowArt && this.scene.textures.exists(this.shadowArt) ? this.shadowArt : null;
    const src = art ? (this.scene.textures.get(art).getSourceImage() as HTMLImageElement) : null;
    const c = art && src ? this.scene.textures.getPixel(Math.floor(src.width / 2), Math.floor(src.height / 2), art) : null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    // (The manifest's colour if it gives one, else the shadow art's; its opacity at least shadowAlpha.)
    const own = this.M.shadowColour ? Phaser.Display.Color.HexStringToColor(this.M.shadowColour) : null;
    const rgb = own ? [own.red, own.green, own.blue] : c ? [c.red, c.green, c.blue] : [30, 27, 58];
    const alpha = Math.max(own ? 0 : c ? c.alpha / 255 : 0.4, this.M.shadowAlpha ?? 0);
    ctx.fillStyle = `rgba(${rgb.join(', ')}, ${alpha})`;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (((x + 0.5 - w / 2) / (w / 2)) ** 2 + ((y + 0.5 - h / 2) / (h / 2)) ** 2 <= 1) ctx.fillRect(x, y, 1, 1);
    this.scene.textures.addCanvas(key, canvas);
    return key;
  }

  /** A soft round light (made once): the glow round a pet with a `glow`. */
  glowTexture(): string {
    const key = 'pet-glow';
    if (this.scene.textures.exists(key)) return key;
    const c = this.scene.textures.createCanvas(key, 48, 48)!;
    const ctx = c.getContext();
    const g = ctx.createRadialGradient(24, 24, 0, 24, 24, 24);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 48, 48);
    c.refresh();
    return key;
  }

  /** A 3 × 3 pixel sparkle (a plus), made once. */
  sparkTexture(): string {
    const key = 'pet-spark';
    if (this.scene.textures.exists(key)) return key;
    const c = this.scene.textures.createCanvas(key, 3, 3)!;
    const ctx = c.getContext();
    ctx.fillStyle = '#fff';
    ctx.fillRect(1, 0, 1, 3);
    ctx.fillRect(0, 1, 3, 1);
    c.refresh();
    return key;
  }

  /** Debug: every pet, where it is and what it plays. */
  debug(): { key: string; pet: string; col: number; row: number; anim: string | undefined; visible: boolean }[] {
    return [...this.views].flatMap(([key, { view }]) => (view ? [{ key, pet: view.petId, col: +view.col.toFixed(2), row: +view.row.toFixed(2), anim: view.sprite.anims.currentAnim?.key, visible: view.sprite.visible }] : []));
  }
}
