import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { balance, take } from '../credits/store.js';
import { bailFor, canBail, jailedUntil, release } from '../games/jail.js';
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

    if (!jailedUntil(target.id)) return void (await reply(self ? "You're not in jail. ✅" : `${target} isn't in jail. ✅`));
    if (!canBail(target.id)) {
      return void (await reply(`🔒 ${self ? 'Your' : `${target}'s`} sentence came from the Tanod (admins). No bail. It has to be served in full.`));
    }

    const cost = bailFor(target.id); // based on the jailed member's own balance
    if (balance(payer.id) < cost) {
      return void (await reply(`Bail for ${self ? 'you' : target} is **${cost}** ${kowen(cost)}, but you only have **${balance(payer.id)}**. 💸`));
    }

    take(payer.id, cost);
    await release(target.id);
    await interaction.reply({
      content: self
        ? `💸🔓 ${payer} paid **${cost}** ${kowen(cost)} bail and walked out of jail. Freedom! 🕊️`
        : `💸🔓 ${payer} paid **${cost}** ${kowen(cost)} to bail out ${target}! What a friend 🫂`,
      allowedMentions: { users: self ? [] : [target.id] },
    });
  },
};
