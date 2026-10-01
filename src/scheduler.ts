import type { Client } from 'discord.js';
import { Cron } from 'croner';
import { config } from './config.js';
import { schedule as abf } from './match/schedule.js';
import { askAdmin, closePoll, remindParticipants, startMatch } from './match/flow.js';
import { schedule as mineWars } from './minewars/schedule.js';
import { startMineWars, warnMineWars } from './minewars/flow.js';
import { sendGreeting } from './greetings/flow.js';
import { DRAW_CRON, drawJackpot } from './games/jackpot.js';
import { runDecay } from './credits/decay.js';
import { monthlyBoostPayout } from './games/boosts.js';
import { maybeMakeAWish } from './games/secrets.js';

export function startScheduler(client: Client): Cron[] {
  const job = (name: string, pattern: string, fn: (c: Client) => Promise<void>) =>
    new Cron(pattern, { name, timezone: config.timezone, protect: true }, async () => {
      try {
        await fn(client);
      } catch (err) {
        console.error(`[scheduler] ${name} failed:`, err);
      }
    });

  const jobs = [
    job('abf:ask', abf.askAdmin, askAdmin),
    job('abf:close', abf.closePoll, closePoll),
    job('abf:remind', abf.remind, remindParticipants),
    job('abf:start', abf.start, startMatch),
    job('mw:warning', mineWars.warning, warnMineWars),
    job('mw:start', mineWars.start, startMineWars),
    job('greeting', '0 7 * * *', sendGreeting), // daily 7:00 AM
    job('jackpot', DRAW_CRON, drawJackpot), // 10:00 AM and 10:00 PM
    job('decay', '5 0 * * *', runDecay), // daily 12:05 AM — inactive members lose credits
    job('boosts', '0 12 1 * *', monthlyBoostPayout), // 1st of the month, 12:00 PM — booster credits
    job('wish', '11 11,23 * * *', maybeMakeAWish), // 🤫 sometimes, at 11:11 AM/PM
  ];
  for (const j of jobs.filter((x) => x.name !== 'wish')) console.log(`[scheduler] ${j.name} next run: ${j.nextRun()?.toString()}`);
  return jobs;
}
