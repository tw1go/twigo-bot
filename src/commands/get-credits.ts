import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { DAILY_CREDITS, balance, claim } from '../credits/store.js';

export const getCredits: Command = {
  data: new SlashCommandBuilder()
    .setName('get-credits')
    .setDescription(`Claim your ${DAILY_CREDITS} daily credits for /diss, /praise and /judge`),
  async execute(interaction) {
    const newBalance = claim(interaction.user.id);
    const content =
      newBalance === null
        ? `You already claimed today. You have **${balance(interaction.user.id)}** credit(s). Come back tomorrow! 🕛`
        : `🪙 +${DAILY_CREDITS} credits! You now have **${newBalance}**. Use them on /diss, /praise or /judge.`;
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  },
};
