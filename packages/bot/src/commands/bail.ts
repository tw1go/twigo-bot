import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { balance } from '../credits/store.js';
import { payBail } from '../games/jail.js';
import { kowen } from '../kowens.js';

export const bail: Command = {
  data: new SlashCommandBuilder()
    .setName('bail')
    .setDescription('Pay bail to get out of jail early 💸 (or bail out a friend) · 🌐 Everyone sees')
    .addUserOption((o) => o.setName('user').setDescription('Who to bail out (default: you)')),
  async execute(interaction) {
    const payer = interaction.user;
    const target = interaction.options.getUser('user') ?? payer;
    const self = target.id === payer.id;
    const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

    const result = await payBail(payer.id, target.id);
    if (!result.ok) {
      const cost = result.cost;
      return void (await reply(
        result.reason === 'free' ? (self ? "You're not in jail. ✅" : `${target} isn't in jail. ✅`)
        : result.reason === 'no-bail' ? `🔒 ${self ? 'Your' : `${target}'s`} sentence came from the Tanod (admins). No bail. It has to be served in full.`
        : `Bail for ${self ? 'you' : target} is **${cost}** ${kowen(cost)}, but you only have **${balance(payer.id)}**. 💸`,
      ));
    }
    const cost = result.cost;
    await interaction.reply({
      content: self
        ? `💸🔓 ${payer} paid **${cost}** ${kowen(cost)} bail and walked out of jail. Freedom! 🕊️`
        : `💸🔓 ${payer} paid **${cost}** ${kowen(cost)} to bail out ${target}! What a friend 🫂`,
      allowedMentions: { users: self ? [] : [target.id] },
    });
  },
};
