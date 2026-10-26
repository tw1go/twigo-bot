import type { HouseLook, TownHoodActionResponse, TownHoodResponse } from '@mikazuki/shared';
import { api } from './endpoints';
import { blockedWithPosts } from '@mikazuki/shared';
import type { Area, TownMap, Vec2 } from '../assets/types';

// 🏘️ The neighbourhood's API (bot web/hood.ts; in dev the dev server answers with pretend houses, scripts/dev-town.ts),
// and its map as the town's renderer wants it.

async function json<T>(res: Response | null): Promise<T | null> {
  return res?.ok ? ((await res.json()) as T) : null;
}

export const loadHood = () => api('/town/hood', { credentials: 'same-origin' }).catch(() => null).then((r) => json<TownHoodResponse>(r));

const post = (path: string, body: unknown) =>
  api(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .catch(() => null)
    .then((r) => json<TownHoodActionResponse>(r));

export const saveHouse = (look: HouseLook) => post('/town/house', look);
export const hoodAction = (action: 'steal' | 'key' | 'kalawang', lot: number) => post('/town/hood', { action, lot });
/** Become a rogue (`on`) or quit being one. */
export const rogueAction = (on: boolean) => post('/town/rogue', { on });

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

/** Where a gate leads: this page again with ?area=hood|slums|palengke (or without it, for the town) and ?from= (so you
 *  arrive at the way in from there), dev flags kept; `via` 'lantern': a teleport (?via=lantern: you arrive at the Lantern
 *  Post; &post=N which of the map's, when it has several). They're tidied out of the address once the page has read them. */
export function areaUrl(to: Area, via?: 'lantern', post = 0): string {
  const url = new URL(location.href);
  url.searchParams.set('from', currentArea());
  if (via) url.searchParams.set('via', via);
  else url.searchParams.delete('via');
  if (via && post) url.searchParams.set('post', String(post));
  else url.searchParams.delete('post');
  if (to !== 'town') url.searchParams.set('area', to);
  else url.searchParams.delete('area');
  return url.pathname + url.search;
}

/** This tab's area, remembered across reloads (sessionStorage), so the address can stay plain /play/. */
const AREA_KEY = 'mk_area';
let area: Area | null = null;
const isArea = (s: string | null): s is Area => s === 'hood' || s === 'town' || s === 'slums' || s === 'warrens' || s === 'palengke' || s === 'silong-b1' || s === 'silong-b2' || s === 'silong-b3';
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

/** A fresh visit: not through a gate and not a reload (it starts at the resume spot then: CONTEXT.md Resume spot). */
export const freshVisit = () => (resolveArea(), fresh);

/** A fresh visit's start, out of a dungeon (CONTEXT.md Resume spot): the way in it lands at, as walking out of it does. */
let resumedFrom: Area | null = null;

/** A fresh visit starts where they last were (CONTEXT.md Resume spot; shared resumeStart): this page is that area from
 *  now on (a reload stays there), and out of a dungeon (`from`) it lands at its way out, as if through it. */
export function markResume(to: Area, from?: Area): void {
  resolveArea();
  area = to;
  remember(to);
  resumedFrom = from ?? null;
}

/** Where you came from (?from=, set by a gate; or a fresh visit's resume spot out of a dungeon), read once: then tidied
 *  out of the address, so a reload starts fresh. */
export function cameFrom(): Area | null {
  const url = new URL(location.href);
  const from = url.searchParams.get('from');
  if (!from) {
    const resumed = resumedFrom;
    resumedFrom = null;
    return resumed;
  }
  url.searchParams.delete('from');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  return isArea(from) ? from : null;
}

/** Which Lantern Post you came by (?via=lantern, set by a teleport, and &post=N; 0: the map's first), or null: not by a
 *  teleport. Read once: then tidied out of the address. */
export function cameByLantern(): number | null {
  const url = new URL(location.href);
  const via = url.searchParams.get('via');
  if (!via) return null;
  const post = Number(url.searchParams.get('post') ?? 0);
  url.searchParams.delete('via');
  url.searchParams.delete('post');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  return via === 'lantern' ? (Number.isInteger(post) && post >= 0 ? post : 0) : null;
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

/** The Lumang Palengke's map (maps/palengke.json) as a big map like the Slums', with its own ground set (tiles.palengke)
 *  and its Lantern Posts: each of its `teleporters` blocked (2 × 2: the art folder's map leaves one open) and drawn as the
 *  town's Lantern Post on its front tile (the map's `teleporter` objects are left out: one is missing there). */
export function palengkeTownMap(json: TownMap): TownMap {
  const base = slumsTownMap(json);
  const posts = json.teleporters ?? [];
  return {
    ...base,
    tileset: 'palengke',
    blocked: blockedWithPosts(json.blocked, posts),
    objects: [
      ...json.objects.filter((o) => (o as { kind: string }).kind !== 'teleporter'),
      ...posts.map((t) => ({ kind: 'prop' as const, id: 'lantern-post', col: t.tile[0] + 1, row: t.tile[1] + 1, footprint: [1, 1] as Vec2, animated: true })),
    ],
  };
}

/** One of Ang Silong's floors (maps/silong-b1..b3.json): a big map like the Slums', its own ground set (tiles.silong)
 *  and walls; its elevators' cages and doors are drawn by world/silong.ts (they change), not as the map's props. */
export function silongTownMap(json: TownMap): TownMap {
  const drawn = /^silong-(elevator-(open|closed)|door-(closed|open))$/;
  const own = (o: { id?: string }) => drawn.test(o.id ?? '') || o.id === 'silong-elevator-plate';
  return { ...slumsTownMap(json), tileset: 'silong', objects: json.objects.filter((o) => !own(o)), silongDrawn: json.objects.filter(own) };
}

/** Into the Palengke (a reload starts there too). */
export function markPalengke(): void {
  resolveArea();
  area = 'palengke';
  remember('palengke');
}
