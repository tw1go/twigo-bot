import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { balance } from '../credits/store.js';
import { blockIfJailed } from '../games/jail.js';
import { DRAW_LABEL, MAX_TICKETS, RAID_SHARE, buyTickets, entries, lastDraw, nextDraw, players, pot, raidMoney, ticketTotal, ticketWord, ticketsOf } from '../games/jackpot.js';
import { kowen } from '../kowens.js';
import { feed, townName } from '../web/town-feed.js';

/** The /jackpot check: pot, who's in, your odds, countdown and last winner. */
function statusCard(userId: string): EmbedBuilder {
  const total = pot();
  const ticketsIn = ticketTotal(); // the odds count tickets only
  const raid = raidMoney();
  const mine = ticketsOf(userId);
  const next = nextDraw();
  const ts = Math.floor(next.getTime() / 1000);
  const list = entries();

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🎰 Next Jackpot')
    .setDescription(`## 🪙 ${total} ${kowen(total)} in the pot\n${raid ? `-# 🚨 ${raid} from Tanod raids (${Math.round(RAID_SHARE * 100)}% of confiscated bets)\n` : ''}Draw at <t:${ts}:t> (<t:${ts}:R>)`)
    .addFields(
      {
        name: `🎟️ Players (${list.length})`,
        value: list.length
          ? list.map(([id, n]) => `<@${id}> — ${n} ticket${n === 1 ? '' : 's'} (${Math.round((n / ticketsIn) * 100)}%)`).join('\n')
          : '_Nobody yet — be the first!_',
      },
      {
        name: '🍀 Your chance',
        value: mine
          ? `**${mine}** of **${ticketsIn}** tickets = **${Math.round((mine / ticketsIn) * 100)}%**${list.length < 2 ? '\n-# Needs at least 2 players, or everyone is refunded.' : ''}`
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

    const result = buyTickets(interaction.user.id, count);
    if ('refused' in result) {
      await interaction.reply({
        content: result.refused === 'max'
          ? `You already have the max of ${MAX_TICKETS} tickets. 🍀\n${status()}`
          : `You need **${result.need}** ${kowen(result.need)} but have **${balance(interaction.user.id)}**. 🪙`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const buy = result.bought;
    feed('jackpot', `${townName(interaction.user)} bought ${ticketWord(buy)} · the pot is ${pot()} ${kowen(pot())}`, 'jackpot');
    await interaction.reply({
      content: `🎟️ ${interaction.user} bought **${buy}** jackpot ticket(s)! The pot is now **${pot()}** ${kowen(pot())}. Next draw <t:${Math.floor(nextDraw().getTime() / 1000)}:R>.`,
      allowedMentions: { parse: [] },
    });
  },
};
