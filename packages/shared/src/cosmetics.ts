import type { CosmeticPlace } from './adventure.js';
import { type Item, type ItemData, cosmeticFits, isGearDef } from './items.js';
import type { OutfitData } from './room-api.js';

// 🎩 Cosmetics on a look (CONTEXT.md: Cosmetic, Costume). A worn head cosmetic (AdventureState.cosmetics.head) puts its
// hat on the look in place of the one chosen at the creator (manifest characters.wardrobe.cosmeticHats: item id → hat
// key), a worn body cosmetic its top (wardrobe.cosmeticTops: the Witch Robe); the chosen hat and its colour stay saved and come back when it's taken off. The server resolves the look it
// shows everyone (the town's profile, restyle); the game resolves its own from its adventure state. A saved look never
// holds a cosmetic hat itself (the bot's parseOutfit refuses them): only wearing the item puts it there. A worn weapon
// cosmetic (a Moonlight weapon, CONTEXT.md Weapon skin) that fits their class puts its id on the look
// (`weaponCosmetic`), and the game draws every class weapon layer in its skin (manifest wardrobe.cosmeticWeapons).

/** The hat a worn head cosmetic gives, or null. */
export function cosmeticHatOf(hats: Record<string, string>, cosmetics: Partial<Record<CosmeticPlace, Pick<Item, 'defId'>>> | undefined): string | null {
  const head = cosmetics?.head;
  return (head && hats[head.defId]) || null;
}

/** The top a worn body cosmetic gives (manifest characters.wardrobe.cosmeticTops: item id → top key, the Witch Robe's
 *  witchrobe), or null. */
export function cosmeticTopOf(tops: Record<string, string> | undefined, cosmetics: Partial<Record<CosmeticPlace, Pick<Item, 'defId'>>> | undefined): string | null {
  const body = cosmetics?.body;
  return (body && tops?.[body.defId]) || null;
}

/** The worn weapon cosmetic's id when it fits their class (items.json `forClass`), or null: a mismatched one stays worn,
 *  greyed, and changes nothing. */
export function cosmeticWeaponOf(data: Pick<ItemData, 'defs'>, cosmetics: Partial<Record<CosmeticPlace, Pick<Item, 'defId'>>> | undefined, cls: string | null | undefined): string | null {
  const w = cosmetics?.weapon;
  const def = w && data.defs.get(w.defId);
  return def && !isGearDef(def) && def.kind === 'cosmetic' && cosmeticFits(def, cls) && cls ? w.defId : null;
}

/** A class weapon sheet's file in a skin: char-weapon-<key>… → char-weapon-<key>-<skin>… (the poses' front and back
 *  layers, the town's resting -rest sheets, the Hilot's balm-float; every one has its twin of the same size). */
export const weaponSkinFile = (file: string, skin: string): string => file.replace(/(char-weapon-[a-z]+)(?=-)/, `$1-${skin}`);

/** A look with a cosmetic hat and top on it (the chosen hat's colour left out: the cosmetic's colours are its own; a
 *  cosmetic top keeps its own colours too, and the doll leaves the bottom out under one that covers the legs:
 *  wardrobe.cosmeticHidesBottom) and a fitting weapon cosmetic's id (`weapon`: cosmeticWeaponOf), or as it is when
 *  there's none. */
export function withCosmetics<O extends Pick<OutfitData, 'hat' | 'hatColour' | 'top' | 'weaponCosmetic'>>(outfit: O, hat: string | null, top: string | null = null, weapon: string | null = null): O {
  // (Never a weapon skin from the look it starts from: only one that fits now. A class change takes it off.)
  const { weaponCosmetic: _, ...base } = outfit;
  let o = (weapon ? { ...base, weaponCosmetic: weapon } : base) as O;
  if (hat) {
    const { hatColour: _, ...rest } = o;
    o = { ...rest, hat } as O;
  }
  if (top) o = { ...o, top };
  return o;
}
