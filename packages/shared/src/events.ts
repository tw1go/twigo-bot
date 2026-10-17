// 🎃 Events (CONTEXT.md Event, Event window): limited-time happenings, each with its own rules file under the game's
// assets (events/<id>.json, read by the bot and the game alike). The window's start and end carry their own offset
// ("+08:00", Philippine time), so they're instants: never read in the server's or the player's own time zone.

/** An event's window: `startsAt` null = off. */
export interface EventWindow {
  startsAt: string | null;
  endsAt: string;
}

/** Whether an event is on at `now` (ms): startsAt <= now < endsAt. `force` (dev's ?halloween=on) turns it on whatever
 *  its start, until its end. */
export function isEventOn(event: EventWindow, now: number, force = false): boolean {
  const end = Date.parse(event.endsAt);
  if (!Number.isFinite(end) || now >= end) return false;
  if (force) return true;
  if (!event.startsAt) return false;
  const start = Date.parse(event.startsAt);
  return Number.isFinite(start) && start <= now;
}

/** When an event began (ms), or null while it's off (forced on: `forcedAt`, when that was). */
export function eventStart(event: EventWindow, forcedAt?: number): number | null {
  if (forcedAt !== undefined) return forcedAt;
  const start = event.startsAt ? Date.parse(event.startsAt) : NaN;
  return Number.isFinite(start) ? start : null;
}

/** "Nov 4": the day an event ends, in Philippine time (its own). */
export function eventEndDay(event: EventWindow): string {
  return new Date(Date.parse(event.endsAt)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });
}

/** A whole number from [min, max] (both in), or the number itself. */
export function rollRange(range: number | [number, number], random: () => number): number {
  if (typeof range === 'number') return range;
  const [a, b] = range;
  return a + Math.floor(random() * (b - a + 1));
}

/** One of a list, equal chances. */
export const pickOne = <T>(list: readonly T[], random: () => number): T => list[Math.min(list.length - 1, Math.floor(random() * list.length))];

/** A chance of `count` (a number or a range), as halloween.json writes it. */
export interface Chance {
  chance: number;
  count: number | [number, number];
}

/** The Discord buff potions an event gives (the bot's potions: Swerte Elixir, Tago Tonic, Kalawang Potion). */
export type EventPotion = 'swerte' | 'tago' | 'kalawang';

/** Their names (the bot's potions/potions.ts POTIONS: a test keeps them the same) and their 32 px picture. */
export const EVENT_POTIONS: Record<EventPotion, { name: string; icon: string }> = {
  swerte: { name: 'Swerte Elixir', icon: 'ui/items/item-potion-swerte@32.png' },
  tago: { name: 'Tago Tonic', icon: 'ui/items/item-potion-tago@32.png' },
  kalawang: { name: 'Kalawang Potion', icon: 'ui/items/item-potion-kalawang@32.png' },
};

/** events/halloween.json (CONTEXT.md Mikko Kalabasa, Biikko Kalabasa, Manananggal). */
export interface HalloweenData extends EventWindow {
  id: string;
  name: string;
  potions: EventPotion[];
  mikko: {
    name: string;
    maps: string[];
    respawnMinutes: [number, number];
    clickReach: number;
    rewards: { kowens: [number, number]; kusing: number; lowRepairKit: Chance; potion: Chance };
    announce: string;
  };
  biikko: {
    name: string;
    title: string;
    map: string;
    level: number;
    hp: number;
    speedTilesPerSec: number;
    healAfterSecondsUnhit: number;
    respawnMinutes: [number, number];
    loot: {
      openAfterSeconds: number;
      kowens: [number, number];
      kusing: number;
      lowRepairKit: Chance;
      potion: Chance;
      warrenTicket: Chance;
      witchCosmetic: { chance: number; pick: string[]; days: number };
    };
    announceKill: string;
  };
  manananggal: {
    name: string;
    everyMinutes: [number, number];
    lowerStaysMinutes: number;
    lowerSpots: [number, number][];
    upper: { map: string; level: number; hp: number; speedTilesPerSec: number };
    reuniteReach: number;
    rewards: { kowens: [number, number]; kusing: number; lowRepairKit: Chance };
    announceReunite: string;
  };
  cosmetics: Record<string, { name: string; place: 'head' | 'body'; days: number; hatKey?: string; topKey?: string; hidesBottom?: boolean }>;
}
