import type { Client } from 'discord.js';
import type { TownShopBuyResponse, TownShopItem, TownShopResponse } from '@mikazuki/shared';
import { config } from '../config.js';
import { balance, fencedUntil } from '../credits/store.js';
import { SHOVELS_PER_DAY, SHOVEL_USES, masterKeys } from '../dig/store.js';
import { BAG_SLOTS, FENCE_DAYS, FENCE_MAX_DAYS, GAME_NAME, rewards } from '../games/rewards.js';
import { type Reward, inBag, owns, potionEffect, redeemFeed, redeemPost, redeemReward, shovelsLeftToday, stackable } from '../games/redeem.js';
import { megaphones } from '../items/megaphone.js';
import { kowen } from '../kowens.js';
import { debtOf } from '../loans/loans.js';
import { potionCount, type PotionId } from '../potions/potions.js';
import { freeSlots } from '../dig/bag.js';

// 🎁 The town's rewards shop (GET/POST /town/shop): what /redeem sells, bought with the same checks
// (games/redeem.ts). Each purchase is posted in the games channel just like /redeem's (passes ping the reward
// owner, who sends them by hand) and shows in the town's feed.

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
    case 'vault': return 'Store up to 30% of your Kowens, safe from /steal and bail. Use it at the bank.';
    case 'potion': return `${plain(potionEffect(r))}. Use it with /potion use in Discord.`;
    case 'bag': return `+${BAG_SLOTS} inventory slots for what you dig up. Each bag once.`;
    case 'pass': return `A ${GAME_NAME} ${r.name}, sent to you by hand. Not while you have a loan.`;
  }
}

export function townShop(userId: string): TownShopResponse {
  const items = rewards.map((r): TownShopItem => {
    const owned = owns(userId, r);
    // Keys and potions also need room in the bag, a slot each; megaphones one slot for them all.
    const max = owned ? 0 : r.kind === 'shovel' ? shovelsLeftToday(userId) : r.kind === 'megaphone' ? (megaphones(userId) || freeSlots(userId) ? MAX_AT_ONCE : 0) : inBag(r) ? Math.min(MAX_AT_ONCE, freeSlots(userId)) : stackable(r) ? MAX_AT_ONCE : 1;
    const have = r.kind === 'potion' ? potionCount(userId, r.id.replace('potion-', '') as PotionId) : r.kind === 'key' ? masterKeys(userId) : r.kind === 'megaphone' ? megaphones(userId) : undefined;
    return { id: r.id, name: r.name, cost: r.cost, kind: r.kind, about: about(r), max, ...(owned ? { owned } : {}), ...(have !== undefined ? { have } : {}) };
  });
  return { kowens: balance(userId), items, fenceUntil: fencedUntil(userId), inDebt: !!debtOf(userId) };
}

/** Buys `quantity` of a reward; tells the games channel and the town's feed when it works. */
export async function buyFromShop(client: Client, userId: string, id: string, quantity: number, name: string): Promise<TownShopBuyResponse> {
  const reward = rewards.find((r) => r.id === id);
  if (!reward) return { ...townShop(userId), ok: false, message: 'That reward is gone.' };
  const result = redeemReward(userId, reward, quantity);
  if (!result.ok) {
    const message = (() => {
      switch (result.reason) {
        case 'quantity': return `The ${reward.name} is one at a time.`;
        case 'loan': return 'You can\'t redeem passes while you have a loan. Pay it off at the bank first.';
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
    return { ...townShop(userId), ok: false, message };
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
  return { ...townShop(userId), ok: true, message };
}
