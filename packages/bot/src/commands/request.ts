import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { MAX_ACTIVE, MAX_REWARD, createQuest } from '../quests/board.js';

export const request: Command = {
  data: new SlashCommandBuilder()
    .setName('request')
    .setDescription(`Post a quest with a Kowens reward 📜 (max ${MAX_REWARD}, ${MAX_ACTIVE} active) · 🌐 Everyone sees`)
    .addStringOption((o) => o.setName('task').setDescription('What you need done').setRequired(true).setMaxLength(300))
    .addIntegerOption((o) =>
      o.setName('reward').setDescription(`Kowens to pay whoever completes it (1–${MAX_REWARD}), held until done`).setRequired(true).setMinValue(1).setMaxValue(MAX_REWARD),
    ),
  execute: createQuest,
};
