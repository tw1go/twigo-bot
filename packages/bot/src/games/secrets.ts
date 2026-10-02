import { randomBytes } from 'node:crypto';
import { markFound } from './found.js';
import { kvLoad, kvSave } from '../db/db.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type Client,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from 'discord.js';
import { config } from '../config.js';
import { add } from '../credits/store.js';
import { kowen } from '../kowens.js';
import { today } from '../time.js';
import { activePatrol } from './patrol.js';

// 🤫 Small Easter eggs that aren't announced anywhere. Counters live in the 'secrets.json' kv document.

interface State {
  praiseBot: Record<string, number>; // lifetime /praise-the-bot count
  praiseRewarded: string[];
  salute: Record<string, string>; // userId -> YYYY-MM-DD of their last patrol salute reward
}
const KEY = 'secrets.json'; // kv key (its old file name)
const state: State = kvLoad(KEY, { praiseBot: {}, praiseRewarded: [], salute: {} });
function save(): void {
  kvSave(KEY, state);
}

async function announce(client: Client, content: string, userId: string): Promise<void> {
  const channel = await client.channels.fetch(config.gamesChannelId).catch(() => null);
  if (channel?.isSendable()) await channel.send({ content, allowedMentions: { users: [userId] } }).catch(() => {});
}

// ── 🤖 Praise the bot 10 times (it's free) → +5 once ever ──
export const PRAISE_BOT_GOAL = 10;
export const PRAISE_BOT_REWARD = 5;
/** Returns a bonus line when this praise completes the goal. */
export function onPraiseBot(userId: string): string | null {
  if (state.praiseRewarded.includes(userId)) return null;
  state.praiseBot[userId] = (state.praiseBot[userId] ?? 0) + 1;
  if (state.praiseBot[userId] < PRAISE_BOT_GOAL) {
    save();
    return null;
  }
  state.praiseRewarded.push(userId);
  save();
  add(userId, PRAISE_BOT_REWARD);
  markFound(userId, 'praise-bot');
  return `🥹🤖 You've praised me **${PRAISE_BOT_GOAL} times**… the Tanod is touched. Here's **+${PRAISE_BOT_REWARD} ${kowen(PRAISE_BOT_REWARD)}**, you sweetheart 💖`;
}

// ── 🫡 Salute a Tanod Patrol within 10s of it starting → +1, once a day ──
const SALUTE_WINDOW_MS = 10_000;
export async function onSaluteReaction(reaction: MessageReaction | PartialMessageReaction, rawUser: User | PartialUser): Promise<void> {
  if (reaction.emoji.name !== '🫡') return;
  const patrol = activePatrol();
  if (!patrol || reaction.message.id !== patrol.messageId || Date.now() - patrol.startedAt > SALUTE_WINDOW_MS) return;
  const user = rawUser.partial ? await rawUser.fetch() : rawUser;
  if (user.bot || state.salute[user.id] === today()) return;
  state.salute[user.id] = today();
  save();
  add(user.id, 1);
  markFound(user.id, 'salute');
  const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
  await message.reply({ content: `🫡 ${user} saluted the Tanod! **+1 Kowen**`, allowedMentions: { users: [user.id] } }).catch(() => {});
}

// ── 🌠 11:11 wish: sometimes at 11:11, a button appears; first click in 60s gets +5 ──
export const WISH_CHANCE = 0.25;
export const WISH_REWARD = 5;
const WISH_WINDOW_MS = 60_000;
const WISH_PREFIX = 'wish:';
let wish: { id: string; until: number; claimedBy?: string } | null = null;

export async function maybeMakeAWish(client: Client): Promise<void> {
  if (Math.random() >= WISH_CHANCE) return;
  const channel = await client.channels.fetch(config.gamesChannelId).catch(() => null);
  if (!channel?.isSendable()) return;
  const id = randomBytes(4).toString('hex');
  wish = { id, until: Date.now() + WISH_WINDOW_MS };
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${WISH_PREFIX}${id}`).setLabel('Make a wish').setEmoji('🌠').setStyle(ButtonStyle.Primary),
  );
  const message = await channel.send({ content: '🕚 **11:11!** Make a wish! 🌠✨', components: [row] });
  setTimeout(() => {
    if (wish?.id === id && !wish.claimedBy) {
      wish = null;
      void message.edit({ content: '🕚 11:11 came and went… nobody made a wish. 🌙', components: [] }).catch(() => {});
    }
  }, WISH_WINDOW_MS);
}

export const isWishButton = (customId: string) => customId.startsWith(WISH_PREFIX);

export async function handleWishButton(interaction: ButtonInteraction): Promise<void> {
  const id = interaction.customId.slice(WISH_PREFIX.length);
  if (!wish || wish.id !== id || wish.claimedBy || Date.now() > wish.until) {
    await interaction.reply({ content: 'Too late, the wish was already made. 🌙', flags: MessageFlags.Ephemeral });
    return;
  }
  wish.claimedBy = interaction.user.id;
  add(interaction.user.id, WISH_REWARD);
  markFound(interaction.user.id, 'wish');
  await interaction.update({ content: `🌠 ${interaction.user} made a wish at **11:11**! +${WISH_REWARD} ${kowen(WISH_REWARD)} ✨\n-# Sana matupad 🙏`, components: [], allowedMentions: { users: [interaction.user.id] } });
}

export { announce as announceSecret };
