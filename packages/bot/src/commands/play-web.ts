import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { config } from '../config.js';
import { GAME_PATH } from '../web/auth.js';

// 🌙 The way into the web town: a button to Mikazuki town (WEB_PUBLIC_URL/play/), only for the one who asked.
export const playWeb: Command = {
  data: new SlashCommandBuilder().setName('play-web').setDescription('Open Mikazuki town, the web game, in your browser 🌙'),
  async execute(interaction) {
    if (!config.publicUrl) {
      await interaction.reply({ content: "The web town isn't open yet. 🌙", flags: MessageFlags.Ephemeral });
      return;
    }
    const open = new ButtonBuilder().setLabel('Open Mikazuki town').setEmoji('🌙').setStyle(ButtonStyle.Link).setURL(`${config.publicUrl}${GAME_PATH}`);
    await interaction.reply({
      content: '🏘️ **Mikazuki town** is open to everyone in the server! Log in with Discord, pick a nickname and a look, and step in.\n-# Same Kowens and items as here.',
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(open)],
      flags: MessageFlags.Ephemeral,
    });
  },
};
