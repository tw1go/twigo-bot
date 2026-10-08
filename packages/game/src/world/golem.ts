import Phaser from 'phaser';
import type { GolemChange, TownGolem, TownMobFacing, TownServerMessage } from '@mikazuki/shared';
import type { FxDef, MobZone, TownMap, Vec2 } from '../assets/types';
import { BossBar } from '../ui/boss-bar';
import type { FxLayers, Pt } from './fx-layers';
import { GOLEM_PIT, type Mob, type Mobs } from './mobs';

// 🗿 The Scrapheap Golem in the game (the field boss; the server runs it: bot web/town-golem.ts). It's a mob of world/
// mobs.ts (drawn, sorted by its feet, sleeping off camera, clicked and targeted like the rest; mobs.json `radius`: reach
// to it is to its body's edge), made once its art is in (assets/queue.ts loadBoss: in the background once the Slums is
// up) and hidden while it isn't up. This puts the server's word on it: it rises (its death anim backwards, from where
// a late arrival comes in: `left`), idles, stomps (`mob-move`), turns a quarter at a time (`mob-face`), sinks (its death
// anim forwards, then a fade) and dies (the lamp bursts as its death starts); its red-lamp sheets once enraged. Its
// attacks (`golem-attack`) play in step with their anims, every effect on its fx layer (manifest mobs.<id>.fx `layer`;
// timed from the anim's frames, mobs.json attackFrame / tossFrame / glareFrames, so they play on screen even with the
// golem itself asleep off it): Tire Slam (the warning on the ground where its fist comes down from the swing until its
// frame, then the impact there, the shockwave and a small shake; enraged, a rubble ring left a few seconds), Scrap
// Toss (the marker at the target from the start; on its frame the scrap leaves the raised fist and arcs to it, tumbling,
// its trail turned to its flight; the landing, marker gone), Lamp Glare (a soft warm cone of light drawn in code from the
// lamp over the grid cone the server tests, fading in on its first frame, held, fading after its last; the blinded
// icon over the heads of whoever's inside for blindMs). Call the Junk: the crawl-out fx at each spot (the Adds come
// as `mob-add`); Enrage: the fx at the lamp, the red lamp half-way through. The lamp, fists measured from the art per
// facing (mobs.json lamp, slamFist, tossFist). Harmless: the mob hooks show it on the players. A wide boss bar (ui/
// boss-bar.ts) during its fight for whoever's within its leash.

const RUBBLE_MS = 3500; // an enraged slam's rubble ring stays this long
const FLIGHT_MS = 600; // the scrap's flight
const GLARE_IN_MS = 100;
const GLARE_OUT_MS = 220;
const BLAST = 1.5; // tiles round the slam's spot: a target still there flashes as it lands
const BLIND_Y = 5; // the blinded sparkles circle a head: this far under its top (px; over it, the name tag hid them)

/** Each facing's axis on the grid, as an angle (SE = +col, SW = +row, NW = −col, NE = −row). */
const AXIS_ANGLE: Record<TownMobFacing, number> = { se: 0, sw: Math.PI / 2, nw: Math.PI, ne: -Math.PI / 2 };

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

type GolemAttackMessage = Extract<TownServerMessage, { t: 'golem-attack' }>;

/** What it needs from the scene: where a player's feet and head are (town id; null: not here), and your tile. */
export interface GolemPlayers {
  at(id: string): { feet: Pt; head: Pt } | null;
  me(): { col: number; row: number };
}

export class GolemView {
  private mob: Mob | null = null;
  /** The server's last word on it (null: not up), and when it came (scene ms). */
  private state: TownGolem | null = null;
  private stateAt = 0;
  private art = false;
  private readonly bar = new BossBar();
  private touchTimer: Phaser.Time.TimerEvent | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly map: TownMap,
    private readonly mobs: Mobs,
    private readonly fx: FxLayers,
    /** (The scene fills in `at` once it knows who's who.) */
    readonly players: GolemPlayers,
  ) {}

  private get boss() {
    return this.map.boss!;
  }

  /** Its art is in: it's made, and shown as the server last said. */
  loaded(): void {
    this.art = true;
    if (this.state) this.apply(this.state, this.scene.time.now - this.stateAt);
  }

  /** Arriving (`mobs`): as it is now (null: not up). */
  snapshot(g: TownGolem | null): void {
    this.setState(g);
    if (!g) {
      const m = this.mob;
      if (m && !m.dead) this.mobs.show(m, false);
      return;
    }
    this.apply(g);
  }

  /** It changed (`golem`): risen, a fight begun, the Junk called, enraged, reset, sinking, dead. */
  change(change: GolemChange, g: TownGolem, spots?: [number, number][]): void {
    this.setState(g);
    if (!this.art) return;
    if (change === 'call') for (const [c, r] of spots ?? []) this.fx.play(this.def('fx-golem-call-junk'), this.mobs.ground(c + 0.5, r + 0.5));
    if (change === 'enrage') return this.enrage(g);
    if (change === 'death') return this.death();
    this.apply(g);
  }

  private setState(g: TownGolem | null): void {
    this.state = g;
    this.stateAt = this.scene.time.now;
  }

  /** It, made (once its art is in) in its pit. */
  private made(g: TownGolem): Mob | null {
    if (this.mob || !this.art) return this.mob;
    const [c0, r0, c1, r1] = this.boss.arena;
    const zone: MobZone = {
      id: 'golem-pit', name: GOLEM_PIT, mob: g.id, level: [g.level, g.level], rect: [c0, r0, c1, r1], height: 0, pack: 0, aggro: 'passive', aggroRange: 0,
      leash: g.leash, respawnSec: 0, active: true, spawns: [g.home],
    };
    this.mob = this.mobs.makeBoss(g.id, zone);
    return this.mob;
  }

  /** As the server has it, `since` ms after it said so: where it is, its HP and lamp, and rising, up or sinking. */
  private apply(g: TownGolem, since = 0): void {
    const m = this.made(g);
    if (!m) return;
    if (g.state === 'dead') {
      if (!m.dead) this.mobs.fall(m);
      return;
    }
    m.level = g.level;
    this.mobs.setHp(m, g.hp, g.maxHp);
    this.mobs.setEnraged(m, g.enraged);
    const fresh = m.dead; // (it wasn't showing: rising, or seen for the first time)
    if (fresh) this.mobs.show(m, true);
    // Where it is: the rest of a stomp under way, or its tile (only if it isn't where it should be).
    if (g.path?.length) this.mobs.hop(m.id, [[g.col, g.row], ...g.path], g.speed);
    else if (fresh || (!m.path.length && (Math.floor(m.col) !== g.col || Math.floor(m.row) !== g.row))) this.mobs.setAt(m, g.col, g.row);
    if (fresh) m.dir = g.dir;
    else this.mobs.face(m.id, g.dir);
    // Rising (its death backwards) or sinking (forwards, then gone), from where they've got to; untouchable meanwhile.
    this.touchTimer?.remove();
    m.untouchable = g.state === 'rising' || g.state === 'sinking';
    if (m.untouchable) {
      const death = m.def.animations.death;
      const ms = (death.frames / death.fps) * 1000;
      const left = Math.max(0, (g.left ?? ms) - since);
      const from = Math.min(death.frames - 1, Math.floor(((ms - left) / ms) * death.frames));
      if (g.state === 'rising') {
        if (left > 0) this.mobs.pose(m, 'rise', { from });
        this.touchTimer = this.scene.time.delayedCall(left, () => (m.untouchable = false));
      } else this.mobs.fall(m, from);
      if (m === this.mobs.current) this.mobs.setTarget(null);
    }
  }

  /** Enraged: the fx at its lamp, the red lamp half-way through it. */
  private enrage(g: TownGolem): void {
    this.apply({ ...g, enraged: false });
    const m = this.mob;
    if (!m || m.dead) return;
    const def = this.def('fx-golem-enrage');
    this.fx.play(def, this.lamp(m), { follow: () => this.lamp(m), scale: m.data?.scale });
    const ms = def?.frames && def.fps ? (def.frames / def.fps) * 500 : 400;
    this.scene.time.delayedCall(ms, () => this.mobs.setEnraged(m, this.state?.enraged ?? true));
  }

  /** Dead: the lamp bursts as its death starts (the `mob-hit` that killed it played that already, or here). */
  private death(): void {
    const m = this.mob;
    if (!m) return;
    this.touchTimer?.remove();
    this.fx.play(this.def('fx-golem-lamp-burst'), this.lamp(m), { scale: m.data?.scale });
    if (!m.dead) this.mobs.kill(m);
  }

  /** Its attack, in step with its anim: each effect on its layer, on its frame. */
  attack(a: GolemAttackMessage): void {
    const m = this.mob;
    if (!this.art || !m || m.dead) return;
    this.mobs.face(m.id, a.dir);
    this.mobs.setEnraged(m, a.enraged);
    const anim = a.attack === 'slam' ? 'attack' : a.attack;
    const A = m.def.animations[anim];
    if (!A) return;
    const frameMs = 1000 / A.fps;
    const later = (frame: number, fn: () => void) => this.scene.time.delayedCall(frame * frameMs, fn);
    this.mobs.pose(m, anim);
    const at = this.mobs.ground(a.at[0] + 0.5, a.at[1] + 0.5);
    const D = m.data;
    const k = D?.scale ?? 1; // its own fx are drawn for its art's size: as big as it's drawn
    if (a.attack === 'slam') {
      // All where its fist comes down (the art's: mobs.json slamFist; its fx are drawn for that spot). The server's `at`
      // (toward its target, any of eight ways) can be a tile or two off it, the art having four facings.
      const f = D?.attackFrame ?? 5;
      const fist = this.point(m, D?.slamFist) ?? at;
      this.fx.play(this.def('fx-golem-slam-warning'), fist, { life: f * frameMs, fadeIn: 120, scale: k });
      later(f, () => {
        this.mobs.hooks.onAttackFrame?.(m, a.target);
        this.fx.play(this.def('fx-golem-slam-impact'), fist, { scale: k });
        this.fx.play(this.def('fx-golem-shockwave'), fist, { scale: k });
        if (a.enraged) this.fx.play(this.def('fx-golem-rubble-ring'), fist, { life: RUBBLE_MS, fadeIn: 200, fadeOut: 900, scale: k });
        this.shake(fist);
        // Whoever it was after, if they're in it (harmless: shown).
        const who = this.players.at(a.target);
        if (who && Math.hypot((who.feet.x - fist.x) / 16, (who.feet.y - fist.y) / 8) / Math.SQRT2 <= BLAST * k) this.mobs.hooks.onHit?.(m, a.target);
      });
    } else if (a.attack === 'toss') {
      const marker = this.fx.play(this.def('fx-golem-toss-marker'), at, { life: 60_000, fadeIn: 120 });
      later(D?.tossFrame ?? 4, () => {
        this.mobs.hooks.onAttackFrame?.(m, a.target);
        const from = this.point(m, D?.tossFist) ?? this.mobs.feet(m);
        const d = Math.hypot(at.x - from.x, at.y - from.y);
        const o = { speed: d / (FLIGHT_MS / 1000), arc: Math.max(24, d * 0.3) };
        const left = at.x < from.x;
        // The trail first (the scrap over it), turned to the flight (mirrored flying left: flipped across it).
        const trail = this.fx.shot(this.def('fx-golem-scrap-trail'), from, at, { ...o, flipY: left, scale: k });
        this.fx.shot(this.def('fx-golem-scrap'), from, at, {
          ...o, turn: false, spin: left ? -8 : 8, scale: k,
          onArrive: () => {
            marker?.kill(150);
            trail?.kill(0);
            this.fx.play(this.def('fx-golem-scrap-land'), at, { scale: k });
            this.mobs.hooks.onHit?.(m, a.target);
          },
        });
      });
    } else {
      const [g0, g1] = D?.glareFrames ?? [3, 5];
      later(g0, () => {
        this.mobs.hooks.onAttackFrame?.(m, a.target);
        this.glare(m, a.dir, a.cone ?? [5, 60], (g1 - g0 + 1) * frameMs);
        for (const id of a.blinded ?? []) this.blind(id, a.blindMs ?? 3000);
      });
    }
  }

  /** The Lamp Glare's light (drawn in code, front layer, added light): the cone the server tests in grid space (its
   *  tile, `length` tiles along its facing, `degrees` wide) laid on the ground, and a beam from the lamp onto it, brighter
   *  down the middle; in over GLARE_IN_MS, held `hold` ms, out over GLARE_OUT_MS. */
  private glare(m: Mob, dir: TownMobFacing, [length, degrees]: [number, number], hold: number): void {
    const lamp = this.lamp(m);
    const feet = this.mobs.feet(m);
    const [c, r] = [m.col, m.row];
    const axis = AXIS_ANGLE[dir];
    const half = ((degrees / 2) * Math.PI) / 180;
    // The cone's far edge (an arc of the grid's circle) on the screen, `k` of its width.
    const arc = (k: number): Pt[] => {
      const pts: Pt[] = [];
      for (let i = 0; i <= 12; i++) {
        const a = axis - half * k + (2 * half * k * i) / 12;
        pts.push(this.mobs.ground(c + Math.cos(a) * length, r + Math.sin(a) * length));
      }
      return pts;
    };
    const [wide, mid, core] = [arc(1), arc(0.55), arc(0.22)];
    this.fx.drawFx('front', (g, t) => {
      g.setBlendMode(Phaser.BlendModes.ADD);
      const k = Math.min(1, t / GLARE_IN_MS) * (0.93 + 0.07 * Math.sin(t / 37));
      fill(g.fillStyle(0xffc65a, 0.13 * k), [feet, ...wide]);
      fill(g.fillStyle(0xffe08a, 0.1 * k), [lamp, ...wide]);
      fill(g.fillStyle(0xffe9a8, 0.1 * k), [lamp, ...mid]);
      fill(g.fillStyle(0xfff4cf, 0.12 * k), [lamp, ...core]);
      g.fillStyle(0xfff4cf, 0.25 * k).fillCircle(lamp.x, lamp.y, 9);
      g.fillStyle(0xffffff, 0.55 * k).fillCircle(lamp.x, lamp.y, 4);
    }, GLARE_IN_MS + hold + GLARE_OUT_MS, GLARE_OUT_MS);
  }

  /** The blinded sparkles round a player's head for `ms` (shown only), following them. */
  private blind(id: string, ms: number): void {
    const first = this.players.at(id);
    if (!first) return;
    let last = { x: first.head.x, y: first.head.y + BLIND_Y };
    this.fx.play(this.def('fx-golem-blinded'), last, {
      life: ms, fadeIn: 150, fadeOut: 300,
      follow: () => {
        const p = this.players.at(id);
        if (p) last = { x: p.head.x, y: p.head.y + BLIND_Y };
        return last;
      },
    });
  }

  /** A small shake for a slam you can see (none with reduced motion). */
  private shake(at: Pt): void {
    const cam = this.scene.cameras.main;
    if (!reducedMotion() && cam.worldView.contains(at.x, at.y)) cam.shake(150, 0.0015); // a nudge: about 2 px on a laptop screen
  }

  /** One of its effects (manifest mobs.<id>.fx). */
  private def(id: string): FxDef | undefined {
    return this.mob?.def.fx?.[id];
  }

  /** An art point of its cell (mobs.json, per facing) in the world now. */
  private point(m: Mob, per?: Record<string, Vec2>): Pt | null {
    const p = per?.[m.dir];
    if (!p) return null;
    const f = this.mobs.feet(m);
    const k = m.data?.scale ?? 1;
    return { x: f.x + (p[0] - m.cell.anchor[0]) * k, y: f.y + (p[1] - m.cell.anchor[1]) * k };
  }

  private lamp(m: Mob): Pt {
    return this.point(m, m.data?.lamp) ?? { ...this.mobs.feet(m), y: this.mobs.feet(m).y - 80 * (m.data?.scale ?? 1) };
  }

  /** Every frame: the boss bar, while its fight is on and you're within its leash. */
  update(): void {
    const g = this.state;
    const m = this.mob;
    const me = this.players.me();
    const near = !!g && Math.max(Math.abs(me.col - g.home[0]), Math.abs(me.row - g.home[1])) <= g.leash;
    this.bar.show(g && m && !m.dead && g.state === 'fight' && near ? { name: this.boss.name, level: m.level, hp: m.hp, maxHp: m.maxHp, enraged: m.enraged } : null);
  }

  destroy(): void {
    this.bar.destroy();
  }
}

/** A filled polygon through `pts`. */
function fill(g: Phaser.GameObjects.Graphics, pts: Pt[]): void {
  g.beginPath().moveTo(pts[0].x, pts[0].y);
  for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
  g.closePath().fillPath();
}
