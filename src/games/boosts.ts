import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { MessageType, type Client, type Guild, type Message } from 'discord.js';
import { config } from '../config.js';
import { add } from '../credits/store.js';

// Server boost rewards: BOOST_CREDITS per boost right away, then BOOST_CREDITS × boost count on the 1st of every month
// while they keep boosting. Discord doesn't give bots per-member boost counts, so we count the "just boosted"
// system messages since the member's current boost started.
export const BOOST_CREDITS = 20;
const BOOST_TYPES = new Set([MessageType.GuildBoost, MessageType.GuildBoostTier1, MessageType.GuildBoostTier2, MessageType.GuildBoostTier3]);

interface Booster {
  count: number;
  since: string; // ISO — member.premiumSince when counted; a new value means a new boosting session
}
interface BoostState {
  initialized: boolean; // existing boosters were counted and paid once
  boosters: Record<string, Booster>;
}

const DIR = 'data';
const FILE = `${DIR}/boosts.json`;
let state: BoostState = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { initialized: false, boosters: {} };

function save(): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(state, null, 2));
}

const guildOf = (client: Client) => client.guilds.cache.get(config.guildId ?? '') ?? client.guilds.cache.first();

export function boostCount(userId: string): number {
  return state.boosters[userId]?.count ?? 0;
}

/** Owner override for when the count is wrong. 0 removes them. */
export function setBoostCount(userId: string, count: number): void {
  if (count <= 0) delete state.boosters[userId];
  else state.boosters[userId] = { count, since: state.boosters[userId]?.since ?? new Date().toISOString() };
  save();
}

/** One-time: count existing boosters from the system channel's history and pay them. */
export async function initBoosters(client: Client): Promise<void> {
  if (state.initialized) return;
  const guild = guildOf(client);
  if (!guild?.systemChannelId) return;
  const channel = await guild.channels.fetch(guild.systemChannelId);
  if (!channel?.isTextBased()) return;

  const boostsBy = new Map<string, Date[]>();
  let before: string | undefined;
  for (let page = 0; page < 100; page++) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    for (const m of batch.values()) if (BOOST_TYPES.has(m.type)) boostsBy.set(m.author.id, [...(boostsBy.get(m.author.id) ?? []), m.createdAt]);
    before = batch.lastKey();
  }

  for (const [id, dates] of boostsBy) {
    const member = await guild.members.fetch(id).catch(() => null);
    if (!member?.premiumSince) continue; // not boosting anymore
    const start = member.premiumSince.getTime() - 86_400_000; // 1-day slack
    const count = Math.max(1, dates.filter((d) => d.getTime() >= start).length);
    state.boosters[id] = { count, since: member.premiumSince.toISOString() };
    add(id, BOOST_CREDITS * count);
    console.log(`[boosts] existing booster ${id}: ${count} boost(s), +${BOOST_CREDITS * count}`);
  }
  state.initialized = true;
  save();
}

/** Live: someone just boosted. */
export async function onBoostMessage(message: Message): Promise<void> {
  if (!BOOST_TYPES.has(message.type) || !message.guild) return;
  const member = await message.guild.members.fetch(message.author.id).catch(() => null);
  const since = (member?.premiumSince ?? new Date()).toISOString();
  const current = state.boosters[message.author.id];
  const count = current && current.since === since ? current.count + 1 : 1;
  state.boosters[message.author.id] = { count, since };
  save();
  add(message.author.id, BOOST_CREDITS);
  const channel = await message.client.channels.fetch(config.boostChannelId);
  if (channel?.isSendable()) {
    await channel.send({
      content:
        `💎 **${message.author} just boosted the server!** Salamat po! 🫡\n` +
        `🪙 You've been credited **+${BOOST_CREDITS} credits**, and you'll get **${BOOST_CREDITS * count}** every month while you keep boosting ` +
        `(${count} boost${count === 1 ? '' : 's'}).`,
      allowedMentions: { users: [message.author.id] },
    });
  }
}

/** 1st of the month: pay active boosters, drop anyone who stopped. */
export async function monthlyBoostPayout(client: Client): Promise<void> {
  const guild: Guild | undefined = guildOf(client);
  if (!guild) return;
  const paid: string[] = [];
  for (const [id, b] of Object.entries(state.boosters)) {
    const member = await guild.members.fetch(id).catch(() => null);
    if (!member?.premiumSince) {
      delete state.boosters[id];
      continue;
    }
    add(id, BOOST_CREDITS * b.count);
    paid.push(`<@${id}> +${BOOST_CREDITS * b.count} (${b.count} boost${b.count === 1 ? '' : 's'})`);
  }
  save();
  if (!paid.length) return;
  const channel = await client.channels.fetch(config.boostChannelId);
  if (channel?.isSendable()) {
    await channel.send({ content: `💎 **Booster payday!** Thank you for boosting the barangay:\n${paid.join('\n')}`, allowedMentions: { parse: [] } });
  }
}
