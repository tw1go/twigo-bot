import type { CosmeticPlace } from './adventure.js';
import type { Item } from './items.js';
import type { OutfitData } from './room-api.js';

// 🎩 Cosmetics on a look (CONTEXT.md: Cosmetic, Costume). A worn head cosmetic (AdventureState.cosmetics.head) puts its
// hat on the look in place of the one chosen at the creator (manifest characters.wardrobe.cosmeticHats: item id → hat
// key), a worn body cosmetic its top (wardrobe.cosmeticTops: the Witch Robe); the chosen hat and its colour stay saved and come back when it's taken off. The server resolves the look it
// shows everyone (the town's profile, restyle); the game resolves its own from its adventure state. A saved look never
// holds a cosmetic hat itself (the bot's parseOutfit refuses them): only wearing the item puts it there.

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

/** A look with a cosmetic hat and top on it (the chosen hat's colour left out: the cosmetic's colours are its own; a
 *  cosmetic top keeps its own colours too, and the doll leaves the bottom out under one that covers the legs:
 *  wardrobe.cosmeticHidesBottom), or as it is when there's none. */
export function withCosmetics<O extends Pick<OutfitData, 'hat' | 'hatColour' | 'top'>>(outfit: O, hat: string | null, top: string | null = null): O {
  let o = outfit;
  if (hat) {
    const { hatColour: _, ...rest } = o;
    o = { ...rest, hat } as O;
  }
  if (top) o = { ...o, top };
  return o;
}
