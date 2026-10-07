import type { Pt, Skill, SkillKit } from './skill-stage';

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
      const t = k.pose('attack-cast', [0, 1, 2, 3, 4, 5]);
      // A lob from the fork to the top of the rain, then the rain three times over the pack, hits ~220 ms apart.
      const area = { x: (k.targets[1].x + k.targets[2].x) / 2, y: (k.targets[1].y + k.targets[2].y) / 2 };
      const top = { x: area.x + 14 - 47, y: area.y + 12 - 72 }; // the rain's cell 14,12 with its impact (47,72) on the area
      k.at(t[4], () => {
        const fork = k.launch('attack-cast', 4);
        k.fx('fx-slingshot-launch', fork);
        k.shot(BULLET, fork, top, {
          speed: 260,
          arc: 22,
          fadeOut: 140,
          onArrive: () => {
            const frames = [...Array(36).keys()].map((i) => i % 12);
            k.fx('fx-pebble-volley', area, { frames, fadeIn: 140, fadeOut: 260, z: 3 });
            [1, 2, 1, 2].forEach((n, i) => k.at(t[4] + 700 + i * 220, () => k.hit(n, { fx: 'fx-slingshot-hit-small' })));
          },
        });
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
      const t = k.pose('attack-quick', [0, 1, 2, 3], [83, 83, 400, 83]);
      k.at(t[1], () => {
        const lid = k.launch('attack-quick', 1, 'lid');
        k.fx('fx-potlid-splash-se', lid);
        const land = { x: lid.x + 57, y: lid.y + 53 }; // the splash's landing for SE
        const splash = 1000 / 14;
        k.at(t[1] + splash * 6, () => {
          k.fx('fx-potlid-splash-puddle', land, { z: 0, hold: { from: 4, to: 8, until: 1300 } });
          k.hit(2);
          [1, 2, 3].forEach((i) => k.at(t[1] + splash * 6 + i * 300, () => k.number({ x: k.body(2).x + 8, y: k.body(2).y }, 'dot')));
        });
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

/** Each class's first 7 damage skills, in classes.json order. */
export const SKILL_PREVIEWS: Record<string, Skill[]> = { slingshot, stick, greatstick, broom, potlid, hilot };
