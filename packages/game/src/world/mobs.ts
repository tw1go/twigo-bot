import Phaser from 'phaser';
import type { Manifest, MobDef, MobZone, TownMap } from '../assets/types';
import { slice } from '../assets/packs';
import { CHARACTER_BIAS, HEIGHT_DEPTH } from './depth';
import type { Tile, WalkGrid } from './grid';
import { type WorldObjects, characterDepth } from './objects';
import { BuildingLabel } from '../ui/labels';

// 🥫 The Slums' mobs (map.mobZones; art in manifest mobs). No combat yet: for each zone that's on (`active`), one mob per
// spawn tile, idling and now and then hopping a few tiles round its spawn (the move animation; at most 3 tiles away,
// never off its zone's level, onto a blocked tile or a ramp, or into the safe zone), facing the way it goes (SE / NE /
// SW / NW sheets). A click shows its name and level ("Tin Can Lv 1-2"). Zones that are off (no art yet) and the boss
// load and place nothing; their data waits in the map. The zone's aggro, aggroRange, leash, respawnSec and level stay
// on each mob (`zone`) for combat later.

const ROAM = 3; // tiles from its spawn
const SPEED = 2.4; // tiles per second
const REST_MS: [number, number] = [2200, 6500];
const LABEL_MS = 2600;

/** The four ways the art faces, for a step in screen directions. */
const FACING: Record<string, 'se' | 'ne' | 'sw' | 'nw'> = { n: 'ne', ne: 'ne', e: 'se', se: 'se', s: 'sw', sw: 'sw', w: 'nw', nw: 'nw' };

export interface Mob {
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
}

export class Mobs {
  readonly list: Mob[] = [];
  private zoom = 2;

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
    };
    this.onSpawn(sprite);
    if (shadow) this.onSpawn(shadow);
    // A click: its name and level over its head for a moment.
    sprite.setInteractive({ cursor: 'pointer', pixelPerfect: true }).on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.leftButtonReleased() || p.wasTouch) this.showLabel(mob);
    });
    this.play(mob, 'idle');
    this.list.push(mob);
    this.sync(mob);
  }

  private play(m: Mob, anim: string): void {
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
      const path = this.grid.findPath(from, to);
      if (!path || path.length > ROAM * 2 + 1 || !path.every((t) => this.canStand(m, t))) continue;
      m.path = path.slice(1);
      return;
    }
  }

  update(deltaMs: number): void {
    const now = this.scene.time.now;
    for (const m of this.list) {
      if (!m.path.length && now >= m.restUntil) {
        this.wander(m);
        m.restUntil = now + Phaser.Math.Between(...REST_MS);
      }
      if (m.path.length) {
        let budget = (SPEED * deltaMs) / 1000;
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
        } else m.label.text.setPosition(Math.round(m.sprite.x), m.label.text.y);
      }
    }
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
