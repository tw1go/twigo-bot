import type Phaser from 'phaser';
import type { ClassArt, Dir, FxDef } from '../assets/types';
import type { FxLayer, FxLayers, FxPlay } from '../world/fx-layers';
import type { FxHandle, FxOpts, Pt, ShotOpts, Skill, SkillKit } from './skill-stage';

// ✨ The skills' effects in the world (battle maps): the same scripts as the class choice's preview (combat/skill-previews.ts,
// written against SkillKit) played on a real character at a real mob. The fighter's feet are the character's, its
// facing its real one (launch points per direction from the class's launch.json); every enemy slot of a script is the
// mobs the server says it hit (the target in the first slot the script uses, the others in the rest: combat/skill-slots.ts),
// a body a little above the feet. Each fx is played on the world's fx layers (world/fx-layers.ts, by the stage's own
// rules: sequence, hold loop, fades, a stretched length, shots with an arc, turning, a streak revealed past the pivot):
// a script's ground decals (z 0) on the ground layer, under every player and mob; the rest (z 3) on the front layer,
// over them; z 1 just behind the fighter. Damage numbers are the server's (world/mobs.ts), shown when the script's hit lands on that
// mob (onHit), so the scripts' own are left out, as are its trails and fades. A move of the fighter (a Lunge's dash) is
// played on the character as a draw offset toward the real mob it's at (Caster.nudge), and back: where it stands is the
// server's. Enemy points are read live, so a mob that moves mid-cast takes its effects along. The scripts are drawn facing right (SE): facing left (SW, W, NW) the whole skill is played
// mirrored round the fighter's feet (its points, angles and flips; the launch points of the matching right-hand facing).

const ANCHOR: Pt = { x: 32, y: 56 }; // the fighter's feet in the 64 cell (as the stage)
const BODY_UP = 12; // a mob's body above its feet

type Launch = Record<string, Partial<Record<Dir, Record<string, [number, number]>[]>>>;

/** Facing left: the right-hand facing whose launch points the mirrored skill uses. */
const MIRROR: Partial<Record<Dir, Dir>> = { sw: 'se', w: 'e', nw: 'ne' };

export interface Caster {
  /** The fighter's feet, now (world px). */
  feet: () => Pt;
  dir: Dir;
  /** The fighter's depth (fx under them sort just below). */
  depth: () => number;
  /** Draws the fighter this far (px) off where it stands, for a dash (the script's move); none: it stays put. */
  nudge?: (x: number, y: number) => void;
}

/** The stage's enemy slots (combat/skill-stage.ts): 1, 3 and 5 tiles along SE from the fighter's feet. */
const STAGE_SLOTS: Pt[] = [1, 3, 5].map((n) => ({ x: 16 * n, y: 8 * n }));
/** A dash stops this short of the mob it's at (px): beside it, not on top of it (which hid the mob and its hit). */
const DASH_SHORT = 20;

export class WorldSkills {
  private readonly launches = new Map<string, Promise<Launch | null>>();

  constructor(
    private readonly layers: FxLayers,
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

  /** Plays `skill` by `who` (of class art `art`); enemy slot n's feet are `slot(n)` (it may move meanwhile); `onHit(n)`
   *  when the script's hit lands on slot n. */
  async play(skill: Skill, art: ClassArt, who: Caster, slot: (n: number) => Pt, onHit?: (n: number) => void, scale = 1): Promise<void> {
    const launch = await this.launchOf(art);
    skill.run(this.kit(art, launch, who, slot, onHit, scale));
  }

  private kit(art: ClassArt, launch: Launch | null, who: Caster, slot: (n: number) => Pt, onHit?: (n: number) => void, scale = 1): SkillKit {
    const scene = this.layers.scene;
    const now = () => scene.time.now;
    const t0 = now();
    let cursor = 0;
    const feet = who.feet();
    // Facing left: the script runs in a mirrored space (as if facing right); what it draws is mirrored back.
    const facing = MIRROR[who.dir];
    const mirror = !!facing;
    const dir = facing ?? who.dir;
    const m = (p: Pt): Pt => (mirror ? { x: 2 * feet.x - p.x, y: p.y } : p);
    // Live: a mob that hops or chases mid-cast takes its effects with it (read when the script uses them).
    const targets: Pt[] = [0, 1, 2].map((n) => ({
      get x() {
        return m(slot(n)).x;
      },
      get y() {
        return m(slot(n)).y;
      },
    }));
    const body = (n: number): Pt => {
      const t = m(slot(n));
      return { x: t.x, y: t.y - BODY_UP };
    };
    let nudged: Pt = { x: 0, y: 0 };
    let dashing: Phaser.Tweens.Tween | null = null;
    const dash = (dx: number, dy: number): Pt => {
      if (Math.hypot(dx, dy) < 0.5) return { x: 0, y: 0 };
      const n = [0, 1, 2].reduce((a, b) => (Math.hypot(dx - STAGE_SLOTS[b].x, dy - STAGE_SLOTS[b].y) < Math.hypot(dx - STAGE_SLOTS[a].x, dy - STAGE_SLOTS[a].y) ? b : a));
      const S = STAGE_SLOTS[n];
      const R = { x: targets[n].x - feet.x, y: targets[n].y - feet.y };
      const lr = Math.hypot(R.x, R.y);
      if (lr < 1) return { x: 0, y: 0 };
      const turn = Math.atan2(R.y, R.x) - Math.atan2(S.y, S.x);
      const k = Math.max(0, lr - DASH_SHORT) / Math.hypot(S.x, S.y);
      const x = (dx * Math.cos(turn) - dy * Math.sin(turn)) * k;
      const y = (dx * Math.sin(turn) + dy * Math.cos(turn)) * k;
      return { x: mirror ? -x : x, y };
    };
    // A ground decal on the ground layer; under the fighter just behind them; the rest on the front layer.
    const layerOf = (z: 0 | 1 | 3 | undefined): FxLayer | number => (z === 0 ? 'ground' : z === 1 ? who.depth() - 0.4 : 'front');
    // Mirrored: flipped across; a shot turned to its flight is flipped upside down instead (the turn already points it left).
    const look = (o: FxOpts, shot: boolean): FxPlay => ({
      layer: layerOf(o.z ?? 3),
      flipX: shot && mirror ? !!o.flip : !!o.flip !== mirror,
      flipY: shot && mirror,
      angle: mirror && o.angle ? -o.angle : (o.angle ?? 0),
      frames: o.frames, hold: o.hold, ms: o.ms, fadeIn: o.fadeIn, fadeOut: o.fadeOut, life: o.life, length: o.length, scale,
    });
    const fps = (anim: string) => art.anims[anim]?.fps ?? 12;
    return {
      dir,
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
        const p = key && launch?.[anim]?.[dir]?.[frame]?.[key];
        if (p) return { x: f.x + p[0] - ANCHOR.x, y: f.y + p[1] - ANCHOR.y };
        const fork = art.launchPoints?.[dir]; // body-cell px (feet at 16, 46)
        if (fork) return { x: f.x + fork[0] - 16, y: f.y + fork[1] - 46 };
        return { x: f.x + 8, y: f.y - 20 };
      },
      at: (ms, fn) => {
        scene.time.delayedCall(Math.max(0, t0 + ms - now()), fn);
      },
      fx: (name, at, o = {}): FxHandle => {
        const h = this.layers.play(this.fx[name], m(at), look(o, false));
        return { kill: (fade?: number) => h?.kill(fade) };
      },
      shot: (name, from, to, o: ShotOpts) => {
        const turn = o.turn ?? true;
        this.layers.shot(this.fx[name], m(from), m(to), { ...look({ ...o.fx, z: o.z ?? 3 }, turn), speed: o.speed, arc: o.arc, turn, reveal: o.reveal, onArrive: o.onArrive, fadeOut: 0 });
      },
      hit: (n, o = {}) => {
        if (o.fx) this.layers.play(this.fx[o.fx], body(n), look({ z: o.z ?? 3 }, false));
        onHit?.(n);
      },
      number: () => {},
      hide: () => {},
      // The fighter's dash (a script's move: stage px off its feet, facing SE; 0,0 = back): turned and stretched from the
      // stage's nearest enemy slot onto the real mob there (stopping DASH_SHORT before it), mirrored back facing left, and
      // tweened on the character. Where it stands doesn't change (the script ends back at 0,0, as the stage does).
      move: (dx, dy, ms, ease) => {
        if (!who.nudge) return;
        const to = dash(dx, dy);
        const from = { ...nudged };
        dashing?.stop();
        const set = (k: number) => {
          nudged = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
          who.nudge!(Math.round(nudged.x), Math.round(nudged.y));
        };
        if (!ms) return set(1);
        dashing = scene.tweens.addCounter({ from: 0, to: 1, duration: ms, ease: ease === 'out' ? 'Quad.easeOut' : 'Linear', onUpdate: (tw) => set(tw.getValue() ?? 1) });
      },
      trail: () => {},
      flash: () => {},
      fade: () => {},
    };
  }
}
