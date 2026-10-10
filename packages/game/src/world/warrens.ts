import Phaser from 'phaser';
import { type DungeonsData, type TelegraphShape, type TownServerMessage, type TownWarrensRun, areaAt, inRect } from '@mikazuki/shared';
import type { FxDef, Manifest, PropDef, TownMap } from '../assets/types';
import { loadBoss } from '../assets/queue';
import { type Heard, type WarrensSfx, playSet, playWarrens } from '../audio/sound';
import { BossBar } from '../ui/boss-bar';
import { showAreaBanner } from '../ui/warrens';
import { frontDepth } from './depth';
import { FX_DEPTH, type FxHandle, type FxLayers, type Pt } from './fx-layers';
import type { Tile, WalkGrid } from './grid';
import type { Mob, Mobs } from './mobs';
import type { Terrain } from './terrain';
import { Telegraphs } from './telegraph';

// 🕳️ A Scrap Warrens run in the game (maps/warrens.json; the server runs it: bot web/town-warrens.ts). This draws what
// the server says and keeps the walking grid in step:
// - Shutters: each area's way out, closed (its passage blocked here too) until its mini boss falls; then it slides up into
//   its open art over 0.6 s with dust and a clank, and the passage opens. While the run gathers, the start room's way out
//   is shut as well.
// - The area's name across the top as you walk into one; the boss bar (with Barong-Barong's title) while you're in a
//   boss's arena; the junk walls just in front of you at half alpha. In Barong-Barong's arena while it's up, `bossFrame`
//   (centred on its art's box, mobs.json `frame`, and wide enough to take you in): TownScene's boss camera keeps it in
//   view, Barong-Barong in the middle of the screen.
// - Every boss move (`boss-move`): its telegraph on the ground (world/telegraph.ts) from now to its hit, the boss's anim
//   timed so its hit frame lands on the hit, and its effects on their layers (the brief's 9.3 and 9.4: Lid Slam, Burnout
//   Charge, Smother Fog, Vanish, Chain Zap, Live Floor, Pincer Sweep, Hunker, the calls, Scrapling slams, Fist Slam, Roof
//   Rain, Gutter Sweep, Shanty Call, the enrage); `boss-hit` puts each hit's number over whoever it caught. A boss's
//   telegraphs, timers and effects go at once when it resets or falls (`boss-cancel`), all of them when the run ends.
// - Barong-Barong's art loads only as you near its hall (its enraged set once it enrages), the Scraplings' (the golem's)
//   with the run. Shakes only for what you can see, never over 0.4 s, none with reduced motion.
// - Sounds (audio/sound.ts WARRENS_SFX), on the server's move events like the effects (its start, its hit), only for
//   those who can see the boss (`bossSound`; a shutter: who can see it): Lid Slam's hit; Burnout Charge's rev over its
//   warning; Smother Fog's hit once a volley; Vanish as it fades out and back in; a zap per Chain Zap jump; Live Floor's
//   hit once; Pincer Sweep's hit; Hunker as it starts; Barong-Barong's fist falling (FIST_SOUND_MS before it lands) and
//   slamming, its roof ripping on the rain anim's frame 6, ROOF_SOUNDS of a volley's sheets landing (a little random
//   pitch), its sweep with the sweep anim, its door bursting on the call anim's frame 2, its enrage, its hurt (at most
//   every HURT_MS: Mobs.kindSounds) and death. The calls, Scraplings and called mobs keep the golem's and mobs' sounds.

const GOLEM = 'scrapheap-golem';
const BARONG_NEAR = 16; // tiles from its hall: its art loads
const SHUTTER_MS = 600;
const FIST_FALL_MS = 350;
const SHEET_FALL_MS = 500;
const ZAP_HOP_MS = 80;
const ZAP_SHOW_MS = 220;
const FIST_SOUND_MS = 450; // the fist's fall sound starts this long before it lands (it ends as it does)
const ROOF_SOUNDS = 4; // a Roof Rain volley's landing sounds, at most
const HURT_MS = 300; // Barong-Barong's hurt sound at most this often

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
type Move = Extract<TownServerMessage, { t: 'boss-move' }>;
type Hit = Extract<TownServerMessage, { t: 'boss-hit' }>;

/** What it needs from the scene. */
export interface WarrensHooks {
  me(): Tile;
  /** Your sprite's box (the walls in front of it fade). */
  myBox(): Phaser.Geom.Rectangle | null;
  /** A player's body (town id), for a zap to reach. */
  body(id: string): Pt | null;
  /** A boss move's hit on a player: the number over them (and a slow's ms). */
  onHit(boss: Mob | null, target: string, hit: { damage: number; miss?: boolean }, slow?: number): void;
}

interface ShutterView {
  area: string;
  closed: Phaser.GameObjects.Image;
  open: Phaser.GameObjects.Image;
  passage: [number, number][];
  at: Pt;
}

export class WarrensView {
  private readonly telegraphs: Telegraphs;
  private readonly bar = new BossBar();
  private readonly shutters: ShutterView[] = [];
  private opened = new Set<string>();
  private sealed = false;
  private area: string | null = null;
  private seen = false;
  /** Per boss (its id): its timers and effects under way, gone with it. */
  private readonly timers = new Map<string, Phaser.Time.TimerEvent[]>();
  private readonly handles = new Map<string, FxHandle[]>();
  private golemArt = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly M: Manifest,
    private readonly map: TownMap,
    private readonly mobs: Mobs,
    private readonly fx: FxLayers,
    private readonly grid: WalkGrid,
    private readonly terrain: Terrain | null,
    private readonly hooks: WarrensHooks,
  ) {
    this.telegraphs = new Telegraphs(scene, fx);
    // Barong-Barong's art waits for its hall; the golem's (the Scraplings, the slams' effects) comes with the run.
    mobs.holdArt.add(this.lastId);
    mobs.kindSounds.set(this.lastId, {
      hurtMs: HURT_MS,
      hurt: (m) => this.bossSound('barong-hurt', m, { gapMs: HURT_MS }),
      death: (m) => this.bossSound('barong-death', m),
    });
    void loadBoss(scene, M, GOLEM).then(() => (this.golemArt = true));
    this.makeShutters();
    this.seal(true); // (until the server says the run's under way)
  }

  private get block() {
    return this.map.dungeon!;
  }

  private get D(): DungeonsData | null {
    return (this.scene.cache.json.get('dungeons') as DungeonsData | undefined) ?? null;
  }

  // ── Shutters and the seal ──

  private makeShutters(): void {
    const closed = this.M.props['warrens-shutter-closed'] as PropDef | undefined;
    const open = this.M.props['warrens-shutter-open'] as PropDef | undefined;
    if (!closed || !open) return;
    for (const s of this.block.shutters) {
      const [mc, mr] = s.tiles[1] ?? s.tiles[0];
      const at = this.mobs.ground(mc + 0.5, mr + 0.5);
      const cols = s.tiles.map((t) => t[0]);
      const rows = s.tiles.map((t) => t[1]);
      const depth = frontDepth(Math.min(...cols), Math.min(...rows), Math.max(...cols) - Math.min(...cols) + 1, Math.max(...rows) - Math.min(...rows) + 1);
      const img = (def: PropDef) =>
        this.scene.add.image(at.x, at.y, def.file).setOrigin((s.flip ? def.size[0] - def.anchor[0] : def.anchor[0]) / def.size[0], def.anchor[1] / def.size[1]).setFlipX(s.flip).setDepth(depth);
      this.shutters.push({ area: s.area, closed: img(closed), open: img(open).setVisible(false), passage: s.passage, at });
    }
  }

  /** The start room's way out shut (while the run gathers) or open. */
  private seal(on: boolean): void {
    if (on === this.sealed) return;
    this.sealed = on;
    for (const [c, r] of this.block.seal) {
      if (on) this.grid.block(c, r);
      else this.grid.unblock(c, r);
    }
  }

  /** The run as the server has it (`warrens`): shutters opened (with their slide when it happens while you watch), the
   *  start room's seal. */
  run(r: TownWarrensRun): void {
    this.seal(r.phase === 'gathering');
    for (const s of this.shutters) {
      if (!r.opened.includes(s.area) || this.opened.has(s.area)) continue;
      this.openShutter(s, this.seen);
    }
    this.opened = new Set(r.opened);
    this.seen = true;
    if (r.phase === 'closed') this.clear();
  }

  private openShutter(s: ShutterView, animate: boolean): void {
    for (const [c, r] of s.passage) this.grid.unblock(c, r);
    if (!animate || reducedMotion()) {
      s.closed.setVisible(false);
      s.open.setVisible(true);
      return;
    }
    s.open.setVisible(true).setAlpha(0);
    this.scene.tweens.add({ targets: s.closed, y: s.at.y - 24, alpha: 0, duration: SHUTTER_MS, ease: 'Quad.easeIn', onComplete: () => s.closed.setVisible(false) });
    this.scene.tweens.add({ targets: s.open, alpha: 1, duration: SHUTTER_MS });
    for (const [c, r] of s.passage) this.fx.play(this.M.fx['dig-dust'], this.mobs.ground(c + 0.5, r + 0.5), { life: SHUTTER_MS + 300, fadeOut: 300 });
    this.fx.play(this.golemFx('fx-golem-rubble-ring'), s.at, { life: 1500, fadeIn: 100, fadeOut: 600, scale: 0.6 });
    if (this.inView(s.at, 96)) playWarrens('warrens-shutter-open');
    this.shake(s.at, 200);
  }

  // ── Every frame ──

  update(): void {
    const me = this.hooks.me();
    // An area's name as you walk into it.
    const a = areaAt(this.block, me.col, me.row);
    if (a && a.id !== this.area) {
      this.area = a.id;
      showAreaBanner(a.name);
    }
    // The boss of the arena you're in: the bar at the top.
    const boss = a && inRect(a.arena, me.col, me.row) ? this.mobs.list.find((m) => m.mini && m.zone.id === a.id && !m.dead && (m.kind === this.lastId || m.id.startsWith('boss:'))) : undefined;
    this.bar.show(boss ? { name: boss.mini!.name, ...(boss.kind === this.lastId ? { title: this.D?.warrens.lastBoss.title } : {}), level: boss.level, hp: boss.hp, maxHp: boss.maxHp, enraged: boss.enraged } : null);
    // Barong-Barong's art once you come near its hall; red windows from a quarter (a late arrival sees it too).
    const hall = this.block.areas.find((x) => x.id === areaAt(this.block, ...this.block.boss.tile)?.id);
    if (hall && this.mobs.holdArt.has(this.lastId)) {
      const [c0, r0, c1, r1] = hall.rect;
      if (Math.max(c0 - me.col, me.col - c1, r0 - me.row, me.row - r1, 0) <= BARONG_NEAR) this.mobs.releaseArt(this.lastId);
    }
    // Barong-Barong's arena with it up: what the camera keeps in view (its whole art and you).
    this.frame = null;
    if (boss && boss.kind === this.lastId) {
      const f = this.mobs.feet(boss);
      const k = boss.data?.scale ?? 1;
      const [x0, y0, x1, y1] = boss.data?.frame ?? [0, 0, boss.cell.size[0], boss.cell.size[1]];
      const [ax, ay] = boss.cell.anchor;
      const box = new Phaser.Geom.Rectangle(f.x + (x0 - ax) * k, f.y + (y0 - ay) * k, (x1 - x0) * k, (y1 - y0) * k);
      const mine = this.hooks.myBox();
      // Centred on it (the camera centres the frame: it in the middle of the screen), as wide and tall either way as it
      // takes to take you in too.
      const [cx, cy] = [box.centerX, box.centerY];
      const halfW = Math.max(box.width / 2, ...(mine ? [cx - mine.left, mine.right - cx] : []));
      const halfH = Math.max(box.height / 2, ...(mine ? [cy - mine.top, mine.bottom - cy] : []));
      this.frame = new Phaser.Geom.Rectangle(cx - halfW, cy - halfH, halfW * 2, halfH * 2);
    }
    const king = this.mobs.get(`boss:${this.lastId}`);
    if (king && !king.enraged && !king.dead && king.hp / king.maxHp <= (this.enrageAt ?? 0.25)) this.enrage(king);
    // The junk walls just in front of you, faded.
    this.terrain?.fadeFront(me, this.hooks.myBox());
  }

  /** What the camera should keep in view now (Barong-Barong's arena with it up), or null: follow as ever. */
  bossFrame(): Phaser.Geom.Rectangle | null {
    return this.frame;
  }
  private frame: Phaser.Geom.Rectangle | null = null;

  private get lastId(): string {
    return this.D?.warrens.lastBoss.id ?? 'barong-barong';
  }

  private get enrageAt(): number | null {
    const e = this.D?.warrens.lastBoss.mechanics.find((m) => m.id === 'enrage')?.atHp;
    return typeof e === 'number' ? e : null;
  }

  // ── Boss moves ──

  move(m: Move): void {
    const boss = this.mobs.get(m.id) ?? null;
    if (m.shape) this.telegraphs.show(m.key, m.id, m.shape, m.ms);
    const d = (m.data ?? {}) as Record<string, unknown>;
    const at = (t: [number, number]) => this.mobs.ground(t[0] + 0.5, t[1] + 0.5);
    switch (m.move) {
      case 'lidSlam':
        this.poseFor(boss, 'attack', m.ms);
        this.later(m.id, m.ms, () => {
          this.slamAt(boss ? this.mobs.feet(boss) : at((m.shape as Extract<TelegraphShape, { kind: 'circle' }>).at), 1, m.id);
          this.bossSound('celes-tin-lid-slam', boss);
        });
        return;
      case 'burnoutCharge': {
        // Smoke from its back for the warning (streaming away from where it'll roll), then it rolls (the server's hop).
        const line = m.shape as Extract<TelegraphShape, { kind: 'line' }>;
        const left = (line.to[0] - line.to[1]) - (line.from[0] - line.from[1]) < 0;
        if (boss) this.keep(m.id, this.fx.play(this.M.fx['fx-warrens-burnout-smoke'], this.mobs.feet(boss), { flipX: left, life: m.ms, fadeOut: 200, follow: () => this.mobs.feet(boss) }));
        this.later(m.id, Math.max(0, m.ms - 1000), () => this.bossSound('tire-ranny-burnout', boss)); // (a 1 s rev, ending as it rolls)
        return;
      }
      case 'smotherFog': {
        const circles = (m.shape as Extract<TelegraphShape, { kind: 'circles' }>).circles;
        this.poseFor(boss, 'attack', m.ms);
        this.later(m.id, m.ms, () => {
          circles.forEach((c) => this.fx.play(this.M.fx['fx-warrens-fog-puff'], at(c.at)));
          this.bossSound('bag-yani-fog', boss); // (once a volley)
        });
        return;
      }
      case 'vanish': {
        const from = d.from as [number, number] | undefined;
        const to = d.to as [number, number] | undefined;
        if (from) this.fx.play(this.M.fx['fx-warrens-fog-puff'], at(from));
        this.bossSound('bag-yani-vanish', boss); // (fading out…)
        if (to) this.later(m.id, m.ms, () => this.fx.play(this.M.fx['fx-warrens-fog-puff'], at(to)));
        this.later(m.id, m.ms, () => this.bossSound('bag-yani-vanish', boss)); // (…and back in)
        return;
      }
      case 'chainZap': {
        const chain = (d.chain as string[] | undefined) ?? [];
        this.poseFor(boss, 'attack', m.ms);
        this.later(m.id, m.ms, () => this.zap(boss, chain));
        return;
      }
      case 'liveFloor': {
        const tiles = (m.shape as Extract<TelegraphShape, { kind: 'tiles' }>).tiles;
        this.later(m.id, Math.max(0, m.ms - 60), () => tiles.forEach((t) => this.fx.play(this.M.fx['fx-warrens-live-floor'], at(t))));
        this.later(m.id, m.ms, () => this.bossSound('wire-wolf-live-floor', boss)); // (once for all its tiles)
        return;
      }
      case 'pincerSweep': {
        const cone = m.shape as Extract<TelegraphShape, { kind: 'cone' }>;
        const [oc, or] = cone.origin;
        const [dc, dr] = [Math.cos(cone.facing), Math.sin(cone.facing)];
        const spot = this.mobs.ground(oc + 0.5 + dc * 1.5, or + 0.5 + dr * 1.5);
        this.poseFor(boss, 'attack', m.ms);
        this.later(m.id, Math.max(0, m.ms - 60), () => this.fx.play(this.M.fx['fx-warrens-pincer-slash'], spot, { flipX: dc - dr < 0 }));
        this.later(m.id, m.ms, () => this.bossSound('crab-tain-pincer', boss));
        return;
      }
      case 'hunker':
        this.bossSound('crab-tain-hunker', boss);
        if (boss) {
          const feet = () => this.mobs.feet(boss);
          this.keep(m.id, this.fx.play(this.M.fx['fx-warrens-hunker-shell-back'], feet(), { life: m.ms, fadeIn: 150, fadeOut: 250, follow: feet }));
          this.keep(m.id, this.fx.play(this.M.fx['fx-warrens-hunker-shell-front'], feet(), { life: m.ms, fadeIn: 150, fadeOut: 250, follow: feet }));
        }
        return;
      case 'call':
      case 'vanishCall':
        for (const s of (d.spots as [number, number][] | undefined) ?? []) this.fx.play(this.golemFx('fx-golem-call-junk') ?? this.M.fx['dig-dust'], at(s), { scale: 0.7 });
        this.sound('call-junk', boss);
        return;
      case 'shantyCall': {
        // The call anim (its spawn frame on the Scraplings' arrival), the door bursting on its frame 2, the Scraplings out.
        const frame = this.hitFrame('call', 3);
        const A = boss?.def.animations.call;
        const start = Math.max(0, m.ms - (A ? (frame / A.fps) * 1000 : 300));
        this.poseFor(boss, 'call', m.ms, frame);
        if (boss) this.later(m.id, start + (A ? (2 / A.fps) * 1000 : 200), () => {
          const f = this.mobs.feet(boss);
          this.fx.play(this.M.fx['fx-warrens-door-burst'], { x: f.x + 34, y: f.y - 136 });
          this.bossSound('barong-door-burst', boss);
        });
        for (const s of (d.spots as [number, number][] | undefined) ?? []) this.later(m.id, m.ms, () => this.fx.play(this.M.fx['dig-dust'], at(s)));
        return;
      }
      case 'enrage':
        if (boss) this.enrage(boss);
        return;
      case 'fistSlam':
        return this.fistSlam(m, boss, d);
      case 'roofRain':
        return this.roofRain(m, boss, d);
      case 'gutterSweep': {
        const cone = m.shape as Extract<TelegraphShape, { kind: 'cone' }>;
        const [oc, or] = cone.origin;
        const spot = this.mobs.ground(oc + 0.5 + Math.cos(cone.facing) * 3, or + 0.5 + Math.sin(cone.facing) * 3);
        const frame = this.hitFrame('sweep', 6);
        this.poseFor(boss, 'sweep', m.ms, frame);
        const sweep = boss?.def.animations.sweep;
        this.later(m.id, Math.max(0, m.ms - (sweep ? (frame / sweep.fps) * 1000 : 500)), () => this.bossSound('barong-gutter-sweep', boss)); // (with the sweep anim)
        // Its strip's frame 8 on the hit, like the anim's.
        const S = this.M.fx['fx-warrens-gutter-sweep'];
        this.later(m.id, Math.max(0, m.ms - (8 / (S?.fps ?? 16)) * 1000), () => this.fx.play(S, spot));
        this.later(m.id, m.ms, () => this.shake(spot, 250));
        return;
      }
      case 'scrapSlam': {
        // A Scrapling's Tire Slam: the golem's slam, small.
        const to = d.at as [number, number] | undefined;
        const k = (boss?.data?.scale ?? 0.6) / (this.golemScale ?? 1.5);
        this.poseFor(boss, 'attack', m.ms);
        if (to) this.later(m.id, m.ms, () => this.slamAt(at(to), k, m.id));
        return;
      }
      case 'fallApart':
        for (const id of (d.ids as string[] | undefined) ?? []) {
          const s = this.mobs.get(id);
          if (s && !s.dead) this.fx.play(this.M.fx['dig-dust'], this.mobs.feet(s));
        }
        return;
    }
  }

  /** A move landing (`boss-hit`): each hit's number over whoever it caught (Smother Fog's slow with it). */
  hit(m: Hit): void {
    const boss = this.mobs.get(m.id) ?? null;
    const slow = m.move === 'smotherFog' ? this.D?.warrens.areas.flatMap((a) => a.miniBoss.mechanics).find((x) => x.id === 'smotherFog')?.slow?.ms : undefined;
    for (const h of m.hits) this.hooks.onHit(boss, h.id, h, slow);
  }

  /** A boss reset or fell: its telegraphs, timers and effects gone. */
  cancel(id: string): void {
    this.telegraphs.cancel(id);
    for (const t of this.timers.get(id) ?? []) t.remove();
    this.timers.delete(id);
    for (const h of this.handles.get(id) ?? []) h.kill(150);
    this.handles.delete(id);
  }

  /** Everything gone (the run closed, the scene ends). */
  clear(): void {
    this.telegraphs.clear();
    for (const id of [...this.timers.keys(), ...this.handles.keys()]) this.cancel(id);
  }

  destroy(): void {
    this.clear();
    this.bar.destroy();
    this.terrain?.fadeFront(null, null);
  }

  // ── Barong-Barong ──

  private fistSlam(m: Move, boss: Mob | null, d: Record<string, unknown>): void {
    const c = m.shape as Extract<TelegraphShape, { kind: 'circle' }>;
    const spot = this.mobs.ground(c.at[0] + 0.5, c.at[1] + 0.5);
    const hand = d.hand === 'r' ? 'r' : 'l';
    this.poseFor(boss, `slam-${hand}`, m.ms, this.hitFrame(`slam-${hand}`, 6));
    // The fist drops from above the screen onto its circle over the warning's last moment, its shadow growing under it.
    this.later(m.id, Math.max(0, m.ms - FIST_FALL_MS), () => {
      const top = this.scene.cameras.main.worldView.y - 40;
      this.drop(m.id, this.M.fx['fx-barong-fist'], this.M.fx['fx-barong-fist-shadow'], { x: spot.x, y: top }, spot, Math.min(FIST_FALL_MS, m.ms));
    });
    this.later(m.id, Math.max(0, m.ms - FIST_SOUND_MS), () => this.bossSound('barong-fist-fall', boss)); // (ends as it lands)
    this.later(m.id, m.ms, () => {
      this.slamAt(spot, 1.6, m.id);
      this.bossSound('barong-fist-slam', boss);
    });
  }

  private roofRain(m: Move, boss: Mob | null, d: Record<string, unknown>): void {
    const circles = (m.shape as Extract<TelegraphShape, { kind: 'circles' }>).circles;
    const offsets = (d.offsets as number[] | undefined) ?? [];
    const poses = (d.poses as number[] | undefined) ?? [];
    this.poseFor(boss, 'rain', Math.max(0, m.ms - SHEET_FALL_MS), this.hitFrame('rain', 6)); // (it lets go as they start falling)
    this.later(m.id, Math.max(0, m.ms - SHEET_FALL_MS), () => this.bossSound('barong-roof-rip', boss)); // (the rain anim's frame 6)
    // A few of the sheets' landings heard (picked at random), each a little higher or lower.
    const heard = new Set(circles.map((_, i) => i).sort(() => Math.random() - 0.5).slice(0, ROOF_SOUNDS));
    const S = this.M.fx['fx-roof-sheet'];
    circles.forEach((c, i) => {
      const spot = this.mobs.ground(c.at[0] + 0.5, c.at[1] + 0.5);
      const land = Math.max(0, m.ms - (offsets[i] ?? 0));
      const fall = Math.min(SHEET_FALL_MS, land);
      this.later(m.id, land - fall, () => {
        const top = this.scene.cameras.main.worldView.y - 40;
        const n = S?.frames ?? 16;
        const frames = Array.from({ length: n }, (_, k) => ((poses[i] ?? 0) + k) % n);
        this.drop(m.id, S, this.M.fx['fx-barong-fist-shadow'], { x: spot.x + ((i % 3) - 1) * 12, y: top }, spot, fall, frames, 0.5);
      });
      this.later(m.id, land, () => {
        this.fx.play(this.golemFx('fx-golem-scrap-land') ?? this.M.fx['dig-dust'], spot, { scale: 1.2 });
        if (heard.has(i)) this.bossSound('barong-roof-land', boss, { rate: 0.95 + Math.random() * 0.1, gapMs: 0 });
      });
    });
    this.later(m.id, m.ms, () => this.shake(boss ? this.mobs.feet(boss) : { x: 0, y: 0 }, 200));
  }

  /** Its red windows: the enraged set (loaded now), the golem's enrage burst on its chest. */
  private enrage(m: Mob): void {
    if (m.enraged) return;
    m.enraged = true; // (asked once; shown as soon as its sheets are in)
    void this.mobs.loadEnraged(m.zone.mob).then(() => {
      m.enraged = false;
      this.mobs.setEnraged(m, true);
    });
    const f = this.mobs.feet(m);
    this.fx.play(this.golemFx('fx-golem-enrage'), { x: f.x, y: f.y - 220 }, { scale: 2 });
    if (m.zone.mob === this.lastId) this.bossSound('barong-enrage', m);
    else this.sound('enrage', m);
  }

  // ── Pieces ──

  /** Something falling from `from` onto `to` over `ms` (the fist, a roof sheet), its shadow growing under it from 0.3 to
   *  `shadowTo`; gone as it lands. */
  private drop(owner: string, def: FxDef | undefined, shadow: FxDef | undefined, from: Pt, to: Pt, ms: number, frames?: number[], shadowTo = 1): void {
    if (shadow?.file && this.scene.textures.exists(shadow.file)) {
      const [w, h] = shadow.frame ?? [64, 24];
      const [ax, ay] = shadow.anchor ?? [w / 2, h / 2];
      const img = this.scene.add.image(to.x, to.y, shadow.file).setOrigin(ax / w, ay / h).setDepth(FX_DEPTH.ground).setScale(0.3 * shadowTo).setAlpha(0.6);
      this.scene.tweens.add({ targets: img, scale: shadowTo, alpha: 1, duration: ms, ease: 'Quad.easeIn', onComplete: () => this.scene.tweens.add({ targets: img, alpha: 0, duration: 250, onComplete: () => img.destroy() }) });
      this.keep(owner, { kill: () => img.destroy() });
    }
    this.keep(owner, this.fx.shot(def, from, to, { speed: 1, flightMs: ms, turn: false, ...(frames ? { frames } : {}) }));
  }

  /** The golem's slam where something lands: its impact and shockwave (`k`: their size), a small shake. */
  private slamAt(at: Pt, k: number, owner: string): void {
    this.keep(owner, this.fx.play(this.golemFx('fx-golem-slam-impact') ?? this.M.fx['dig-dust'], at, { scale: k }));
    this.keep(owner, this.fx.play(this.golemFx('fx-golem-shockwave'), at, { scale: k }));
    this.shake(at, 200);
  }

  /** Chain Zap: a spark from the boss to the first, then on to each, a hop apart. */
  private zap(boss: Mob | null, chain: string[]): void {
    let from: Pt | null = boss ? { x: this.mobs.feet(boss).x, y: this.mobs.feet(boss).y - 40 } : null;
    chain.forEach((id, i) => {
      const a = from;
      const b = this.hooks.body(id);
      from = b;
      if (!a || !b) return;
      this.scene.time.delayedCall(i * ZAP_HOP_MS, () => {
        this.fx.drawFx('front', (g) => bolt(g, a, b), ZAP_SHOW_MS, 80);
        this.bossSound('wire-wolf-zap', boss, { gapMs: 0 }); // (once a jump)
      });
    });
  }

  /** The boss's anim so that its frame `frame` (else its mobs.json attack frame) lands `ms` from now. */
  private poseFor(m: Mob | null, anim: string, ms: number, frame?: number): void {
    const A = m?.def.animations[anim];
    if (!m || !A) return;
    const f = frame ?? m.data?.attackFrame ?? 0;
    this.later(m.id, Math.max(0, ms - (f / A.fps) * 1000), () => !m.dead && this.mobs.pose(m, anim));
  }

  private hitFrame(anim: string, fallback: number): number {
    const def = this.M.mobs?.[this.lastId];
    return (typeof def === 'object' && def.hitFrames?.[anim]) || fallback;
  }

  private later(owner: string, ms: number, fn: () => void): void {
    const list = this.timers.get(owner) ?? [];
    list.push(this.scene.time.delayedCall(Math.max(0, ms), fn));
    this.timers.set(owner, list.filter((t) => t.getProgress() < 1));
  }

  private keep(owner: string, h: FxHandle | null): void {
    if (!h) return;
    const list = this.handles.get(owner) ?? [];
    list.push(h);
    this.handles.set(owner, list.slice(-24));
  }

  private golemFx(id: string): FxDef | undefined {
    if (!this.golemArt) return undefined;
    const g = this.M.mobs?.[GOLEM];
    return typeof g === 'object' ? g.fx?.[id] : undefined;
  }

  private get golemScale(): number | null {
    const raw = (this.scene.cache.json.get('mob-data') ?? {})[GOLEM];
    return typeof raw === 'object' ? (raw.scale ?? null) : null;
  }

  /** A shake for something you can see: short (never over 0.4 s), none with reduced motion. */
  private shake(at: Pt, ms: number): void {
    const cam = this.scene.cameras.main;
    if (!reducedMotion() && cam.worldView.contains(at.x, at.y)) cam.shake(Math.min(400, ms), 0.002);
  }

  /** One of a boss's own sounds, only if you can see it (any of its drawn box on screen). */
  private bossSound(name: WarrensSfx, m: Mob | null, o: { rate?: number; gapMs?: number } = {}): void {
    if (!m) return;
    const f = this.mobs.feet(m);
    const k = m.data?.scale ?? 1;
    const [w, h] = m.cell.size;
    const [ax, ay] = m.cell.anchor;
    const box = new Phaser.Geom.Rectangle(f.x - ax * k, f.y - ay * k, w * k, h * k);
    if (Phaser.Geom.Rectangle.Overlaps(this.scene.cameras.main.worldView, box)) playWarrens(name, o);
  }

  /** Whether a point (with `margin` px round it) is on screen. */
  private inView(p: Pt, margin = 0): boolean {
    const v = this.scene.cameras.main.worldView;
    return p.x >= v.x - margin && p.x <= v.right + margin && p.y >= v.y - margin && p.y <= v.bottom + margin;
  }

  private sound(name: string, m: Mob | null): void {
    const heard: Heard = { at: m ? { col: Math.floor(m.col), row: Math.floor(m.row) } : undefined, others: true };
    playSet(`golem-${name}`, heard);
  }

}

/** A jagged yellow-white bolt from a to b (re-jagged each frame). */
function bolt(g: Phaser.GameObjects.Graphics, a: Pt, b: Pt): void {
  const n = Math.max(3, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 10));
  const pts: Pt[] = [a];
  for (let i = 1; i < n; i++) pts.push({ x: a.x + ((b.x - a.x) * i) / n + Phaser.Math.Between(-3, 3), y: a.y + ((b.y - a.y) * i) / n + Phaser.Math.Between(-3, 3) });
  pts.push(b);
  const line = (w: number, c: number, al: number) => {
    g.lineStyle(w, c, al).beginPath().moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
    g.strokePath();
  };
  line(3, 0xfacc15, 0.7);
  line(1, 0xffffff, 1);
}
