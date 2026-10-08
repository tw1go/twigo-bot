import { type ClassSkill, type StatsData, baseCooldown, skillCooldown, skillLevelBonus } from '@mikazuki/shared';
import { MOVES, isMoveKind } from '../world/mobility';

// ⏱️ A skill's cooldown (s) at its skill level: a damage skill's base by its unlock level (@mikazuki/shared baseCooldown:
// 0.8 + 0.15 a level, Lv 1: 1 s … Lv 18: 3.5 s), a move's its own (world/mobility.ts MOVES), 1% less for each skill level
// past 1 (skillCooldown, stats.json). The bot enforces the damage skills' (web/town-mobs.ts) by the same functions.

export function cooldownOf(stats: StatsData, skill: ClassSkill, level: number): number {
  const base = skill.move ? (isMoveKind(skill.move) ? MOVES[skill.move].cooldown : 0) : baseCooldown(skill.unlock);
  return skillCooldown(stats, base, level);
}

/** A skill's MP cost over its base at its skill level (+3% a level past 1), in %: skills cost no MP yet, so it's shown
 *  only. */
export const mpCostPct = (stats: StatsData, level: number) => Math.round((skillLevelBonus(stats, level).mpCost - 1) * 100);

/** Seconds as the panel and tooltips show them: "1s", "0.95s". */
export const seconds = (s: number) => `${+s.toFixed(2)}s`;
