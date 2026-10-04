import type { Client } from 'discord.js';
import type { PresenceStatus, TownGiveResponse, TownPlayerInfo, TownVerdictMode } from '@mikazuki/shared';
import { config } from '../config.js';
import { DAILY_GIVE_LIMIT, INACTIVE_GRACE_DAYS, balance, daysInactive, fencedUntil, give, givenToday, hasVault, rankOf, spend, vaultBalance } from '../credits/store.js';
import { type Mode, drawVerdict } from '../commands/judge.js';
import { ticketsOf } from '../games/jackpot.js';
import { jailedUntil } from '../games/jail.js';
import { kowen } from '../kowens.js';
import { debtOf } from '../loans/loans.js';
import { feed } from './town-feed.js';
import { titleOf } from './titles.js';

// 👤 Another player in town (GET /town/player, POST /town/give): what /balance and /status show about them, and
// giving them Kowens with /give's rules. Players are looked up by their town id (random per visit), so the page
// never learns anyone's Discord id. Giving is public like /give: posted in the games channel (pinging the one who
// got them) and in the town's feed, and the receiver, if in town, gets a pop-up. Diss, praise and judge use the
// /diss, /praise and /judge lines (1 Kowen): the one who sends it says it in town, and it's posted in the town's
// Discord chat channel pinging the target, like the commands. Not from jail.

export interface PlayerDeps {
  nameOf: (id: string) => Promise<string>;
  statusOf: (id: string) => Promise<PresenceStatus>;
  /** Tells the receiver in town. */
  gifted: (userId: string, from: string, amount: number) => void;
  /** The sender says a verdict in town. */
  verdict: (userId: string, kind: 'roast' | 'praise', judged: boolean, text: string) => void;
}

/** Verdicts from one member at most this often (they cost a Kowen, but a burst would flood the chat). */
const VERDICT_COOLDOWN_MS = 5000;
const lastVerdict = new Map<string, number>();
const MODES: Record<TownVerdictMode, Mode> = { diss: 'roast', praise: 'praise', judge: 'random' };

const kowens = (n: number) => `${n.toLocaleString('en-US')} ${kowen(n)}`;

export async function playerInfo(viewer: string, userId: string, deps: PlayerDeps): Promise<TownPlayerInfo> {
  const idle = daysInactive(userId);
  return {
    name: await deps.nameOf(userId),
    title: titleOf(userId),
    status: await deps.statusOf(userId),
    wallet: balance(userId),
    vault: hasVault(userId) ? vaultBalance(userId) : null,
    rank: rankOf(userId),
    bakodUntil: fencedUntil(userId),
    jailedUntil: jailedUntil(userId),
    loan: debtOf(userId)?.owed ?? null,
    jackpotTickets: ticketsOf(userId),
    inactiveDays: idle !== null && idle > INACTIVE_GRACE_DAYS ? idle : null,
    give: { left: Math.max(0, DAILY_GIVE_LIMIT - givenToday(viewer)), limit: DAILY_GIVE_LIMIT, wallet: balance(viewer), inDebt: !!debtOf(viewer) },
  };
}

export async function giveInTown(client: Client, from: string, to: string, amount: number, deps: PlayerDeps): Promise<TownGiveResponse> {
  const done = async (ok: boolean, message: string) => ({ ok, message, player: await playerInfo(from, to, deps) });
  if (to === from) return done(false, "You can't give Kowens to yourself.");
  if (debtOf(from)) return done(false, "You can't give Kowens while you have a loan. Pay it off at the bank first.");
  const result = give(from, to, amount);
  if (!result.ok) {
    const left = DAILY_GIVE_LIMIT - givenToday(from);
    return done(false,
      result.reason === 'balance' ? `You only have ${kowens(balance(from))}.`
      : left > 0 ? `You can only give ${kowens(left)} more today (resets at midnight).`
      : `You've given your ${DAILY_GIVE_LIMIT} Kowens for today. It resets at midnight.`);
  }

  const [giver, receiver] = await Promise.all([deps.nameOf(from), deps.nameOf(to)]);
  deps.gifted(to, giver, amount);
  feed('gift', `${giver} gave ${kowens(amount)} to ${receiver}`, 'gift');
  const left = DAILY_GIVE_LIMIT - givenToday(from);
  const channel = await client.channels.fetch(config.gamesChannelId).catch(() => null);
  if (channel?.isSendable()) {
    await channel
      .send({
        content: `🎁 <@${from}> gave **${amount}** ${kowen(amount)} to <@${to}> in the town! 🪙\n-# ${giver} can give ${left} more today.`,
        allowedMentions: { users: [to] },
      })
      .catch((err) => console.error('[web] give post failed:', err));
  }
  return done(true, `You gave ${kowens(amount)} to ${receiver}.`);
}

/** Diss, praise or judge someone in town: 1 Kowen, said by the sender in town and posted in the town's chat channel. */
export async function verdictInTown(client: Client, from: string, to: string, mode: TownVerdictMode, deps: PlayerDeps): Promise<TownGiveResponse> {
  const done = async (ok: boolean, message: string) => ({ ok, message, player: await playerInfo(from, to, deps) });
  if (to === from) return done(false, 'Pick someone else.');
  if (jailedUntil(from)) return done(false, "You're in jail: no dissing or praising until you're out. Bail at the Tanod outpost.");
  if (Date.now() - (lastVerdict.get(from) ?? 0) < VERDICT_COOLDOWN_MS) return done(false, 'Give it a few seconds.');
  if (!spend(from)) return done(false, "You're out of Kowens. Claim your daily ones with /get-kowens in Discord.");
  lastVerdict.set(from, Date.now());

  const { kind, header, line } = drawVerdict(MODES[mode]);
  const target = await deps.nameOf(to);
  deps.verdict(from, kind, mode === 'judge', line.replaceAll('{u}', target));
  const channel = await client.channels.fetch(config.townChatChannelId ?? config.gamesChannelId).catch(() => null);
  if (channel?.isSendable()) {
    const left = balance(from);
    await channel
      .send({
        content: `${mode === 'judge' ? `🎲 The Tanod has judged <@${to}>...\n${header}\n` : ''}${line.replaceAll('{u}', `<@${to}>`)}\n-# from ${await deps.nameOf(from)} in the town · ${left} ${kowen(left)} left`,
        allowedMentions: { users: [to] },
      })
      .catch((err) => console.error('[web] verdict post failed:', err));
  }
  const word = kind === 'roast' ? 'Roasted' : 'Praised';
  return done(true, mode === 'judge' ? `The Tanod judged: ${word.toLowerCase()}! (1 Kowen)` : `${word} ${target}! (1 Kowen)`);
}
