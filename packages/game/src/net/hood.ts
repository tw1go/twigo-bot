import type { HouseLook, TownHoodActionResponse, TownHoodResponse } from '@mikazuki/shared';
import type { TownMap } from '../assets/types';

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

/** Where a gate leads: this page again with ?area=hood (or without it, for the town) and ?from= (so you arrive at the
 *  way in from there), dev flags kept. */
export function areaUrl(to: 'hood' | 'town'): string {
  const url = new URL(location.href);
  url.searchParams.set('from', currentArea());
  if (to === 'hood') url.searchParams.set('area', 'hood');
  else url.searchParams.delete('area');
  return url.pathname + url.search;
}

/** Where you came from (?from=, set by a gate), read once: then tidied out of the address, so a reload starts fresh. */
export function cameFrom(): 'hood' | 'town' | null {
  const url = new URL(location.href);
  const from = url.searchParams.get('from');
  if (!from) return null;
  url.searchParams.delete('from');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  return from === 'hood' || from === 'town' ? from : null;
}

/** Which area this page is (?area=hood: the neighbourhood). */
export const currentArea = (): 'hood' | 'town' => (new URLSearchParams(location.search).get('area') === 'hood' ? 'hood' : 'town');
