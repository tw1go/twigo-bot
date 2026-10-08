import type { MobDef, Vec2 } from './types';

// 🥫 Where a mob's sheets are (manifest mobs): the file for a variant, animation and direction, and the cell and anchor
// of a variant (its own, else the mob's). The golem's enraged set swaps the file for the anims it has.

/** The variants' names ('' alone: one look). */
export const mobVariants = (def: MobDef): string[] => (def.variants ? Object.keys(def.variants) : ['']);

/** Its sheet for a variant, animation and direction. */
export function mobSheet(def: MobDef, variant: string, anim: string, dir: string, enraged = false): string {
  const file = enraged && def.enraged?.animations.includes(anim) ? def.enraged.file : def.file;
  return file.replace('{variant}', variant).replace('{anim}', anim).replace('{dir}', dir);
}

/** A variant's cell size and anchor. */
export function mobCell(def: MobDef, variant: string): { size: Vec2; anchor: Vec2 } {
  const v = def.variants?.[variant];
  return { size: v?.size ?? def.size, anchor: v?.anchor ?? def.anchor };
}

/** Every sheet it has, with its cell size (for loading). */
export function mobSheets(def: MobDef): { file: string; size: Vec2 }[] {
  const out: { file: string; size: Vec2 }[] = [];
  for (const v of mobVariants(def)) {
    const { size } = mobCell(def, v);
    for (const anim of Object.keys(def.animations)) for (const dir of def.directions) out.push({ file: mobSheet(def, v, anim, dir), size });
  }
  for (const anim of def.enraged?.animations ?? []) for (const dir of def.directions) out.push({ file: mobSheet(def, '', anim, dir, true), size: def.size });
  return out;
}
