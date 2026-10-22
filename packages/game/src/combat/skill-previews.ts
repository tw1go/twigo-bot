import type { FxOpts, Pt, Skill, SkillKit } from './skill-stage';
import { BUFF_BURSTS, BUFF_LOOKS, DEBUFF_MARKS, LANDING_MS, buffHook } from './utility-looks';

// 🎬 The first 7 damage skills of each class, as the class fx notes describe them (fx/<class>/*.md in the art folder):
// which attack anim and frames, when and where each fx piece spawns (launch.json points, the READMEs' points),
// projectiles flying to the target, hits, ground rings and ticks. Written against SkillKit (combat/skill-stage.ts)
// so the real combat can play the same sequences later. Everything faces SE; enemy 0 is in melee range, 1 at mid
// range, 2 far. Numbers: 'dot' ticks are orange (burns), 'mint' ticks mint (menthol).

const angle = (a: Pt, b: Pt) => Math.atan2(b.y - a.y, b.x - a.x);
const toward = (a: Pt, b: Pt, d: number): Pt => {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: a.x + ((b.x - a.x) / l) * d, y: a.y + ((b.y - a.y) / l) * d };
};
const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
const SE = { x: 0.894, y: 0.447 }; // one step along the facing
const ahead = (k: SkillKit, from: Pt, d: number): Pt => ({ x: from.x + SE.x * d, y: from.y + SE.y * d });

// ── Slingshot (fx/open-world: Mac's bullet; the fork on the release frame, the README's launch point) ──

const BULLET = 'fx-pebble-bullet-small';
const BULLET_SPEED = 300;
const RELEASE = { 'attack-quick': 2, 'attack-heavy': 4, 'attack-cast': 4 } as const;

/** A shot from the fork to enemy n, `then` on arrival. */
function pebble(k: SkillKit, anim: keyof typeof RELEASE, to: Pt, then: () => void): void {
  const fork = k.launch(anim, RELEASE[anim]);
  k.fx('fx-slingshot-launch', fork);
  k.shot(BULLET, fork, to, { speed: BULLET_SPEED, reveal: true, onArrive: then });
}

/** Volley's dark oval under the rain: its opacity (0 hides it), and its half-size (the area's 98×33 art, centred on the
 *  anchor): an enemy whose feet are inside is hit. The lob: up from the fork this far, this long, fading at the end. */
export const VOLLEY_AREA_ALPHA = 0.6;
const VOLLEY_RX = 49;
const VOLLEY_RY = 16;
const VOLLEY_LOB = { up: 70, ms: 200, fade: 80 };

const slingshot: Skill[] = [
  {
    name: 'Quick Shot',
    run(k) {
      const t = k.pose('attack-quick', [0, 1, 2, 3]);
      k.at(t[2], () => pebble(k, 'attack-quick', k.body(1), () => k.hit(1, { fx: 'fx-slingshot-hit' })));
    },
  },
  {
    name: 'Double Tap',
    run(k) {
      const t = k.pose('attack-quick', [0, 1, 2, 1, 2, 3]);
      k.at(t[2], () => pebble(k, 'attack-quick', k.body(1), () => k.hit(1, { fx: 'fx-slingshot-hit' })));
      k.at(t[4], () => pebble(k, 'attack-quick', k.body(1), () => k.hit(1, { fx: 'fx-slingshot-hit' })));
    },
  },
  {
    name: 'Pebble Spray',
    run(k) {
      const t = k.pose('attack-heavy', [0, 1, 2, 3, 4, 5]);
      // Three pebbles in the cone, one to each enemy in it.
      k.at(t[4], () => [0, 1, 2].forEach((n) => pebble(k, 'attack-heavy', k.body(n), () => k.hit(n, { fx: 'fx-slingshot-hit-small' }))));
    },
  },
  {
    name: 'Ricochet',
    run(k) {
      const t = k.pose('attack-quick', [0, 1, 2, 3]);
      k.at(t[2], () =>
        pebble(k, 'attack-quick', k.body(0), () => {
          k.hit(0, { fx: 'fx-slingshot-hit-small' });
          k.shot(BULLET, k.body(0), k.body(1), {
            speed: BULLET_SPEED,
            onArrive: () => {
              k.hit(1, { fx: 'fx-slingshot-hit-small' });
              k.shot(BULLET, k.body(1), k.body(2), { speed: BULLET_SPEED, onArrive: () => k.hit(2, { fx: 'fx-slingshot-hit' }) });
            },
          });
        }),
      );
    },
  },
  {
    name: 'Piercing Shot',
    run(k) {
      const t = k.pose('attack-heavy', [0, 1, 2, 3, 4, 5]);
      k.at(t[4], () => {
        const fork = k.launch('attack-heavy', 4);
        const end = toward(fork, k.body(2), dist(fork, k.body(2)) + 60); // to max range
        k.fx('fx-slingshot-launch', fork);
        k.shot(BULLET, fork, end, { speed: BULLET_SPEED * 1.4, reveal: true, fadeOut: 120 });
        // A spark on each enemy it passes through.
        [0, 1, 2].forEach((n) => k.at(t[4] + (dist(fork, k.body(n)) / (BULLET_SPEED * 1.4)) * 1000, () => k.hit(n, { fx: 'fx-slingshot-hit-pierce' })));
      });
    },
  },
  {
    name: 'Knee Shot',
    run(k) {
      const t = k.pose('attack-quick', [0, 1, 2, 3]);
      k.at(t[2], () =>
        pebble(k, 'attack-quick', k.body(1), () => {
          k.hit(1, { fx: 'fx-slingshot-hit-small' });
          k.fx('fx-slingshot-knee-ring', k.targets[1], { z: 0, frames: [0, 1, 2, 3, 0, 1, 2, 3] }); // the slow
        }),
      );
    },
  },
  {
    name: 'Volley',
    run(k) {
      // v2 (fx/slingshot): a pebble lobbed straight up from the fork, then the rain falls straight down on the aimed spot
      // (enemy 1's feet) over its dark oval: the same up close and far off, never mirrored. Its hits (frames 6, 11 and 16)
      // land on every enemy whose feet are inside the oval.
      const t = k.pose('attack-cast', [0, 1, 2, 3, 4, 5]);
      k.at(t[4], () => {
        const fork = k.launch('attack-cast', 4);
        k.fx('fx-slingshot-launch', fork);
        k.shot(BULLET, fork, { x: fork.x, y: fork.y - VOLLEY_LOB.up }, { speed: BULLET_SPEED, ms: VOLLEY_LOB.ms, ease: 'out', fadeEnd: VOLLEY_LOB.fade, upright: true });
      });
      const rain = t[4] + VOLLEY_LOB.ms - VOLLEY_LOB.fade; // as the lob starts fading
      const frame = 1000 / 25;
      k.at(rain, () => {
        const at = { x: k.targets[1].x, y: k.targets[1].y };
        k.fx('fx-slingshot-volley-area', at, { z: 0, upright: true, alpha: VOLLEY_AREA_ALPHA, frames: [0], ms: 24 * frame + 150, fadeOut: 150 });
        k.fx('fx-slingshot-volley', at, { upright: true });
        const inside = (p: Pt) => ((p.x - at.x) / VOLLEY_RX) ** 2 + ((p.y - at.y) / VOLLEY_RY) ** 2 <= 1;
        for (const f of [6, 11, 16]) k.at(rain + f * frame, () => [1, 2].forEach((n) => inside(k.targets[n]) && k.hit(n, { fx: 'fx-slingshot-hit-small' })));
      });
    },
  },
];

// ── Stick (fx/stick: wind) ──

const WAIST = -16; // the fighter's waist above the feet
const CHEST = -24;

const stick: Skill[] = [
  {
    name: 'Quick Jab',
    run(k) {
      const t = k.pose('attack-quick', [0, 1, 2, 3]);
      k.at(t[1], () => k.hit(0, { fx: 'fx-wind-hit' }));
    },
  },
  {
    name: 'Twin Strike',
    run(k) {
      const t = k.pose('attack-quick', [0, 1, 2, 0, 1, 2, 3]);
      k.at(t[1], () => k.hit(0, { fx: 'fx-wind-hit' }));
      k.at(t[4], () => k.hit(0, { fx: 'fx-wind-hit' }));
    },
  },
  {
    name: 'Low Sweep',
    run(k) {
      const t = k.pose('attack-cast', [0, 1, 2, 3, 4, 5, 6, 7, 8], [42, 42, 42, 42, 42, 42, 42, 42, 56]);
      k.at(t[0], () => {
        const at = k.self(0, WAIST + 12); // 12 px lower than the spin's: at the feet
        k.fx('fx-wind-swirl-back', at, { z: 1, life: t[8], fadeIn: 120, fadeOut: 250 });
        k.fx('fx-wind-swirl-front', at, { z: 3, life: t[8], fadeIn: 120, fadeOut: 250 });
      });
      k.at(t[3], () => k.hit(0, { fx: 'fx-wind-hit' })); // as the stick passes
    },
  },
  {
    name: 'Rising Swat',
    run(k) {
      const t = k.pose('attack-heavy', [0, 4, 3, 5], [83, 83, 260, 83]);
      k.at(t[1], () => k.fx('fx-wind-rise-se', k.self(0, CHEST - 6)));
      k.at(t[2], () => k.hit(0, { fx: 'fx-wind-hit' }));
    },
  },
  {
    name: 'Flurry',
    run(k) {
      const t = k.pose('attack-quick', [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 2, 3], [45, 45, 45, 45, 45, 45, 45, 45, 71, 71, 71, 71]);
      [1, 3, 5, 7].forEach((i) => k.at(t[i], () => k.hit(0, { fx: 'fx-wind-hit' })));
      k.at(t[9], () => k.hit(0, { fx: 'fx-wind-hit', kind: 'crit' })); // the 5th hits hardest
    },
  },
  {
    name: 'Spinning Stick',
    run(k) {
      const spin = [0, 1, 2, 3, 4, 5, 6, 7];
      const t = k.pose('attack-cast', [...spin, ...spin, 8]);
      k.at(t[0], () => {
        const at = k.self(0, WAIST);
        k.fx('fx-wind-swirl-back', at, { z: 1, life: t[16], fadeIn: 120, fadeOut: 250 });
        k.fx('fx-wind-swirl-front', at, { z: 3, life: t[16], fadeIn: 120, fadeOut: 250 });
      });
      k.at(t[3], () => k.hit(0, { fx: 'fx-wind-hit' }));
      k.at(t[11], () => k.hit(0, { fx: 'fx-wind-hit' }));
    },
  },
  {
    name: 'Lunge',
    run(k) {
      const t = k.pose('attack-quick', [0, 1, 2, 3], [71, 150, 120, 120]);
      k.at(t[1], () => k.move(SE.x * 56, SE.y * 56, 150)); // a dash of ~56 px
      k.at(t[2], () => k.hit(1, { fx: 'fx-wind-hit' })); // at the end of the dash
      k.at(t[3] + 120, () => k.move(0, 0, 240));
    },
  },
];

// ── Greatstick (fx/greatstick: crimson) ──

const greatstick: Skill[] = [
  {
    name: 'Quick Chop',
    run(k) {
      const t = k.pose('attack-quick', [0, 1, 2, 3]);
      k.at(t[1], () => k.hit(0, { fx: 'fx-crimson-hit' }));
    },
  },
  {
    name: 'Shove',
    run(k) {
      const t = k.pose('attack-cast', [6, 3, 3, 6], [71, 71, 200, 71]);
      k.at(t[1], () => {
        k.move(SE.x * 5, SE.y * 5, 70); // the body steps in
        k.hit(0, { fx: 'fx-crimson-hit' });
      });
      k.at(t[3], () => k.move(0, 0, 70));
    },
  },
  {
    name: 'Wide Swing',
    run(k) {
      const t = k.pose('attack-cast', [0, 1, 2, 3, 4, 5, 6]);
      k.at(t[1], () => k.fx('fx-crimson-cleave-se', k.self(0, CHEST)));
      k.at(t[3], () => k.hit(0, { fx: 'fx-crimson-hit' })); // as the arc reaches it
    },
  },
  {
    name: 'Overhead Slam',
    run(k) {
      const t = k.pose('attack-heavy', [0, 1, 2, 3, 4, 5, 6], [100, 100, 100, 100, 300, 100, 100]);
      k.at(t[4], () => {
        k.fx('fx-crimson-quake', k.self(22, 1), { z: 0 }); // where the plank end lands (SE: body cell 38,47)
        k.hit(0, { fx: 'fx-crimson-hit', kind: 'crit' });
      });
    },
  },
  {
    name: 'Ground Pound',
    run(k) {
      const t = k.pose('attack-heavy', [0, 1, 2, 3, 4, 5, 6], [100, 100, 100, 100, 380, 100, 100]);
      k.at(t[4], () => k.fx('fx-crimson-quake', k.self(0, 0), { z: 0 }));
      k.at(t[4] + 120, () => k.hit(0, { fx: 'fx-crimson-hit' })); // as the cracks reach them
      k.at(t[4] + 330, () => k.hit(1, { fx: 'fx-crimson-hit' }));
    },
  },
  {
    name: 'Plank Toss',
    run(k) {
      const hands = (): Pt => k.self(12, -8); // body cell 28,38
      const out = (dist(hands(), k.body(1)) / 300) * 1000;
      const t = k.pose('attack-quick', [0, 1, 2, 3], [83, 83, out * 2 + 60, 83]);
      k.at(t[1], () => {
        k.hide('greatstick', true);
        k.shot('fx-greatstick-plank-spin', hands(), k.body(1), {
          speed: 300,
          arc: 8,
          turn: false,
          onArrive: () => {
            k.hit(1, { fx: 'fx-crimson-hit' });
            k.shot('fx-greatstick-plank-spin', k.body(1), hands(), { speed: 300, arc: 8, turn: false, onArrive: () => k.hide('greatstick', false) });
          },
        });
      });
    },
  },
  {
    name: 'Splinter Burst',
    run(k) {
      const t = k.pose('attack-quick', [0, 1, 2, 3], [83, 83, 360, 83]);
      k.at(t[1], () => {
        const from = k.self(18, 0); // the plank end (body cell 34,46)
        const facing = Math.atan2(SE.y, SE.x);
        for (let i = 0; i < 9; i++) {
          const a = facing + ((i - 4) / 4) * ((26 * Math.PI) / 180); // a 52° cone
          const to = { x: from.x + Math.cos(a) * 110, y: from.y + Math.sin(a) * 110 };
          k.shot('fx-greatstick-splinter', from, to, { speed: 240, fadeOut: 120 });
        }
        [0, 1].forEach((n) => k.at(t[1] + (dist(from, k.body(n)) / 240) * 1000, () => k.hit(n, { fx: 'fx-crimson-hit' })));
      });
    },
  },
];

// ── Broom (fx/broom; the bristle tip and the free palm from launch.json) ──

const broom: Skill[] = [
  {
    name: 'Dust Flick',
    run(k) {
      const t = k.pose('attack-quick', [0, 1, 2, 3]);
      k.at(t[1], () => {
        const palm = k.launch('attack-quick', 1, 'palm');
        k.fx('fx-broom-dust-launch', palm);
        k.shot('fx-broom-dust-bolt', palm, k.body(1), { speed: 300, onArrive: () => k.hit(1, { fx: 'fx-broom-dust-hit' }) });
      });
    },
  },
  {
    name: 'Leaf Dart',
    run(k) {
      const t = k.pose('attack-quick', [0, 1, 2, 3]);
      k.at(t[1], () => {
        const palm = k.launch('attack-quick', 1, 'palm');
        k.fx('fx-broom-leaf-launch', palm);
        k.shot('fx-broom-leaf-bolt', palm, k.body(1), { speed: 340, onArrive: () => k.hit(1, { fx: 'fx-broom-leaf-hit' }) });
      });
    },
  },
  {
    name: 'Gust',
    run(k) {
      const t = k.pose('attack-heavy', [0, 1, 2, 3, 4, 5]);
      k.at(t[3], () => {
        const tip = k.launch('attack-heavy', 3, 'tip');
        k.fx('fx-broom-gust-launch', tip);
        const stop = toward(tip, k.body(1), 52);
        k.shot('fx-broom-gust-orb', tip, stop, {
          speed: 200,
          turn: false,
          onArrive: () => {
            k.fx('fx-broom-gust-cone', stop, { angle: angle(tip, k.body(1)) });
            [1, 2].forEach((n) => k.hit(n)); // everything in the cone
          },
        });
      });
    },
  },
  {
    name: 'Spark Sweep',
    run(k) {
      const t = k.pose('attack-cast', [0, 1, 2, 3, 4, 5]);
      const arcMs = 1000 / 16;
      k.at(t[1], () => k.fx('fx-broom-spark-arc-se', ahead(k, k.self(0, CHEST), 16)));
      k.at(t[1] + arcMs * 3, () => k.hit(0)); // as the spark runs down the arc
      k.at(t[1] + arcMs * 5, () => k.hit(0));
    },
  },
  {
    name: 'Dust Devil',
    run(k) {
      const t = k.pose('attack-cast', [0, 1, 2, 3, 4, 5]);
      k.at(t[2], () => {
        const from = ahead(k, k.self(0, 0), 18);
        const to = ahead(k, k.targets[2], 14);
        const speed = 75;
        // Rises (0-1), whirls (2-9) as it travels, fades (10-11) where it stops.
        k.shot('fx-broom-dust-devil', from, to, {
          speed,
          turn: false,
          fx: { hold: { from: 2, to: 9, until: Infinity } },
          onArrive: () => k.fx('fx-broom-dust-devil', to, { frames: [10, 11] }),
        });
        [0, 1, 2].forEach((n) => k.at(t[2] + (dist(from, k.targets[n]) / speed) * 1000, () => k.hit(n)));
      });
    },
  },
  {
    name: 'Ember Leaves',
    run(k) {
      const t = k.pose('attack-heavy', [0, 1, 2, 3, 4, 5]);
      k.at(t[3], () => {
        const tip = k.launch('attack-heavy', 3, 'tip');
        k.fx('fx-broom-ember-launch', tip);
        k.shot('fx-broom-ember-swarm', tip, k.body(1), {
          speed: 200,
          onArrive: () => {
            k.fx('fx-broom-ember-burn', k.targets[1], { z: 1, hold: { from: 1, to: 2, until: 1500 }, fadeOut: 250 });
            k.hit(1);
            const start = t[3] + (dist(tip, k.body(1)) / 200) * 1000;
            [1, 2, 3].forEach((i) => k.at(start + i * 420, () => k.number({ x: k.body(1).x + 8, y: k.body(1).y }, 'dot')));
          },
        });
      });
    },
  },
  {
    name: 'Static Bristles',
    run(k) {
      const t = k.pose('attack-heavy', [0, 1, 2, 3, 4, 5]);
      k.at(t[3], () => {
        const tip = k.launch('attack-heavy', 3, 'tip');
        k.fx('fx-broom-chain-spark', tip);
        const links: Pt[] = [tip, k.body(0), k.body(1), k.body(2)];
        for (let i = 0; i < 3; i++) {
          k.at(t[3] + i * 110, () => {
            const a = links[i];
            const b = links[i + 1];
            k.fx('fx-broom-chain-bolt', a, { angle: angle(a, b), length: dist(a, b), life: 220, fadeOut: 100 });
            k.fx('fx-broom-chain-spark', b);
            k.hit(i);
          });
        }
      });
    },
  },
];

// ── Pot lid (fx/potlid; the lid centre and the ladle bowl from launch.json) ──

const LID = 'char-weapon-lid'; // the lid's layers (front and back), hidden while it flies

/** Boiling Splash: its target (enemy 2, as before), the drops' flight (px a second, at least this long, this high in the
 *  middle, a quarter turn this often) and how long the puddle lies there before fading. */
const BOIL_AT = 2;
const BOIL = { speed: 260, minMs: 250, arc: 40, quarterMs: 120, puddleMs: 1200 };

const potlid: Skill[] = [
  {
    name: 'Lid Bonk',
    run(k) {
      const t = k.pose('attack-quick', [0, 1, 2, 3]);
      k.at(t[1], () => k.hit(0, { fx: 'fx-potlid-hit' }));
    },
  },
  {
    name: 'Ladle Smack',
    run(k) {
      const t = k.pose('attack-heavy', [0, 1, 2, 3, 4, 5]);
      k.at(t[3], () => k.hit(0, { fx: 'fx-potlid-hit' }));
    },
  },
  {
    name: 'Clang',
    run(k) {
      const t = k.pose('attack-cast', [0, 1, 2, 3, 4, 5]);
      k.at(t[1], () => {
        const lid = k.launch('attack-cast', 1, 'lid');
        k.fx('fx-potlid-clang-waves', lid);
        // Hit as the outer ring (growing ~5 px a frame at 16 fps) reaches each.
        [0, 1].forEach((n) => k.at(t[1] + (dist(lid, k.body(n)) / 5) * (1000 / 16), () => k.hit(n)));
      });
    },
  },
  {
    name: 'Lid Toss',
    run(k) {
      const out = (dist(k.self(12, -12), k.body(1)) / 240) * 1000;
      const t = k.pose('attack-quick', [0, 1, 2, 3], [83, 83, out * 2 + 80, 83]);
      k.at(t[1], () => {
        const lid = k.launch('attack-quick', 1, 'lid');
        k.hide(LID, true);
        k.shot('fx-potlid-lid-spin', lid, k.body(1), {
          speed: 240,
          turn: false,
          onArrive: () => {
            k.hit(1, { fx: 'fx-potlid-hit' });
            k.shot('fx-potlid-lid-spin', k.body(1), lid, { speed: 240, turn: false, onArrive: () => k.hide(LID, false) });
          },
        });
      });
    },
  },
  {
    name: 'Steam Burst',
    run(k) {
      const gather = 8 * (1000 / 12); // steam frames 0-7, with the cast's frame 0 held
      const t = k.pose('attack-cast', [0, 1, 2, 3, 4, 5], [gather, 83, 83, 83, 83, 83]);
      k.at(t[0], () => {
        k.fx('fx-potlid-steam-burst-back', k.self(0, 0), { z: 1 });
        k.fx('fx-potlid-steam-burst-front', k.self(0, 0), { z: 3 });
      });
      k.at(gather + 30, () => k.hit(0)); // the ring bursts out from steam frame 8
      k.at(gather + 180, () => k.hit(1));
    },
  },
  {
    name: 'Boiling Splash',
    run(k) {
      // v2 (fx/potlid boil-*): the bonk flings a cluster of boiling drops from the lid in an arc to the target's feet,
      // turning a quarter every 120 ms (never stretched, mirrored or trailed); it bursts into a splash there (the hit on its
      // frame 1), and from frame 8 a burning puddle lies under everyone: 3 burn ticks, 300 ms apart.
      const t = k.pose('attack-quick', [0, 1, 2, 3], [83, 83, 400, 83]);
      k.at(t[1], () => {
        const lid = k.launch('attack-quick', 1, 'lid');
        const feet = { x: k.targets[BOIL_AT].x, y: k.targets[BOIL_AT].y };
        const fly = Math.max(BOIL.minMs, (dist(lid, feet) / BOIL.speed) * 1000);
        k.shot('fx-potlid-boil-drops', lid, feet, { speed: BOIL.speed, ms: fly, arc: BOIL.arc, turn: false, quarterTurnMs: BOIL.quarterMs, upright: true });
        const land = t[1] + fly;
        const frame = 1000 / 14;
        k.at(land, () => k.fx('fx-potlid-boil-splash', k.targets[BOIL_AT], { upright: true }));
        k.at(land + frame, () => k.hit(BOIL_AT));
        k.at(land + frame * 8, () => k.fx('fx-potlid-boil-puddle', k.targets[BOIL_AT], { z: 0, upright: true, life: BOIL.puddleMs + 200, fadeOut: 200 }));
        [1, 2, 3].forEach((i) => k.at(land + frame + i * 300, () => k.number({ x: k.body(BOIL_AT).x + 8, y: k.body(BOIL_AT).y }, 'dot')));
      });
    },
  },
  {
    name: 'Rebound',
    run(k) {
      const t = k.pose('attack-quick', [0, 1, 2, 3], [83, 83, 1300, 83]);
      k.at(t[1], () => {
        const lid = k.launch('attack-quick', 1, 'lid');
        k.hide(LID, true);
        const stops = [lid, k.body(0), k.body(1), k.body(2), lid];
        const leg = (i: number) => {
          k.shot('fx-potlid-lid-spin', stops[i], stops[i + 1], {
            speed: 260,
            turn: false,
            onArrive: () => {
              if (i < 3) k.hit(i, { fx: 'fx-potlid-hit' });
              if (i + 2 < stops.length) leg(i + 1);
              else k.hide(LID, false);
            },
          });
        };
        leg(0);
      });
    },
  },
];

// ── Hilot (fx/hilot; the right palm and the balm from launch.json) ──

const hilot: Skill[] = [
  {
    name: 'Menthol Flick',
    run(k) {
      const t = k.pose('attack-quick', [0, 1, 2, 3]);
      k.at(t[1], () => {
        const palm = k.launch('attack-quick', 1, 'palm');
        k.fx('fx-hilot-flick-launch', palm, { angle: angle(palm, k.body(1)) });
        k.shot('fx-hilot-flick-bolt', palm, k.body(1), { speed: 300, onArrive: () => k.hit(1, { fx: 'fx-hilot-hit' }) });
      });
    },
  },
  {
    name: 'Herb Pinch',
    run(k) {
      const t = k.pose('attack-quick', [0, 1, 2, 3]);
      k.at(t[1], () => {
        const palm = k.launch('attack-quick', 1, 'palm');
        k.fx('fx-hilot-jab', palm, { angle: angle(palm, k.body(0)) });
      });
      k.at(t[1] + 2 * (1000 / 16), () => k.hit(0, { fx: 'fx-hilot-hit' })); // two streak frames later
    },
  },
  {
    name: 'Menthol Puff',
    run(k) {
      const t = k.pose('attack-cast', [0, 1, 2, 3, 4, 5]);
      k.at(t[3], () => {
        k.fx('fx-hilot-puff', ahead(k, k.self(0, 0), 30), { z: 1 }); // ~30 px ahead, on the ground
        k.hit(0, { fx: 'fx-hilot-hit' });
      });
    },
  },
  {
    name: 'Stinging Rub',
    run(k) {
      const t = k.pose('attack-heavy', [0, 1, 2, 3, 4, 5]);
      k.at(t[2], () => {
        const palm = k.launch('attack-heavy', 2, 'palm');
        k.fx('fx-hilot-jab', palm, { angle: angle(palm, k.body(0)) });
      });
      k.at(t[2] + 125, () => {
        k.hit(0, { fx: 'fx-hilot-hit' });
        const sting = k.fx('fx-hilot-sting', k.targets[0], { z: 3, fadeIn: 120 });
        [1, 2, 3].forEach((i) => k.at(t[2] + 125 + i * 380, () => k.number({ x: k.body(0).x + 8, y: k.body(0).y }, 'mint')));
        k.at(t[2] + 125 + 3 * 380 + 100, () => sting.kill(250));
      });
    },
  },
  {
    name: 'Root Snare',
    run(k) {
      const t = k.pose('attack-cast', [0, 1, 2, 3, 4, 5]);
      k.at(t[3] + 120, () => {
        const hold = { from: 4, to: 10, until: 1500 }; // grows, held ~1.5 s, fades
        k.fx('fx-hilot-root-back', k.targets[1], { z: 1, hold });
        k.fx('fx-hilot-root-front', k.targets[1], { z: 3, hold });
      });
      k.at(t[3] + 120 + 3 * (1000 / 12), () => k.hit(1, { fx: 'fx-hilot-hit' })); // on root frame 3
    },
  },
  {
    name: 'Camphor Cloud',
    run(k) {
      const t = k.pose('attack-cast', [0, 1, 2, 3, 4, 5]);
      // Three puffs staggered over the pack (0-4, then 3-4 looped while it lingers ~1.5 s, then 5-6).
      [0, 1, 2].forEach((n, i) => k.at(t[3] + i * 120, () => k.fx('fx-hilot-puff', k.targets[n], { z: 1, hold: { from: 3, to: 4, until: 1500 } })));
      k.at(t[3] + 200, () => [0, 1, 2].forEach((n) => k.hit(n, { fx: 'fx-hilot-hit' })));
      for (let i = 1; i <= 4; i++) k.at(t[3] + 200 + i * 380, () => [0, 1, 2].forEach((n) => k.number({ x: k.body(n).x + 8, y: k.body(n).y }, 'mint')));
    },
  },
  {
    name: 'Hot Compress',
    run(k) {
      const t = k.pose('attack-heavy', [0, 1, 2, 3, 4, 5]);
      k.at(t[2], () => {
        const palm = k.launch('attack-heavy', 2, 'palm');
        k.fx('fx-hilot-jab', palm, { angle: angle(palm, k.body(0)) });
      });
      k.at(t[2] + 125, () => {
        // The heat ring instead of the mint hit, then the burn: 5 ticks.
        k.fx('fx-hilot-compress-back', k.targets[0], { z: 1 });
        k.fx('fx-hilot-compress-front', k.targets[0], { z: 3 });
        k.hit(0);
        const burn = k.fx('fx-hilot-burn', k.targets[0], { z: 3, fadeIn: 150 });
        for (let i = 1; i <= 5; i++) k.at(t[2] + 125 + i * 380, () => k.number({ x: k.body(0).x + 8, y: k.body(0).y }, 'dot'));
        k.at(t[2] + 125 + 5 * 380 + 100, () => burn.kill(250));
      });
    },
  },
];

// ── Mobility: Dash (every class, Lv 5) and the class's Lv 8 move (characters/classes/mobility-README.md) ──
// The sheets never travel sideways: the stage moves the fighter along the facing. After a move the fighter stands in
// walk-ready ~0.3 s, then fades out and back in at the start spot (~0.3 s) before the next skill.

const TILE = { x: 16, y: 8 }; // one tile toward SE
// The art folder's fx/mobility-buff: the dust kicked back (drawn for a move going east: flipped going west), each
// class's Blink pair and Charge wedge.
const DUST = 'fx-mobility-dust';
const tiles = (n: number) => ({ x: TILE.x * n, y: TILE.y * n });

/** Back to the start spot: walk-ready a moment, then out and in again there. */
function homeAfter(k: SkillKit, end: number): void {
  k.at(end + 300, () => k.fade(0, 150));
  k.at(end + 450, () => {
    k.move(0, 0, 0);
    k.fade(1, 150);
  });
}

// ── The Lv 21-40 damage skills (combat-guide.md "Lv 21-40 skills"; the art folder's docs/skills-21-40): each plays the
// class's attack-quick, attack-heavy or attack-cast (Timber! starts on charge-start) in its own frame order, so every
// cosmetic pose sheet still fits. Their FX are the art folder's fx/<class> (its _sheets_lv21-40.csv: anchors, layers and
// the frame each hit lands on); a split one plays its `-back` half on the ground and its `-front` half over everyone, at
// one anchor and time. `null` in a pose's ms list: the anim's own frame time.

const SEED = '#84CC16'; // Seed Barrage's pebbles
const PHANTOM = '#A3E635'; // Phantom Sticks' afterimages
const AMBER = '#F59E0B'; // Hot Oil's drops

/** When frame n of a sheet at `fps` starts (ms): where its art lands a hit. */
const frameAt = (n: number, fps: number) => (n * 1000) / fps;

/** The far end of a line skill: past the far enemy by `tilesPast` tiles. */
const lineEnd = (k: SkillKit, from: Pt, tilesPast = 1): Pt => toward(from, k.body(2), dist(from, k.body(2)) + tilesPast * 18);

/** A split FX at a point: its back half on the ground, its front half over everyone. */
function pair(k: SkillKit, name: string, at: Pt, o: FxOpts = {}): void {
  k.fx(`${name}-back`, at, { ...o, z: 0 });
  k.fx(`${name}-front`, at, { ...o, z: 3 });
}

/** `ticks` damage-over-time numbers on enemy n, `every` ms apart from `from` ms: a looping FX over it meanwhile, or one
 *  played on each tick (`tickFx`, a few px under its body). */
function ticking(k: SkillKit, n: number, from: number, ticks: number, every: number, fx?: string, o: FxOpts = {}, tickFx?: string): void {
  k.at(from, () => {
    const on = fx ? k.fx(fx, k.targets[n], { z: 3, fadeIn: 120, ...o }) : null;
    for (let i = 1; i <= ticks; i++)
      k.at(from + i * every, () => {
        if (tickFx) k.fx(tickFx, { x: k.body(n).x, y: k.body(n).y + 3 });
        k.number({ x: k.body(n).x + 8, y: k.body(n).y }, 'dot');
      });
    k.at(from + ticks * every + 100, () => on?.kill(250));
  });
}

/** The stage's stun stars on enemy n for `ms` (in the world the mob shows its own: world/mobs.ts). */
const stars = (k: SkillKit, n: number, ms: number) => k.preview && k.fx('fx-stun-stars', { x: k.body(n).x, y: k.body(n).y - 12 }, { life: ms, fadeOut: 150 });
/** The stage's taunt mark over enemy n for `ms` (in the world the mob shows its own). */
const taunted = (k: SkillKit, n: number, ms: number) => k.preview && k.fx('fx-taunt-mark', { x: k.body(n).x, y: k.body(n).y - 22 }, { life: ms, fadeOut: 200 });

const slingshotLate: Skill[] = [
  {
    name: 'Headshot',
    run(k) {
      const t = k.pose('attack-heavy', [0, 1, 2, 3, 4, 5], [null, null, null, 250, null, null]);
      k.at(t[4], () => {
        const fork = k.launch('attack-heavy', 4);
        k.fx('fx-slingshot-launch', fork);
        k.shot(BULLET, fork, k.body(1), { speed: 600, reveal: true, onArrive: () => k.hit(1, { fx: 'fx-slingshot-crit-star', kind: 'crit' }) });
      });
    },
  },
  {
    name: 'Burst Marble',
    run(k) {
      // The marble flies (turned to its flight, 260 px/s) and bursts at the target's feet, the hits on the burst's frame 1.
      const t = k.pose('attack-heavy', [0, 1, 2, 3, 4, 5]);
      const fly = (dist(k.launch('attack-heavy', 4), k.body(1)) / 260) * 1000;
      k.at(t[4], () => {
        const fork = k.launch('attack-heavy', 4);
        k.fx('fx-slingshot-launch', fork);
        k.shot('fx-slingshot-marble', fork, k.body(1), { speed: 260, reveal: true });
      });
      k.at(t[4] + fly, () => {
        k.fx('fx-slingshot-marble-burst', k.targets[1]);
        k.fx('fx-slingshot-marble-burst-ground', k.targets[1], { z: 0 });
      });
      k.at(t[4] + fly + frameAt(1, 14), () => {
        k.hit(1);
        [0, 2].forEach((n) => k.hit(n, { fx: 'fx-slingshot-hit-small' })); // the rest in the burst
      });
    },
  },
  {
    name: 'Seed Barrage',
    run(k) {
      // Six shots, 150 ms apart: quick 0,1, then 2,1 five times, then 2,3.
      const frames = [0, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 3];
      const t = k.pose('attack-quick', frames, [null, null, ...Array(11).fill(75), null]);
      frames.forEach((f, i) => {
        if (f !== 2) return;
        k.at(t[i], () => {
          const fork = k.launch('attack-quick', 2);
          k.shot(BULLET, fork, k.body(1), { speed: BULLET_SPEED * 1.3, reveal: true, fx: { tint: SEED }, onArrive: () => k.hit(1, { fx: 'fx-slingshot-hit-small' }) });
        });
      });
    },
  },
  {
    name: 'Long Pull',
    run(k) {
      // Held to full (1.5 s) on the stage: heavy 0-2, 3 held while charging, then 4, 5. In the world the hold came first
      // (TownScene's charge-up: the pose to 3, the charge at the fork, the bar), so it plays on from 3.
      const hold = k.preview ? 1500 : 0;
      const t = k.preview ? k.pose('attack-heavy', [0, 1, 2, 3, 4, 5], [null, null, null, hold, null, null]) : [0, 0, 0, ...k.pose('attack-heavy', [3, 4, 5])];
      if (hold) {
        k.at(t[3], () => k.fx('fx-slingshot-charge', k.launch('attack-heavy', 3), { life: hold }));
        k.at(t[3] + hold - frameAt(7, 14), () => k.fx('fx-slingshot-charge-full', k.launch('attack-heavy', 3))); // (ending as it's let go)
      }
      k.at(t[4], () => {
        const fork = k.launch('attack-heavy', 4);
        const end = lineEnd(k, fork, 2);
        const speed = BULLET_SPEED * 1.6;
        k.fx('fx-slingshot-launch', fork);
        k.shot('fx-slingshot-pebble-pierce', fork, end, { speed, reveal: true, fadeOut: 120 });
        [0, 1, 2].forEach((n) => k.at(t[4] + (dist(fork, k.body(n)) / speed) * 1000, () => k.hit(n, { fx: 'fx-slingshot-hit-pierce' })));
      });
    },
  },
  {
    name: 'Hailstorm',
    run(k) {
      // As Volley: a pebble lobbed up, then the hail and its ring on the area, hits on the rain's frames 5, 11 and 17.
      const t = k.pose('attack-cast', [0, 1, 2, 3, 4, 5]);
      k.at(t[4], () => {
        const fork = k.launch('attack-cast', 4);
        k.fx('fx-slingshot-launch', fork);
        k.shot(BULLET, fork, { x: fork.x, y: fork.y - VOLLEY_LOB.up }, { speed: BULLET_SPEED, ms: VOLLEY_LOB.ms, ease: 'out', fadeEnd: VOLLEY_LOB.fade, upright: true });
      });
      const rain = t[4] + VOLLEY_LOB.ms - VOLLEY_LOB.fade;
      k.at(rain, () => {
        const at = { x: k.targets[1].x, y: k.targets[1].y };
        k.fx('fx-slingshot-hail', at, { upright: true });
        k.fx('fx-slingshot-hail-ring', at, { z: 0, upright: true });
      });
      [5, 11, 17].forEach((f, i) =>
        k.at(rain + frameAt(f, 16), () =>
          [0, 1, 2].forEach((n) => {
            k.hit(n, { fx: 'fx-slingshot-hit-small' });
            if (i === 0) k.fx('fx-slingshot-knee-ring', k.targets[n], { z: 0, frames: [0, 1, 2, 3, 0, 1, 2, 3] }); // the slow
          }),
        ),
      );
    },
  },
  {
    name: 'Homing Pebbles',
    run(k) {
      const t = k.pose('attack-heavy', [0, 1, 2, 3, 4, 5], [null, null, null, null, 240, null]);
      // Three, 80 ms apart, on bowed curves (alternate sides): the target, then the nearest others.
      [1, 0, 2].forEach((n, i) =>
        k.at(t[4] + i * 80, () => {
          const fork = k.launch('attack-heavy', 4);
          k.shot('fx-slingshot-homing', fork, k.body(n), { speed: 220, minMs: 260, arc: i % 2 ? -16 : 16, turn: false, onArrive: () => k.hit(n, { fx: 'fx-slingshot-hit-small' }) });
        }),
      );
    },
  },
];

const stickLate: Skill[] = [
  {
    name: 'Crosscut',
    run(k) {
      // The X on the target with the first impact; its two cuts land on its frames 1 and 3.
      const t = k.pose('attack-heavy', [0, 1, 2, 3, 4, 3, 4, 5]);
      k.at(t[4], () => k.fx('fx-stick-crosscut', k.body(0)));
      [1, 3].forEach((f) => k.at(t[4] + frameAt(f, 16), () => k.hit(0, { fx: 'fx-wind-hit' })));
    },
  },
  {
    name: 'Thunder Tap',
    run(k) {
      const t = k.pose('attack-quick', [0, 1, 2, 3], [null, null, 200, null]);
      k.at(t[2], () => k.fx('fx-stick-thunder-hit', k.targets[0]));
      k.at(t[2] + frameAt(2, 16), () => {
        k.hit(0);
        stars(k, 0, 1200);
      });
    },
  },
  {
    name: 'Whirlwind',
    run(k) {
      // Spinning for 2 s (the cast's 0-7 looped), then its last frame; four hits 500 ms apart round the fighter.
      const spin = [0, 1, 2, 3, 4, 5, 6, 7];
      const turns = 6;
      const t = k.pose('attack-cast', [...Array(turns).fill(spin).flat(), 8], [...Array(turns * 8).fill(42), 56]);
      const end = t[turns * 8];
      k.at(t[0], () => {
        const at = k.self(0, WAIST);
        k.fx('fx-wind-swirl-back', at, { z: 1, life: end, fadeIn: 120, fadeOut: 250 });
        k.fx('fx-wind-swirl-front', at, { z: 3, life: end, fadeIn: 120, fadeOut: 250 });
      });
      [0, 500, 1000, 1500].forEach((d) => k.at(t[0] + 120 + d, () => k.hit(0, { fx: 'fx-wind-hit' })));
    },
  },
  {
    name: 'Hundred Hits',
    run(k) {
      // quick 1,2 ten times, 90 ms a frame: a hit on each 2; the flurry looping between the fighter and the target.
      const frames = [...Array(10).fill([1, 2]).flat(), 3];
      const t = k.pose('attack-quick', frames, [...Array(20).fill(90), null]);
      k.at(t[0], () => {
        const from = k.self(0, CHEST + 6);
        const to = k.body(0);
        k.fx('fx-stick-flurry', { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, { angle: angle(from, to), life: t[20], fadeOut: 120 });
      });
      frames.forEach((f, i) => f === 2 && i < 20 && k.at(t[i], () => k.hit(0, { fx: 'fx-wind-hit' })));
    },
  },
  {
    name: 'Shatter Strike',
    run(k) {
      const t = k.pose('attack-heavy', [0, 1, 2, 3, 4, 5], [null, null, null, null, 260, null]);
      k.at(t[4], () => {
        k.fx('fx-stick-shatter-impact', k.targets[0]);
        k.fx('fx-stick-shatter-ring', k.targets[0], { z: 0 });
        k.hit(0);
      });
      k.at(t[4] + 160, () => k.hit(1, { fx: 'fx-wind-hit' })); // the ring reaching the next one
    },
  },
  {
    name: 'Phantom Sticks',
    run(k) {
      // Two lime afterimages one tile to each side of the facing (SW and NE of it), 100 and 200 ms behind, each dissolving
      // where it ends.
      const t = k.pose('attack-heavy', [0, 1, 2, 3, 4, 5]);
      const end = t[5] + 80;
      k.echo(-16, 8, 100, end, PHANTOM, 0.5);
      k.echo(16, -8, 200, end, PHANTOM, 0.5);
      [0, 100, 200].forEach((d) => k.at(t[4] + d, () => k.hit(0, { fx: 'fx-wind-hit' })));
      k.at(end + 100, () => k.fx('fx-stick-phantom-fade', k.self(-16, 8)));
      k.at(end + 200, () => k.fx('fx-stick-phantom-fade', k.self(16, -8)));
    },
  },
];

const greatstickLate: Skill[] = [
  {
    name: 'Cleave',
    run(k) {
      const t = k.pose('attack-cast', [0, 1, 2, 3, 4, 5, 6]);
      k.at(t[2], () => k.fx('fx-crimson-cleave-se', k.self(0, CHEST), { scale: 1.6 }));
      k.at(t[3], () => [0, 1].forEach((n) => k.hit(n, { fx: 'fx-crimson-hit' })));
    },
  },
  {
    name: 'Earthshaker',
    run(k) {
      const t = k.pose('attack-heavy', [0, 1, 2, 3, 4, 5, 6], [null, null, null, null, 300, null, null]);
      k.at(t[4], () => {
        // Cracks every half tile along the line from the plank's tip, 40 ms apart.
        const from = k.self(22, 1);
        const half = { x: 8, y: 4 };
        for (let i = 0; i < 12; i++) k.at(t[4] + i * 40, () => k.fx('fx-greatstick-quake-crack', { x: from.x + half.x * i, y: from.y + half.y * i }, { z: 0 }));
        [0, 1, 2].forEach((n) => k.at(t[4] + Math.max(0, dist(from, k.targets[n]) / Math.hypot(half.x, half.y)) * 40, () => k.hit(n, { fx: 'fx-crimson-hit' })));
      });
    },
  },
  {
    name: 'Cyclone',
    run(k) {
      // Three turns (350 ms each), a hit each, the ring round the fighter for all three.
      const turn = 350 / 3;
      const t = k.pose('attack-cast', [0, 1, 2, 3, 1, 2, 3, 1, 2, 3, 4, 5, 6], [null, ...Array(9).fill(turn), null, null, null]);
      k.at(t[1], () => pair(k, 'fx-greatstick-cyclone', k.self(0, 0), { life: 3 * 350, fadeOut: 150 }));
      [1, 4, 7].forEach((i) => k.at(t[i], () => k.hit(0, { fx: 'fx-crimson-hit' })));
    },
  },
  {
    name: 'Nail Driver',
    run(k) {
      const t = k.pose('attack-heavy', [0, 1, 2, 3, 4, 5, 6], [null, null, null, null, 260, null, null]);
      k.at(t[4], () => k.hit(0, { fx: 'fx-crimson-hit' }));
      ticking(k, 0, t[4], 4, 500, undefined, {}, 'fx-greatstick-bleed'); // Bleeds 4 × 15%
    },
  },
  {
    name: 'Timber!',
    run(k) {
      // charge-start 0,1, then heavy 2,3 while it arcs onto enemy 1 (300 ms, 24 px up), the slam on 4. The plank falls
      // there meanwhile (its fall over everyone, its crater on the ground), the hit on its frame 5.
      k.pose('charge-start', [0, 1]);
      const t = k.pose('attack-heavy', [2, 3, 4, 5, 6], [150, 150, 300, null, null]);
      k.at(t[0], () => {
        k.leap(1, 300, 24);
        k.fx('fx-greatstick-timber-fall', k.targets[1]);
        k.fx('fx-greatstick-timber-slam', k.targets[1], { z: 0 });
      });
      k.at(t[0] + frameAt(5, 16), () => [1, 0, 2].forEach((n) => k.hit(n, { fx: 'fx-crimson-hit' })));
      homeAfter(k, t[4] + 100);
    },
  },
  {
    name: 'Avalanche',
    run(k) {
      // heavy 2,3,4 three times (350 ms a slam), then 5,6.
      const slam = 350 / 3;
      const t = k.pose('attack-heavy', [2, 3, 4, 2, 3, 4, 2, 3, 4, 5, 6], [...Array(9).fill(slam), null, null]);
      [2, 5, 8].forEach((i) =>
        k.at(t[i], () => {
          const at = k.self(22, 1);
          k.fx('fx-crimson-quake', at, { z: 0 });
          for (let s = 0; s < 4; s++) {
            const a = Math.atan2(SE.y, SE.x) + ((s - 1.5) / 1.5) * 0.5;
            k.shot('fx-greatstick-splinter', at, { x: at.x + Math.cos(a) * 46, y: at.y + Math.sin(a) * 46 }, { speed: 220, fadeOut: 100 });
          }
          [0, 1].forEach((n) => k.hit(n, { fx: 'fx-crimson-hit' }));
        }),
      );
    },
  },
];

const broomLate: Skill[] = [
  {
    name: 'Moonbeam',
    run(k) {
      // The beam from above with its small ring and the crescent on the ground, the hit on its frame 5 (the flash).
      const t = k.pose('attack-heavy', [0, 1, 2, 3, 4, 5], [null, null, null, 200, null, null]);
      k.at(t[3], () => {
        k.fx('fx-broom-moonbeam', k.targets[1]);
        k.fx('fx-broom-moonbeam-ring', k.targets[1], { z: 0 });
        k.fx('fx-broom-moonbeam-ground', k.targets[1], { z: 0 });
      });
      k.at(t[3] + frameAt(5, 12), () => k.hit(1));
    },
  },
  {
    name: 'Leaf Storm',
    run(k) {
      const t = k.pose('attack-cast', [0, 1, 2, 3, 4, 5]);
      k.at(t[2], () => pair(k, 'fx-broom-leaf-storm', k.targets[1], { life: 900, fadeOut: 150 }));
      [0, 300, 600].forEach((d) => k.at(t[3] + d, () => [0, 1, 2].forEach((n) => k.hit(n, { fx: 'fx-broom-leaf-hit' }))));
    },
  },
  {
    name: 'Firefly Swarm',
    run(k) {
      const t = k.pose('attack-heavy', [0, 1, 2, 3, 4, 5]);
      // Five from the palm on 3, 60 ms apart, wobbling to their mobs: the target, then the nearest others, round again.
      [1, 0, 2, 1, 0].forEach((n, i) =>
        k.at(t[3] + i * 60, () => {
          const palm = k.launch('attack-heavy', 3, 'palm');
          k.shot('fx-broom-firefly', palm, k.body(n), { speed: 180, minMs: 220, arc: [10, -8, 14, -12, 6][i], turn: false, onArrive: () => k.hit(n, { fx: 'fx-broom-firefly-pop' }) });
        }),
      );
    },
  },
  {
    name: 'Starfall',
    run(k) {
      const t = k.pose('attack-heavy', [0, 1, 2, 3, 4, 5], [null, null, null, 400, null, null]);
      // Three waves (350 ms apart) of two or three stars, each falling from about 3 tiles up-left onto its spot; its ring
      // and sparkles where it lands, the hit as it does.
      const spots = [[-10, 2], [12, -3], [2, 6]];
      [0, 350, 700].forEach((d, w) =>
        k.at(t[3] + d, () =>
          spots.slice(0, w === 1 ? 2 : 3).forEach(([dx, dy], i) => {
            const at = { x: k.targets[1].x + dx, y: k.targets[1].y + dy };
            k.shot('fx-broom-star', { x: at.x - 48, y: at.y - 64 }, at, {
              speed: 380,
              turn: false,
              onArrive: () => {
                k.fx('fx-broom-star-impact-ring', at, { z: 0 });
                k.fx('fx-broom-star-impact', at);
                if (i === 0) [0, 1, 2].forEach((n) => k.hit(n));
              },
            });
          }),
        ),
      );
    },
  },
  {
    name: 'Tempest',
    run(k) {
      const t = k.pose('attack-heavy', [0, 1, 2, 3, 4, 5], [null, null, null, 600, null, null]);
      k.at(t[3], () => k.fx('fx-broom-tempest-ground', k.targets[1], { z: 0, life: 1600, fadeOut: 200 }));
      // Four hits 400 ms apart, a bolt on one mob each (the hit on its frame 2).
      [1, 0, 2, 1].forEach((n, i) => {
        k.at(t[3] + 200 + i * 400, () => k.fx('fx-broom-bolt', k.targets[n]));
        k.at(t[3] + 200 + i * 400 + frameAt(2, 15), () => [0, 1, 2].forEach((m) => k.hit(m)));
      });
    },
  },
  {
    name: 'Thunder Sweep',
    run(k) {
      const t = k.pose('attack-cast', [0, 1, 2, 3, 4, 5]);
      k.at(t[2], () => {
        // The flat bolt laid end to end (a cell every 128 px) from the bristles out to 6 tiles, a bolt on each mob.
        const tip = k.launch('attack-cast', 2, 'tip');
        const end = toward(tip, k.body(2), 6 * 18);
        const a = angle(tip, end);
        for (let d = 0; d < dist(tip, end); d += 128) k.fx('fx-broom-thunder-line', toward(tip, end, d), { angle: a });
        [0, 1, 2].forEach((n) => k.fx('fx-broom-bolt', k.targets[n]));
      });
      k.at(t[2] + frameAt(2, 15), () =>
        [0, 1, 2].forEach((n) => {
          k.hit(n);
          stars(k, n, 800);
        }),
      );
    },
  },
];

const potlidLate: Skill[] = [
  {
    name: 'Pressure Cooker',
    run(k) {
      // The cast's frame 0 held through the 800 ms windup (the steam hissing round the lid; a 1 px shake on the stage),
      // then 1-5.
      const t = k.pose('attack-cast', [0, 1, 2, 3, 4, 5], [800, null, null, null, null, null]);
      k.at(t[0], () => k.fx('fx-potlid-pressure', k.launch('attack-cast', 0, 'lid'), { life: 800, fadeOut: 100 }));
      if (k.preview) for (let i = 0; i < 16; i++) k.at(t[0] + i * 50, () => k.move(i % 2 ? 1 : -1, 0, 0));
      k.at(t[1], () => {
        k.move(0, 0, 0);
        k.fx('fx-potlid-steam-burst-back', k.self(0, 0), { z: 1, scale: 1.3 });
        k.fx('fx-potlid-steam-burst-front', k.self(0, 0), { z: 3, scale: 1.3 });
        k.hit(0, { fx: 'fx-potlid-hit' });
      });
    },
  },
  {
    name: 'Hot Oil',
    run(k) {
      const t = k.pose('attack-heavy', [0, 1, 2, 3, 4, 5]);
      k.at(t[3], () => {
        const lid = k.launch('attack-heavy', 3, 'lid');
        const feet = { x: k.targets[1].x, y: k.targets[1].y };
        const fly = Math.max(BOIL.minMs, (dist(lid, feet) / BOIL.speed) * 1000);
        k.shot('fx-potlid-boil-drops', lid, feet, { speed: BOIL.speed, ms: fly, arc: BOIL.arc, turn: false, quarterTurnMs: BOIL.quarterMs, upright: true, fx: { tint: AMBER } });
        k.at(t[3] + fly, () => {
          k.hit(1);
          // The pool looping while it burns (5 ticks, 400 ms apart, from 600 ms after the cast).
          k.fx('fx-potlid-oil-pool', k.targets[1], { z: 0, life: 2400, fadeOut: 250 });
        });
        for (let i = 0; i < 5; i++)
          k.at(t[3] + 600 + i * 400, () => {
            k.fx('fx-hilot-burn', k.targets[1], { life: 350, fadeOut: 100 });
            k.number({ x: k.body(1).x + 8, y: k.body(1).y }, 'dot');
          });
      });
    },
  },
  {
    name: 'Gong Wave',
    run(k) {
      // The wave from the lid along the line (300 px/s, turned to its way), a hit and a taunt as it reaches each.
      const t = k.pose('attack-cast', [0, 1, 2, 3, 4, 5]);
      k.at(t[1], () => {
        const lid = k.launch('attack-cast', 1, 'lid');
        k.shot('fx-potlid-gong-wave', lid, lineEnd(k, lid), { speed: 300, fadeOut: 150 });
        [0, 1, 2].forEach((n) =>
          k.at(t[1] + (dist(lid, k.body(n)) / 300) * 1000, () => {
            k.hit(n, { fx: 'fx-potlid-hit' });
            taunted(k, n, 1500);
          }),
        );
      });
    },
  },
  {
    name: 'Simmer',
    run(k) {
      // The cast's frame 0 held through the 3 s channel (the simmer round the fighter), then 5: six hits 500 ms apart.
      const t = k.pose('attack-cast', [0, 5], [3000, null]);
      k.at(t[0], () => pair(k, 'fx-potlid-simmer', k.self(0, 0), { life: 3000, fadeOut: 200 }));
      for (let i = 0; i < 6; i++) k.at(t[0] + i * 500, () => k.hit(0, { fx: 'fx-potlid-hit' }));
    },
  },
  {
    name: 'Searing Lid',
    run(k) {
      // The lid drops on the target (its glow and heat rings under it, its steam), the hit on its frame 3; then it sears.
      const t = k.pose('attack-quick', [0, 1, 2, 3], [null, 200, null, null]);
      k.at(t[0], () => {
        k.fx('fx-potlid-searing-drop', k.targets[0]);
        k.fx('fx-potlid-searing-hit', k.targets[0], { z: 0 });
        k.fx('fx-potlid-searing-steam', k.targets[0]);
      });
      const hit = t[0] + frameAt(3, 14);
      k.at(hit, () => {
        k.hit(0);
        taunted(k, 0, 2000);
      });
      ticking(k, 0, hit, 4, 500, 'fx-hilot-burn'); // Sears 4 × 15%
    },
  },
  {
    name: 'Kettle Scream',
    run(k) {
      const t = k.pose('attack-cast', [0, 1, 2, 3, 4, 5], [null, null, null, 400, null, null]);
      k.at(t[3], () => k.fx('fx-potlid-scream-ring', k.self(0, 0), { z: 0 }));
      k.at(t[3] + frameAt(3, 14), () => [0, 1].forEach((n) => k.hit(n, { fx: 'fx-potlid-hit' })));
    },
  },
];

const hilotLate: Skill[] = [
  {
    name: 'Nettle Burst',
    run(k) {
      const t = k.pose('attack-heavy', [0, 1, 2, 3, 4, 5], [null, null, null, 200, null, null]);
      k.at(t[3], () => pair(k, 'fx-hilot-nettle-burst', k.self(0, 0)));
      k.at(t[3] + frameAt(3, 14), () => k.hit(0, { fx: 'fx-hilot-hit' }));
    },
  },
  {
    name: 'Spirit Smoke',
    run(k) {
      const t = k.pose('attack-cast', [0, 1, 2, 3, 4, 5]);
      k.at(t[4], () => {
        const palm = k.launch('attack-cast', 4, 'palm');
        k.shot('fx-hilot-flick-bolt', palm, k.body(1), { speed: 300, onArrive: () => k.hit(1, { fx: 'fx-hilot-hit' }) });
      });
      // Burns 6 × 12%: the smoke curling round it at its feet while it does, following it.
      const at = t[4] + 150;
      k.at(at, () => k.fx('fx-hilot-spirit-smoke', k.targets[1], { z: 3, life: 3100, fadeOut: 250, follow: 1 }));
      ticking(k, 1, at, 6, 500);
    },
  },
  {
    name: 'Herbal Storm',
    run(k) {
      const t = k.pose('attack-cast', [0, 1, 2, 3, 4, 5], [null, null, null, null, 300, null]);
      k.at(t[4], () => pair(k, 'fx-hilot-herb-storm', k.targets[1], { life: 1000, fadeOut: 150 }));
      [0, 350, 700].forEach((d) =>
        k.at(t[4] + 100 + d, () => {
          [0, 1, 2].forEach((n) => k.hit(n, { fx: 'fx-hilot-hit' }));
          k.number(k.self(0, -30), 'heal'); // the party healed (green)
        }),
      );
    },
  },
  {
    name: 'Fever Wave',
    run(k) {
      const t = k.pose('attack-heavy', [0, 1, 2, 3, 4, 5]);
      k.at(t[3], () => {
        // The wave from the palms along the line, turned to its way.
        const palm = k.launch('attack-heavy', 3, 'palm');
        k.shot('fx-hilot-fever-wave', palm, lineEnd(k, palm), { speed: 260, fadeOut: 150 });
        [0, 1, 2].forEach((n) => k.at(t[3] + (dist(palm, k.body(n)) / 260) * 1000, () => k.hit(n, { fx: 'fx-hilot-hit' })));
      });
    },
  },
  {
    name: 'Wildroot',
    run(k) {
      // The roots burst up over the area (tallest on its frames 3-8: the hits on 3), then hold each rooted mob 2.5 s.
      const t = k.pose('attack-cast', [0, 1, 2, 3, 4, 5]);
      k.at(t[4], () => {
        pair(k, 'fx-hilot-wildroot-burst', k.targets[1]);
        const hold = { from: 4, to: 10, until: 2500 };
        [0, 1, 2].forEach((n) => {
          k.fx('fx-hilot-root-back', k.targets[n], { z: 1, hold });
          k.fx('fx-hilot-root-front', k.targets[n], { z: 3, hold });
        });
      });
      k.at(t[4] + frameAt(3, 14), () => [0, 1, 2].forEach((n) => k.hit(n, { fx: 'fx-hilot-hit' })));
    },
  },
  {
    name: 'Spirit Lash',
    run(k) {
      // A vine whip from the palm at the target on each 2, turned to it, the hit on its frame 7.
      const t = k.pose('attack-quick', [0, 1, 2, 1, 2, 3]);
      [2, 4].forEach((i) =>
        k.at(t[i], () => {
          const palm = k.launch('attack-quick', 2, 'palm');
          k.fx('fx-hilot-spirit-vine', palm, { angle: angle(palm, k.body(1)) });
          k.at(t[i] + frameAt(7, 14), () => k.hit(1, { fx: 'fx-hilot-hit' }));
        }),
      );
    },
  },
];

const dash: Skill = {
  name: 'Dash',
  run(k) {
    const t = k.pose('dash', [0, 1, 2, 3, 4, 5, 6]);
    const to = tiles(2);
    k.at(t[1], () => {
      k.fx(DUST, k.self(-6, 0), { z: 1 }); // behind the feet
      k.trail(true);
      k.move(to.x, to.y, t[4] - t[1], 'out'); // frames 1-3, easing out
    });
    k.at(t[4], () => {
      k.trail(false);
      k.fx(DUST, k.self(0, 0), { z: 1 }); // the brake
    });
    homeAfter(k, t[6] + 1000 / 16);
  },
};

const stepBack: Skill = {
  name: 'Step Back',
  run(k) {
    const t = k.pose('step-back', [0, 1, 2, 3, 4, 5, 6]);
    const back = tiles(-1);
    // (It travels back, west on screen: its dust flipped.)
    k.at(t[1], () => {
      k.fx(DUST, k.self(0, 0), { z: 1, flip: true });
      k.move(back.x, back.y, t[5] - t[1]); // frames 1-4, a straight line on the ground (the hop is in the sheet)
    });
    k.at(t[5], () => k.fx(DUST, k.self(0, 0), { z: 1, flip: true }));
    homeAfter(k, t[6] + 1000 / 14);
  },
};

/** Charge: start, the run looping at ~6 tiles a second until it reaches its target, then the skid; the class's hit
 *  lands on arrival. The melee enemy already stands within reach of the start spot, so the run goes to the next one.
 *  The class's wedge (fx-<class>-charge, none while it has no art) loops ahead of the chest for the whole run. */
const charge = (hitFx: string, cls: string): Skill => ({
  name: 'Charge',
  run(k) {
    const run = tiles(2); // to the mid enemy, stopping a tile short of it
    const runMs = (Math.hypot(run.x, run.y) / (Math.hypot(TILE.x, TILE.y) * 6)) * 1000;
    const loop = 1000 / 18;
    const loops = Math.max(1, Math.ceil(runMs / loop));
    const start = k.pose('charge-start', [0, 1]);
    const looped = k.pose('charge-loop', Array.from({ length: loops }, (_, i) => i % 8));
    const end = k.pose('charge-end', [0, 1, 2]);
    k.at(start[1], () => {
      k.fx(DUST, k.self(0, 0), { z: 1 });
      // (10 px ahead of the feet along its way, 18 px up; turned to the way it goes.)
      k.fx(`fx-${cls}-charge`, k.self(SE.x * 10, SE.y * 10 - 18), { angle: Math.atan2(SE.y, SE.x), withFighter: true, life: end[0] - start[1] + 100, fadeOut: 150 });
      k.trail(true);
      k.move(run.x, run.y, looped[0] + loops * loop - start[1]);
    });
    for (let d = looped[0] + 220; d < end[0]; d += 220) k.at(d, () => k.fx(DUST, k.self(0, 0), { z: 1 }));
    k.at(end[0], () => {
      k.trail(false);
      k.fx(DUST, k.self(0, 0), { z: 1 });
      k.hit(1, { fx: hitFx });
    });
    homeAfter(k, end[2] + 1000 / 14);
  },
});

/** Blink: the class's pair (fx-<class>-blink: its back half on the ground, its front over the fighter) where it
 *  vanishes and again where it appears. */
const blink = (cls: string): Skill => ({
  name: 'Blink',
  run(k) {
    const out = k.pose('blink-out', [0, 1, 2, 3, 4, 5]); // the last frame is empty
    const land = tiles(2.5);
    const back = k.pose('blink-in', [0, 1, 2, 3, 4]);
    const burst = () => {
      k.fx(`fx-${cls}-blink-back`, k.self(0, 0), { z: 0 });
      k.fx(`fx-${cls}-blink-front`, k.self(0, 0), { z: 3 });
    };
    k.at(out[2], burst);
    k.at(out[3], () => k.flash(true));
    k.at(out[5], () => {
      k.flash(false);
      k.move(land.x, land.y, 0); // there at once
    });
    k.at(back[0], () => {
      k.flash(true);
      burst();
    });
    k.at(back[2], () => k.flash(false));
    homeAfter(k, back[4] + 1000 / 16);
  },
});

/** Each class's two mobility moves (Dash, then the Lv 8 one), by the ids in classes.json's mobility lists. */
export const MOBILITY_PREVIEWS: Record<string, Record<string, Skill>> = {
  slingshot: { dash, 'step-back': stepBack },
  stick: { dash, 'step-back': stepBack },
  greatstick: { dash, charge: charge('fx-crimson-hit', 'greatstick') },
  potlid: { dash, charge: charge('fx-potlid-hit', 'potlid') },
  broom: { dash, blink: blink('broom') },
  hilot: { dash, blink: blink('hilot') },
};

/** A utility (classes.json buffs) of class `cls`: its buff-cast played once, every frame at its fps, facing SE; the
 *  class's burst on its fx_start frame(s) at its hook (buff-hooks.csv; else the feet), and LANDING_MS after the first
 *  its look on the fighter (combat/utility-looks.ts: a looping one for a moment here, Steady Breath's one cycle); a
 *  debuff's mark over enemy 1 (Hamstring's at its feet). */
export const buffPreview = (name: string, cls: string): Skill => ({
  name,
  run(k) {
    const t = k.pose('buff-cast', Array.from({ length: k.frames('buff-cast') }, (_, f) => f));
    const hook = buffHook(cls);
    const frames = hook?.frames.length ? hook.frames.filter((f) => f < t.length) : [0];
    const burst = BUFF_BURSTS[cls];
    if (burst)
      for (const f of frames) {
        const p = burst.at === 'hook' ? hook?.at[f]?.[k.dir] : undefined;
        k.at(t[f] ?? 0, () => k.fx(burst.fx, k.self(p ? p[0] - 32 : 0, p ? p[1] - 56 : 0), { z: burst.ground ? 0 : 3 }));
      }
    const look = BUFF_LOOKS[name];
    const landAt = (t[frames[0]] ?? 0) + LANDING_MS;
    if (look) k.at(landAt, () => pair(k, look.fx, k.self(0, 0), look.loop ? { life: 1600, fadeOut: 250 } : look.ms ? { life: look.ms, fadeOut: 250 } : {}));
    const mark = DEBUFF_MARKS[name];
    if (mark)
      k.at(t[Math.min(2, t.length - 1)], () =>
        k.fx(mark.fx, mark.feet ? k.targets[1] : { x: k.body(1).x, y: k.body(1).y - 22 }, {
          z: mark.feet ? 0 : 3, life: 1600, fadeOut: 250, ...(mark.tint ? { tint: mark.tint } : {}),
          ...(mark.feet ? { frames: Array.from({ length: 16 }, (_, i) => i % 4) } : {}),
        }),
      );
  },
});

/** Each class's 13 damage skills, in classes.json order (the first 7, then the Lv 21-40 ones). */
export const SKILL_PREVIEWS: Record<string, Skill[]> = {
  slingshot: [...slingshot, ...slingshotLate],
  stick: [...stick, ...stickLate],
  greatstick: [...greatstick, ...greatstickLate],
  broom: [...broom, ...broomLate],
  potlid: [...potlid, ...potlidLate],
  hilot: [...hilot, ...hilotLate],
};
