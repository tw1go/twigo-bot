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
  ui: Record<string, { file?: string; size?: Vec2; frames?: number | string[] | Record<string, number>; fps?: number; anchor?: Vec2 }> & {
    inventory?: { itemFrame?: { file: string; nineSlice: number } };
    nameplate?: { file: string; self: string; threeSlice: number; height: number };
    loadingMoon?: { file: string; size: Vec2; frames: number; fps: number; loopFrames?: Vec2; anchor: Vec2 };
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
  nw: string;
  ne: string;
  post: string;
  size: Vec2;
  anchor: Vec2;
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
}
