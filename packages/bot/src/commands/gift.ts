import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { config } from '../config.js';
import { accountIds, add, balance, take } from '../credits/store.js';
import { BOOST_CREDITS, boostCount, setBoostCount } from '../games/boosts.js';
import { DIGS_PER_DAY, SHOVELS_PER_DAY, SHOVEL_USES, capacity, resetDigCounters } from '../dig/store.js';
import { usedSlots } from '../dig/bag.js';
import { GIFTABLE, giftableById } from '../items/gift.js';
import { ATTEND_REWARD, TOP_REWARD, openPayoutPanel } from '../minewars/payout.js';
import { kowen } from '../kowens.js';
import { LAUNCH_REWARD, launchPayout, launched, preregPanel } from '../prereg/prereg.js';
import { TITLES, giveTitle } from '../web/titles.js';
import { townGift, townGiftItem } from '../web/town-feed.js';

// Only the gifter (REWARD_OWNER_ID) can use this. Hidden from non-admins by default.
export const gift: Command = {
  data: new SlashCommandBuilder()
    .setName('gift')
    .setDescription('Gifter only: gifts, items, boosts, titles & Mine Wars payouts 🎁')
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
        .setName('item')
        .setDescription('Give an item (shop items or dug-up finds) to someone or everyone · pops up in the web town')
        .addStringOption((o) => o.setName('item').setDescription('Which item').setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName('quantity').setDescription('How many each (default 1)').setMinValue(1).setMaxValue(100))
        .addUserOption((o) => o.setName('user').setDescription('Who (or use everyone)'))
        .addBooleanOption((o) => o.setName('everyone').setDescription('True = everyone who has used the bot')),
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
    .addSubcommand((s) => s.setName('prereg-panel').setDescription('Post the web game pre-registration panel here · 🌐 button for everyone'))
    .addSubcommand((s) =>
      s
        .setName('launch')
        .setDescription(`Web game launch: pay every pre-registered member ${LAUNCH_REWARD} Kowens and close sign-ups · 🌐`)
        .addBooleanOption((o) => o.setName('confirm').setDescription('True = pay everyone now and close pre-registration').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('title')
        .setDescription('Give someone a web game title (shown under their name) · 🔒')
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('title')
            .setDescription('Which title (Townfolk = back to the default)')
            .setRequired(true)
            .addChoices(...Object.entries(TITLES).filter(([, t]) => !t.auto).map(([value, t]) => ({ name: t.name, value }))),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('dig-reset')
        .setDescription(`Reset someone's daily dig (${DIGS_PER_DAY}) and shovel (${SHOVELS_PER_DAY}) counters, so they can go again today · 🔒`)
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)),
    )
    .addSubcommand((s) =>
      s.setName('minewars').setDescription(`Pay 9 PM Mine Wars: attendance +${ATTEND_REWARD}, Top 10 ${TOP_REWARD} · 🔒 panel · 🌐 summary`),
    ),
  async autocomplete(interaction) {
    const typed = interaction.options.getFocused().toLowerCase();
    await interaction.respond(
      GIFTABLE.filter((g) => g.name.toLowerCase().includes(typed) || g.id.includes(typed))
        .slice(0, 25)
        .map((g) => ({ name: `${g.emoji} ${g.name} (${g.rarity})`.slice(0, 100), value: g.id })),
    );
  },
  async execute(interaction) {
    if (interaction.user.id !== config.rewardOwnerId) {
      await interaction.reply({ content: 'Only the gifter can use this. 🎁', flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.options.getSubcommand() === 'minewars') {
      await openPayoutPanel(interaction);
      return;
    }
    if (interaction.options.getSubcommand() === 'prereg-panel') {
      if (launched()) {
        await interaction.reply({ content: 'The game has already launched, so pre-registration is closed.', flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.reply({ ...preregPanel(), allowedMentions: { parse: [] } });
      return;
    }
    if (interaction.options.getSubcommand() === 'launch') {
      if (!interaction.options.getBoolean('confirm', true)) {
        await interaction.reply({ content: 'Launch cancelled: nothing was paid.', flags: MessageFlags.Ephemeral });
        return;
      }
      const { paid, total } = launchPayout();
      if (!paid) {
        await interaction.reply({ content: `Pre-registration is closed. Nobody left to pay (${total} pre-registered, all paid).`, flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.reply({
        content: `🚀 **The Mikazuki web game is live!**\n🎁 ${paid} pre-registered ${paid === 1 ? 'member' : 'members'} received **${LAUNCH_REWARD}** ${kowen(LAUNCH_REWARD)} each. Thank you for waiting! 🎮${config.publicUrl ? `\nPlay: ${config.publicUrl}/play/` : ''}`,
        allowedMentions: { parse: [] },
      });
      return;
    }
    if (interaction.options.getSubcommand() === 'item') {
      const it = giftableById.get(interaction.options.getString('item', true));
      const quantity = interaction.options.getInteger('quantity') ?? 1;
      const user = interaction.options.getUser('user');
      const all = interaction.options.getBoolean('everyone') ?? false;
      if (!it) {
        await interaction.reply({ content: 'Pick an item from the list.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (all === !!user) {
        await interaction.reply({ content: 'Choose either a `user` or `everyone:True` (not both).', flags: MessageFlags.Ephemeral });
        return;
      }
      if (user?.bot) {
        await interaction.reply({ content: "Bots don't need items. 🤖", flags: MessageFlags.Ephemeral });
        return;
      }
      const ids = user ? [user.id] : accountIds();
      const shown = { id: it.id, name: it.name, rarity: it.rarity };
      for (const id of ids) {
        it.give(id, quantity);
        townGiftItem(id, 'The gifter', shown, quantity); // a pop-up for those in the web town
      }
      const over = ids.filter((id) => usedSlots(id) > capacity(id)).length;
      const what = `**${quantity > 1 ? `${quantity}× ` : ''}${it.emoji} ${it.name}**`;
      console.log(`[gift] item ${it.id} ×${quantity} → ${user ? user.id : `everyone (${ids.length})`}`);
      await interaction.reply({
        content:
          (user ? `🎁 ${user} received ${what} from the gifter!` : `🎁 **Everyone who has used the bot** (${ids.length} members) received ${what} from the gifter!`) +
          (it.id === 'shovel' ? `\n-# Each shovel is ${SHOVEL_USES} digs.` : '') +
          (over ? `\n-# ${user ? 'Their bag is' : `${over} bag${over === 1 ? ' is' : 's are'}`} now over capacity: no digging until they sell something.` : ''),
        allowedMentions: user ? { users: [user.id] } : { parse: [] },
      });
      return;
    }
    if (interaction.options.getSubcommand() === 'everyone') {
      const amount = interaction.options.getInteger('amount', true);
      const reason = interaction.options.getString('reason');
      // Straight into wallets: a gift isn't income, so loans don't garnish it.
      const ids = accountIds();
      for (const id of ids) {
        add(id, amount, { garnish: false });
        townGift(id, 'The gifter', amount); // a pop-up for those in the web town
      }
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

    if (interaction.options.getSubcommand() === 'title') {
      const id = interaction.options.getString('title', true);
      const title = TITLES[id];
      if (!title || title.auto) {
        await interaction.reply({ content: 'Unknown title.', flags: MessageFlags.Ephemeral });
        return;
      }
      giveTitle(target.id, id);
      console.log(`[gift] ${target.id} title ${id}`);
      await interaction.reply({
        content: `🏷️ ${target} now shows **<${title.name}>** in the web game (from their next visit to the town).`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (interaction.options.getSubcommand() === 'dig-reset') {
      const was = resetDigCounters(target.id);
      console.log(`[gift] ${target.id} dig-reset (was ${was.digs} digs, ${was.shovels} shovels)`);
      await interaction.reply({
        content: `⛏️ Reset ${target}'s counters for today: **${was.digs}/${DIGS_PER_DAY}** digs and **${was.shovels}/${SHOVELS_PER_DAY}** shovels bought → **0**. They can dig and buy shovels again today. 🪏\n-# Their shovel's uses and their finds are unchanged.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
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
    townGift(target.id, 'The gifter', amount); // the gift pop-up, if they're in the web town
    console.log(`[gift] ${target.id} +${amount}${reason ? ` (${reason})` : ''}`);
    await interaction.reply({
      content: `🎁 ${target} received **${amount.toLocaleString('en-US')}** ${kowen(amount)} from the gifter!${reason ? ` _${reason}_` : ''}\n-# They now have ${now.toLocaleString('en-US')} ${kowen(now)}.`,
      allowedMentions: { users: [target.id] },
    });
  },
};
