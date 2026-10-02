import type { Client } from 'discord.js';
import { config } from '../config.js';
import { banterLines } from './lines.js';
import { shuffleBag } from '../shuffle-bag.js';

// Posts a random line at random times: every MIN–MAX hours, only during active hours (config.timezone).
const MIN_GAP_MS = 2 * 3_600_000;
const MAX_GAP_MS = 6 * 3_600_000;
const ACTIVE_FROM_HOUR = 9; // 9 AM
const ACTIVE_UNTIL_HOUR = 23; // 11 PM

const nextLine = shuffleBag('banter', banterLines);

function hourNow(): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
}

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

export async function sendBanter(client: Client): Promise<void> {
  const channel = await client.channels.fetch(config.banterChannelId);
  if (!channel?.isSendable()) throw new Error(`Channel ${config.banterChannelId} not found or not sendable`);
  await channel.send({ content: nextLine(), allowedMentions: { parse: [] } });
}

export function startBanter(client: Client): void {
  const schedule = (delayMs: number) => {
    console.log(`[banter] next check in ${Math.round(delayMs / 60_000)} min`);
    setTimeout(tick, delayMs);
  };

  const tick = async () => {
    const hour = hourNow();
    if (hour < ACTIVE_FROM_HOUR || hour >= ACTIVE_UNTIL_HOUR) {
      // Quiet hours — check again in 30–90 min.
      schedule(randomBetween(30 * 60_000, 90 * 60_000));
      return;
    }
    try {
      await sendBanter(client);
    } catch (err) {
      console.error('[banter] failed:', err);
    }
    schedule(randomBetween(MIN_GAP_MS, MAX_GAP_MS));
  };

  schedule(randomBetween(MIN_GAP_MS, MAX_GAP_MS));
}
