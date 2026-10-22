// ✨ How the utilities look (CONTEXT.md Utility, Debuff; the art folder's fx/shared and fx/mobility-buff): each class's
// burst as it casts one, a buff's or stance's look on whoever it reached (its `-back` half under them, its `-front` half
// over them, at their feet), and the mark a debuff, a skill's taunt or a stun puts over a mob while it lasts. Read by the world (TownScene's
// buff casts, world/mobs.ts's marks) and the Skills panel's stage (combat/skill-previews.ts).

/** A buff's look on everyone it reached: played once (about LANDING_MS after its caster's burst, below), looped for the
 *  buff's time (`loop`), or for `ms` and faded (a looping sheet played as one cycle). The Lv 1-20 ones from the art
 *  folder's fx/mobility-buff (22 Oct 2026), the Lv 21-40 ones from fx/shared. */
export const BUFF_LOOKS: Record<string, { fx: string; loop?: boolean; ms?: number }> = {
  Rally: { fx: 'fx-buff-atk' },
  'Vital Rub': { fx: 'fx-buff-atk' },
  'Steady Aim': { fx: 'fx-buff-accuracy' },
  'Dinner Bell': { fx: 'fx-buff-accuracy' },
  'Second Wind': { fx: 'fx-buff-hp' },
  'Hearty Cheer': { fx: 'fx-buff-hp' },
  'Battle Roar': { fx: 'fx-buff-amp' },
  'Warding Dust': { fx: 'fx-buff-def' },
  'Calm Mind': { fx: 'fx-buff-haste' },
  'Soothing Touch': { fx: 'fx-buff-heal' },
  'Keen Stance': { fx: 'fx-buff-keen' },
  // (Hyper Regen's look, one cycle: 12 frames at 14 fps.)
  'Steady Breath': { fx: 'fx-buff-hyper-regen', ms: Math.round((12 / 14) * 1000) },
  'Iron Kitchen': { fx: 'fx-buff-guard' },
  'Blood Price': { fx: 'fx-buff-blood', loop: true },
  'Mist Veil': { fx: 'fx-buff-mist' },
  'Hyper Regen': { fx: 'fx-buff-hyper-regen', loop: true },
  'Fierce Stance': { fx: 'fx-stance-fierce' },
  'Flow Stance': { fx: 'fx-stance-flow' },
};

/** A debuff's mark (by its name; a skill's taunt is 'taunt'): over the mob's head, side by side with the others, or at its
 *  feet on the ground (`feet`), in a colour of its own (`tint`: Hamstring's knee ring in crimson). */
export const DEBUFF_MARKS: Record<string, { fx: string; tint?: string; feet?: boolean }> = {
  taunt: { fx: 'fx-taunt-mark' },
  Provoke: { fx: 'fx-taunt-mark' },
  'Iron Kitchen': { fx: 'fx-taunt-mark' },
  'Armor Crack': { fx: 'fx-debuff-armor-crack' },
  Marked: { fx: 'fx-debuff-marked' },
  'Eye Sting': { fx: 'fx-debuff-eye-sting' },
  'Numbing Oil': { fx: 'fx-debuff-numbing' },
  Hamstring: { fx: 'fx-slingshot-knee-ring', tint: '#DC2626', feet: true },
};

/** A stunned mob's dizzy ring, on top of its head. */
export const STUN_MARK = 'fx-stun-stars';

/** '#rrggbb' as a number (Phaser's tint). */
export const tintOf = (colour: string): number => Number.parseInt(colour.slice(1), 16);

/** A buff's landing goes off this long after its caster's burst. */
export const LANDING_MS = 150;

/** Each class's burst as it casts a buff (whoever it reaches): on the caster, on its buff-cast pose's `fx_start` frame(s)
 *  (characters/classes/<class>/buff-hooks.csv), at that row's point for the facing (`hook`), or at the feet; its layer
 *  is its manifest entry's (the Broom's dust ring on the ground). The Pot lid's is its Clang waves off the lid. */
export const BUFF_BURSTS: Record<string, { fx: string; at: 'hook' | 'feet'; ground?: boolean }> = {
  slingshot: { fx: 'fx-buff-cast-slingshot', at: 'hook' },
  stick: { fx: 'fx-buff-cast-stick', at: 'hook' },
  greatstick: { fx: 'fx-buff-cast-greatstick', at: 'feet' },
  broom: { fx: 'fx-buff-cast-broom', at: 'feet', ground: true },
  potlid: { fx: 'fx-potlid-clang-waves', at: 'hook' },
  hilot: { fx: 'fx-buff-cast-hilot', at: 'hook' },
};

/** A class's buff-cast hooks: the frames its burst goes off on (`fx_start`) and, for each frame and facing, the point in
 *  the pose's 64 px cell (the feet at 32, 56: as the attack launch points). */
export interface BuffHook {
  frames: number[];
  at: Record<number, Record<string, [number, number]>>;
}

const hooks = new Map<string, BuffHook | null>();

/** A class's hooks once loaded (null: none, or not loaded yet). */
export const buffHook = (cls: string): BuffHook | null => hooks.get(cls) ?? null;

/** Loads each class's buff-hooks.csv (once; `url` gives a class's file). */
export async function loadBuffHooks(classes: string[], url: (cls: string) => string): Promise<void> {
  await Promise.all(classes.filter((c) => !hooks.has(c)).map(async (cls) => {
    hooks.set(cls, null);
    try {
      const r = await fetch(url(cls));
      if (r.ok) hooks.set(cls, parseBuffHooks(await r.text()));
    } catch {
      /* no hooks: its burst goes off at the feet */
    }
  }));
}

/** buff-hooks.csv (class, anim, dir, frame, fx_start, x, y) as its hooks: the fx_start frames, every row's point. */
export function parseBuffHooks(text: string): BuffHook {
  const out: BuffHook = { frames: [], at: {} };
  const [head, ...rows] = text.trim().split(/\r?\n/);
  const col = Object.fromEntries(head.split(',').map((h, i) => [h.trim(), i]));
  for (const line of rows) {
    const c = line.split(',');
    const frame = Number(c[col.frame]);
    const [x, y] = [Number(c[col.x]), Number(c[col.y])];
    if (!Number.isFinite(frame) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    (out.at[frame] ??= {})[c[col.dir]] = [x, y];
    if ((c[col.fx_start] ?? '').trim() && !out.frames.includes(frame)) out.frames.push(frame);
  }
  out.frames.sort((a, b) => a - b);
  return out;
}
