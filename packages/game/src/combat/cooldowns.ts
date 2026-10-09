import { type ClassSkill, type StatsData, baseCooldown, buffMpCost, skillCooldown, skillMpCost } from '@mikazuki/shared';
import { MOVES, isMoveKind } from '../world/mobility';

// ⏱️ A skill's cooldown (s) at its skill level: a damage skill's base by its unlock level (@mikazuki/shared baseCooldown:
// stats.json skills.cooldownByUnlock, Lv 1: 1 s … Lv 18: 14 s), a move's its own (world/mobility.ts MOVES), a buff's
// cooldownSec (a stance's switch: rules.stanceSwitchSec, as is), 1% less for each skill level past 1 (skillCooldown,
// stats.json). The bot enforces the damage skills' (web/town-mobs.ts) and the buffs' (web/town-buffs.ts) the same way.

export function cooldownOf(stats: StatsData, skill: ClassSkill, level: number): number {
  if (skill.buff) {
    const b = stats.skills.buffs?.list[skill.buff];
    if (!b) return 0;
    return b.stance ? Number(stats.skills.buffs!.rules.stanceSwitchSec) : skillCooldown(stats, b.cooldownSec, level);
  }
  const base = skill.move ? (isMoveKind(skill.move) ? MOVES[skill.move].cooldown : 0) : baseCooldown(stats, skill.unlock);
  return skillCooldown(stats, base, level);
}

/** A skill's MP at its skill level (stats.json skills.mpCost, a buff's mpCost.buffs, +3% a level past 1; the bot spends
 *  the same on battle maps). */
export const mpCostOf = (stats: StatsData, cls: string | null | undefined, skill: ClassSkill, level: number) =>
  skill.buff ? buffMpCost(stats, skill.buff, level) : skillMpCost(stats, cls, skill.key, level);

/** Seconds as the panel and tooltips show them: "1s", "0.95s". */
export const seconds = (s: number) => `${+s.toFixed(2)}s`;
