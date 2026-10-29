import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import {
  INACTIVE_GRACE_DAYS,
  VOICE_DAILY_CAP,
  VOICE_MINUTES_PER_CREDIT,
  balance,
  hasVault,
  vaultBalance,
  claimedToday,
  daysInactive,
  fencedUntil,
  rankOf,
  voiceCreditsToday,
  voiceProgress,
} from '../credits/store.js';
import { jailedUntil } from '../games/jail.js';
import { ticketsOf } from '../games/jackpot.js';
import { kowen } from '../kowens.js';
import { hiddenLine } from '../web/privacy.js';

const fmt = (n: number) => n.toLocaleString('en-US');
const ts = (ms: number) => `<t:${Math.floor(ms / 1000)}:f>`;

export const balanceCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your Kowens (or someone else\'s) 🪙 · 🔒 Only you see')
    .addUserOption((o) => o.setName('user').setDescription('Whose balance to check (default: you)')),
  async execute(interaction) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    const id = target.id;
    // Someone else's: only as their Who can see setting allows (web game Settings → Privacy).
    const hidden = hiddenLine(interaction.user.id, id, target.displayName, 'balance');
    if (hidden) return void (await interaction.reply({ content: hidden, flags: MessageFlags.Ephemeral }));
    const have = balance(id);
    const rank = rankOf(id);

    const status: string[] = [];
    const fence = fencedUntil(id);
    if (fence) status.push(`🧱 Bakod up until ${ts(fence)}`);
    const jail = jailedUntil(id);
    if (jail) status.push(`🚔 In jail until ${ts(jail)}`);
    const tickets = ticketsOf(id);
    if (tickets) status.push(`🎟️ ${tickets} jackpot ticket(s) for the next draw`);
    const idle = daysInactive(id);
    if (idle !== null && idle > INACTIVE_GRACE_DAYS) status.push(`⚠️ Inactive ${idle} days — losing Kowens daily!`);

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setAuthor({ name: `${target.displayName}'s balance`, iconURL: target.displayAvatarURL() })
      .setDescription(
        `## 🪙 ${fmt(have)} ${kowen(have)}` +
          (hasVault(id) ? `\n🔐 Vault: **${fmt(vaultBalance(id))}** · total **${fmt(have + vaultBalance(id))}**` : '') +
          (rank ? `\n-# #${rank} on the leaderboard` : ''),
      )
      .addFields(
        {
          name: 'Today',
          value: [
            `📅 Daily claim: ${claimedToday(id) ? '✅ claimed' : '❌ not yet — `/get-credits`'}`,
            `🎙️ Voice: **${voiceCreditsToday(id)}/${VOICE_DAILY_CAP}** ${kowen(VOICE_DAILY_CAP)} (${VOICE_DAILY_CAP - voiceCreditsToday(id)} left today) · ${voiceProgress(id)}/${VOICE_MINUTES_PER_CREDIT} min to the next`,
          ].join('\n'),
        },
      );
    if (status.length) embed.addFields({ name: 'Status', value: status.join('\n') });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
