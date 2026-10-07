import { ITEMS, RARITY_ORDER, onItemsChange } from '../dig/items.js';
import { SHOVEL_USES, addItems, addMasterKey, addShovelUses } from '../dig/store.js';
import { POTIONS, POTION_IDS, addPotions } from '../potions/potions.js';
import { addMegaphones } from './megaphone.js';
import { addRenameCards } from './rename-card.js';
import { addClassTickets } from './class-ticket.js';

// 🎁 What the gifter can give with /gift item: the shop's items (shovels, Master Keys, megaphones, potions) and every
// dug-up item. Gifts go straight in, ignoring daily shovel limits and bag space (the gifter decides).

export interface Giftable {
  id: string;
  name: string;
  emoji: string;
  rarity: string;
  give(userId: string, n: number): void;
}

const shop: Giftable[] = [
  { id: 'shovel', name: 'Shovel', emoji: '🪏', rarity: 'common', give: (u, n) => void addShovelUses(u, n * SHOVEL_USES) },
  { id: 'master-key', name: 'Master Key', emoji: '🗝️', rarity: 'common', give: (u, n) => { for (let i = 0; i < n; i++) addMasterKey(u); } },
  { id: 'megaphone', name: 'Megaphone', emoji: '📢', rarity: 'common', give: (u, n) => void addMegaphones(u, n) },
  { id: 'rename-card', name: 'Rename Card', emoji: '🪪', rarity: 'common', give: (u, n) => void addRenameCards(u, n) },
  { id: 'class-ticket', name: 'Bagong Buhay Ticket', emoji: '🎫', rarity: 'common', give: (u, n) => void addClassTickets(u, n) },
  ...POTION_IDS.map((pid): Giftable => ({ id: `potion-${pid}`, name: POTIONS[pid].name, emoji: POTIONS[pid].emoji, rarity: 'common', give: (u, n) => void addPotions(u, pid, n) })),
];

const dug = (): Giftable[] => [...ITEMS]
  .sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) || a.name.localeCompare(b.name))
  .map((i) => ({ id: i.id, name: i.name, emoji: i.emoji, rarity: i.rarity, give: (u, n) => addItems(u, i.id, n) }));

/** The shop's items first, then dug-up items (rarest first); kept in step with the CMS's item changes. */
export const GIFTABLE: Giftable[] = [];
export const giftableById = new Map<string, Giftable>();
function refill(): void {
  GIFTABLE.splice(0, GIFTABLE.length, ...shop, ...dug());
  giftableById.clear();
  for (const g of GIFTABLE) giftableById.set(g.id, g);
}
refill();
onItemsChange(refill);
