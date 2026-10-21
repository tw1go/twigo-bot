// What a damage skill does besides its damage, and how its damage lands (the game's classes/skill-hits.json: `effects`,
// `hits` and the shapes; combat-guide.md "Lv 21-40 skills"; CONTEXT.md Stun, Taunt, Damage over time, Channel, Charge-up,
// Windup, Leap). Pure, read by the bot (web/town-mobs.ts runs them) and the game (the tooltips, the hold to charge up).

/** One effect of a skill (a comma joins two: Searing Lid's dot and taunt). */
export type SkillEffect =
  /** Moves at `factor` of its speed for `ms`. */
  | { kind: 'slow'; factor: number; ms: number }
  /** Can't move for `ms` (it still attacks next to you). */
  | { kind: 'root'; ms: number }
  /** A puddle on the target's tile: `ticks` ticks `every` ms apart, the first `first` ms after the cast, each hitting
   *  every mob within `radius` tiles for `share` of the skill's damage. */
  | { kind: 'burn'; ticks: number; every: number; share: number; radius: number; first: number }
  /** Can't move or attack for `ms`. */
  | { kind: 'stun'; ms: number }
  /** Fights the caster for `ms`. */
  | { kind: 'taunt'; ms: number }
  /** Damage over time on the mob itself: `ticks` ticks `every` ms apart, each `share` of the skill's damage. */
  | { kind: 'dot'; ticks: number; every: number; share: number }
  /** The caster and their party within range heal `factor` × Power (+2% a skill level). */
  | { kind: 'heal'; factor: number }
  /** `count` projectiles of 1/count of the damage: one at the target, the rest at the nearest other mobs within
   *  `radius` tiles of the caster, the spare ones at the target again. */
  | { kind: 'seek'; count: number; radius: number }
  /** `add` more crit rate on this skill (held to caps.critRate). */
  | { kind: 'crit'; add: number }
  /** Hold the key up to `ms`: × (min + (1 − min) × held / ms). */
  | { kind: 'charge'; ms: number; min: number }
  /** Lands `ms` after the cast; you stand still meanwhile (moving cancels it, at no cost). */
  | { kind: 'windup'; ms: number }
  /** Jumps you next to the target (up to `tiles` away) before it lands. */
  | { kind: 'leap'; tiles: number };

const num = (s: string | undefined, d: number) => {
  const n = Number(s);
  return s !== undefined && s !== '' && Number.isFinite(n) ? n : d;
};

/** A skill-hits.json effects string as its effects (none for null or an unknown kind). */
export function skillEffects(text: string | null | undefined): SkillEffect[] {
  if (!text) return [];
  return text.split(',').flatMap((part): SkillEffect[] => {
    const [kind, a, b, c, d, e] = part.trim().split(':');
    switch (kind) {
      case 'slow': return [{ kind, factor: Math.max(0, Math.min(1, num(a, 0.5))), ms: num(b, 2000) }];
      case 'root': return [{ kind, ms: num(a, 2000) }];
      case 'burn': return [{ kind, ticks: num(a, 3), every: num(b, 300), share: num(c, 0.2), radius: num(d, 1), first: num(e, 700) }];
      case 'stun': return [{ kind, ms: num(a, 1000) }];
      case 'taunt': return [{ kind, ms: num(a, 3000) }];
      case 'dot': return [{ kind, ticks: num(a, 4), every: num(b, 500), share: num(c, 0.15) }];
      case 'heal': return [{ kind, factor: num(a, 0.15) }];
      case 'seek': return [{ kind, count: Math.max(1, num(a, 3)), radius: num(b, 5) }];
      case 'crit': return [{ kind, add: num(a, 0) }];
      case 'charge': return [{ kind, ms: Math.max(1, num(a, 1500)), min: Math.max(0, Math.min(1, num(b, 0.6))) }];
      case 'windup': return [{ kind, ms: num(a, 800) }];
      case 'leap': return [{ kind, tiles: num(a, 4) }];
      default: return [];
    }
  });
}

/** The effect of a kind a skill has, if any. */
export function effectOf<K extends SkillEffect['kind']>(effects: SkillEffect[], kind: K): Extract<SkillEffect, { kind: K }> | undefined {
  return effects.find((e): e is Extract<SkillEffect, { kind: K }> => e.kind === kind);
}

/** How a skill's damage lands when it's several hits (skill-hits.json `hits`: N:EVERY[:channel|:move]): `count` hits
 *  `every` ms apart, each 1/count of the damage, the first at once. `channel`: the caster stands still and moving, being
 *  knocked out or casting another skill stops the rest. `move`: the caster may walk, and each hit finds its mobs again
 *  from where they stand. */
export interface SkillHits {
  count: number;
  every: number;
  mode: 'channel' | 'move' | null;
}

/** A hits string as its hits (null: one hit, or nothing given). */
export function skillHits(text: string | null | undefined): SkillHits | null {
  if (!text) return null;
  const [n, every, mode] = text.split(':');
  const count = Math.max(1, Math.round(num(n, 1)));
  if (count < 2) return null;
  return { count, every: Math.max(50, num(every, 300)), mode: mode === 'channel' || mode === 'move' ? mode : null };
}

/** A skill's shape (skill-hits.json): its kind, how many mobs at most and its radius (around: round the caster, 1 when
 *  not given; area and cone: round the target, 2 when not given). */
export function shapeParts(shape: string | null | undefined): { kind: string; count: number; radius: number } {
  const [kind, n, r] = (shape || 'single').split(':');
  return { kind, count: Math.max(1, num(n, 1)), radius: num(r, kind === 'around' ? 1 : 2) };
}

/** A charge-up's multiplier for a key held `heldMs` (clamped to its time): min at once, 1 at full. */
export function chargeMult(c: { ms: number; min: number }, heldMs: number): number {
  const k = Math.max(0, Math.min(1, heldMs / c.ms));
  return c.min + (1 - c.min) * k;
}

/** How much of a stun, slow or root a mob takes: mini bosses half, the field bosses and a dungeon's last boss none, the
 *  rest all of it (combat-guide.md "Lv 21-40 skills"; a debuff's slow isn't this: it works on everything). */
export function crowdShare(m: { mini?: boolean; field?: boolean; last?: boolean }): number {
  return m.field || m.last ? 0 : m.mini ? 0.5 : 1;
}
