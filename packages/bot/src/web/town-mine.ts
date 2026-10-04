import type { Client } from 'discord.js';
import type { MeDig, TownDigResponse } from '@mikazuki/shared';
import { config } from '../config.js';
import { digFor, digReveal } from '../dig/dig.js';
import { RARITY } from '../dig/items.js';
import { DIGS_PER_DAY, SHOVEL_COST } from '../dig/store.js';
import { kowen } from '../kowens.js';
import { feed } from './town-feed.js';

// ⛏️ The town's Mine (POST /town/dig): one dig with /dig's rules (dig/dig.ts). The find goes to the town's feed like
// /dig's (the digger's own game plays the dig panel from it) and the reveal is posted in the dig channel
// (DIG_CHANNEL_ID), as /dig shows it in Discord.

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
    message: `You dug up ${found.name} (${r.label}), worth ${found.value} ${kowen(found.value)}.`,
    dig: status(userId),
    item: { id: found.id, name: found.name, rarity: found.rarity, value: found.value },
  };
}
