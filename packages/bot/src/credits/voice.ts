import type { Client } from 'discord.js';
import { config } from '../config.js';
import { addVoiceMinute } from './store.js';

// Every minute, give a voice minute to everyone actively in voice. To stop idle farming, it doesn't count
// the AFK channel, deafened members, bots, or anyone alone in a channel.
const TICK_MS = 60_000;

function activeVoiceUsers(client: Client): string[] {
  const guild = client.guilds.cache.get(config.guildId ?? '') ?? client.guilds.cache.first();
  if (!guild) return [];

  const byChannel = new Map<string, string[]>();
  for (const state of guild.voiceStates.cache.values()) {
    if (!state.channelId || state.channelId === guild.afkChannelId) continue;
    if (state.member?.user.bot || state.deaf) continue; // deaf = self- or server-deafened
    const list = byChannel.get(state.channelId) ?? [];
    list.push(state.id);
    byChannel.set(state.channelId, list);
  }
  return [...byChannel.values()].filter((ids) => ids.length >= 2).flat();
}

export function startVoiceCredits(client: Client): void {
  setInterval(() => {
    try {
      const earned = addVoiceMinute(activeVoiceUsers(client));
      if (earned.length) console.log(`[voice] +1 Kowen: ${earned.length} member(s)`);
    } catch (err) {
      console.error('[voice] tick failed:', err);
    }
  }, TICK_MS);
}
