import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { MessageFlags, type ChatInputCommandInteraction, type ButtonInteraction, type Client } from 'discord.js';
import { config } from '../config.js';

// Jail: jailed members get the jail role and can't play /gamble, /steal, /jackpot or Tanod Patrol.
// Jail times are saved so a restart doesn't free anyone early.

interface JailEntry {
  until: number; // ms timestamp
  reason: string;
}

const DIR = 'data';
const FILE = `${DIR}/jail.json`;
let jailed: Record<string, JailEntry> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};

function save(): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(jailed));
}

let client: Client | undefined;

async function setRole(userId: string, on: boolean): Promise<void> {
  const guild = client?.guilds.cache.get(config.guildId ?? '') ?? client?.guilds.cache.first();
  const member = await guild?.members.fetch(userId).catch(() => null);
  if (!member) return;
  if (on) await member.roles.add(config.jailRoleId, 'Jailed').catch((e) => console.error('[jail] add role:', e.message));
  else await member.roles.remove(config.jailRoleId, 'Released').catch((e) => console.error('[jail] remove role:', e.message));
}

/** Returns the release time if the member is currently jailed. */
export function jailedUntil(userId: string): number | null {
  const entry = jailed[userId];
  return entry && entry.until > Date.now() ? entry.until : null;
}

export async function jail(userId: string, minutes: number, reason: string): Promise<number> {
  const until = Math.max(jailedUntil(userId) ?? 0, Date.now()) + minutes * 60_000;
  jailed[userId] = { until, reason };
  save();
  await setRole(userId, true);
  return until;
}

export async function release(userId: string): Promise<boolean> {
  if (!jailed[userId]) return false;
  delete jailed[userId];
  save();
  await setRole(userId, false);
  return true;
}

export function jailList(): [string, JailEntry][] {
  return Object.entries(jailed).filter(([, e]) => e.until > Date.now());
}

/** For game commands: replies and returns true if the caller is jailed. */
export async function blockIfJailed(interaction: ChatInputCommandInteraction | ButtonInteraction): Promise<boolean> {
  const until = jailedUntil(interaction.user.id);
  if (!until) return false;
  await interaction.reply({
    content: `🚔 You're in jail until <t:${Math.floor(until / 1000)}:t> (<t:${Math.floor(until / 1000)}:R>).`,
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

/** Releases members whose time is up (checked every 30s). */
export function startJailWatcher(c: Client): void {
  client = c;
  const tick = async () => {
    for (const [id, entry] of Object.entries(jailed)) {
      if (entry.until <= Date.now()) await release(id).catch((e) => console.error('[jail] release failed:', e));
    }
  };
  void tick();
  setInterval(() => void tick(), 30_000);
}
