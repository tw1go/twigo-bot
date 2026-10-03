import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { config } from '../config.js';
import { accountIds, add, balance, take } from '../credits/store.js';
import { BOOST_CREDITS, boostCount, setBoostCount } from '../games/boosts.js';
import { ATTEND_REWARD, TOP_REWARD, openPayoutPanel } from '../minewars/payout.js';
import { kowen } from '../kowens.js';

// Only the gifter (REWARD_OWNER_ID) can use this. Hidden from non-admins by default.
export const gift: Command = {
  data: new SlashCommandBuilder()
    .setName('gift')
    .setDescription('Gifter only: gifts, boosts & Mine Wars payouts 🎁')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) =>
      s
        .setName('kowens')
        .setDescription('Give Kowens (negative removes) · 🌐 gifts public · 🔒 removals private')
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
        .addIntegerOption((o) => o.setName('amount').setDescription('How many (e.g. 50, or -20 to remove)').setRequired(true).setMinValue(-100_000).setMaxValue(100_000))
        .addStringOption((o) => o.setName('reason').setDescription('Why (shown in the message)').setMaxLength(100)),
    )
    .addSubcommand((s) =>
      s
        .setName('boosts')
        .setDescription(`Set a boost count (monthly = ${BOOST_CREDITS} × count; 0 removes) · 🔒 Only you see`)
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
        .addIntegerOption((o) => o.setName('count').setDescription('Number of active boosts').setRequired(true).setMinValue(0).setMaxValue(50)),
    )
    .addSubcommand((s) =>
      s
        .setName('everyone')
        .setDescription('Give Kowens to everyone who has used the bot (e.g. compensation) · 🌐 no pings')
        .addIntegerOption((o) => o.setName('amount').setDescription('How many each').setRequired(true).setMinValue(1).setMaxValue(1000))
        .addStringOption((o) => o.setName('reason').setDescription('Why (shown in the message)').setMaxLength(100)),
    )
    .addSubcommand((s) =>
      s.setName('minewars').setDescription(`Pay 9 PM Mine Wars: attendance +${ATTEND_REWARD}, Top 10 ${TOP_REWARD} · 🔒 panel · 🌐 summary`),
    ),
  async execute(interaction) {
    if (interaction.user.id !== config.rewardOwnerId) {
      await interaction.reply({ content: 'Only the gifter can use this. 🎁', flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.options.getSubcommand() === 'minewars') {
      await openPayoutPanel(interaction);
      return;
    }
    if (interaction.options.getSubcommand() === 'everyone') {
      const amount = interaction.options.getInteger('amount', true);
      const reason = interaction.options.getString('reason');
      // Straight into wallets: a gift isn't income, so loans don't garnish it.
      const ids = accountIds();
      for (const id of ids) add(id, amount, { garnish: false });
      console.log(`[gift] everyone (${ids.length}) +${amount}${reason ? ` (${reason})` : ''}`);
      await interaction.reply({
        content: `🎁 **Everyone who has used the bot** (${ids.length} members) received **${amount.toLocaleString('en-US')}** ${kowen(amount)} from the gifter!${reason ? ` _${reason}_` : ''}\n-# Check yours with /balance.`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    const target = interaction.options.getUser('user', true);
    if (target.bot) {
      await interaction.reply({ content: "Bots don't need Kowens. 🤖", flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.options.getSubcommand() === 'boosts') {
      const count = interaction.options.getInteger('count', true);
      setBoostCount(target.id, count);
      await interaction.reply({
        content: count
          ? `💎 ${target} is set to **${count}** boost(s) → **${BOOST_CREDITS * count}** ${kowen(BOOST_CREDITS * count)} every month.`
          : `💎 Removed ${target} from monthly booster rewards.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }

    const amount = interaction.options.getInteger('amount', true);
    const reason = interaction.options.getString('reason');
    if (amount === 0) {
      await interaction.reply({ content: 'Amount can’t be 0.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (amount < 0) {
      const removed = take(target.id, -amount);
      await interaction.reply({
        content: `➖ Removed **${removed}** ${kowen(removed)} from ${target}. They now have **${balance(target.id)}**.${reason ? ` _${reason}_` : ''}`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }
    const now = add(target.id, amount);
    console.log(`[gift] ${target.id} +${amount}${reason ? ` (${reason})` : ''}`);
    await interaction.reply({
      content: `🎁 ${target} received **${amount.toLocaleString('en-US')}** ${kowen(amount)} from the gifter!${reason ? ` _${reason}_` : ''}\n-# They now have ${now.toLocaleString('en-US')} ${kowen(now)}.`,
      allowedMentions: { users: [target.id] },
    });
  },
};
