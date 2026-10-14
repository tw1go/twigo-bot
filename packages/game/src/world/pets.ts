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
// Following (stats.json pets.follow): a pet keeps about `distanceTiles` behind its owner (a little to one side), walking while they walk and
// hurrying when it falls behind; past TELEPORT_TILES (or on a new map) it's put straight at their side. It walks
// straight at its spot, on the move sheet nearest its way (se, sw, ne, nw by the screen's quarters; straight east or west
// on the level: se or sw). Only while its owner walks north or south on screen, where no sheet fits, it zigzags:
// a leg of `zigzagEverySteps` tiles along one of the sheets' diagonals (a column or a row), then the other. Drawn at the manifest's
// pets.scale (smaller than its 40 × 40 art). Stopped, it turns to the camera: se if it was heading east-ish,
// sw if west-ish. Hovering pets get a soft shadow under them; one with a `glow` a soft light round it. A click on your
// own pet plays its special (others' pets ignore clicks).

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
}

type Anim = 'idle' | 'move' | 'special';
type MoveDir = 'se' | 'sw' | 'ne' | 'nw';

/** Past this many tiles from its owner a pet is put back at their side. */
const TELEPORT_TILES = 8;
/** How far to one side of the spot right behind its owner a pet keeps. */
const SIDE_TILES = 0.9;
/** Close enough to where it's going. */
const THERE = 0.12;

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
  private readonly shadow: Phaser.GameObjects.Ellipse | null;
  private readonly glow: Phaser.GameObjects.Image | null;
  col: number;
  row: number;
  private anim: Anim = 'idle';
  private dir: MoveDir = 'se';
  /** The leg it's walking: along a column or a row, how much of it is left (tiles). */
  private leg: { axis: 0 | 1; sign: number; left: number } | null = null;
  private lastAxis: 0 | 1 = 0;
  /** Where it's going (behind its owner), kept while they stand still. */
  private target: { col: number; row: number } | null = null;
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
    this.shadow = kind?.hover ? scene.add.ellipse(0, 0, Math.round(14 * host.scale), Math.max(2, Math.round(5 * host.scale)), 0x000000, 0.22) : null;
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
    this.target = null;
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
    const far = Math.hypot(o.spot.col - this.col, o.spot.row - this.row);
    if (far > TELEPORT_TILES) return this.placeBehind(o);
    // While they walk it heads for the spot behind them; standing still, it stays put unless it's well off.
    if (o.walking || !this.target || far > this.host.rules.follow.distanceTiles + 1.5) this.target = this.behind(o);
    const t = this.target;
    const d: [number, number] = [t.col - this.col, t.row - this.row];
    const dist = Math.hypot(d[0], d[1]);
    const northSouth = o.walking && (o.facing === 'n' || o.facing === 's');
    if (dist < THERE && !northSouth) {
      // There: walking along with them while they walk (on their way's sheet; never a flicker of idle), else stopped.
      if (!o.walking) return this.stop();
      this.col = t.col;
      this.row = t.row;
      const way = this.wayOf(o.facing);
      if (this.anim !== 'move' || way !== this.dir) {
        this.dir = way;
        this.anim = 'move';
        this.play('move');
      }
      return;
    }
    let dir: MoveDir;
    if (northSouth) {
      // Their heading is north or south on screen, where no move sheet fits: legs of `zigzagEverySteps` tiles along a
      // column, then a row, both the way they're heading; a little quicker or slower to keep its distance.
      const sign = o.facing === 's' ? 1 : -1;
      if (!this.leg || this.leg.left <= 0 || this.leg.sign !== sign) {
        const axis: 0 | 1 = this.leg?.sign === sign ? (this.lastAxis === 0 ? 1 : 0) : Math.abs(d[0]) >= Math.abs(d[1]) ? 0 : 1;
        this.leg = { axis, sign, left: this.host.rules.follow.zigzagEverySteps };
        this.lastAxis = axis;
      }
      const leg = this.leg;
      const ahead = (d[0] + d[1]) * sign < -0.5; // past its spot: easy
      const pace = speed * Math.SQRT2 * (far > this.host.rules.follow.distanceTiles + 1 ? 1.35 : ahead ? 0.8 : 1.02);
      const step = Math.min(pace * (dt / 1000), leg.left);
      if (leg.axis === 0) this.col += sign * step;
      else this.row += sign * step;
      leg.left -= step;
      dir = leg.axis === 0 ? (sign > 0 ? 'se' : 'nw') : sign > 0 ? 'sw' : 'ne';
    } else {
      // Anywhere else: straight there, on the sheet of its screen quarter (on the level, the half it had).
      this.leg = null;
      const x = (d[0] - d[1]) * 16;
      const y = (d[0] + d[1]) * 8;
      const step = Math.min(speed * (far > this.host.rules.follow.distanceTiles + 1 ? 1.6 : 1.05) * (dt / 1000), dist);
      this.col += (d[0] / dist) * step;
      this.row += (d[1] / dist) * step;
      // (While they walk, their way's sheet: the small turns of catching up never flip it.)
      const south = Math.abs(y) < 0.35 * Math.abs(x) ? this.dir === 'se' || this.dir === 'sw' || this.anim !== 'move' : y > 0;
      dir = o.walking ? this.wayOf(o.facing) : x >= 0 ? (south ? 'se' : 'ne') : south ? 'sw' : 'nw';
    }
    if (this.anim !== 'move' || dir !== this.dir) {
      this.dir = dir;
      this.anim = 'move';
      this.play('move');
    }
  }

  /** The move sheet for an owner's way (east or west on the level: the camera-facing se or sw; never asked for north or
   *  south). */
  private wayOf(facing: string): MoveDir {
    if (facing === 'e') return 'se';
    if (facing === 'w') return 'sw';
    return facing === 'se' || facing === 'sw' || facing === 'ne' || facing === 'nw' ? facing : this.dir;
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
    this.sprite.setPosition(x, y).setDepth(depth);
    this.shadow?.setPosition(x, y).setDepth(depth - 0.2);
    if (this.glow) {
      this.glow.setPosition(x, y - Math.round(14 * this.host.scale)).setDepth(GLOW_DEPTH - 1);
      this.glow.setAlpha(0.42 + 0.12 * Math.sin(this.host.scene.time.now / 420));
    }
  }
}

export class Pets {
  /** Each owner's pet (made once the owner is drawn: someone arriving takes a moment to build). */
  private readonly views = new Map<string, { pet: string; owner: () => PetOwner | null; mine: boolean; view: PetView | null }>();
  private readonly loading = new Set<string>();
  /** How big a pet is drawn against its art (manifest pets.scale; 1 without it). */
  readonly scale: number;
  /** Tints a new sprite with the world (night). */
  onSpawn: ((s: Phaser.GameObjects.Sprite) => void) | null = null;
  /** How high the ground is at a point (raised ground), px. */
  elevation: ((col: number, row: number) => number) | null = null;

  constructor(
    readonly scene: Phaser.Scene,
    private readonly M: PetManifest,
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
    return [...this.views.values()].flatMap((v) => (v.view ? [v.view.sprite] : []));
  }

  clear(): void {
    for (const v of this.views.values()) v.view?.destroy();
    this.views.clear();
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
