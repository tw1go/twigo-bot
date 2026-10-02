import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';

// /twigo announce:#channel [announce-ping:True] → modal for the message → posted as the bot.
const MODAL_PREFIX = 'announce:';
const MESSAGE_FIELD = 'message';

export const isAnnounceModal = (customId: string) => customId.startsWith(MODAL_PREFIX);

export async function openAnnounceModal(
  interaction: ChatInputCommandInteraction,
  channelId: string,
  pingEveryone: boolean,
): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}${channelId}:${pingEveryone ? 1 : 0}`)
    .setTitle(pingEveryone ? 'Announcement (pings @everyone)' : 'Announcement')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(MESSAGE_FIELD)
          .setLabel('Message (Discord formatting works)')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(pingEveryone ? 1985 : 2000) // leave room for "@everyone\n"
          .setRequired(true),
      ),
    );
  await interaction.showModal(modal);
}

export async function handleAnnounceModal(interaction: ModalSubmitInteraction): Promise<void> {
  const [channelId, ping] = interaction.customId.slice(MODAL_PREFIX.length).split(':');
  const pingEveryone = ping === '1';
  const text = interaction.fields.getTextInputValue(MESSAGE_FIELD);

  // The modal is only reachable via admin-only /twigo, but re-check in case permissions changed.
  if (!interaction.inCachedGuild() || !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: 'Only admins can post announcements.', flags: MessageFlags.Ephemeral });
    return;
  }

  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) {
    await interaction.reply({ content: `I can't post in <#${channelId}>. Check my permissions there.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const msg = await channel.send({
    content: pingEveryone ? `@everyone\n${text}` : text,
    allowedMentions: { parse: pingEveryone ? ['everyone'] : [] },
  });
  await interaction.reply({ content: `📢 Posted in <#${channelId}>: ${msg.url}`, flags: MessageFlags.Ephemeral });
}
