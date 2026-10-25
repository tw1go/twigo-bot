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

/** Whether an event's decorations are up at `now` (CONTEXT.md Decoration): from their own start (`decorationsStartsAt`;
 *  none = the event's) to the event's end; `force` as isEventOn's. */
export function decorationsOn(event: EventWindow & { decorationsStartsAt?: string | null }, now: number, force = false): boolean {
  return isEventOn({ startsAt: event.decorationsStartsAt ?? event.startsAt, endsAt: event.endsAt }, now, force);
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

/** The Halloween event mobs' kinds (manifest mobs, mobs.json): Biikko Kalabasa and the Manananggal's upper half. */
export const HALLOWEEN_MOBS = { biikko: 'biikko-kalabasa', upper: 'manananggal-upper' } as const;

/** The numbers halloween.json writes in its sentences, read out (as stats.json's formulas are): how close to a player
 *  Mikko never hides (tiles), Biikko's ground level, how far its walks go (tiles) and how long it rests after each (ms),
 *  when the first Biikko and the first Manananggal round come after the start (ms), and the upper half's Claw Swipe
 *  pace (ms). */
export function halloweenRules(d: HalloweenData): { mikkoClear: number; biikkoHeight: number; wanderTiles: [number, number]; pauseMs: [number, number]; firstMs: number; upperAttackMs: number } {
  const n = (s: string) => (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  const [height, near, far, rest0, rest1] = n(d.biikko.wander); // "…on height 1 … 4-10 tiles away … pauses 3-8 s"
  return {
    mikkoClear: n(d.mikko.hideRules).at(-1) ?? 0, // "… within 6 tiles of a player when it hides"
    biikkoHeight: height,
    wanderTiles: [near, far],
    pauseMs: [rest0 * 1000, rest1 * 1000],
    firstMs: (n(d.biikko.firstSpawn)[0] ?? 0) * 60_000, // "10 minutes after the event starts"
    upperAttackMs: (n(d.manananggal.upper.attack)[0] ?? 0) * 1000, // "every 1.8 s"
  };
}

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
    hideRules: string;
    clickReach: number;
    rewards: { kowens: [number, number]; kusing: number; lowRepairKit: Chance; potion: Chance };
    announce: string;
  };
  biikko: {
    name: string;
    title: string;
    /** The maps it comes out in: one in each, each on its own schedule. */
    maps: string[];
    level: number;
    hp: number;
    speedTilesPerSec: number;
    wander: string;
    firstSpawn: string;
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
    /** A map's own items in its loot, by the item they stand in for (the Old Market's Mid Repair Kits, its Cellar Key). */
    itemsIn?: Record<string, Record<string, string>>;
    announceKill: string;
  };
  manananggal: {
    name: string;
    everyMinutes: [number, number];
    lowerStaysMinutes: number;
    lowerSpots: [number, number][];
    upper: { map: string; level: number; hp: number; speedTilesPerSec: number; attack: string };
    reuniteReach: number;
    rewards: { kowens: [number, number]; kusing: number; lowRepairKit: Chance };
    announceReunite: string;
  };
  cosmetics: Record<string, { name: string; place: 'head' | 'body'; days: number; hatKey?: string; topKey?: string; hidesBottom?: boolean }>;
  /** Its decorations (CONTEXT.md Decoration) go up from this instant (+08:00) to the event's end, whenever the event
   *  itself starts; none: with the event. */
  decorationsStartsAt?: string | null;
  /** The spiders, bats and the Kapre aren't drawn past this many tiles from you. */
  decorationNearTiles: number;
  /** The town's bats: flocks circling over a building (`over`, its id) or a tile, `lift` px up, on an ellipse. */
  townBats: { over?: string; tile?: [number, number]; lift: number; radius: [number, number]; count: number }[];
  /** The extra cobwebs in town: a web of props/halloween/webs (`web`: its name), its tile's top corner + `offset` px,
   *  `flip` for another corner ('x', 'y' or 'xy'). */
  webSpots: { tile: [number, number]; web: string; flip?: 'x' | 'y' | 'xy'; offset?: [number, number]; note?: string }[];
}

/** A house's bats this event (CONTEXT.md Decoration): from one stable hash of the event and its lot, so every player
 *  sees the same and a reload never changes it; `chance` of having any, then `count[0]`..`count[1]` of them (the same
 *  hash, spread over what's left). 0: none. */
export function houseBats(eventId: string, lot: number, chance: number, [lo, hi]: [number, number]): number {
  const h = hash01(`${eventId}:bats:${lot}`);
  if (h >= chance) return 0;
  return lo + Math.min(hi - lo, Math.floor((h / chance) * (hi - lo + 1)));
}

/** The Kapre's half-hour (`hopMinutes`) at `now` (ms, the server's clock): his tree changes with it. */
export const kapreSlot = (now: number, hopMinutes: number): number => Math.floor(now / (hopMinutes * 60_000));

/** The trees he may sit in: every one of the map's objects whose prop is one of `kinds`, sorted by tile (row, then
 *  column), so every player lists them alike. */
export function kapreTrees<T extends { id: string; col: number; row: number }>(objects: readonly T[], kinds: readonly string[]): T[] {
  return objects.filter((o) => kinds.includes(o.id)).sort((a, b) => a.row - b.row || a.col - b.col);
}

/** His tree in `slot` (an index into kapreTrees' list), or -1 with none: the same for everyone in that slot. */
export function kapreTree(count: number, slot: number): number {
  return count ? Math.min(count - 1, Math.floor(hash01(`kapre:${slot}`) * count)) : -1;
}

/** A string's FNV-1a hash, as a fraction in [0, 1) (fine-grained: the full 32 bits). */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  // (A final mix, so strings differing only in their last digits spread over the whole range.)
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
