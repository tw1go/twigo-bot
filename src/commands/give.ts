import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { WEEKLY_GIVE_LIMIT, balance, give as giveKowens, givenThisWeek } from '../credits/store.js';
import { kowen } from '../kowens.js';

export const give: Command = {
  data: new SlashCommandBuilder()
    .setName('give')
    .setDescription(`Give Kowens to a friend 🪙 (max ${WEEKLY_GIVE_LIMIT}/week) · 🌐 Everyone sees`)
    .addUserOption((o) => o.setName('user').setDescription('Who to give to').setRequired(true))
    .addIntegerOption((o) =>
      o.setName('amount').setDescription(`How many Kowens (max ${WEEKLY_GIVE_LIMIT} per week)`).setRequired(true).setMinValue(1).setMaxValue(WEEKLY_GIVE_LIMIT),
    ),
  async execute(interaction) {
    const from = interaction.user;
    const to = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);
    const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

    if (to.id === from.id) return void (await reply("You can't give Kowens to yourself. 🤔"));
    if (to.bot) return void (await reply("Bots don't need Kowens. 🤖"));

    const result = giveKowens(from.id, to.id, amount);
    if (!result.ok) {
      const left = WEEKLY_GIVE_LIMIT - givenThisWeek(from.id);
      return void (await reply(
        result.reason === 'balance'
          ? `You only have **${balance(from.id)}** ${kowen(balance(from.id))}. 🪙`
          : left > 0
            ? `You can only give **${left}** more Kowens this week (limit ${WEEKLY_GIVE_LIMIT}, resets Monday). 📅`
            : `You've used your **${WEEKLY_GIVE_LIMIT}** ${kowen(WEEKLY_GIVE_LIMIT)} gifting limit this week. It resets Monday. 📅`,
      ));
    }

    const left = WEEKLY_GIVE_LIMIT - givenThisWeek(from.id);
    await interaction.reply({
      content: `🎁 ${from} gave **${amount}** ${kowen(amount)} to ${to}! 🪙\n-# ${from.username} can give ${left} more this week.`,
      allowedMentions: { users: [to.id] },
    });
  },
};
