import type { Client, Guild, Message } from 'discord.js';
import type { TownNewsPost, TownNewsResponse } from '@mikazuki/shared';
import { config } from '../config.js';

// 📣 The town's news board (GET /town/news): the latest posts in the announcements and patch notes channels, read
// from Discord and kept for a couple of minutes. Each post's first line, when it's bold, is its title (patch notes
// drop their "🩹 Patch Notes —" prefix: they're in their own tab). Mentions, custom emoji and timestamps become plain
// text here, so no Discord ids reach the page. Embeds (the outpost guide) follow the text: title, description, fields.

const LIMIT = 15;
const CACHE_MS = 2 * 60_000;
let cached: { at: number; news: TownNewsResponse } | null = null;

export async function townNews(client: Client): Promise<TownNewsResponse> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.news;
  const [announcements, patchNotes] = await Promise.all([posts(client, config.announcementsChannelId), posts(client, config.patchNotesChannelId)]);
  const news = { announcements, patchNotes: patchNotes.map((p) => ({ ...p, title: p.title.replace(/^🩹\s*Patch Notes\s*[—–-]\s*/u, '') })) };
  cached = { at: Date.now(), news };
  return news;
}

async function posts(client: Client, channelId: string | undefined): Promise<TownNewsPost[]> {
  if (!channelId) return [];
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased() || !('messages' in channel)) return [];
    const messages = await channel.messages.fetch({ limit: LIMIT });
    const guild = 'guild' in channel ? channel.guild : null;
    const out: TownNewsPost[] = [];
    for (const m of messages.values()) {
      const post = await toPost(m, guild);
      if (post) out.push(post);
    }
    return out.sort((a, b) => b.at - a.at);
  } catch (err) {
    console.warn(`[news] couldn't read channel ${channelId}:`, err);
    return [];
  }
}

/** What a post is made from (a discord.js Message has these). */
type Source = Pick<Message, 'content' | 'createdTimestamp'> & { embeds: { title: string | null; description: string | null; fields: { name: string; value: string }[] }[] };

export async function toPost(m: Source, guild: Guild | null): Promise<TownNewsPost | null> {
  const parts = [m.content];
  for (const e of m.embeds) {
    if (e.title) parts.push(`**${e.title}**`);
    if (e.description) parts.push(e.description);
    for (const f of e.fields) parts.push(`**${f.name}**\n${f.value}`);
  }
  const text = (await plain(parts.filter(Boolean).join('\n\n'), guild)).trim();
  if (!text) return null;
  const [first, ...rest] = text.split('\n');
  const bold = /^\*\*(.+)\*\*$/.exec(first.trim());
  return bold
    ? { at: m.createdTimestamp, title: bold[1].trim(), body: rest.join('\n').trim() }
    : { at: m.createdTimestamp, title: first.replace(/[*_~`]/g, '').trim().slice(0, 80), body: rest.join('\n').trim() };
}

/** Mentions, custom emoji and timestamps as plain text. */
async function plain(text: string, guild: Guild | null): Promise<string> {
  const names = new Map<string, string>();
  for (const [, id] of text.matchAll(/<@!?(\d+)>/g)) {
    if (names.has(id)) continue;
    const member = await guild?.members.fetch(id).catch(() => null);
    names.set(id, member?.displayName ?? 'someone');
  }
  return text
    .replace(/<@!?(\d+)>/g, (_, id: string) => `@${names.get(id)}`)
    .replace(/<@&(\d+)>/g, (_, id: string) => `@${guild?.roles.cache.get(id)?.name ?? 'role'}`)
    .replace(/<#(\d+)>/g, (_, id: string) => `#${guild?.channels.cache.get(id)?.name ?? 'channel'}`)
    .replace(/<\/([\w -]+):\d+>/g, '/$1') // slash command mentions
    .replace(/<a?:(\w+):\d+>/g, ':$1:')
    .replace(/<t:(\d+)(?::\w)?>/g, (_, s: string) => new Date(Number(s) * 1000).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }));
}
