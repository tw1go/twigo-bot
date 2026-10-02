import { kvLoad, kvSave } from '../db/db.js';
import { markFound } from './found.js';
import type { Client, MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';
import { config } from '../config.js';
import { add } from '../credits/store.js';
import { kowen } from '../kowens.js';

// 🥚 Easter egg: react to a secret message once for a one-time reward. Announced in general (only the finder
// is pinged), without saying where the egg is.
export const EGG_REWARD = 5;

const KEY = 'easter-eggs.json'; // kv key (its old file name)
let found: Record<string, string[]> = kvLoad(KEY, {}); // messageId -> userIds

function save(): void {
  kvSave(KEY, found);
}

async function reward(user: User): Promise<void> {
  const list = (found[config.easterEggMessageId] ??= []);
  if (user.bot || list.includes(user.id)) return;
  list.push(user.id);
  save();
  add(user.id, EGG_REWARD);
  markFound(user.id, 'note');
  console.log(`[easter-egg] ${user.id} found it (+${EGG_REWARD})`);
  const channel = await user.client.channels.fetch(config.gamesChannelId).catch(() => null);
  if (channel?.isSendable()) {
    await channel.send({
      content: `🥚 **${user} found a hidden Easter egg!** +${EGG_REWARD} ${kowen(EGG_REWARD)} 🪙\n-# Where is it? That's a secret 🤫`,
      allowedMentions: { users: [user.id] },
    });
  }
}

export async function onEggReaction(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): Promise<void> {
  if (reaction.message.id !== config.easterEggMessageId) return;
  await reward(user.partial ? await user.fetch() : user);
}

/** On startup: reward anyone who reacted while the bot was offline. */
export async function catchUpEggs(client: Client): Promise<void> {
  const channel = await client.channels.fetch(config.easterEggChannelId);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(config.easterEggMessageId).catch(() => null);
  if (!message) return;
  for (const reaction of message.reactions.cache.values()) {
    const users = await reaction.users.fetch();
    for (const user of users.values()) await reward(user);
  }
}
