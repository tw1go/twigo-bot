import { tableSync } from '../db/sync.js';
import { MessageFlags, type ChatInputCommandInteraction, type ButtonInteraction, type Client } from 'discord.js';
import { config } from '../config.js';
import { balance } from '../credits/store.js';

// Jail: jailed members get the jail role and can't play /gamble, /steal, /jackpot or Tanod Patrol.
// Jail times are saved so a restart doesn't free anyone early.

interface JailEntry {
  until: number; // ms timestamp
  reason: string;
  noBail?: boolean; // set for admin /jail — those sentences must be served in full
}

// Bail (/bail): BAIL_PERCENT of the jailed member's Kowens, between MIN_BAIL and MAX_BAIL. The Kowens are removed.
export const BAIL_PERCENT = 0.05;
export const MIN_BAIL = 3;
export const MAX_BAIL = 100;

/** Bail for a jailed member, based on their own balance (so a broke friend can't pay a cheap one). */
export const bailFor = (userId: string) => Math.min(MAX_BAIL, Math.max(MIN_BAIL, Math.ceil(balance(userId) * BAIL_PERCENT)));

/** False if they're not jailed, or were jailed by an admin. */
export const canBail = (userId: string) => !!jailedUntil(userId) && !jailed[userId]?.noBail;

// Sentences live in the `jail` table.
const table = tableSync<{ user_id: string; until: number; reason: string; no_bail: number | null }>('jail', ['user_id'], ['until', 'reason', 'no_bail']);
let jailed: Record<string, JailEntry> = Object.fromEntries(
  table.load().map((r): [string, JailEntry] => [r.user_id, { until: r.until, reason: r.reason, ...(r.no_bail ? { noBail: true } : {}) }]),
);

function save(): void {
  table.save(Object.entries(jailed).map(([user_id, e]) => ({ user_id, until: e.until, reason: e.reason, no_bail: e.noBail ? 1 : null })));
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

export async function jail(userId: string, minutes: number, reason: string, bailable = true): Promise<number> {
  const current = jailedUntil(userId) ? jailed[userId] : undefined;
  const until = Math.max(current?.until ?? 0, Date.now()) + minutes * 60_000;
  // Once an admin sentence is involved, the whole stay is no-bail.
  jailed[userId] = { until, reason, ...((!bailable || current?.noBail) && { noBail: true }) };
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
    content: `🚔 You're in jail until <t:${Math.floor(until / 1000)}:t> (<t:${Math.floor(until / 1000)}:R>).` +
      (canBail(interaction.user.id) ? `\n-# Can't wait? \`/bail\` costs ${bailFor(interaction.user.id)} Kowens.` : ''),
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
