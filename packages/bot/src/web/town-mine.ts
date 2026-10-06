import type { Client } from 'discord.js';
import type { MeDig, TownDigItemsResponse, TownDigResponse } from '@mikazuki/shared';
import { config } from '../config.js';
import { digFor, digReveal } from '../dig/dig.js';
import { ITEMS, RARITY, RARITY_ORDER, itemChances } from '../dig/items.js';
import { DIGS_PER_DAY, LUCKY_EVERY, SHOVEL_COST } from '../dig/store.js';
import { kowen } from '../kowens.js';
import { feed } from './town-feed.js';

// ⛏️ The town's Mine (POST /town/dig): one dig with /dig's rules (dig/dig.ts). The find goes to the town's feed like
// /dig's (the digger's own game plays the dig panel from it) and the reveal is posted in the dig channel
// (DIG_CHANNEL_ID), as /dig shows it in Discord.

/** The Mine's tier list (GET /town/dig-items): every item still in the ground, by rarity (rarest first), with the
 *  odds of a plain dig (no potion, not the lucky dig). Secret items are never listed. */
export function townDigItems(): TownDigItemsResponse {
  const chances = itemChances();
  const tiers = RARITY_ORDER.filter((r) => r !== 'secret').map((rarity) => {
    const items = ITEMS.filter((i) => i.rarity === rarity && !i.off)
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
      .map((i) => ({ id: i.id, name: i.name, emoji: i.emoji, value: i.value, chance: chances.get(i.id) ?? 0 }));
    return { rarity, label: RARITY[rarity].label, chance: items.reduce((n, i) => n + i.chance, 0), items };
  });
  return { tiers: tiers.filter((t) => t.items.length), luckyEvery: LUCKY_EVERY };
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { timeZone: config.timezone, hour: 'numeric', minute: '2-digit' });

export async function digInTown(client: Client, userId: string, name: string, status: (userId: string) => MeDig): Promise<TownDigResponse> {
  const result = digFor(userId);
  if (!result.ok) {
    const message =
      result.reason === 'jailed' ? `You're in jail until ${clock(result.until)}. No digging till you're out.`
      : result.reason === 'bag-full' ? `Your bag is full (${result.items}/${result.slots}). Sell something with /sell, or get a bigger bag at the shop.`
      : result.reason === 'no-shovel' ? `You need a shovel to dig. Get one at the rewards shop (${SHOVEL_COST} ${kowen(SHOVEL_COST)}).`
      : `You've dug ${DIGS_PER_DAY} times today. Your arms need a rest! Come back tomorrow.`;
    return { ok: false, message, dig: status(userId) };
  }
  const found = result.item;
  const r = RARITY[found.rarity];
  feed('dig', `${name} dug up ${found.name} (${r.label})`, found.rarity, { userId, itemId: found.id, itemName: found.name });
  const channel = await client.channels.fetch(config.digChannelId).catch(() => null);
  if (channel?.isSendable()) {
    await channel
      .send({ content: `${digReveal(`<@${userId}>`, result)}\n-# dug in the town`, allowedMentions: { parse: [] } })
      .catch((err) => console.error('[web] dig post failed:', err));
  }
  return {
    ok: true,
    message: `${result.lucky ? `Lucky dig! The server's ${LUCKY_EVERY}th dig: ` : ''}You dug up ${found.name} (${r.label}), worth ${found.value} ${kowen(found.value)}.`,
    dig: status(userId),
    ...(result.lucky ? { lucky: true } : {}),
    item: { id: found.id, name: found.name, rarity: found.rarity, value: found.value },
  };
}
