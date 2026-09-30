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
import { kowen } from '../kowens.js';

export const getCredits: Command = {
  data: new SlashCommandBuilder()
    .setName('get-kowens')
    .setDescription(`Claim your ${DAILY_CREDITS} daily Kowens 🪙`),
  async execute(interaction) {
    const newBalance = claim(interaction.user.id);
    const vc = voiceProgress(interaction.user.id);
    const vcToday = voiceCreditsToday(interaction.user.id);
    const content =
      (newBalance === null
        ? `You already claimed today. You have **${balance(interaction.user.id)}** ${kowen(balance(interaction.user.id))}. Come back tomorrow! 🕛`
        : `🪙 +${DAILY_CREDITS} ${kowen(DAILY_CREDITS)}! You now have **${newBalance}**. Spend them on /judge, games or /redeem.`) +
      (vcToday >= VOICE_DAILY_CAP
        ? `\n🎙️ Voice chat: **${vcToday}/${VOICE_DAILY_CAP}** ${kowen(VOICE_DAILY_CAP)} today — daily max reached! More tomorrow. 🌙`
        : `\n🎙️ Voice chat: **${vcToday}/${VOICE_DAILY_CAP}** ${kowen(VOICE_DAILY_CAP)} today · **${vc}/${VOICE_MINUTES_PER_CREDIT} min** toward the next one.`) +
      `\n-# ⚠️ Inactive for more than ${INACTIVE_GRACE_DAYS} days? You start losing Kowens each day. Chat, join voice or use the bot to stay safe.`;
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  },
};
