import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { topBalances, topVoice } from '../credits/store.js';

const medal = (i: number) => ['🥇', '🥈', '🥉'][i] ?? `**${i + 1}.**`;
const hours = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`);

export const leaderboard: Command = {
  data: new SlashCommandBuilder().setName('leaderboard').setDescription('Richest members and top voice chatters 🏆'),
  async execute(interaction) {
    const rich = topBalances(10);
    const voice = topVoice(10);
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('🏆 Leaderboard')
      .addFields(
        {
          name: '💰 Richest',
          value: rich.map(([id, n], i) => `${medal(i)} <@${id}> — ${n} Kowens`).join('\n') || '_Nobody has Kowens yet._',
          inline: true,
        },
        {
          name: '🎙️ Voice chat',
          value: voice.map(([id, m], i) => `${medal(i)} <@${id}> — ${hours(m)}`).join('\n') || '_No voice time yet._',
          inline: true,
        },
      )
      .setFooter({ text: 'Voice time counts since voice rewards were added.' });
    await interaction.reply({ embeds: [embed] }); // mentions in embeds never ping
  },
};
