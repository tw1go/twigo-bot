import type { Client } from 'discord.js';
import { config } from '../config.js';

// 🧪 Testers: members with the Tester role (GAME_TESTER_ROLE_ID). Passes are theirs only (games/redeem.ts). Without the
// role set, everyone counts.

export async function isTester(client: Client, userId: string): Promise<boolean> {
  if (!config.testerRoleId) return true;
  const guild = client.guilds.cache.get(config.guildId ?? '') ?? client.guilds.cache.first();
  const member = await guild?.members.fetch(userId).catch(() => null);
  return !!member?.roles.cache.has(config.testerRoleId);
}
