import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { topBalances, topVoice, topVoiceWeek } from '../credits/store.js';
import { weekStart } from '../time.js';
import { WEEKLY_VC_REWARDS, WEEKLY_VC_START } from '../games/voice-weekly.js';
import { kowen } from '../kowens.js';

const medal = (i: number) => ['🥇', '🥈', '🥉'][i] ?? `**${i + 1}.**`;
const hours = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`);

export const leaderboard: Command = {
  data: new SlashCommandBuilder().setName('leaderboard').setDescription('Richest members and top voice chatters 🏆 · 🌐 Everyone sees'),
  async execute(interaction) {
    const rich = topBalances(10);
    const voice = topVoice(10);
    const week = topVoiceWeek(weekStart(), 10);
    const started = weekStart() >= WEEKLY_VC_START;
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('🏆 Leaderboard')
      .addFields(
        {
          name: '💰 Richest',
          value: rich.map(([id, n], i) => `${medal(i)} <@${id}> — ${n} ${kowen(n)}`).join('\n') || '_Nobody has Kowens yet._',
          inline: true,
        },
        {
          name: '🎙️ Voice (all time)',
          value: voice.map(([id, m], i) => `${medal(i)} <@${id}> — ${hours(m)}`).join('\n') || '_No voice time yet._',
          inline: true,
        },
        {
          name: '🎙️ This week',
          value: started
            ? week.map(([id, m], i) => `${medal(i)} <@${id}> — ${hours(m)} · +${WEEKLY_VC_REWARDS[i]}`).join('\n') || '_Nobody in voice yet this week._'
            : `_Weekly rewards start ${WEEKLY_VC_START}._`,
        },
      )
      .setFooter({ text: 'Weekly voice rewards: 50 · 30 · 20 · 10 (4th–10th), paid Mondays 12 PM.' });
    await interaction.reply({ embeds: [embed] }); // mentions in embeds never ping
  },
};
