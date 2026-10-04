import { createHash, randomBytes } from 'node:crypto';
import type { Client } from 'discord.js';
import type { TownBailResponse, TownOutpostResponse } from '@mikazuki/shared';
import { config } from '../config.js';
import { balance } from '../credits/store.js';
import { BAIL_PERCENT, MAX_BAIL, MIN_BAIL, bailFor, canBail, jailList, payBail } from '../games/jail.js';
import { ACTIVE_FROM_HOUR, ACTIVE_UNTIL_HOUR, MAX_GAP_MS, MIN_GAP_MS, REWARDS, SLOWPOKE_JAIL_MINUTES, WINDOW_MS, activePatrol } from '../games/patrol.js';
import { kowen } from '../kowens.js';
import { feed } from './town-feed.js';

// 🚔 The Tanod outpost (GET /town/outpost, POST /town/bail): who's in jail, bailing yourself or a friend out with
// /bail's rules (posted in the games channel like /bail), and how Tanod Patrol works. People in jail are given an id
// made from their Discord id and a secret picked at startup, so the page can name who to bail without learning it.

const SECRET = randomBytes(16);
const jailId = (userId: string) => createHash('sha256').update(SECRET).update(userId).digest('hex').slice(0, 16);
const kowens = (n: number) => `${n.toLocaleString('en-US')} ${kowen(n)}`;

export async function townOutpost(viewer: string, nameOf: (id: string) => Promise<string>): Promise<TownOutpostResponse> {
  const jailed = await Promise.all(
    jailList()
      .sort(([, a], [, b]) => a.until - b.until)
      .map(async ([id, e]) => ({
        id: jailId(id),
        name: await nameOf(id),
        until: e.until,
        reason: e.reason,
        bail: canBail(id) ? bailFor(id) : null,
        ...(id === viewer ? { me: true } : {}),
      })),
  );
  return {
    jailed,
    wallet: balance(viewer),
    bail: { percent: BAIL_PERCENT, min: MIN_BAIL, max: MAX_BAIL },
    patrol: {
      active: !!activePatrol(),
      rewards: REWARDS,
      windowSeconds: WINDOW_MS / 1000,
      slowpokeMinutes: SLOWPOKE_JAIL_MINUTES,
      fromHour: ACTIVE_FROM_HOUR,
      untilHour: ACTIVE_UNTIL_HOUR,
      minGapHours: MIN_GAP_MS / 3_600_000,
      maxGapHours: MAX_GAP_MS / 3_600_000,
    },
  };
}

/** Bails out the member behind a jail id (the payer's own or a friend's). */
export async function bailFromTown(client: Client, payer: string, id: string, nameOf: (id: string) => Promise<string>): Promise<TownBailResponse> {
  const done = async (ok: boolean, message: string) => ({ ...(await townOutpost(payer, nameOf)), ok, message });
  const target = jailList().find(([uid]) => jailId(uid) === id)?.[0];
  if (!target) return done(false, "They're already out.");
  const self = target === payer;
  const result = await payBail(payer, target);
  if (!result.ok) {
    return done(false,
      result.reason === 'free' ? "They're already out."
      : result.reason === 'no-bail' ? 'That sentence came from the Tanod (admins): no bail, it has to be served in full.'
      : `Bail is ${kowens(result.cost)}, but you have ${kowens(balance(payer))}.`);
  }
  const [who, them] = await Promise.all([nameOf(payer), nameOf(target)]);
  const cost = result.cost;
  feed('jail', self ? `${who} paid ${kowens(cost)} bail and walked out of jail` : `${who} paid ${kowens(cost)} to bail out ${them}`, 'bail');
  const channel = await client.channels.fetch(config.gamesChannelId).catch(() => null);
  if (channel?.isSendable()) {
    await channel
      .send({
        content: self
          ? `💸🔓 <@${payer}> paid **${cost}** ${kowen(cost)} bail and walked out of jail in the town. Freedom! 🕊️`
          : `💸🔓 <@${payer}> paid **${cost}** ${kowen(cost)} to bail out <@${target}> in the town! What a friend 🫂`,
        allowedMentions: { users: self ? [] : [target] },
      })
      .catch((err) => console.error('[web] bail post failed:', err));
  }
  return done(true, self ? `You paid ${kowens(cost)} bail. Freedom!` : `You bailed out ${them} for ${kowens(cost)}.`);
}
