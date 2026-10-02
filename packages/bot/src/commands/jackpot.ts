import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { balance, take } from '../credits/store.js';
import { blockIfJailed } from '../games/jail.js';
import { DRAW_LABEL, MAX_TICKETS, addTickets, entries, lastDraw, nextDraw, players, pot, ticketsOf } from '../games/jackpot.js';
import { kowen } from '../kowens.js';

/** The /jackpot check: pot, who's in, your odds, countdown and last winner. */
function statusCard(userId: string): EmbedBuilder {
  const total = pot();
  const mine = ticketsOf(userId);
  const next = nextDraw();
  const ts = Math.floor(next.getTime() / 1000);
  const list = entries();

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🎰 Next Jackpot')
    .setDescription(`## 🪙 ${total} ${kowen(total)} in the pot\nDraw at <t:${ts}:t> (<t:${ts}:R>)`)
    .addFields(
      {
        name: `🎟️ Players (${list.length})`,
        value: list.length
          ? list.map(([id, n]) => `<@${id}> — ${n} ticket${n === 1 ? '' : 's'} (${Math.round((n / total) * 100)}%)`).join('\n')
          : '_Nobody yet — be the first!_',
      },
      {
        name: '🍀 Your chance',
        value: mine
          ? `**${mine}** of **${total}** tickets = **${Math.round((mine / total) * 100)}%**${list.length < 2 ? '\n-# Needs at least 2 players, or everyone is refunded.' : ''}`
          : `You're not in yet. \`/jackpot tickets:1\` to join (max ${MAX_TICKETS}).`,
      },
    );

  const prev = lastDraw();
  if (prev) {
    embed.addFields({
      name: '🏆 Last draw',
      value: prev.winner
        ? `<@${prev.winner}> won **${prev.pot} ${kowen(prev.pot)}** from ${prev.players} players (<t:${Math.floor(prev.at / 1000)}:d>)`
        : `Only 1 player joined, so it was refunded (<t:${Math.floor(prev.at / 1000)}:d>)`,
    });
  }
  return embed;
}

export const jackpot: Command = {
  data: new SlashCommandBuilder()
    .setName('jackpot')
    .setDescription(`Jackpot tickets, 1 Kowen each, drawn at ${DRAW_LABEL} 🎰 · 🔒 checking · 🌐 buying`)
    .addIntegerOption((o) =>
      o.setName('tickets').setDescription(`How many tickets to buy (max ${MAX_TICKETS} per draw). Leave empty to check the pot.`).setMinValue(1).setMaxValue(MAX_TICKETS),
    ),
  async execute(interaction) {
    const status = () =>
      `🎰 Pot: **${pot()}** ${kowen(pot())} from **${players()}** player(s). You have **${ticketsOf(interaction.user.id)}** ticket(s). Next draw <t:${Math.floor(nextDraw().getTime() / 1000)}:R>.`;
    const count = interaction.options.getInteger('tickets');
    if (!count) {
      await interaction.reply({ embeds: [statusCard(interaction.user.id)], flags: MessageFlags.Ephemeral });
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
      content: `🎟️ ${interaction.user} bought **${buy}** jackpot ticket(s)! The pot is now **${pot()}** ${kowen(pot())}. Next draw <t:${Math.floor(nextDraw().getTime() / 1000)}:R>.`,
      allowedMentions: { parse: [] },
    });
  },
};
