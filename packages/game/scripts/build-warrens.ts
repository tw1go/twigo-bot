// 🕳️ Builds the Scrap Warrens' map, public/assets/maps/warrens.json, from the art folder's maze layout (copied here as
// scripts/warrens/warrens-layout.json: one character a tile, which area each tile is in, each area's rect, arena, boss
// tile, guards, checkpoint, packs and way out), in maps/slums.json's shape so the town's map loading, drawing, A* and
// depth sorting work on it; and puts the Warren Gate into maps/slums.json (its object, blocked tiles and
// arrive.warrens). Run: npx tsx scripts/build-warrens.ts (from packages/game). It checks the result with an A*-style
// flood: with every shutter open every floor tile is reachable from the arrival tile; with them shut, nobody leaves
// area 1.
//
// Tiles (the layout's legend): # a junk wall (height 1, blocked; cliff sides by its area's material, dirt-junk on top,
// now and then a small Slums trash prop on top), . corridor, B arena, S start room (safe: no mobs), G an area's way out
// (blocked until its mini boss dies: the run opens it), W the exit warp (a gate back to the Slums), K the last boss's
// body (blocked, ground like the hall, nothing on it). Floors are height 0 and flat (no ramps). Ground by area: 1 Can
// Cellar dirt-junk, 2 Skid Row mud, 3 Bag Hollow concrete, 4 Live Coils plate, 5 Drain Pools planks with some mud,
// 6 Shanty Hall concrete with plate in its middle. Street lamps stand on wall tops round each arena (the dungeon is
// darker: the game dims it).
//
// The gap: the layout's top half (areas 1–3) and bottom half (4–6, Barong-Barong's hall right under the start room)
// meet only through Bag Hollow's way out, down a 4-row band of wall. GAP_ROWS more rows of junk wall go into that band,
// that way out carrying on down them as a long tunnel into Live Coils (its area), so nothing of the bottom half (the
// hall least of all) is in view from the top. Everything below moves down with it (the last boss's tile and body from
// dungeons.json too); the art folder's layout file stays as it is.

import { readFileSync, writeFileSync } from 'node:fs';

type Tile = [number, number];
type Rect = [number, number, number, number];
interface Pack {
  cell: Tile;
  spawns: Tile[];
}
interface LayoutArea {
  index: number;
  id: string;
  name: string;
  mob: string;
  rect: Rect;
  arena: Rect;
  bossTile: Tile;
  guards: Tile[];
  checkpoint: Tile;
  packs: Pack[];
  gate?: { shutter: Tile[]; passage: Tile[]; opensTo: string };
  bossBody?: Rect;
  bossReachRadius?: number;
}
interface Layout {
  size: [number, number];
  tile: [number, number];
  projection: string;
  rows: string[];
  areaRows: string[];
  arrive: Tile;
  exitWarp: Tile[];
  areas: LayoutArea[];
}

const ROOT = new URL('../', import.meta.url);
const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, ROOT), 'utf8')) as T;
const layout = read<Layout>('scripts/warrens/warrens-layout.json');
const dungeons = read<{ warrens: { areas: { id: string; mobs: { kind: string; level: number } }[]; lastBoss: { id: string; tile: Tile; body: Rect; reachRadius: number }; entry: { warp: { tile: Tile; footprint: [number, number]; arrive: Tile } } } }>('public/assets/classes/dungeons.json').warrens;

/** Rows of junk wall added between the top and bottom halves (see the gap, above), and the layout's row they go in
 *  before (the bottom half's first). */
const GAP_ROWS = 40;
const GAP_AT = layout.areaRows.reduce((last, row, r) => (/[123]/.test(row) ? r : last), 0) + 1; // (the row after the top half's last, its way down included)
{
  const below = (r: number) => (r >= GAP_AT ? r + GAP_ROWS : r);
  const tile = ([c, r]: Tile): Tile => [c, below(r)];
  // The band's way down: the columns of the row just above that aren't wall, carried on as corridor of the area below.
  const above = layout.rows[GAP_AT - 1];
  const open = [...above].map((ch, c) => (ch !== '#' ? c : -1)).filter((c) => c >= 0);
  const into = Number(layout.areaRows[GAP_AT]?.[open[0]]) || layout.areaRows[GAP_AT - 1][open[0]];
  const row = [...'#'.repeat(above.length)].map((ch, c) => (open.includes(c) ? '.' : ch)).join('');
  const areaRow = [...'-'.repeat(above.length)].map((ch, c) => (open.includes(c) ? String(into) : ch)).join('');
  layout.rows.splice(GAP_AT, 0, ...Array.from({ length: GAP_ROWS }, () => row));
  layout.areaRows.splice(GAP_AT, 0, ...Array.from({ length: GAP_ROWS }, () => areaRow));
  layout.size = [layout.size[0], layout.size[1] + GAP_ROWS];
  for (const a of layout.areas) {
    a.rect = [a.rect[0], below(a.rect[1]), a.rect[2], below(a.rect[3])];
    // A bottom area's rect starts below the gap, unless the way down is in it (Live Coils: the tunnel is its).
    if (a.index >= 4 && a.rect[1] < GAP_AT && !open.some((c) => c >= a.rect[0] && c <= a.rect[2])) a.rect[1] += GAP_ROWS;
    a.arena = [a.arena[0], below(a.arena[1]), a.arena[2], below(a.arena[3])];
    a.bossTile = tile(a.bossTile);
    a.guards = a.guards.map(tile);
    a.checkpoint = tile(a.checkpoint);
    for (const p of a.packs) p.spawns = p.spawns.map(tile);
    if (a.gate) a.gate = { ...a.gate, shutter: a.gate.shutter.map(tile), passage: a.gate.passage.map(tile) };
    if (a.bossBody) a.bossBody = [a.bossBody[0], below(a.bossBody[1]), a.bossBody[2], below(a.bossBody[3])];
  }
  const B = dungeons.lastBoss;
  dungeons.lastBoss = { ...B, tile: tile(B.tile), body: [B.body[0], below(B.body[1]), B.body[2], below(B.body[3])] };
}

const [COLS, ROWS] = layout.size;
const at = (c: number, r: number) => (r >= 0 && r < ROWS && c >= 0 && c < COLS ? layout.rows[r][c] : '#');
const areaOf = (c: number, r: number) => Number(layout.areaRows[r]?.[c]) || 0;

/** A small seeded number (0–1) for a tile and a salt: the same map every build. */
function hash(c: number, r: number, salt: number): number {
  let h = (Math.imul(c + 1, 0x27d4eb2d) ^ Math.imul(r + 1, 0x165667b1) ^ Math.imul(salt + 7, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Each area's ground, and its walls' cliff material (the Slums' earth, concrete and corrugated sheet). */
const GROUND: Record<number, string> = { 1: 'dirt-junk', 2: 'mud', 3: 'concrete', 4: 'plate', 5: 'planks', 6: 'concrete' };
const WALL: Record<number, string> = { 1: 'earth', 2: 'earth', 3: 'concrete', 4: 'sheet', 5: 'concrete', 6: 'sheet' };
/** Which area's rect a tile is in (walls have no area of their own in areaRows). */
const rectArea = (c: number, r: number) => layout.areas.find((a) => c >= a.rect[0] && c <= a.rect[2] && r >= a.rect[1] && r <= a.rect[3])?.index ?? 1;

const hall = layout.areas.find((a) => a.index === 6)!;
const [hc0, hr0, hc1, hr1] = hall.arena;
const hallMid: [number, number] = [(hc0 + hc1) / 2 + 2, (hr0 + hr1) / 2 + 2];

const ground: string[][] = [];
const height: number[][] = [];
const walls: string[][] = [];
const blocked: number[][] = [];
for (let r = 0; r < ROWS; r++) {
  ground.push([]);
  height.push([]);
  walls.push([]);
  blocked.push([]);
  for (let c = 0; c < COLS; c++) {
    const ch = at(c, r);
    const wall = ch === '#';
    const area = wall ? rectArea(c, r) : areaOf(c, r) || rectArea(c, r);
    let g = GROUND[area] ?? 'dirt-junk';
    if (wall) g = 'dirt-junk';
    else if (area === 5 && hash(c, r, 5) < 0.25) g = 'mud'; // planks with some mud
    else if (area === 6 && ch !== 'K' && Math.hypot(c - hallMid[0], r - hallMid[1]) < 6) g = 'plate'; // the hall's middle
    ground[r].push(g);
    height[r].push(wall ? 1 : 0);
    walls[r].push(wall ? (WALL[area] ?? 'earth') : '');
    blocked[r].push(wall || ch === 'K' || ch === 'G' ? 1 : 0);
  }
}

// ── Objects: small trash on wall tops, street lamps round each arena, the exit warp ──
const objects: { kind: string; id: string; col: number; row: number; footprint: [number, number]; animated?: boolean; flip?: boolean }[] = [];
const TRASH = ['slums-cardboard', 'slums-cinder-blocks'];
/** A wall tile with a wall on every side but the camera's: its top shows (not a thin wall's side). */
const solidWall = (c: number, r: number) => at(c, r) === '#';
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++) {
    if (!solidWall(c, r) || hash(c, r, 1) >= 1 / 6) continue;
    objects.push({ kind: 'prop', id: TRASH[Math.floor(hash(c, r, 2) * TRASH.length)], col: c, row: r, footprint: [1, 1], flip: hash(c, r, 3) < 0.5 });
  }
// Lamps: 2 to 4 on wall tiles just outside each arena's floor (touching it), spread round it.
const taken = new Set(objects.map((o) => `${o.col},${o.row}`));
for (const a of layout.areas) {
  const [c0, r0, c1, r1] = a.arena;
  const rim: Tile[] = [];
  for (let r = r0 - 1; r <= r1 + 1; r++)
    for (let c = c0 - 1; c <= c1 + 1; c++) {
      if (!solidWall(c, r)) continue;
      const touches = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => at(c + dc, r + dr) === 'B');
      if (touches) rim.push([c, r]);
    }
  const want = 2 + Math.floor(hash(a.index, 0, 9) * 3);
  const step = rim.length / want;
  for (let k = 0; k < want && rim.length; k++) {
    const [c, r] = rim[Math.floor(k * step + step / 2) % rim.length];
    // (A lamp replaces any trash on its tile.)
    for (let i = objects.length - 1; i >= 0; i--) if (objects[i].col === c && objects[i].row === r) objects.splice(i, 1);
    objects.push({ kind: 'prop', id: 'lamp-on', col: c, row: r, footprint: [1, 1] });
    taken.add(`${c},${r}`);
  }
}
// The exit warp: the Warren Gate's art (its portal animated) over the 2x2 warp, on its own tiles (walkable: walking
// onto the warp takes you out).
const warp = layout.exitWarp;
const wc0 = Math.min(...warp.map((t) => t[0]));
const wr0 = Math.min(...warp.map((t) => t[1]));
objects.push({ kind: 'prop', id: 'warren-exit', col: wc0 - 1, row: wr0 - 1, footprint: [3, 3] });

// ── The dungeon block ──
const startTiles: Tile[] = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (at(c, r) === 'S' || at(c, r) === 'W') startTiles.push([c, r]);
const isStart = (c: number, r: number) => at(c, r) === 'S' || at(c, r) === 'W';
const seal: Tile[] = [];
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++) {
    if (isStart(c, r) || blocked[r][c]) continue;
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dc, dr]) => isStart(c + dc, r + dr));
    if (near) seal.push([c, r]);
  }
const areas = layout.areas.map((a) => {
  const arenaTiles: Tile[] = [];
  for (let r = a.arena[1]; r <= a.arena[3]; r++) for (let c = a.arena[0]; c <= a.arena[2]; c++) if (at(c, r) === 'B') arenaTiles.push([c, r]);
  return { index: a.index, id: a.id, name: a.name, mob: a.mob, rect: a.rect, arena: a.arena, arenaTiles, bossTile: a.bossTile, guards: a.guards, checkpoint: a.checkpoint };
});
const shutters = layout.areas
  .filter((a) => a.gate)
  .map((a) => {
    const g = a.gate!;
    // The art runs bottom left to top right (one col, rows down); a shutter along one row runs the other way: flipped.
    const flip = g.shutter.every((t) => t[1] === g.shutter[0][1]);
    return { area: a.id, opensTo: g.opensTo, tiles: g.shutter, passage: g.passage, flip };
  });
const boss = dungeons.lastBoss;

// ── Mob zones: each area's mobs (its dungeon level from dungeons.json), their packs' spawns ──
const mobZones = layout.areas.map((a) => {
  const d = dungeons.areas.find((x) => x.id === a.id);
  return {
    id: a.id,
    name: a.name,
    mob: a.mob,
    level: d?.mobs.level ?? 19,
    rect: a.rect,
    height: 0,
    active: true,
    dungeon: true,
    spawns: a.packs.flatMap((p) => p.spawns),
    groups: a.packs.map((p) => p.spawns),
  };
});

const groundKey = read<{ groundKey: Record<string, string> }>('public/assets/maps/slums.json').groundKey;
const map = {
  version: 1,
  size: layout.size,
  tile: layout.tile,
  projection: layout.projection,
  ground,
  groundKey,
  height,
  heightNote: 'Ground level per tile: 0 = the maze floor, 1 = its junk walls (raised, blocked). No ramps.',
  walls,
  wallsNote: "Wall material for a raised tile's visible walls (tile-slums-cliff-<material>-l|r-N.png, variant seeded by col,row).",
  ramps: [],
  objects,
  blocked,
  gates: { slums: warp },
  arrive: { slums: layout.arrive },
  spawn: layout.arrive,
  safeZone: [Math.min(...startTiles.map((t) => t[0])), Math.min(...startTiles.map((t) => t[1])), Math.max(...startTiles.map((t) => t[0])), Math.max(...startTiles.map((t) => t[1]))],
  mobZones,
  dungeon: { areas, shutters, startTiles, seal, exitWarp: warp, boss: { id: boss.id, tile: boss.tile, body: boss.body, reachRadius: boss.reachRadius } },
  notes: 'The Scrap Warrens: built by scripts/build-warrens.ts from scripts/warrens/warrens-layout.json (the art folder\'s maps/warrens). Each run is its own copy; the shutters (dungeon.shutters, their passage tiles blocked here) open as each area\'s mini boss dies.',
};

// ── Checks: reachability with every shutter open, and with them shut ──
function flood(open: (c: number, r: number) => boolean): Set<string> {
  const seen = new Set<string>([`${layout.arrive[0]},${layout.arrive[1]}`]);
  const queue: Tile[] = [layout.arrive];
  for (let i = 0; i < queue.length; i++) {
    const [c, r] = queue[i];
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const [nc, nr] = [c + dc, r + dr];
      if (seen.has(`${nc},${nr}`) || !open(nc, nr)) continue;
      if (dc && dr && (!open(c + dc, r) || !open(c, r + dr))) continue; // no cut corners (the game's grid)
      seen.add(`${nc},${nr}`);
      queue.push([nc, nr]);
    }
  }
  return seen;
}
const inside = (c: number, r: number) => c >= 0 && r >= 0 && c < COLS && r < ROWS;
const passages = new Set(shutters.flatMap((s) => s.passage.map((t) => `${t[0]},${t[1]}`)));
const allOpen = flood((c, r) => inside(c, r) && (!blocked[r][c] || passages.has(`${c},${r}`)));
const floor: string[] = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (at(c, r) !== '#' && at(c, r) !== 'K') floor.push(`${c},${r}`);
const unreached = floor.filter((k) => !allOpen.has(k));
if (unreached.length) throw new Error(`With every shutter open, ${unreached.length} floor tiles can't be reached: ${unreached.slice(0, 8).join(' ')}`);
const shut = flood((c, r) => inside(c, r) && !blocked[r][c]);
const area1 = layout.areas[0].rect;
const out = [...shut].filter((k) => {
  const [c, r] = k.split(',').map(Number);
  return !(c >= area1[0] && c <= area1[2] && r >= area1[1] && r <= area1[3]);
});
if (out.length) throw new Error(`With the shutters shut, ${out.length} tiles outside area 1 can be reached: ${out.slice(0, 8).join(' ')}`);
// Nothing on the boss's body or the floor but lamps and trash on walls.
for (const o of objects) if (o.id !== 'warren-exit' && at(o.col, o.row) !== '#') throw new Error(`${o.id} on a floor tile ${o.col},${o.row}`);

writeFileSync(new URL('public/assets/maps/warrens.json', ROOT), JSON.stringify(map));
console.log(`maps/warrens.json: ${COLS}x${ROWS}, ${floor.length} floor tiles (all reachable with the shutters open, ${shut.size} with them shut, all in area 1), ${objects.length} objects, ${shutters.length} shutters, ${mobZones.reduce((n, z) => n + z.spawns.length, 0)} mob spawns, seal ${seal.length} tiles`);

// ── The Warren Gate in the Slums ──
const slumsUrl = new URL('public/assets/maps/slums.json', ROOT);
const slums = JSON.parse(readFileSync(slumsUrl, 'utf8')) as {
  objects: { kind: string; id: string; col: number; row: number; footprint: [number, number] }[];
  blocked: number[][];
  height: number[][];
  arrive: Record<string, Tile>;
  mobZones: { rect?: Rect }[];
};
const gate = dungeons.entry.warp;
const [gc, gr] = gate.tile;
const [fw, fh] = gate.footprint;
const top: Tile = [gc - Math.floor(fw / 2), gr - Math.floor(fh / 2)];
slums.objects = slums.objects.filter((o) => o.id !== 'slums-warren-gate');
for (let r = top[1]; r < top[1] + fh; r++)
  for (let c = top[0]; c < top[0] + fw; c++) {
    if (slums.height[r][c] !== slums.height[gr][gc]) throw new Error(`The Warren Gate's tile ${c},${r} isn't flat ground`);
    if (slums.mobZones.some((z) => z.rect && c >= z.rect[0] && c <= z.rect[2] && r >= z.rect[1] && r <= z.rect[3])) throw new Error(`The Warren Gate's tile ${c},${r} is in a mob zone`);
    slums.blocked[r][c] = 1;
  }
slums.objects.push({ kind: 'prop', id: 'slums-warren-gate', col: top[0], row: top[1], footprint: [fw, fh] });
slums.arrive.warrens = gate.arrive;
writeFileSync(slumsUrl, JSON.stringify(slums));
console.log(`maps/slums.json: the Warren Gate at ${gc},${gr} (tiles ${top[0]}-${top[0] + fw - 1}, ${top[1]}-${top[1] + fh - 1}), arrive.warrens ${gate.arrive}`);
