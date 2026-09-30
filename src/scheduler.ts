import type { Client } from 'discord.js';
import { Cron } from 'croner';
import { config } from './config.js';
import { schedule as abf } from './match/schedule.js';
import { askAdmin, closePoll, remindParticipants, startMatch } from './match/flow.js';
import { schedule as mineWars } from './minewars/schedule.js';
import { startMineWars, warnMineWars } from './minewars/flow.js';
import { sendGreeting } from './greetings/flow.js';
import { drawJackpot } from './games/jackpot.js';
import { runDecay } from './credits/decay.js';

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
    job('jackpot', '0 22 * * *', drawJackpot), // daily 10:00 PM
    job('decay', '5 0 * * *', runDecay), // daily 12:05 AM — inactive members lose credits
  ];
  for (const j of jobs) console.log(`[scheduler] ${j.name} next run: ${j.nextRun()?.toString()}`);
  return jobs;
}
