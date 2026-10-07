import type Phaser from 'phaser';
import type { CharacterDefs, ClassArt, ClassesDefs, Dir } from '../assets/types';
import { type Outfit, sheetKey } from './doll';
import { CELL, drawPose, lookImages, loadImages, poseFiles } from './kit-art';

// ⚔️ Battle poses (maps with mobs: the Slums): a character with a class is drawn in its class's combat sheets there
// instead of the town doll, every pose composited once per class and look (back weapon layers, the body and face in
// the look's skin, front layers: kit-art drawPose) into 64 × 64 sprite sheets. Standing is walk-ready's first frame,
// walking walk-ready (the Slingshot's walk-hunt), and the skills play the attack poses once. The combat sheets have no
// clothes or hair: the look's are laid on each pose (kit-art: clothes on the body, trimmed to it; hair, glasses and hat on the head).

export interface BattleSheets {
  cls: string;
  /** The animation key for a pose ('idle', 'walk' or one of the class's anims) facing `dir`. */
  key: (anim: string, dir: Dir) => string;
  directions: Dir[];
  /** The feet in the 64 × 64 cell. */
  anchor: [number, number];
  cell: [number, number];
  anims: string[];
}

const built = new Map<string, Promise<BattleSheets | null>>();
/** Builds run one after another (several players arriving at once don't pile up in one frame). */
let queue: Promise<unknown> = Promise.resolve();

/** A class's battle sheets for a look (loads the poses the first time; then the same promise). */
export function battleSheets(scene: Phaser.Scene, C: CharacterDefs, K: ClassesDefs, cls: string, o: Outfit): Promise<BattleSheets | null> {
  const art = K.list[cls] as ClassArt | undefined;
  if (!art) return Promise.resolve(null);
  const id = `${cls}|${sheetKey(o, 'idle', 's')}`;
  let p = built.get(id);
  if (!p) {
    const files = loadImages(scene, [...poseFiles(art), ...lookImages(C, o, C.directions)]);
    p = queue.then(() => files).then(() => build(scene, C, K, art, cls, o, id));
    queue = p.catch(() => null);
    built.set(id, p);
  }
  return p;
}

// Building a class's sheets for a look takes about a second of drawing: it's done a few ms at a time between frames, so
// nobody's game stutters when someone arrives or changes class (they show their town look meanwhile).
const SLICE_MS = 6;
let sliceFrom = 0;
async function breathe(): Promise<void> {
  if (performance.now() - sliceFrom < SLICE_MS) return;
  await new Promise((r) => setTimeout(r, 16));
  sliceFrom = performance.now();
}

async function build(scene: Phaser.Scene, C: CharacterDefs, K: ClassesDefs, art: ClassArt, cls: string, o: Outfit, id: string): Promise<BattleSheets | null> {
  if (!art.anims['walk-ready']) return null;
  const tag = `battle:${id}`;
  const dirsOf = (anim: string) => Object.keys(art.anims[anim]?.dirs ?? {}) as Dir[];
  const directions = dirsOf('walk-ready');
  sliceFrom = performance.now();
  // Standing and walking first, then the attacks.
  const anims = Object.entries(art.anims).sort(([a], [b]) => Number(b.startsWith('walk')) - Number(a.startsWith('walk')));
  for (const [anim, a] of anims) {
    for (const dir of dirsOf(anim)) {
      const key = `${tag}:${anim}:${dir}`;
      if (scene.textures.exists(key)) continue;
      const canvas = document.createElement('canvas');
      canvas.width = CELL * a.frames;
      canvas.height = CELL;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      for (let f = 0; f < a.frames; f++) {
        await breathe();
        if (!scene.sys.textures) return null; // the scene went away meanwhile
        drawPose(ctx, scene, C, K, o, art, anim, dir, f, f * CELL, 0);
      }
      if (scene.textures.exists(key)) continue;
      const tex = scene.textures.addCanvas(key, canvas)!;
      for (let f = 0; f < a.frames; f++) tex.add(f, 0, f * CELL, 0, CELL, CELL);
      const frames = Array.from({ length: a.frames }, (_, f) => ({ key, frame: f }));
      scene.anims.create({ key, frames, frameRate: a.fps, repeat: a.loop ? -1 : 0 });
      // Standing: walk-ready's first frame, held.
      if (anim === 'walk-ready') scene.anims.create({ key: `${tag}:idle:${dir}`, frames: [frames[0]], frameRate: 1, repeat: -1 });
    }
  }
  const walk = art.anims['walk-hunt'] ? 'walk-hunt' : 'walk-ready';
  return {
    cls,
    key: (anim, dir) => {
      const a = anim === 'walk' ? walk : anim === 'idle' || !art.anims[anim] ? 'idle' : anim;
      const dirs = a === 'idle' ? directions : dirsOf(a);
      return `${tag}:${a}:${dirs.includes(dir) ? dir : dirs[0]}`;
    },
    directions,
    anchor: [K.bodyOffset[0] + C.anchor[0], K.bodyOffset[1] + C.anchor[1]],
    cell: [CELL, CELL],
    anims: Object.keys(art.anims),
  };
}

/** Which pose a skill plays: its place in the class's list. */
export const SKILL_POSE = ['attack-quick', 'attack-quick', 'attack-heavy', 'attack-cast', 'attack-heavy', 'attack-cast', 'attack-heavy'];
