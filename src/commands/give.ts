import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { DAILY_GIVE_LIMIT, balance, give as giveKowens, givenToday } from '../credits/store.js';
import { kowen } from '../kowens.js';

export const give: Command = {
  data: new SlashCommandBuilder()
    .setName('give')
    .setDescription(`Give Kowens to a friend 🪙 (max ${DAILY_GIVE_LIMIT}/day) · 🌐 Everyone sees`)
    .addUserOption((o) => o.setName('user').setDescription('Who to give to').setRequired(true))
    .addIntegerOption((o) =>
      o.setName('amount').setDescription(`How many Kowens (max ${DAILY_GIVE_LIMIT} per day)`).setRequired(true).setMinValue(1).setMaxValue(DAILY_GIVE_LIMIT),
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
      const left = DAILY_GIVE_LIMIT - givenToday(from.id);
      return void (await reply(
        result.reason === 'balance'
          ? `You only have **${balance(from.id)}** ${kowen(balance(from.id))}. 🪙`
          : left > 0
            ? `You can only give **${left}** more Kowens today (limit ${DAILY_GIVE_LIMIT}, resets at midnight). 📅`
            : `You've used your **${DAILY_GIVE_LIMIT}** ${kowen(DAILY_GIVE_LIMIT)} gifting limit today. It resets at midnight. 🌙`,
      ));
    }

    const left = DAILY_GIVE_LIMIT - givenToday(from.id);
    await interaction.reply({
      content: `🎁 ${from} gave **${amount}** ${kowen(amount)} to ${to}! 🪙\n-# ${from.username} can give ${left} more today.`,
      allowedMentions: { users: [to.id] },
    });
  },
};
