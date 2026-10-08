// Shapes of public/assets/manifest.json and public/assets/maps/town.json — only the parts the game reads.
// The JSON files are the source of truth; nothing here hard-codes sizes, anchors or positions.

export type Vec2 = [number, number];

export interface AnimSheet {
  file: string;
  frames: number;
  frameSize: Vec2;
  fps: number;
  loop?: boolean;
}

export interface Manifest {
  tiles: {
    grass: {
      files: string[];
      size: Vec2;
      anchor: Vec2;
      mix: { plain: number; tall: number; flowers: number };
      animated: Record<string, AnimSheet & { replaces: string }>;
      litter: { files: string[]; size: Vec2; anchor: Vec2 };
    };
    path: { files: string[]; size: Vec2; anchor: Vec2 };
    plaza: { files: string[]; size: Vec2; anchor: Vec2; mix: Record<string, number> };
    water: {
      size: Vec2;
      frames: number;
      fps: number;
      anchor: Vec2;
      variants: string[];
      overlays: Record<string, { file: string; land: Vec2 } | string>;
    };
    /** The Slums' ground and raised-ground pieces (world/terrain.ts; rules in the manifest's note). */
    slums?: SlumsTiles;
  };
  buildings: Record<string, BuildingDef>;
  props: Record<string, PropDef> & { fence: FenceDef; 'tree-tufts': { files: string[]; size: Vec2 } };
  characters: CharacterDefs;
  /** The six classes' art (data in classes/classes.json): combat poses, resting weapons, launch points. */
  classes?: ClassesDefs;
  /** The quests file, and the colour of each quest type. */
  quests?: { file: string; colours: Record<'main' | 'side', string> };
  /** Equipment items (items/equipment.json). */
  equipment?: { file: string };
  /** The town's ambient NPCs (world/npcs.ts): flat pre-baked sheets, not paper dolls. */
  npcs?: NpcDefs;
  fx: Record<string, FxDef>;
  /** Mobs (world/mobs.ts): sheets per variant, animation and direction; `data` = their rules file (mobs/mobs.json). */
  mobs?: Record<string, MobDef | string>;
  /** Item art by id (dig items and /redeem rewards), only for the ids that have art. */
  items?: Record<string, ItemArtDef>;
  /** Players' houses in the neighbourhood (houses/art.ts): layered and recoloured per slot. */
  houses?: { parts: string; swatches: string; size: Vec2; footprint: Vec2; footprintTopCorner: Vec2; footprintBottomCorner: Vec2 };
  ui: Record<string, { file?: string; size?: Vec2; frames?: number | string[] | Record<string, number>; fps?: number; anchor?: Vec2 }> & {
    inventory?: { slot?: string; selected?: string; nineSlice?: number; itemFrame?: { file: string; nineSlice: number } };
    nameplate?: { file: string; self: string; threeSlice: number; height: number };
    speechBubble?: { file: string; nineSlice: number; tail: string; tailAnchor: Vec2 };
    chatWindow?: { file: string; nineSlice: number; input?: { file: string; focus: string; nineSlice: number } };
    shovelIcon?: { file: string; size: Vec2 };
    /** The news button's megaphone, beside Settings. */
    newsIcon?: { file: string; size: Vec2 };
    /** The tutorial button's icon (ui/guide.ts); a "?" without it. */
    tutorialIcon?: { file: string; size: Vec2 };
    /** The Arena's jack en poy (scenes/ArenaScene.ts): hands, VS, round pips, menu icons, speed lines. */
    jnpHands?: { file: string; size: Vec2; frames: number };
    vs?: { file: string; size: Vec2; frames: number; fps: number };
    jnpPips?: { file: string; size: Vec2; frames: number };
    arenaModes?: { file: string; size: Vec2; frames: number };
    vsSpeedlines?: { file: string; size: Vec2 };
    /** The arena's spectators: one cheering loop per file (front-facing, feet at `anchor`). */
    arenaViewers?: { files: string[]; size: Vec2; frames: number; fps: number; anchor: Vec2 };
    /** The jackpot counter's icon (top right; optional: the Kowen coin stands in). */
    jackpotIcon?: { file: string; size: Vec2 };
    /** The Casino's Kara y Krus: the flip for the side the coin lands on (each ending on that face, the coin at rest).
     *  The siren and coin burst are fx (siren, coin-burst). */
    coinFlip?: { sides: Record<'kara' | 'krus', string>; size: Vec2; frames: number; fps: number; anchor: Vec2 };
    tanodBust?: { file: string; size: Vec2; frames: number; fps: number; anchor: Vec2 };
    casinoFelt?: { file: string; size: Vec2; nineSlice: number };
    /** The quest button's scroll (HUD). */
    questIcon?: { file: string; size: Vec2 };
    /** Empty equipment slots: one grey 16x16 silhouette per slot, in `frames` order. */
    equipSlots?: { file: string; size: Vec2; frames: string[] };
    /** Round class badges, {class} = the class id: `file` 32x32, `small` 16x16 (chat, avatar), `large` 64x64 (cards). */
    /** Skill icons (32 px): file with {class} and {skill} (the name slugged); have = the ones there are, per class. */
    skillIcons?: { file: string; size: Vec2; have: Record<string, string[]>; shared?: { file: string; skills: string[] } };
    classIcons?: { file: string; small: string; large: string; size: Vec2; smallSize: Vec2; largeSize: Vec2 };
    /** The inventory button's bag, beside the chat input. */
    inventoryIcon?: { file: string; size: Vec2 };
    loadingMoon?: { file: string; size: Vec2; frames: number; fps: number; loopFrames?: Vec2; anchor: Vec2 };
    /** The Mine's dig: played once; the find rises from `hole` (its bottom centre) from cell `itemFrom`. */
    digPanel?: { file: string; size: Vec2; frames: number; fps: number; loop: boolean; anchor: Vec2; hole: Vec2; itemFrom: number };
  };
}

export interface BuildingDef {
  file: string;
  size: Vec2;
  footprint: Vec2;
  footprintTopCorner: Vec2;
  footprintBottomCorner: Vec2;
  collision: string;
  interaction?: string;
}

export interface PropDef {
  file: string;
  size: Vec2;
  anchor: Vec2;
  footprint: Vec2;
  collision?: string;
  faces?: string;
  decor?: boolean;
  animation?: AnimSheet;
  glow?: { file: string };
  /** A prop you walk inside (the Golem Pit): `file` is its back half and this its front, on one canvas and anchor; the
   *  anchor is the ground point of its tile's centre, and each half sorts as if its feet were at anchor y + sortOffsetY. */
  front?: string;
  sortOffsetY?: { back: number; front: number };
}

export interface FenceDef {
  /** Rusted copies of the three pieces (same size and anchor): a Bakod hit by a Kalawang Potion. */
  nwRust?: string;
  neRust?: string;
  postRust?: string;
  nw: string;
  ne: string;
  post: string;
  size: Vec2;
  anchor: Vec2;
}

/** An item's art: a 16x16 icon for small rows, a 32x32 showcase for pop-ups, and a looping 32x32 sheet that replaces
 *  the showcase where there is one. Any may be missing. */
export interface ItemArtDef {
  icon?: string;
  showcase?: string;
  anim?: { file: string; frame: Vec2; frames: number; fps: number; loop: boolean };
}

export interface FxDef {
  file?: string;
  files?: string[];
  size?: Vec2;
  anchor?: Vec2;
  frame?: Vec2;
  frames?: number;
  fps?: number;
  loop?: boolean;
  /** A grid sheet: this many frames per row (else one row). */
  perRow?: number;
  /** Drawn under every player and mob (ground) or over them (front). */
  layer?: 'ground' | 'front';
}

/** One weapon layer of a class pose: its sheet and cell size (64x64 with the body cell at ClassesDefs.bodyOffset, or
 *  32x48 like the body). */
export interface ClassLayer {
  file: string;
  size: Vec2;
}

/** A class pose facing one way: back layers, the body, its face (front views only), then the front layers. */
export interface ClassDirLayers {
  body: string;
  face?: string;
  back: ClassLayer[];
  front: ClassLayer[];
}

export interface ClassAnim {
  frames: number;
  fps: number;
  loop: boolean;
  dirs: Partial<Record<Dir, ClassDirLayers>>;
}

/** The resting weapon in town: sheets over the base idle and walk (the body's frame), or (the Hilot's balm) a loop of
 *  its own over both. */
export interface ClassRest {
  anims?: Partial<Record<'idle' | 'walk', Partial<Record<Dir, { back: ClassLayer[]; front: ClassLayer[] }>>>>;
  own?: { frames: number; fps: number; loop: boolean };
  dirs?: Partial<Record<Dir, { back: ClassLayer[]; front: ClassLayer[] }>>;
}

export interface ClassArt {
  /** The class badge (32x32; ui.classIcons has the other sizes). */
  icon: string;
  anims: Record<string, ClassAnim>;
  rest: ClassRest;
  /** fx spawn points per anim/dir/frame (launch.json, 64-cell coords). */
  launch?: string;
  /** The Slingshot's pebble launch on the release frame, body-cell px. */
  launchPoints?: Partial<Record<Dir, Vec2>>;
}

export interface ClassesDefs {
  data: string;
  /** Where the 32x48 body cell sits in a 64x64 weapon cell. */
  bodyOffset: Vec2;
  list: Record<string, ClassArt>;
}

export type Dir = 's' | 'se' | 'e' | 'ne' | 'n' | 'nw' | 'w' | 'sw';

export interface NpcDefs {
  cell: Vec2;
  anchor: Vec2;
  directions: Dir[];
  /** `only`: the NPCs that have this animation (all of them without it). */
  animations: Record<string, { frames: number; fps: number; loop: boolean; only?: string[] }>;
  /** Sheet path with {id}, {anim} and {dir}. */
  file: string;
  /** Head portrait with {id}: `frames` frames of `size` side by side (0 = eyes open, 1 = a blink). */
  portrait: { file: string; size: Vec2; frames: number };
  /** Names, titles and lines: { npcs: { [id]: { name, title, portrait, lines } } }. */
  dialogue: string;
  ids: string[];
}

export interface CharacterDefs {
  cell: Vec2;
  anchor: Vec2;
  directions: Dir[];
  animations: Record<string, { frames: number; fps: number; loop: boolean; directions?: Dir[] }>;
  drawOrder: string[];
  layers: {
    body: string;
    face: { pattern: string; directions: Dir[] };
  };
  colourKeys: { skin: string[]; hair: string[]; clothMain: string[]; clothTrim: string[] };
  wardrobe: {
    top: string[];
    bottom: string[];
    shoes: string[];
    glasses: string[];
    hair: string[];
    hats: string[];
    pattern: string;
    hairPattern: string;
    hatPattern: string;
    hatClipPattern: string;
    hatHairFallback: Record<string, string>;
    hatClips: Record<string, boolean>;
  };
  colourPresets: Record<string, string[]>;
  skinTones: Record<string, string[]> & { faceTweak?: Record<string, Record<string, string>> };
}

// ── maps/town.json ──

export type Ground = 'grass' | 'plaza' | 'path' | 'water' | SlumsGround;
export type SlumsGround = 'dirt' | 'dirt-junk' | 'weeds' | 'mud' | 'concrete' | 'plate' | 'planks' | 'canal';

export interface SlumsTiles {
  size: Vec2;
  anchor: Vec2;
  ground: Record<string, string[]>;
  canal: { file: string; size: Vec2; frames: number; fps: number; anchor: Vec2 };
  pieceSize: Vec2;
  pieceAnchor: Vec2;
  cliffs: Record<string, { l: string[]; r: string[] }>;
  rim: { nw: string; ne: string };
  cap: { w: string; e: string };
  ramps: Record<string, Record<RampDir, [string, string]>>;
}

export type RampDir = 'ne' | 'nw' | 'se' | 'sw';

export interface Ramp {
  col: number;
  row: number;
  /** The way you walk up. */
  dir: RampDir;
  /** 1 = the low tile, 2 = the next; the tile after part 2 is the high ground. */
  part: 1 | 2;
  surface: string;
}

export interface MobDef {
  name: string;
  file: string; // with {anim} and {dir} (and {variant} when it has variants)
  size: Vec2;
  anchor: Vec2;
  /** The looks, one picked per spawn (by the server), each with its own cell and anchor if they differ. None: one look. */
  variants?: Record<string, { size?: Vec2; anchor?: Vec2 }>;
  directions: string[];
  animations: Record<string, { frames: number; fps: number; loop: boolean }>;
  /** The golem's red-lamp set: these anims from `file` (same cells and timing); the others are shared. */
  enraged?: { file: string; animations: string[] };
  /** The golem's effects (layer ground: under every player and mob, front: over them). */
  fx?: Record<string, FxDef>;
}

/** A mob's rules (mobs/mobs.json, manifest mobs.data; the bot reads it too). Frames are 0-based. */
export interface MobData {
  /** The attack anim's frame where the hit lands (the golem's Tire Slam). */
  attackFrame: number;
  /** [w, h] art px of the ground shadow, centred on the anchor. */
  shadow: Vec2;
  /** It hangs above its anchor (the art already does): the shadow stays on the ground. */
  floats?: boolean;
  variants?: string[];
  /** The Tire Roller's lunge frames (first, last). */
  charge?: Vec2;
  /** A spawn point's pack size (lowest, highest): the Bottle Caps. */
  pack?: Vec2;
  /** Tiles it attacks from (else the next tile). */
  reach?: number;
  /** Now and then a short straight roll (the Tire Roller; the server runs it). */
  roll?: { chance: number; tiles: Vec2; speed: number };
  /** It drifts: its pace (tiles a second) and short rests (the Plastic Bag Spook). */
  drift?: { speed: number; rest: Vec2 };
  /** Its attack slows the player hit for this long (ms; shown only). */
  slowMs?: number;
  /** Its shell blocks every hit except just after its own attacks (the Scrap Crab; the server decides). */
  shell?: boolean;
  /** A shell's down this long (ms) from each of its attacks: hit it then. */
  shellOpenMs?: number;
  /** Where its zap leaves: art px in the SE cell (mirrored for SW and NW). */
  eye?: Vec2;
  /** The golem's Scrap Toss release frame and Lamp Glare cone frames (first, last). */
  tossFrame?: number;
  glareFrames?: Vec2;
  /** The golem's HP (not by level) and its body's radius in tiles (reach to it is measured to that edge). */
  hp?: number;
  radius?: number;
  /** The art's highest pixel row in its cells: its HP bar, name and numbers go there (else the cell's top). */
  top?: number;
  /** Drawn this much bigger than its art (the golem); every art point above (top, eye, lamp, fists) and its shadow with it. */
  scale?: number;
  /** The golem's lamp, the ground under its fist as the Tire Slam lands, and its raised fist as the Scrap Toss leaves:
   *  art px per facing (in that facing's cell). */
  lamp?: Record<string, Vec2>;
  slamFist?: Record<string, Vec2>;
  tossFist?: Record<string, Vec2>;
}

export interface MobZone {
  id: string;
  name: string;
  mob: string;
  level: [number, number];
  rect: [number, number, number, number]; // col0, row0, col1, row1
  /** The ground level its mobs stay on. */
  height: number;
  pack: number;
  aggro: 'passive' | 'aggressive';
  aggroRange: number;
  leash: number;
  respawnSec: number;
  /** Off: no art yet, nothing placed or loaded. */
  active: boolean;
  spawns: Vec2[];
}

export interface MapObject {
  kind: 'building' | 'prop';
  id: string;
  col: number;
  row: number;
  footprint: Vec2;
  flip?: boolean;
  shadow?: string;
  tufts?: string;
  animated?: boolean;
  decor?: boolean;
  walkable?: boolean;
  /** Drawn this much bigger than its art, round its anchor (the Golem Pit); `footprint` is the bigger one. */
  scale?: number;
}

export interface TownMap {
  size: Vec2; // [cols, rows]
  ground: Ground[][]; // [row][col]
  groundStyle: string[][]; // [row][col]: '' | 'lush' | 'litter'
  objects: MapObject[];
  fence: { col: number; row: number; edge: 'nw' | 'ne' }[];
  spawn: Vec2; // [col, row]
  blocked: number[][]; // [row][col], 1 = blocked
  doors: Record<string, Vec2 | Vec2[]>; // [col, row] or several
  outskirts?: Outskirts;
  /** Raised and low ground (the Slums): height[row][col] in levels of 16 px (0, 1 or 2). */
  height?: number[][];
  /** The material of a raised tile's walls, [row][col] ('earth' | 'concrete' | 'sheet', or ''). */
  walls?: string[][];
  /** Two tiles each, linking two levels. */
  ramps?: Ramp[];
  /** [col0, row0, col1, row1]: no mobs there. */
  safeZone?: [number, number, number, number];
  /** Spots for friendly NPCs later. */
  residents?: Vec2[];
  mobZones?: MobZone[];
  /** The Scrapheap Golem's data (not placed yet). */
  boss?: {
    id: string; name: string; level: number; tile: Vec2; arena: [number, number, number, number]; everyMinutes: number; warnMinutes: number; leash: number;
    /** The Golem Pit's tiles, [dcol, drow] from `tile`: its ring, pit floor and way in. */
    pit?: { ring: Vec2[]; floor: Vec2[]; gap: Vec2[] };
  };
  /** Tiles over the river the game draws a bridge on (world/bridge.ts), crossing along the col axis. */
  bridge?: Vec2[];
  /** More bridges, each crossing along `along` (the slums bridge runs along the rows). */
  bridges?: { along: 'col' | 'row'; tiles: Vec2[] }[];
  /** Walking onto these tiles goes to another area: 'hood' (the neighbourhood), 'town', or 'slums' (testers only, not
   *  built yet: a note instead). */
  gates?: Partial<Record<Gate, Vec2[]>>;
  /** Where you appear coming from another area (by where you came from), instead of the spawn point. */
  arrive?: Partial<Record<Gate, Vec2>>;
}

export type Gate = 'hood' | 'town' | 'slums';
export type Area = Gate;

/** The forest drawn around the town (world/outskirts.ts). */
export interface Outskirts {
  ground: string; // grass mix under the trees
  meadow: string; // grass mix within `clear` of an edge
  clear: Record<'nw' | 'ne' | 'se' | 'sw', number>; // tiles beyond each edge kept free of trees
  water: [number, number, number, number][]; // [col0, row0, col1, row1] rectangles of river outside the map
  lanes?: [number, number, number, number][]; // [col0, row0, col1, row1] paths running on past a bridge, trees kept back
  trees: Record<string, string>; // tree prop id → its shadow
  treeChance: number; // per 2 × 2 cell
  undergrowth: string[]; // prop ids
  undergrowthChance: number; // per tile
}
