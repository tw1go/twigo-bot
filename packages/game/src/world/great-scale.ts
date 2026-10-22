import Phaser from 'phaser';
import type { GreatScaleChange, TelegraphShape, TownGreatScale, TownServerMessage } from '@mikazuki/shared';
import type { FxDef, Manifest, MobData, MobDef, TownMap } from '../assets/types';
import { mobSheet } from '../assets/mob-art';
import { BossBar } from '../ui/boss-bar';
import { onMap } from './clicks';
import type { FxHandle, FxLayers, Pt } from './fx-layers';
import type { Mobs } from './mobs';
import { Telegraphs } from './telegraph';
import { playSet } from '../audio/sound';

/** Its sounds (audio/sfx/great-scale-<name>-1…3), loaded with the Palengke (TownScene). */
export const GREAT_SCALE_SOUNDS = ['pan-slam-windup', 'pan-slam', 'weigh-in', 'short-weight', 'call', 'enrage', 'bell'] as const;

// ⚖️ The Great Scale in the game (Ang Dakilang Timbangan, the Lumang Palengke's field boss; the server runs it: bot
// web/town-great-scale.ts). Its mob is the room's (world/mobs.ts: its eight-way sheets, its red name, asleep dimmed on
// its idle's first frame between fights); this draws the rest of what the server says:
// - Its moves (`boss-move`): the red telegraph (world/telegraph.ts) from now to its hit, its anim timed so its hit frame
//   lands then (mobs.json attackFrame / weighFrame / coneFrame); on a Pan Slam's hit its impact in each circle.
// - Weigh-in: the held player lifted 12 px inside the Weigh-in's ring, over the pan (a mob of its own, drawn here in
//   code: a brass dish), until they're let go.
// - Its call (dust puffs where its Sentinels drop, as its call anim lands), its enrage (its anim once, then a red flash
//   every 2 s until it has red sheets), its bell after its fall (the bell on its tile for its time left: a click
//   within 3 tiles rings it; `bell-rung` swings the code-drawn stand-in for everyone).
// - The boss bar while it's awake and you're in its arena; the HUD's field boss timer ("Awake! Go to the hall").
// - Asleep: hovering it says when it wakes.
// Its effects are the art folder's fx/palengke fx-scale-* (21 Oct 2026): the pan's warning under each Pan Slam circle and
// its impact, the Weigh-in's ring round the held player, Kulang sa Timbang's cone (se / ne art, mirrored for sw / nw),
// the Sentinels' call, its enrage at the dial and the bell; each falls back to a code-drawn stand-in while its sheet
// isn't loaded.

export const PAN_KIND = 'great-scale-pan';
const LIFT = 12; // px a held player is lifted on the pan
const FLASH_EVERY = 2000; // ms between its enraged red flashes
const BELL_TILES = 3;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

type Move = Extract<TownServerMessage, { t: 'boss-move' }>;
type Hit = Extract<TownServerMessage, { t: 'boss-hit' }>;

/** What it needs from the scene. */
export interface GreatScaleHooks {
  /** Your tile. */
  me(): { col: number; row: number };
  /** A player's character (town id; yours too), to lift while held. */
  char(id: string): { lift: number; sprite: Phaser.GameObjects.Sprite } | null;
  /** The bell clicked: ring it (within 3 tiles), or walk toward it. */
  ring(at: [number, number]): void;
  /** The HUD's field boss timer. */
  timer(name: string, warnMinutes: number, riseIn: number, awake: boolean): void;
}

export class GreatScaleView {
  private readonly telegraphs: Telegraphs;
  private readonly bar = new BossBar();
  private state: TownGreatScale | null = null;
  /** When the state came (scene ms: its `riseIn` and the bell's `left` count from then). */
  private at = 0;
  private readonly timers = new Set<Phaser.Time.TimerEvent>();
  private flashAt = 0;
  private held: { id: string; ring: FxHandle } | null = null;
  private bell: { at: [number, number]; until: number; zone: Phaser.GameObjects.Zone; fx: FxHandle; swingAt: number } | null = null;
  private hovered = false;
  private hoverSet = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly M: Manifest,
    private readonly map: TownMap,
    private readonly mobs: Mobs,
    private readonly fx: FxLayers,
    private readonly hooks: GreatScaleHooks,
  ) {
    this.telegraphs = new Telegraphs(scene, fx);
    this.makePan();
  }

  private get id(): string {
    return this.map.boss!.id;
  }

  private get data(): MobData | null {
    const raw = (this.scene.cache.json.get('mob-data') ?? {})[this.id];
    return typeof raw === 'object' ? (raw as MobData) : null;
  }

  // ── Its state ──

  /** What the server says (a `great-scale` message, or the arrival's `mobs`): the timer, the held, the bell; and what
   *  just happened (`change`: its call's `spots`). */
  set(st: TownGreatScale, change?: GreatScaleChange, spots?: [number, number][]): void {
    this.state = st;
    this.at = this.scene.time.now;
    this.hooks.timer(st.name, st.warnMinutes, st.riseIn ?? 0, st.state === 'awake');
    const m = this.mobs.get(this.id);
    if (change === 'call' && spots) {
      if (m) this.mobs.pose(m, 'call');
      const delay = this.frameMs('call', this.data?.callFrame ?? 0);
      for (const t of spots) this.later(delay, () => this.dust(t));
      this.later(delay, () => this.sound('call'));
    }
    if (change === 'enrage' && m) {
      this.mobs.pose(m, 'enrage');
      this.sound('enrage');
      // fx-scale-enrage at its dial (its art's top).
      const art = this.art('fx-scale-enrage');
      const k = m.data?.scale ?? 1;
      if (art) this.fx.play(art, { x: m.sprite.x, y: m.sprite.y + ((m.data?.top ?? 0) - m.cell.anchor[1]) * k + 16 }, { layer: 'front' });
    }
    if (change === 'reset' || change === 'death' || change === 'sleep' || change === 'sink') this.cancel(this.id);
    // The held player: lifted while held, down again once let go.
    const holding = st.held?.id ?? null;
    if (this.held && this.held.id !== holding) this.letGo();
    if (holding && !this.held) this.hold(holding, st.held!.pan);
    // Its bell, while it rings.
    if (st.bell && !this.bell) this.showBell(st.bell.at, st.bell.left);
    if (!st.bell && this.bell) this.dropBell();
  }

  /** Someone rang its bell: it swings. */
  rung(): void {
    if (!this.bell) return;
    this.bell.swingAt = this.scene.time.now;
    this.sound('bell', { col: this.bell.at[0], row: this.bell.at[1] });
  }

  /** One of its sounds from where it stands (or `at`): heard within range, a little quieter than your own (the golem's
   *  way). */
  private sound(name: (typeof GREAT_SCALE_SOUNDS)[number], at?: { col: number; row: number } | null): void {
    const from = at ?? this.mobs.tileOf(this.id);
    playSet(`great-scale-${name}`, { at: from, others: true });
  }

  // ── Its moves ──

  /** One of its moves: the telegraph now, its anim timed so its hit frame lands with the hit `ms` later. */
  move(e: Move): void {
    if (e.id !== this.id) return;
    if (e.shape) {
      this.shapes.set(e.key, e.shape);
      this.telegraphs.show(e.key, e.id, e.shape, e.ms);
    }
    // A Pan Slam's warning in each circle until it lands; Kulang sa Timbang's cone from its feet, hitting on its frame 3.
    const warn = e.move === 'panSlam' && e.shape?.kind === 'circles' ? this.art('fx-scale-pan-warning') : undefined;
    if (warn && e.shape?.kind === 'circles') for (const c of e.shape.circles) this.later(0, () => this.fx.play(warn, this.mobs.ground(c.at[0] + 0.5, c.at[1] + 0.5), { layer: 'ground', life: e.ms }));
    if (e.shape?.kind === 'cone') this.cone(e.shape, e.ms);
    if (e.move === 'panSlam') this.sound('pan-slam-windup');
    const anim = typeof e.data?.anim === 'string' ? e.data.anim : null;
    if (!anim) return;
    const frame = anim === 'weigh' ? this.data?.weighFrame : anim === 'cone' ? this.data?.coneFrame : this.data?.attackFrame;
    const lead = this.frameMs(anim, frame ?? 0);
    this.later(Math.max(0, e.ms - lead), () => {
      const m = this.mobs.get(this.id);
      if (m && !m.dead) this.mobs.pose(m, anim);
    });
  }

  /** One of its moves landing: each hit's number, a Pan Slam's bursts. */
  hit(e: Hit): void {
    if (e.id !== this.id) return;
    const m = this.mobs.get(this.id);
    if (m) for (const h of e.hits) this.mobs.hooks.onHit?.(m, h.id, undefined, h);
    const live = this.shapes.get(e.key);
    this.shapes.delete(e.key);
    if (e.move === 'panSlam' && live?.kind === 'circles') for (const c of live.circles) this.panImpact(c.at, c.radius);
    if (e.move === 'panSlam') this.sound('pan-slam');
    if (e.move === 'shortWeight') this.sound('short-weight');
  }

  /** Its moves' shapes (by key) until they land (a Pan Slam's bursts where its circles were). */
  private readonly shapes = new Map<string, TelegraphShape>();

  /** It reset, fell or went back to sleep: its telegraphs and timed anims go. */
  cancel(id: string): void {
    if (id !== this.id) return;
    this.telegraphs.cancel(id);
    this.shapes.clear();
    for (const t of this.timers) t.remove();
    this.timers.clear();
  }

  // ── Every frame ──

  update(): void {
    const st = this.state;
    const m = this.mobs.get(this.id);
    const now = this.scene.time.now;
    // The boss bar while it's awake and you're in its arena.
    const [c0, r0, c1, r1] = st?.arena ?? [0, 0, -1, -1];
    const me = this.hooks.me();
    const inside = me.col >= c0 && me.col <= c1 && me.row >= r0 && me.row <= r1;
    this.bar.show(st?.state === 'awake' && m && !m.dead && inside ? { name: st.name, level: m.level, hp: m.hp, maxHp: m.maxHp, enraged: st.enraged } : null);
    // Enraged: a red flash every 2 s (its needle red until it has red sheets).
    if (st?.enraged && st.state === 'awake' && m && now >= this.flashAt) {
      this.flashAt = now + FLASH_EVERY;
      this.mobs.tintFlash(this.id, 0xff5a5a, 260);
    }
    // The held player stays lifted (a step's sync would put them down).
    if (this.held) {
      const c = this.hooks.char(this.held.id);
      if (c) c.lift = LIFT;
    }
    // Asleep: hovering it says when it wakes.
    if (m && !this.hoverSet) {
      this.hoverSet = true;
      m.sprite.on('pointerover', () => (this.hovered = true)).on('pointerout', () => (this.hovered = false));
    }
    if (m) this.mobs.note(this.id, this.hovered && st?.state === 'asleep' ? `wakes in ${until(Math.max(0, (st.riseIn ?? 0) - (now - this.at)))}` : null);
    if (this.bell && now >= this.bell.until) this.dropBell();
  }

  // ── Weigh-in's hold ──

  private hold(id: string, pan: string): void {
    const c = this.hooks.char(id);
    if (c) c.lift = LIFT;
    this.sound('weigh-in'); // (the lift)
    // fx-scale-weigh-in round the held player (else a dashed circle on the ground round the pan).
    const weigh = this.art('fx-scale-weigh-in');
    if (weigh && c) {
      const feet = () => ({ x: c.sprite.x, y: c.sprite.y });
      const h = this.fx.play(weigh, feet(), { layer: 'front', follow: feet, life: Infinity });
      if (h) return void (this.held = { id, ring: h });
    }
    const ring = this.fx.drawFx('ground', (g, t) => {
      const p = this.mobs.get(pan);
      if (!p) return false;
      const at = this.mobs.feet(p);
      g.clear();
      dashedEllipse(g, at.x, at.y, 20, 10, t / 600, 0xfcd34d, 0.9);
      return true;
    });
    this.held = { id, ring };
  }

  private letGo(): void {
    const h = this.held;
    if (!h) return;
    this.held = null;
    const c = this.hooks.char(h.id);
    if (c) c.lift = 0;
    h.ring.kill(150);
  }

  /** The pan (a mob of its own while someone's held): its sheets made in code, a brass dish with its chains, until the
   *  art comes (then a manifest entry). */
  private makePan(): void {
    const mobs = (this.M.mobs ??= {} as never) as Record<string, MobDef | string>;
    if (mobs[PAN_KIND]) return;
    const def = {
      name: 'Timbangan Pan',
      file: `mobs/${PAN_KIND}/{anim}-{dir}.png`,
      size: [44, 40],
      anchor: [22, 30],
      directions: ['s'],
      animations: { idle: { frames: 2, fps: 3, loop: true }, move: { frames: 2, fps: 3, loop: true }, hit: { frames: 1, fps: 12, loop: false }, death: { frames: 3, fps: 10, loop: false } },
    } as unknown as MobDef;
    mobs[PAN_KIND] = def;
    for (const [anim, a] of Object.entries(def.animations)) {
      const key = mobSheet(def, '', anim, 's');
      if (this.scene.textures.exists(key)) continue;
      const tex = this.scene.textures.createCanvas(key, 44 * a.frames, 40);
      if (!tex) continue;
      const ctx = tex.getContext();
      for (let f = 0; f < a.frames; f++) drawPan(ctx, f * 44, anim, f, a.frames);
      tex.refresh();
    }
  }

  // ── Placeholder effects ──

  /** A Pan Slam landing: fx-scale-pan-impact in its circle (else a white burst filling it), and a small shake you can see. */
  private panImpact(at: [number, number], radius: number): void {
    const c = this.mobs.ground(at[0] + 0.5, at[1] + 0.5);
    const art = this.art('fx-scale-pan-impact');
    if (art) this.fx.play(art, c, { layer: 'front' });
    else this.fx.drawFx('front', (g, t) => {
      const p = Math.min(1, t / 260);
      g.clear().fillStyle(0xffffff, 0.55 * (1 - p)).fillEllipse(c.x, c.y, radius * 32 * (0.5 + p * 0.6), radius * 16 * (0.5 + p * 0.6));
      return p < 1;
    });
    const view = this.scene.cameras.main.worldView;
    if (!reducedMotion() && view.contains(c.x, c.y)) this.scene.cameras.main.shake(150, 0.003);
  }

  /** Where a Sentinel drops in: fx-scale-call (else a puff). */
  private dust(t: [number, number]): void {
    const c = this.mobs.ground(t[0] + 0.5, t[1] + 0.5);
    const art = this.art('fx-scale-call');
    if (art) return void this.fx.play(art, c, { layer: 'ground' });
    this.fx.drawFx('ground', (g, ms) => {
      const p = Math.min(1, ms / 500);
      g.clear();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.fillStyle(0xb8a07a, 0.6 * (1 - p)).fillCircle(c.x + Math.cos(a) * 14 * p, c.y + Math.sin(a) * 7 * p, 3 + 3 * p);
      }
      return p < 1;
    });
  }

  /** fx.bell: the palengke's bell on its tile while it rings (its time `left` ms), a click on it to ring. */
  private showBell(at: [number, number], left: number): void {
    const c = this.mobs.ground(at[0] + 0.5, at[1] + 0.5);
    const zone = this.scene.add.zone(c.x, c.y - 14, 24, 30).setInteractive({ cursor: 'pointer' });
    zone.on('pointerup', (p: Phaser.Input.Pointer) => {
      if ((!p.leftButtonReleased() && !p.wasTouch) || !onMap(p, this.scene.game.canvas)) return;
      this.hooks.ring(at);
    });
    // fx-scale-bell ringing over its tile (else a gold bell drawn in code, swinging as it's rung).
    const art = this.art('fx-scale-bell');
    const own = art && this.fx.play(art, { x: c.x, y: c.y - 6 }, { layer: 'front', life: Infinity });
    if (own) {
      zone.setPosition(c.x, c.y - 30).setSize(40, 52);
      this.bell = { at, until: this.scene.time.now + left, zone, fx: own, swingAt: -Infinity };
      return;
    }
    const fx = this.fx.drawFx('front', (g, t) => {
      const b = this.bell;
      const swing = b ? Math.max(0, 1 - (this.scene.time.now - b.swingAt) / 900) : 0;
      const tilt = Math.sin(t / 90) * 0.35 * swing;
      g.clear();
      drawBell(g, c.x, c.y, tilt, t);
      return true;
    });
    this.bell = { at, until: this.scene.time.now + left, zone, fx, swingAt: -Infinity };
  }

  private dropBell(): void {
    const b = this.bell;
    if (!b) return;
    this.bell = null;
    b.zone.destroy();
    b.fx.kill(400);
  }

  /** Within reach of its bell (BELL_TILES, as the server). */
  nearBell(at: { col: number; row: number }): boolean {
    const b = this.bell;
    return !!b && Math.max(Math.abs(at.col - b.at[0]), Math.abs(at.row - b.at[1])) <= BELL_TILES;
  }

  /** Kulang sa Timbang's cone on the ground from its origin the way it points (the se / ne art, mirrored for sw / nw),
   *  started so its frame 3 (its hit) lands with the hit `ms` from now. */
  private cone(shape: Extract<TelegraphShape, { kind: 'cone' }>, ms: number): void {
    const [gx, gy] = [Math.cos(shape.facing), Math.sin(shape.facing)];
    const [sx, sy] = [gx - gy, (gx + gy) / 2]; // (screen: right and down)
    const art = this.art(sy >= 0 ? 'fx-scale-short-weight-se' : 'fx-scale-short-weight-ne');
    if (!art) return;
    const lead = (3 / (art.fps ?? 10)) * 1000;
    const at = this.mobs.ground(shape.origin[0] + 0.5, shape.origin[1] + 0.5);
    this.later(Math.max(0, ms - lead), () => this.fx.play(art, at, { layer: 'ground', flipX: sx < 0 }));
  }

  /** An effect's def, only once its sheet is loaded (else the caller draws its stand-in). */
  private art(id: string): FxDef | undefined {
    const def = this.M.fx[id];
    return def?.file && this.scene.textures.exists(def.file) ? def : undefined;
  }

  // ── Helpers ──

  /** When an anim's frame starts after the anim does (ms, its fps from the manifest). */
  private frameMs(anim: string, frame: number): number {
    const def = this.M.mobs?.[this.id];
    const fps = def && typeof def === 'object' ? (def.animations[anim]?.fps ?? 12) : 12;
    return Math.round((frame / fps) * 1000);
  }

  private later(ms: number, run: () => void): void {
    const t = this.scene.time.delayedCall(ms, () => {
      this.timers.delete(t);
      run();
    });
    this.timers.add(t);
  }

  destroy(): void {
    this.cancel(this.id);
    this.telegraphs.clear();
    this.letGo();
    this.dropBell();
    this.bar.destroy();
  }
}

/** "1h 23m", "4m". */
function until(ms: number): string {
  const m = Math.ceil(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

/** A dashed 2:1 ellipse turning slowly (`turn`: its dashes' offset). */
function dashedEllipse(g: Phaser.GameObjects.Graphics, x: number, y: number, rx: number, ry: number, turn: number, colour: number, alpha: number): void {
  const DASHES = 14;
  g.lineStyle(1, colour, alpha);
  for (let i = 0; i < DASHES; i++) {
    const a0 = ((i + turn) / DASHES) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / DASHES / 2;
    g.beginPath();
    for (let k = 0; k <= 4; k++) {
      const a = a0 + ((a1 - a0) * k) / 4;
      const px = x + Math.cos(a) * rx;
      const py = y + Math.sin(a) * ry;
      if (k) g.lineTo(px, py);
      else g.moveTo(px, py);
    }
    g.strokePath();
  }
}

/** The pan's frame at `x0`: a brass dish under the held player's feet with two chain stubs; a hit lightens it, its
 *  death cracks and fades it. */
function drawPan(ctx: CanvasRenderingContext2D, x0: number, anim: string, f: number, frames: number): void {
  const cx = x0 + 22;
  const fade = anim === 'death' ? 1 - f / frames : 1;
  ctx.globalAlpha = fade;
  // Chains up to its arm.
  ctx.fillStyle = '#5b5b6b';
  for (let y = 4; y < 24; y += 3) {
    ctx.fillRect(cx - 17, y + (anim === 'idle' && f ? 1 : 0), 2, 2);
    ctx.fillRect(cx + 15, y + (anim === 'idle' && f ? 1 : 0), 2, 2);
  }
  // The dish: a 2:1 ellipse, its rim darker.
  const dish = (rx: number, ry: number, y: number, colour: string) => {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.ellipse(cx, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  dish(18, 7, 26, '#1e1b3a');
  dish(17, 6, 26, anim === 'hit' ? '#fde68a' : '#a16207');
  dish(14, 4, 25, anim === 'hit' ? '#fef3c7' : '#ca8a04');
  if (anim === 'death' && f) {
    ctx.fillStyle = '#1e1b3a';
    ctx.fillRect(cx - 2, 22, 1, 7);
    ctx.fillRect(cx + 4, 23, 1, 5);
  }
  ctx.globalAlpha = 1;
}

/** The bell: gold, on a little post, its clapper swinging with it. */
function drawBell(g: Phaser.GameObjects.Graphics, x: number, y: number, tilt: number, t: number): void {
  const top: Pt = { x, y: y - 28 };
  const at = (dx: number, dy: number): Pt => ({ x: top.x + dx * Math.cos(tilt) - dy * Math.sin(tilt), y: top.y + dx * Math.sin(tilt) + dy * Math.cos(tilt) });
  // Its post and shadow.
  g.fillStyle(0x0b0a18, 0.35).fillEllipse(x, y, 18, 7);
  g.fillStyle(0x3f2a14, 1).fillRect(x - 1, y - 30, 2, 30);
  g.fillStyle(0x3f2a14, 1).fillRect(x - 7, y - 31, 14, 2);
  // The bell (a trapezoid and a lip), gold with a glint.
  const shape = [at(-4, 2), at(4, 2), at(7, 13), at(9, 15), at(-9, 15), at(-7, 13)];
  g.fillStyle(0x1e1b3a, 1).fillPoints(shape.map((p) => new Phaser.Math.Vector2(p.x, p.y + 1)), true);
  g.fillStyle(0xf5b82e, 1).fillPoints(shape.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true);
  const glint = at(-3, 6);
  g.fillStyle(0xfff3b0, 0.5 + 0.5 * Math.abs(Math.sin(t / 400))).fillRect(glint.x, glint.y, 2, 4);
  const clap = at(Math.sin(tilt * 3) * 4, 16);
  g.fillStyle(0x7c5a12, 1).fillCircle(clap.x, clap.y, 2);
}
