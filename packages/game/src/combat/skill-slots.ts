import type { Pt, Skill, SkillKit } from './skill-stage';

// 🎯 Which enemy slots (0 near, 1 mid, 2 far) a skill's script uses: a dry run of it on a kit that only notes them
// (every timed step and shot run at once). One slot: a single-target skill; two or three: it hits that many mobs
// (a bounce, a spray, a pierce, a rain). The world maps your target to the first slot it uses and the extra mobs to the
// rest (combat/world-skills.ts); the bot allows as many hits per skill (web/town-mobs.ts SKILL_TARGETS, from this).

export function skillSlots(skill: Skill): number[] {
  const used = new Set<number>();
  const pt: Pt = { x: 0, y: 0 };
  const targets = new Proxy([pt, pt, pt], {
    get(t, k) {
      if (typeof k === 'string' && /^[0-2]$/.test(k)) used.add(Number(k));
      return Reflect.get(t, k);
    },
  });
  const kit: SkillKit = {
    dir: 'se',
    feet: pt,
    targets,
    body: (n) => (used.add(n), pt),
    self: () => pt,
    frames: () => 1,
    pose: (_a, frames) => frames.map((_, i) => i * 80),
    launch: () => pt,
    at: (_ms, fn) => fn(),
    fx: () => ({ kill: () => {} }),
    shot: (_n, _f, _t, o) => o.onArrive?.(),
    hit: (n) => void used.add(n),
    number: () => {},
    hide: () => {},
    move: () => {},
    trail: () => {},
    flash: () => {},
    fade: () => {},
  };
  skill.run(kit);
  return [...used].sort();
}
