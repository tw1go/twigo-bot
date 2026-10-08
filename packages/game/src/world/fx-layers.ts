import Phaser from 'phaser';
import type { FxDef } from '../assets/types';
import { GROUND_SHADOW_DEPTH, LABEL_DEPTH } from './depth';

// ✨ The world's effects on two layers (the rule for every effect): `ground`, flat on the floor (under every player and
// mob, over the ground: a slam's warning, a shockwave, a marker) and `front`, off the ground (over every player and mob,
// under the names: a hit, a thrown thing and its trail, a spark, an icon over a head). Players and mobs sort by their
// feet between the two. Three kinds: a sheet from an fx def (manifest fx, or a mob's fx; its `layer` picks where unless
// told), played once, looped for a while or held, at a world point or following one; a shot, a sheet flown straight or
// in an arc from one point to another, turned to its flight; and an effect drawn in code (a Graphics redrawn every frame,
// e.g. the Wire Tangle's spark). Each is updated every frame by `update` and goes by itself. Class skills
// (combat/world-skills.ts) and the mobs (world/mobs.ts) play theirs here.

export type FxLayer = 'ground' | 'front';

/** The two layers' depths. */
export const FX_DEPTH: Record<FxLayer, number> = { ground: GROUND_SHADOW_DEPTH + 5, front: LABEL_DEPTH - 100 };

export interface Pt {
  x: number;
  y: number;
}

/** How a sheet plays. */
export interface FxPlay {
  /** Its layer (else its def's, else front), or a depth of its own (e.g. just behind a character). */
  layer?: FxLayer | number;
  flipX?: boolean;
  flipY?: boolean;
  /** Turned (radians). */
  angle?: number;
  /** These frames in turn (else the sheet's). */
  frames?: number[];
  /** Loops frames from–to until `until` ms in, then plays on to the end. */
  hold?: { from: number; to: number; until: number };
  /** ms a frame (else its fps). */
  ms?: number;
  fadeIn?: number;
  fadeOut?: number;
  /** A looping sheet's life (ms; 4 s if not given; one that doesn't loop plays once). */
  life?: number;
  /** Stretched to this many px across. */
  length?: number;
  scale?: number;
  /** Kept at this point every frame (e.g. over someone's head). */
  follow?: () => Pt;
}

/** A shot: flown at `speed` px a second, `arc` px up at the middle, turned to its flight (unless `turn` is false). */
export interface ShotPlay extends FxPlay {
  speed: number;
  arc?: number;
  turn?: boolean;
  /** Revealed past its anchor as it leaves (a streak growing out of the hand). */
  reveal?: boolean;
  onArrive?: () => void;
}

export interface FxHandle {
  /** Ends it (fading out over `fade` ms). */
  kill(fade?: number): void;
}

interface Flight {
  from: Pt;
  to: Pt;
  t1: number;
  arc: number;
  turn: boolean;
  reveal: boolean;
  onArrive?: () => void;
}

interface Live {
  def: FxDef;
  img: Phaser.GameObjects.Image;
  /** Its sheet has numbered frames (a single image doesn't). */
  sheet: boolean;
  size: [number, number];
  x: number;
  y: number;
  angle: number;
  t0: number;
  seq: number[] | null;
  hold: FxPlay['hold'];
  ms: number;
  fadeIn: number;
  fadeOut: number;
  end: number;
  length?: number;
  scale: number;
  follow?: () => Pt;
  path?: Flight;
}

interface Drawn {
  g: Phaser.GameObjects.Graphics;
  t0: number;
  end: number;
  fadeOut: number;
  /** Draws it `t` ms in (the Graphics cleared); false: it's over. */
  draw: (g: Phaser.GameObjects.Graphics, t: number) => boolean | void;
  path?: Flight & { at: (p: Pt, angle: number) => void };
}

/** Where a shot is `p` (0–1) along its flight, and the way it's heading. */
function along(f: Flight, p: number): { at: Pt; angle: number } {
  const { from, to, arc } = f;
  return {
    at: { x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p - arc * 4 * p * (1 - p) },
    angle: Math.atan2(to.y - from.y - arc * 4 * (1 - 2 * p), to.x - from.x),
  };
}

export class FxLayers {
  private readonly lives: Live[] = [];
  private readonly drawn: Drawn[] = [];

  constructor(readonly scene: Phaser.Scene) {}

  private get now(): number {
    return this.scene.time.now;
  }

  /** A layer's depth (a number is a depth of its own); else the def's layer, else front. */
  depthOf(layer: FxLayer | number | undefined, def?: FxDef): number {
    if (typeof layer === 'number') return layer;
    return FX_DEPTH[layer ?? def?.layer ?? 'front'];
  }

  /** Plays a sheet at a world point (null when its art isn't loaded). */
  play(def: FxDef | undefined, at: Pt, o: FxPlay = {}): FxHandle | null {
    const l = this.spawn(def, at, o);
    return l && this.handle(l);
  }

  /** Flies a sheet from → to; `onArrive` when it gets there (even without art: after the same time). */
  shot(def: FxDef | undefined, from: Pt, to: Pt, o: ShotPlay): FxHandle | null {
    const t1 = this.now + (Math.hypot(to.x - from.x, to.y - from.y) / Math.max(1, o.speed)) * 1000;
    const l = this.spawn(def, from, o);
    if (!l) {
      this.scene.time.delayedCall(t1 - this.now, () => o.onArrive?.());
      return null;
    }
    l.end = Infinity;
    l.fadeOut = 0;
    l.path = { from, to, t1, arc: o.arc ?? 0, turn: o.turn ?? true, reveal: !!o.reveal, onArrive: o.onArrive };
    this.draw(l);
    return this.handle(l);
  }

  /** An effect drawn in code on a layer: `draw(g, t)` every frame (g cleared, at the world's origin) until `life` ms
   *  or it returns false. */
  drawFx(layer: FxLayer | number, draw: Drawn['draw'], life = Infinity, fadeOut = 0): FxHandle {
    const d: Drawn = { g: this.scene.add.graphics().setDepth(this.depthOf(layer)), t0: this.now, end: this.now + life, fadeOut, draw };
    this.drawn.push(d);
    this.redraw(d);
    return this.handleDrawn(d);
  }

  /** A drawn shot: `draw(g, t)` with g moved to where it is (and turned to its flight if `turn`), flown from → to. */
  drawnShot(layer: FxLayer | number, from: Pt, to: Pt, o: { speed: number; arc?: number; turn?: boolean; onArrive?: () => void }, draw: Drawn['draw']): FxHandle {
    const t1 = this.now + (Math.hypot(to.x - from.x, to.y - from.y) / Math.max(1, o.speed)) * 1000;
    const d: Drawn = { g: this.scene.add.graphics().setDepth(this.depthOf(layer)), t0: this.now, end: Infinity, fadeOut: 0, draw };
    d.path = {
      from, to, t1, arc: o.arc ?? 0, turn: o.turn ?? true, reveal: false, onArrive: o.onArrive,
      at: (p, angle) => d.g.setPosition(Math.round(p.x), Math.round(p.y)).setRotation(o.turn ?? true ? angle : 0),
    };
    this.drawn.push(d);
    this.redraw(d);
    return this.handleDrawn(d);
  }

  /** Every frame: shots fly and arrive, the rest play out and go. */
  update(): void {
    const now = this.now;
    for (const l of [...this.lives]) {
      if (l.path && now >= l.path.t1) {
        this.drop(l);
        l.path.onArrive?.();
      } else if (now >= l.end) this.drop(l);
      else this.draw(l);
    }
    for (const d of [...this.drawn]) {
      if (d.path && now >= d.path.t1) {
        this.dropDrawn(d);
        d.path.onArrive?.();
      } else if (now >= d.end) this.dropDrawn(d);
      else this.redraw(d);
    }
  }

  /** Everything gone (leaving the scene). */
  clear(): void {
    for (const l of [...this.lives]) this.drop(l);
    for (const d of [...this.drawn]) this.dropDrawn(d);
  }

  private handle(l: Live): FxHandle {
    return {
      kill: (fade = l.fadeOut) => {
        l.fadeOut = fade;
        l.end = Math.min(l.end, this.now + fade); // (a shot killed goes without arriving)
      },
    };
  }

  private handleDrawn(d: Drawn): FxHandle {
    return {
      kill: (fade = d.fadeOut) => {
        d.fadeOut = fade;
        d.end = Math.min(d.end, this.now + fade);
      },
    };
  }

  private spawn(def: FxDef | undefined, at: Pt, o: FxPlay): Live | null {
    const size = def?.frame ?? def?.size;
    if (!def?.file || !size || !this.scene.textures.exists(def.file)) return null;
    const [w, h] = size;
    const [ax, ay] = def.anchor ?? [w / 2, h / 2];
    // (A flipped image keeps its anchor on the same art pixel: the origin flips with it, as the world's props do.)
    const fx = !!o.flipX;
    const fy = !!o.flipY;
    const img = this.scene.add.image(at.x, at.y, def.file).setDepth(this.depthOf(o.layer, def));
    img.setFlipX(fx).setFlipY(fy).setOrigin((fx ? w - ax : ax) / w, (fy ? h - ay : ay) / h);
    const ms = o.ms ?? 1000 / (def.fps ?? 12);
    const seq = o.frames ?? null;
    const frames = def.frames ?? 1;
    const looping = !seq && !o.hold && !!def.loop;
    const length = seq ? seq.length * ms : o.hold ? o.hold.until + (frames - 1 - o.hold.to) * ms : frames * ms;
    const now = this.now;
    const l: Live = {
      def, img, sheet: img.texture.has('0'), size: [w, h], x: at.x, y: at.y, angle: o.angle ?? 0, t0: now, seq, hold: o.hold, ms,
      fadeIn: o.fadeIn ?? 0, fadeOut: o.fadeOut ?? 0, end: now + (looping ? (o.life ?? 4000) : length), length: o.length, scale: o.scale ?? 1, follow: o.follow,
    };
    this.lives.push(l);
    this.draw(l);
    return l;
  }

  private drop(l: Live): void {
    l.img.destroy();
    this.lives.splice(this.lives.indexOf(l), 1);
  }

  private dropDrawn(d: Drawn): void {
    d.g.destroy();
    this.drawn.splice(this.drawn.indexOf(d), 1);
  }

  private redraw(d: Drawn): void {
    const now = this.now;
    const t = now - d.t0;
    d.g.clear();
    if (d.path) {
      const p = Math.min(1, t / Math.max(1, d.path.t1 - d.t0));
      const a = along(d.path, p);
      d.path.at(a.at, a.angle);
    }
    if (d.draw(d.g, t) === false) d.end = now;
    let alpha = 1;
    if (d.fadeOut && Number.isFinite(d.end)) alpha = Math.min(1, Math.max(0, (d.end - now) / d.fadeOut));
    d.g.setAlpha(alpha);
  }

  private draw(l: Live): void {
    const now = this.now;
    const [w, h] = l.size;
    const [ax] = l.def.anchor ?? [w / 2, h / 2];
    const t = now - l.t0;
    const f = this.frameOf(l, t);
    l.img.setVisible(f >= 0);
    if (f < 0) return;
    if (l.sheet) l.img.setFrame(f);
    let alpha = 1;
    if (l.fadeIn) alpha = Math.min(alpha, t / l.fadeIn);
    if (l.fadeOut && Number.isFinite(l.end)) alpha = Math.min(alpha, (l.end - now) / l.fadeOut);
    if (l.follow) ({ x: l.x, y: l.y } = l.follow());
    let x = l.x;
    let y = l.y;
    let angle = l.angle;
    let clip = 0;
    if (l.path) {
      const a = along(l.path, Math.min(1, (now - l.t0) / Math.max(1, l.path.t1 - l.t0)));
      ({ x, y } = a.at);
      if (l.path.turn) angle = a.angle;
      if (l.path.reveal) clip = Math.max(0, ax - Math.hypot(x - l.path.from.x, y - l.path.from.y));
    }
    l.img.setPosition(Math.round(x), Math.round(y)).setRotation(angle).setAlpha(Math.max(0, Math.min(1, alpha)));
    l.img.setScale((l.length ? l.length / w : 1) * l.scale, l.scale);
    if (clip) l.img.setCrop(clip, 0, w - clip, h);
    else if (l.img.isCropped) l.img.setCrop();
  }

  /** The sheet frame showing `t` ms after it started. */
  private frameOf(l: Live, t: number): number {
    const n = Math.floor(t / l.ms);
    if (l.seq) return l.seq[Math.min(n, l.seq.length - 1)];
    const frames = l.def.frames ?? 1;
    if (l.hold) {
      if (n < l.hold.from) return n;
      if (t < l.hold.until) return l.hold.from + ((n - l.hold.from) % (l.hold.to - l.hold.from + 1));
      const after = Math.floor((t - l.hold.until) / l.ms);
      return Math.min(frames - 1, l.hold.to + 1 + after);
    }
    return l.def.loop ? n % frames : Math.min(n, frames - 1);
  }
}
