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
  };
  buildings: Record<string, BuildingDef>;
  props: Record<string, PropDef> & { fence: FenceDef; 'tree-tufts': { files: string[]; size: Vec2 } };
  characters: CharacterDefs;
  fx: Record<string, FxDef>;
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
}

export type Dir = 's' | 'se' | 'e' | 'ne' | 'n' | 'nw' | 'w' | 'sw';

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

export type Ground = 'grass' | 'plaza' | 'path' | 'water';

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
  /** Tiles over the river the game draws a bridge on (world/bridge.ts). */
  bridge?: Vec2[];
  /** Walking onto these tiles goes to another area: 'hood' (the neighbourhood) or 'town'. */
  gates?: Partial<Record<'hood' | 'town', Vec2[]>>;
  /** Where you appear coming from another area (by where you came from), instead of the spawn point. */
  arrive?: Partial<Record<'hood' | 'town', Vec2>>;
}

/** The forest drawn around the town (world/outskirts.ts). */
export interface Outskirts {
  ground: string; // grass mix under the trees
  meadow: string; // grass mix within `clear` of an edge
  clear: Record<'nw' | 'ne' | 'se' | 'sw', number>; // tiles beyond each edge kept free of trees
  water: [number, number, number, number][]; // [col0, row0, col1, row1] rectangles of river outside the map
  trees: Record<string, string>; // tree prop id → its shadow
  treeChance: number; // per 2 × 2 cell
  undergrowth: string[]; // prop ids
  undergrowthChance: number; // per tile
}
