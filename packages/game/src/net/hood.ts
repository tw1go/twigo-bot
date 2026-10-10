import type { HouseLook, TownHoodActionResponse, TownHoodResponse } from '@mikazuki/shared';
import type { Area, TownMap } from '../assets/types';

// 🏘️ The neighbourhood's API (bot web/hood.ts; in dev the dev server answers with pretend houses, scripts/dev-town.ts),
// and its map as the town's renderer wants it.

async function json<T>(res: Response | null): Promise<T | null> {
  return res?.ok ? ((await res.json()) as T) : null;
}

export const loadHood = () => fetch('/town/hood', { credentials: 'same-origin' }).catch(() => null).then((r) => json<TownHoodResponse>(r));

const post = (path: string, body: unknown) =>
  fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .catch(() => null)
    .then((r) => json<TownHoodActionResponse>(r));

export const saveHouse = (look: HouseLook) => post('/town/house', look);
export const hoodAction = (action: 'steal' | 'key' | 'kalawang', lot: number) => post('/town/hood', { action, lot });

/** The neighbourhood's map in town.json's shape: its own ground, objects and fences, the town's forest round it (no
 *  river), and its exit as the gate back to town. */
export function hoodTownMap(hood: TownHoodResponse, town: TownMap): TownMap {
  const m = hood.map;
  return {
    size: m.size,
    ground: m.ground as TownMap['ground'],
    groundStyle: m.ground.map((row) => row.map(() => '')),
    objects: m.objects as TownMap['objects'],
    fence: m.fence,
    spawn: m.spawn,
    blocked: m.blocked,
    doors: m.doors,
    outskirts: town.outskirts && { ...town.outskirts, water: [] },
    gates: { town: m.exit },
  };
}

/** Where a gate leads: this page again with ?area=hood|slums (or without it, for the town) and ?from= (so you arrive at
 *  the way in from there), dev flags kept. Both are tidied out of the address once the page has read them. */
export function areaUrl(to: Area): string {
  const url = new URL(location.href);
  url.searchParams.set('from', currentArea());
  if (to !== 'town') url.searchParams.set('area', to);
  else url.searchParams.delete('area');
  return url.pathname + url.search;
}

/** This tab's area, remembered across reloads (sessionStorage), so the address can stay plain /play/. */
const AREA_KEY = 'mk_area';
let area: Area | null = null;
const isArea = (s: string | null): s is Area => s === 'hood' || s === 'town' || s === 'slums' || s === 'warrens';
let fresh = false;

function remember(a: Area): void {
  try {
    sessionStorage.setItem(AREA_KEY, a);
  } catch {
    // private mode: a reload starts in town
  }
}

/** Which area this page is, worked out once: ?area= (a gate's address, or a dev link; then tidied out of the
 *  address), else a gate to the town (?from= without ?area=), else this tab's area before a reload, else the town
 *  (a fresh visit). */
function resolveArea(): Area {
  if (area) return area;
  const url = new URL(location.href);
  const asked = url.searchParams.get('area');
  let before: string | null = null;
  try {
    before = sessionStorage.getItem(AREA_KEY);
  } catch {
    // private mode
  }
  if (asked) area = isArea(asked) ? asked : 'town';
  else if (url.searchParams.has('from')) area = 'town';
  else if (isArea(before)) area = before;
  else {
    area = 'town';
    fresh = true;
  }
  remember(area);
  if (asked) {
    url.searchParams.delete('area');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  return area;
}

/** A fresh visit: not through a gate and not a reload (a house owner starts at their door then). */
export const freshVisit = () => (resolveArea(), fresh);

/** This page is the neighbourhood from now on (a fresh visit with a house), so its gates know where they lead from. */
export function markHood(): void {
  resolveArea();
  area = 'hood';
  remember('hood');
}

/** Where you came from (?from=, set by a gate), read once: then tidied out of the address, so a reload starts fresh. */
export function cameFrom(): Area | null {
  const url = new URL(location.href);
  const from = url.searchParams.get('from');
  if (!from) return null;
  url.searchParams.delete('from');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  return isArea(from) ? from : null;
}

/** Which area this page is: the town, the neighbourhood, the Slums or a Scrap Warrens run (see resolveArea). */
export const currentArea = (): Area => resolveArea();

/** Back in the Slums (out of the Warrens, or none to go into): a reload starts there too. */
export function markSlums(): void {
  resolveArea();
  area = 'slums';
  remember('slums');
}

/** Back in town after all (the Slums weren't open to you): a reload starts there too. */
export function markTown(): void {
  resolveArea();
  area = 'town';
  remember('town');
}

/** The Slums' map (maps/slums.json) in the shape the town's renderer wants: no fences, doors or grass styles; the
 *  outskirts are its own junk and shanties (world/outskirts.ts slumsOutskirts), not the forest. */
export function slumsTownMap(json: TownMap): TownMap {
  return { ...json, fence: json.fence ?? [], doors: json.doors ?? {}, groundStyle: json.groundStyle ?? [], outskirts: undefined };
}
