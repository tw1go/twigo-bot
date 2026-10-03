import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { LAUNCH_REWARD, preregister, preregReply } from '../prereg/prereg.js';

export const preregisterCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('preregister')
    .setDescription(`Pre-register for the Mikazuki web game: +${LAUNCH_REWARD} Kowens when it launches 🎮`),
  async execute(interaction) {
    await interaction.reply({ content: preregReply(preregister(interaction.user.id, 'discord')), flags: MessageFlags.Ephemeral });
  },
};
