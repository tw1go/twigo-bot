import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Client, MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';
import { config } from '../config.js';
import { add } from '../credits/store.js';
import { kowen } from '../kowens.js';

// 🥚 Easter egg: react to a secret message once for a one-time reward. Announced in general (only the finder
// is pinged), without saying where the egg is.
export const EGG_REWARD = 5;

const DIR = 'data';
const FILE = `${DIR}/easter-eggs.json`;
let found: Record<string, string[]> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {}; // messageId -> userIds

function save(): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(found, null, 2));
}

async function reward(user: User): Promise<void> {
  const list = (found[config.easterEggMessageId] ??= []);
  if (user.bot || list.includes(user.id)) return;
  list.push(user.id);
  save();
  add(user.id, EGG_REWARD);
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
