// 🏮 Lantern Posts: teleporting between maps (the Town, the Slums) for one Return Lantern. A post is a map object
// (`lantern-post`) with its map's `arrive.lanternPost` (where a teleport lands); the Map menu's picture of the maps is
// the game's ui/map/map-layout.json. The rules both sides check: how near a post you must be, and why not.

/** The maps with a Lantern Post. */
export const LANTERN_MAPS = ['town', 'slums'] as const;
export type LanternMap = (typeof LANTERN_MAPS)[number];
export const isLanternMap = (x: unknown): x is LanternMap => (LANTERN_MAPS as readonly unknown[]).includes(x);

/** The Return Lantern's item id (items/items.json). */
export const RETURN_LANTERN = 'return-lantern';
/** Clicking a post walks you this near (tiles, Chebyshev) before its Map menu opens. */
export const LANTERN_WALK_TILES = 2;
/** How near a post you must stay to use it: further, its menu closes and the server refuses. */
export const LANTERN_USE_TILES = 3;

/** A map's Lantern Post: its tile, and where a teleport to it lands. */
export interface LanternPost {
  tile: [number, number];
  arrive: [number, number];
}

/** A map's Lantern Post (its `lantern-post` object and `arrive.lanternPost`), or null: it has none. */
export function lanternPostOf(map: { objects?: { id: string; col: number; row: number }[]; arrive?: Record<string, [number, number]> }): LanternPost | null {
  const o = map.objects?.find((x) => x.id === 'lantern-post');
  const arrive = map.arrive?.lanternPost;
  return o && arrive ? { tile: [o.col, o.row], arrive } : null;
}

/** Whether (col, row) is within `tiles` of the post (Chebyshev). */
export const nearPost = (post: LanternPost, col: number, row: number, tiles = LANTERN_USE_TILES): boolean =>
  Math.max(Math.abs(col - post.tile[0]), Math.abs(row - post.tile[1])) <= tiles;

/** Why a teleport can't go (null: it can). `from`: the map they're on; `post`: its Lantern Post (null: none there). */
export function lanternRefusal(o: {
  from: string;
  to: unknown;
  post: LanternPost | null;
  at: [number, number];
  inCombat: boolean;
  out: boolean;
  lanterns: number;
}): string | null {
  if (!isLanternMap(o.to)) return "There's no Lantern Post there.";
  if (o.to === o.from) return "You're already there.";
  if (!o.post || !nearPost(o.post, o.at[0], o.at[1])) return 'Walk up to a Lantern Post first.';
  if (o.out) return "You can't travel while you're knocked out.";
  if (o.inCombat) return "Can't travel during a fight.";
  if (o.lanterns < 1) return 'You need a Return Lantern.';
  return null;
}
