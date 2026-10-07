import type Phaser from 'phaser';
import type { CharacterDefs, ClassArt, ClassesDefs, Dir, FxDef } from '../assets/types';
import type { Outfit } from '../characters/doll';
import { CELL, drawPose } from '../characters/kit-art';

// 🎯 A small stage that plays a class's skills (combat/skill-previews.ts) on a canvas: the fighter in their combat
// poses and the class fx, aimed at invisible enemies (nothing marks where they stand until a hit lands there). The
// skills only talk to the SkillKit below, so the real combat can play the same sequences in the world later.
//
// Layers, bottom to top: the ground, ground decals (z 0), fx under the fighter (z 1), the fighter, fx over them (z 3).
// Fx that point east (projectiles, streaks) are turned to their flight angle. Damage numbers are DOM (onNumber).

export interface Pt {
  x: number;
  y: number;
}

export type NumberKind = 'hit' | 'crit' | 'dot' | 'mint';

export interface FxOpts {
  /** 0: a ground decal; 1: under the fighter; 3 (default): over them. */
  z?: 0 | 1 | 3;
  /** Radians, the art's east turned to it. */
  angle?: number;
  flip?: boolean;
  /** The frames to play in order (default: all of them once, or forever for a looping sheet until killed). */
  frames?: number[];
  /** Frames from..to looped until `until` ms after it starts, then the rest of the sheet (a lingering cloud). */
  hold?: { from: number; to: number; until: number };
  /** Frame duration (default: the sheet's fps). */
  ms?: number;
  fadeIn?: number;
  /** Fades out over this many ms before it ends (a loop: when killed or its `life` runs out). */
  fadeOut?: number;
  /** A looping sheet stops after this many ms. */
  life?: number;
  /** Stretched along its x to this many px (a lightning link). */
  length?: number;
}

export interface ShotOpts {
  /** px a second */
  speed: number;
  z?: 0 | 1 | 3;
  /** Bows upward by this many px in the middle (a lob). */
  arc?: number;
  /** Turned to the flight angle (default true; round things say false). */
  turn?: boolean;
  onArrive?: () => void;
  /** Fades over the last ms of the flight. */
  fadeOut?: number;
  /** The streak behind the pivot is hidden until it has flown that far (it never trails out behind the shooter). */
  reveal?: boolean;
  /** How the flying piece plays (a hold loop while it travels). */
  fx?: FxOpts;
}

export interface FxHandle {
  kill(fadeMs?: number): void;
}

export interface SkillKit {
  readonly dir: Dir;
  /** The fighter's feet. */
  readonly feet: Pt;
  /** Where the invisible enemies stand (their feet), nearest first: about 1, 3 and 5 tiles away. */
  readonly targets: Pt[];
  /** Enemy n's body (where hits land). */
  body(n: number): Pt;
  /** A point off the fighter's feet. */
  self(dx: number, dy: number): Pt;
  /** Queues body frames after whatever is queued (each `ms` long, default the anim's fps); returns when each starts. */
  pose(anim: string, frames: number[], ms?: number | number[]): number[];
  /** A launch point on a pose frame: launch.json's `key` (palm, tip, lid, balm…), or the Slingshot's fork. */
  launch(anim: string, frame: number, key?: string): Pt;
  /** Runs `fn` this many ms after the skill starts. */
  at(ms: number, fn: () => void): void;
  fx(name: string, at: Pt, o?: FxOpts): FxHandle;
  /** Something flying from `from` to `to`. */
  shot(name: string, from: Pt, to: Pt, o: ShotOpts): void;
  /** A hit on enemy n: its fx on the body (if any) and a damage number. */
  hit(n: number, o?: { fx?: string; kind?: NumberKind; z?: 0 | 1 | 3 }): void;
  number(at: Pt, kind?: NumberKind): void;
  /** Weapon layers whose file names contain `part` hidden (a thrown lid or plank) or shown again. */
  hide(part: string, on: boolean): void;
  /** Moves the fighter to this offset from their spot over `ms` (a lunge; 0, 0 brings them back). */
  move(dx: number, dy: number, ms: number): void;
}

export interface Skill {
  name: string;
  /** Plans the skill on the kit (fx and hits inside k.at). */
  run(k: SkillKit): void;
}

export interface StageArt {
  scene: Phaser.Scene;
  C: CharacterDefs;
  K: ClassesDefs;
  outfit: Outfit;
  art: ClassArt;
  fx: Record<string, FxDef>;
  /** launch.json points: anim → dir → frame → key → [x, y] in the 64 cell. */
  launch: Record<string, Partial<Record<Dir, Record<string, [number, number]>[]>>> | null;
  /** The ground under it all. */
  ground: HTMLCanvasElement;
}

/** The stage's size in art px, where the fighter stands, and the step between enemies (one tile toward SE). */
export const STAGE_W = 300;
export const STAGE_H = 176;
const FEET: Pt = { x: 84, y: 70 };
const TILE: Pt = { x: 16, y: 8 };
const BODY_UP = 9; // an enemy's body above its feet
const ANCHOR: Pt = { x: 32, y: 56 }; // the fighter's feet in the 64 cell
const READY = 'walk-ready';
export const GAP_MS = 600; // walk-ready between skills
const NUMBER_MS = 800;

interface Live {
  def: FxDef;
  img: CanvasImageSource | null;
  x: number;
  y: number;
  z: 0 | 1 | 3;
  angle: number;
  flip: boolean;
  t0: number;
  seq: number[] | null;
  hold: FxOpts['hold'];
  ms: number;
  fadeIn: number;
  fadeOut: number;
  end: number; // ms (stage time) it's gone; Infinity while looping
  length?: number;
  /** For a shot: where it's flying, and the hidden-streak cut. */
  path?: { from: Pt; to: Pt; t1: number; arc: number; turn: boolean; onArrive?: () => void; reveal: boolean };
}

export class SkillStage {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cell = document.createElement('canvas');
  private readonly cellCtx: CanvasRenderingContext2D;
  private now = 0;
  private t0 = 0; // when the playing skill started
  private poses: { anim: string; frame: number; start: number; end: number }[] = [];
  private events: { at: number; fn: () => void }[] = [];
  private lives: Live[] = [];
  private hidden = new Set<string>();
  private offset: Pt = { x: 0, y: 0 };
  private moveTo: { from: Pt; to: Pt; t0: number; t1: number } | null = null;
  private busyUntil = 0;
  private playing: Skill | null = null;
  private readyFrom = 0;

  /** A damage number at a stage point (the host draws it). */
  onNumber: (at: Pt, text: string, kind: NumberKind) => void = () => {};

  constructor(private readonly a: StageArt) {
    this.canvas.width = STAGE_W;
    this.canvas.height = STAGE_H;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.cell.width = this.cell.height = CELL;
    this.cellCtx = this.cell.getContext('2d')!;
  }

  /** Plays a skill now (what was playing is cut short). */
  play(skill: Skill): void {
    this.clear();
    this.playing = skill;
    this.t0 = this.now;
    skill.run(this.kit());
    this.events.sort((x, y) => x.at - y.at);
  }

  /** True while the skill (its poses, events, fx and numbers) is still going. */
  get busy(): boolean {
    return !!this.playing && (this.now < this.busyUntil || this.events.length > 0 || this.lives.length > 0 || this.poses.some((p) => p.end > this.now));
  }

  /** Back to walk-ready (between skills). */
  rest(): void {
    this.clear();
    this.playing = null;
    this.readyFrom = this.now;
  }

  private clear(): void {
    this.poses = [];
    this.events = [];
    this.lives = [];
    this.hidden.clear();
    this.offset = { x: 0, y: 0 };
    this.moveTo = null;
    this.busyUntil = this.now;
  }

  /** Advances to `now` (ms) and draws. */
  update(now: number): void {
    this.now = now;
    while (this.events.length && this.events[0].at <= now) this.events.shift()!.fn();
    if (this.moveTo) {
      const m = this.moveTo;
      const p = Math.min(1, (now - m.t0) / Math.max(1, m.t1 - m.t0));
      this.offset = { x: m.from.x + (m.to.x - m.from.x) * p, y: m.from.y + (m.to.y - m.from.y) * p };
      if (p >= 1) this.moveTo = null;
    }
    // Shots arrive; done fx go.
    for (const l of [...this.lives]) {
      if (l.path && now >= l.path.t1) {
        this.lives.splice(this.lives.indexOf(l), 1);
        l.path.onArrive?.();
      } else if (now >= l.end) this.lives.splice(this.lives.indexOf(l), 1);
    }
    this.draw();
  }

  private draw(): void {
    const ctx = this.ctx;
    ctx.globalAlpha = 1;
    ctx.drawImage(this.a.ground, 0, 0);
    for (const z of [0, 1] as const) for (const l of this.lives) if (l.z === z) this.drawFx(l);
    this.drawFighter();
    for (const l of this.lives) if (l.z === 3) this.drawFx(l);
  }

  private drawFighter(): void {
    const { anim, frame } = this.poseNow();
    const c = this.cellCtx;
    c.clearRect(0, 0, CELL, CELL);
    drawPose(c, this.a.scene, this.a.C, this.a.K, this.a.outfit, this.a.art, anim, this.dir, frame, 0, 0, [...this.hidden]);
    this.ctx.globalAlpha = 1;
    this.ctx.drawImage(this.cell, Math.round(FEET.x + this.offset.x - ANCHOR.x), Math.round(FEET.y + this.offset.y - ANCHOR.y));
  }

  private poseNow(): { anim: string; frame: number } {
    const p = this.poses.find((x) => x.start <= this.now && this.now < x.end) ?? (this.poses.length && this.now < this.poses[this.poses.length - 1].end ? this.poses[0] : null);
    if (p) return p;
    const r = this.a.art.anims[READY];
    return { anim: READY, frame: Math.floor(((this.now - this.readyFrom) / 1000) * r.fps) % r.frames };
  }

  private drawFx(l: Live): void {
    if (!l.img || !l.def.frame) return;
    const [w, h] = l.def.frame;
    const [ax, ay] = l.def.anchor ?? [w / 2, h / 2];
    const t = this.now - l.t0;
    const f = this.frameOf(l, t);
    if (f < 0) return;
    const per = l.def.perRow ?? l.def.frames ?? 1;
    const sx = (f % per) * w;
    const sy = Math.floor(f / per) * h;
    let alpha = 1;
    if (l.fadeIn) alpha = Math.min(alpha, t / l.fadeIn);
    if (l.fadeOut && Number.isFinite(l.end)) alpha = Math.min(alpha, (l.end - this.now) / l.fadeOut);
    let x = l.x;
    let y = l.y;
    let angle = l.angle;
    let clip = 0; // px of the streak hidden behind the pivot
    if (l.path) {
      const p = Math.min(1, (this.now - l.t0) / Math.max(1, l.path.t1 - l.t0));
      const { from, to, arc } = l.path;
      x = from.x + (to.x - from.x) * p;
      y = from.y + (to.y - from.y) * p - arc * 4 * p * (1 - p);
      if (l.path.turn) angle = Math.atan2(to.y - from.y - arc * 4 * (1 - 2 * p), to.x - from.x);
      if (l.path.reveal) clip = Math.max(0, ax - Math.hypot(x - from.x, y - from.y));
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.translate(Math.round(x), Math.round(y));
    if (angle) ctx.rotate(angle);
    ctx.scale((l.flip ? -1 : 1) * (l.length ? l.length / w : 1), 1);
    ctx.drawImage(l.img, sx + clip, sy, w - clip, h, -ax + clip, -ay, w - clip, h);
    ctx.restore();
  }

  /** The sheet frame showing `t` ms after it started (-1 before the first). */
  private frameOf(l: Live, t: number): number {
    const n = Math.floor(t / l.ms);
    if (l.seq) return l.seq[Math.min(n, l.seq.length - 1)];
    const frames = l.def.frames ?? 1;
    if (l.hold) {
      const into = l.hold.from + (n - l.hold.from);
      if (n < l.hold.from) return n;
      if (t < l.hold.until) return l.hold.from + ((into - l.hold.from) % (l.hold.to - l.hold.from + 1));
      const after = Math.floor((t - l.hold.until) / l.ms);
      return Math.min(frames - 1, l.hold.to + 1 + after);
    }
    return l.def.loop ? n % frames : Math.min(n, frames - 1);
  }

  private get dir(): Dir {
    return 'se';
  }

  private kit(): SkillKit {
    const stage = this;
    const t0 = this.t0;
    const targets = [1, 3, 5].map((n) => ({ x: FEET.x + TILE.x * n, y: FEET.y + TILE.y * n }));
    let cursor = t0;
    const fps = (anim: string) => this.a.art.anims[anim]?.fps ?? 12;
    const spawn = (name: string, at: Pt, o: FxOpts): Live | null => {
      const def = this.a.fx[name];
      if (!def?.file) return null;
      const img = this.a.scene.textures.exists(def.file) ? (this.a.scene.textures.get(def.file).getSourceImage() as CanvasImageSource) : null;
      const ms = o.ms ?? 1000 / (def.fps ?? 12);
      const seq = o.frames ?? null;
      const frames = def.frames ?? 1;
      const looping = !seq && !o.hold && !!def.loop;
      const length = seq ? seq.length * ms : o.hold ? o.hold.until + (frames - 1 - o.hold.to) * ms : frames * ms;
      const life = looping ? (o.life ?? Infinity) : length;
      const l: Live = {
        def, img, x: at.x, y: at.y, z: o.z ?? 3, angle: o.angle ?? 0, flip: !!o.flip, t0: stage.now, seq, hold: o.hold, ms,
        fadeIn: o.fadeIn ?? 0, fadeOut: o.fadeOut ?? 0, end: stage.now + life, length: o.length,
      };
      stage.lives.push(l);
      return l;
    };
    return {
      dir: this.dir,
      feet: FEET,
      targets,
      body: (n) => ({ x: targets[n].x, y: targets[n].y - BODY_UP }),
      self: (dx, dy) => ({ x: FEET.x + stage.offset.x + dx, y: FEET.y + stage.offset.y + dy }),
      pose(anim, frames, ms) {
        const starts: number[] = [];
        frames.forEach((frame, i) => {
          const d = Array.isArray(ms) ? (ms[i] ?? ms[ms.length - 1]) : (ms ?? 1000 / fps(anim));
          starts.push(cursor - t0);
          stage.poses.push({ anim, frame, start: cursor, end: cursor + d });
          cursor += d;
        });
        stage.busyUntil = Math.max(stage.busyUntil, cursor);
        return starts;
      },
      launch(anim, frame, key) {
        const at = stage.offset;
        const pts = stage.a.launch?.[anim]?.[stage.dir]?.[frame];
        const p = key && pts?.[key];
        if (p) return { x: FEET.x + at.x + p[0] - ANCHOR.x, y: FEET.y + at.y + p[1] - ANCHOR.y };
        const fork = stage.a.art.launchPoints?.[stage.dir]; // body-cell px (the body's feet at 16, 46)
        if (fork) return { x: FEET.x + at.x + fork[0] - 16, y: FEET.y + at.y + fork[1] - 46 };
        return { x: FEET.x + at.x + 8, y: FEET.y + at.y - 20 };
      },
      at(ms, fn) {
        stage.events.push({ at: t0 + ms, fn });
      },
      fx(name, at, o = {}) {
        const l = spawn(name, at, o);
        return {
          kill(fade = l?.fadeOut ?? 0) {
            if (!l) return;
            l.fadeOut = fade;
            l.end = Math.min(l.end, stage.now + fade);
          },
        };
      },
      shot(name, from, to, o) {
        const l = spawn(name, from, { ...o.fx, z: o.z ?? 3 });
        const t1 = stage.now + (Math.hypot(to.x - from.x, to.y - from.y) / o.speed) * 1000;
        if (!l) {
          stage.events.push({ at: t1, fn: () => o.onArrive?.() });
          stage.events.sort((x, y) => x.at - y.at);
          return;
        }
        l.end = Infinity;
        l.fadeOut = 0;
        l.path = { from, to, t1, arc: o.arc ?? 0, turn: o.turn ?? true, onArrive: o.onArrive, reveal: !!o.reveal };
      },
      hit(n, o = {}) {
        const b = { x: targets[n].x, y: targets[n].y - BODY_UP };
        if (o.fx) spawn(o.fx, b, { z: o.z ?? 3 });
        this.number(b, o.kind);
      },
      number(at, kind = 'hit') {
        const crit = kind === 'crit' || (kind === 'hit' && Math.random() < 0.15);
        const base = kind === 'dot' || kind === 'mint' ? 4 + Math.floor(Math.random() * 9) : 12 + Math.floor(Math.random() * 37);
        stage.onNumber(at, String(crit ? base * 2 + Math.floor(Math.random() * 10) : base), crit ? 'crit' : kind);
        stage.busyUntil = Math.max(stage.busyUntil, stage.now + NUMBER_MS);
      },
      hide(part, on) {
        if (on) stage.hidden.add(part);
        else stage.hidden.delete(part);
      },
      move(dx, dy, ms) {
        stage.moveTo = { from: { ...stage.offset }, to: { x: dx, y: dy }, t0: stage.now, t1: stage.now + ms };
      },
    };
  }
}
