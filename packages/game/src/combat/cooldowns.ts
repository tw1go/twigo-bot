import { type ClassSkill, type StatsData, baseCooldown, skillCooldown, skillMpCost } from '@mikazuki/shared';
import { MOVES, isMoveKind } from '../world/mobility';

// ⏱️ A skill's cooldown (s) at its skill level: a damage skill's base by its unlock level (@mikazuki/shared baseCooldown:
// stats.json skills.cooldownByUnlock, Lv 1: 1 s … Lv 18: 14 s), a move's its own (world/mobility.ts MOVES), 1% less for each skill level
// past 1 (skillCooldown, stats.json). The bot enforces the damage skills' (web/town-mobs.ts) by the same functions.

export function cooldownOf(stats: StatsData, skill: ClassSkill, level: number): number {
  const base = skill.move ? (isMoveKind(skill.move) ? MOVES[skill.move].cooldown : 0) : baseCooldown(stats, skill.unlock);
  return skillCooldown(stats, base, level);
}

/** A skill's MP at its skill level (stats.json skills.mpCost, +3% a level past 1; the bot spends the same on battle
 *  maps). */
export const mpCostOf = (stats: StatsData, cls: string | null | undefined, skill: ClassSkill, level: number) => skillMpCost(stats, cls, skill.key, level);

/** Seconds as the panel and tooltips show them: "1s", "0.95s". */
export const seconds = (s: number) => `${+s.toFixed(2)}s`;
