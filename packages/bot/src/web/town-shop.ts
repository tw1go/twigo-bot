import type { Client } from 'discord.js';
import type { TownShopBuyResponse, TownShopItem, TownShopResponse } from '@mikazuki/shared';
import { config } from '../config.js';
import { balance, fencedUntil, take } from '../credits/store.js';
import { SHOVELS_PER_DAY, SHOVEL_USES, masterKeys } from '../dig/store.js';
import { BAG_SLOTS, FENCE_DAYS, FENCE_MAX_DAYS, GAME_NAME, rewards } from '../games/rewards.js';
import { type Reward, inBag, owns, potionEffect, redeemFeed, redeemPost, redeemReward, shovelsLeftToday, stackable } from '../games/redeem.js';
import { megaphones } from '../items/megaphone.js';
import { renameCards } from '../items/rename-card.js';
import { classTickets } from '../items/class-ticket.js';
import { kowen } from '../kowens.js';
import { debtOf } from '../loans/loans.js';
import { potionCount, type PotionId } from '../potions/potions.js';
import { freeSlots } from '../dig/bag.js';
import { isTester } from '../games/testers.js';
import { countOf, itemStats } from '@mikazuki/shared';
import { adventureOf, buyCombatFor } from './adventure.js';
import { combatWares, mostAtOnce, potionOf, roomFor } from './combat-bag.js';
import { loadItemData } from './stats-data.js';

// 🎁 The town's rewards shop (GET/POST /town/shop): what /redeem sells, bought with the same checks
// (games/redeem.ts). Each purchase is posted in the games channel just like /redeem's (passes ping the reward
// owner, who sends them by hand) and shows in the town's feed. Passes are for testers only (games/testers.ts).
// Two more tabs for the Slums (web/combat-bag.ts): Healing (HP and MP Potions for Kusing) and Smithing (whetstones and
// Repair Kits for Kowens), into the combat bag; only the Low tier until a character reaches the next tier's level.

/** Most of a stackable reward bought at once (as /redeem's quantity option). */
const MAX_AT_ONCE = 10;

const kowens = (n: number) => `${n.toLocaleString('en-US')} ${kowen(n)}`;
/** Potion effects are written for Discord: drop the emoji for the town. */
const plain = (text: string) => text.replace(/\p{Extended_Pictographic}️?\s?/gu, '').trim();

function about(r: Reward): string {
  switch (r.kind) {
    case 'fence': return `Blocks /steal against you for ${FENCE_DAYS} days. Buy again to add time (up to ${FENCE_MAX_DAYS} days).`;
    case 'shovel': return `${SHOVEL_USES} digs with /dig. Up to ${SHOVELS_PER_DAY} shovels a day.`;
    case 'key': return '50% chance to break through a Bakod when you /steal. Used only then.';
    case 'megaphone': return "Type /m and your message in the town's chat: it runs across everyone's screen in sky blue. One per message.";
    case 'rename': return "Changes your town nickname: use it from your bag. All your cards share one bag slot.";
    case 'classchange': return 'A fresh start: use it from your bag to change your class (you keep your quests and level, get your stat and skill points back, and your training gear becomes the new class\'s). All your tickets share one bag slot.';
    case 'vault': return 'Store up to 30% of your Kowens, safe from /steal and bail. Use it at the bank.';
    case 'potion': return `${plain(potionEffect(r))}. Use it with /potion use in Discord.`;
    case 'bag': return `+${BAG_SLOTS} inventory slots for what you dig up. Each bag once.`;
    case 'pass': return `A ${GAME_NAME} ${r.name}, sent to you by hand. Testers only; not while you have a loan.`;
  }
}

/** `tester`: whether they have the Tester role (passes are for testers only). */
export function townShop(userId: string, tester: boolean): TownShopResponse {
  const items = rewards.map((r): TownShopItem => {
    const owned = owns(userId, r);
    const testersOnly = r.kind === 'pass' && !tester;
    // Keys and potions also need room in the bag, a slot each; megaphones one slot for them all.
    const max = owned || testersOnly ? 0 : r.kind === 'shovel' ? shovelsLeftToday(userId) : r.kind === 'megaphone' ? (megaphones(userId) || freeSlots(userId) ? MAX_AT_ONCE : 0) : r.kind === 'rename' ? (renameCards(userId) || freeSlots(userId) ? MAX_AT_ONCE : 0) : r.kind === 'classchange' ? (classTickets(userId) || freeSlots(userId) ? MAX_AT_ONCE : 0) : inBag(r) ? Math.min(MAX_AT_ONCE, freeSlots(userId)) : stackable(r) ? MAX_AT_ONCE : 1;
    const have = r.kind === 'potion' ? potionCount(userId, r.id.replace('potion-', '') as PotionId) : r.kind === 'key' ? masterKeys(userId) : r.kind === 'megaphone' ? megaphones(userId) : r.kind === 'rename' ? renameCards(userId) : r.kind === 'classchange' ? classTickets(userId) : undefined;
    return { id: r.id, name: r.name, cost: r.cost, kind: r.kind, about: about(r), max, ...(owned ? { owned } : {}), ...(testersOnly ? { testersOnly } : {}), ...(have !== undefined ? { have } : {}) };
  });
  // The combat items (their own tabs), by the character's level and combat bag.
  const D = loadItemData();
  const s = adventureOf(userId);
  const combat = combatWares(D, s.progress.level).map((w): TownShopItem => ({
    id: w.def.id,
    name: w.def.name,
    cost: w.cost,
    kind: w.tab,
    ...(w.currency === 'kusing' ? { currency: 'kusing' as const } : {}),
    about: combatAbout(w.def.id, w.def.about),
    max: Math.min(mostAtOnce(D, w.def.id), roomFor(D, s, w.def.id)),
    have: countOf(s.bag, w.def.id),
  }));
  return { kowens: balance(userId), kusing: s.kusing, items: [...items, ...combat], fenceUntil: fencedUntil(userId), inDebt: !!debtOf(userId) };
}

/** What a combat item does, for the shop. */
function combatAbout(id: string, about: string | undefined): string {
  const D = loadItemData();
  const p = potionOf(D, id);
  if (p) return `Heals ${p.amount} ${p.heals.toUpperCase()} at once. Put it on your hotbar; HP and MP Potions share a ${itemStats(D.stats).potions.sharedCooldownSec} s cooldown. For the Slums.`;
  return about ?? '';
}

/** Buys a combat item (Healing or Smithing): into the combat bag, paid in Kusing or Kowens. */
function buyCombatItem(userId: string, id: string, quantity: number, tester: boolean): TownShopBuyResponse {
  const r = buyCombatFor(userId, id, quantity, {
    have: balance(userId),
    spend: (n) => balance(userId) >= n && take(userId, n) === n,
  });
  if (r.ok) console.log(`[shop] ${userId} bought ${r.quantity}× ${id}`);
  return { ...townShop(userId, tester), ok: r.ok, message: r.message };
}

/** Buys `quantity` of a reward; tells the games channel and the town's feed when it works. */
export async function buyFromShop(client: Client, userId: string, id: string, quantity: number, name: string): Promise<TownShopBuyResponse> {
  const tester = await isTester(client, userId);
  const shop = () => townShop(userId, tester);
  if (combatWares(loadItemData(), adventureOf(userId).progress.level).some((w) => w.def.id === id)) return buyCombatItem(userId, id, quantity, tester);
  const reward = rewards.find((r) => r.id === id);
  if (!reward) return { ...shop(), ok: false, message: 'That reward is gone.' };
  if (quantity > MAX_AT_ONCE) return { ...shop(), ok: false, message: `Up to ${MAX_AT_ONCE} at a time.` };
  const result = redeemReward(userId, reward, quantity, tester);
  if (!result.ok) {
    const message = (() => {
      switch (result.reason) {
        case 'quantity': return `The ${reward.name} is one at a time.`;
        case 'loan': return 'You can\'t redeem passes while you have a loan. Pay it off at the bank first.';
        case 'testers': return 'Passes are for testers only (members with the Tester role).';
        case 'owned': return `You already have the ${reward.name}.`;
        case 'shovels-today': return `You already bought ${SHOVELS_PER_DAY} shovels today. More tomorrow!`;
        case 'kowens':
          return `You need ${kowens(result.total)} but have ${kowens(result.have)}.` +
            (stackable(reward) && result.canAfford > 0 ? ` You can afford ${result.canAfford}.` : '');
        case 'marites': return 'Aling Marites has already told you everything she knows.';
        case 'bag-full':
          return result.free ? `Your bag only has room for ${result.free} more. Sell something, or get a bigger bag.` : 'Your bag is full. Sell something, or get a bigger bag.';
        case 'fence-max':
          return `Your Bakod already lasts until ${new Date(result.until).toLocaleString('en-US', { timeZone: config.timezone, dateStyle: 'medium', timeStyle: 'short' })}: the most is ${FENCE_MAX_DAYS} days.`;
      }
    })();
    return { ...shop(), ok: false, message };
  }

  const n = result.quantity;
  const what = n > 1 ? `${n}× ${reward.name}` : reward.name;
  const message =
    reward.kind === 'pass' ? `Redeemed the ${reward.name}! The owner has been told and will send it over.`
    : reward.kind === 'shovel' && n < quantity ? `Bought ${what} (only ${n} more today).`
    : `Bought ${what}!`;
  redeemFeed(name, result);
  const channel = await client.channels.fetch(config.gamesChannelId).catch(() => null);
  if (channel?.isSendable()) await channel.send(redeemPost(userId, result)).catch((err) => console.error('[web] shop post failed:', err));
  return { ...shop(), ok: true, message };
}
