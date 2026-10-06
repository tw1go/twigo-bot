import Phaser from 'phaser';
import type { FxDef, Manifest } from '../assets/types';
import { playSound } from '../audio/sound';
import { tileToScreen } from '../iso';
import type { Building } from './objects';

// 🏗️ A house going up in the neighbourhood: it rises out of the ground on its lot (only what's above the ground shows,
// with a little shake), dust puffing out from under its base (the walking dust along the edges, the dig dust at the
// corners), and a soft thud as it settles. And a new look: a puff of dust, the new colours inside it. The house stays
// where the map put it (sorting and clicks unchanged); only how much of it shows moves. Under reduced motion it just
// appears in a puff.

const RISE_MS = 1400;
const SHAKE_PX = 1;
const PUFF_EVERY_MS = 70;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Scene {
  scene: Phaser.Scene;
  M: Manifest;
  /** The world's tint now (night), or -1. */
  tint: number;
}

/** The base's four corners (world px): the footprint's top, right, bottom and left corners. */
function corners(b: Building) {
  const [fc, fr] = b.obj.footprint;
  const { col, row } = b.obj;
  const top = tileToScreen(col, row);
  const right = tileToScreen(col + fc, row);
  const bottom = tileToScreen(col + fc, row + fr);
  const left = tileToScreen(col, row + fr);
  return { top, right, bottom, left, back: (col + row) * 8 };
}

/** A dust sprite playing once (or `loops` times) at (x, y), then gone. */
function puff(s: Scene, fx: FxDef | undefined, x: number, y: number, depth: number, loops = 0): void {
  if (!fx?.file || !fx.frame || !s.scene.textures.exists(fx.file)) return;
  const key = `anim:once:${fx.file}`;
  if (!s.scene.anims.exists(key)) s.scene.anims.create({ key, frames: s.scene.anims.generateFrameNumbers(fx.file, { start: 0, end: (fx.frames ?? 1) - 1 }), frameRate: fx.fps ?? 10 });
  const [w, h] = fx.frame;
  const [ax, ay] = fx.anchor ?? [w / 2, h - 1];
  const p = s.scene.add.sprite(Math.round(x), Math.round(y), fx.file, 0).setOrigin(ax / w, ay / h).setDepth(depth);
  if (s.tint >= 0) p.setTint(s.tint);
  p.play({ key, repeat: loops });
  p.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => p.destroy());
}

/** A burst of dust round the base: the dig dust at the corners, the walking dust between. */
function burst(s: Scene, b: Building): void {
  const c = corners(b);
  const front = b.depth + 0.5;
  for (const [p, d] of [[c.left, front], [c.bottom, front], [c.right, front], [c.top, c.back - 0.5]] as const) puff(s, s.M.fx['dig-dust'], p.x, p.y, d);
  for (let i = 0; i < 8; i++) dustOnEdge(s, b, front);
}

/** One walking-dust puff somewhere on the base's edges (the two front edges in front of the house, the back ones behind). */
function dustOnEdge(s: Scene, b: Building, front: number): void {
  const c = corners(b);
  const edges = [[c.left, c.bottom, front], [c.bottom, c.right, front], [c.top, c.left, c.back - 0.5], [c.top, c.right, c.back - 0.5]] as const;
  const [a, z, depth] = edges[Math.floor(Math.random() * edges.length)];
  const t = Math.random();
  puff(s, s.M.fx['footstep-dust'], a.x + (z.x - a.x) * t + Phaser.Math.Between(-3, 3), a.y + (z.y - a.y) * t + 2, depth);
}

/** Hides a building until it rises (call before the scene shows it). */
export function sinkHouse(b: Building): void {
  b.sprite.setCrop(0, 0, b.sprite.width, 0);
}

/** The house rises out of its lot. Resolves when it has settled. */
export function riseHouse(s: Scene, b: Building): Promise<void> {
  const sprite = b.sprite;
  const { x, y } = sprite;
  const h = sprite.height;
  // The ground line: across the base's middle (its left and right corners), measured on the art. The house comes up
  // out of it, and the front of the base fills in below it as the house settles.
  const def = s.M.buildings[b.id];
  const ground = def ? Math.round((def.footprintTopCorner[1] + def.footprintBottomCorner[1]) / 2) : h;
  if (reducedMotion()) {
    sprite.setCrop();
    burst(s, b);
    playSound('arena-slam');
    return Promise.resolve();
  }
  playSound('arena-whoosh');
  burst(s, b);
  // Dust keeps puffing from under it while it comes up.
  const dust = s.scene.time.addEvent({ delay: PUFF_EVERY_MS, loop: true, callback: () => dustOnEdge(s, b, b.depth + 0.5) });
  return new Promise((done) =>
    s.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: RISE_MS,
      ease: 'Cubic.easeOut',
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        const sunk = Math.round(ground * (1 - t)); // how far is still underground
        sprite.setPosition(x + (t < 0.92 ? Phaser.Math.Between(-SHAKE_PX, SHAKE_PX) : 0), y + sunk);
        // Shown: down to the ground line, plus the front of the base as it comes into view.
        sprite.setCrop(0, 0, sprite.width, Math.max(0, ground - sunk + Math.round((h - ground) * t)));
        if (t >= 0.9) dust.remove();
      },
      onComplete: () => {
        dust.remove();
        sprite.setPosition(x, y).setCrop();
        burst(s, b);
        playSound('arena-slam');
        done();
      },
    }),
  );
}

/** A new look: a puff of dust round the house, the new texture inside it. */
export function puffHouse(s: Scene, b: Building, texture: string): void {
  burst(s, b);
  playSound('arena-whoosh');
  s.scene.time.delayedCall(reducedMotion() ? 0 : 180, () => b.sprite.setTexture(texture));
}
