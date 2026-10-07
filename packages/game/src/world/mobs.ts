import Phaser from 'phaser';
import type { Manifest, MobDef, MobZone, TownMap } from '../assets/types';
import { slice } from '../assets/packs';
import { CHARACTER_BIAS, HEIGHT_DEPTH } from './depth';
import type { Tile, WalkGrid } from './grid';
import { type WorldObjects, characterDepth } from './objects';
import { BuildingLabel } from '../ui/labels';
import { LABEL_DEPTH } from './depth';

// 🥫 The Slums' mobs (map.mobZones; art in manifest mobs). No combat yet: for each zone that's on (`active`), one mob per
// spawn tile (id `<zone>:<spawn index>`), idling and now and then hopping a few tiles round its spawn. The server runs
// them (bot web/town-mobs.ts: everyone sees the same mobs): its `mobs` snapshot places them and each `mob-move` hop is
// walked here at the same pace. Only with no server (nothing heard yet) do they wander on their own here (the move animation; at most 3 tiles away,
// never off its zone's level, onto a blocked tile or a ramp, or into the safe zone), facing the way it goes (SE / NE /
// SW / NW sheets). A click shows its name and level ("Tin Can Lv 1-2") and targets it; Z targets the nearest (again:
// the next nearest): a ring under it and the info bar at the top (ui/mob-target.ts). Battle (the server
// decides: bot web/town-mobs.ts): a hit plays the mob's hit pose (its death at 0 HP, then it's gone until it respawns), a
// damage number rises over it (gold for a crit), and a small HP bar shows once it's hurt; its own attacks play its attack
// pose toward the player. Zones that are off (no art yet) and the boss
// load and place nothing; their data waits in the map. The zone's aggro, aggroRange, leash, respawnSec and level stay
// on each mob (`zone`) for combat later.

const ROAM = 3; // tiles from its spawn
const SPEED = 2.4; // tiles per second
const REST_MS: [number, number] = [2200, 6500];
const LABEL_MS = 2600;
const TARGET_RANGE = 12; // tiles: Z picks among the mobs this close
const TARGET_LOSE = 20; // tiles: a target this far away is let go

/** The four ways the art faces, for a step in screen directions. */
const FACING: Record<string, 'se' | 'ne' | 'sw' | 'nw'> = { n: 'ne', ne: 'ne', e: 'se', se: 'se', s: 'sw', sw: 'sw', w: 'nw', nw: 'nw' };

export interface Mob {
  id: string;
  zone: MobZone;
  def: MobDef;
  /** Rolled once in its zone's range. */
  level: number;
  spawn: Tile;
  col: number;
  row: number;
  dir: 'se' | 'ne' | 'sw' | 'nw';
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image | null;
  path: Tile[];
  restUntil: number;
  label: BuildingLabel | null;
  labelUntil: number;
  hp: number;
  dead: boolean;
  /** A one-shot pose (hit, attack, death) is playing: idle / move wait. */
  posing: boolean;
  bar: Phaser.GameObjects.Graphics | null;
  /** The pace of its hop (tiles a second; slower while slowed). */
  speed: number;
  /** Slowed or rooted until then (scene ms), shown with a cold tint. */
  slowUntil: number;
}

export const MOB_HP = 100;

export class Mobs {
  readonly list: Mob[] = [];
  private zoom = 2;
  private target: Mob | null = null;
  private ring: Phaser.GameObjects.Graphics | null = null;
  /** The targeted mob changed (null: none): the scene shows the info bar. */
  onTarget: ((m: Mob | null) => void) | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly M: Manifest,
    private readonly map: TownMap,
    private readonly grid: WalkGrid,
    private readonly objects: WorldObjects,
    private readonly onSpawn: (o: Phaser.GameObjects.Components.Tint) => void,
  ) {
    for (const zone of map.mobZones ?? []) {
      const def = zone.active ? M.mobs?.[zone.mob] : undefined;
      if (!def || typeof def === 'string') continue;
      this.anims(zone.mob, def);
      zone.spawns.forEach(([col, row], i) => this.place(zone, def, { col, row }, i));
    }
  }

  /** Its animations, one per sheet (anim × direction). */
  private anims(id: string, def: MobDef): void {
    for (const [anim, a] of Object.entries(def.animations)) {
      for (const dir of def.directions) {
        const file = def.file.replace('{anim}', anim).replace('{dir}', dir);
        const key = `mob:${id}:${anim}:${dir}`;
        if (this.scene.anims.exists(key) || !this.scene.textures.exists(file)) continue;
        slice(this.scene.textures, file, def.size[0], def.size[1]);
        this.scene.anims.create({ key, frames: this.scene.anims.generateFrameNumbers(file, { start: 0, end: a.frames - 1 }), frameRate: a.fps, repeat: a.loop ? -1 : 0 });
      }
    }
  }

  private place(zone: MobZone, def: MobDef, at: Tile, i: number): void {
    const sprite = this.scene.add.sprite(0, 0, def.file.replace('{anim}', 'idle').replace('{dir}', 'se'));
    sprite.setOrigin(def.anchor[0] / def.size[0], def.anchor[1] / def.size[1]);
    const S = this.M.fx.shadow as unknown as { file: string; size: [number, number]; anchor: [number, number] } | undefined;
    const shadow = S && this.scene.textures.exists(S.file) ? this.scene.add.image(0, 0, S.file).setOrigin(S.anchor[0] / S.size[0], S.anchor[1] / S.size[1]) : null;
    const [lo, hi] = zone.level;
    const mob: Mob = {
      id: `${zone.id}:${i}`,
      zone,
      def,
      level: lo + ((i * 7) % (hi - lo + 1)),
      spawn: at,
      col: at.col + 0.5,
      row: at.row + 0.5,
      dir: (['se', 'sw', 'ne', 'nw'] as const)[i % 4],
      sprite,
      shadow,
      path: [],
      restUntil: this.scene.time.now + Phaser.Math.Between(0, REST_MS[1]),
      label: null,
      labelUntil: 0,
      hp: MOB_HP,
      dead: false,
      posing: false,
      bar: null,
      speed: SPEED,
      slowUntil: 0,
    };
    this.onSpawn(sprite);
    if (shadow) this.onSpawn(shadow);
    // A click: its name and level over its head for a moment.
    sprite.setInteractive({ cursor: 'pointer', pixelPerfect: true }).on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!p.leftButtonReleased() && !p.wasTouch) return;
      this.showLabel(mob);
      this.setTarget(mob);
    });
    this.play(mob, 'idle');
    this.list.push(mob);
    this.byId.set(mob.id, mob);
    this.sync(mob);
  }

  private play(m: Mob, anim: string): void {
    if (m.posing || m.dead) return;
    const key = `mob:${m.zone.mob}:${anim}:${m.dir}`;
    if (m.sprite.anims.currentAnim?.key !== key && this.scene.anims.exists(key)) m.sprite.play(key, true);
  }

  /** Where it can stand: its zone's level, open, not a ramp, outside the safe zone, close to its spawn. */
  private canStand(m: Mob, t: Tile): boolean {
    const H = this.objects.heights;
    const [c0, r0, c1, r1] = this.map.safeZone ?? [-1, -1, -2, -2];
    return (
      this.grid.walkable(t.col, t.row) &&
      H.at(t.col, t.row) === m.zone.height &&
      !H.ramp(t.col, t.row) &&
      !(t.col >= c0 && t.col <= c1 && t.row >= r0 && t.row <= r1) &&
      Math.max(Math.abs(t.col - m.spawn.col), Math.abs(t.row - m.spawn.row)) <= ROAM
    );
  }

  /** A few tiles' hop to a spot near its spawn, every step on ground it may stand on. */
  private wander(m: Mob): void {
    const from = { col: Math.floor(m.col), row: Math.floor(m.row) };
    for (let tries = 0; tries < 6; tries++) {
      const to = { col: m.spawn.col + Phaser.Math.Between(-ROAM, ROAM), row: m.spawn.row + Phaser.Math.Between(-ROAM, ROAM) };
      if ((to.col === from.col && to.row === from.row) || !this.canStand(m, to)) continue;
      const path = this.grid.findPath(from, to, 200); // a short hop: a small search
      if (!path || path.length > ROAM * 2 + 1 || !path.every((t) => this.canStand(m, t))) continue;
      m.path = path.slice(1);
      return;
    }
  }

  /** The server runs them from now on: every mob where it says (and the rest of a hop under way). */
  applySnapshot(mobs: { id: string; col: number; row: number; level: number; hp: number; dead?: boolean; path?: [number, number][]; speed?: number }[]): void {
    this.server = true;
    for (const s of mobs) {
      const m = this.byId.get(s.id);
      if (!m) continue;
      m.col = s.col + 0.5;
      m.row = s.row + 0.5;
      m.level = s.level;
      m.path = (s.path ?? []).map(([col, row]) => ({ col, row }));
      m.speed = s.speed ?? SPEED;
      m.hp = s.hp;
      this.show(m, !s.dead);
      this.sync(m);
    }
    if (this.target) this.onTarget?.(this.target); // its level may have changed
  }

  /** A hop from the server: from its first tile (a jump there if we'd drifted) along the rest. */
  hop(id: string, path: [number, number][], speed = SPEED): void {
    const m = this.byId.get(id);
    if (!m || !path.length) return;
    m.speed = speed;
    const [c0, r0] = path[0];
    if (Math.floor(m.col) !== c0 || Math.floor(m.row) !== r0) {
      m.col = c0 + 0.5;
      m.row = r0 + 0.5;
    }
    m.path = path.slice(1).map(([col, row]) => ({ col, row }));
  }

  /** A hit (the server's word): the hit pose (or its death), a damage number, the HP bar. */
  hit(id: string, damage: number, crit: boolean, hp: number, dead: boolean, slow?: { factor: number; ms: number }): void {
    const m = this.byId.get(id);
    if (!m || m.dead) return;
    m.hp = hp;
    if (slow && !dead) this.chill(m, slow);
    this.number(m, damage, crit);
    if (dead) {
      m.path = [];
      this.pose(m, 'death', () => this.show(m, false));
      m.dead = true;
      if (m === this.target) this.setTarget(null);
    } else this.pose(m, 'hit');
    this.drawBar(m);
    if (m === this.target) this.onTarget?.(m);
  }

  /** Slowed (or rooted: factor 0) for a while: a cold blue tint and a slower step, then itself again. */
  private chill(m: Mob, slow: { factor: number; ms: number }): void {
    m.slowUntil = this.scene.time.now + slow.ms;
    m.sprite.setTint(slow.factor === 0 ? 0x7dd3fc : 0x93c5fd);
    m.sprite.anims.timeScale = Math.max(0.35, slow.factor);
  }

  /** Its attack on someone at `at`: faces them and plays the attack pose. */
  strike(id: string, at: { col: number; row: number }): void {
    const m = this.byId.get(id);
    if (!m || m.dead) return;
    const dc = Math.sign(at.col + 0.5 - m.col);
    const dr = Math.sign(at.row + 0.5 - m.row);
    if (dc || dr) m.dir = FACING[stepName(dc, dr)] ?? m.dir;
    this.pose(m, 'attack');
  }

  /** Back at its spawn with full HP. */
  respawn(id: string, col: number, row: number, hp: number): void {
    const m = this.byId.get(id);
    if (!m) return;
    Object.assign(m, { col: col + 0.5, row: row + 0.5, hp, path: [], posing: false });
    this.show(m, true);
    m.sprite.setAlpha(0);
    this.scene.tweens.add({ targets: m.sprite, alpha: 1, duration: 400 });
    this.sync(m);
  }

  /** A one-shot pose, then idle again (or `then`). */
  private pose(m: Mob, anim: string, then?: () => void): void {
    const key = `mob:${m.zone.mob}:${anim}:${m.dir}`;
    if (!this.scene.anims.exists(key)) return void then?.();
    m.posing = true;
    m.sprite.play(key);
    m.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      m.posing = false;
      if (then) then();
      else this.play(m, m.path.length ? 'move' : 'idle');
    });
  }

  /** Shown (alive) or gone (dead, until it respawns). */
  private show(m: Mob, alive: boolean): void {
    m.dead = !alive;
    m.sprite.setVisible(alive);
    m.shadow?.setVisible(alive);
    if (alive) {
      m.posing = false;
      this.play(m, 'idle');
    }
    this.drawBar(m);
  }

  /** A small HP bar over a hurt mob (none at full HP or dead). */
  private drawBar(m: Mob): void {
    if (m.dead || m.hp >= MOB_HP) {
      m.bar?.destroy();
      m.bar = null;
      return;
    }
    m.bar ??= this.scene.add.graphics();
    const w = 20;
    m.bar.clear().fillStyle(0x0b0a1a, 0.85).fillRect(-w / 2 - 1, -1, w + 2, 4).fillStyle(0xdc2626, 1).fillRect(-w / 2, 0, Math.max(1, Math.round((w * m.hp) / MOB_HP)), 2);
    this.syncBar(m);
  }

  private syncBar(m: Mob): void {
    m.bar?.setPosition(Math.round(m.sprite.x), Math.round(m.sprite.y - m.def.anchor[1] + 2)).setDepth(LABEL_DEPTH - 1);
  }

  /** A damage number rising over it (gold and bigger for a crit). */
  private number(m: Mob, damage: number, crit: boolean): void {
    const t = this.scene.add
      .text(Math.round(m.sprite.x), Math.round(m.sprite.y - m.def.anchor[1] - 4), String(damage), {
        fontFamily: '"Mk Numbers", "Pixelify Sans", monospace',
        fontSize: `${crit ? 16 : 12}px`,
        color: crit ? '#FCDA4A' : '#FFFFFF',
        stroke: '#1E1B3A',
        strokeThickness: 3,
        resolution: Math.max(2, this.zoom * 2),
      })
      .setOrigin(0.5, 1)
      .setDepth(LABEL_DEPTH);
    this.scene.tweens.add({ targets: t, y: t.y - 14, alpha: { from: 1, to: 0 }, duration: 800, ease: 'Quad.easeOut', onComplete: () => t.destroy() });
  }

  private server = false;
  private readonly byId = new Map<string, Mob>();

  update(deltaMs: number): void {
    const now = this.scene.time.now;
    for (const m of this.list) {
      if (m.dead) continue;
      if (m.slowUntil && now >= m.slowUntil) {
        m.slowUntil = 0;
        m.sprite.clearTint();
        m.sprite.anims.timeScale = 1;
        this.onSpawn(m.sprite); // the night's tint again
      }
      if (!this.server && !m.path.length && now >= m.restUntil) {
        this.wander(m);
        m.restUntil = now + Phaser.Math.Between(...REST_MS);
      }
      if (m.path.length) {
        let budget = (m.speed * deltaMs) / 1000;
        while (budget > 0 && m.path.length) {
          const next = m.path[0];
          const dx = next.col + 0.5 - m.col;
          const dy = next.row + 0.5 - m.row;
          const d = Math.hypot(dx, dy);
          const sc = Math.sign(Math.round(dx * 2));
          const sr = Math.sign(Math.round(dy * 2));
          if (sc || sr) m.dir = FACING[stepName(sc, sr)] ?? m.dir;
          if (d <= budget) {
            m.col = next.col + 0.5;
            m.row = next.row + 0.5;
            m.path.shift();
            budget -= d;
          } else {
            m.col += (dx / d) * budget;
            m.row += (dy / d) * budget;
            budget = 0;
          }
        }
        this.play(m, m.path.length ? 'move' : 'idle');
        this.sync(m);
      } else this.play(m, 'idle');
      if (m.label) {
        if (now >= m.labelUntil) {
          m.label.show(null);
          const l = m.label;
          m.label = null;
          this.scene.time.delayedCall(200, () => l.text.destroy());
        } else {
          // The name moves with it.
          m.label.text.setX(Math.round(m.sprite.x));
          m.label.show(m.sprite.y - m.def.anchor[1] + 4);
        }
      }
    }
  }

  /** Targets the nearest mob within reach of `from` that isn't the current one (so Z again goes on to the next). */
  targetNext(from: { col: number; row: number }): Mob | null {
    const near = this.list
      .map((m) => ({ m, d: Math.hypot(m.col - from.col - 0.5, m.row - from.row - 0.5) }))
      .filter((x) => x.d <= TARGET_RANGE && !x.m.dead)
      .sort((a, b) => a.d - b.d);
    if (!near.length) return this.setTarget(null);
    const i = this.target ? near.findIndex((x) => x.m === this.target) : -1;
    return this.setTarget(near[(i + 1) % near.length].m);
  }

  /** The targeted mob, if any. */
  get current(): Mob | null {
    return this.target;
  }

  /** A mob's tile (null: no such mob). */
  tileOf(id: string): { col: number; row: number } | null {
    const m = this.byId.get(id);
    return m ? { col: Math.floor(m.col), row: Math.floor(m.row) } : null;
  }

  setTarget(m: Mob | null): Mob | null {
    if (m === this.target) return m;
    this.target = m;
    this.ring?.destroy();
    this.ring = null;
    if (m) {
      // A soft gold ring on the ground under it.
      this.ring = this.scene.add.graphics();
      this.ring.lineStyle(1, 0xfcda4a, 0.9).strokeEllipse(0, 0, 22, 10).lineStyle(1, 0x1e1b3a, 0.6).strokeEllipse(0, 1, 24, 11);
      this.syncRing();
    }
    this.onTarget?.(m);
    return m;
  }

  /** Lets go of the target once it's far from `from`. */
  check(from: { col: number; row: number }): void {
    const m = this.target;
    if (m && Math.hypot(m.col - from.col - 0.5, m.row - from.row - 0.5) > TARGET_LOSE) this.setTarget(null);
  }

  private syncRing(): void {
    const m = this.target;
    if (!m || !this.ring) return;
    this.ring.setPosition(m.sprite.x, m.sprite.y).setDepth(m.sprite.depth - 0.3);
  }

  private sync(m: Mob): void {
    const ground = this.objects.heights.lift(m.col, m.row);
    const x = Math.round((m.col - m.row) * 16);
    const y = Math.round((m.col + m.row) * 8 - ground);
    m.sprite.setPosition(x, y);
    const feet = (m.col + m.row + 1) * 8 + CHARACTER_BIAS + ground * HEIGHT_DEPTH;
    const depth = characterDepth(this.objects, Math.floor(m.col), Math.floor(m.row), feet, m.sprite.getBounds());
    m.sprite.setDepth(depth);
    m.shadow?.setPosition(x, y).setDepth(depth - 0.2);
    if (m === this.target) this.syncRing();
    this.syncBar(m);
  }

  private showLabel(m: Mob): void {
    const [lo, hi] = m.zone.level;
    const name = `${m.def.name} Lv ${lo === hi ? lo : `${lo}-${hi}`}`;
    if (!m.label) {
      m.label = new BuildingLabel(this.scene, name, m.sprite.x);
      m.label.setZoom(this.zoom);
    }
    m.label.show(m.sprite.y - m.def.anchor[1] + 4);
    m.labelUntil = this.scene.time.now + LABEL_MS;
  }

  setZoom(zoom: number): void {
    this.zoom = zoom;
    for (const m of this.list) m.label?.setZoom(zoom);
  }

  get tintables(): Phaser.GameObjects.Components.Tint[] {
    return this.list.flatMap((m) => (m.shadow ? [m.sprite, m.shadow] : [m.sprite]));
  }
}

/** The screen direction of a grid step (as the characters' dirForStep). */
function stepName(dc: number, dr: number): string {
  const sx = dc - dr; // screen right
  const sy = dc + dr; // screen down
  if (sx > 0 && sy === 0) return 'e';
  if (sx < 0 && sy === 0) return 'w';
  if (sy > 0 && sx === 0) return 's';
  if (sy < 0 && sx === 0) return 'n';
  if (sx > 0) return sy > 0 ? 'se' : 'ne';
  return sy > 0 ? 'sw' : 'nw';
}
