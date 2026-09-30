import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import {
  INACTIVE_GRACE_DAYS,
  VOICE_DAILY_CAP,
  VOICE_MINUTES_PER_CREDIT,
  balance,
  claimedToday,
  daysInactive,
  fencedUntil,
  rankOf,
  voiceCreditsToday,
  voiceProgress,
} from '../credits/store.js';
import { jailedUntil } from '../games/jail.js';
import { ticketsOf } from '../games/jackpot.js';
import { rewards } from '../games/rewards.js';

const fmt = (n: number) => n.toLocaleString('en-US');
const ts = (ms: number) => `<t:${Math.floor(ms / 1000)}:f>`;

export const balanceCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your credits (or someone else\'s) 🪙')
    .addUserOption((o) => o.setName('user').setDescription('Whose balance to check (default: you)')),
  async execute(interaction) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    const id = target.id;
    const have = balance(id);
    const rank = rankOf(id);

    const nextPass = rewards.filter((r) => r.kind === 'pass').find((r) => r.cost > have);
    const status: string[] = [];
    const fence = fencedUntil(id);
    if (fence) status.push(`🧱 Bakod up until ${ts(fence)}`);
    const jail = jailedUntil(id);
    if (jail) status.push(`🚔 In jail until ${ts(jail)}`);
    const tickets = ticketsOf(id);
    if (tickets) status.push(`🎟️ ${tickets} jackpot ticket(s) for tonight`);
    const idle = daysInactive(id);
    if (idle !== null && idle > INACTIVE_GRACE_DAYS) status.push(`⚠️ Inactive ${idle} days — losing credits daily!`);

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setAuthor({ name: `${target.displayName}'s balance`, iconURL: target.displayAvatarURL() })
      .setDescription(`## 🪙 ${fmt(have)} credit${have === 1 ? '' : 's'}${rank ? `\n-# #${rank} on the leaderboard` : ''}`)
      .addFields(
        {
          name: 'Today',
          value: [
            `📅 Daily claim: ${claimedToday(id) ? '✅ claimed' : '❌ not yet — `/get-credits`'}`,
            `🎙️ Voice: **${voiceCreditsToday(id)}/${VOICE_DAILY_CAP}** credits · ${voiceProgress(id)}/${VOICE_MINUTES_PER_CREDIT} min to the next`,
          ].join('\n'),
        },
        {
          name: 'Next reward',
          value: nextPass
            ? `${nextPass.emoji} **${nextPass.name}** — ${fmt(nextPass.cost - have)} more to go (${Math.floor((have / nextPass.cost) * 100)}%)`
            : '👑 You can afford every pass! `/redeem`',
        },
      );
    if (status.length) embed.addFields({ name: 'Status', value: status.join('\n') });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
