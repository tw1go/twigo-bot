import Phaser from 'phaser';
import type { Dir, Manifest } from '../assets/types';
import type { Character } from '../characters/character';
import type { Tile, WalkGrid } from './grid';

// 💨 Mobility moves in town (the hotbar's Dash, and each class's Lv 8 move: Step Back, Charge or Blink).
// The combat sheets for them have no clothes or hair yet, so in town the character keeps its outfit and the move is
// motion and fx: Dash and Charge slide fast along the facing with lavender afterimages and dust; Step Back hops back
// facing forward; Blink stretches thin and vanishes in a burst, then pops back in further on. Timings and fx hook
// points follow mobility-README (mikazuki-assets). The tiles are checked on the walk grid and sent to the server
// one by one like steps, so where you end up is where everyone sees you; others play the same move from the
// town's `move` message (and skip the steps it brings).

export type MoveKind = 'dash' | 'step-back' | 'charge' | 'blink';

interface MoveDef {
  /** Tiles at most (fewer where something's in the way). */
  tiles: number;
  /** Seconds before it can be used again. */
  cooldown: number;
  /** Goes backwards, still facing forward. */
  back?: boolean;
}

export const MOVES: Record<MoveKind, MoveDef> = {
  dash: { tiles: 3, cooldown: 2 },
  'step-back': { tiles: 2, cooldown: 3, back: true },
  charge: { tiles: 5, cooldown: 5 },
  blink: { tiles: 4, cooldown: 4 },
};

export const isMoveKind = (s: string): s is MoveKind => s in MOVES;

const STEP: Record<Dir, [number, number]> = {
  n: [-1, -1], s: [1, 1], e: [1, -1], w: [-1, 1],
  ne: [0, -1], nw: [-1, 0], se: [1, 0], sw: [0, 1],
};

const TRAIL = 0xb794f6; // the afterimages' lavender
const DUST = 'fx-mobility-dust';
const BURST = 'fx-mobility-blink';

/** The tiles a move would cross from `from` (in a straight line along `dir`, or against it), up to the first one it
 *  can't step to (the server takes them as steps, so even a blink can't jump over what's in the way). */
export function moveTiles(grid: WalkGrid, from: Tile, dir: Dir, kind: MoveKind, most = MOVES[kind].tiles): Tile[] {
  const def = MOVES[kind];
  const [dc, dr] = STEP[dir].map((v) => (def.back ? -v : v));
  const out: Tile[] = [];
  let at = from;
  for (let i = 0; i < Math.min(def.tiles, most); i++) {
    const to = { col: at.col + dc, row: at.row + dr };
    if (!grid.canStep(at, to)) break;
    out.push(to);
    at = to;
  }
  return out;
}

/** Plays a move on a character (yours or someone else's) to `end`, `n` tiles away, facing `dir`; resolves when it
 *  has landed. `onSpawn` night-tints what it makes (the character again too, after the move's own tints); `sound` plays
 *  a set of its sounds (audio/sound.ts playSet: skill-dash, -step-back, -charge as it goes; a Blink's skill-blink-out as
 *  it vanishes, skill-blink-in as it pops back). */
export function playMove(scene: Phaser.Scene, M: Manifest, char: Character, kind: MoveKind, end: Tile, n: number, dir: Dir, onSpawn?: (o: Phaser.GameObjects.Components.Tint) => void, sound?: (set: string) => void): Promise<void> {
  const from = char.spot;
  const to = { col: end.col + 0.5, row: end.row + 0.5 };
  const fx = (name: string, at = char.sprite) => {
    const o = puff(scene, M, name, at.x, at.y + char.lift, at.depth - 0.1);
    if (o) onSpawn?.(o);
  };
  const trail = () => {
    const sp = char.sprite;
    const ghost = scene.add.image(sp.x, sp.y, sp.texture.key, sp.frame.name).setOrigin(sp.originX, sp.originY).setDepth(sp.depth - 0.05).setTint(TRAIL).setAlpha(0.5); // glows: not night-tinted
    scene.tweens.add({ targets: ghost, alpha: 0, duration: 130, onComplete: () => ghost.destroy() });
  };
  char.busy = true;
  const done = () => {
    char.lift = 0;
    char.sprite.anims.timeScale = 1;
    char.sprite.setScale(1).setAlpha(1).setTintMode(Phaser.TintModes.MULTIPLY).clearTint();
    onSpawn?.(char.sprite);
    char.pose(to.col, to.row, dir, false);
    char.busy = false;
  };

  if (kind === 'blink') {
    return new Promise((resolve) => {
      const sp = char.sprite;
      fx(BURST);
      sound?.('skill-blink-out');
      sp.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL); // the white flash
      scene.tweens.add({
        targets: sp, scaleX: 0.15, scaleY: 1.5, alpha: 0, duration: 180, ease: 'Quad.easeIn',
        onComplete: () => {
          char.pose(to.col, to.row, dir, false);
          sp.setScale(1.6, 0.4);
          fx(BURST);
          sound?.('skill-blink-in');
          scene.tweens.add({
            targets: sp, scaleX: 1, scaleY: 1, alpha: 1, duration: 160, ease: 'Back.easeOut',
            onUpdate: (t) => {
              if (t.progress > 0.4 && sp.tintMode === Phaser.TintModes.FILL) {
                sp.setTintMode(Phaser.TintModes.MULTIPLY).clearTint();
                onSpawn?.(sp);
              }
            },
            onComplete: () => (done(), resolve()),
          });
        },
      });
    });
  }

  // Dash, Charge, Step Back: a straight slide from where the feet are to the last tile's centre.
  const ms = kind === 'dash' ? 90 * n : kind === 'charge' ? 100 * n : 160 * n;
  const ease = kind === 'charge' ? 'Linear' : kind === 'dash' ? 'Cubic.easeOut' : 'Sine.easeInOut';
  const windup = kind === 'charge' ? 120 : 0;
  return new Promise((resolve) => {
    let frame = 0;
    let lastDust = 0;
    char.sprite.anims.timeScale = kind === 'step-back' ? 1 : 2.2;
    char.pose(from.col, from.row, dir, kind !== 'step-back');
    fx(DUST);
    sound?.(`skill-${kind}`);
    scene.tweens.addCounter({
      from: 0, to: 1, duration: ms, delay: windup, ease,
      onUpdate: (t) => {
        const v = t.getValue() ?? 0;
        if (kind === 'step-back') char.lift = Math.round(Math.sin(Math.PI * Math.min(1, t.progress)) * 8);
        char.pose(from.col + (to.col - from.col) * v, from.row + (to.row - from.row) * v, dir, kind !== 'step-back');
        if (kind !== 'step-back' && frame++ % 2 === 0) trail();
        if (kind === 'charge' && scene.time.now - lastDust > 220) {
          lastDust = scene.time.now;
          fx(DUST);
        }
      },
      onComplete: () => {
        done();
        fx(DUST); // the brake, the skid, the landing
        resolve();
      },
    });
  });
}

/** An fx sheet played once at a point (feet anchored), then gone. */
function puff(scene: Phaser.Scene, M: Manifest, name: string, x: number, y: number, depth: number): Phaser.GameObjects.Sprite | null {
  const fx = M.fx[name];
  if (!fx?.file || !scene.textures.exists(fx.file)) return null;
  const key = `anim:${fx.file}`;
  if (!scene.anims.exists(key)) scene.anims.create({ key, frames: scene.anims.generateFrameNumbers(fx.file, { start: 0, end: (fx.frames ?? 1) - 1 }), frameRate: fx.fps ?? 12, repeat: 0 });
  const [w, h] = fx.frame ?? [32, 32];
  const [ax, ay] = fx.anchor ?? [w / 2, h];
  const o = scene.add.sprite(x, y, fx.file).setOrigin(ax / w, ay / h).setDepth(depth);
  o.play(key).once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => o.destroy());
  return o;
}
