import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { blockIfJailed } from '../games/jail.js';
import { BUST_JAIL_MINUTES, SIXTY_SEVEN_BONUS, gambleFor } from '../games/gamble.js';
import { kowen } from '../kowens.js';
import { config } from '../config.js';
import { feed, townName } from '../web/town-feed.js';

// Coin flip: 45% win (double). Otherwise you lose the bet — and sometimes the Tanod busts you (5 minutes in jail).
// The bust chance depends on where you gamble: low in the gambling channel, high anywhere else. The rules live in
// games/gamble.ts, shared with the town's Casino.

export const gamble: Command = {
  data: new SlashCommandBuilder()
    .setName('gamble')
    .setDescription('Bet your Kowens on a coin flip 🎲 (safest in the gambling channel) · 🌐 Everyone sees')
    .addIntegerOption((o) => o.setName('amount').setDescription('How many Kowens to bet').setRequired(true).setMinValue(1)),
  async execute(interaction) {
    if (await blockIfJailed(interaction)) return;
    const bet = interaction.options.getInteger('amount', true);
    const inChannel = interaction.channelId === config.gamblingChannelId;
    const result = await gambleFor(interaction.user.id, bet, inChannel ? 'safe' : 'elsewhere');
    if (!result.ok) {
      if (result.reason === 'jailed') return; // blockIfJailed already answered
      await interaction.reply({
        content: result.reason === 'cooldown'
          ? `Easy there! Try again in ${Math.ceil(result.waitMs / 1000)}s. 🧊`
          : `You only have **${result.have}** ${kowen(result.have)}. 🪙 Use /get-kowens or hang out in voice to earn more.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let content: string;
    const who = interaction.user.id;
    if (result.outcome === 'bust') {
      content = `🚨 **BUSTED!** The Tanod caught ${interaction.user} gambling! **${bet}** ${kowen(bet)} confiscated and **${BUST_JAIL_MINUTES} minutes** in jail. 🚔`;
      feed('gamble', `The Tanod caught ${townName(interaction.user)} gambling ${bet} ${kowen(bet)}: off to jail`, 'bust', { userId: who, amount: bet });
    } else if (result.outcome === 'win') {
      content = `🎲 ${interaction.user} bet **${bet}** and **WON**! +${bet} ${kowen(bet)} 🤑`;
      if (result.bonus) content += `\n6️⃣7️⃣!! **+${SIXTY_SEVEN_BONUS}** bonus 🫲🫱`;
      feed('gamble', `${townName(interaction.user)} won ${bet} ${kowen(bet)} gambling`, 'win', { userId: who, amount: bet });
    } else {
      content = `🎲 ${interaction.user} bet **${bet}** and **lost** it all. 💸`;
      feed('gamble', `${townName(interaction.user)} lost ${bet} ${kowen(bet)} gambling`, 'lose', { userId: who, amount: bet });
    }
    content += `\n-# Balance: ${result.balance} ${kowen(result.balance)}`;
    if (result.hidden) content += ' · 🫥 Tago Tonic active (the Tanod can\'t see you)';
    else if (!inChannel) content += ` · 👀 The Tanod patrols here. Gamble in <#${config.gamblingChannelId}> to lower your risk.`;
    await interaction.reply({ content, allowedMentions: { parse: [] } });
  },
};
