import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { balance, take } from '../credits/store.js';
import { blockIfJailed } from '../games/jail.js';
import { DRAW_LABEL, MAX_TICKETS, addTickets, players, pot, ticketsOf } from '../games/jackpot.js';
import { kowen } from '../kowens.js';

export const jackpot: Command = {
  data: new SlashCommandBuilder()
    .setName('jackpot')
    .setDescription(`Buy jackpot tickets (1 Kowen each) — winner takes the pot at ${DRAW_LABEL} 🎰`)
    .addIntegerOption((o) =>
      o.setName('tickets').setDescription(`How many tickets to buy (max ${MAX_TICKETS} per day). Leave empty to check the pot.`).setMinValue(1).setMaxValue(MAX_TICKETS),
    ),
  async execute(interaction) {
    const status = () =>
      `🎰 Pot: **${pot()}** ${kowen(pot())} from **${players()}** player(s). You have **${ticketsOf(interaction.user.id)}** ticket(s). Draw at **${DRAW_LABEL}** tonight.`;
    const count = interaction.options.getInteger('tickets');
    if (!count) {
      await interaction.reply({ content: status(), flags: MessageFlags.Ephemeral });
      return;
    }
    if (await blockIfJailed(interaction)) return;

    const room = MAX_TICKETS - ticketsOf(interaction.user.id);
    if (room <= 0) {
      await interaction.reply({ content: `You already have the max of ${MAX_TICKETS} tickets. 🍀\n${status()}`, flags: MessageFlags.Ephemeral });
      return;
    }
    const buy = Math.min(count, room);
    if (balance(interaction.user.id) < buy) {
      await interaction.reply({ content: `You need **${buy}** ${kowen(buy)} but have **${balance(interaction.user.id)}**. 🪙`, flags: MessageFlags.Ephemeral });
      return;
    }

    take(interaction.user.id, buy);
    addTickets(interaction.user.id, buy);
    await interaction.reply({
      content: `🎟️ ${interaction.user} bought **${buy}** jackpot ticket(s)! The pot is now **${pot()}** ${kowen(pot())}. Draw at **${DRAW_LABEL}**.`,
      allowedMentions: { parse: [] },
    });
  },
};
