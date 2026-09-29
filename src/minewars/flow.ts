import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type Client,
} from 'discord.js';
import { config } from '../config.js';
import { MINE_WARS_NAME } from './schedule.js';

export const BUTTON_TOGGLE_ROLE = 'minewars:toggle-role';
const OPT_IN_QUESTION = `🔔 Want to get pinged when **${MINE_WARS_NAME}** is about to start? Click the button below. Click again to stop.`;

const toggleRow = () =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(BUTTON_TOGGLE_ROLE)
      .setLabel(`Get / stop ${MINE_WARS_NAME} pings`)
      .setEmoji('🔔')
      .setStyle(ButtonStyle.Primary),
  );

async function send(client: Client, content: string, pingRole: boolean): Promise<void> {
  const channel = await client.channels.fetch(config.mineWarsChannelId);
  if (!channel?.isSendable()) throw new Error(`Channel ${config.mineWarsChannelId} not found or not sendable`);
  await channel.send({
    content: pingRole ? `<@&${config.mineWarsRoleId}> ${content}` : content,
    components: [toggleRow()],
    allowedMentions: { roles: pingRole ? [config.mineWarsRoleId] : [] },
  });
}

export async function warnMineWars(client: Client): Promise<void> {
  await send(client, `⛏️ **${MINE_WARS_NAME}** starting in **5 minutes**!\n\n${OPT_IN_QUESTION}`, true);
}

export async function startMineWars(client: Client): Promise<void> {
  await send(client, `⛏️ **${MINE_WARS_NAME}** is ongoing now!\n\n${OPT_IN_QUESTION}`, true);
}

/** Standalone opt-in message (e.g. to pin in the channel). */
export async function postRolePanel(client: Client): Promise<void> {
  await send(client, OPT_IN_QUESTION, false);
}

/** Member clicked the pings button — add or remove the role. */
export async function handleToggleRole(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) return;
  const { member } = interaction;
  if (member.roles.cache.has(config.mineWarsRoleId)) {
    await member.roles.remove(config.mineWarsRoleId, 'Opted out of Mine Wars pings');
    await interaction.reply({ content: `🔕 You won't be pinged for ${MINE_WARS_NAME} anymore.`, flags: MessageFlags.Ephemeral });
  } else {
    await member.roles.add(config.mineWarsRoleId, 'Opted in to Mine Wars pings');
    await interaction.reply({ content: `🔔 You'll be pinged before every ${MINE_WARS_NAME}.`, flags: MessageFlags.Ephemeral });
  }
}
