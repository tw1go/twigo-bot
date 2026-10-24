import { type DerivedStats, baseStats, combatRating, derivedStats, itemTotals, withBuffs, wornItems } from '@mikazuki/shared';
import { adventure, adventureData } from '../net/adventure';
import { myBuffStats } from '../net/buffs';
import { myMainStat } from './item-tip';

// 💪 Your stats and combat rating (CP) as the stats rules have them: class, level, points and what's worn (`st`), and
// with the buffs on you (`up`). The stats box (ui/equipment.ts) and the HUD's CP (ui/townhud.ts) both read them, so
// they always agree; someone else's CP is the server's (the player box, Info).

/** Yours now (`bare`: without your pet out, so its part can be shown as its own); null until your character and the
 *  rules are in. Your pet out counts like gear (its pet tree, Fairy Cha's drop rate). */
export function myStats(): { st: DerivedStats; up: DerivedStats; bare: DerivedStats } | null {
  const s = adventure();
  const D = adventureData();
  const S = D?.stats;
  if (!s || !D || !S) return null;
  const p = s.progress;
  const worn = wornItems(s); // (a worn cosmetic with stats too: a Moonlight weapon on its class)
  const base = baseStats(S, s.cls, p.level, p.points);
  const st = derivedStats(S, s.cls, p.level, base, itemTotals(D, [...worn, ...(s.pet ? [s.pet] : [])], myMainStat(), s.cls));
  const bare = s.pet ? derivedStats(S, s.cls, p.level, base, itemTotals(D, worn, myMainStat(), s.cls)) : st;
  return { st, up: withBuffs(S, st, myBuffStats()), bare };
}

/** Your combat rating with your buffs; null until it can be worked out. */
export function myRating(): number | null {
  const m = myStats();
  const S = adventureData()?.stats;
  return m && S ? combatRating(S, m.up, adventure()?.cls) : null;
}

/** "CP 1,284". */
export const cpText = (n: number) => `CP ${n.toLocaleString()}`;
