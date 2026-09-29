import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type Client } from 'discord.js';
import type { Command } from '../types.js';
import { askAdmin, closePoll, remindParticipants, startMatch } from '../match/flow.js';
import { postRolePanel, startMineWars, warnMineWars } from '../minewars/flow.js';

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
    ),
  async execute(interaction) {
    const abf = interaction.options.getString('abf');
    const mw = interaction.options.getString('mw');
    if (!abf === !mw) {
      await interaction.reply({ content: 'Pick exactly one: `abf:` or `mw:`.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (abf) await abfSteps[abf](interaction.client);
    else await mwSteps[mw!](interaction.client);
    await interaction.editReply(abf ? `Ran abf:${abf}` : `Ran mw:${mw}`);
  },
};
