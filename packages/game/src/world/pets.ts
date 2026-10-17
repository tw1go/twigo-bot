import Phaser from 'phaser';
import type { PetRules } from '@mikazuki/shared';
import { queueSheet } from '../assets/queue';
import { slice } from '../assets/packs';
import { CHARACTER_BIAS, GLOW_DEPTH, HEIGHT_DEPTH } from './depth';
import type { WalkGrid } from './grid';

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
// only heading north or south on screen, where no sheet fits, it zigzags along the sheets' own diagonals (a column,
// then a row), so it always moves the way it faces: legs of `zigzagEverySteps` tiles (and the walk cycle under way: a
// hop is never cut short). Drawn at the manifest's pets.scale (smaller than its 40 × 40
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
  /** A pet's own, over `sheetDirs` (Dr. Pittuki's ne and nw are swapped too). */
  sheetDirsByPet?: Record<string, Record<string, string>>;
  /** The ground shadow under a pet (world px, w × h), under a hovering one, and a pet's own size by id. */
  shadow?: [number, number];
  shadowHover?: [number, number];
  shadows?: Record<string, [number, number]>;
  /** The shadow's colour (else the shadow art's) and its opacity (at least this). */
  shadowColour?: string;
  shadowAlpha?: number;
}

type Anim = 'idle' | 'move' | 'special';

/** The sheet drawn for a way (manifest pets.sheetDirs, a pet's own sheetDirsByPet over it: the art's se and sw sheets
 *  face the other way). */
export const petSheetDir = (M: PetManifest, dir: string, pet?: string): string => (pet && M.sheetDirsByPet?.[pet]?.[dir]) ?? M.sheetDirs?.[dir] ?? dir;
type MoveDir = 'se' | 'sw' | 'ne' | 'nw';

/** Past this many tiles from its owner a pet fades out and back in behind them. */
const FAR_TILES = 5;
/** How long that fade takes each way (ms). */
const FADE_MS = 220;
/** How far to one side of the spot right behind its owner a pet keeps. */
const SIDE_TILES = 0.9;
/** Put back beside its owner, a pet lands on a tile at most this many grid steps from theirs. */
const LANDING_STEPS = 3;
/** A route to its owner is found again at most this often while they move (ms). */
const ROUTE_MS = 500;
/** A resting pet sets off once its owner is this many tiles past `distanceTiles`. */
const START_EXTRA = 1.8;
/** A pet whose sheets haven't come (a dropped connection, a page an older build asks for) is asked for again after this
 *  long (ms): one failed load used to leave it unseen for good. */
const RETRY_MS = 10_000;
/** An unseen pet looks this often (ms) whether its sheets are in: they show as soon as they are, never waiting for the
 *  scene's whole loader (one other file stuck in it kept every pet hidden, theirs and everyone else's). */
const CHECK_MS = 500;

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
  /** The zigzag leg under way (heading north or south): along a column (0) or a row (1), which way, and how much of it is
   *  left (tiles). */
  private leg: { axis: 0 | 1; sign: number; left: number } | null = null;
  /** Walking toward its owner (else resting where it stopped). */
  private following = false;
  /** A route on the walk grid (tiles, each one step along a column or a row), when its own way was shut; for which tile
   *  of its owner's, and when it was found. */
  private route: { col: number; row: number }[] | null = null;
  private routeFor = '';
  private routeAt = 0;
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
    const t = this.landing(o);
    this.col = t.col;
    this.row = t.row;
    this.leg = null;
    this.route = null;
    this.following = false;
    this.stop();
  }

  /** Where it's put back: its spot behind them if that's a tile they can walk to, else the nearest of the tiles round
   *  them that is (the middle of it; within LANDING_STEPS on the grid, so never below a cliff they stand on), else their
   *  own spot: never in water, in a wall or up a cliff. */
  private landing(o: PetOwner): { col: number; row: number } {
    const spot = this.behind(o);
    const grid = this.host.grid;
    if (!grid) return spot;
    const home = { col: Math.floor(o.spot.col), row: Math.floor(o.spot.row) };
    // (A few steps from them on the grid: not just reachable, which a tile below a cliff is, the long way round by a ramp.)
    const ok = (c: number, r: number) => {
      if (!grid.walkable(c, r)) return false;
      const path = grid.findPath(home, { col: c, row: r }, 200);
      return !!path && path.length - 1 <= LANDING_STEPS && path[path.length - 1].col === c && path[path.length - 1].row === r;
    };
    if (ok(Math.floor(spot.col), Math.floor(spot.row))) return spot;
    const near: [number, number][] = [];
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) if (dc || dr) near.push([home.col + dc, home.row + dr]);
    near.sort((a, b) => Math.hypot(a[0] + 0.5 - spot.col, a[1] + 0.5 - spot.row) - Math.hypot(b[0] + 0.5 - spot.col, b[1] + 0.5 - spot.row));
    const at = near.find(([c, r]) => ok(c, r));
    if (at) return { col: at[0] + 0.5, row: at[1] + 0.5 };
    // (Nowhere near them it may stand: on their own spot, so it never fades out again and again.)
    return { ...o.spot };
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
      this.route = null;
    }
    if (!this.following) return this.stop(d);
    // It only ever moves along the four ways it has sheets for (in tile space: along a column or a row), so it always
    // moves exactly the way it faces: never a slide. A leg goes one way toward them; it changes way once the leg is its
    // length (`zigzagEverySteps`, a hovering pet's `zigzagEveryStepsHover`) and its walk cycle is at its first frame (a
    // hop or stride is never cut short), or as soon as it's level with them that way (never running past their line and
    // back). The new way is the one with more still
    // to go (the same way again if the other has almost nothing: walking along a column or row with them, it just goes
    // straight). The longer way round (Manhattan), so a little quicker than them; inside its distance a little slower.
    const gap = dist - F.distanceTiles;
    const step = speed * (gap > 1.5 ? 1.65 : gap > 0.5 ? 1.45 : gap > 0 ? 1.2 : 1) * (dt / 1000);
    const leg = this.leg;
    const along = leg ? d[leg.axis] * leg.sign : 0; // still to go on its way (negative: past their line)
    const turn =
      !leg ||
      this.anim !== 'move' ||
      along <= 0.3 ||
      (leg.left <= 0 && this.cycleStart);
    // On a route (the greedy way was shut): its next tile, one step along a column or a row at a time.
    if (this.route) return this.walkRoute(o, step);
    if (turn) {
      const [a, b] = [Math.abs(d[0]), Math.abs(d[1])];
      let axis: 0 | 1 = a >= b ? 0 : 1;
      // (The same way again while the other has almost nothing to go.)
      if (leg && leg.axis !== axis && Math.abs(d[leg.axis]) * Math.sign(d[leg.axis]) * leg.sign > 0.3 && Math.min(a, b) < 0.5) axis = leg.axis;
      if (!leg || axis !== leg.axis || Math.sign(d[axis]) !== leg.sign) this.leg = { axis, sign: Math.sign(d[axis]) || 1, left: this.legTiles };
    }
    // The walk grid's rules, as a player's (blocked tiles: water, walls, fences; another level only by a ramp): the step
    // into the next tile shut, it takes its other way toward them at once if that's open, else a route on the grid.
    if (!this.canGo(this.leg!, step)) {
      const other: 0 | 1 = this.leg!.axis === 0 ? 1 : 0;
      const alt = { axis: other, sign: Math.sign(d[other]) || 1, left: this.legTiles };
      if (Math.abs(d[other]) > 0.3 && this.canGo(alt, step)) this.leg = alt;
      else return this.startRoute(o, step);
    }
    this.go(this.leg!, step);
  }

  /** A zigzag leg's length: a hovering pet's own (stats.json pets.follow.zigzagEveryStepsHover), else everyone's. */
  private get legTiles(): number {
    const F = this.host.rules.follow;
    return (this.host.rules.list[this.petId]?.hover ? F.zigzagEveryStepsHover : undefined) ?? F.zigzagEverySteps;
  }

  /** The tile it stands on. */
  private get tile(): { col: number; row: number } {
    return { col: Math.floor(this.col), row: Math.floor(this.row) };
  }

  /** Whether `step` along a leg keeps to tiles it may walk (no grid: anywhere). */
  private canGo(leg: { axis: 0 | 1; sign: number }, step: number): boolean {
    const grid = this.host.grid;
    if (!grid) return true;
    const from = this.tile;
    const pos = (leg.axis === 0 ? this.col : this.row) + leg.sign * step;
    const to = leg.axis === 0 ? { col: Math.floor(pos), row: from.row } : { col: from.col, row: Math.floor(pos) };
    return (to.col === from.col && to.row === from.row) || grid.canStep(from, to);
  }

  /** Moves `step` along a leg, on its sheet. */
  private go(leg: NonNullable<PetView['leg']>, step: number): void {
    if (leg.axis === 0) this.col += leg.sign * step;
    else this.row += leg.sign * step;
    leg.left -= step;
    const dir: MoveDir = leg.axis === 0 ? (leg.sign > 0 ? 'se' : 'nw') : leg.sign > 0 ? 'sw' : 'ne';
    if (this.anim !== 'move' || dir !== this.dir) {
      this.dir = dir;
      this.anim = 'move';
      this.play('move');
    }
  }

  /** A route on the walk grid to its owner's tile (a diagonal step taken as two straight ones, by a corner it may walk);
   *  none at all (it's somewhere it can't get to them from): back behind them. */
  private startRoute(o: PetOwner, step: number): void {
    const grid = this.host.grid;
    const home = { col: Math.floor(o.spot.col), row: Math.floor(o.spot.row) };
    // (Their own tile, or, on a bench seat (a blocked tile), the nearest beside it it can get to.)
    const to = grid?.walkable(home.col, home.row) ? home : (grid?.nearestReachable(this.tile, home) ?? home);
    const path = grid?.findPath(this.tile, to);
    if (!grid || !path || path.length < 2) return void (this.fade = 'out');
    const route: { col: number; row: number }[] = [];
    for (let i = 1; i < path.length; i++) {
      const [a, b] = [path[i - 1], path[i]];
      if (a.col !== b.col && a.row !== b.row) route.push(grid.canStep(a, { col: b.col, row: a.row }) ? { col: b.col, row: a.row } : { col: a.col, row: b.row });
      route.push(b);
    }
    this.route = route;
    this.routeFor = `${home.col},${home.row}`;
    this.walkRoute(o, step);
  }

  /** Walks its route: to the middle of each next tile, along the one way it differs (a column or a row). Done, or their
   *  tile moved on (a new route then, at most every ROUTE_MS), back to its own way of following. */
  private walkRoute(o: PetOwner, step: number): void {
    const route = this.route!;
    const now = this.host.scene.time.now;
    const ownerTile = `${Math.floor(o.spot.col)},${Math.floor(o.spot.row)}`;
    if (ownerTile !== this.routeFor && now - this.routeAt > ROUTE_MS) {
      this.routeAt = now;
      this.route = null;
      return this.startRoute(o, step);
    }
    const next = route[0];
    if (!next) {
      this.route = null;
      return;
    }
    // Within its tile first (off the middle on the other way), then into the next one.
    const here = this.tile;
    const target = { col: next.col + 0.5, row: next.row + 0.5 };
    const dc = target.col - this.col;
    const dr = target.row - this.row;
    const axis: 0 | 1 = here.col !== next.col ? 0 : here.row !== next.row ? 1 : Math.abs(dc) >= Math.abs(dr) ? 0 : 1;
    const left = axis === 0 ? dc : dr;
    const leg = { axis, sign: Math.sign(left) || 1, left: Math.abs(left) };
    this.leg = leg;
    // (The other way's offset inside its tile is walked once it's in the tile it heads for.)
    this.go(leg, Math.min(step, Math.abs(left)));
    if (Math.abs(target.col - this.col) < 0.05 && Math.abs(target.row - this.row) < 0.05) route.shift();
    else if (Math.abs(left) < 0.05) {
      // In the right column (or row): now the other way, to the tile's middle.
      const other: 0 | 1 = axis === 0 ? 1 : 0;
      const rest = other === 0 ? target.col - this.col : target.row - this.row;
      if (Math.abs(rest) >= 0.05) this.go({ axis: other, sign: Math.sign(rest), left: Math.abs(rest) }, Math.min(step, Math.abs(rest)));
      if (Math.abs(target.col - this.col) < 0.05 && Math.abs(target.row - this.row) < 0.05) route.shift();
    }
    if (!route.length) this.route = null;
  }

  /** Stopped: idle, facing the camera on its owner's side (`toward`: the way to them, tile space; to their right on
   *  screen se, else sw; without it, the side it was heading); a special plays out first. */
  private stop(toward?: [number, number]): void {
    this.leg = null;
    if (this.anim === 'special' && this.host.scene.time.now < this.specialEnds) return;
    const right = toward ? toward[0] - toward[1] > 0.05 || (Math.abs(toward[0] - toward[1]) <= 0.05 && (this.dir === 'se' || this.dir === 'ne')) : this.dir === 'se' || this.dir === 'ne';
    const face: MoveDir = right ? 'se' : 'sw';
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
  /** When each pet's sheets were last asked for (scene time, ms). */
  private readonly asked = new Map<string, number>();
  /** When unseen pets next look whether their sheets are in (scene time, ms). */
  private nextCheck = 0;
  /** How big a pet is drawn against its art (manifest pets.scale; 1 without it). */
  readonly scale: number;
  /** The shadow art (manifest fx.shadow), whose colour the pets' shadows take. */
  shadowArt: string | null = null;
  /** Tints a new sprite with the world (night). */
  onSpawn: ((s: Phaser.GameObjects.Sprite) => void) | null = null;
  /** The walk grid (blocked tiles, fences, ramps): pets walk by its rules too. */
  grid: WalkGrid | null = null;
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
    return this.sheets.pets[pet]?.[anim]?.[this.sheetDir(dir, pet)] ?? 0;
  }

  /** The sheet drawn for a way (manifest pets.sheetDirs: the art's se and sw sheets face the other way). */
  private sheetDir(dir: string, pet?: string): string {
    return petSheetDir(this.M, dir, pet);
  }

  private fileOf(pet: string, anim: Anim, dir: string): string {
    return this.M.file.replace('{id}', pet).replace('{anim}', anim).replace('{dir}', this.sheetDir(dir, pet));
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

  /** Asks for every sheet of a pet (in the background; at most every RETRY_MS). Its views show it as its sheets come in
   *  (`update` looks), whatever else the scene's loader is still busy with. */
  private load(pet: string): void {
    const now = this.scene.time.now;
    if (now - (this.asked.get(pet) ?? -Infinity) < RETRY_MS) return;
    this.asked.set(pet, now);
    const [w, h] = this.sheets.cell;
    for (const anim of ['idle', 'move', 'special'] as Anim[]) for (const dir of this.sheets.animations[anim].dirs) queueSheet(this.scene.load, this.scene.textures, this.fileOf(pet, anim, dir), w, h);
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
    const now = this.scene.time.now;
    const check = now >= this.nextCheck;
    if (check) this.nextCheck = now + CHECK_MS;
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
      // (Unseen for want of a sheet, even resting: shown once its sheets are in, else they're asked for again.)
      if (check && !v.view.sprite.visible) v.view.refresh();
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
