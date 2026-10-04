import type { Client } from 'discord.js';
import type { TownBoardAction, TownBoardActionResponse, TownBoardResponse } from '@mikazuki/shared';
import { config } from '../config.js';
import { balance } from '../credits/store.js';
import { kowen } from '../kowens.js';
import { debtOf } from '../loans/loans.js';
import { MAX_ACTIVE, MAX_REWARD, type Quest, type QuestRefusal, activeCount, addQuest, cantPost, liveQuests, questAction, questCard, setQuestMessage } from '../quests/board.js';
import { feed } from './town-feed.js';
import { filterText } from './town-mod.js';

// 📜 The town's notice board (GET/POST /town/board): /request's quests, with the same rules (quests/board.ts). A quest
// posted in town gets its card in the games channel like /request's; accepting, giving up, completing or cancelling
// in town updates that card and posts the same reply under it (pinging who it's for), and the town's feed hears of it.

type NameOf = (id: string) => Promise<string>;

/** As /request's task option. */
const MAX_TASK = 300;
const kowens = (n: number) => `${n.toLocaleString('en-US')} ${kowen(n)}`;

/** A task as the town shows it: Discord's mention codes (from /request) turned into names — @Name for people (town
 *  nickname or Discord name), and plain @role, #channel and :emoji: for the rest — so ids never reach the page. */
async function readable(task: string, nameOf: NameOf): Promise<string> {
  const ids = [...new Set([...task.matchAll(/<@!?(\d+)>/g)].map((m) => m[1]))];
  const names = new Map(await Promise.all(ids.map(async (id) => [id, await nameOf(id)] as const)));
  return task
    .replace(/<@!?(\d+)>/g, (_, id: string) => `@${names.get(id) ?? 'someone'}`)
    .replace(/<@&\d+>/g, '@role')
    .replace(/<#\d+>/g, '#channel')
    .replace(/<a?:(\w+):\d+>/g, ':$1:');
}

export async function townBoard(viewer: string, nameOf: NameOf): Promise<TownBoardResponse> {
  return {
    quests: await Promise.all(
      liveQuests().map(async (q) => ({
        id: q.id,
        task: await readable(q.task, nameOf),
        reward: q.reward,
        status: q.status as 'open' | 'accepted',
        by: await nameOf(q.requester),
        helper: q.acceptedBy ? await nameOf(q.acceptedBy) : null,
        ...(q.requester === viewer ? { mine: true } : {}),
        ...(q.acceptedBy === viewer ? { helping: true } : {}),
        created: q.created,
      })),
    ),
    maxReward: MAX_REWARD,
    maxActive: MAX_ACTIVE,
    myActive: activeCount(viewer),
    wallet: balance(viewer),
    inDebt: !!debtOf(viewer),
  };
}

const REFUSED: Record<QuestRefusal, string> = {
  closed: 'This quest is already closed.',
  taken: 'Someone already accepted this quest.',
  own: "You can't accept your own quest.",
  'not-helper': 'Only the person who accepted it can give up.',
  'not-requester': 'Only the person who posted the quest can do that.',
  'not-accepted': 'Nobody has accepted this quest yet.',
};

/** Edits a quest's card in Discord and posts the reply under it (pinging who it's for). */
async function updateCard(client: Client, q: Quest, notice?: { content: string; users: string[] }): Promise<void> {
  if (!q.messageId) return;
  const channel = await client.channels.fetch(q.channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(q.messageId).catch(() => null);
  if (!message) return;
  await message.edit(questCard(q)).catch((err) => console.error('[web] quest card edit failed:', err));
  if (notice) await message.reply({ content: notice.content, allowedMentions: { users: notice.users } }).catch(() => {});
}

export async function boardAction(
  client: Client,
  userId: string,
  body: { action: TownBoardAction; id?: string; task?: string; reward?: number },
  nameOf: NameOf,
): Promise<TownBoardActionResponse> {
  const done = async (ok: boolean, message: string) => ({ ...(await townBoard(userId, nameOf)), ok, message });

  if (body.action === 'post') {
    const task = filterText((body.task ?? '').replace(/\s+/g, ' ').trim());
    const reward = body.reward ?? 0;
    if (!task) return done(false, 'Write what you need done.');
    if (task.length > MAX_TASK) return done(false, `Keep it under ${MAX_TASK} characters.`);
    if (!Number.isInteger(reward) || reward < 1 || reward > MAX_REWARD) return done(false, `The reward is 1–${MAX_REWARD} Kowens.`);
    const why = cantPost(userId, reward);
    if (why) {
      return done(false,
        why === 'loan' ? "You can't post quests while you have a loan. Pay it off at the bank first."
        : why === 'max' ? `You already have ${MAX_ACTIVE} quests up. Finish or cancel one first.`
        : `You need ${kowens(reward)} for that reward, but you have ${kowens(balance(userId))}.`);
    }
    const channel = await client.channels.fetch(config.gamesChannelId).catch(() => null);
    if (!channel?.isSendable()) return done(false, "The board can't post to Discord right now. Try again later.");
    const q = addQuest(userId, task, reward, channel.id);
    const message = await channel.send(questCard(q)).catch((err) => (console.error('[web] quest post failed:', err), null));
    if (message) setQuestMessage(q, channel.id, message.id);
    feed('quest', `${await nameOf(userId)} posted a quest for ${kowens(reward)}`, 'quest');
    return done(true, `Posted! ${kowens(reward)} is held until it's done.`);
  }

  if (!body.id) return done(false, 'Pick a quest.');
  const result = questAction(body.id, userId, body.action);
  if (!result.ok) return done(false, REFUSED[result.reason]);
  const q = result.quest;
  await updateCard(client, q, result.notice);
  const [me, by] = await Promise.all([nameOf(userId), nameOf(q.requester)]);
  const helper = q.acceptedBy ? await nameOf(q.acceptedBy) : null;
  switch (body.action) {
    case 'accept':
      feed('quest', `${me} took on ${by}'s quest`, 'quest');
      return done(true, `You took it on. Tell ${by} when it's done; they pay you ${kowens(q.reward)}.`);
    case 'giveup':
      return done(true, "You gave it up. It's open again.");
    case 'complete':
      feed('quest', `${by} paid ${helper} ${kowens(q.reward)} for a quest`, 'quest-done');
      return done(true, `Done! ${helper} got ${kowens(q.reward)}.`);
    default:
      return done(true, `Cancelled. Your ${kowens(q.reward)} came back.`);
  }
}
