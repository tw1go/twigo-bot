import type { Client } from 'discord.js';
import type { TownCoinSide, TownGambleResponse } from '@mikazuki/shared';
import { config } from '../config.js';
import { balance } from '../credits/store.js';
import { BUST_CHANCE_IN_CHANNEL, BUST_JAIL_MINUTES, SIXTY_SEVEN_BONUS, WIN_CHANCE, gambleFor } from '../games/gamble.js';
import { kowen } from '../kowens.js';
import { feed } from './town-feed.js';

// 🎰 The Casino's Kara y Krus (POST /town/gamble): /gamble's coin flip with the gambling channel's low bust chance
// (games/gamble.ts). The call is for show: a win lands on it, a loss on the other side, and a bust never lands (the
// Tanod takes the coin). Each bet is posted in the gambling channel like /gamble's and goes to the town's feed, which
// plays the effects over the gambler (coins for a big win, a siren for a bust).

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { timeZone: config.timezone, hour: 'numeric', minute: '2-digit' });
const other = (s: TownCoinSide): TownCoinSide => (s === 'kara' ? 'krus' : 'kara');
const side = (s: TownCoinSide) => (s === 'kara' ? 'Kara' : 'Krus');

export async function gambleInTown(client: Client, userId: string, name: string, bet: number, call: TownCoinSide): Promise<TownGambleResponse> {
  const odds = { winChance: WIN_CHANCE, bustChance: BUST_CHANCE_IN_CHANNEL };
  const result = await gambleFor(userId, bet, 'safe');
  if (!result.ok) {
    const message =
      result.reason === 'jailed' ? `You're in jail until ${clock(result.until)}. No gambling till you're out.`
      : result.reason === 'cooldown' ? `Easy there! Try again in ${Math.ceil(result.waitMs / 1000)}s.`
      : `You only have ${result.have} ${kowen(result.have)}.`;
    return { ok: false, message, kowens: balance(userId), ...odds };
  }

  const k = (n: number) => `${n} ${kowen(n)}`;
  let message: string;
  let post: string;
  let landed: TownCoinSide | undefined;
  if (result.outcome === 'bust') {
    message = `The Tanod raided the table: ${k(bet)} confiscated${result.toPot ? ` (${result.toPot} into the jackpot pot)` : ''} and ${BUST_JAIL_MINUTES} minutes in jail.`;
    post = `🚨 **BUSTED!** The Tanod raided the town's Casino and caught <@${userId}> gambling! **${bet}** ${kowen(bet)} confiscated and **${BUST_JAIL_MINUTES} minutes** in jail. 🚔${result.toPot ? `\n-# 🎰 **${result.toPot}** ${kowen(result.toPot)} of it went into the jackpot pot.` : ''}`;
    feed('gamble', `The Tanod caught ${name} gambling ${k(bet)}: off to jail`, 'bust', { userId, amount: bet });
  } else if (result.outcome === 'win') {
    landed = call;
    message = `${side(call)}! You won ${k(bet)}${result.bonus ? `, and ${SIXTY_SEVEN_BONUS} more for the 67` : ''}.`;
    post = `🪙 <@${userId}> called **${side(call)}** at the town's Casino and **WON**! +${bet} ${kowen(bet)} 🤑${result.bonus ? `\n6️⃣7️⃣!! **+${SIXTY_SEVEN_BONUS}** bonus 🫲🫱` : ''}`;
    feed('gamble', `${name} won ${k(bet)} gambling`, 'win', { userId, amount: bet });
  } else {
    landed = other(call);
    message = `${side(landed)}. You lost ${k(bet)}.`;
    post = `🪙 <@${userId}> called **${side(call)}** at the town's Casino, it landed **${side(landed)}**, and they **lost** ${bet} ${kowen(bet)}. 💸`;
    feed('gamble', `${name} lost ${k(bet)} gambling`, 'lose', { userId, amount: bet });
  }
  const channel = await client.channels.fetch(config.gamblingChannelId).catch(() => null);
  if (channel?.isSendable()) {
    await channel
      .send({ content: `${post}\n-# Balance: ${result.balance} ${kowen(result.balance)}`, allowedMentions: { parse: [] } })
      .catch((err) => console.error('[web] gamble post failed:', err));
  }
  return { ok: true, message, outcome: result.outcome, landed, bet, kowens: result.balance, ...odds };
}
