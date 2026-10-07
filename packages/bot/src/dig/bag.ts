import { ownedPotions } from '../potions/potions.js';
import { capacity, itemCount, masterKeys } from './store.js';
import { megaphones } from '../items/megaphone.js';
import { renameCards } from '../items/rename-card.js';
import { equipmentInBag } from '../web/adventure.js';

// 🎒 What fills a member's bag: every dug-up item, and the redeemed items they hold (Master Keys, potions), one slot
// each; megaphones all share one slot, and so do Rename Cards; equipment not being worn (the web game's weapons and gear) takes one each. /dig, /redeem, the town's Mine and shop, /inventory and /status all count it this way.

/** Slots in use. */
export const usedSlots = (userId: string) => itemCount(userId) + masterKeys(userId) + (megaphones(userId) ? 1 : 0) + (renameCards(userId) ? 1 : 0) + ownedPotions(userId).reduce((sum, [, n]) => sum + n, 0) + equipmentInBag(userId).length;

/** Slots still free (never below 0, even for a bag that was over before redeemed items counted). */
export const freeSlots = (userId: string) => Math.max(0, capacity(userId) - usedSlots(userId));
