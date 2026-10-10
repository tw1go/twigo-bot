import { type DerivedStats, baseStats, combatRating, derivedStats, itemTotals, withBuffs } from '@mikazuki/shared';
import { adventure, adventureData } from '../net/adventure';
import { myBuffStats } from '../net/buffs';
import { myMainStat } from './item-tip';

// 💪 Your stats and combat rating (CP) as the stats rules have them: class, level, points and what's worn (`st`), and
// with the buffs on you (`up`). The stats box (ui/equipment.ts) and the HUD's CP (ui/townhud.ts) both read them, so
// they always agree; someone else's CP is the server's (the player box, Info).

/** Yours now; null until your character and the rules are in. */
export function myStats(): { st: DerivedStats; up: DerivedStats } | null {
  const s = adventure();
  const D = adventureData();
  const S = D?.stats;
  if (!s || !D || !S) return null;
  const p = s.progress;
  const st = derivedStats(S, s.cls, p.level, baseStats(S, s.cls, p.level, p.points), itemTotals(D, Object.values(s.equipped).filter((i) => !!i), myMainStat()));
  return { st, up: withBuffs(S, st, myBuffStats()) };
}

/** Your combat rating with your buffs; null until it can be worked out. */
export function myRating(): number | null {
  const m = myStats();
  const S = adventureData()?.stats;
  return m && S ? combatRating(S, m.up) : null;
}

/** "CP 1,284". */
export const cpText = (n: number) => `CP ${n.toLocaleString()}`;
