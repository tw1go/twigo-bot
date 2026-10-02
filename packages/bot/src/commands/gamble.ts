import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { markFound } from '../games/found.js';
import type { Command } from '../types.js';
import { add, balance, take } from '../credits/store.js';
import { blockIfJailed, jail } from '../games/jail.js';
import { kowen } from '../kowens.js';
import { config } from '../config.js';
import { tagoUntil } from '../potions/potions.js';

// Coin flip: 45% win (double). Otherwise you lose the bet — and sometimes the Tanod busts you (5 minutes in jail).
// The bust chance depends on where you gamble: low in the gambling channel, high anywhere else.
const WIN_CHANCE = 0.45;
const SIXTY_SEVEN_BONUS = 7; // 🤫 win a bet of exactly 67 → +7 extra
export const BUST_CHANCE_IN_CHANNEL = 0.03;
export const BUST_CHANCE_ELSEWHERE = 0.2;
const BUST_JAIL_MINUTES = 5;
const COOLDOWN_MS = 10_000;
const lastUsed = new Map<string, number>();

export const gamble: Command = {
  data: new SlashCommandBuilder()
    .setName('gamble')
    .setDescription('Bet your Kowens on a coin flip 🎲 (safest in the gambling channel) · 🌐 Everyone sees')
    .addIntegerOption((o) => o.setName('amount').setDescription('How many Kowens to bet').setRequired(true).setMinValue(1)),
  async execute(interaction) {
    if (await blockIfJailed(interaction)) return;
    const wait = (lastUsed.get(interaction.user.id) ?? 0) + COOLDOWN_MS - Date.now();
    if (wait > 0) {
      await interaction.reply({ content: `Easy there! Try again in ${Math.ceil(wait / 1000)}s. 🧊`, flags: MessageFlags.Ephemeral });
      return;
    }

    const bet = interaction.options.getInteger('amount', true);
    const have = balance(interaction.user.id);
    if (bet > have) {
      await interaction.reply({ content: `You only have **${have}** ${kowen(have)}. 🪙 Use /get-kowens or hang out in voice to earn more.`, flags: MessageFlags.Ephemeral });
      return;
    }
    lastUsed.set(interaction.user.id, Date.now());

    const inChannel = interaction.channelId === config.gamblingChannelId;
    const hidden = !!tagoUntil(interaction.user.id); // 🫥 Tago Tonic: the Tanod can't see you
    const bustChance = hidden ? 0 : inChannel ? BUST_CHANCE_IN_CHANNEL : BUST_CHANCE_ELSEWHERE;
    const roll = Math.random();
    let content: string;
    if (roll < bustChance) {
      take(interaction.user.id, bet);
      await jail(interaction.user.id, BUST_JAIL_MINUTES, 'Caught gambling');
      content = `🚨 **BUSTED!** The Tanod caught ${interaction.user} gambling! **${bet}** ${kowen(bet)} confiscated and **${BUST_JAIL_MINUTES} minutes** in jail. 🚔`;
    } else if (roll < bustChance + WIN_CHANCE) {
      add(interaction.user.id, bet + (bet === 67 ? SIXTY_SEVEN_BONUS : 0)); // 🤫 6-7
      if (bet === 67) markFound(interaction.user.id, '67-bet');
      content = `🎲 ${interaction.user} bet **${bet}** and **WON**! +${bet} ${kowen(bet)} 🤑`;
      if (bet === 67) content += `\n6️⃣7️⃣!! **+${SIXTY_SEVEN_BONUS}** bonus 🫲🫱`;
    } else {
      take(interaction.user.id, bet);
      content = `🎲 ${interaction.user} bet **${bet}** and **lost** it all. 💸`;
    }
    content += `\n-# Balance: ${balance(interaction.user.id)} ${kowen(balance(interaction.user.id))}`;
    if (hidden) content += ' · 🫥 Tago Tonic active (the Tanod can\'t see you)';
    else if (!inChannel) content += ` · 👀 The Tanod patrols here. Gamble in <#${config.gamblingChannelId}> to lower your risk.`;
    await interaction.reply({ content, allowedMentions: { parse: [] } });
  },
};
