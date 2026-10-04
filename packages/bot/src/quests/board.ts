import { randomBytes } from 'node:crypto';
import { tableSync } from '../db/sync.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { add, balance, take } from '../credits/store.js';
import { kowen } from '../kowens.js';
import { debtOf } from '../loans/loans.js';

// Quest board: /request posts a task with a Kowens reward held in escrow. Someone accepts (the requester is
// pinged), then the requester marks it complete and the reward goes to them. Cancel refunds; give up reopens it.
export const MAX_REWARD = 100; // caps how much can move per quest (/give is limited to 20/day)
export const MAX_ACTIVE = 3;
const PREFIX = 'quest:';

type Status = 'open' | 'accepted' | 'done' | 'cancelled';
interface Quest {
  id: string;
  requester: string;
  task: string;
  reward: number;
  status: Status;
  acceptedBy?: string;
  channelId: string;
  messageId?: string;
  created: number;
}

// Quests live in the `quests` table; save() writes just the rows that changed (db/sync.ts).
type QuestRow = { id: string; requester: string; task: string; reward: number; status: Status; accepted_by: string | null; channel_id: string; message_id: string | null; created: number };
const table = tableSync<QuestRow>('quests', ['id'], ['requester', 'task', 'reward', 'status', 'accepted_by', 'channel_id', 'message_id', 'created']);
const quests: Record<string, Quest> = Object.fromEntries(
  table.load().map((r): [string, Quest] => [r.id, { id: r.id, requester: r.requester, task: r.task, reward: r.reward, status: r.status,
    ...(r.accepted_by !== null && { acceptedBy: r.accepted_by }), channelId: r.channel_id,
    ...(r.message_id !== null && { messageId: r.message_id }), created: r.created }]),
);
function save(): void {
  table.save(Object.values(quests).map((q) => ({ id: q.id, requester: q.requester, task: q.task, reward: q.reward, status: q.status,
    accepted_by: q.acceptedBy ?? null, channel_id: q.channelId, message_id: q.messageId ?? null, created: q.created })));
}

/** Quests this member posted that are still open or in progress. */
export const activeCount = (userId: string) =>
  Object.values(quests).filter((q) => q.requester === userId && (q.status === 'open' || q.status === 'accepted')).length;

function card(q: Quest) {
  const color = { open: 0x3498db, accepted: 0xf39c12, done: 0x2ecc71, cancelled: 0x7f8c8d }[q.status];
  const status = {
    open: '🟦 **Open** — anyone can accept',
    accepted: `🟧 **In progress** — accepted by <@${q.acceptedBy}>`,
    done: `✅ **Completed** by <@${q.acceptedBy}> — reward paid`,
    cancelled: '⬛ **Cancelled** — reward refunded',
  }[q.status];
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('📜 Quest')
    .setDescription(q.task)
    .addFields(
      { name: 'Reward', value: `🪙 **${q.reward} ${kowen(q.reward)}**`, inline: true },
      { name: 'Requested by', value: `<@${q.requester}>`, inline: true },
      { name: 'Status', value: status },
    )
    .setFooter({ text: 'The reward is held by the Tanod until the quest is completed.' });

  const btn = (action: string, label: string, emoji: string, style: ButtonStyle) =>
    new ButtonBuilder().setCustomId(`${PREFIX}${q.id}:${action}`).setLabel(label).setEmoji(emoji).setStyle(style);
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (q.status === 'open') row.addComponents(btn('accept', 'Accept quest', '⚔️', ButtonStyle.Success), btn('cancel', 'Cancel', '❌', ButtonStyle.Secondary));
  if (q.status === 'accepted')
    row.addComponents(
      btn('complete', 'Complete (pay reward)', '✅', ButtonStyle.Success),
      btn('giveup', 'Give up', '🏳️', ButtonStyle.Secondary),
      btn('cancel', 'Cancel', '❌', ButtonStyle.Danger),
    );
  return { embeds: [embed], components: row.components.length ? [row] : [] };
}

/** Quests this member accepted and is still working on. */
export const acceptedCount = (userId: string) => Object.values(quests).filter((q) => q.acceptedBy === userId && q.status === 'accepted').length;

/** Why a member can't post a quest with this reward right now (null = they can). */
export function cantPost(me: string, reward: number): 'loan' | 'max' | 'kowens' | null {
  if (debtOf(me)) return 'loan';
  if (activeCount(me) >= MAX_ACTIVE) return 'max';
  if (balance(me) < reward) return 'kowens';
  return null;
}

/** Posts a quest (the caller has checked cantPost): takes the reward into escrow. */
export function addQuest(me: string, task: string, reward: number, channelId: string): Quest {
  take(me, reward); // escrow
  const q: Quest = { id: randomBytes(4).toString('hex'), requester: me, task, reward, status: 'open', channelId, created: Date.now() };
  quests[q.id] = q;
  save();
  return q;
}

export async function createQuest(interaction: ChatInputCommandInteraction): Promise<void> {
  const task = interaction.options.getString('task', true).trim();
  const reward = interaction.options.getInteger('reward', true);
  const me = interaction.user.id;
  const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

  const why = cantPost(me, reward);
  if (why === 'loan') return void (await reply("💳 You can't post quests while you have a loan. Pay it off first with `/loan pay`."));
  if (why === 'max') return void (await reply(`You already have **${MAX_ACTIVE}** active quests. Finish or cancel one first. 📜`));
  if (why === 'kowens') return void (await reply(`You need **${reward}** ${kowen(reward)} for that reward, but you have **${balance(me)}**. 🪙`));
  if (!interaction.channel?.isSendable()) return void (await reply("I can't post here. Try another channel."));

  const q = addQuest(me, task, reward, interaction.channelId);
  const res = await interaction.reply({ ...card(q), allowedMentions: { parse: [] }, withResponse: true });
  q.messageId = res.resource?.message?.id;
  save();
}

export type QuestAction = 'accept' | 'giveup' | 'complete' | 'cancel';
export type QuestRefusal = 'closed' | 'taken' | 'own' | 'not-helper' | 'not-requester' | 'not-accepted';

/** Accept, give up, complete or cancel a quest (Discord's buttons and the town's notice board). On success: the
 *  quest, and the reply to post under its card (who to ping), if any. */
export function questAction(id: string, me: string, action: QuestAction):
  { ok: false; reason: QuestRefusal } | { ok: true; quest: Quest; notice?: { content: string; users: string[] } } {
  const q = quests[id];
  if (!q || q.status === 'done' || q.status === 'cancelled') return { ok: false, reason: 'closed' };

  if (action === 'accept') {
    if (q.status !== 'open') return { ok: false, reason: 'taken' };
    if (me === q.requester) return { ok: false, reason: 'own' };
    q.status = 'accepted';
    q.acceptedBy = me;
    save();
    return { ok: true, quest: q, notice: { content: `⚔️ <@${q.requester}>, <@${me}> accepted your quest!`, users: [q.requester] } };
  }

  if (action === 'giveup') {
    if (me !== q.acceptedBy) return { ok: false, reason: 'not-helper' };
    q.status = 'open';
    q.acceptedBy = undefined;
    save();
    return { ok: true, quest: q, notice: { content: `🏳️ <@${q.requester}>, <@${me}> gave up your quest. It's open again.`, users: [q.requester] } };
  }

  if (me !== q.requester) return { ok: false, reason: 'not-requester' };

  if (action === 'complete') {
    if (q.status !== 'accepted' || !q.acceptedBy) return { ok: false, reason: 'not-accepted' };
    q.status = 'done';
    save();
    add(q.acceptedBy, q.reward);
    return { ok: true, quest: q, notice: { content: `✅ <@${q.acceptedBy}>, quest complete! You earned **${q.reward} ${kowen(q.reward)}** 🪙`, users: [q.acceptedBy] } };
  }

  // cancel
  const helper = q.acceptedBy;
  q.status = 'cancelled';
  save();
  add(q.requester, q.reward); // refund
  return { ok: true, quest: q, ...(helper ? { notice: { content: `❌ <@${helper}>, this quest was cancelled by the requester.`, users: [helper] } } : {}) };
}

/** Quests still open or in progress, newest first. */
export const liveQuests = () =>
  Object.values(quests).filter((q) => q.status === 'open' || q.status === 'accepted').sort((a, b) => b.created - a.created);

/** A quest's card for a channel (posting from the town). */
export const questCard = (q: Quest) => ({ ...card(q), allowedMentions: { parse: [] } });

/** Remembers where a quest's card was posted. */
export function setQuestMessage(q: Quest, channelId: string, messageId: string): void {
  q.channelId = channelId;
  q.messageId = messageId;
  save();
}

export type { Quest };

export const isQuestButton = (customId: string) => customId.startsWith(PREFIX);

const REFUSED: Record<QuestRefusal, string> = {
  closed: 'This quest is already closed. 📜',
  taken: 'Someone already accepted this quest. ⚔️',
  own: "You can't accept your own quest. 😅",
  'not-helper': 'Only the person who accepted can give up. 🏳️',
  'not-requester': 'Only the person who posted the quest can do that. 📜',
  'not-accepted': 'Nobody has accepted this quest yet.',
};

export async function handleQuestButton(interaction: ButtonInteraction): Promise<void> {
  const [id, action] = interaction.customId.slice(PREFIX.length).split(':');
  const result = questAction(id, interaction.user.id, action as QuestAction);
  if (!result.ok) return void (await interaction.reply({ content: REFUSED[result.reason], flags: MessageFlags.Ephemeral }));
  await interaction.update({ ...card(result.quest), allowedMentions: { parse: [] } });
  const n = result.notice;
  if (n) await interaction.message.reply({ content: n.content, allowedMentions: { users: n.users } }).catch(() => {});
}
