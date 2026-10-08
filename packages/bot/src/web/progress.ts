import {
  type CharacterProgress,
  type ClassSkill,
  type StatName,
  type StatPoints,
  type StatsData,
  STAT_NAMES,
  gainXp,
  mobXp,
  pointStats,
  skillLevelCap,
  skillLevelOf,
  skillPointsAt,
  unspentStatPoints,
  xpForLevel,
  xpToNext,
} from '@mikazuki/shared';

// 📈 A character's level, XP and points: pure, over the stats rules (@mikazuki/shared stats.ts, numbers from the game's
// classes/stats.json). XP comes from kills (the killer's, less for a mob far below them; the golem's for everyone who
// did 5% of its HP: town-mobs.ts says who); each level-up earns stat points (worked out from the level, minus what's
// spent) and skill points (kept, since spending them raises skill levels: one a level, unlocked skills only, up to
// their cap = level − unlock level + 1, at most 20). At the level cap XP stops. The bot saves it
// with the class (web/adventure.ts); the game's dev server keeps it in memory, through the same functions.

/** What's kept of it; the rest comes from these. */
export type SavedProgress = Pick<CharacterProgress, 'level' | 'xp' | 'points' | 'skills' | 'skillPoints'>;

/** XP gained (as counted: none past the cap), and how many levels it went up (each: HP and MP refill, "Level up!"). */
export interface LevelGain {
  progress: CharacterProgress;
  gained: number;
  ups: number;
}

const whole = (n: unknown, lo = 0) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(lo, Math.floor(n)) : lo);

/** Saved progress as the game sees it, for a character of class `cls` (its stat points banked before a class), each
 *  number held to what the rules allow. */
export function progressView(data: StatsData, cls: string | null, p: Partial<SavedProgress>): CharacterProgress {
  const level = Math.min(data.levelCap, whole(p.level, 1));
  const next = xpToNext(data, level);
  const points: StatPoints = {};
  for (const s of STAT_NAMES) if (whole(p.points?.[s])) points[s] = whole(p.points?.[s]);
  const skills: Record<string, number> = {};
  for (const [k, v] of Object.entries(p.skills ?? {})) if (whole(v) > 1) skills[k] = whole(v);
  return { level, xp: next ? Math.min(whole(p.xp), next - 1) : 0, next, points, statPoints: unspentStatPoints(data, cls, level, points), skills, skillPoints: whole(p.skillPoints) };
}

/** A new character's: Lv 1, no XP, nothing earned or spent. */
export const freshProgress = (data: StatsData, cls: string | null = null): CharacterProgress => progressView(data, cls, { level: 1 });

/** All the XP since Lv 1. */
const totalXp = (data: StatsData, p: SavedProgress) => xpForLevel(data, p.level) + p.xp;

/** `n` XP more: up as many levels as it reaches (3 skill points each; stat points come with the level), XP stopping at
 *  the cap. */
export function addXp(data: StatsData, cls: string | null, p: SavedProgress, n: number): LevelGain {
  const r = gainXp(data, p.level, p.xp, whole(n));
  const skillPoints = p.skillPoints + skillPointsAt(data, r.level) - skillPointsAt(data, p.level);
  const progress = progressView(data, cls, { ...p, level: r.level, xp: r.xp, skillPoints });
  return { progress, gained: totalXp(data, progress) - totalXp(data, p), ups: r.ups };
}

/** A kill's XP: the mob's, less for a mob far below them (the low-mob penalty). */
export const killXp = (data: StatsData, cls: string | null, p: SavedProgress, mob: { level: number; xp: number }): LevelGain =>
  addXp(data, cls, p, mobXp(data, mob, p.level));

/** Every stat and skill point back (a fresh class: the CMS's Reset class, a Bagong Buhay Ticket): nothing spent, every
 *  skill at Lv 1, the skill points the level has earned unspent. Level and XP stay. */
export function refundPoints(data: StatsData, cls: string | null, p: SavedProgress): CharacterProgress {
  return progressView(data, cls, { level: p.level, xp: p.xp, skillPoints: skillPointsAt(data, p.level) });
}

/** One stat point into `stat`: only the class's main or second stat, and only with a point unspent (none before a
 *  class: they're banked). */
export function spendPoint(data: StatsData, cls: string | null, p: SavedProgress, stat: StatName): { ok: true; progress: CharacterProgress } | { ok: false; message: string } {
  const now = progressView(data, cls, p);
  if (!cls) return { ok: false, message: 'Choose a class to spend points.' };
  if (!pointStats(data, cls).includes(stat)) return { ok: false, message: `Your class doesn't put points into ${stat}.` };
  if (now.statPoints < 1) return { ok: false, message: 'No stat points to spend.' };
  return { ok: true, progress: progressView(data, cls, { ...p, points: { ...now.points, [stat]: (now.points[stat] ?? 0) + 1 } }) };
}

/** Every stat point back (free for now); skill levels and points stay. */
export const resetStatPoints = (data: StatsData, cls: string | null, p: SavedProgress): CharacterProgress => progressView(data, cls, { ...p, points: {} });

type Step = { ok: true; progress: CharacterProgress } | { ok: false; message: string };

/** One skill point into a skill of their class (classSkills' entry): only an unlocked one, below its cap (character level
 *  − its unlock level + 1, at most 20), with a point unspent (none before a class: they're banked). */
export function raiseSkill(data: StatsData, cls: string | null, p: SavedProgress, skill: ClassSkill | undefined): Step {
  const now = progressView(data, cls, p);
  if (!cls) return { ok: false, message: 'Choose a class to raise skills.' };
  if (!skill) return { ok: false, message: 'No such skill.' };
  if (now.level < skill.unlock) return { ok: false, message: `${skill.name} unlocks at Lv ${skill.unlock}.` };
  const level = skillLevelOf(now, skill.key);
  const cap = skillLevelCap(data, now.level, skill.unlock);
  if (level >= cap) return { ok: false, message: `${skill.name} is at Lv ${level}, its cap for now.` };
  if (now.skillPoints < 1) return { ok: false, message: 'No skill points to spend.' };
  return { ok: true, progress: progressView(data, cls, { ...p, skills: { ...now.skills, [skill.key]: level + 1 }, skillPoints: now.skillPoints - 1 }) };
}

/** Every skill point back (free for now): every skill at Lv 1 again; stat points stay. */
export function resetSkillPoints(data: StatsData, cls: string | null, p: SavedProgress): CharacterProgress {
  const now = progressView(data, cls, p);
  const spent = Object.values(now.skills).reduce((n, v) => n + v - 1, 0);
  return progressView(data, cls, { ...p, skills: {}, skillPoints: now.skillPoints + spent });
}

/** Dev (?level=N): up to level N through addXp (its level-ups as from kills); down, from Lv 1 again (points back), with
 *  no level-up; already there, nothing changes (a reload keeps the points spent). */
export function levelTo(data: StatsData, cls: string | null, p: SavedProgress, level: number): LevelGain {
  const L = Math.min(data.levelCap, whole(level, 1));
  if (L === p.level) return { progress: progressView(data, cls, p), gained: 0, ups: 0 };
  if (L > p.level) return addXp(data, cls, p, xpForLevel(data, L) - totalXp(data, p));
  const r = addXp(data, cls, freshProgress(data, cls), xpForLevel(data, L));
  return { ...r, gained: 0, ups: 0 };
}
