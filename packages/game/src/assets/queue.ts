import type Phaser from 'phaser';
import type { Manifest, PropDef, TownMap } from './types';

// Queues every image the town needs, keyed by its path under assets/. Sheets (water, swaying grass, the fountain,
// animated effects) load as spritesheets with the frame size from the manifest.

export function queueImage(load: Phaser.Loader.LoaderPlugin, textures: Phaser.Textures.TextureManager, file: string): void {
  if (!textures.exists(file)) load.image(file, file);
}

function queueSheet(load: Phaser.Loader.LoaderPlugin, textures: Phaser.Textures.TextureManager, file: string, w: number, h: number): void {
  if (!textures.exists(file)) load.spritesheet(file, file, { frameWidth: w, frameHeight: h });
}

export function queueTown(load: Phaser.Loader.LoaderPlugin, textures: Phaser.Textures.TextureManager, M: Manifest, map: TownMap): void {
  const img = (f: string) => queueImage(load, textures, f);
  const T = M.tiles;
  T.grass.files.forEach(img);
  T.grass.litter.files.forEach(img);
  for (const a of Object.values(T.grass.animated)) queueSheet(load, textures, a.file, a.frameSize[0], a.frameSize[1]);
  T.path.files.forEach(img);
  T.plaza.files.forEach(img);
  for (const v of T.water.variants) queueSheet(load, textures, v, T.water.size[0], T.water.size[1]);
  for (const o of Object.values(T.water.overlays)) if (typeof o === 'object') img(o.file);

  for (const o of map.objects) {
    if (o.kind === 'building') {
      const b = M.buildings[o.id] as Manifest['buildings'][string] & { layers?: { back?: string; front?: string } };
      // Hollow buildings (the arena) are drawn from their back and front layers instead of the full image.
      if (b?.layers?.back && b.layers.front) [b.layers.back, b.layers.front].forEach(img);
      else if (b) img(b.file);
    } else {
      const p = M.props[o.id] as PropDef | undefined;
      if (p?.file) img(p.file);
      if (o.animated && p?.animation) queueSheet(load, textures, p.animation.file, p.animation.frameSize[0], p.animation.frameSize[1]);
    }
    if (o.shadow) img(o.shadow);
    if (o.tufts) img(o.tufts);
  }
  // Day/night swaps lamp-off for lamp-on; both are needed to find the lantern.
  const on = M.props['lamp-on'] as PropDef | undefined;
  const off = M.props['lamp-off'] as PropDef | undefined;
  if (on?.file) img(on.file);
  if (off?.file) img(off.file);
  if (on?.glow?.file) img(on.glow.file);
  const F = M.props.fence;
  if (F) [F.nw, F.ne, F.post].forEach(img);

  for (const fx of Object.values(M.fx)) {
    if (!fx.file) continue;
    if (fx.frame) queueSheet(load, textures, fx.file, fx.frame[0], fx.frame[1]);
    else img(fx.file);
  }
}
