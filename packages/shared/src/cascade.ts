// 🎲 Cascades (CONTEXT.md Cascade): how a random tier is picked wherever loot has grades. The tiers come best first, each
// with its weight (any scale, as stats.json's odds tables have them); the best is tried first with a chance of its own, a
// miss tries the next, and the floor always lands. The chances are the weighted table's own odds, exactly (each tier's
// weight over what's left from it down), so a cascade with no boost picks like one weighted roll. `boost` (Drop rate)
// raises every chance but the floor's, capped at 1: more of the better tiers, never fewer. Pure.

/** Each tier's own chance when it's tried, best first, from the tiers' weights (the floor's is what's left: 1). */
export function cascadeChances<T>(tiers: [T, number][]): [T, number][] {
  const w = (n: number) => (n > 0 ? n : 0);
  let rest = tiers.reduce((n, [, weight]) => n + w(weight), 0);
  return tiers.map(([tier, weight]) => {
    const chance = rest > 0 ? w(weight) / rest : 0;
    rest -= w(weight);
    return [tier, chance];
  });
}

/** A yes-or-no chance raised by `boost` (Drop rate: chance × (1 + boost)), never over 1. */
export const boosted = (chance: number, boost = 0): number => Math.min(1, Math.max(0, chance) * (1 + Math.max(0, boost)));

/** Picks a tier: the best first, each with its own chance (`boost` raises every one but the floor's), the floor if
 *  every other misses. One `random()` per tier tried. */
export function cascade<T>(tiers: [T, number][], random: () => number, boost = 0): T {
  const chances = cascadeChances(tiers);
  for (let i = 0; i < chances.length - 1; i++) {
    const [tier, chance] = chances[i];
    if (chance > 0 && random() < boosted(chance, boost)) return tier;
  }
  return chances[chances.length - 1][0];
}
