import { type Client, Events, type Message, MessageFlags, escapeMarkdown } from 'discord.js';
import { config } from '../config.js';
import { getNickname } from './nickname.js';
import type { Town } from './town.js';

// 💬 The town chat ↔ a Discord channel (TOWN_CHAT_CHANNEL_ID). What's said in town is posted there as
// "**Nickname**: message"; what's said there shows in the town's chat with a Discord mark (no bubble: they're not
// in town). No pings either way. Reading the channel needs the Message Content intent (index.ts asks for it only
// when this channel is set; it must also be switched on in the Developer Portal).

/** Plain text from a Discord message: mentions as names, custom emoji as :name:, attachments as [image]/[file]. */
function plain(message: Message): string {
  let text = message.cleanContent.replace(/<a?:(\w+):\d+>/g, ':$1:');
  for (const a of message.attachments.values()) text += a.contentType?.startsWith('image/') ? ' [image]' : ' [file]';
  if (message.stickers.size) text += ' [sticker]';
  return text.trim();
}

export function bridgeTownChat(client: Client, town: Town): (userId: string, nickname: string, text: string, megaphone: boolean, gm?: boolean) => void {
  const channelId = config.townChatChannelId;
  if (!channelId) return () => {};

  client.on(Events.MessageCreate, (message) => {
    if (message.channelId !== channelId || message.author.bot || message.webhookId) return;
    const text = plain(message);
    if (!text) return;
    // Their game nickname if they have one, so they're the same person in town and here.
    const name = getNickname(message.author.id) ?? message.member?.displayName ?? message.author.globalName ?? message.author.username;
    town.fromDiscord(name, text);
  });

  // Town → Discord.
  const post = async (nickname: string, text: string, megaphone: boolean, gm = false) => {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isSendable()) return;
    await channel.send({
      content: `${!gm && megaphone ? '📢 ' : ''}**${escapeMarkdown(nickname)}**: ${escapeMarkdown(text)}`,
      allowedMentions: { parse: [] },
      flags: MessageFlags.SuppressEmbeds,
    });
  };
  return (_userId, nickname, text, megaphone, gm) => void post(nickname, text, megaphone, gm).catch((err) => console.error('[town-chat] could not post to Discord:', err));
}
