import { MOB_DEBUFF_KEYS, type StatsData, buffMpCost, buffValue } from '@mikazuki/shared';
import { seconds } from '../combat/cooldowns';

// 📜 A buff in plain words at a skill level, every number from stats.json skills.buffs (combat-guide.md "Buffs"):
// "+8% ATK for 5 min, you and one ally", "+8% crit rate, permanent stance", "Heals you and your party for 80% of ATK";
// and its MP and cooldown ("35 MP · 10s cooldown"). Only the words live here.

/** Each stat key as words around its value (a fraction, read as a %; a taunt in seconds). The mob-side ones are a
 *  debuff's (CONTEXT.md Debuff): what it does to the mob it's on. */
const STAT: Record<string, (v: number) => string> = {
  atkPct: (v) => `${signed(v)} ATK`,
  maxHpPct: (v) => `${signed(v)} max HP`,
  defPct: (v) => `${signed(v)} DEF`,
  defRate: (v) => `${signed(v)} DEF rate`,
  amp: (v) => `${signed(v)} damage amp`,
  critRate: (v) => `${signed(v)} crit rate`,
  critDamage: (v) => `${signed(v)} crit damage`,
  accuracy: (v) => `−${pct(v)}% miss chance`,
  evasion: (v) => `+${pct(v)}% evasion (mobs miss you more)`,
  hpRegenPctPerSec: (v) => `${pct(v)}% max HP regen a second`,
  hpDrainPctPerSec: (v) => `−${pct(v)}% max HP a second (never under 10%)`,
  cooldownPct: (v) => `−${pct(v)}% damage skill cooldowns`,
  mpRegenPct: (v) => `+${pct(v)}% MP regen`,
  moveSpeedPct: (v) => `+${pct(v)}% move speed`,
  damageTakenPct: (v) => `${signed(v)} damage taken`,
  missChance: (v) => `+${pct(v)}% miss chance`,
  mobDamagePct: (v) => `${signed(v)} damage dealt`,
  slow: (v) => `slowed to ${pct(v)}% speed`,
  taunt: (v) => `fights you for ${seconds(v)}, then stays on you`,
};

/** A fraction as a signed percentage: "+8%", "−15%". */
const signed = (v: number) => `${v < 0 ? '−' : '+'}${pct(Math.abs(v))}%`;

const WHO: Record<string, string> = { self: 'you', 'ally+self': 'you and one ally (whoever you picked, else a party member)', party: 'you, your party and whoever you picked' };

/** 0.104 → "10.4" (a fraction as a percentage, to a tenth at most). */
const pct = (v: number) => String(Math.round(v * 1000) / 10);

/** "5 min", or seconds when it isn't whole minutes. */
const lasts = (s: number) => (s % 60 ? seconds(s) : `${s / 60} min`);

/** A buff's stats as short lines for the tray ("+8% ATK"); a heal has none. */
export function buffStatLines(stats: Record<string, number>): string[] {
  return Object.entries(stats).flatMap(([k, n]) => (STAT[k] ? [STAT[k](n)] : []));
}

/** What a buff does at a skill level, in one line; null for an unknown buff. */
export function buffText(data: StatsData, name: string, skillLevel = 1): string | null {
  const b = data.skills.buffs?.list[name];
  if (!b) return null;
  const v = buffValue(data, name, skillLevel);
  // (A one-ally buff shared like a party buff: stats.json skills.buffs.rules.allyBuffsReachParty.)
  const shared = b.target === 'ally+self' && !!(data.skills.buffs?.rules as { allyBuffsReachParty?: boolean } | undefined)?.allyBuffsReachParty;
  const who = WHO[shared ? 'party' : b.target] ?? 'you';
  if (v.healPctOfPower !== undefined) return `Heals ${who} for ${pct(v.healPctOfPower)}% of ATK`;
  const words = (e: [string, number][]) => e.map(([k, n]) => STAT[k]?.(n) ?? `${k} ${n}`).join(', ');
  // A debuff: on your target (else the nearest) in its range, or every mob round you (tauntAround); its own part, if any.
  if (b.debuff) {
    const { tauntAround, ...rest } = v;
    const all = Object.entries(rest);
    const onMob = words(all.filter(([k]) => (MOB_DEBUFF_KEYS as readonly string[]).includes(k)));
    const mine = words(all.filter(([k]) => !(MOB_DEBUFF_KEYS as readonly string[]).includes(k)));
    const whom = tauntAround ? `Every mob within ${tauntAround} tile${tauntAround === 1 ? '' : 's'} of you` : `Your target within ${b.rangeTiles ?? 1} tile${b.rangeTiles === 1 ? '' : 's'} (else the nearest)`;
    const time = b.durationSec ? ` for ${lasts(b.durationSec)}` : '';
    return `${whom}: ${onMob}${time}${mine ? `; you: ${mine}${time}` : ''}`;
  }
  const stats = words(Object.entries(v));
  if (b.durationSec === null) return `${stats}, ${b.stance ? 'permanent stance' : 'permanent'}`;
  return `${stats} for ${lasts(b.durationSec)}, ${who}`;
}

/** Its MP and cooldown at a skill level: "35 MP · 10s cooldown". */
export function buffCostText(data: StatsData, name: string, skillLevel = 1): string {
  const b = data.skills.buffs?.list[name];
  const mp = buffMpCost(data, name, skillLevel);
  return [mp ? `${mp} MP` : 'No MP', b ? `${seconds(b.cooldownSec)} cooldown` : ''].filter(Boolean).join(' · ');
}
