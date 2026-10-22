// ✨ How the Lv 21-40 utilities look (CONTEXT.md Utility, Debuff; the art folder's fx/shared, its _sheets_lv21-40.csv):
// a buff's or stance's look on whoever it reached (its `-back` half under them, its `-front` half over them, at their
// feet), and the mark a debuff, a skill's taunt or a stun puts over a mob while it lasts. Read by the world (TownScene's
// buff casts, world/mobs.ts's marks) and the Skills panel's stage (combat/skill-previews.ts).

/** A buff's look: played once as it's cast, or looped for the buff's time (`loop`). */
export const BUFF_LOOKS: Record<string, { fx: string; loop?: boolean }> = {
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
