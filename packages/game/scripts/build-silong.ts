// ❄️ Builds Ang Silong's three floors, public/assets/maps/silong-b1.json, -b2.json and -b3.json, from the art folder's
// floor layouts (copied here as scripts/silong/silong-floors.json: one character a tile, each floor's rooms, bosses,
// packs, lamps, pallets and marks) and the rules in classes/dungeons.json `silong`, in maps/warrens.json's shape with
// `tileset: "silong"`, so the town's map loading, drawing (world/terrain.ts: the walls as raised ground with the
// Silong's wall faces), A* and depth sorting work on them. Run: npx tsx scripts/build-silong.ts (from packages/game).
//
// Tiles (the layout's legend): # a wall (height 2, blocked; walltop on top, its faces by cliffs.wall), . c D S B w floor
// (B1 bodega, B2-B3 frost, the cold rooms Old Canteen / Meat Lockers / Walk-in Freezer freezer), i ice, W an ice tank
// (blocked), > < conveyor belts (animated), E the elevator you arrive in, X the elevator down (blocked until the floor's
// mini bosses fall: the run opens it), G a cold-room door (blocked until its boss falls), = shelves, T tables, h hook
// rails, L work lamps, R Mang Ramon's box (all blocked), P pallets (walkable), K the last boss's body (blocked, nothing
// drawn: the boss is), w the stairs up (a gate back to the Palengke). Props by legend; a seeded scatter of frozen junk
// (about 1 floor tile in 30, against the walls, off the paths). Each floor is checked with a flood like the game's walk
// (8 ways, no cut corners): every open tile is reachable from the arrival with X and G shut, except the Ice Plant on
// B3, which is reachable only once its door opens.

import { readFileSync, writeFileSync } from 'node:fs';

type Tile = [number, number];
type Rect = [number, number, number, number];
interface FloorLayout {
  index: number;
  name: string;
  rows: string[];
  rooms: { id: string; name: string; rect: Rect; mob: string; boss: string | null }[];
  bosses: { name: string; room: string; tile: Tile }[];
  packs: Tile[][];
  lamps: Tile[];
  pallets: Tile[];
  marks: { arrive: Tile; exit?: Tile; ramonBox?: Tile; bossTile?: Tile };
}
interface SilongRoom {
  id: string;
  name: string;
  rect: Rect;
  mobs: { kind: string; art: string; level: number };
  packs: Tile[][];
  miniBoss?: { id: string; name: string; tile: Tile };
}
interface SilongData {
  floors: { index: number; id: string; name: string; level: number; rooms: SilongRoom[] }[];
  lastBoss: { id: string; name: string; tile: Tile };
}

const ROOT = new URL('../', import.meta.url);
const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, ROOT), 'utf8')) as T;
const layout = read<{ seed: number; floorSize: [number, number]; tile: [number, number]; floors: FloorLayout[] }>('scripts/silong/silong-floors.json');
const silong = read<{ silong: SilongData }>('public/assets/classes/dungeons.json').silong;
const props = read<{ props: Record<string, { footprint?: [number, number] }> }>('public/assets/manifest.json').props;
const [COLS, ROWS] = layout.floorSize;
const STEPS: Tile[] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
/** The cold rooms, floored in freezer tiles. */
const FREEZERS = new Set(['canteen', 'lockers', 'walk-in']);
/** Walkable legend characters (X and G open later: the run's). */
const OPEN = new Set(['.', 'c', 'D', 'S', 'B', 'w', 'i', 'E', 'P', '>', '<']);
const SCATTER_B1 = ['silong-crate-plastic', 'silong-crate-stack', 'silong-boxes', 'silong-sack'];
const SCATTER = ['silong-frost-drift', 'silong-crate-plastic', 'silong-crate-stack', 'silong-boxes', 'silong-ice-stalagmite', 'silong-tub-frozen', 'silong-pipe-valve', 'silong-ice-block-fish', 'silong-ice-block-jar', 'silong-bucket', 'silong-gas-tank', 'silong-cans'];
const SCATTER_EVERY = 30; // about one floor tile in this many

/** A seeded number in [0, 1) for a tile and a purpose (the same every build). */
function hash(floor: number, c: number, r: number, salt: number): number {
  let h = (layout.seed * 374761393 + floor * 668265263 + c * 2246822519 + r * 3266489917 + salt * 2654435761) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const key = ([c, r]: Tile) => `${c},${r}`;
const inRect = ([c, r]: Tile, [c0, r0, c1, r1]: Rect) => c >= c0 && c <= c1 && r >= r0 && r <= r1;

/** The tiles reachable from `from` over open tiles (8 ways, no cut corners: the game's grid). */
function flood(from: Tile, open: (c: number, r: number) => boolean): Set<string> {
  const seen = new Set([key(from)]);
  const queue: Tile[] = [from];
  for (let i = 0; i < queue.length; i++) {
    const [c, r] = queue[i];
    for (const [dc, dr] of STEPS) {
      const [nc, nr] = [c + dc, r + dr];
      if (seen.has(`${nc},${nr}`) || !open(nc, nr)) continue;
      if (dc && dr && (!open(c + dc, r) || !open(c, r + dr))) continue;
      seen.add(`${nc},${nr}`);
      queue.push([nc, nr]);
    }
  }
  return seen;
}

/** The bounding rect of some tiles, and its middle tile. */
const bounds = (tiles: Tile[]): Rect => [Math.min(...tiles.map((t) => t[0])), Math.min(...tiles.map((t) => t[1])), Math.max(...tiles.map((t) => t[0])), Math.max(...tiles.map((t) => t[1]))];
const middle = ([c0, r0, c1, r1]: Rect): Tile => [Math.floor((c0 + c1) / 2), Math.floor((r0 + r1) / 2)];

/** Groups of tiles of one character joined side by side (the E block, each door). */
function blocks(rows: string[], ch: string): Tile[][] {
  const seen = new Set<string>();
  const out: Tile[][] = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (rows[r][c] !== ch || seen.has(`${c},${r}`)) continue;
      const group = flood([c, r], (x, y) => rows[y]?.[x] === ch);
      for (const k of group) seen.add(k);
      out.push([...group].map((k) => k.split(',').map(Number) as Tile));
    }
  return out;
}

for (const L of layout.floors) {
  const F = silong.floors.find((f) => f.index === L.index);
  if (!F) throw new Error(`No floor ${L.index} in dungeons.json silong.floors`);
  const rows = L.rows;
  if (rows.length !== ROWS || rows.some((row) => row.length !== COLS)) throw new Error(`${F.id}: the layout isn't ${COLS}x${ROWS}`);
  const at = (c: number, r: number) => rows[r]?.[c] ?? '#';
  const tilesOf = (ch: string): Tile[] => {
    const out: Tile[] = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (at(c, r) === ch) out.push([c, r]);
    return out;
  };
  const roomOf = (c: number, r: number) => F.rooms.find((room) => inRect([c, r], room.rect));

  // ── Ground, height, walls, blocked ──
  const ground: string[][] = [];
  const height: number[][] = [];
  const walls: string[][] = [];
  const blocked: number[][] = [];
  const floorKind = (c: number, r: number) => (F.index === 1 ? 'bodega' : FREEZERS.has(roomOf(c, r)?.id ?? '') ? 'freezer' : 'frost');
  for (let r = 0; r < ROWS; r++) {
    ground.push([]);
    height.push([]);
    walls.push([]);
    blocked.push([]);
    for (let c = 0; c < COLS; c++) {
      const ch = at(c, r);
      const kind = ch === '#' ? 'walltop' : ch === 'i' ? 'ice' : ch === 'W' ? 'tank' : ch === '>' ? 'belt-e' : ch === '<' ? 'belt-w' : ch === 'E' ? 'elevator-arrive' : ch === 'X' ? 'elevator-down' : floorKind(c, r);
      ground[r].push(kind);
      height[r].push(ch === '#' ? 2 : 0);
      walls[r].push('wall');
      blocked[r].push(OPEN.has(ch) ? 0 : 1);
    }
  }

  // ── Objects ──
  type Obj = { kind: 'prop'; id: string; col: number; row: number; footprint: [number, number]; flip?: boolean };
  const objects: Obj[] = [];
  const prop = (id: string, col: number, row: number, flip = false) => {
    const fp = props[id]?.footprint ?? [1, 1];
    if (!props[id]) throw new Error(`No manifest prop ${id}`);
    objects.push({ kind: 'prop', id, col, row, footprint: fp, ...(flip ? { flip: true } : {}) });
  };
  for (const [c, r] of tilesOf('=')) prop(hash(F.index, c, r, 1) < 0.5 ? 'silong-jar-shelf' : 'silong-sacks-pile', c, r, hash(F.index, c, r, 2) < 0.5);
  for (const [c, r] of tilesOf('T')) prop('silong-table', c, r);
  // Hook rails on every other tile of each run (all of it stays blocked).
  for (const [c, r] of tilesOf('h')) if ((c + r) % 2 === 0 || (at(c - 1, r) !== 'h' && at(c, r - 1) !== 'h' && at(c + 1, r) !== 'h' && at(c, r + 1) !== 'h')) prop('silong-hook-rail', c, r);
  for (const [c, r] of tilesOf('L')) prop('silong-work-lamp', c, r);
  for (const [c, r] of tilesOf('P')) prop('silong-pallet', c, r);
  for (const [c, r] of tilesOf('R')) prop('silong-crate-wood', c, r);
  // The doors: one in the middle of each G block (its face runs along the rows: top right to bottom left).
  const doorBlocks = blocks(rows, 'G');
  for (const b of doorBlocks) {
    const [mc, mr] = middle(bounds(b));
    prop('silong-door-closed', mc, mr - 1);
  }
  // The elevators: the floor plate and its cage (open where you arrive, shut where it goes down) in the middle of each
  // block (the cage is 3x3; the blocks are bigger).
  const cage = (tiles: Tile[], id: string) => {
    const [mc, mr] = middle(bounds(tiles));
    prop('silong-elevator-plate', mc - 1, mr - 1);
    prop(id, mc - 1, mr - 1);
  };
  const arrive = tilesOf('E');
  const down = tilesOf('X');
  if (arrive.length) cage(arrive, 'silong-elevator-open');
  if (down.length) cage(down, 'silong-elevator-closed');

  // Chairs by the canteen's tables, then the scatter: each kept only if every open tile stays reachable.
  const arriveMark = L.marks.arrive;
  const openNow = (c: number, r: number) => c >= 0 && r >= 0 && c < COLS && r < ROWS && !blocked[r][c];
  const reachAll = () => {
    const seen = flood(arriveMark, (c, r) => openNow(c, r) || at(c, r) === 'G');
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (!blocked[r][c] && !seen.has(`${c},${r}`)) return false;
    return true;
  };
  const keep = new Set<string>([key(arriveMark), ...L.packs.flat().map(key), ...L.bosses.map((b) => key(b.tile)), ...(L.marks.ramonBox ? [key(L.marks.ramonBox)] : [])]);
  const nearDoor = (c: number, r: number) => STEPS.some(([dc, dr]) => at(c + dc, r + dr) === 'D') || at(c, r) === 'D';
  const tryBlock = (c: number, r: number, id: string, walkable = false): boolean => {
    if (!walkable) {
      blocked[r][c] = 1;
      if (!reachAll()) {
        blocked[r][c] = 0;
        return false;
      }
    }
    prop(id, c, r, hash(F.index, c, r, 7) < 0.5);
    keep.add(`${c},${r}`);
    return true;
  };
  for (const [c, r] of tilesOf('.')) {
    if (keep.has(`${c},${r}`) || nearDoor(c, r)) continue;
    const byTable = STEPS.slice(0, 4).some(([dc, dr]) => at(c + dc, r + dr) === 'T');
    if (byTable && hash(F.index, c, r, 3) < 0.3) tryBlock(c, r, hash(F.index, c, r, 4) < 0.8 ? 'silong-chair' : 'silong-chair-tipped');
  }
  const floorCount = tilesOf('.').length + tilesOf('c').length + tilesOf('S').length + tilesOf('B').length + tilesOf('D').length;
  const againstWall = (c: number, r: number) => STEPS.slice(0, 4).some(([dc, dr]) => at(c + dc, r + dr) === '#' || at(c + dc, r + dr) === '=');
  const spots = tilesOf('.').filter(([c, r]) => !keep.has(`${c},${r}`) && !nearDoor(c, r) && againstWall(c, r) && !objects.some((o) => o.col === c && o.row === r));
  const want = floorCount / SCATTER_EVERY;
  const chance = Math.min(1, want / Math.max(1, spots.length));
  const pool = F.index === 1 ? SCATTER_B1 : SCATTER;
  let scattered = 0;
  for (const [c, r] of spots) {
    if (hash(F.index, c, r, 5) >= chance) continue;
    // (Not next to another scattered piece: a few apart.)
    if (STEPS.some(([dc, dr]) => objects.some((o) => o.col === c + dc && o.row === r + dr && pool.includes(o.id)))) continue;
    const id = pool[Math.floor(hash(F.index, c, r, 6) * pool.length)];
    if (tryBlock(c, r, id, id === 'silong-frost-drift')) scattered++;
  }

  // ── Mob zones: each room with packs, its kind (B2-B3's frost sheets: the room's `art`), its level ──
  const mobZones = F.rooms
    .filter((room) => room.packs.length)
    .map((room) => {
      const art = /^mobs\/silong\/([a-z-]+)/.exec(room.mobs.art)?.[1];
      return { id: room.id, name: room.name, mob: art ?? room.mobs.kind, level: room.mobs.level, rect: room.rect, height: 0, active: true, dungeon: true, spawns: room.packs.flat(), groups: room.packs };
    });

  // ── The silong block ──
  const bossOf = (room: SilongRoom) =>
    room.miniBoss ? { id: room.miniBoss.id, tile: room.miniBoss.tile } : L.bosses.find((b) => b.room === room.id && b.name === silong.lastBoss.name) ? { id: silong.lastBoss.id, tile: L.marks.bossTile ?? silong.lastBoss.tile, last: true } : null;
  const block = {
    floor: F.id,
    index: F.index,
    name: F.name,
    level: F.level,
    rooms: F.rooms.map((room) => ({
      id: room.id,
      name: room.name,
      rect: room.rect,
      mob: mobZones.find((z) => z.id === room.id)?.mob ?? (/^mobs\/silong\/([a-z-]+)/.exec(room.mobs.art)?.[1] ?? room.mobs.kind),
      boss: bossOf(room),
      bossTiles: tilesOf('B').filter((t) => inRect(t, room.rect)),
    })),
    arrive,
    arriveMark,
    down,
    doors: doorBlocks.map((tiles) => ({ room: F.rooms.find((room) => room.miniBoss && tiles.some((t) => STEPS.some(([dc, dr]) => inRect([t[0] + dc, t[1] + dr], room.rect))))?.id ?? '', tiles })),
    exit: tilesOf('w'),
    safe: tilesOf('S'),
    lamps: L.lamps,
    pallets: L.pallets,
    ice: tilesOf('i'),
    belts: { e: tilesOf('>'), w: tilesOf('<') },
    ramonBox: L.marks.ramonBox ?? null,
    bossBody: tilesOf('K'),
    bossTile: L.marks.bossTile ?? null,
  };
  for (const d of block.doors) if (!d.room) throw new Error(`${F.id}: a door at ${key(d.tiles[0])} isn't by a boss room`);

  // ── Checks ──
  const check = (ok: boolean, why: string) => {
    if (!ok) throw new Error(`${F.id}: ${why}`);
  };
  check(at(...arriveMark) === 'E', `the arrival ${key(arriveMark)} isn't an E tile`);
  for (const t of [...L.packs.flat(), ...L.bosses.map((b) => b.tile)]) check(!blocked[t[1]][t[0]], `the pack or boss tile ${key(t)} isn't open`);
  for (const room of F.rooms) if (room.miniBoss) check(!blocked[room.miniBoss.tile[1]][room.miniBoss.tile[0]], `${room.miniBoss.id}'s tile isn't open`);
  const shut = flood(arriveMark, openNow);
  const doorsOpen = flood(arriveMark, (c, r) => openNow(c, r) || at(c, r) === 'G');
  const open: Tile[] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (!blocked[r][c]) open.push([c, r]);
  const plant = F.rooms.find((room) => room.id === 'plant');
  const unreached = open.filter((t) => !doorsOpen.has(key(t)));
  check(!unreached.length, `${unreached.length} open tiles can't be reached even with the doors open: ${unreached.slice(0, 8).map(key).join(' ')}`);
  if (plant) {
    const leaked = open.filter((t) => inRect(t, plant.rect) && shut.has(key(t)));
    check(!leaked.length, `the Ice Plant can be reached with its door shut: ${leaked.slice(0, 5).map(key).join(' ')}`);
    const behind = open.filter((t) => !shut.has(key(t)));
    check(behind.every((t) => inRect(t, plant.rect)), `with the door shut, tiles outside the Ice Plant can't be reached: ${behind.filter((t) => !inRect(t, plant.rect)).slice(0, 5).map(key).join(' ')}`);
  } else {
    const behind = open.filter((t) => !shut.has(key(t)));
    check(!behind.length, `${behind.length} open tiles can't be reached: ${behind.slice(0, 8).map(key).join(' ')}`);
  }
  for (const t of block.exit) check(shut.has(key(t)), `the stairs up ${key(t)} can't be reached`);
  // Every X tile is next to a reachable tile (the elevator can be walked into once it opens).
  if (down.length) check(down.some(([c, r]) => STEPS.some(([dc, dr]) => shut.has(`${c + dc},${r + dr}`))), 'the elevator down is out of reach');

  const groundKey: Record<string, string> = {
    bodega: 'tiles/silong/tile-silong-bodega-N.png (B1 floors)',
    frost: 'tiles/silong/tile-silong-frost-N.png (B2-B3 floors)',
    freezer: 'tiles/silong/tile-silong-freezer-N.png (the cold rooms: Old Canteen, Meat Lockers, Walk-in Freezer)',
    ice: 'tiles/silong/tile-silong-ice-N.png (walkable, slippery)',
    tank: 'tiles/silong/tile-silong-tank-N.png (ice-tank water, blocked)',
    walltop: 'tiles/silong/tile-silong-walltop-N.png (the top of a wall, 2 levels up)',
    'belt-e': 'tiles/silong/tile-silong-belt-e.png (4-frame strip: a conveyor running east, col +1)',
    'belt-w': 'tiles/silong/tile-silong-belt-w.png (4-frame strip: a conveyor running west, col -1)',
    'elevator-arrive': 'tiles/silong/tile-silong-elevator-1.png (the elevator you arrive in, E)',
    'elevator-down': 'tiles/silong/tile-silong-elevator-2.png (the elevator down, X)',
  };
  const safe = [...arrive, ...block.safe];
  const map = {
    version: 1,
    size: [COLS, ROWS],
    tile: layout.tile,
    projection: 'isometric 2:1',
    tileset: 'silong',
    ground,
    groundKey,
    height,
    heightNote: 'Ground level per tile: 0 = the floor, 2 = its walls (raised, blocked). No ramps.',
    walls,
    wallsNote: "Wall material for a raised tile's visible walls (tiles.silong cliffs.wall: tile-silong-wall-l|r-N.png, variant seeded by col,row).",
    ramps: [],
    objects,
    blocked,
    gates: F.index === 1 ? { palengke: block.exit } : {},
    arrive: { ...(F.index === 1 ? { palengke: arriveMark } : {}), elevator: arriveMark },
    spawn: arriveMark,
    safeZone: bounds(safe),
    mobZones,
    silong: block,
    notes: `Ang Silong ${F.name}: built by scripts/build-silong.ts from scripts/silong/silong-floors.json (the art folder's silong/data). Each run is its own copy; the elevator down (silong.down, blocked here) opens as the floor's mini bosses fall, a cold-room door (silong.doors, blocked) as its boss falls.`,
  };
  writeFileSync(new URL(`public/assets/maps/silong-${F.id}.json`, ROOT), JSON.stringify(map));
  console.log(`maps/silong-${F.id}.json: ${open.length} open tiles (${shut.size} with the doors shut), ${objects.length} objects (${scattered} scattered), ${mobZones.length} mob zones (${mobZones.reduce((n, z) => n + z.spawns.length, 0)} mobs), ${block.rooms.filter((r) => r.boss).length} bosses, elevator ${arrive.length} / ${down.length} tiles, ${doorBlocks.length} doors`);
}
