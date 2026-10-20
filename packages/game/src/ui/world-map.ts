// 🗺️ The world map's picture as data, for both pictures of it: the Map menu (ui/map-menu.ts, M) and the quest map
// (ui/quest-map.ts, Tab). map-layout.json says where each map sits on ui-map-world.png; the Slums' map and the Town's
// say what's where (zones, mini boss spots, gates). Fetched once and kept.

export interface MapLayout {
  tilePx: number;
  origin: [number, number];
  maps: Record<string, { col: number; row: number; size: [number, number]; label?: [number, number] }>;
  /** Each map's Lantern Post, or its several (the Palengke's four: 2 × 2 posts, `tile` their top tile, with a name). */
  posts: Record<string, MapPost | MapPost[]>;
  icon: { cell: [number, number]; anchor: [number, number] };
}

export interface MapPost {
  tile: [number, number];
  px: [number, number];
  name?: string;
}

/** A map's posts as a list, and where each stands on the picture (its middle: a 2 × 2 post's shared corner). */
export function postsOf(L: MapLayout, map: string): { tile: [number, number]; name?: string; at: [number, number] | null }[] {
  const p = L.posts[map];
  if (!p) return [];
  const list = Array.isArray(p) ? p : [p];
  const mid = Array.isArray(p) ? 1 : 0.5;
  return list.map((x) => ({ tile: x.tile, name: x.name, at: worldPoint(L, map, x.tile[0] + mid, x.tile[1] + mid) }));
}

/** The picture's box with every map's diamond in it ([x0, y0, x1, y1] in the picture's pixels: below 0 where a map is
 *  off the picture's top or left, the Palengke's until it's drawn in). */
export function worldBounds(L: MapLayout, picture: [number, number]): [number, number, number, number] {
  let [x0, y0, x1, y1] = [0, 0, picture[0], picture[1]];
  for (const [id, m] of Object.entries(L.maps)) {
    for (const [c, r] of [[0, 0], [m.size[0], 0], [m.size[0], m.size[1]], [0, m.size[1]]] as const) {
      const p = worldPoint(L, id, c, r)!;
      [x0, y0, x1, y1] = [Math.min(x0, p[0]), Math.min(y0, p[1]), Math.max(x1, p[0]), Math.max(y1, p[1])];
    }
  }
  return [Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1)];
}

/** The layout moved by (dx, dy): what's drawn on a stage bigger than the picture (worldBounds). */
export const shifted = (L: MapLayout, dx: number, dy: number): MapLayout => ({ ...L, origin: [L.origin[0] + dx, L.origin[1] + dy] });

/** A Slums mob zone as the maps say it ([col0, row0, col1, row1], both ends in). */
export interface MapZone {
  id?: string;
  name?: string;
  mob?: string;
  rect: [number, number, number, number];
  miniBosses?: { id: string; tile: [number, number] }[];
}

/** What the Slums' map says that the pictures use. */
export interface SlumsPlaces {
  mobZones?: MapZone[];
  boss?: { tile?: [number, number] };
  safeZone?: [number, number, number, number];
  arrive?: Record<string, [number, number]>;
  gates?: Record<string, [number, number][]>;
}

export interface WorldMap {
  layout: MapLayout;
  slums: SlumsPlaces;
  town: { gates?: Record<string, [number, number][]> };
}

export interface WorldMapUrls {
  layout: string;
  slums: string;
  town: string;
}

let loading: Promise<WorldMap | null> | null = null;

/** The layout and both maps (null if the layout can't be had). */
export function loadWorldMap(urls: WorldMapUrls): Promise<WorldMap | null> {
  if (loading) return loading;
  const json = async <T>(url: string): Promise<T | null> => {
    const r = await fetch(url).catch(() => null);
    return r?.ok ? ((await r.json().catch(() => null)) as T | null) : null;
  };
  loading = Promise.all([json<MapLayout>(urls.layout), json<SlumsPlaces>(urls.slums), json<WorldMap['town']>(urls.town)]).then(([layout, slums, town]) =>
    layout ? { layout, slums: slums ?? {}, town: town ?? {} } : null,
  );
  // (A failed fetch is tried again next time.)
  void loading.then((w) => {
    if (!w) loading = null;
  });
  return loading;
}

/** A map's point (tile space: a tile's middle is col + 0.5) as a pixel of the picture: map-layout.json's formula. */
export function worldPoint(L: MapLayout, map: string, col: number, row: number): [number, number] | null {
  const m = L.maps[map];
  if (!m) return null;
  const c = col + m.col;
  const r = row + m.row;
  return [L.origin[0] + ((c - r) * L.tilePx) / 2, L.origin[1] + ((c + r) * L.tilePx) / 4];
}

/** A map's tile (its middle) as a pixel of the picture. */
export const worldPx = (L: MapLayout, map: string, col: number, row: number) => worldPoint(L, map, col + 0.5, row + 0.5);

/** The middle of a list of tiles (a gate's), or null. */
export function middleOf(tiles: [number, number][] | undefined): [number, number] | null {
  if (!tiles?.length) return null;
  return [tiles.reduce((n, t) => n + t[0], 0) / tiles.length, tiles.reduce((n, t) => n + t[1], 0) / tiles.length];
}
