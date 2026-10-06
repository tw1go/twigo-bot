import type { TownRace, TownRaceResponse } from '@mikazuki/shared';

// 🏁 The Mosang race as this page knows it (bot games/race.ts; the same race as Discord's /race): the latest state
// from the town's connection (`race` messages, also on arrival), the bot's clock (raceNow), and the calls to start one
// or bet. The town's NPCs (world/npc-life.ts), the race box (ui/race-box.ts) and the bet pop-up (ui/race-bet.ts)
// listen here.

let current: TownRace | null = null;
let offset = 0; // the bot's clock minus ours
const listeners = new Set<(race: TownRace | null) => void>();

export const race = (): TownRace | null => current;

/** Now, on the bot's clock (race times are the bot's). */
export const raceNow = (): number => Date.now() + offset;

/** From the town's connection (or an answer from /town/race). */
export function setRace(r: TownRace | null): void {
  if (r) offset = r.now - Date.now();
  current = r;
  for (const fn of listeners) fn(r);
}

export function onRace(fn: (race: TownRace | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function call(body?: unknown): Promise<TownRaceResponse | null> {
  const res = await fetch('/town/race', body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin' }).catch(() => null);
  const r = res?.ok ? ((await res.json()) as TownRaceResponse) : null;
  if (r) setRace(r.race);
  return r;
}

export const loadRace = () => call();
/** Starts a race from an Aling's dialog box (she runs). */
export const startRace = (lead: string) => call({ action: 'start', lead });
export const betOnRace = (raceId: string, lane: number, amount: number) => call({ action: 'bet', race: raceId, lane, amount });
