import { ownedPotions } from '../potions/potions.js';
import { capacity, itemCount, masterKeys } from './store.js';
import { megaphones } from '../items/megaphone.js';
import { renameCards } from '../items/rename-card.js';
import { classTickets } from '../items/class-ticket.js';

// 🎒 What fills a member's bag: every dug-up item, and the redeemed items they hold (Master Keys, potions), one slot
// each; megaphones all share one slot, and so do Rename Cards and Bagong Buhay Tickets. (The web game's gear and combat items are in its own combat bag: web/adventure.ts.) /dig, /redeem, the town's Mine and shop, /inventory and /status all count it this way.

/** Slots in use. */
export const usedSlots = (userId: string) => itemCount(userId) + masterKeys(userId) + (megaphones(userId) ? 1 : 0) + (renameCards(userId) ? 1 : 0) + (classTickets(userId) ? 1 : 0) + ownedPotions(userId).reduce((sum, [, n]) => sum + n, 0);

/** Slots still free (never below 0, even for a bag that was over before redeemed items counted). */
export const freeSlots = (userId: string) => Math.max(0, capacity(userId) - usedSlots(userId));
