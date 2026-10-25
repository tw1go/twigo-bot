// 🏮 Lantern Posts: teleporting between maps (the Town, the Slums, the Lumang Palengke) and between the posts of one map
// (the Palengke has four) for one Return Lantern. A map with one post has a `lantern-post` object and its
// `arrive.lanternPost` (where a teleport lands); a map with several lists them as `teleporters` (each a 2 × 2 post, its
// landing worked out here: the nearest walkable tile in front of it). A teleport can also land at a dungeon's way in (the
// Warren Gate, the Cellar Hatch: DUNGEON_ENTRANCES), listed after a map's posts, but never leave from one. The Map menu's
// picture of the maps is the game's ui/map/map-layout.json. The rules both sides check: how near a post you must be, and
// why not.

/** The maps with Lantern Posts. */
export const LANTERN_MAPS = ['town', 'slums', 'palengke'] as const;
export type LanternMap = (typeof LANTERN_MAPS)[number];
export const isLanternMap = (x: unknown): x is LanternMap => (LANTERN_MAPS as readonly unknown[]).includes(x);

/** The Return Lantern's item id (items/items.json). */
export const RETURN_LANTERN = 'return-lantern';
/** Clicking a post walks you this near (tiles, Chebyshev) before its Map menu opens. */
export const LANTERN_WALK_TILES = 2;
/** How near a post you must stay to use it: further, its menu closes and the server refuses. */
export const LANTERN_USE_TILES = 3;

/** A Lantern Post: its top tile and size (its footprint, `size` × `size` tiles), where a teleport to it lands, and its
 *  name on a map with several. `entrance`: not a post but a dungeon's way in (CONTEXT.md Dungeon entrance), listed after a
 *  map's posts: a teleport can land there (beside it, where its runs let you out), never leave from it. */
export interface LanternPost {
  tile: [number, number];
  arrive: [number, number];
  size?: number;
  name?: string;
  entrance?: DungeonEntrance;
}

/** The dungeons' ways in a teleport can land at: the map object, the `arrive` it lands on, its name. */
export const DUNGEON_ENTRANCES = [
  { id: 'warrens', object: 'slums-warren-gate', arrive: 'warrens', name: 'Warren Gate' },
  { id: 'silong', object: 'palengke-silong-hatch', arrive: 'silong', name: 'Cellar Hatch' },
] as const;
export type DungeonEntrance = (typeof DUNGEON_ENTRANCES)[number]['id'];

/** What the post rules read of a map. */
export interface LanternMapData {
  objects?: { id: string; col: number; row: number; kind?: string }[];
  arrive?: Partial<Record<string, [number, number]>>;
  teleporters?: { id: string; name: string; tile: [number, number] }[];
  blocked?: number[][];
}

/** A teleporters' post's size (tiles a side). */
const POST_SIZE = 2;

/** Where a teleport to a post of `size` at `tile` lands: the nearest walkable tile round it, the ones in front first (a
 *  higher col + row is nearer the camera), so you land facing it; its top tile if nothing round it is walkable. */
export function postLanding(blocked: number[][] | undefined, tile: [number, number], size = POST_SIZE): [number, number] {
  const [c0, r0] = tile;
  const open = (c: number, r: number) => r >= 0 && c >= 0 && r < (blocked?.length ?? 0) && c < (blocked?.[r]?.length ?? 0) && !blocked![r][c];
  for (let ring = 1; ring <= LANTERN_WALK_TILES + 1; ring++) {
    const round: [number, number][] = [];
    for (let r = r0 - ring; r <= r0 + size - 1 + ring; r++)
      for (let c = c0 - ring; c <= c0 + size - 1 + ring; c++) {
        const d = Math.max(c0 - c, c - (c0 + size - 1), r0 - r, r - (r0 + size - 1));
        if (d === ring && open(c, r)) round.push([c, r]);
      }
    // In front first (the most col + row), then nearest the post's middle, then by col for a stable pick.
    const mid = (c0 + c0 + size - 1) / 2;
    round.sort((a, b) => b[0] + b[1] - (a[0] + a[1]) || Math.abs(a[0] - mid) - Math.abs(b[0] - mid) || a[0] - b[0]);
    if (round.length) return round[0];
  }
  return [c0, r0];
}

/** A map's Lantern Posts: its `teleporters` (each with its landing), else its one `lantern-post` object and
 *  `arrive.lanternPost`; none: []. Then its dungeon entrances (DUNGEON_ENTRANCES: the object and its `arrive`), which a
 *  teleport can land at but not leave from. */
export function lanternPostsOf(map: LanternMapData): LanternPost[] {
  const o = map.objects?.find((x) => x.id === 'lantern-post');
  const arrive = map.arrive?.lanternPost;
  const posts: LanternPost[] = map.teleporters?.length
    ? map.teleporters.map((t) => ({ tile: t.tile, arrive: postLanding(map.blocked, t.tile), size: POST_SIZE, name: t.name }))
    : o && arrive ? [{ tile: [o.col, o.row], arrive }] : [];
  if (!posts.length) return posts; // (a map without a post is no teleport's way in)
  for (const e of DUNGEON_ENTRANCES) {
    const at = map.objects?.find((x) => x.id === e.object);
    const land = map.arrive?.[e.arrive];
    if (at && land) posts.push({ tile: [at.col, at.row], arrive: land, name: e.name, entrance: e.id });
  }
  return posts;
}

/** `blocked` with every teleporter's footprint blocked too (a post is in the way; the art folder's map leaves one open). */
export function blockedWithPosts(blocked: number[][], teleporters: LanternMapData['teleporters']): number[][] {
  if (!teleporters?.length) return blocked;
  const out = blocked.map((row) => [...row]);
  for (const t of teleporters)
    for (let r = t.tile[1]; r < t.tile[1] + POST_SIZE; r++)
      for (let c = t.tile[0]; c < t.tile[0] + POST_SIZE; c++) if (out[r]?.[c] !== undefined) out[r][c] = 1;
  return out;
}

/** A map's first Lantern Post, or null: it has none. */
export const lanternPostOf = (map: LanternMapData): LanternPost | null => lanternPostsOf(map)[0] ?? null;

/** Whether (col, row) is within `tiles` of the post's footprint (Chebyshev). */
export function nearPost(post: LanternPost, col: number, row: number, tiles = LANTERN_USE_TILES): boolean {
  const s = (post.size ?? 1) - 1;
  const dc = Math.max(post.tile[0] - col, col - (post.tile[0] + s), 0);
  const dr = Math.max(post.tile[1] - row, row - (post.tile[1] + s), 0);
  return Math.max(dc, dr) <= tiles;
}

/** The post of `posts` you're at (within `tiles`), nearest first; -1: none. A dungeon entrance is never one (you can't
 *  teleport from it). */
export function postAt(posts: LanternPost[], col: number, row: number, tiles = LANTERN_USE_TILES): number {
  let best = -1;
  let bestD = Infinity;
  posts.forEach((p, i) => {
    if (p.entrance || !nearPost(p, col, row, tiles)) return;
    const d = Math.hypot(col - p.tile[0], row - p.tile[1]);
    if (d < bestD) [best, bestD] = [i, d];
  });
  return best;
}

/** Why a teleport can't go (null: it can). `from` and `posts`: the map they're on and its posts; `to` and `toPost`: where
 *  to (its first post when not given); `toPosts`: how many posts that map has. */
export function lanternRefusal(o: {
  from: string;
  to: unknown;
  toPost?: unknown;
  toPosts?: number;
  posts: LanternPost[];
  at: [number, number];
  inCombat: boolean;
  out: boolean;
  lanterns: number;
}): string | null {
  if (!isLanternMap(o.to)) return "There's no Lantern Post there.";
  const toPost = o.toPost ?? 0;
  if (typeof toPost !== 'number' || !Number.isInteger(toPost) || toPost < 0 || toPost >= (o.toPosts ?? 1)) return "There's no Lantern Post there.";
  const here = postAt(o.posts, o.at[0], o.at[1]);
  if (here < 0) return 'Walk up to a Lantern Post first.';
  if (o.to === o.from && toPost === here) return "You're already there.";
  if (o.out) return "You can't travel while you're knocked out.";
  if (o.inCombat) return "Can't travel during a fight.";
  if (o.lanterns < 1) return 'You need a Return Lantern.';
  return null;
}

/** When a map opens (ms; its json's `opensAt`, an ISO time with its offset), or null when it's open already or always
 *  was (CONTEXT.md Opening time): before then only Game Masters go in. */
export function mapOpensAt(map: { opensAt?: string | null }, now: number): number | null {
  const at = map.opensAt ? Date.parse(map.opensAt) : NaN;
  return Number.isFinite(at) && at > now ? at : null;
}

/** "The Old Market opens Oct 26 at 9:00 AM (Philippine time)." */
export function opensLine(name: string, at: number): string {
  const when = new Date(at);
  const day = when.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });
  const time = when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
  return `${name} opens ${day} at ${time} (Philippine time).`;
}
