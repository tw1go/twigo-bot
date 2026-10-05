import Phaser from 'phaser';
import type { ArenaHand, ArenaServerMessage, TitleData } from '@mikazuki/shared';
import type { Manifest } from '../assets/types';
import { arenaMusicOn, playSound } from '../audio/sound';
import { type Outfit, headTop, loadOutfit, randomOutfit, recolourSheet, sheetKey } from '../characters/doll';
import { hash, rng } from '../world/rng';
import { type ArenaChannel, type ArenaOpponent, HANDS } from '../arena/channel';
import { betField } from '../arena/menu';

// ✊ The Arena's jack en poy screen, over the town (which is faded out behind it): inside the arena — a dark bowl,
// a sand platform ringed by cheering spectators, in the middle with both players on it. The match
// opens with a white band across the middle (about 30% of the screen) with speed lines rushing in and the VS slam;
// the band folds away for the rounds — three hands to pick from (keys 1–3, a 10 s
// timer), both hands bobbing in "Jack… en… poy!", the clash — until someone has 2 round wins: the winner cheers and
// hops under confetti, the loser shakes their head and sits under a rain cloud. Rematch or Leave (in the middle), with a
// bet for the rematch: against a player the other is asked (Accept with their own bet, or Decline); the stake is the
// smaller bet, shown top centre while it plays, and what was won or lost shows at the end.
//
// It only speaks the arena protocol (arena/channel.ts): the server decides a match against another player, the bot
// channel plays the same messages here. Messages are handled one at a time, each after the last one's animation.
// The bowl and the platform are drawn here in the palette (no art for them yet), the crowd is the spectators' art, at the dolls' whole-number zoom; the
// night tint never touches this screen. Text is Pixelify Sans. Buttons and the timer are a DOM bar (#arena-ui) under the town's HUD.

export interface ArenaData {
  M: Manifest;
  me: { nickname: string; title: TitleData; outfit: Outfit };
  channel: ArenaChannel;
  /** The bet placed in the menu (the rematch starts from it). */
  bet: number;
  /** The town's zoom (the speed lines are drawn at it). */
  zoom: number;
  /** Back to the town (TownScene's way out, the same as the casino's). */
  leave: () => void;
}

const WHITE = 0xffffff;
const NAVY = 0x1e1b3a;
const INK = '#FFFFFF';
const INK_EDGE = '#1E1B3A';
/** The arena's bowl and platform (palette). */
const STAGE = { sky: '#15132A', sand: '#C0A888', sandLight: '#F0E0C8', rim: '#8A7258', side: '#5C3A24', sideDark: '#3A2418', line: '#1E1B3A' };
/** The round's and the match's lines: their colour (and their plate's border) by how it went. */
/** The near crowd, seen from behind: flat, a shade darker than the bowl. */
const SILHOUETTE = 0x0a0916;
/** The spotlights' colours (added over the stage, faint). */
const BEAMS = [0xfff2b0, 0xc8b8ff, 0xffffff, 0xfff2b0];
const TONE = { win: '#A3E635', lose: '#D946EF', draw: '#FCDA4A', plain: '#FFFFFF' } as const;
type Tone = keyof typeof TONE;

/** The VS band's least share of the screen's height (it grows to hold the close-up dolls). */
const BAND = 0.3;
const FONT = '"Pixelify Sans", system-ui, sans-serif';
const SPEED = 600; // px/s on screen, the speed lines in the intro (a quarter of it during rounds)
const LABEL: Record<ArenaHand, string> = { bato: 'Bato', papel: 'Papel', gunting: 'Gunting' };
const FRAME: Record<ArenaHand, number> = { bato: 0, papel: 1, gunting: 2 };
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Pitch as a ratio → cents (playSound's pitch). */
const cents = (ratio: number) => Math.round(1200 * Math.log2(ratio));
/** The three "Jack / en / poy!" ticks climb a little. */
const BOB_PITCH = [1, 1.06, 1.12];
const kowens = (n: number) => `${n} ${n === 1 ? 'Kowen' : 'Kowens'}`;
const wait = (scene: Phaser.Scene, ms: number) => new Promise<void>((r) => scene.time.delayedCall(ms, r));

interface Side {
  name: string;
  outfit: Outfit;
  doll: Phaser.GameObjects.Sprite;
  dir: 'se' | 'sw';
  plate: Phaser.GameObjects.Text;
  botIcon: Phaser.GameObjects.Sprite | null;
  pips: Phaser.GameObjects.Sprite[];
  hand: Phaser.GameObjects.Sprite;
  handKey: string;
  cloud: Phaser.GameObjects.Sprite | null;
  hop: number; // px up (whole pixels), for the winner's hops
}

export class ArenaScene extends Phaser.Scene {
  private d!: ArenaData;
  private me!: Side;
  private them!: Side;
  private opponent: ArenaOpponent | null = null;
  private zoom = 6; // the dolls' zoom
  private handZoom = 6; // the hands', as big as the dolls
  private portrait = false;
  private band!: Phaser.GameObjects.Container;
  private lines: Phaser.GameObjects.TileSprite[] = []; // the band's left half, in rows
  private linesRight: Phaser.GameObjects.TileSprite[] = [];
  private slash!: Phaser.GameObjects.Graphics;
  private speed = SPEED;
  private vs: Phaser.GameObjects.Sprite | null = null;
  private line!: Phaser.GameObjects.Text;
  private lineBox!: Phaser.GameObjects.Container;
  private plate!: Phaser.GameObjects.Graphics;
  private words!: Phaser.GameObjects.Text;
  private ui!: HTMLElement;
  private bar!: HTMLElement;
  private timer!: HTMLElement;
  private picks: HTMLButtonElement[] = [];
  private note!: HTMLElement;
  private end!: HTMLElement;
  private rematchButton!: HTMLButtonElement;
  private declineButton!: HTMLButtonElement;
  private askLine!: HTMLElement;
  private betRow!: { el: HTMLElement; value: () => number };
  private stakeTag!: HTMLElement;
  private stake = 0;
  private asked = false; // the other player asked for a rematch
  private chain: Promise<void> = Promise.resolve();
  private stopListening: (() => void) | null = null;
  private roundOpen = false;
  private picked = false;
  private roundTimer: Phaser.Time.TimerEvent | null = null;
  private ticks: Phaser.Time.TimerEvent[] = [];
  private started = false;
  private over = false;
  private gone = false; // the other player left
  private confetti: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private viewers: Phaser.GameObjects.Sprite[] = [];

  constructor() {
    super('arena');
  }

  init(data: ArenaData): void {
    this.d = data;
    Object.assign(this, { ticks: [], chain: Promise.resolve(), roundOpen: false, picked: false, started: false, over: false, gone: false, opponent: null, vs: null, lines: [], linesRight: [], picks: [], confetti: null, viewers: [], stake: 0, asked: false, speed: reducedMotion() ? 0 : SPEED });
  }

  create(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    this.portrait = H > W && W <= 760;
    const small = Math.min(W, H) < 600 || W <= 760;
    this.zoom = small ? 4 : 6;
    this.handZoom = small ? 4 : 6;
    this.cameras.main.setRoundPixels(true);
    this.load.setPath(`${import.meta.env.BASE_URL}assets/`); // a look not in town yet (the bot's) loads from here

    // The arena: the bowl, the spectators, the platform.
    this.buildStage();
    // The VS band across the middle: white, speed lines rushing in from both sides, a navy slash between the halves.
    // Tall enough to hold the close-up dolls, head to feet (they stand from 18 to 30 art px either side of the middle).
    const big = this.introZoom();
    const bandH = Math.max(Math.round(H * BAND), 48 * big + 24);
    this.band = this.add.container(0, Math.round(this.middle() + 6 * big)).setDepth(4.5); // over the near crowd (4), under the dolls (5)
    this.band.add(this.add.rectangle(0, -bandH / 2, W, bandH, WHITE).setOrigin(0, 0));
    const sl = this.d.M.ui.vsSpeedlines;
    if (sl && this.textures.exists(sl.file)) {
      // Sideways at a whole-number scale (the one that would cover the screen's height); squished to one tile exactly
      // the band's height, so its thicker lines along the top and bottom show.
      // Each half is cut into thin rows that end at the tilted slash (the lines run sideways, so the rows don't show),
      // and every row's seam hides under the slash.
      const z = Math.max(1, Math.ceil(H / sl.size[1]));
      const sy = bandH / sl.size[1];
      const rowH = 8;
      for (let t = 0; t < bandH; t += rowH) {
        const h = Math.min(rowH, bandH - t);
        const seam = Math.round(this.slashX(t + h / 2, bandH));
        const rows = [this.add.tileSprite(0, t - bandH / 2, seam, h, sl.file), this.add.tileSprite(seam, t - bandH / 2, W - seam, h, sl.file)];
        rows.forEach((row, i) => {
          row.setOrigin(0, 0).setTileScale(z, sy);
          row.tilePositionY = t / sy;
          row.tilePositionX = i ? -seam / z : 0; // the right half carries on where it starts
          (i ? this.linesRight : this.lines).push(row);
          this.band.add(row);
        });
      }
    }
    this.slash = this.add.graphics();
    this.band.add(this.slash);
    this.drawSlash(bandH);

    // The round's lines on a navy plate with a coloured border; "Jack / en / poy!" big and gold.
    this.plate = this.add.graphics();
    this.line = this.text('', 38).setOrigin(0.5);
    this.lineBox = this.add.container(0, 0, [this.plate, this.line]).setDepth(20).setVisible(false);
    this.words = this.text('', this.portrait ? 52 : 72).setOrigin(0.5).setDepth(20).setColor('#FCDA4A').setStroke(INK_EDGE, 10).setShadow(0, 6, INK_EDGE, 0, true, true);
    this.buildUi();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanUp());
    this.stopListening = this.d.channel.listen((m) => (this.chain = this.chain.then(() => this.handle(m)).catch((err) => console.error('[arena]', err))));
  }

  update(_t: number, delta: number): void {
    if (!this.band.visible) return;
    // Left half to the right, right half to the left: towards the middle.
    const step = (this.speed * delta) / 1000 / Math.max(1, this.lines[0]?.tileScaleX ?? 1);
    for (const row of this.lines) row.tilePositionX -= step;
    for (const row of this.linesRight) row.tilePositionX += step;
  }

  /** A line in the middle — a round's result, the match's — on its plate, popping in (just appearing with reduced
   *  motion). `big` for the match's. */
  private shout(text: string, tone: Tone, y: number, big = false): void {
    const size = Math.round((this.portrait ? 26 : 38) * (big ? 1.4 : 1));
    const colour = TONE[tone];
    this.line.setText(text).setFontSize(size).setColor(colour);
    const w = Math.ceil(this.line.width) + 44;
    const h = Math.ceil(this.line.height) + 18;
    this.plate
      .clear()
      .fillStyle(NAVY, 0.92)
      .fillRect(-w / 2, -h / 2, w, h)
      .lineStyle(4, Phaser.Display.Color.HexStringToColor(colour).color, 1)
      .strokeRect(-w / 2, -h / 2, w, h);
    this.lineBox.setPosition(Math.round(this.scale.width / 2), Math.round(y)).setVisible(true);
    this.tweens.killTweensOf(this.lineBox);
    if (reducedMotion()) this.lineBox.setScale(1);
    else {
      this.lineBox.setScale(0.3);
      this.tweens.add({ targets: this.lineBox, scale: 1, duration: 240, ease: 'Back.easeOut' });
    }
  }

  private hush(): void {
    this.lineBox.setVisible(false);
  }

  private text(s: string, size: number): Phaser.GameObjects.Text {
    return this.add.text(0, 0, s, { fontFamily: FONT, fontSize: `${size}px`, fontStyle: 'bold', color: INK, align: 'center', stroke: INK_EDGE, strokeThickness: 6 });
  }

  /** The slash's middle at `t` px down the band (it leans: right at the top, left at the bottom). */
  private slashX(t: number, bandH: number): number {
    const tilt = bandH * 0.12;
    return this.scale.width / 2 + tilt - (t / bandH) * 2 * tilt;
  }

  /** The navy slash across the band, a little tilted (about 8 px wide at 1×, at half the town's zoom). */
  private drawSlash(bandH: number): void {
    const x = this.scale.width / 2;
    const w = 8 * Math.max(1, Math.round(this.d.zoom)) * 0.5;
    const top = -bandH / 2;
    const tilt = bandH * 0.12;
    this.slash.clear().fillStyle(NAVY, 1);
    this.slash.fillPoints([new Phaser.Math.Vector2(x + tilt - w / 2, top), new Phaser.Math.Vector2(x + tilt + w / 2, top), new Phaser.Math.Vector2(x - tilt + w / 2, top + bandH), new Phaser.Math.Vector2(x - tilt - w / 2, top + bandH)], true);
  }

  /**
   * The arena, drawn as pixel art at the dolls' zoom: the dark bowl and the platform (a sand ellipse with a rim and a
   * stone side) under both players. The crowd is the spectators' art (ui.arenaViewers), in a ring round the platform.
   */
  private buildStage(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const z = this.zoom;
    const aw = Math.ceil(W / z);
    const ah = Math.ceil(H / z);
    const c = document.createElement('canvas');
    c.width = aw;
    c.height = ah;
    let g = c.getContext('2d')!;
    g.fillStyle = STAGE.sky;
    g.fillRect(0, 0, aw, ah);
    /** A filled ellipse, pixel by pixel (no smoothing). */
    const ellipse = (cx: number, cy: number, rx: number, ry: number, colour: string) => {
      g.fillStyle = colour;
      for (let y = -ry; y <= ry; y++) {
        const half = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))));
        g.fillRect(Math.round(cx - half), Math.round(cy + y), half * 2 + 1, 1);
      }
    };
    const r = rng(hash(aw, ah, 9));
    const feet = Math.round(this.spot(true).y / z);
    const key = 'arena:stage';
    if (this.textures.exists(key)) this.textures.remove(key);
    this.textures.addCanvas(key, c);
    this.add.image(0, 0, key).setOrigin(0, 0).setScale(z).setDepth(0);

    // The platform and the front row on their own layer, over the spectators in the stands.
    const c2 = document.createElement('canvas');
    c2.width = aw;
    c2.height = ah;
    g = c2.getContext('2d')!;
    // The platform under both players: a sand ellipse with a rim and a stone side, its top level with their feet.
    const cx = aw / 2;
    const rx = Math.round((W / 2 - this.spot(true).x) / z + 20); // just wide enough for both players
    const ry = Math.max(8, Math.round(rx * 0.2));
    const cy = feet + Math.round(ry * 0.25);
    const depth = 6;
    ellipse(cx, cy + depth + 1, rx + 1, ry + 1, STAGE.line);
    ellipse(cx, cy + depth, rx, ry, STAGE.sideDark);
    for (let d = depth - 1; d > 0; d--) ellipse(cx, cy + d, rx, ry, STAGE.side);
    ellipse(cx, cy, rx + 1, ry + 1, STAGE.line);
    ellipse(cx, cy, rx, ry, STAGE.rim);
    ellipse(cx, cy, rx - 2, ry - 1, STAGE.sand);
    ellipse(cx, cy - 1, Math.round(rx * 0.55), Math.round(ry * 0.45), STAGE.sandLight);
    ellipse(cx, cy - 1, Math.round(rx * 0.55) - 1, Math.round(ry * 0.45) - 1, STAGE.sand);
    const V = this.viewerArt();

    const front = 'arena:platform';
    if (this.textures.exists(front)) this.textures.remove(front);
    this.textures.addCanvas(front, c2);
    this.add.image(0, 0, front).setOrigin(0, 0).setScale(z).setDepth(2);
    if (V) this.addViewers(V, r, { x: cx * z, y: (cy + depth / 2) * z, rx: rx * z, ry: ry * z });
    this.addSpotlights(r, { x: cx * z, y: cy * z, rx: rx * z, ry: ry * z });
  }

  /** The spectators' sheets, with an animation each (null: no art, empty stands). */
  private viewerArt(): { files: string[]; anchor: [number, number] } | null {
    const V = this.d.M.ui.arenaViewers;
    const files = V?.files.filter((f) => this.textures.exists(f)) ?? [];
    if (!V || !files.length) return null;
    for (const f of files) {
      const key = `anim:${f}`;
      if (!this.anims.exists(key)) this.anims.create({ key, frames: this.anims.generateFrameNumbers(f, { start: 0, end: V.frames - 1 }), frameRate: V.fps, repeat: -1 });
    }
    return { files, anchor: [V.anchor[0], V.anchor[1]] };
  }

  /**
   * The cheering crowd in a ring round the platform (`stage`: its centre and radii, screen px): three rings, each
   * further out and darker, well back from the platform, on its perspective; the far half stands behind the platform at
   * half the dolls' zoom, the near half in front of it one step bigger, as dark silhouettes seen from behind (and low
   * enough to keep the names clear), nearer ones drawn over farther ones. Each starts on its own
   * frame at its own pace; with reduced motion they stand still.
   */
  private addViewers(V: { files: string[]; anchor: [number, number] }, r: () => number, stage: { x: number; y: number; rx: number; ry: number }): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const s = Math.max(2, Math.floor(this.zoom / 2));
    const still = reducedMotion();
    this.viewers = [];
    const tints = [0x74749a, 0x5c5c7e, 0x4a4a68];
    const ratio = Math.max(0.3, stage.ry / stage.rx);
    // The near half keeps clear of the players' names and round pips: its heads start below them.
    const clear = this.spot(true).y + 64 + 28 * (s + 1);
    tints.forEach((tint, ring) => {
      const rx = stage.rx + (34 + ring * 16) * s; // well back from the platform
      const ry = rx * ratio;
      const ryNear = Math.max(ry, clear - stage.y + ring * 12 * s);
      const n = Math.round((Math.PI * (rx + ry)) / ((17 + ring * 2) * s)); // about one per 17–21 art px of the ring
      const turn = r() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const a = turn + (i / n) * Math.PI * 2 + (r() - 0.5) * 0.08;
        const x = Math.round(stage.x + Math.cos(a) * rx);
        const near = Math.sin(a) > 0;
        const scale = near ? s + 1 : s;
        let feet = Math.round(stage.y + Math.sin(a) * (near ? ryNear : ry));
        // Never over a player's name and pips: anyone near in front of them steps down below.
        const labels = this.spot(true).y + 64;
        if (near && feet - 28 * scale < labels && [true, false].some((m) => Math.abs(x - this.spot(m).x) < 70 + 12 * scale)) feet = labels + 28 * scale;
        if (x < -16 * scale || x > W + 16 * scale || feet - 30 * scale > H) continue;
        const f = V.files[Math.floor(r() * V.files.length)];
        const v = this.add
          .sprite(x, feet, f, 0)
          .setOrigin(V.anchor[0] / 32, V.anchor[1] / 32)
          .setScale(scale)
          .setFlipX(r() < 0.5)
          .setDepth((near ? 4 : 1) + feet / 100000); // nearer (lower) over farther
        // The near half has its back to us: plain dark silhouettes (the art faces the camera, not the stage).
        if (near) v.setTint(SILHOUETTE).setTintMode(Phaser.TintModes.FILL);
        else v.setTint(tint);
        if (still) v.setFrame(Math.floor(r() * 9));
        else {
          v.play({ key: `anim:${f}`, startFrame: Math.floor(r() * 9) });
          v.anims.timeScale = 0.8 + r() * 0.4;
        }
        this.viewers.push(v);
      }
    });
  }

  /**
   * Spotlights: four beams from above the screen, drawn at the stage's pixel size (a narrow top widening downward, a
   * brighter core), each fading out into a pool of light on the platform (stretched to stop there as it turns),
   * added faintly over the platform and the far crowd (under the near silhouettes and the players), each sweeping
   * slowly back and forth across the platform at its own pace. Still with reduced motion.
   */
  private addSpotlights(r: () => number, stage: { x: number; y: number; rx: number; ry: number }): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const z = this.zoom;
    const bw = 28;
    const bh = Math.ceil(H / z);
    const canvas = (key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) => {
      if (this.textures.exists(key)) this.textures.remove(key); // sized to this screen
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      draw(c.getContext('2d')!);
      this.textures.addCanvas(key, c);
    };
    canvas('arena:beam', bw, bh, (g) => {
      for (let y = 0; y < bh; y++) {
        const half = 1 + (y / bh) * (bw / 2 - 1);
        const fade = Math.min(1, (bh - y) / (bh * 0.22)); // the end melts into the pool (no hard cut)
        g.fillStyle = `rgba(255,255,255,${(0.1 * fade).toFixed(3)})`;
        g.fillRect(Math.round(bw / 2 - half), y, Math.round(half * 2), 1);
        g.fillStyle = `rgba(255,255,255,${(0.08 * fade).toFixed(3)})`;
        g.fillRect(Math.round(bw / 2 - half / 2), y, Math.round(half), 1);
      }
    });
    // The pool where a beam lands: an ellipse on the platform's perspective, as wide as the beam's end.
    const prx = bw / 2;
    const pry = Math.max(3, Math.round(prx * Math.min(0.4, stage.ry / stage.rx)));
    canvas('arena:pool', prx * 2 + 1, pry * 2 + 1, (g) => {
      const ellipse = (rx: number, ry: number, alpha: number) => {
        g.fillStyle = `rgba(255,255,255,${alpha})`;
        for (let y = -ry; y <= ry; y++) {
          const half = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))));
          g.fillRect(prx - half, pry + y, half * 2 + 1, 1);
        }
      };
      ellipse(prx, pry, 0.12);
      ellipse(Math.round(prx * 0.6), Math.max(1, Math.round(pry * 0.6)), 0.1);
    });
    const aim = (ox: number, oy: number, x: number) => -Math.atan2(x - ox, stage.y - oy);
    const still = reducedMotion();
    BEAMS.forEach((colour, i) => {
      const ox = Math.round(W * (0.12 + (i / (BEAMS.length - 1)) * 0.76));
      const oy = -4 * z;
      const beam = this.add.image(ox, oy, 'arena:beam').setOrigin(0.5, 0).setTint(colour).setBlendMode(Phaser.BlendModes.ADD).setDepth(2.5);
      const pool = this.add.image(0, stage.y, 'arena:pool').setScale(z).setTint(colour).setBlendMode(Phaser.BlendModes.ADD).setDepth(2.5);
      /** Down to the platform and no further, wherever it points. */
      const land = () => {
        const length = (stage.y - oy) / Math.cos(beam.rotation);
        beam.setScale(z, length / bh);
        pool.x = Math.round(ox - Math.sin(beam.rotation) * length);
      };
      const from = aim(ox, oy, stage.x - stage.rx * 0.75);
      const to = aim(ox, oy, stage.x + stage.rx * 0.75);
      beam.rotation = i % 2 ? to : from; // neighbours sweep the other way
      land();
      if (still) return;
      this.tweens.add({ targets: beam, rotation: i % 2 ? from : to, duration: 2600 + r() * 2200, ease: 'Sine.easeInOut', yoyo: true, repeat: -1, delay: r() * 600, onUpdate: land });
    });
  }

  /** The crowd goes wild for a moment (a clash, the match's end). */
  private hype(ms: number): void {
    if (reducedMotion()) return;
    for (const v of this.viewers) v.anims.timeScale *= 1.8;
    this.time.delayedCall(ms, () => this.viewers.forEach((v) => (v.anims.timeScale /= 1.8)));
  }

  // ── Where things go ──

  /** A doll's feet, on the platform: you on the left, them on the right. */
  private spot(mine: boolean): { x: number; y: number } {
    const W = this.scale.width;
    const H = this.scale.height;
    const y = this.portrait ? H - 280 : Math.round(H * 0.58); // just above the buttons
    // Close together: just far enough apart for the two hands to meet in the middle (see reveal).
    const apart = this.forward() + 30 * this.handZoom;
    return { x: Math.round(W / 2 + (mine ? -apart : apart)), y };
  }

  /** How far in front of a player's centre their hand starts (on a narrow phone, a little behind it). */
  private forward(): number {
    return (this.portrait ? -2 : 3) * this.zoom;
  }

  /** The dolls' zoom in the VS intro: a close-up, well over their arena size. */
  private introZoom(): number {
    return this.zoom + (this.portrait ? 3 : 4);
  }

  /** Where a doll stands, big, during the VS intro: its head in the middle of the band, its body running down past
   *  it (and further in on a narrow phone, so it stays on screen). */
  private introSpot(mine: boolean): { x: number; y: number } {
    const W = this.scale.width;
    // Spread out to either side of the VS (they close in to their places on the platform as the band folds).
    const x = Math.round(W * (mine ? (this.portrait ? 0.27 : 0.25) : this.portrait ? 0.73 : 0.75));
    return { x, y: this.middle() + 30 * this.introZoom() };
  }

  /** The VS band's middle, at the dolls' chest height. */
  private middle(): number {
    return this.spot(true).y - 22 * this.zoom;
  }

  /** The hands' height: in front of each player's body (the dolls are big-headed: their body is the lower third). */
  private chest(): number {
    return this.spot(true).y - 12 * this.zoom;
  }

  /** The round's words and lines: between the dolls (desktop), or over their heads on a narrow phone. */
  private textY(above: boolean): number {
    if (this.portrait) return this.spot(true).y - 48 * this.zoom - 30;
    return above ? this.chest() - 160 : this.spot(true).y + 104; // clear of the hands; below, under the names and pips (the bar is hidden then)
  }

  private async makeSide(mine: boolean, name: string, look: Outfit, bot: boolean): Promise<Side> {
    // No look (a player who never made one): a random one, like the town shows them.
    const outfit = look?.skin && look.top ? look : randomOutfit(this.d.M.characters, rng(hash(name.length, name.charCodeAt(0) || 0, 5)));
    await loadOutfit(this, this.d.M.characters, outfit);
    const dir = mine ? 'se' : 'sw';
    const z = this.zoom;
    const s = this.spot(mine);
    const doll = this.add.sprite(s.x, s.y, sheetKey(outfit, 'idle', dir), 0).setOrigin(0.5, 1).setScale(z).setDepth(5);
    doll.play(sheetKey(outfit, 'idle', dir));
    const plate = this.text(name, 18).setOrigin(0.5, 0).setDepth(6);
    const modes = this.d.M.ui.arenaModes;
    const botIcon = bot && modes && this.textures.exists(modes.file) ? this.add.sprite(0, 0, modes.file, 0).setOrigin(1, 0).setDepth(6) : null;
    const pip = this.d.M.ui.jnpPips;
    const pips = [0, 1].map(() => this.add.sprite(0, 0, pip?.file ?? '__MISSING', 0).setScale(z >= 6 ? 3 : 2).setDepth(6));
    const H = this.d.M.ui.jnpHands;
    const handKey = (H && recolourSheet(this, this.d.M.characters, outfit, H.file, H.size)) || H?.file || '__MISSING';
    const hand = this.add.sprite(0, 0, handKey, 0).setScale(this.handZoom).setFlipX(!mine).setOrigin(mine ? 0 : 1, 0.5).setDepth(8).setVisible(false);
    const side: Side = { name, outfit, doll, dir, plate, botIcon, pips, hand, handKey, cloud: null, hop: 0 };
    this.placeLabels(side, mine);
    return side;
  }

  private placeLabels(side: Side, mine: boolean): void {
    const s = this.spot(mine);
    side.plate.setPosition(Math.round(s.x + (side.botIcon ? 14 : 0)), s.y + 6);
    side.botIcon?.setPosition(Math.round(side.plate.x - side.plate.width / 2 - 4), s.y + 4);
    const pw = side.pips[0].displayWidth;
    side.pips.forEach((p, i) => p.setPosition(Math.round(s.x + (i - 0.5) * (pw + 6)), s.y + 6 + side.plate.height + pw / 2 + 4));
  }

  // ── The match ──

  private async handle(m: ArenaServerMessage): Promise<void> {
    if (!this.sys.isActive()) return;
    switch (m.t) {
      case 'arena-start':
        this.setStake(m.stake);
        return this.start(m.opponent, m.rematch);
      case 'arena-round':
        return this.openRound(m.ms);
      case 'arena-reveal':
        return this.reveal(m);
      case 'arena-left':
        return this.otherLeft(m.youWin);
      case 'arena-rematch-wait':
        this.note.textContent = `Waiting for ${this.them.name}…`;
        return;
      case 'arena-rematch-ask':
        return this.askedForRematch(m.bet);
      case 'arena-rematch-declined':
        this.note.textContent = `${this.them.name} said no.`;
        this.rematchButton.hidden = false;
        this.betRow.el.hidden = !this.canBet;
        return;
    }
  }

  private async start(opponent: ArenaOpponent, rematch: boolean): Promise<void> {
    this.opponent = opponent;
    this.over = false;
    this.end.hidden = true;
    this.note.textContent = '';
    if (rematch && this.started) {
      // Same two, again: everyone up, scores cleared, the music back.
      arenaMusicOn(true);
      for (const side of [this.me, this.them]) this.resetSide(side);
      this.setPips();
      this.shout('Rematch!', 'plain', this.textY(true));
      await wait(this, 700);
      this.hush();
      return;
    }
    this.started = true;
    this.me = await this.makeSide(true, this.d.me.nickname, this.d.me.outfit, false);
    this.them = await this.makeSide(false, opponent.nickname, opponent.outfit as Outfit, !!opponent.bot);
    this.setPips();
    await this.intro();
  }

  /** The VS intro: both slide in, VS slams down with a burst and a little shake, glints, holds, and slides away. */
  private async intro(): Promise<void> {
    const W = this.scale.width;
    const H = this.scale.height;
    const reduced = reducedMotion();
    // Match found: both slide in big, a close-up (10× on desktop, 7× on a phone), heads in the VS band; names and pips
    // wait.
    const big = this.introZoom();
    const labels = (side: Side) => [side.plate, ...(side.botIcon ? [side.botIcon] : []), ...side.pips];
    const slideIn = (side: Side, mine: boolean, delay: number) => {
      const at = this.introSpot(mine);
      side.doll.setScale(big).setPosition(mine ? -16 * big : W + 16 * big, at.y);
      for (const l of labels(side)) l.setAlpha(0);
      this.tweens.add({ targets: side.doll, x: at.x, duration: reduced ? 0 : 300, delay, ease: 'Cubic.easeOut' });
    };
    playSound('arena-whoosh', 0.12);
    arenaMusicOn(true);
    slideIn(this.me, true, 0);
    slideIn(this.them, false, 100);

    await wait(this, 450);
    const V = this.d.M.ui.vs;
    const vz = this.zoom; // the VS as big as the dolls' arena zoom (6×, 4× on small screens)
    if (V && this.textures.exists(V.file)) {
      const cx = Math.round(W / 2);
      const cy = this.middle();
      const clash = this.burst(cx, cy, this.portrait ? vz + 1 : vz * 2, 9); // on a phone, not over both players
      this.vs = this.add.sprite(cx, cy, V.file, 0).setDepth(10);
      playSound('arena-slam', 0.15);
      if (reduced) {
        this.vs.setScale(vz).setAlpha(0);
        this.tweens.add({ targets: this.vs, alpha: 1, duration: 200 });
      } else {
        this.vs.setScale(vz * 2).setAlpha(0);
        this.tweens.add({ targets: this.vs, scale: vz, alpha: 1, duration: 150, ease: 'Back.easeOut' });
        this.cameras.main.shake(100, 0.004);
      }
      void clash;
      await wait(this, 200);
      const glint = `anim:${V.file}:glint`;
      if (!this.anims.exists(glint)) this.anims.create({ key: glint, frames: this.anims.generateFrameNumbers(V.file, { frames: [1, 2, 3, 0] }), frameRate: V.fps ?? 12 });
      this.vs.play(glint);
      await wait(this, 1000);
      const vs = this.vs;
      this.tweens.add({ targets: vs, y: -vs.displayHeight, alpha: reduced ? 0 : 1, duration: reduced ? 200 : 260, ease: 'Cubic.easeIn', onComplete: () => vs.destroy() });
      this.vs = null;
      await wait(this, 260);
    }
    // The band folds away and both shrink down onto the platform (their arena size, a whole-number zoom again); then
    // their names and pips.
    this.tweens.add({ targets: this.band, scaleY: 0, duration: reduced ? 0 : 220, ease: 'Cubic.easeIn', onComplete: () => this.band.setVisible(false) });
    for (const [side, mine] of [[this.me, true], [this.them, false]] as const) {
      const s = this.spot(mine);
      this.tweens.add({ targets: side.doll, x: s.x, y: s.y, scale: this.zoom, duration: reduced ? 0 : 320, ease: 'Cubic.easeInOut', onComplete: () => side.doll.setScale(this.zoom).setPosition(s.x, s.y) });
    }
    await wait(this, reduced ? 0 : 330);
    for (const side of [this.me, this.them]) this.tweens.add({ targets: labels(side), alpha: 1, duration: reduced ? 0 : 150 });
  }

  /** A comic burst (fx jnp-clash) played once at (x, y). */
  private burst(x: number, y: number, scale: number, depth: number): Phaser.GameObjects.Sprite | null {
    const F = this.d.M.fx['jnp-clash'];
    if (!F?.file || !this.textures.exists(F.file)) return null;
    const key = `anim:${F.file}`;
    if (!this.anims.exists(key)) this.anims.create({ key, frames: this.anims.generateFrameNumbers(F.file, { start: 0, end: (F.frames ?? 6) - 1 }), frameRate: F.fps ?? 15 });
    const s = this.add.sprite(x, y, F.file, 0).setScale(scale).setDepth(depth);
    s.play(key).once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => s.destroy());
    return s;
  }

  private setPips(score: [number, number] = [0, 0]): void {
    this.me.pips.forEach((p, i) => p.setFrame(i < score[0] ? 1 : 0));
    this.them.pips.forEach((p, i) => p.setFrame(i < score[1] ? 2 : 0));
  }

  // ── Rounds ──

  private openRound(ms: number): void {
    this.hush();
    this.note.textContent = '';
    this.roundOpen = true;
    this.picked = false;
    this.bar.hidden = false;
    for (const b of this.picks) {
      b.disabled = false;
      b.classList.remove('ar-chosen');
    }
    // The timer bar empties over the round; at the end a random hand is picked for you.
    this.timer.style.transition = 'none';
    this.timer.style.transform = 'scaleX(1)';
    void this.timer.offsetWidth;
    this.timer.style.transition = `transform ${ms}ms linear`;
    this.timer.style.transform = 'scaleX(0)';
    this.roundTimer?.remove();
    // The last 3 seconds tick (tick_001, low), once a second, until you pick.
    this.ticks.forEach((t) => t.remove());
    this.ticks = [3, 2, 1].map((left) => this.time.delayedCall(ms - left * 1000, () => this.roundOpen && !this.picked && playSound('flip-spin', 0.08, cents(0.9))));
    this.roundTimer = this.time.delayedCall(ms, () => {
      if (!this.roundOpen || this.picked) return;
      this.pick(HANDS[Math.floor(Math.random() * 3)]);
      this.note.textContent = "Time's up: a random hand.";
    });
  }

  private pick(hand: ArenaHand): void {
    if (!this.roundOpen || this.picked) return;
    this.picked = true;
    this.roundTimer?.remove();
    this.picks.forEach((b, i) => {
      b.disabled = true;
      b.classList.toggle('ar-chosen', HANDS[i] === hand);
    });
    this.timer.style.transition = 'none';
    if (!this.opponent?.bot) this.note.textContent = `Waiting for ${this.them.name}…`;
    this.d.channel.send({ t: 'arena-pick', hand });
  }

  /** Both hands slide in from the edges, bob through "Jack… en… poy!", show their real shapes with a clash, and the
   *  round's line; at 2 wins, the end. */
  private async reveal(m: Extract<ArenaServerMessage, { t: 'arena-reveal' }>): Promise<void> {
    this.roundOpen = false;
    this.roundTimer?.remove();
    this.bar.hidden = true;
    this.note.textContent = '';
    const W = this.scale.width;
    const H = this.scale.height;
    const y = this.chest();
    const reduced = reducedMotion();
    const hands = [this.me.hand, this.them.hand];
    const hz = this.handZoom;
    // Each hand comes out in front of its owner's body, pointing at the other: the sleeve starts at their front edge
    // (on a narrow phone, a little further in, so the two hands just meet in the middle).
    const forward = this.forward();
    const mineAt = this.me.doll.x + forward;
    const theirsAt = this.them.doll.x - forward;
    this.me.hand.setFrame(0).setPosition(mineAt - 10 * hz, y).setAlpha(0).setVisible(true);
    this.them.hand.setFrame(0).setPosition(theirsAt + 10 * hz, y).setAlpha(0).setVisible(true);
    this.tweens.add({ targets: this.me.hand, x: mineAt, alpha: 1, duration: reduced ? 0 : 220, ease: 'Cubic.easeOut' });
    this.tweens.add({ targets: this.them.hand, x: theirsAt, alpha: 1, duration: reduced ? 0 : 220, ease: 'Cubic.easeOut' });
    await wait(this, reduced ? 50 : 240);
    this.words.setPosition(Math.round(W / 2), this.textY(true));
    if (reduced) {
      // No bobbing, but the same three ticks.
      this.words.setText('Jack en poy!');
      for (const pitch of BOB_PITCH) {
        playSound('flip-spin', 0.12, cents(pitch));
        await wait(this, 250);
      }
    } else {
      for (const [i, word] of ['Jack', 'en', 'poy!'].entries()) {
        playSound('flip-spin', 0.12, cents(BOB_PITCH[i])); // tick_001, climbing
        this.words.setText(word).setScale(0.6);
        this.tweens.add({ targets: this.words, scale: 1, duration: 120, ease: 'Back.easeOut' });
        this.tweens.add({ targets: hands, y: y - 6, duration: 125, yoyo: true, ease: 'Sine.easeOut', onUpdate: () => hands.forEach((h) => (h.y = Math.round(h.y))) });
        await wait(this, 250);
      }
    }
    this.words.setText('');
    this.me.hand.setFrame(FRAME[m.you]);
    this.them.hand.setFrame(FRAME[m.them]);
    // The clash between the two fingertips.
    this.burst(Math.round((mineAt + 32 * hz + theirsAt - 32 * hz) / 2), y, hz, 9);
    playSound('arena-reveal', 0.15);
    if (m.result !== 'draw') this.hype(900);
    this.setPips(m.score);
    const name = this.them.name;
    this.shout(m.result === 'win' ? 'You win the round' : m.result === 'lose' ? `${name} wins the round` : 'Draw, again!', m.result, this.textY(false));
    const late = [m.random[0] ? 'Too slow: a random hand for you.' : '', m.random[1] ? `${name} was too slow: a random hand.` : ''].filter(Boolean).join(' ');
    this.note.textContent = late;
    await wait(this, 1100);
    this.tweens.add({ targets: this.me.hand, x: mineAt - 10 * hz, alpha: 0, duration: reduced ? 0 : 200, ease: 'Cubic.easeIn' });
    this.tweens.add({ targets: this.them.hand, x: theirsAt + 10 * hz, alpha: 0, duration: reduced ? 0 : 200, ease: 'Cubic.easeIn' });
    await wait(this, 240);
    hands.forEach((h) => h.setVisible(false));
    if (m.over) return this.finish(m.over === 'you');
    this.hush();
  }

  // ── The end ──

  private async finish(won: boolean): Promise<void> {
    this.over = true;
    const W = this.scale.width;
    const winner = won ? this.me : this.them;
    const loser = won ? this.them : this.me;
    this.cheer(winner);
    this.sulk(loser);
    this.shout(won ? 'You win!' : `${this.them.name} wins!`, won ? 'win' : 'lose', this.textY(true), true);
    playSound(won ? 'casino-win' : 'casino-lose', won ? 0.2 : 0.12); // confirmation_003 / error_003
    this.hype(2000);
    arenaMusicOn(false);
    if (this.stake) this.note.textContent = won ? `You won ${kowens(this.stake)}!` : `You lost ${kowens(this.stake)}.`;
    this.setStake(0);
    await wait(this, 600);
    this.showEnd();
  }

  /** The winner: cheer, two little hops (whole pixels) and confetti from above. */
  private cheer(side: Side): void {
    const reduced = reducedMotion();
    const cheer = sheetKey(side.outfit, 'cheer', side.dir);
    side.doll.play(cheer).once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => side.doll.play(sheetKey(side.outfit, 'idle', side.dir)));
    if (!reduced) {
      const baseY = side.doll.y;
      this.tweens.add({ targets: side, hop: 8, duration: 140, yoyo: true, repeat: 1, ease: 'Sine.easeOut', onUpdate: () => (side.doll.y = baseY - Math.round(side.hop)) });
    }
    const C = this.d.M.fx.confetti;
    if (!C?.file || !this.textures.exists(C.file)) return;
    const keys = [0, 1, 2, 3].map((pair) => {
      const key = `anim:${C.file}:${pair}`;
      if (!this.anims.exists(key)) this.anims.create({ key, frames: this.anims.generateFrameNumbers(C.file!, { frames: [pair * 2, pair * 2 + 1] }), frameRate: C.fps ?? 8, repeat: -1 });
      return key;
    });
    const top = side.doll.y - 48 * this.zoom;
    this.confetti?.destroy();
    this.confetti = this.add.particles(side.doll.x, top - 30, C.file, {
      anim: keys,
      lifespan: 1500,
      speedX: { min: -40, max: 40 },
      speedY: { min: -120, max: -20 },
      gravityY: 260,
      scale: this.zoom >= 6 ? 3 : 2,
      x: { min: -50, max: 50 }, // spread over the winner
      y: { min: -10, max: 10 },
      emitting: false,
    }).setDepth(12);
    this.confetti.explode(reduced ? 15 : 40);
  }

  /** The loser: a little head shake, then they plop down (sit), greyed a touch, under a rain cloud. */
  private sulk(side: Side): void {
    const x = side.doll.x;
    const step = this.zoom; // 1 art px
    const shake = reducedMotion() ? [] : [step, -step, step, -step, step, -step, 0];
    shake.forEach((dx, i) => this.time.delayedCall(i * 70, () => (side.doll.x = x + dx)));
    this.time.delayedCall(shake.length * 70, () => {
      side.doll.x = x;
      side.doll.play(sheetKey(side.outfit, 'sit', side.dir)).setTint(0xa8a8c8);
      const F = this.d.M.fx['lose-cloud'];
      if (!F?.file || !this.textures.exists(F.file)) return;
      const key = `anim:${F.file}`;
      if (!this.anims.exists(key)) this.anims.create({ key, frames: this.anims.generateFrameNumbers(F.file, { start: 0, end: (F.frames ?? 4) - 1 }), frameRate: F.fps ?? 6, repeat: -1 });
      const [fw, fh] = F.frame ?? [32, 32];
      const [ax, ay] = F.anchor ?? [fw / 2, fh - 1];
      // The rain just reaching their head as they sit (the sitting frame's top row); a size smaller than the doll (the
      // cloud is 32 px), so it stays clear of the match's line.
      const head = side.doll.y - (48 - this.topRow(sheetKey(side.outfit, 'sit', side.dir))) * this.zoom;
      side.cloud = this.add
        .sprite(x, head, F.file, 0)
        .setOrigin(ax / fw, ay / fh)
        .setScale(Math.max(2, this.zoom - 2))
        .setDepth(7);
      side.cloud.play(key);
    });
  }

  /** The first row with anything drawn in a composited sheet's first frame (its head's top), in art px; the standing
   *  head if it can't be read. */
  private topRow(key: string): number {
    const src = this.textures.exists(key) ? (this.textures.get(key).getSourceImage() as HTMLCanvasElement) : null;
    const ctx = src instanceof HTMLCanvasElement ? src.getContext('2d') : null;
    if (!ctx) return headTop(this, this.me.outfit);
    const d = ctx.getImageData(0, 0, 32, 48).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return Math.floor((i - 3) / 4 / 32);
    return 0;
  }

  private resetSide(side: Side): void {
    side.cloud?.destroy();
    side.cloud = null;
    this.confetti?.destroy();
    this.confetti = null;
    side.doll.clearTint().play(sheetKey(side.outfit, 'idle', side.dir));
    side.doll.y = this.spot(side === this.me).y;
  }

  /** Bets can be placed (a match on the server). */
  private get canBet(): boolean {
    return this.d.channel.mode === 'player';
  }

  /** What's on the line, top centre (none: hidden). */
  private setStake(stake: number): void {
    this.stake = stake;
    this.stakeTag.textContent = stake ? `Playing for ${kowens(stake)}` : '';
    this.stakeTag.hidden = !stake;
  }

  private showEnd(): void {
    this.asked = false;
    this.askLine.hidden = true;
    this.declineButton.hidden = true;
    this.rematchButton.textContent = 'Rematch';
    this.end.hidden = false;
    this.rematchButton.hidden = this.gone;
    this.betRow.el.hidden = this.gone || !this.canBet;
    if (this.gone) this.note.textContent = `${this.them.name} left.`;
    (this.gone ? this.end.querySelector<HTMLButtonElement>('.ar-leave') : this.rematchButton)?.focus();
  }

  /** The other player wants a rematch (with their bet): Accept (with yours) or Decline. */
  private askedForRematch(bet: number): void {
    if (this.gone) return;
    this.asked = true;
    this.askLine.textContent = bet && this.canBet ? `${this.them.name} wants a rematch, betting ${kowens(bet)}.` : `${this.them.name} wants a rematch.`;
    this.askLine.hidden = false;
    this.note.textContent = '';
    this.rematchButton.textContent = 'Accept';
    this.rematchButton.hidden = false;
    this.declineButton.hidden = false;
    this.betRow.el.hidden = !this.canBet;
    this.rematchButton.focus();
  }

  private async otherLeft(youWin: boolean): Promise<void> {
    this.gone = true;
    this.roundOpen = false;
    this.roundTimer?.remove();
    this.bar.hidden = true;
    const won = youWin && !this.over && this.stake ? ` You won ${kowens(this.stake)}!` : '';
    if (youWin && !this.over) {
      this.hush();
      await this.finish(true);
    }
    this.setStake(0);
    this.note.textContent = `${this.them?.name ?? 'They'} left.${won}`;
    this.rematchButton.hidden = true;
    this.declineButton.hidden = true;
    this.askLine.hidden = true;
    this.betRow.el.hidden = true;
    this.end.hidden = false;
  }

  // ── The buttons (DOM, under the town's HUD) ──

  private buildUi(): void {
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined) n.textContent = text;
      return n;
    };
    this.ui = el('div');
    this.ui.id = 'arena-ui';
    this.bar = el('div', 'ar-bar');
    this.bar.hidden = true;
    const track = el('div', 'ar-timer');
    this.timer = el('div', 'ar-timer-fill');
    track.append(this.timer);
    const row = el('div', 'ar-picks');
    const H = this.d.M.ui.jnpHands;
    const handUrl = H ? this.handUrl() : null;
    HANDS.forEach((hand, i) => {
      const b = el('button', 'ar-pick');
      const icon = el('span', 'ar-hand');
      if (handUrl && H) {
        icon.style.backgroundImage = `url("${handUrl}")`;
        icon.style.backgroundSize = `${H.size[0] * 3 * 2}px ${H.size[1] * 2}px`;
        icon.style.backgroundPosition = `-${i * H.size[0] * 2}px 0`;
      }
      b.append(icon, el('span', 'ar-pick-label', LABEL[hand]), el('kbd', 'ar-key', String(i + 1)));
      b.addEventListener('click', () => this.pick(hand));
      this.picks.push(b);
      row.append(b);
    });
    this.bar.append(track, row);
    this.note = el('div', 'ar-note');
    this.note.setAttribute('role', 'status');
    this.end = el('div', 'ar-end');
    this.end.hidden = true;
    this.askLine = el('div', 'ar-ask');
    this.askLine.hidden = true;
    this.betRow = betField(Math.max(1, this.d.bet));
    this.rematchButton = el('button', 'ar-button ar-rematch', 'Rematch');
    this.rematchButton.addEventListener('click', () => {
      if (this.gone) return;
      this.rematchButton.hidden = true;
      this.declineButton.hidden = true;
      this.betRow.el.hidden = true;
      if (!this.opponent?.bot && !this.asked) this.note.textContent = `Waiting for ${this.them.name}…`;
      this.d.channel.send({ t: 'arena-rematch', ...(this.canBet ? { bet: this.betRow.value() } : {}) });
    });
    this.declineButton = el('button', 'ar-button ar-leave', 'Decline');
    this.declineButton.hidden = true;
    this.declineButton.addEventListener('click', () => {
      this.asked = false;
      this.askLine.hidden = true;
      this.declineButton.hidden = true;
      this.rematchButton.textContent = 'Rematch';
      this.d.channel.send({ t: 'arena-decline' });
    });
    const leaveEnd = el('button', 'ar-button ar-leave', 'Leave');
    leaveEnd.addEventListener('click', () => this.d.leave());
    const buttons = el('div', 'ar-end-buttons');
    buttons.append(this.rematchButton, this.declineButton, leaveEnd);
    this.end.append(this.askLine, this.betRow.el, buttons);
    this.stakeTag = el('div', 'ar-stake');
    this.stakeTag.hidden = true;
    const leave = el('button', 'ar-quit', 'Leave');
    leave.addEventListener('click', () => this.d.leave());
    this.ui.append(this.note, this.bar, this.end, this.stakeTag, leave);
    document.body.append(this.ui);
    document.addEventListener('keydown', this.keys, true);
  }

  /** Your hand sheet in your colours, as an image for the buttons. */
  private handUrl(): string | null {
    const H = this.d.M.ui.jnpHands;
    if (!H) return null;
    const key = recolourSheet(this, this.d.M.characters, this.d.me.outfit, H.file, H.size);
    const src = key && this.textures.exists(key) ? (this.textures.get(key).getSourceImage() as HTMLCanvasElement | HTMLImageElement) : null;
    if (!src) return null;
    if (src instanceof HTMLCanvasElement) return src.toDataURL();
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    c.getContext('2d')!.drawImage(src, 0, 0);
    return c.toDataURL();
  }

  /** 1–3 pick a hand; Escape leaves (unless it's for the chat or Settings). */
  private keys = (e: KeyboardEvent) => {
    const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
    if (e.key === 'Escape' && !typing && !document.getElementById('settings')) {
      e.preventDefault();
      e.stopPropagation();
      this.d.leave();
      return;
    }
    const i = ['1', '2', '3'].indexOf(e.key);
    if (i >= 0 && !typing && this.roundOpen) {
      e.preventDefault();
      e.stopPropagation();
      this.pick(HANDS[i]);
    }
  };

  private cleanUp(): void {
    document.removeEventListener('keydown', this.keys, true);
    this.stopListening?.();
    this.d.channel.send({ t: 'arena-leave' });
    this.ui?.remove();
  }
}
