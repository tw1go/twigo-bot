import Phaser from 'phaser';
import type { Manifest, TownMap } from '../assets/types';
import { tileToScreen } from '../iso';
import { GLOW_DEPTH } from './depth';
import type { Lamp } from './objects';
import { hash, pick, rng } from './rng';

// 🌙 Night life, from dusk to dawn (while the lamps are on): fireflies (fx firefly, ADD blend) drifting and blinking
// near the town's trees and bushes, and moths (fx moth) fluttering round the lanterns of some lamps, in front of the
// lamp and behind it. Both fade in and out with the night. Seeded, so they keep to the same places; only those on
// screen are drawn. Neither is tinted by the night: the fireflies glow, the moths are in the lamp's light.

const FIREFLIES = 140;
const MOTH_LAMPS = 0.5; // share of lamps with moths (1 or 2 each)
const FADE_MS = 1500;

interface Firefly {
  sprite: Phaser.GameObjects.Sprite;
  x: number;
  y: number;
  drift: [number, number, number]; // speeds
  phase: [number, number, number];
  blink: number; // ms per blink
}

interface Moth {
  sprite: Phaser.GameObjects.Sprite;
  lamp: Lamp;
  speed: number; // radians per ms (negative: the other way round)
  phase: number;
  rx: number;
  ry: number;
}

export class NightLife {
  private readonly fireflies: Firefly[] = [];
  private readonly moths: Moth[] = [];
  private level = 0; // 0 by day, 1 at night (fading between)
  private last = 0;

  constructor(scene: Phaser.Scene, M: Manifest, map: TownMap, lamps: Lamp[]) {
    const fly = M.fx.firefly;
    const moth = M.fx.moth;
    const anim = (file: string, frames: number, fps: number, yoyo: boolean) => {
      const key = `anim:${file}`;
      if (!scene.anims.exists(key)) {
        scene.anims.create({ key, frames: scene.anims.generateFrameNumbers(file, { start: 0, end: frames - 1 }), frameRate: fps, repeat: -1, yoyo });
      }
      return key;
    };

    if (fly?.file && fly.frames) {
      const key = anim(fly.file, fly.frames, fly.fps ?? 5, true);
      const homes = map.objects.filter((o) => o.kind === 'prop' && /^(tree|bush|fern)-/.test(o.id) && !o.id.includes('planter'));
      const r = rng(hash(FIREFLIES, 7));
      for (let i = 0; homes.length && i < FIREFLIES; i++) {
        const o = pick(homes, r());
        const top = tileToScreen(o.col + (r() - 0.5) * 6, o.row + (r() - 0.5) * 6);
        const sprite = scene.add.sprite(top.x, top.y, fly.file, 0).setBlendMode(Phaser.BlendModes.ADD).setDepth(GLOW_DEPTH).setAlpha(0).setVisible(false);
        sprite.play({ key, startFrame: Math.floor(r() * fly.frames) });
        this.fireflies.push({
          sprite,
          x: top.x,
          y: top.y + 8 - (6 + r() * 18), // the tile's centre, a little above the grass
          drift: [0.0003 + r() * 0.0004, 0.0009 + r() * 0.0008, 0.0004 + r() * 0.0004],
          phase: [r() * 7, r() * 7, r() * 7],
          blink: 2800 + r() * 3200,
        });
      }
    }

    if (moth?.file && moth.frames) {
      const key = anim(moth.file, moth.frames, moth.fps ?? 14, false);
      for (const lamp of lamps) {
        const r = rng(hash(Math.round(lamp.sprite.x), Math.round(lamp.sprite.y), 31));
        if (r() >= MOTH_LAMPS) continue;
        for (let n = r() < 0.5 ? 1 : 2; n > 0; n--) {
          const sprite = scene.add.sprite(lamp.glow.x, lamp.glow.y, moth.file, 0).setAlpha(0).setVisible(false);
          sprite.play({ key, startFrame: Math.floor(r() * moth.frames) });
          this.moths.push({ sprite, lamp, speed: (0.003 + r() * 0.004) * (r() < 0.5 ? -1 : 1), phase: r() * 7, rx: 7 + r() * 7, ry: 3 + r() * 4 });
        }
      }
    }
  }

  /** Each frame: `night` while the lamps are on; `view` is what the camera sees. */
  update(time: number, night: boolean, view: Phaser.Geom.Rectangle): void {
    const dt = this.last ? Math.min(100, time - this.last) : 0;
    this.last = time;
    this.level = Phaser.Math.Clamp(this.level + (night ? dt : -dt) / FADE_MS, 0, 1);
    const off = this.level === 0;
    const seen = (x: number, y: number) => x > view.left - 16 && x < view.right + 16 && y > view.top - 16 && y < view.bottom + 16;

    for (const f of this.fireflies) {
      const x = f.x + Math.sin(time * f.drift[0] + f.phase[0]) * 10 + Math.sin(time * f.drift[1] + f.phase[1]) * 3;
      const y = f.y + Math.sin(time * f.drift[2] + f.phase[2]) * 6;
      const show = !off && seen(x, y);
      f.sprite.setVisible(show);
      if (!show) continue;
      const pulse = Math.max(0, Math.sin(((time / f.blink + f.phase[0]) % 1) * Math.PI * 2)); // lit about half the time
      f.sprite.setPosition(Math.round(x), Math.round(y)).setAlpha(pulse * pulse * this.level);
    }

    for (const m of this.moths) {
      const show = !off && m.lamp.sprite.visible && seen(m.lamp.glow.x, m.lamp.glow.y);
      m.sprite.setVisible(show);
      if (!show) continue;
      const a = time * m.speed + m.phase;
      const flutter = Math.sin(time * 0.017 + m.phase) * 1.5; // never quite a circle
      m.sprite
        .setPosition(Math.round(m.lamp.glow.x + Math.cos(a) * (m.rx + flutter)), Math.round(m.lamp.glow.y + Math.sin(a) * m.ry + flutter))
        .setDepth(Math.sin(a) > 0 ? GLOW_DEPTH + 1 : m.lamp.sprite.depth - 0.05) // near side: over the lantern and its glow; far side: behind the lamp
        .setAlpha(this.level);
    }
  }
}
