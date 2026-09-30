import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { DAILY_CREDITS, VOICE_MINUTES_PER_CREDIT, balance, claim, voiceProgress } from '../credits/store.js';

export const getCredits: Command = {
  data: new SlashCommandBuilder()
    .setName('get-credits')
    .setDescription(`Claim your ${DAILY_CREDITS} daily credits for /diss, /praise and /judge`),
  async execute(interaction) {
    const newBalance = claim(interaction.user.id);
    const vc = voiceProgress(interaction.user.id);
    const content =
      (newBalance === null
        ? `You already claimed today. You have **${balance(interaction.user.id)}** credit(s). Come back tomorrow! 🕛`
        : `🪙 +${DAILY_CREDITS} credits! You now have **${newBalance}**. Use them on /diss, /praise or /judge.`) +
      `\n🎙️ Voice chat: **${vc}/${VOICE_MINUTES_PER_CREDIT} min** toward your next credit (1 credit per ${VOICE_MINUTES_PER_CREDIT} min in VC).`;
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  },
};
