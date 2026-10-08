import type Phaser from 'phaser';
import { mobSheets } from './mob-art';
import { packed, queuePacked } from './packs';
import type { Manifest, PropDef, TownMap } from './types';

// Queues every image the town needs, keyed by its path under assets/. Sheets (water, swaying grass, the fountain,
// animated effects) load as spritesheets with the frame size from the manifest. In a build most of them come out of
// a few packed sheets (assets/packs.ts).

export function queueImage(load: Phaser.Loader.LoaderPlugin, textures: Phaser.Textures.TextureManager, file: string): void {
  if (packed(file)) queuePacked(load, textures, file);
  else if (!textures.exists(file)) load.image(file, file);
}

export function queueSheet(load: Phaser.Loader.LoaderPlugin, textures: Phaser.Textures.TextureManager, file: string, w: number, h: number): void {
  if (packed(file)) queuePacked(load, textures, file, [w, h]);
  else if (!textures.exists(file)) load.spritesheet(file, file, { frameWidth: w, frameHeight: h });
}

export function queueTown(load: Phaser.Loader.LoaderPlugin, textures: Phaser.Textures.TextureManager, M: Manifest, map: TownMap): void {
  const img = (f: string) => queueImage(load, textures, f);
  const T = M.tiles;
  if (map.height) queueSlums(load, textures, M, map);
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
  // The forest round the map (world/outskirts.ts): its trees, their shadows and tufts, and the undergrowth (the town's
  // own objects happen to use them all; the neighbourhood's may not).
  const O = map.outskirts;
  if (O) {
    for (const [id, shadow] of Object.entries(O.trees)) {
      const p = M.props[id] as PropDef | undefined;
      if (p?.file) img(p.file);
      img(shadow);
    }
    for (const id of O.undergrowth) {
      const p = M.props[id] as PropDef | undefined;
      if (p?.file) img(p.file);
    }
    for (const f of (M.props['tree-tufts'] as { files?: string[] } | undefined)?.files ?? []) img(f);
  }
  // Day/night swaps lamp-off for lamp-on; both are needed to find the lantern.
  const on = M.props['lamp-on'] as PropDef | undefined;
  const off = M.props['lamp-off'] as PropDef | undefined;
  if (on?.file) img(on.file);
  if (off?.file) img(off.file);
  if (on?.glow?.file) img(on.glow.file);
  const F = M.props.fence;
  if (F) [F.nw, F.ne, F.post, F.nwRust, F.neRust, F.postRust].forEach((f) => f && img(f));

  // Speech bubbles (the box and its tail), and the emote icons.
  const B = M.ui.speechBubble;
  if (B) [B.file, B.tail].forEach(img);
  const E = M.ui.emotes;
  if (E?.file && E.size) queueSheet(load, textures, E.file, E.size[0], E.size[1]);

  // The Arena's jack en poy: hands, VS, pips, the menu's icons (sheets) and the speed lines.
  for (const s of [M.ui.jnpHands, M.ui.vs, M.ui.jnpPips, M.ui.arenaModes]) if (s) queueSheet(load, textures, s.file, s.size[0], s.size[1]);
  if (M.ui.vsSpeedlines) img(M.ui.vsSpeedlines.file);
  const V = M.ui.arenaViewers;
  if (V) for (const f of V.files) queueSheet(load, textures, f, V.size[0], V.size[1]);

  // The Mine's dig panel, and the item art (shown in pop-ups and the dig panel).
  const D = M.ui.digPanel;
  if (D) queueSheet(load, textures, D.file, D.size[0], D.size[1]);
  for (const a of Object.values(M.items ?? {})) {
    if (a.icon) img(a.icon);
    if (a.showcase) img(a.showcase);
    if (a.anim) queueSheet(load, textures, a.anim.file, a.anim.frame[0], a.anim.frame[1]);
  }

  for (const fx of Object.values(M.fx)) {
    if (!fx.file) continue;
    if (fx.frame) queueSheet(load, textures, fx.file, fx.frame[0], fx.frame[1]);
    else img(fx.file);
  }
}

/** The town's NPCs (world/npc-life.ts): every animation sheet, the portraits and the dialogue file. */
export function queueNpcs(load: Phaser.Loader.LoaderPlugin, textures: Phaser.Textures.TextureManager, M: Manifest): void {
  const N = M.npcs;
  if (!N) return;
  for (const id of N.ids) {
    for (const [anim, a] of Object.entries(N.animations)) {
      if (a.only && !a.only.includes(id)) continue;
      for (const dir of N.directions) queueSheet(load, textures, N.file.replace('{id}', id).replace('{anim}', anim).replace('{dir}', dir), N.cell[0], N.cell[1]);
    }
  }
  load.json('npc-dialogue', N.dialogue);
}

/** The Slums: its ground and raised-ground pieces (tiles.slums), every Slums prop (its outskirts scatter some that the
 *  map itself doesn't use) and the mobs of its active zones. */
function queueSlums(load: Phaser.Loader.LoaderPlugin, textures: Phaser.Textures.TextureManager, M: Manifest, map: TownMap): void {
  const img = (f: string) => queueImage(load, textures, f);
  const S = M.tiles.slums;
  if (S) {
    Object.values(S.ground).flat().forEach(img);
    queueSheet(load, textures, S.canal.file, S.canal.size[0], S.canal.size[1]);
    for (const m of Object.values(S.cliffs)) [...m.l, ...m.r].forEach(img);
    [S.rim.nw, S.rim.ne, S.cap.w, S.cap.e].forEach(img);
    for (const set of Object.values(S.ramps)) Object.values(set).flat().forEach(img);
  }
  for (const [id, p] of Object.entries(M.props)) if (id.startsWith('slums-')) for (const f of [(p as PropDef).file, (p as PropDef).front]) if (f) img(f);
  // Every variant's sheets of each active zone's mob (the field boss's wait: loadBoss, once the town is up).
  const ids = new Set((map.mobZones ?? []).filter((z) => z.active).map((z) => z.mob));
  for (const id of ids) {
    const mob = M.mobs?.[id];
    if (!mob || typeof mob === 'string') continue;
    for (const s of mobSheets(mob)) queueSheet(load, textures, s.file, s.size[0], s.size[1]);
  }
  // Their rules (attack frames, shadows, floating).
  if (ids.size && typeof M.mobs?.data === 'string') load.json('mob-data', M.mobs.data);
}

/** The field boss's art (the Scrapheap Golem: its sheets, red-lamp set included, and its fx), loaded with the scene's
 *  loader in the background once the Slums is up, so it never holds up arriving. */
export function loadBoss(scene: Phaser.Scene, M: Manifest, id: string): Promise<void> {
  const mob = M.mobs?.[id];
  if (!mob || typeof mob === 'string') return Promise.resolve();
  const files = [...mobSheets(mob), ...Object.values(mob.fx ?? {}).flatMap((f) => (f.file ? [{ file: f.file, size: f.frame }] : []))];
  const missing = files.filter((f) => !scene.textures.exists(f.file));
  if (!missing.length) return Promise.resolve();
  return new Promise((resolve) => {
    for (const f of missing) {
      if (f.size) queueSheet(scene.load, scene.textures, f.file, f.size[0], f.size[1]);
      else queueImage(scene.load, scene.textures, f.file);
    }
    scene.load.once('complete', () => resolve());
    if (!scene.load.isLoading()) scene.load.start();
  });
}
