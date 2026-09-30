import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import {
  DAILY_CREDITS,
  INACTIVE_GRACE_DAYS,
  VOICE_DAILY_CAP,
  VOICE_MINUTES_PER_CREDIT,
  balance,
  claim,
  voiceCreditsToday,
  voiceProgress,
} from '../credits/store.js';

export const getCredits: Command = {
  data: new SlashCommandBuilder()
    .setName('get-credits')
    .setDescription(`Claim your ${DAILY_CREDITS} daily credits for /diss, /praise and /judge`),
  async execute(interaction) {
    const newBalance = claim(interaction.user.id);
    const vc = voiceProgress(interaction.user.id);
    const vcToday = voiceCreditsToday(interaction.user.id);
    const content =
      (newBalance === null
        ? `You already claimed today. You have **${balance(interaction.user.id)}** credit(s). Come back tomorrow! 🕛`
        : `🪙 +${DAILY_CREDITS} credits! You now have **${newBalance}**. Use them on /diss, /praise or /judge.`) +
      (vcToday >= VOICE_DAILY_CAP
        ? `\n🎙️ Voice chat: **${vcToday}/${VOICE_DAILY_CAP}** credits today — daily max reached! More tomorrow. 🌙`
        : `\n🎙️ Voice chat: **${vcToday}/${VOICE_DAILY_CAP}** credits today · **${vc}/${VOICE_MINUTES_PER_CREDIT} min** toward the next one.`) +
      `\n-# ⚠️ Inactive for more than ${INACTIVE_GRACE_DAYS} days? You start losing credits each day. Chat, join voice or use the bot to stay safe.`;
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  },
};
