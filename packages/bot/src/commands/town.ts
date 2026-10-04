import { type ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { config } from '../config.js';
import { STAFF } from '../web/auth.js';
import { kickFromTown } from '../web/town-feed.js';
import { addWord, blockedWords, kick, mute, removeWord, unmute } from '../web/town-mod.js';

// 🛡️ /town — moderating the web town (mods and admins): mute someone in town chat, kick them out of the town for a
// while, and manage the blocked-word list (matches become ***). Every action is noted in the admin channel.

const isStaff = (i: ChatInputCommandInteraction) => i.user.id === config.rewardOwnerId || STAFF.some((p) => i.memberPermissions?.has(p));
const minutesText = (m: number) => (m >= 60 && m % 60 === 0 ? `${m / 60} h` : `${m} min`);

/** A line in the admin channel (no pings). */
async function log(i: ChatInputCommandInteraction, text: string): Promise<void> {
  const channel = await i.client.channels.fetch(config.adminChannelId).catch(() => null);
  if (channel?.isSendable()) await channel.send({ content: `🛡️ ${text}`, allowedMentions: { parse: [] } }).catch(() => {});
  console.log(`[town-mod] ${i.user.username}: ${text}`);
}

export const town: Command = {
  data: new SlashCommandBuilder()
    .setName('town')
    .setDescription('Mods: moderate the web town (mute, kick, blocked words) 🛡️')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((s) =>
      s
        .setName('mute')
        .setDescription("Stop someone chatting in the town (bubbles and #town-chat) for a while")
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
        .addIntegerOption((o) => o.setName('minutes').setDescription('How long (default 30)').setMinValue(1).setMaxValue(10_080))
        .addStringOption((o) => o.setName('reason').setDescription('Why (for the admin log)').setMaxLength(100)),
    )
    .addSubcommand((s) =>
      s
        .setName('unmute')
        .setDescription('Let someone chat in the town again')
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('kick')
        .setDescription('Remove someone from the town now and keep them out for a while')
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
        .addIntegerOption((o) => o.setName('minutes').setDescription('Kept out for (default 15)').setMinValue(1).setMaxValue(10_080))
        .addStringOption((o) => o.setName('reason').setDescription('Why (for the admin log)').setMaxLength(100)),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('filter')
        .setDescription('Blocked words in town chat (shown as ***)')
        .addSubcommand((s) => s.setName('add').setDescription('Block a word').addStringOption((o) => o.setName('word').setDescription('The word').setRequired(true).setMaxLength(32)))
        .addSubcommand((s) => s.setName('remove').setDescription('Unblock a word').addStringOption((o) => o.setName('word').setDescription('The word').setRequired(true).setMaxLength(32)))
        .addSubcommand((s) => s.setName('list').setDescription('Show the blocked words (only to you)')),
    ),
  async execute(interaction) {
    const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    if (!isStaff(interaction)) return void (await reply('Only mods and admins can moderate the town. 🛡️'));
    const group = interaction.options.getSubcommandGroup();
    const sub = interaction.options.getSubcommand();

    if (group === 'filter') {
      if (sub === 'list') {
        const words = blockedWords();
        return void (await reply(words.length ? `Blocked in town chat (${words.length}): ${words.map((w) => `\`${w}\``).join(', ')}` : 'No blocked words yet. Add one with `/town filter add`.'));
      }
      const word = interaction.options.getString('word', true);
      if (sub === 'add') {
        const added = addWord(word);
        if (added) await log(interaction, `${interaction.user.username} added a blocked word to town chat`);
        return void (await reply(added ? 'Blocked. It now shows as *** in town chat.' : 'That word is already blocked.'));
      }
      const removed = removeWord(word);
      if (removed) await log(interaction, `${interaction.user.username} removed a blocked word from town chat`);
      return void (await reply(removed ? 'Unblocked.' : "That word wasn't on the list."));
    }

    const target = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') ?? undefined;
    const why = reason ? `: ${reason}` : '';
    if (sub === 'mute') {
      const minutes = interaction.options.getInteger('minutes') ?? 30;
      mute(target.id, minutes, reason);
      await log(interaction, `${interaction.user.username} muted ${target.username} in town chat for ${minutesText(minutes)}${why}`);
      return void (await reply(`🔇 ${target} can't chat in the town for **${minutesText(minutes)}**.`));
    }
    if (sub === 'unmute') {
      const had = unmute(target.id);
      if (had) await log(interaction, `${interaction.user.username} unmuted ${target.username} in town chat`);
      return void (await reply(had ? `🔊 ${target} can chat in the town again.` : `${target} wasn't muted.`));
    }
    // kick
    const minutes = interaction.options.getInteger('minutes') ?? 15;
    const until = kick(target.id, minutes, reason);
    const wasIn = kickFromTown(target.id, until);
    await log(interaction, `${interaction.user.username} kicked ${target.username} from the town for ${minutesText(minutes)}${why}`);
    await reply(`👢 ${target} ${wasIn ? 'was removed from the town and' : "wasn't in the town, but"} can't come back for **${minutesText(minutes)}**.`);
  },
};
