import Phaser from 'phaser';
import type { FxDef, Manifest } from '../assets/types';
import { playSound } from '../audio/sound';
import { tileToScreen } from '../iso';
import { GLOW_DEPTH } from './depth';
import type { WorldObjects } from './objects';

// 🧱 A Bakod in the neighbourhood, hit (after the bot has answered, so the ending is known): a Kalawang Potion thrown
// at it (it tumbles from the thief's hand to the gate, shatters, and the fence rusts for a moment, spreading out from
// the gate) or a Master Key in its padlock (it turns, then the lock opens or the key snaps). All of it at the gate: the
// fence piece in front of the house's door (the yard's east side at the door's row, where the thief stands). Art:
// manifest fx kalawang-flight/-splash, rust-fizz, key-turn/-unlock/-snap and the fence's -rust pieces; sounds bakod-*.
// Drawn over the fence and the characters but under the lamps' glow and the name plates; a world pixel is an art
// pixel, so it's crisp at the town's whole-number zoom. Under reduced motion: no flight or spread, just the ending's
// last frame for a moment, and the sounds.

const FX_DEPTH = GLOW_DEPTH - 10;
const FLIGHT_MS = 500;
const ARC_PX = 24;
const HAND_PX = 20; // the thief's hand, above their feet
const RUST_IN_MS = 300;
const RUST_HOLD_MS = 2000;
const RUST_OUT_MS = 600;
const RUST_STAGGER_MS = 40;
const RUST_FROM_SPLASH_FRAME = 4;
const UNLOCK_HOLD_MS = 400;
const SNAP_HOLD_MS = 500;
const FADE_MS = 300;
const STILL_MS = 600; // reduced motion: the ending's last frame

export interface BakodFxScene {
  scene: Phaser.Scene;
  M: Manifest;
  objects: WorldObjects;
  /** The house's top tile (its Bakod rings the yard a tile out). */
  house: { col: number; row: number };
  /** The thief's feet (world px). */
  from: { x: number; y: number };
  /** The world's tint now (night), or -1. */
  tint: number;
}

const wait = (scene: Phaser.Scene, ms: number) => new Promise<void>((done) => scene.time.delayedCall(ms, done));
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The fx strip's animation (made once), or null without its art. */
function anim(scene: Phaser.Scene, fx: FxDef | undefined, loop: boolean): string | null {
  if (!fx?.file || !fx.frame || !scene.textures.exists(fx.file)) return null;
  const key = `anim:${fx.file}`;
  if (!scene.anims.exists(key)) {
    scene.anims.create({ key, frames: scene.anims.generateFrameNumbers(fx.file, { start: 0, end: (fx.frames ?? 1) - 1 }), frameRate: fx.fps ?? 10, repeat: loop ? -1 : 0 });
  }
  return key;
}

/** A sprite of an fx strip with its anchor on (x, y). */
function sprite(d: BakodFxScene, fx: FxDef, x: number, y: number, depth: number): Phaser.GameObjects.Sprite {
  const [w, h] = fx.frame!;
  const [ax, ay] = fx.anchor ?? [w / 2, h / 2];
  const s = d.scene.add.sprite(Math.round(x), Math.round(y), fx.file!, 0).setOrigin(ax / w, ay / h).setDepth(depth);
  if (d.tint >= 0) s.setTint(d.tint);
  return s;
}

/** Plays a strip once; `onFrame(n)` with n counted from 1, once as each frame shows. Resolves on its last frame (the
 *  listener goes with it, so the next strip on the same sprite starts clean). */
function playOnce(s: Phaser.GameObjects.Sprite, key: string, onFrame: (n: number) => void = () => {}): Promise<void> {
  return new Promise((done) => {
    const update = (_a: unknown, frame: Phaser.Animations.AnimationFrame) => frame.index > 1 && onFrame(frame.index);
    s.on(Phaser.Animations.Events.ANIMATION_UPDATE, update);
    s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      s.off(Phaser.Animations.Events.ANIMATION_UPDATE, update);
      done();
    });
    s.play(key);
    onFrame(1);
  });
}

const fadeOut = (d: BakodFxScene, s: Phaser.GameObjects.GameObject & { alpha: number }, ms: number) =>
  new Promise<void>((done) => d.scene.tweens.add({ targets: s, alpha: 0, duration: ms, onComplete: () => done() }));

/** The Bakod's fence pieces round the house's yard (as hood-map lays them), with each one's base middle (world px)
 *  and how far it is from the gate. */
function bakod(d: BakodFxScene) {
  const { col, row } = d.house;
  const [c0, r0, c1, r1] = [col - 1, row - 1, col + 4, row + 4];
  const gateKey = `nw:${c1},${row + 1}`;
  const pieces: { key: string; x: number; y: number; at: [number, number] }[] = [];
  const add = (edge: 'nw' | 'ne', c: number, r: number) => {
    const top = tileToScreen(c, r);
    // An nw edge runs from the tile's top corner down to its left corner, an ne edge down to its right corner.
    pieces.push({ key: `${edge}:${c},${r}`, x: top.x + (edge === 'nw' ? -8 : 8), y: top.y + 4, at: edge === 'nw' ? [c, r + 0.5] : [c + 0.5, r] });
  };
  for (let r = r0; r < r1; r++) add('nw', c0, r), add('nw', c1, r);
  for (let c = c0; c < c1; c++) add('ne', c, r0), add('ne', c, r1);
  const gate = pieces.find((p) => p.key === gateKey) ?? pieces[0];
  const dist = (p: (typeof pieces)[number]) => Math.hypot(p.at[0] - gate.at[0], p.at[1] - gate.at[1]);
  return { gate, pieces: pieces.sort((a, b) => dist(a) - dist(b)) };
}

/** A Kalawang Potion thrown at the Bakod: flight, splash, and the fence rusting for a moment. Resolves when the splash
 *  is done (the rust keeps going for a few seconds after). */
export async function playKalawang(d: BakodFxScene): Promise<void> {
  const { gate, pieces } = bakod(d);
  const fx = d.M.fx;
  const reduced = reducedMotion();

  // The throw: tumbling along an arc from the hand to the gate.
  playSound('bakod-throw');
  const flightKey = anim(d.scene, fx['kalawang-flight'], true);
  if (flightKey && !reduced) {
    const start = { x: d.from.x, y: d.from.y - HAND_PX };
    const bottle = sprite(d, fx['kalawang-flight'], start.x, start.y, FX_DEPTH).play(flightKey);
    await new Promise<void>((done) =>
      d.scene.tweens.addCounter({
        from: 0,
        to: 1,
        duration: FLIGHT_MS,
        onUpdate: (tw) => {
          const t = tw.getValue() ?? 0;
          bottle.setPosition(Math.round(start.x + (gate.x - start.x) * t), Math.round(start.y + (gate.y - start.y) * t - ARC_PX * 4 * t * (1 - t)));
        },
        onComplete: () => done(),
      }),
    );
    bottle.destroy();
  }

  // The splash at the gate's base; the rust spreads from its 4th frame.
  const splashFx = fx['kalawang-splash'];
  const splashKey = anim(d.scene, splashFx, false);
  if (!splashKey) return void playSound('bakod-shatter');
  const splash = sprite(d, splashFx, gate.x, gate.y, FX_DEPTH);
  if (reduced) {
    playSound('bakod-shatter');
    splash.setFrame((splashFx.frames ?? 1) - 1);
    await wait(d.scene, STILL_MS);
    return void splash.destroy();
  }
  let rust: Promise<void> | null = null;
  await playOnce(splash, splashKey, (n) => {
    if (n === 1) playSound('bakod-shatter');
    if (n === RUST_FROM_SPLASH_FRAME && !rust) rust = rustBakod(d, pieces);
  });
  splash.destroy(); // (the rust carries on spreading and fading on its own)
}

/** Each fence piece cross-fades to its rusted copy with bubbles over it (one after another, out from the gate), holds,
 *  then fades back. */
async function rustBakod(d: BakodFxScene, pieces: ReturnType<typeof bakod>['pieces']): Promise<void> {
  const F = d.M.props.fence;
  const fizzFx = d.M.fx['rust-fizz'];
  const fizzKey = anim(d.scene, fizzFx, true);
  const rusty: Record<string, string | undefined> = { nw: F.nwRust, ne: F.neRust, post: F.postRust };
  await Promise.all(
    pieces.map(async (p, i) => {
      const piece = d.objects.fencePieces.get(p.key);
      const file = rusty[p.key.split(':')[0]];
      if (!piece || !file || !d.scene.textures.exists(file)) return;
      await wait(d.scene, i * RUST_STAGGER_MS);
      const over = d.scene.add.image(piece.x, piece.y, file).setOrigin(piece.originX, piece.originY).setDepth(piece.depth + 0.01).setAlpha(0);
      if (d.tint >= 0) over.setTint(d.tint);
      const fizz = fizzKey ? sprite(d, fizzFx, p.x, p.y, piece.depth + 0.02).play(fizzKey).setAlpha(0) : null;
      d.scene.tweens.add({ targets: [over, fizz].filter(Boolean), alpha: 1, duration: RUST_IN_MS });
      await wait(d.scene, RUST_IN_MS + RUST_HOLD_MS);
      if (fizz) void fadeOut(d, fizz, FADE_MS).then(() => fizz.destroy());
      await fadeOut(d, over, RUST_OUT_MS);
      over.destroy();
    }),
  );
}

/** A Master Key in the Bakod's padlock: it turns, then the lock opens ('unlock') or the key snaps ('snap'). */
export async function playMasterKey(d: BakodFxScene, ending: 'unlock' | 'snap'): Promise<void> {
  const { gate } = bakod(d);
  const fx = d.M.fx;
  const turnKey = anim(d.scene, fx['key-turn'], false);
  const endFx = fx[ending === 'unlock' ? 'key-unlock' : 'key-snap'];
  const endKey = anim(d.scene, endFx, false);
  const endSound = ending === 'unlock' ? 'bakod-unlock' : 'bakod-snap';
  const endFrame = ending === 'unlock' ? 1 : 3;
  if (!turnKey || !endKey) {
    playSound('bakod-key-in');
    return void d.scene.time.delayedCall(400, () => playSound(endSound));
  }
  const key = sprite(d, fx['key-turn'], gate.x, gate.y, FX_DEPTH);
  if (reducedMotion()) {
    playSound('bakod-key-in');
    await wait(d.scene, 300);
    playSound(endSound);
    key.setTexture(endFx.file!, (endFx.frames ?? 1) - 1);
    await wait(d.scene, STILL_MS);
    return void key.destroy();
  }
  await playOnce(key, turnKey, (n) => n === 3 && playSound('bakod-key-in'));
  // Same size and anchor, and the turn's last frame matches both endings' first: straight on, no gap.
  await playOnce(key, endKey, (n) => n === endFrame && playSound(endSound));
  await wait(d.scene, ending === 'unlock' ? UNLOCK_HOLD_MS : SNAP_HOLD_MS);
  await fadeOut(d, key, FADE_MS);
  key.destroy();
}
