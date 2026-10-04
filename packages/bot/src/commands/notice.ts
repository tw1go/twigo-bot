import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { config } from '../config.js';
import { announce } from '../web/town-feed.js';

// 📣 A banner for everyone in the web town (maintenance and such), also shown to people arriving in the next 30
// minutes. Only the gifter (REWARD_OWNER_ID) can use it; hidden from non-admins by default.
export const notice: Command = {
  data: new SlashCommandBuilder()
    .setName('notice')
    .setDescription('Gifter only: a banner for everyone in the web town (e.g. maintenance) 📣')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) => o.setName('message').setDescription('What it says').setRequired(true).setMaxLength(200))
    .addStringOption((o) => o.setName('title').setDescription('The heading (default: Notice)').setMaxLength(40)),
  async execute(interaction) {
    if (interaction.user.id !== config.rewardOwnerId) {
      await interaction.reply({ content: 'Only the gifter can use this. 📣', flags: MessageFlags.Ephemeral });
      return;
    }
    const text = interaction.options.getString('message', true);
    const title = interaction.options.getString('title') ?? 'Notice';
    announce({ kind: 'notice', title, text });
    console.log(`[notice] ${title}: ${text}`);
    await interaction.reply({
      content: `📣 Shown in the web town: **${title}**: ${text}\n-# People arriving in the next 30 minutes see it too.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
};
