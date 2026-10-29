import type { Client } from 'discord.js';
import type { PresenceStatus, TownGiveResponse, TownPlayerInfo, TownVerdictMode } from '@mikazuki/shared';
import { config } from '../config.js';
import { INACTIVE_GRACE_DAYS, balance, daysInactive, fencedUntil, hasVault, rankOf, spend, vaultBalance } from '../credits/store.js';
import { type Mode, drawVerdict } from '../commands/judge.js';
import { ticketsOf } from '../games/jackpot.js';
import { jailedUntil } from '../games/jail.js';
import { kowen } from '../kowens.js';
import { debtOf } from '../loans/loans.js';
import { feed } from './town-feed.js';
import { maySee } from './privacy.js';
import { titleOf } from './titles.js';

// 👤 Another player in town (GET /town/player): what /balance and /status show about them. Players are looked up by their town id (random per visit), so the page
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
  // Their Balance (wallet, vault, rank) and Status (Bakod, jail, loan, jackpot tickets, activity) only as their Who can
  // see setting allows (web/privacy.ts maySee); what's hidden comes as nothing (0, null) and says so.
  const balanceOk = maySee(viewer, userId, 'balance');
  const statusOk = maySee(viewer, userId, 'status');
  const hidden = { ...(balanceOk ? {} : { balance: true as const }), ...(statusOk ? {} : { status: true as const }) };
  return {
    name: await deps.nameOf(userId),
    title: titleOf(userId),
    status: await deps.statusOf(userId),
    wallet: balanceOk ? balance(userId) : 0,
    vault: balanceOk && hasVault(userId) ? vaultBalance(userId) : null,
    rank: balanceOk ? rankOf(userId) : null,
    bakodUntil: statusOk ? fencedUntil(userId) : null,
    jailedUntil: statusOk ? jailedUntil(userId) : null,
    loan: statusOk ? (debtOf(userId)?.owed ?? null) : null,
    jackpotTickets: statusOk ? ticketsOf(userId) : 0,
    inactiveDays: statusOk && idle !== null && idle > INACTIVE_GRACE_DAYS ? idle : null,
    ...(balanceOk && statusOk ? {} : { hidden }),
  };
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
