import Phaser from 'phaser';

// 💥 A number (or a word: "Miss", "Blocked", "Dodge") rising over a mob or a player, in the world's px (the camera
// zooms it 2-4x). A crit lands hard so it reads as one at a glance: it drops in big, slams down to its size with a gold
// ring bursting out, shakes, holds a moment, then rises and fades like the rest. Reduced motion: no slam or shake.

const FONT = '"Mk Numbers", "Pixelify Sans", monospace';
const RISE_PX = 18;
const RISE_MS = 900;
const SLAM = { fromScale: 2.4, ms: 110 };
const SHAKE = { px: 2, times: 4, ms: 40 }; // each way, after the slam
const HOLD_MS = 220; // a crit stays put a moment before it rises
const RING = { from: 4, to: 20, ms: 280, colour: 0xfcda4a, width: 3 };

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface NumberLook {
  /** Its size in world px. */
  size: number;
  colour: string;
  crit?: boolean;
  depth: number;
  /** The camera's zoom (its text drawn sharp at it). */
  zoom: number;
}

export function floatNumber(scene: Phaser.Scene, x: number, y: number, text: string, look: NumberLook): void {
  const t = scene.add
    .text(Math.round(x), Math.round(y), text, {
      fontFamily: FONT,
      fontSize: `${look.size}px`,
      color: look.colour,
      stroke: '#1E1B3A',
      strokeThickness: look.crit ? 5 : 4,
      resolution: Math.max(2, look.zoom * 2),
    })
    .setOrigin(0.5, 1)
    .setDepth(look.depth);
  const rise = (delay = 0) =>
    scene.tweens.add({ targets: t, y: t.y - RISE_PX, alpha: { from: 1, to: 0 }, delay, duration: RISE_MS, ease: 'Quad.easeOut', onComplete: () => t.destroy() });
  if (!look.crit || still()) return void rise();
  // The slam: from big down to its size, fast, then the ring and the shake.
  t.setScale(SLAM.fromScale);
  scene.tweens.add({
    targets: t,
    scale: 1,
    duration: SLAM.ms,
    ease: 'Quad.easeIn',
    onComplete: () => {
      ring(scene, t.x, t.y - (look.size * 0.5), look.depth - 0.01);
      scene.tweens.add({ targets: t, x: t.x + SHAKE.px, duration: SHAKE.ms, yoyo: true, repeat: SHAKE.times - 1, ease: 'Sine.easeInOut', onComplete: () => rise(HOLD_MS) });
    },
  });
}

/** A gold ring bursting out from where the crit landed. */
function ring(scene: Phaser.Scene, x: number, y: number, depth: number): void {
  const g = scene.add.graphics().setDepth(depth);
  const state = { r: RING.from, a: 1 };
  scene.tweens.add({
    targets: state,
    r: RING.to,
    a: 0,
    duration: RING.ms,
    ease: 'Quad.easeOut',
    onUpdate: () => g.clear().lineStyle(RING.width, RING.colour, state.a).strokeEllipse(x, y, state.r * 2, state.r * 1.2),
    onComplete: () => g.destroy(),
  });
}
