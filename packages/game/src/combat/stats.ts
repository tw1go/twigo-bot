import type { EquipStats } from '@mikazuki/shared';

// 📊 A character's stats for the equipment panel. There's no combat yet, so these are PLACEHOLDERS: one base set per
// class (and one before a class is chosen) at level 1, plus whatever the worn items add. Fill in the real numbers here.

export type Stats = Required<EquipStats>;

const NONE: Stats = { atk: 5, def: 5, hp: 100, mp: 30, str: 3, dex: 3, int: 3, crit: 5 };

/** PLACEHOLDER base stats per class at level 1. */
const BASE: Record<string, Stats> = {
  slingshot: { atk: 10, def: 6, hp: 100, mp: 40, str: 3, dex: 6, int: 5, crit: 8 },
  stick: { atk: 12, def: 8, hp: 120, mp: 40, str: 5, dex: 6, int: 3, crit: 5 },
  greatstick: { atk: 14, def: 9, hp: 140, mp: 30, str: 7, dex: 3, int: 2, crit: 4 },
  broom: { atk: 11, def: 5, hp: 90, mp: 70, str: 2, dex: 3, int: 7, crit: 5 },
  potlid: { atk: 9, def: 12, hp: 160, mp: 50, str: 6, dex: 2, int: 4, crit: 3 },
  hilot: { atk: 9, def: 7, hp: 110, mp: 80, str: 4, dex: 3, int: 6, crit: 4 },
};

/** Base stats for a class at a level (only level 1 so far), plus the worn items' stats. */
export function statsFor(cls: string | null, level: number, worn: EquipStats[]): Stats {
  const base = { ...(cls ? (BASE[cls] ?? NONE) : NONE) };
  void level; // levels come later
  for (const s of worn) for (const k of Object.keys(base) as (keyof Stats)[]) base[k] += s[k] ?? 0;
  return base;
}
