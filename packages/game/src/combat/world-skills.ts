import Phaser from 'phaser';
import type { ClassArt, Dir, FxDef } from '../assets/types';
import { GROUND_SHADOW_DEPTH, LABEL_DEPTH } from '../world/depth';
import type { FxHandle, FxOpts, Pt, ShotOpts, Skill, SkillKit } from './skill-stage';

// ✨ The skills' effects in the world (battle maps): the same scripts as the class choice's preview (combat/skill-previews.ts,
// written against SkillKit) played on a real character at a real mob. The fighter's feet are the character's, its
// facing its real one (launch points per direction from the class's launch.json); every enemy slot of a script is the
// mobs the server says it hit (the target in the first slot the script uses, the others in the rest: combat/skill-slots.ts),
// a body a little above the feet. Each fx is a sprite updated every
// frame by the stage's own rules (sequence, hold loop, fades, a stretched length, shots with an arc, turning, a streak
// revealed past the pivot). Damage numbers are the server's (world/mobs.ts), so the scripts' are left out, as are the
// moves of the fighter itself (lunges, trails, fades): where you stand is the server's.

const ANCHOR: Pt = { x: 32, y: 56 }; // the fighter's feet in the 64 cell (as the stage)
const BODY_UP = 12; // a mob's body above its feet
const Z_GROUND = GROUND_SHADOW_DEPTH + 5;
const Z_OVER = LABEL_DEPTH - 100; // over the world, under the names

type Launch = Record<string, Partial<Record<Dir, Record<string, [number, number]>[]>>>;

interface Live {
  def: FxDef;
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  angle: number;
  t0: number;
  seq: number[] | null;
  hold: FxOpts['hold'];
  ms: number;
  fadeIn: number;
  fadeOut: number;
  end: number;
  length?: number;
  path?: { from: Pt; to: Pt; t1: number; arc: number; turn: boolean; onArrive?: () => void; reveal: boolean };
}

export interface Caster {
  /** The fighter's feet, now (world px). */
  feet: () => Pt;
  dir: Dir;
  /** The fighter's depth (fx under them sort just below). */
  depth: () => number;
}

export class WorldSkills {
  private readonly lives: Live[] = [];
  private readonly launches = new Map<string, Promise<Launch | null>>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly fx: Record<string, FxDef>,
    private readonly asset: (file: string) => string,
  ) {}

  /** A class's launch points (fetched once). */
  private launchOf(art: ClassArt): Promise<Launch | null> {
    const f = art.launch;
    if (!f) return Promise.resolve(null);
    let p = this.launches.get(f);
    if (!p) {
      p = fetch(this.asset(f)).then((r) => (r.ok ? r.json() : null)).then((j) => (j?.points ?? null) as Launch | null).catch(() => null);
      this.launches.set(f, p);
    }
    return p;
  }

  /** Plays `skill` by `who` (of class art `art`); enemy slot n's feet are `slot(n)` (it may move meanwhile). */
  async play(skill: Skill, art: ClassArt, who: Caster, slot: (n: number) => Pt): Promise<void> {
    const launch = await this.launchOf(art);
    skill.run(this.kit(art, launch, who, slot));
  }

  private kit(art: ClassArt, launch: Launch | null, who: Caster, slot: (n: number) => Pt): SkillKit {
    const now = () => this.scene.time.now;
    const t0 = now();
    let cursor = 0;
    const feet = who.feet();
    const targets = [0, 1, 2].map((n) => slot(n));
    const body = (n: number): Pt => {
      const t = slot(n);
      return { x: t.x, y: t.y - BODY_UP };
    };
    const depthOf = (z: 0 | 1 | 3 | undefined) => (z === 0 ? Z_GROUND : z === 1 ? who.depth() - 0.4 : Z_OVER);
    const spawn = (name: string, at: Pt, o: FxOpts): Live | null => {
      const def = this.fx[name];
      if (!def?.file || !def.frame || !this.scene.textures.exists(def.file)) return null;
      const [w, h] = def.frame;
      const [ax, ay] = def.anchor ?? [w / 2, h / 2];
      const img = this.scene.add.image(at.x, at.y, def.file, 0).setOrigin(ax / w, ay / h).setDepth(depthOf(o.z ?? 3)).setFlipX(!!o.flip);
      const ms = o.ms ?? 1000 / (def.fps ?? 12);
      const seq = o.frames ?? null;
      const frames = def.frames ?? 1;
      const looping = !seq && !o.hold && !!def.loop;
      const length = seq ? seq.length * ms : o.hold ? o.hold.until + (frames - 1 - o.hold.to) * ms : frames * ms;
      const l: Live = {
        def, img, x: at.x, y: at.y, angle: o.angle ?? 0, t0: now(), seq, hold: o.hold, ms, fadeIn: o.fadeIn ?? 0, fadeOut: o.fadeOut ?? 0,
        end: now() + (looping ? (o.life ?? 4000) : length), length: o.length,
      };
      this.lives.push(l);
      this.draw(l);
      return l;
    };
    const fps = (anim: string) => art.anims[anim]?.fps ?? 12;
    return {
      dir: who.dir,
      feet,
      targets,
      body: (n) => body(n),
      self: (dx, dy) => ({ x: feet.x + dx, y: feet.y + dy }),
      pose(anim, frames, ms) {
        // (The character plays its pose itself: these are only the times each frame starts.)
        return frames.map((_, i) => {
          const at = cursor;
          cursor += Array.isArray(ms) ? (ms[i] ?? ms[ms.length - 1]) : (ms ?? 1000 / fps(anim));
          return at;
        });
      },
      launch(anim, frame, key) {
        const f = who.feet();
        const p = key && launch?.[anim]?.[who.dir]?.[frame]?.[key];
        if (p) return { x: f.x + p[0] - ANCHOR.x, y: f.y + p[1] - ANCHOR.y };
        const fork = art.launchPoints?.[who.dir]; // body-cell px (feet at 16, 46)
        if (fork) return { x: f.x + fork[0] - 16, y: f.y + fork[1] - 46 };
        return { x: f.x + 8, y: f.y - 20 };
      },
      at: (ms, fn) => {
        this.scene.time.delayedCall(Math.max(0, t0 + ms - now()), fn);
      },
      fx: (name, at, o = {}): FxHandle => {
        const l = spawn(name, at, o);
        return {
          kill: (fade = l?.fadeOut ?? 0) => {
            if (!l) return;
            l.fadeOut = fade;
            l.end = Math.min(l.end, now() + fade);
          },
        };
      },
      shot: (name, from, to, o: ShotOpts) => {
        const l = spawn(name, from, { ...o.fx, z: o.z ?? 3 });
        const t1 = now() + (Math.hypot(to.x - from.x, to.y - from.y) / o.speed) * 1000;
        if (!l) {
          this.scene.time.delayedCall(t1 - now(), () => o.onArrive?.());
          return;
        }
        l.end = Infinity;
        l.fadeOut = 0;
        l.path = { from, to, t1, arc: o.arc ?? 0, turn: o.turn ?? true, onArrive: o.onArrive, reveal: !!o.reveal };
        this.draw(l);
      },
      hit: (n, o = {}) => {
        if (o.fx) spawn(o.fx, body(n), { z: o.z ?? 3 });
      },
      number: () => {},
      hide: () => {},
      move: () => {},
      trail: () => {},
      flash: () => {},
      fade: () => {},
    };
  }

  /** Every frame: shots fly and arrive, the rest play out and go. */
  update(): void {
    const now = this.scene.time.now;
    for (const l of [...this.lives]) {
      if (l.path && now >= l.path.t1) {
        this.drop(l);
        l.path.onArrive?.();
      } else if (now >= l.end) this.drop(l);
      else this.draw(l);
    }
  }

  private drop(l: Live): void {
    l.img.destroy();
    this.lives.splice(this.lives.indexOf(l), 1);
  }

  private draw(l: Live): void {
    const now = this.scene.time.now;
    const [w, h] = l.def.frame!;
    const [ax] = l.def.anchor ?? [w / 2, h / 2];
    const t = now - l.t0;
    const f = this.frameOf(l, t);
    l.img.setVisible(f >= 0);
    if (f < 0) return;
    l.img.setFrame(f);
    let alpha = 1;
    if (l.fadeIn) alpha = Math.min(alpha, t / l.fadeIn);
    if (l.fadeOut && Number.isFinite(l.end)) alpha = Math.min(alpha, (l.end - now) / l.fadeOut);
    let x = l.x;
    let y = l.y;
    let angle = l.angle;
    let clip = 0;
    if (l.path) {
      const p = Math.min(1, (now - l.t0) / Math.max(1, l.path.t1 - l.t0));
      const { from, to, arc } = l.path;
      x = from.x + (to.x - from.x) * p;
      y = from.y + (to.y - from.y) * p - arc * 4 * p * (1 - p);
      if (l.path.turn) angle = Math.atan2(to.y - from.y - arc * 4 * (1 - 2 * p), to.x - from.x);
      if (l.path.reveal) clip = Math.max(0, ax - Math.hypot(x - from.x, y - from.y));
    }
    l.img.setPosition(Math.round(x), Math.round(y)).setRotation(angle).setAlpha(Math.max(0, Math.min(1, alpha)));
    l.img.setScale(l.length ? l.length / w : 1, 1);
    if (clip) l.img.setCrop(clip, 0, w - clip, h);
    else if (l.img.isCropped) l.img.setCrop();
  }

  /** The sheet frame showing `t` ms after it started (as the stage). */
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
