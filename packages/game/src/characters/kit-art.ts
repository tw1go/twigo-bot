import Phaser from 'phaser';
import { queueImage } from '../assets/queue';
import type { CharacterDefs, ClassArt, ClassLayer, ClassesDefs, Dir } from '../assets/types';
import { type Outfit, dressLayer, sheetKey } from './doll';

// ⚔️ A class's weapon on a character, drawn onto a canvas (the class cards, the skill preview, the equipment panel):
// the resting weapon over the doll's idle or walk (the same frame, or the Hilot's balm on its own clock), and the
// combat poses (walk-ready, the attacks: the body and face in the look's skin, then the weapon layers; there are no
// clothes or hair for these poses). Everything is drawn in a 64x64 cell whose (bodyOffset) is the doll's 32x48 cell,
// back layers first, front layers last. Every direction has its own sheets: nothing is mirrored.

export const CELL = 64;

/** The resting weapon's back and front layers over the base `anim` facing `dir` (the Hilot's balm: its own). */
export function restLayers(art: ClassArt, anim: 'idle' | 'walk', dir: Dir): { back: ClassLayer[]; front: ClassLayer[] } | null {
  return (art.rest.own ? art.rest.dirs?.[dir] : art.rest.anims?.[anim]?.[dir]) ?? null;
}

/** Every resting-weapon sheet of a class (to load). */
export function restFiles(art: ClassArt): string[] {
  const sets = art.rest.own ? Object.values(art.rest.dirs ?? {}) : Object.values(art.rest.anims ?? {}).flatMap((a) => Object.values(a ?? {}));
  return sets.flatMap((s) => [...(s?.back ?? []), ...(s?.front ?? [])].map((l) => l.file));
}

/** Every combat-pose sheet of a class (to load). */
export function poseFiles(art: ClassArt): string[] {
  return Object.values(art.anims).flatMap((a) =>
    Object.values(a.dirs).flatMap((d) => (d ? [d.body, ...(d.face ? [d.face] : []), ...d.back.map((l) => l.file), ...d.front.map((l) => l.file)] : [])),
  );
}

/** Loads whichever of `files` aren't loaded yet. */
export function loadImages(scene: Phaser.Scene, files: string[]): Promise<void> {
  const missing = [...new Set(files)].filter((f) => !scene.textures.exists(f));
  if (!missing.length) return Promise.resolve();
  return new Promise((resolve) => {
    for (const f of missing) queueImage(scene.load, scene.textures, f);
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
    if (!scene.load.isLoading()) scene.load.start();
  });
}

const source = (scene: Phaser.Scene, file: string) => (scene.textures.exists(file) ? (scene.textures.get(file).getSourceImage() as CanvasImageSource) : null);

/** Frame `f` of a strip whose cells are `w`×`h`, at (x, y). */
function drawCell(ctx: CanvasRenderingContext2D, img: CanvasImageSource | null, w: number, h: number, f: number, x: number, y: number): void {
  if (img) ctx.drawImage(img, f * w, 0, w, h, x, y, w, h);
}

/** A weapon layer's frame, placed in the 64x64 cell (32x48 ones at the body's spot). */
function drawLayer(ctx: CanvasRenderingContext2D, scene: Phaser.Scene, K: ClassesDefs, l: ClassLayer, f: number, x: number, y: number): void {
  const [w, h] = l.size;
  const at = w === CELL ? [0, 0] : K.bodyOffset;
  drawCell(ctx, source(scene, l.file), w, h, f, x + at[0], y + at[1]);
}

/** A character resting in town at (x, y), the 64x64 cell's top left: back layers, the doll's frame, front layers.
 *  `t` (ms) drives the Hilot's balm, which floats on its own clock. Without `art`, just the doll. */
export function drawRested(
  ctx: CanvasRenderingContext2D,
  scene: Phaser.Scene,
  C: CharacterDefs,
  K: ClassesDefs,
  o: Outfit,
  art: ClassArt | null,
  anim: 'idle' | 'walk',
  dir: Dir,
  frame: number,
  t: number,
  x = 0,
  y = 0,
): void {
  const layers = art ? restLayers(art, anim, dir) : null;
  const own = art?.rest.own;
  const wf = own ? Math.floor((t / 1000) * own.fps) % own.frames : frame;
  for (const l of layers?.back ?? []) drawLayer(ctx, scene, K, l, wf, x, y);
  drawCell(ctx, source(scene, sheetKey(o, anim, dir)), C.cell[0], C.cell[1], frame, x + K.bodyOffset[0], y + K.bodyOffset[1]);
  for (const l of layers?.front ?? []) drawLayer(ctx, scene, K, l, wf, x, y);
}

/** A combat pose's frame at (x, y), the 64x64 cell's top left: back layers, the body and face in the look's skin, front
 *  layers. `hide`: weapon layers left out (a thrown lid or plank in flight), by a part of their file name. */
export function drawPose(
  ctx: CanvasRenderingContext2D,
  scene: Phaser.Scene,
  C: CharacterDefs,
  K: ClassesDefs,
  o: Outfit,
  art: ClassArt,
  anim: string,
  dir: Dir,
  frame: number,
  x = 0,
  y = 0,
  hide: string[] = [],
): void {
  const d = art.anims[anim]?.dirs[dir];
  if (!d) return;
  const shown = (l: ClassLayer) => !hide.some((h) => l.file.includes(h));
  for (const l of d.back.filter(shown)) drawLayer(ctx, scene, K, l, frame, x, y);
  drawCell(ctx, dressLayer(scene, C, o, d.body, 'body'), C.cell[0], C.cell[1], frame, x + K.bodyOffset[0], y + K.bodyOffset[1]);
  if (d.face) drawCell(ctx, dressLayer(scene, C, o, d.face, 'face'), C.cell[0], C.cell[1], frame, x + K.bodyOffset[0], y + K.bodyOffset[1]);
  for (const l of d.front.filter(shown)) drawLayer(ctx, scene, K, l, frame, x, y);
}
