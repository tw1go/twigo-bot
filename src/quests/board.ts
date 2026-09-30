import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

const DIR = 'data';
const FILE = `${DIR}/quests.json`;
const quests: Record<string, Quest> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
function save(): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(quests, null, 2));
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

export async function createQuest(interaction: ChatInputCommandInteraction): Promise<void> {
  const task = interaction.options.getString('task', true).trim();
  const reward = interaction.options.getInteger('reward', true);
  const me = interaction.user.id;
  const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

  if (activeCount(me) >= MAX_ACTIVE) return void (await reply(`You already have **${MAX_ACTIVE}** active quests. Finish or cancel one first. 📜`));
  if (balance(me) < reward) return void (await reply(`You need **${reward}** ${kowen(reward)} for that reward, but you have **${balance(me)}**. 🪙`));
  if (!interaction.channel?.isSendable()) return void (await reply("I can't post here. Try another channel."));

  take(me, reward); // escrow
  const q: Quest = { id: randomBytes(4).toString('hex'), requester: me, task, reward, status: 'open', channelId: interaction.channelId, created: Date.now() };
  quests[q.id] = q;
  save();
  const res = await interaction.reply({ ...card(q), allowedMentions: { parse: [] }, withResponse: true });
  q.messageId = res.resource?.message?.id;
  save();
}

export const isQuestButton = (customId: string) => customId.startsWith(PREFIX);

export async function handleQuestButton(interaction: ButtonInteraction): Promise<void> {
  const [id, action] = interaction.customId.slice(PREFIX.length).split(':');
  const q = quests[id];
  const me = interaction.user.id;
  const deny = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
  if (!q || q.status === 'done' || q.status === 'cancelled') return void (await deny('This quest is already closed. 📜'));

  if (action === 'accept') {
    if (q.status !== 'open') return void (await deny('Someone already accepted this quest. ⚔️'));
    if (me === q.requester) return void (await deny("You can't accept your own quest. 😅"));
    q.status = 'accepted';
    q.acceptedBy = me;
    save();
    await interaction.update({ ...card(q), allowedMentions: { parse: [] } });
    await interaction.message
      .reply({ content: `⚔️ <@${q.requester}>, ${interaction.user} accepted your quest!`, allowedMentions: { users: [q.requester] } })
      .catch(() => {});
    return;
  }

  if (action === 'giveup') {
    if (me !== q.acceptedBy) return void (await deny('Only the person who accepted can give up. 🏳️'));
    q.status = 'open';
    q.acceptedBy = undefined;
    save();
    await interaction.update({ ...card(q), allowedMentions: { parse: [] } });
    await interaction.message
      .reply({ content: `🏳️ <@${q.requester}>, ${interaction.user} gave up your quest. It's open again.`, allowedMentions: { users: [q.requester] } })
      .catch(() => {});
    return;
  }

  if (me !== q.requester) return void (await deny('Only the person who posted the quest can do that. 📜'));

  if (action === 'complete') {
    if (q.status !== 'accepted' || !q.acceptedBy) return void (await deny('Nobody has accepted this quest yet.'));
    q.status = 'done';
    save();
    add(q.acceptedBy, q.reward);
    await interaction.update({ ...card(q), allowedMentions: { parse: [] } });
    await interaction.message
      .reply({ content: `✅ <@${q.acceptedBy}>, quest complete! You earned **${q.reward} ${kowen(q.reward)}** 🪙`, allowedMentions: { users: [q.acceptedBy] } })
      .catch(() => {});
    return;
  }

  if (action === 'cancel') {
    const helper = q.acceptedBy;
    q.status = 'cancelled';
    save();
    add(q.requester, q.reward); // refund
    await interaction.update({ ...card(q), allowedMentions: { parse: [] } });
    if (helper) {
      await interaction.message
        .reply({ content: `❌ <@${helper}>, this quest was cancelled by the requester.`, allowedMentions: { users: [helper] } })
        .catch(() => {});
    }
  }
}
