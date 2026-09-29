import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';

export const ping: Command = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Check bot latency'),
  async execute(interaction) {
    const sent = await interaction.reply({ content: 'Pinging…', withResponse: true });
    const roundtrip = sent.resource!.message!.createdTimestamp - interaction.createdTimestamp;
    await interaction.editReply(`Pong! Roundtrip ${roundtrip}ms · WS ${interaction.client.ws.ping}ms`);
  },
};
