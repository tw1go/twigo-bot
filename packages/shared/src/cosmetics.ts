import type { CosmeticPlace } from './adventure.js';
import type { Item } from './items.js';
import type { OutfitData } from './room-api.js';

// 🎩 Cosmetics on a look (CONTEXT.md: Cosmetic, Costume). A worn head cosmetic (AdventureState.cosmetics.head) puts its
// hat on the look in place of the one chosen at the creator (manifest characters.wardrobe.cosmeticHats: item id → hat
// key); the chosen hat and its colour stay saved and come back when it's taken off. The server resolves the look it
// shows everyone (the town's profile, restyle); the game resolves its own from its adventure state. A saved look never
// holds a cosmetic hat itself (the bot's parseOutfit refuses them): only wearing the item puts it there.

/** The hat a worn head cosmetic gives, or null. */
export function cosmeticHatOf(hats: Record<string, string>, cosmetics: Partial<Record<CosmeticPlace, Pick<Item, 'defId'>>> | undefined): string | null {
  const head = cosmetics?.head;
  return (head && hats[head.defId]) || null;
}

/** A look with a cosmetic hat on it (the chosen hat's colour left out: the cosmetic's colours are its own), or as it is
 *  when there's none. */
export function withCosmetics<O extends Pick<OutfitData, 'hat' | 'hatColour'>>(outfit: O, hat: string | null): O {
  if (!hat) return outfit;
  const { hatColour: _, ...rest } = outfit;
  return { ...rest, hat } as O;
}
