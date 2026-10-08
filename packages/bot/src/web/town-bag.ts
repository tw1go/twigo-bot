import type { Client } from 'discord.js';
import type { TownBagActionResponse, TownBagItem, TownInventoryResponse } from '@mikazuki/shared';
import { config } from '../config.js';
import { add, balance } from '../credits/store.js';
import { flexEmbed, flexWait, markFlex } from '../commands/flex.js';
import { usedSlots } from '../dig/bag.js';
import { ITEM_BY_ID, RARITY_ORDER } from '../dig/items.js';
import { MAX_SLOTS, capacity, inventory, masterKeys, removeItems } from '../dig/store.js';
import { kowen } from '../kowens.js';
import { POTIONS, ownedPotions } from '../potions/potions.js';
import { megaphones } from '../items/megaphone.js';
import { renameCards } from '../items/rename-card.js';
import { classTickets } from '../items/class-ticket.js';
import { EQUIPMENT } from './adventure.js';

// 🎒 The town's inventory (GET /town/inventory, POST /town/sell, POST /town/flex): the bag as the town shows it — every
// dug-up item, Master Key and potion, one slot each (gear and combat items are in the combat bag: /me's adventure, the
// town's `items` messages) — and selling or flexing a
// dug-up item with /sell's and /flex's rules (flexes are posted in the games channel like /flex, with the same
// cooldown, and said in the town's chat).

type NameOf = (id: string) => Promise<string>;

const kowens = (n: number) => `${n.toLocaleString('en-US')} ${kowen(n)}`;
/** Potion effects are written for Discord: drop the emoji for the town. */
const plain = (text: string) => text.replace(/\p{Extended_Pictographic}️?\s?/gu, '').trim();

export function townInventory(userId: string): TownInventoryResponse {
  const dug: TownBagItem[] = inventory(userId)
    .map(([id, count]) => ({ item: ITEM_BY_ID.get(id)!, count }))
    .sort((a, b) => RARITY_ORDER.indexOf(a.item.rarity) - RARITY_ORDER.indexOf(b.item.rarity) || b.item.value - a.item.value)
    .map(({ item, count }) => ({ id: item.id, name: item.name, emoji: item.emoji, rarity: item.rarity, value: item.value, count, kind: 'dig', sellable: true }));
  const keys = masterKeys(userId);
  const megaphoneCount = megaphones(userId);
  const cards = renameCards(userId);
  const tickets = classTickets(userId);
  const held: TownBagItem[] = [
    ...(keys ? [{ id: 'master-key', name: 'Master Key', emoji: '🗝️', rarity: 'common', value: 0, count: keys, kind: 'key' as const, sellable: false,
      about: '50% chance to break through a Bakod when you /steal. Used only then.' }] : []),
    ...(megaphoneCount ? [{ id: 'megaphone', name: 'Megaphone', emoji: '📢', rarity: 'common', value: 0, count: megaphoneCount, kind: 'megaphone' as const, sellable: false, stacked: true,
      about: "Type /m and your message in the town's chat: it runs across everyone's screen in sky blue. One per message." }] : []),
    ...(cards ? [{ id: 'rename-card', name: 'Rename Card', emoji: '🪪', rarity: 'common', value: 0, count: cards, kind: 'rename' as const, sellable: false, stacked: true,
      about: 'Use it to change your town nickname (3-16 letters or numbers; spaces, _ - . in between).' }] : []),
    ...(tickets ? [{ id: 'class-ticket', name: 'Bagong Buhay Ticket', emoji: '🎫', rarity: 'common', value: 0, count: tickets, kind: 'classchange' as const, sellable: false, stacked: true,
      about: "A fresh start: use it to change your class. You keep your quests and level, get your stat and skill points back, and your training gear becomes the new class's." }] : []),
    ...ownedPotions(userId).map(([pid, count]) => ({ id: `potion-${pid}`, name: POTIONS[pid].name, emoji: POTIONS[pid].emoji, rarity: 'common', value: 0, count,
      kind: 'potion' as const, sellable: false, about: `${plain(POTIONS[pid].effect)}. Use it with /potion use in Discord.` })),
  ];
  return { items: [...dug, ...held], slots: capacity(userId), maxSlots: MAX_SLOTS, used: usedSlots(userId), kowens: balance(userId) };
}

/** Sells `quantity` of a dug-up item (as /sell does: its value each, into the wallet). */
export function sellInTown(userId: string, id: string, quantity: number): TownBagActionResponse {
  if (EQUIPMENT.get(id)?.training) return { ...townInventory(userId), ok: false, message: "Training gear can't be sold." };
  const item = ITEM_BY_ID.get(id);
  const have = inventory(userId).find(([itemId]) => itemId === id)?.[1] ?? 0;
  if (!item || !have) return { ...townInventory(userId), ok: false, message: "You don't have that item." };
  const sold = removeItems(userId, id, Math.min(quantity, have));
  const earned = sold * item.value;
  add(userId, earned);
  return { ...townInventory(userId), ok: true, message: `Sold ${sold > 1 ? `${sold}× ` : ''}${item.name} for ${kowens(earned)}.` };
}

/** Sells several dug-up items at once (the bag's multi-select): each `{ id, quantity }` as sellInTown, in one go. */
export function sellManyInTown(userId: string, picks: { id: string; quantity: number }[]): TownBagActionResponse {
  let sold = 0;
  let earned = 0;
  for (const { id, quantity } of picks) {
    const item = ITEM_BY_ID.get(id);
    const have = inventory(userId).find(([itemId]) => itemId === id)?.[1] ?? 0;
    if (!item || !have) continue;
    const n = removeItems(userId, id, Math.min(quantity, have));
    sold += n;
    earned += n * item.value;
  }
  if (!sold) return { ...townInventory(userId), ok: false, message: "You don't have those items." };
  add(userId, earned);
  return { ...townInventory(userId), ok: true, message: `Sold ${sold} item${sold === 1 ? '' : 's'} for ${kowens(earned)}.` };
}

/** Flexes a dug-up item: /flex's card in the games channel, and the flexer says it in the town's chat. */
export async function flexInTown(
  client: Client,
  userId: string,
  id: string,
  nameOf: NameOf,
  inTown: (userId: string, item: { id: string; name: string; rarity: string }) => void,
): Promise<TownBagActionResponse> {
  const item = ITEM_BY_ID.get(id);
  const owned = inventory(userId).find(([itemId]) => itemId === id)?.[1] ?? 0;
  if (!item || !owned) return { ...townInventory(userId), ok: false, message: "You don't have that item." };
  const wait = flexWait(userId);
  if (wait > 0) return { ...townInventory(userId), ok: false, message: `Easy, show-off. Flex again in ${Math.ceil(wait / 1000)}s.` };
  markFlex(userId);
  const name = await nameOf(userId);
  const user = await client.users.fetch(userId).catch(() => null);
  const channel = await client.channels.fetch(config.gamesChannelId).catch(() => null);
  if (channel?.isSendable()) {
    await channel
      .send({ embeds: [flexEmbed(name, user?.displayAvatarURL() || undefined, item, owned).setFooter({ text: 'Flexed in the town · dig your own with /dig ⛏️' })], allowedMentions: { parse: [] } })
      .catch((err) => console.error('[web] flex post failed:', err));
  }
  inTown(userId, { id: item.id, name: item.name, rarity: item.rarity });
  return { ...townInventory(userId), ok: true, message: `You flexed ${item.name}! It's in the games channel.` };
}
