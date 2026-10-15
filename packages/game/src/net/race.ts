import type { TownRace, TownRaceResponse } from '@mikazuki/shared';
import { api } from './endpoints';

// 🏁 The Mosang race as this page knows it (bot games/race.ts; the same race as Discord's /race): the latest state
// from the town's connection (`race` messages, also on arrival), the bot's clock (raceNow), and the calls to start one
// or bet. The town's NPCs (world/npc-life.ts), the race box (ui/race-box.ts) and the bet pop-up (ui/race-bet.ts)
// listen here.

let current: TownRace | null = null;
let offset = 0; // the bot's clock minus ours
/** Your bet on a race (by its id) and the rules, as the bot last said (the race lesson, ui/lessons.ts). */
let mine: { race: string; lane: number; amount: number } | null = null;
let rules = { maxBet: 100, payout: 4 };
/** A race this page started from an Aling's dialog box (its id), for the race lesson. */
let startedHere: string | null = null;
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
  const res = await api('/town/race', body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin' }).catch(() => null);
  const r = res?.ok ? ((await res.json()) as TownRaceResponse) : null;
  if (r) {
    rules = { maxBet: r.maxBet, payout: r.payout };
    if (r.race) mine = r.mine ? { race: r.race.id, ...r.mine } : mine?.race === r.race.id ? null : mine;
    setRace(r.race);
  }
  return r;
}

/** Your bet on this race, if any. */
export const myBet = (raceId: string | undefined): { lane: number; amount: number } | null => (raceId && mine?.race === raceId ? mine : null);
/** The bet's limits and payout (the bot's: what the bet pop-up says). */
export const raceRules = () => rules;
/** The race you started from an Aling's dialog box, if it's the one on. */
export const raceStartedHere = (): string | null => (startedHere && current?.id === startedHere ? startedHere : null);

export const loadRace = () => call();
/** Starts a race from an Aling's dialog box (she runs). */
export async function startRace(lead: string): Promise<TownRaceResponse | null> {
  const r = await call({ action: 'start', lead });
  if (r?.ok && r.race) startedHere = r.race.id;
  return r;
}
export const betOnRace = (raceId: string, lane: number, amount: number) => call({ action: 'bet', race: raceId, lane, amount });
