import Phaser from 'phaser';
import type { PlayerHit, SilongBlock, SilongFloor, TelegraphShape, TownServerMessage, TownSilongRun } from '@mikazuki/shared';
import { inRect } from '@mikazuki/shared';
import type { Manifest, MapObject, PropDef, TownMap } from '../assets/types';
import { tileToScreen } from '../iso';
import { BossBar } from '../ui/boss-bar';
import { frontDepth } from './depth';
import type { FxHandle, FxLayers, Pt } from './fx-layers';
import type { WalkGrid } from './grid';
import type { Mob, Mobs } from './mobs';
import { Telegraphs } from './telegraph';
import { type WarrensSfx, playWarrens } from '../audio/sound';
import { BuildingLabel } from '../ui/labels';
import type { PidoMoment } from '../ui/silong';
import { onMap } from './clicks';
import { LABEL_DEPTH } from './depth';

// 🧊 An Ang Silong floor in the game (maps/silong-<floor>.json; the server runs the run: bot web/town-silong.ts). This
// draws what changes and keeps the walking grid in step:
// - The freight elevators (CONTEXT.md Freight elevator): each block's floor plate, the arrival's cage open (E), the cage
//   down shut (X) until the floor's mini bosses are down, then open (and its tiles walkable). Riding down, the cage
//   slides up out of view over 1 s and leaves its plate (`rideDown`), then the next floor loads.
// - B3's Ice Tanks door: shut until Frosty Tubbs falls, then fx-silong-frost-crack over it and the open door in its
//   place (its tiles walkable).
// - A warm glow under every work lamp (fx-silong-lamp-glow: the 2 tiles that clear Chill).
// - The mini bosses' moves (`boss-move` / `boss-hit`, bot web/town-silong-bosses.ts): each one's red telegraph, its
//   attack pose timed so its hit frame lands on the hit, and its effects drawn in code until the art folder's FX come:
//   Atsarah's brine burst and her lid out and back along its line; Sakristan's grains falling into each circle (the rice
//   itself is the town's `mob-fx`) and his flop's dust; Mono Lisa's chairs flying to where you stood, her Split (she and
//   her fakes small, a glint on her alone); Sangkalancelot's charge dust and the hooks dropping into their shadows;
//   Frosty Tubbs' Ice Slick (its tiles iced over for its time; the scene slides you on them: `slick`); dust where a
//   boss's mobs come in. The boss bar while you're in a mini boss's room.
// - Ang Makinang Yelo (B3's last boss: one facing, never moving; its fan the map's bossTile): Ice Block Drop (the warn on
//   each tile, the block's shadow and fall timed to its hit, then prop-silong-ice-block standing as a wall on the walk
//   grid for its time and breaking), Freezer Breath (breath-charge with the warn at its fan, then breath), Belt Rush
//   (rush), Brine Flood (flood, then fx-silong-brine on every flooded tile for its time), Call the Frost (call), its enrage
//   (its -enraged sheets loaded then, the red eye lamps), and as it falls steam off the frost round you (`melt`, every
//   floor). The boss bar, with its title, while you're in the Ice Plant.
// Sounds: the Warrens' (audio/sound.ts WARRENS_SFX) on the same events until the Silong has its own, a boss's only while
// it's on your screen: the elevator's cage and the door as the Warrens' shutter; each move's nearest Warrens sound (a lid
// for Lid Spin, a fist for a fall or a slam, the fog for brine and breath, the burnout for a charge or Belt Rush, the
// vanish for an Ambush or a Split, a door bursting for a call); Ang Makinang Yelo's hurt, enrage and death as
// Barong-Barong's.
// The props it draws are left out of the map's own (net/hood.ts silongTownMap: `silongDrawn`).

const RIDE_MS = 1000;
/** The last boss's kind, and its hurt sound at most this often. */
const MACHINE = 'makinang-yelo';
const HURT_MS = 300;
/** Each boss move's sound as it's cast (`warn`, after `in` ms) and as it lands (`hit`). */
const MOVE_SOUNDS: Record<string, { warn?: WarrensSfx; hit?: WarrensSfx }> = {
  brineSplash: { hit: 'bag-yani-fog' },
  lidSpin: { hit: 'celes-tin-lid-slam' },
  riceRain: { hit: 'barong-roof-land' },
  bellyFlop: { warn: 'barong-fist-fall', hit: 'barong-fist-slam' },
  chairBarrage: { hit: 'barong-roof-land' },
  split: { warn: 'bag-yani-vanish' },
  cleaverCharge: { warn: 'tire-ranny-burnout', hit: 'crab-tain-pincer' },
  hookShadows: { hit: 'barong-fist-slam' },
  ambush: { warn: 'bag-yani-vanish', hit: 'barong-fist-slam' },
  iceSlick: { hit: 'crab-tain-hunker' },
  jarCall: { warn: 'barong-door-burst' },
  sackCall: { warn: 'barong-door-burst' },
  tubCall: { warn: 'barong-door-burst' },
  hookSwing: { warn: 'barong-door-burst' },
  callTheFrost: { warn: 'barong-door-burst' },
  iceBlockDrop: { hit: 'barong-fist-slam' },
  freezerBreath: { hit: 'bag-yani-fog' },
  beltRush: { warn: 'tire-ranny-burnout', hit: 'barong-gutter-sweep' },
  brineFlood: { hit: 'bag-yani-fog' },
  enrage: { warn: 'barong-enrage' },
};
type Move = Extract<TownServerMessage, { t: 'boss-move' }>;
type Hit = Extract<TownServerMessage, { t: 'boss-hit' }>;

/** What a floor's view needs of the scene. */
export interface SilongHooks {
  /** Your tile. */
  me(): { col: number; row: number };
  /** A boss move's hit on a player (the number over them; a slow's ms and how strong). */
  onHit(boss: Mob | null, target: string, hit: PlayerHit, slow?: number, slowFactor?: number): void;
  /** Ice Slick: these tiles are ice for `ms` (the scene slides you on them). */
  slick(tiles: [number, number][], ms: number): void;
  /** Belt Rush: both belts at `speed` tiles a second for `ms` (the scene's carry and the belts' animation). */
  rush(ms: number, speed: number): void;
  /** Mang Pido on his radio, once a run (ui/silong.ts pidoSays). */
  radio(moment: PidoMoment): void;
  /** Mang Ramon's box was clicked: the scene walks you there and asks for his note. */
  ramon(): void;
}

interface Piece {
  o: MapObject;
  img: Phaser.GameObjects.Image;
  plate: Phaser.GameObjects.Image | null;
}

export class SilongView {
  private readonly cages: Piece[] = [];
  private readonly doors: Piece[] = [];
  private readonly glows: (FxHandle | null)[] = [];
  private open = false;
  private doorOpen = false;
  private readonly telegraphs: Telegraphs;
  private readonly bar = new BossBar();
  /** Per boss: its timers and effects under way, gone with it. */
  private readonly timers = new Map<string, Phaser.Time.TimerEvent[]>();
  private readonly handles = new Map<string, FxHandle[]>();
  /** Each move's data until it lands (its slow, Lid Spin's way back). */
  private readonly moves = new Map<string, Move>();
  /** Ang Makinang Yelo's ice blocks standing (by tile: its picture, until when). */
  private readonly blocks = new Map<string, { img: Phaser.GameObjects.Image; col: number; row: number; timer: Phaser.Time.TimerEvent }>();
  /** The frost melted (the last boss down): no more steam asked. */
  private melted = false;
  private ramonZone: Phaser.GameObjects.Zone | null = null;
  /** Mang Ramon's box's hover label (the scene sizes it with its zoom, as the gates' signs). */
  ramonLabel: BuildingLabel | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly M: Manifest,
    private readonly map: TownMap,
    private readonly fx: FxLayers,
    private readonly grid: WalkGrid,
    private readonly mobs: Mobs,
    private readonly hooks: SilongHooks,
  ) {
    this.telegraphs = new Telegraphs(scene, fx);
    for (const o of map.silongDrawn ?? []) {
      if (o.id === 'silong-elevator-plate') continue; // (each cage lays its own)
      if (o.id.startsWith('silong-elevator-')) this.cages.push(this.piece(o, true));
      else if (o.id.startsWith('silong-door-')) this.doors.push(this.piece(o, false));
    }
    // The arrival elevator's tiles are walkable as they are; its cage stays open. The way down is shut till it opens.
    for (const [c, r] of this.block.down) this.grid.block(c, r);
    for (const d of this.block.doors) for (const [c, r] of d.tiles) this.grid.block(c, r);
    // Mang Ramon's box (B2's R): a click asks for his note.
    const box = this.block.ramonBox;
    if (box) {
      const t = tileToScreen(box[0], box[1]);
      const zone = scene.add.zone(t.x, t.y - 14, 32, 30).setDepth(LABEL_DEPTH - 2);
      const label = new BuildingLabel(scene, "Mang Ramon's box", t.x);
      this.ramonLabel = label;
      zone.setInteractive({ cursor: 'pointer' });
      zone.on('pointerover', () => label.show(t.y - 34));
      zone.on('pointerout', () => label.show(null));
      zone.on('pointerup', (p: Phaser.Input.Pointer) => {
        if ((!p.leftButtonReleased() && !p.wasTouch) || !onMap(p, scene.game.canvas)) return;
        hooks.ramon();
      });
      this.ramonZone = zone;
    }
    // (Ang Makinang Yelo's hurt and death: Barong-Barong's, while it's on your screen.)
    mobs.kindSounds.set(MACHINE, {
      hurtMs: HURT_MS,
      hurt: (m) => this.sound('barong-hurt', m, { gapMs: HURT_MS }),
      death: (m) => this.sound('barong-death', m),
    });
    const glow = this.M.fx['fx-silong-lamp-glow'];
    for (const [c, r] of this.block.lamps) {
      const t = tileToScreen(c, r);
      this.glows.push(this.fx.play(glow, { x: t.x, y: t.y + 8 }, { layer: 'ground', life: Infinity }));
    }
  }

  get block(): SilongBlock {
    return this.map.silong!;
  }

  get floor(): SilongFloor {
    return this.block.floor;
  }

  /** A cage (with its plate under it) or a door, at its map spot. */
  private piece(o: MapObject, cage: boolean): Piece {
    const img = (id: string, under = false) => {
      const def = this.M.props[id] as PropDef | undefined;
      const t = tileToScreen(o.col, o.row);
      const i = this.scene.add.image(t.x, t.y, def?.file ?? id).setOrigin((def?.anchor[0] ?? 0) / (def?.size[0] ?? 1), (def?.anchor[1] ?? 0) / (def?.size[1] ?? 1));
      i.setDepth(under ? frontDepth(o.col, o.row, 1, 1) - 1000 : frontDepth(o.col, o.row, o.footprint[0], o.footprint[1]));
      return i;
    };
    const plate = cage ? img('silong-elevator-plate', true) : null;
    // (The down cage starts shut; the arrival's stays open.)
    const down = cage && this.isDown(o);
    return { o, img: img(cage ? (down ? 'silong-elevator-closed' : 'silong-elevator-open') : 'silong-door-closed'), plate };
  }

  /** Whether a cage stands on the way down (X) rather than the arrival (E). */
  private isDown(o: MapObject): boolean {
    const down = new Set(this.block.down.map(([c, r]) => `${c},${r}`));
    return down.has(`${o.col + 1},${o.row + 1}`) || down.has(`${o.col},${o.row}`);
  }

  /** The run as the server has it: the way down open once this floor's mini bosses are down, the B3 door once Frosty
   *  Tubbs is. */
  run(r: TownSilongRun): void {
    const f = r.floors.find((x) => x.floor === this.floor);
    if (f?.open && !this.open) {
      this.open = true;
      for (const [c, r2] of this.block.down) this.grid.unblock(c, r2);
      this.sound('warrens-shutter-open', null);
      for (const p of this.cages) if (this.isDown(p.o)) p.img.setTexture((this.M.props['silong-elevator-open'] as PropDef | undefined)?.file ?? 'silong-elevator-open');
    }
    if (r.door && !this.doorOpen && this.block.doors.length) {
      this.doorOpen = true;
      this.hooks.radio('door');
      this.sound('warrens-shutter-open', null);
      for (const d of this.block.doors) for (const [c, r2] of d.tiles) this.grid.unblock(c, r2);
      const crack = this.M.fx['fx-silong-frost-crack'];
      for (const p of this.doors) {
        this.fx.play(crack, { x: p.img.x, y: p.img.y }, { layer: 'front' });
        this.scene.time.delayedCall(500, () => p.img.setTexture((this.M.props['silong-door-open'] as PropDef | undefined)?.file ?? 'silong-door-open'));
      }
    }
  }

  /** Riding down: the cage you stand in slides up out of view over 1 s, leaving its plate; `then` once it's gone. */
  rideDown(at: { col: number; row: number }, then: () => void): void {
    const p = this.cages.filter((x) => this.isDown(x.o)).sort((a, b) => Math.hypot(a.o.col - at.col, a.o.row - at.row) - Math.hypot(b.o.col - at.col, b.o.row - at.row))[0];
    if (!p || matchMedia('(prefers-reduced-motion: reduce)').matches) return void this.scene.time.delayedCall(p ? 200 : 0, then);
    this.sound('warrens-shutter-open', null);
    this.scene.tweens.add({ targets: p.img, y: p.img.y - 160, alpha: 0, duration: RIDE_MS, ease: 'Quad.easeIn', onComplete: then });
  }

  /** Whether a tile is in the arrival elevator (riding up starts there). */
  onArrival(col: number, row: number): boolean {
    return this.block.arrive.some(([c, r]) => c === col && r === row);
  }

  // ── The mini bosses' moves ──

  bossMove(m: Move): void {
    const boss = this.mobs.get(m.id) ?? null;
    const d = (m.data ?? {}) as Record<string, unknown>;
    if (m.shape) this.telegraphs.show(m.key, m.id, m.shape, m.ms);
    this.moves.set(m.key, m);
    if (d.anim) this.poseFor(boss, String(d.anim), m.ms);
    const sfx = MOVE_SOUNDS[m.move];
    if (sfx?.warn) this.sound(sfx.warn, boss);
    if (m.move === 'iceBlockDrop') this.later(m.id, Math.max(0, m.ms - 450), () => this.sound('barong-fist-fall', boss)); // (the blocks falling)
    const at = (t: [number, number]) => this.mobs.ground(t[0] + 0.5, t[1] + 0.5);
    switch (m.move) {
      case 'brineSplash':
        this.later(m.id, m.ms, () => boss && this.burst(this.mobs.feet(boss), 0x7dd3c0, 2));
        return;
      case 'lidSpin': {
        const path = (d.path as [number, number][]) ?? [];
        const end = path[path.length - 1];
        if (!boss || !end) return;
        const out = Math.min(400, m.ms);
        this.later(m.id, m.ms - out, () => this.lid(this.mobs.feet(boss), at(end), out, Number(d.backMs ?? 600)));
        return;
      }
      case 'riceRain':
        for (const c of (m.shape as Extract<TelegraphShape, { kind: 'circles' }>).circles) this.grains(m.id, at(c.at), m.ms);
        return;
      case 'bellyFlop': {
        const to = d.to as [number, number];
        this.later(m.id, m.ms, () => this.burst(at(to), 0xd6c4a0, 1.5));
        return;
      }
      case 'chairBarrage': {
        if (!boss) return;
        const from = this.mobs.feet(boss);
        ((d.chairs as [number, number][]) ?? []).forEach((t, k) => this.later(m.id, k * 90, () => this.chair(from, at(t), Math.max(200, m.ms - k * 90))));
        return;
      }
      case 'split': {
        // She and her fakes small; a glint on her alone (the brief's tell).
        const ids = [String(d.real), ...((d.fakes as string[]) ?? [])];
        for (const id of ids) this.mobs.rescale(id, Number(d.scale ?? 1.2));
        const real = this.mobs.get(String(d.real));
        if (real) this.keep(m.id, this.fx.drawFx('front', (g, t) => this.glint(g, this.mobs.feet(real), t), m.ms));
        return;
      }
      case 'splitEnd':
        this.mobs.rescale(m.id, null);
        return;
      case 'cleaverCharge':
        if (boss) this.later(m.id, m.ms, () => this.keep(m.id, this.fx.drawFx('ground', (g, t) => this.dust(g, this.mobs.feet(boss), t), 900)));
        return;
      case 'hookShadows':
        for (const c of (m.shape as Extract<TelegraphShape, { kind: 'circles' }>).circles) this.hook(m.id, at(c.at), m.ms);
        return;
      case 'iceBlockDrop': {
        const tiles = (m.shape as Extract<TelegraphShape, { kind: 'tiles' }>).tiles;
        const warn = this.M.fx['fx-silong-ice-block-warn'];
        for (const t of tiles) this.keep(m.id, this.fx.play(warn, at(t), { layer: 'ground', life: m.ms }));
        // Its shadow grows, then the block falls: its last frame on the hit.
        const fall = 430;
        for (const t of tiles) {
          this.later(m.id, m.ms - 500, () => this.fx.play(this.M.fx['fx-silong-ice-block-shadow'], at(t), { layer: 'ground' }));
          this.later(m.id, m.ms - fall, () => this.fx.play(this.M.fx['fx-silong-ice-block-drop'], at(t), { layer: 'front' }));
        }
        return;
      }
      case 'freezerBreath': {
        this.hooks.radio('breath');
        const fan = this.block.bossTile;
        if (fan) this.keep(m.id, this.fx.play(this.M.fx['fx-silong-breath-warn-sw'], at(fan), { layer: 'ground', life: m.ms }));
        return;
      }
      case 'brineFlood':
      case 'beltRush':
        return; // (their poses: `anim`; the flood's water and the belts with their hit)
      case 'callTheFrost':
        if (boss) this.mobs.pose(boss, 'call');
        for (const t of (d.spots as [number, number][]) ?? []) this.later(m.id, m.ms, () => this.burst(at(t), 0xbfe6ff, 1));
        return;
      case 'enrage':
        if (boss) this.enrage(boss);
        return;
      case 'melt':
        this.melt();
        return;
      case 'jarCall':
      case 'sackCall':
      case 'tubCall':
      case 'hookSwing':
        for (const t of (d.spots as [number, number][]) ?? []) this.later(m.id, m.ms, () => this.burst(at(t), 0xb8a07a, 1));
        return;
    }
  }

  bossHit(m: Hit): void {
    const boss = this.mobs.get(m.id) ?? null;
    const move = this.moves.get(m.key.replace(/:back$/, ''));
    if (!m.key.endsWith(':back')) this.moves.delete(m.key);
    const sfx = MOVE_SOUNDS[m.move];
    if (sfx?.hit) this.sound(sfx.hit, boss, { gapMs: 120 });
    const slow = move?.data?.slow as { ms: number; factor: number } | undefined;
    for (const h of m.hits) this.hooks.onHit(boss, h.id, h, slow?.ms, slow?.factor);
    const at = (t: [number, number]) => this.mobs.ground(t[0] + 0.5, t[1] + 0.5);
    if (m.move === 'beltRush') this.hooks.rush(Number(m.data?.ms ?? 4000), Number(m.data?.speed ?? 5));
    // Ang Makinang Yelo's: its blocks stand as walls; its breath; the brine over the floor.
    const blocks = m.data?.blocks as [number, number][] | undefined;
    if (blocks?.length) for (const t of blocks) this.iceBlock(m.id, t, Number(m.data?.ms ?? 12_000));
    if (m.move === 'freezerBreath') {
      if (boss) this.mobs.pose(boss, 'breath');
      const fan = this.block.bossTile;
      if (fan) this.fx.play(this.M.fx['fx-silong-breath-sw'], at(fan), { layer: 'ground' });
    }
    const flood = m.data?.flood as [number, number][] | undefined;
    if (flood?.length) {
      const brine = this.M.fx['fx-silong-brine'];
      const ms = Number(m.data?.ms ?? 6000);
      for (const t of flood) this.keep(m.id, this.fx.play(brine, at(t), { layer: 'ground', life: ms, fadeIn: 300, fadeOut: 500, alpha: 0.8 }), 2000);
    }
    // Ice Slick: its tiles iced over for its time.
    const ice = m.data?.ice as [number, number][] | undefined;
    if (ice?.length) {
      const ms = Number(m.data?.ms ?? 5000);
      this.hooks.slick(ice, ms);
      const pts = ice.map(([c, r]) => this.mobs.ground(c + 0.5, r + 0.5));
      this.keep(m.id, this.fx.drawFx('ground', (g, t) => {
        g.clear();
        const a = t < 300 ? t / 300 : t > ms - 500 ? Math.max(0, (ms - t) / 500) : 1;
        for (const p of pts) g.fillStyle(0xd7f1ff, 0.45 * a).fillPoints([new Phaser.Math.Vector2(p.x, p.y - 8), new Phaser.Math.Vector2(p.x + 16, p.y), new Phaser.Math.Vector2(p.x, p.y + 8), new Phaser.Math.Vector2(p.x - 16, p.y)], true);
        return t < ms;
      }, ms));
    }
  }

  /** A boss reset or fell: its telegraphs, timers and effects gone (Mono Lisa her own size again). */
  cancel(id: string): void {
    this.telegraphs.cancel(id);
    for (const t of this.timers.get(id) ?? []) t.remove();
    this.timers.delete(id);
    for (const h of this.handles.get(id) ?? []) h.kill(150);
    this.handles.delete(id);
    this.mobs.rescale(id, null);
    // (Its ice blocks go with it: the server has opened their tiles.)
    for (const k of [...this.blocks.keys()]) this.breakBlock(k);
  }

  /** An ice block on a tile for `ms`: a wall on the walk grid, then it breaks. */
  private iceBlock(owner: string, [col, row]: [number, number], ms: number): void {
    const k = `${col},${row}`;
    this.blocks.get(k)?.timer.remove();
    this.blocks.get(k)?.img.destroy();
    const def = this.M.props['silong-ice-block'] as PropDef | undefined;
    const t = tileToScreen(col, row);
    const img = this.scene.add.image(t.x, t.y, def?.file ?? 'silong-ice-block').setOrigin((def?.anchor[0] ?? 32) / (def?.size[0] ?? 64), (def?.anchor[1] ?? 39) / (def?.size[1] ?? 64));
    img.setDepth(frontDepth(col, row, 1, 1));
    this.grid.block(col, row);
    const timer = this.scene.time.delayedCall(ms, () => this.breakBlock(k));
    this.blocks.set(k, { img, col, row, timer });
    void owner;
  }

  private breakBlock(k: string): void {
    const b = this.blocks.get(k);
    if (!b) return;
    this.blocks.delete(k);
    b.timer.remove();
    this.fx.play(this.M.fx['fx-silong-ice-block-break'], { x: b.img.x, y: b.img.y }, { layer: 'front' });
    b.img.destroy();
    this.grid.unblock(b.col, b.row);
  }

  /** Its enrage: the anim once, then its -enraged sheets (loaded now) for the rest of the fight. */
  private enrage(m: Mob): void {
    if (m.enraged) return;
    this.mobs.pose(m, 'enrage');
    m.enraged = true; // (asked once; shown as soon as its sheets are in)
    void this.mobs.loadEnraged(m.zone.mob).then(() => {
      m.enraged = false;
      this.mobs.setEnraged(m, true);
    });
  }

  /** The last boss down: steam off the frost round you (the floor's frost and ice tiles within 18), over 3 s. */
  private melt(): void {
    if (this.melted) return;
    this.melted = true;
    const steam = this.M.fx['fx-silong-melt-steam'];
    const me = this.hooks.me();
    const cold = new Set(['frost', 'freezer', 'ice']);
    let k = 0;
    for (let r = me.row - 18; r <= me.row + 18; r++) {
      for (let c = me.col - 18; c <= me.col + 18; c++) {
        const g = this.map.ground[r]?.[c] as string | undefined;
        if (!g || !cold.has(g) || this.map.blocked[r]?.[c] || (c * 7 + r * 13) % 5) continue;
        const t = this.mobs.ground(c + 0.5, r + 0.5);
        this.scene.time.delayedCall((k++ * 37) % 3000, () => this.fx.play(steam, t, { layer: 'front', alpha: 0.85 }));
      }
    }
  }

  /** Every frame: the boss bar while you're in a mini boss's room. */
  update(): void {
    const me = this.hooks.me();
    // (A work lamp near you on a cold floor: Mang Pido says what they're for.)
    if (this.block.floor !== 'b1' && this.block.lamps.some(([c, r]) => Math.max(Math.abs(c - me.col), Math.abs(r - me.row)) <= 2)) this.hooks.radio('lamp');
    const room = this.block.rooms.find((r) => r.boss && inRect(r.rect, me.col, me.row));
    const m = room ? this.mobs.get(`boss:${room.boss!.id}`) : undefined;
    this.bar.show(m && !m.dead && m.mini ? { name: m.subtitle ? `${m.mini.name}, ${m.subtitle}` : m.mini.name, level: m.level, hp: m.hp, maxHp: m.maxHp, enraged: m.enraged } : null);
  }

  /** One of the Warrens' sounds for a boss's move, only while it's on your screen (any of its drawn box; none: always). */
  private sound(name: WarrensSfx, m: Mob | null, o: { rate?: number; gapMs?: number } = {}): void {
    if (m) {
      const f = this.mobs.feet(m);
      const k = m.data?.scale ?? 1;
      const [w, h] = m.cell.size;
      const [ax, ay] = m.cell.anchor;
      if (!Phaser.Geom.Rectangle.Overlaps(this.scene.cameras.main.worldView, new Phaser.Geom.Rectangle(f.x - ax * k, f.y - ay * k, w * k, h * k))) return;
    }
    playWarrens(name, o);
  }

  /** The boss's anim so its attack frame (mobs.json) lands `ms` from now. */
  private poseFor(m: Mob | null, anim: string, ms: number): void {
    const A = m?.def.animations[anim];
    if (!m || !A) return;
    const f = m.data?.attackFrame ?? 0;
    this.later(m.id, Math.max(0, ms - (f / A.fps) * 1000), () => !m.dead && this.mobs.pose(m, anim));
  }

  private later(owner: string, ms: number, fn: () => void): void {
    const list = this.timers.get(owner) ?? [];
    list.push(this.scene.time.delayedCall(Math.max(0, ms), fn));
    this.timers.set(owner, list.filter((t) => t.getProgress() < 1));
  }

  private keep(owner: string, h: FxHandle | null, max = 24): void {
    if (!h) return;
    const list = this.handles.get(owner) ?? [];
    list.push(h);
    this.handles.set(owner, list.slice(-max));
  }

  // (Code-drawn stand-ins, until the art folder's silong FX for them.)

  /** A ring of droplets bursting out from a point (brine, dust). */
  private burst(at: Pt, colour: number, tiles: number): void {
    this.fx.drawFx('front', (g, t) => {
      const p = Math.min(1, t / 350);
      g.clear();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        g.fillStyle(colour, 0.8 * (1 - p)).fillCircle(at.x + Math.cos(a) * 16 * tiles * p, at.y + Math.sin(a) * 8 * tiles * p - 6 * p, 2.5);
      }
      return p < 1;
    });
  }

  /** Atsarah's lid: spinning out along its line over `out` ms, then back over `back`. */
  private lid(from: Pt, to: Pt, out: number, back: number): void {
    this.fx.drawFx('front', (g, t) => {
      const there = t < out;
      const k = there ? t / out : Math.max(0, 1 - (t - out) / back);
      const x = from.x + (to.x - from.x) * k;
      const y = from.y - 14 + (to.y - from.y) * k;
      g.clear().fillStyle(0x6b7280, 1).fillEllipse(x, y, 16, 6 + 4 * Math.abs(Math.sin(t / 40))).lineStyle(1, 0x1e1b3a, 1).strokeEllipse(x, y, 16, 6 + 4 * Math.abs(Math.sin(t / 40)));
      return t < out + back;
    });
  }

  /** Grains of rice falling into a circle over the last 450 ms before it lands. */
  private grains(owner: string, at: Pt, ms: number): void {
    const fall = Math.min(450, ms);
    this.later(owner, ms - fall, () =>
      this.keep(owner, this.fx.drawFx('front', (g, t) => {
        g.clear();
        for (let i = 0; i < 8; i++) {
          const dx = ((i * 37) % 21) - 10;
          const y = at.y - 60 + 60 * Math.min(1, t / fall) + ((i * 13) % 9);
          g.fillStyle(0xf5ecd0, 1).fillRect(at.x + dx, y - 6, 2, 3);
        }
        return t < fall;
      })),
    );
  }

  /** One of Mono Lisa's chairs: a small white square spinning from her to its tile over `ms`. */
  private chair(from: Pt, to: Pt, ms: number): void {
    this.fx.drawFx('front', (g, t) => {
      const k = Math.min(1, t / ms);
      const x = from.x + (to.x - from.x) * k;
      const y = from.y - 20 + (to.y - from.y) * k - Math.sin(k * Math.PI) * 30;
      g.clear().fillStyle(0xe5e7eb, 1).fillRect(x - 4, y - 4, 8, 8);
      return k < 1;
    });
  }

  /** A hook dropping from the rails into its shadow over the last 300 ms before it lands. */
  private hook(owner: string, at: Pt, ms: number): void {
    const drop = Math.min(300, ms);
    this.later(owner, ms - drop, () =>
      this.keep(owner, this.fx.drawFx('front', (g, t) => {
        const y = at.y - 90 + 90 * Math.min(1, t / drop);
        g.clear().lineStyle(2, 0x9ca3af, 1).lineBetween(at.x, at.y - 120, at.x, y).lineStyle(2, 0xd1d5db, 1).strokeCircle(at.x, y, 4);
        return t < drop + 120;
      })),
    );
  }

  /** A glint over the real Mono Lisa during her Split. */
  private glint(g: Phaser.GameObjects.Graphics, at: Pt, t: number): boolean {
    const s = 3 + 2 * Math.abs(Math.sin(t / 150));
    g.clear().fillStyle(0xfff7c2, 0.9).fillRect(at.x - 1, at.y - 46 - s, 2, s * 2).fillRect(at.x - s, at.y - 47, s * 2, 2);
    return true;
  }

  /** Dust off Sangkalancelot's feet as he charges. */
  private dust(g: Phaser.GameObjects.Graphics, at: Pt, t: number): boolean {
    g.clear();
    for (let i = 0; i < 4; i++) g.fillStyle(0xcbd5e1, 0.4 * (1 - t / 900)).fillCircle(at.x + (i - 1.5) * 6, at.y - 2, 3 + i);
    return t < 900;
  }

  destroy(): void {
    this.telegraphs.clear();
    for (const list of this.timers.values()) for (const t of list) t.remove();
    for (const list of this.handles.values()) for (const h of list) h.kill(0);
    this.bar.destroy();
    this.ramonZone?.destroy();
    this.ramonLabel?.text.destroy();
    for (const b of this.blocks.values()) {
      b.timer.remove();
      b.img.destroy();
    }
    for (const p of [...this.cages, ...this.doors]) {
      p.img.destroy();
      p.plate?.destroy();
    }
    for (const g of this.glows) g?.kill(0);
  }
}
