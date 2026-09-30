import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type Client } from 'discord.js';
import type { Command } from '../types.js';
import { askAdmin, closePoll, remindParticipants, startMatch } from '../match/flow.js';
import { postRolePanel, startMineWars, warnMineWars } from '../minewars/flow.js';
import { sendGreeting } from '../greetings/flow.js';
import { reset, resetAll } from '../credits/store.js';
import { sendBanter } from '../banter/flow.js';
import { openAnnounceModal } from '../announce/flow.js';

// Manually trigger each scheduled step — for testing or if something was missed.
const abfSteps: Record<string, (c: Client) => Promise<void>> = {
  ask: askAdmin,
  close: closePoll,
  remind: remindParticipants,
  start: startMatch,
};

const mwSteps: Record<string, (c: Client) => Promise<void>> = {
  warning: warnMineWars,
  start: startMineWars,
  panel: postRolePanel,
};

export const twigo: Command = {
  data: new SlashCommandBuilder()
    .setName('twigo')
    .setDescription('Twigo bot commands')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o
        .setName('abf')
        .setDescription('Ancient Battlefield: run a step now')
        .addChoices(
          { name: 'ask admins (12:30 PM)', value: 'ask' },
          { name: 'close poll + list participants (6:00 PM)', value: 'close' },
          { name: 'ping participants (7:45 PM)', value: 'remind' },
          { name: 'ping participants: ready up (8:00 PM)', value: 'start' },
        ),
    )
    .addStringOption((o) =>
      o
        .setName('mw')
        .setDescription('Mine Wars: send a message now')
        .addChoices(
          { name: 'starting in 5 minutes', value: 'warning' },
          { name: 'ongoing now', value: 'start' },
          { name: 'post the "get pinged" button', value: 'panel' },
        ),
    )
    .addStringOption((o) =>
      o
        .setName('greet')
        .setDescription('Morning greeting: send one now')
        .addChoices({ name: 'send now', value: 'send' }),
    )
    .addStringOption((o) =>
      o
        .setName('banter')
        .setDescription('Random chat: say a random line now')
        .addChoices({ name: 'say something now', value: 'send' }),
    )
    .addUserOption((o) =>
      o.setName('reset-credits').setDescription('Reset one member\'s /diss, /praise & /judge credits (they can claim again)'),
    )
    .addStringOption((o) =>
      o
        .setName('reset-all-credits')
        .setDescription('Reset EVERYONE\'s /diss, /praise & /judge credits')
        .addChoices({ name: 'yes, reset everyone', value: 'yes' }),
    )
    .addChannelOption((o) =>
      o
        .setName('announce')
        .setDescription('Post an announcement as the bot in this channel (opens a text box)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    )
    .addBooleanOption((o) =>
      o.setName('announce-ping').setDescription('With announce: ping @everyone (default: no ping)'),
    ),
  async execute(interaction) {
    const abf = interaction.options.getString('abf');
    const mw = interaction.options.getString('mw');
    const greet = interaction.options.getString('greet');
    const banter = interaction.options.getString('banter');
    const resetUser = interaction.options.getUser('reset-credits');
    const resetEveryone = interaction.options.getString('reset-all-credits');
    const announce = interaction.options.getChannel('announce');
    const announcePing = interaction.options.getBoolean('announce-ping');
    const picked = [abf, mw, greet, banter, resetUser, resetEveryone, announce].filter(Boolean);
    if (picked.length !== 1) {
      await interaction.reply({
        content: 'Pick exactly one option: `abf:`, `mw:`, `greet:`, `banter:`, `announce:`, `reset-credits:` or `reset-all-credits:`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (announcePing !== null && !announce) {
      await interaction.reply({ content: '`announce-ping:` only works together with `announce:`.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (announce) {
      await openAnnounceModal(interaction, announce.id, announcePing === true);
      return;
    }

    if (resetUser) {
      const previous = reset(resetUser.id);
      await interaction.reply({
        content: `🔄 Reset ${resetUser}'s credits (had ${previous}). They can claim again with /get-credits.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }
    if (resetEveryone) {
      const count = resetAll();
      await interaction.reply({
        content: `🔄 Reset credits for ${count} member(s). Everyone can claim again with /get-credits.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (abf) await abfSteps[abf](interaction.client);
    else if (mw) await mwSteps[mw](interaction.client);
    else if (greet) await sendGreeting(interaction.client);
    else await sendBanter(interaction.client);
    await interaction.editReply(`Ran ${abf ? `abf:${abf}` : mw ? `mw:${mw}` : greet ? 'greet:send' : 'banter:send'}`);
  },
};
