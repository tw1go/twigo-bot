import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type Message } from 'discord.js';
import type { Command } from '../types.js';
import { config } from '../config.js';
import { jail as jailUser, jailList, jailedUntil, release } from '../games/jail.js';

// Discord's relative timestamps keep counting up ("5 seconds ago") after they pass, so these messages are
// edited when someone's time is up.
const unix = (ms: number) => Math.floor(ms / 1000);
const MAX_TIMER_MS = 2 ** 31 - 1; // setTimeout limit (~24.8 days)

function jailListEmbed(): { embed: EmbedBuilder; nextRelease: number | null } {
  const list = jailList();
  const embed = new EmbedBuilder()
    .setColor(0x7f8c8d)
    .setTitle('🚔 Jail')
    .setDescription(
      list.length
        ? list.map(([id, e]) => `<@${id}> — out at <t:${unix(e.until)}:t> (<t:${unix(e.until)}:R>) · _${e.reason}_`).join('\n')
        : '_The jail is empty. Everyone is behaving... for now._',
    );
  return { embed, nextRelease: list.length ? Math.min(...list.map(([, e]) => e.until)) : null };
}

/** Re-renders a /jail list each time someone is released, until the jail is empty. */
function refreshListOnRelease(message: Message, nextRelease: number | null): void {
  if (nextRelease === null) return;
  const wait = Math.min(Math.max(nextRelease - Date.now() + 1500, 1000), MAX_TIMER_MS);
  setTimeout(() => {
    const { embed, nextRelease: next } = jailListEmbed();
    message
      .edit({ embeds: [embed], allowedMentions: { parse: [] } })
      .then(() => refreshListOnRelease(message, next))
      .catch((e) => console.error('[jail] list refresh failed:', e.message));
  }, wait);
}

/** Turns "Out in X" into "Released" when the member's time is up (follows extensions). */
function markReleasedWhenDone(message: Message, userId: string, header: string): void {
  const until = jailedUntil(userId);
  if (!until) {
    message.edit({ content: `${header}\n-# ✅ Released`, allowedMentions: { parse: [] } }).catch(() => {});
    return;
  }
  const wait = Math.min(Math.max(until - Date.now() + 1500, 1000), MAX_TIMER_MS);
  setTimeout(() => markReleasedWhenDone(message, userId, header), wait);
}

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
      const { embed, nextRelease } = jailListEmbed();
      const res = await interaction.reply({ embeds: [embed], withResponse: true });
      if (res.resource?.message) refreshListOnRelease(res.resource.message, nextRelease);
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
    const header = `🚔 ${target} has been thrown in jail for **${minutes} minute(s)**! _${reason}_`;
    const res = await interaction.reply({
      content: `${header}\n-# Out at <t:${unix(until)}:t> (<t:${unix(until)}:R>)`,
      allowedMentions: { users: [target.id] },
      withResponse: true,
    });
    if (res.resource?.message) markReleasedWhenDone(res.resource.message, target.id, header);
  },
};
