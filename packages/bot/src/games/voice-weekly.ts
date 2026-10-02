import type { Client } from 'discord.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { config } from '../config.js';
import { add, topVoiceWeek } from '../credits/store.js';
import { kowen } from '../kowens.js';
import { addDays, weekStart } from '../time.js';

// 🎙️ Weekly voice chat rewards: every Monday, last week's top 10 (by eligible voice minutes) get Kowens.
export const WEEKLY_VC_REWARDS = [50, 30, 20, 10, 10, 10, 10, 10, 10, 10];
/** The first week that counts. Its rewards are paid the Monday after. */
export const WEEKLY_VC_START = '2026-10-05';

const DIR = 'data';
const FILE = `${DIR}/voice-weekly.json`;
const paidWeeks: string[] = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : [];

const hours = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`);
const medal = (i: number) => ['🥇', '🥈', '🥉'][i] ?? `**${i + 1}.**`;

/** Monday noon: pays last week's top 10 (once per week). */
export async function payWeeklyVoice(client: Client): Promise<void> {
  const lastWeek = addDays(weekStart(), -7);
  if (lastWeek < WEEKLY_VC_START || paidWeeks.includes(lastWeek)) return;
  const top = topVoiceWeek(lastWeek, WEEKLY_VC_REWARDS.length);
  paidWeeks.push(lastWeek);
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(paidWeeks));
  if (!top.length) return;

  top.forEach(([id], i) => add(id, WEEKLY_VC_REWARDS[i]));
  const lines = top.map(([id, m], i) => `${medal(i)} <@${id}> — ${hours(m)} · **+${WEEKLY_VC_REWARDS[i]}** ${kowen(WEEKLY_VC_REWARDS[i])}`);
  const channel = await client.channels.fetch(config.gamesChannelId).catch(() => null);
  if (channel?.isSendable()) {
    await channel.send({
      content: `🎙️🏆 **Weekly Voice Chat Rewards** (week of ${lastWeek})\nThanks for hanging out in voice! 🫶\n\n${lines.join('\n')}\n\n-# A new week has started, so the counter is back to 0. See you in voice!`,
      allowedMentions: { users: top.map(([id]) => id) },
    });
  }
  console.log(`[voice-weekly] paid ${top.length} member(s) for week ${lastWeek}`);
}
