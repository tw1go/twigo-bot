import { type StatsData, buffMpCost, buffValue } from '@mikazuki/shared';
import { seconds } from '../combat/cooldowns';

// 📜 A buff in plain words at a skill level, every number from stats.json skills.buffs (combat-guide.md "Buffs"):
// "+8% ATK for 5 min, you and one ally", "+8% crit rate, permanent stance", "Heals you and your party for 80% of ATK";
// and its MP and cooldown ("35 MP · 10s cooldown"). Only the words live here.

/** Each stat key as words around its number (a % of itself, or points, which read as a %). */
const STAT: Record<string, (n: string) => string> = {
  atkPct: (n) => `+${n}% ATK`,
  maxHpPct: (n) => `+${n}% max HP`,
  defPct: (n) => `+${n}% DEF`,
  defRate: (n) => `+${n}% DEF rate`,
  amp: (n) => `+${n}% damage amp`,
  critRate: (n) => `+${n}% crit rate`,
  accuracy: (n) => `−${n}% miss chance`,
  hpRegenPctPerSec: (n) => `${n}% max HP regen a second`,
  cooldownPct: (n) => `−${n}% damage skill cooldowns`,
};

const WHO: Record<string, string> = { self: 'you', 'ally+self': 'you and one ally (whoever you picked, else a party member)', party: 'you, your party and whoever you picked' };

/** 0.104 → "10.4" (a fraction as a percentage, to a tenth at most). */
const pct = (v: number) => String(Math.round(v * 1000) / 10);

/** "5 min", or seconds when it isn't whole minutes. */
const lasts = (s: number) => (s % 60 ? seconds(s) : `${s / 60} min`);

/** A buff's stats as short lines for the tray ("+8% ATK"); a heal has none. */
export function buffStatLines(stats: Record<string, number>): string[] {
  return Object.entries(stats).flatMap(([k, n]) => (STAT[k] ? [STAT[k](pct(n))] : []));
}

/** What a buff does at a skill level, in one line; null for an unknown buff. */
export function buffText(data: StatsData, name: string, skillLevel = 1): string | null {
  const b = data.skills.buffs?.list[name];
  if (!b) return null;
  const v = buffValue(data, name, skillLevel);
  const who = WHO[b.target] ?? 'you';
  if (v.healPctOfPower !== undefined) return `Heals ${who} for ${pct(v.healPctOfPower)}% of ATK`;
  const stats = Object.entries(v).map(([k, n]) => STAT[k]?.(pct(n)) ?? `${k} ${n}`).join(', ');
  if (b.durationSec === null) return `${stats}, ${b.stance ? 'permanent stance' : 'permanent'}`;
  return `${stats} for ${lasts(b.durationSec)}, ${who}`;
}

/** Its MP and cooldown at a skill level: "35 MP · 10s cooldown". */
export function buffCostText(data: StatsData, name: string, skillLevel = 1): string {
  const b = data.skills.buffs?.list[name];
  const mp = buffMpCost(data, name, skillLevel);
  return [mp ? `${mp} MP` : 'No MP', b ? `${seconds(b.cooldownSec)} cooldown` : ''].filter(Boolean).join(' · ');
}
