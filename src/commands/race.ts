import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { MAX_BET, PAYOUT, startRace } from '../games/race.js';

export const race: Command = {
  data: new SlashCommandBuilder()
    .setName('race')
    .setDescription(`Mosang race 🏁 in the gambling channel — 2 min betting (1–${MAX_BET}), winner pays ${PAYOUT}× · 🌐 Everyone sees`),
  execute: startRace,
};
