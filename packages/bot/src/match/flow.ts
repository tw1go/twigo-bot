import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Client,
  MessageFlags,
  PermissionFlagsBits,
  type SendableChannels,
} from 'discord.js';
import { Cron } from 'croner';
import { config } from '../config.js';
import { MATCH_NAME, MATCH_TIME_LABEL, POLL_CLOSE_LABEL, schedule } from './schedule.js';
import { loadToday, save, today } from './state.js';

export const BUTTON_YES = 'match:yes';
export const BUTTON_NO = 'match:no';
const JOIN_ANSWER_ID = 1; // Poll answer IDs are 1-based, in the order given.

async function getChannel(client: Client, id: string): Promise<SendableChannels> {
  const channel = await client.channels.fetch(id);
  if (!channel?.isSendable()) throw new Error(`Channel ${id} not found or not sendable`);
  return channel;
}

/** Sat 12:30 — ask admins whether there's a match tonight. */
export async function askAdmin(client: Client): Promise<void> {
  const channel = await getChannel(client, config.adminChannelId);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(BUTTON_YES).setLabel('Yes, there is a match').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(BUTTON_NO).setLabel('No match tonight').setStyle(ButtonStyle.Secondary),
  );
  const msg = await channel.send({
    content: `<@&${config.adminRoleId}> Is there an **${MATCH_NAME}** match tonight?`,
    components: [row],
    allowedMentions: { roles: [config.adminRoleId] },
  });
  save({ date: today(), status: 'asked', askMessageId: msg.id, participantIds: [] });
}

/** Admin clicked Yes/No on the question. */
export async function handleAnswer(interaction: ButtonInteraction): Promise<void> {
  const isAdmin =
    interaction.inCachedGuild() &&
    (interaction.member.roles.cache.has(config.adminRoleId) ||
      interaction.member.permissions.has(PermissionFlagsBits.Administrator));
  if (!isAdmin) {
    await interaction.reply({ content: 'Only admins can answer this.', flags: MessageFlags.Ephemeral });
    return;
  }

  const state = loadToday();
  if (!state || state.status !== 'asked' || state.askMessageId !== interaction.message.id) {
    await interaction.reply({ content: 'This question is no longer active.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.customId === BUTTON_NO) {
    save({ ...state, status: 'skipped' });
    await interaction.update({ content: `No **${MATCH_NAME}** match tonight — answered by ${interaction.user}.`, components: [] });
    return;
  }

  await interaction.deferUpdate();
  const channel = await getChannel(interaction.client, config.matchChannelId);
  // Discord polls only support whole-hour durations; we end it ourselves at close time.
  const closeAt = new Cron(schedule.closePoll, { timezone: config.timezone }).nextRun()!;
  const hours = Math.max(1, Math.ceil((closeAt.getTime() - Date.now()) / 3_600_000));
  const poll = await channel.send({
    content: `@everyone **${MATCH_NAME}** match tonight at **${MATCH_TIME_LABEL}**! Vote by **${POLL_CLOSE_LABEL}**.`,
    poll: {
      question: { text: `Will you join ${MATCH_NAME} tonight at ${MATCH_TIME_LABEL}?` },
      answers: [
        { text: "Yes, I'm in", emoji: '✅' },
        { text: "Can't make it", emoji: '❌' },
      ],
      duration: hours,
      allowMultiselect: false,
    },
    allowedMentions: { parse: ['everyone'] },
  });
  save({ ...state, status: 'polling', pollMessageId: poll.id });
  await interaction.editReply({
    content: `**${MATCH_NAME}** confirmed by ${interaction.user}. Poll posted in <#${config.matchChannelId}>.`,
    components: [],
  });
}

/** Sat 6:00 PM — end the poll and post the participant list. */
export async function closePoll(client: Client): Promise<void> {
  const state = loadToday();
  if (!state) return;

  if (state.status === 'asked') {
    // Admins never answered — retire the question.
    save({ ...state, status: 'skipped' });
    const adminChannel = await getChannel(client, config.adminChannelId);
    const msg = await adminChannel.messages.fetch(state.askMessageId!);
    await msg.edit({ content: `${msg.content}\n*No answer before ${POLL_CLOSE_LABEL} — skipped.*`, components: [] });
    return;
  }
  if (state.status !== 'polling') return;

  const channel = await getChannel(client, config.matchChannelId);
  const msg = await channel.messages.fetch(state.pollMessageId!);
  if (!msg.poll) throw new Error('Poll message has no poll');
  if (!msg.poll.resultsFinalized) await msg.poll.end().catch(() => {}); // may already have expired

  const answer = msg.poll.answers.get(JOIN_ANSWER_ID);
  const participantIds: string[] = [];
  let after: string | undefined;
  while (answer) {
    const page = await answer.voters.fetch({ after, limit: 100 });
    participantIds.push(...page.keys());
    if (page.size < 100) break;
    after = page.lastKey();
  }

  save({ ...state, status: 'closed', participantIds });

  const body = participantIds.length
    ? participantIds.map((id, i) => `${i + 1}. <@${id}>`).join('\n')
    : '_Nobody signed up._';
  await channel.send({
    content: `**${MATCH_NAME} — participants (${participantIds.length})**\n${body}`,
    allowedMentions: { parse: [] }, // show names without pinging; the ping comes at reminder time
  });
}

/** Pings today's participants with a message, if the match is on. */
async function pingParticipants(client: Client, message: string): Promise<void> {
  const state = loadToday();
  if (state?.status !== 'closed' || state.participantIds.length === 0) return;

  const channel = await getChannel(client, config.matchChannelId);
  const mentions = state.participantIds.map((id) => `<@${id}>`).join(' ');
  await channel.send({
    content: `${mentions}\n${message}`,
    allowedMentions: { users: state.participantIds },
  });
}

/** Sat 7:45 PM — heads-up to participants. */
export async function remindParticipants(client: Client): Promise<void> {
  await pingParticipants(client, `⚔️ **${MATCH_NAME}** starts at **${MATCH_TIME_LABEL}** — 15 minutes to go!`);
}

/** Sat 8:00 PM — match is starting. */
export async function startMatch(client: Client): Promise<void> {
  await pingParticipants(client, `🔥 It's time! Ready up and brawl — **${MATCH_NAME}** is starting now!`);
}
