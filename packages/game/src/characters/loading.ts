// 📥 Loading a character's images with a scene's loader (packed sheets or loose files, `queueImage`). Kept apart from
// doll.ts and kit-art.ts, which only draw, so a page without Phaser (the front page) can draw characters without the
// pack index.
import type Phaser from 'phaser';
import { queueImage } from '../assets/queue';
import type { CharacterDefs } from '../assets/types';
import { type Outfit, buildOutfitSlowly, outfitFiles } from './doll';

/** Loads whichever of `files` aren't loaded yet. */
export function loadImages(scene: Phaser.Scene, files: string[]): Promise<void> {
  const missing = [...new Set(files)].filter((f) => !scene.textures.exists(f));
  if (!missing.length) return Promise.resolve();
  return new Promise((resolve) => {
    for (const f of missing) queueImage(scene.load, scene.textures, f);
    scene.load.once('complete', () => resolve()); // (Phaser.Loader.Events.COMPLETE)
    if (!scene.load.isLoading()) scene.load.start();
  });
}

/** Loads any layers an outfit still needs (with the scene's loader), then builds it a few sheets a frame. */
export function loadOutfit(scene: Phaser.Scene, C: CharacterDefs, o: Outfit): Promise<void> {
  const missing = outfitFiles(C, o).filter((f) => !scene.textures.exists(f));
  return new Promise((resolve) => {
    const done = () => void buildOutfitSlowly(scene, C, o).then(resolve);
    if (!missing.length) return done();
    for (const f of missing) queueImage(scene.load, scene.textures, f);
    scene.load.once('complete', done); // (Phaser.Loader.Events.COMPLETE)
    scene.load.start();
  });
}
