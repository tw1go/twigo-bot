import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { config } from '../config.js';
import { jail as jailUser, jailList, release } from '../games/jail.js';

export const jail: Command = {
  data: new SlashCommandBuilder()
    .setName('jail')
    .setDescription('See who is in jail, or (admins) jail/release someone 🚔')
    .addUserOption((o) => o.setName('user').setDescription('Admins: who to jail or release'))
    .addIntegerOption((o) =>
      o.setName('minutes').setDescription('Admins: how long (default 5, 0 = release)').setMinValue(0).setMaxValue(1440),
    )
    .addStringOption((o) => o.setName('reason').setDescription('Admins: why').setMaxLength(100)),
  async execute(interaction) {
    const target = interaction.options.getUser('user');

    if (!target) {
      const list = jailList();
      const embed = new EmbedBuilder()
        .setColor(0x7f8c8d)
        .setTitle('🚔 Jail')
        .setDescription(
          list.length
            ? list.map(([id, e]) => `<@${id}> — out <t:${Math.floor(e.until / 1000)}:R> · _${e.reason}_`).join('\n')
            : '_The jail is empty. Everyone is behaving... for now._',
        );
      await interaction.reply({ embeds: [embed] });
      return;
    }

    const isAdmin =
      interaction.inCachedGuild() &&
      (interaction.member.roles.cache.has(config.adminRoleId) ||
        interaction.member.permissions.has(PermissionFlagsBits.Administrator));
    if (!isAdmin) {
      await interaction.reply({ content: 'Only the Tanod (admins) can jail people. 🫡', flags: MessageFlags.Ephemeral });
      return;
    }
    if (target.bot) {
      await interaction.reply({ content: "Bots can't be jailed. 🤖", flags: MessageFlags.Ephemeral });
      return;
    }

    const minutes = interaction.options.getInteger('minutes') ?? 5;
    if (minutes === 0) {
      const wasJailed = await release(target.id);
      await interaction.reply({
        content: wasJailed ? `🔓 ${target} has been released from jail.` : `${target} isn't in jail.`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    const reason = interaction.options.getString('reason') ?? 'Orders from the Tanod';
    const until = await jailUser(target.id, minutes, reason);
    await interaction.reply({
      content: `🚔 ${target} has been thrown in jail for **${minutes} minute(s)**! _${reason}_\n-# Out <t:${Math.floor(until / 1000)}:R>`,
      allowedMentions: { users: [target.id] },
    });
  },
};
