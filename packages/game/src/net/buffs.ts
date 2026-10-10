import { type TownBuff, buffTotals } from '@mikazuki/shared';
import { adventureData } from './adventure';

// ✨ The buffs on you, as the server last said (its `buffs` message): the buff tray, the stats box and your Calm Mind
// follow them. Each one's end is turned into this clock's time when it comes (null: a stance).

export type MyBuff = TownBuff & { endsAt: number | null };

let on: MyBuff[] = [];
const subs = new Set<() => void>();

export function setMyBuffs(list: TownBuff[]): void {
  const now = Date.now();
  on = list.map((b) => ({ ...b, endsAt: b.ms === null ? null : now + b.ms }));
  for (const f of subs) f();
}

/** The buffs on you now (those run out dropped). */
export const myBuffs = (): MyBuff[] => on.filter((b) => b.endsAt === null || b.endsAt > Date.now());

/** As one set of stats, by the server's rule (buffTotals: added up, or each stat's strongest). */
export const myBuffStats = (): Record<string, number> => buffTotals(adventureData()?.stats, myBuffs());

/** Calls `f` whenever they change; returns the unsubscribe. */
export function onMyBuffs(f: () => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}
