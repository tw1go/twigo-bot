import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { add, balance, lastSteal, markSteal, take } from '../credits/store.js';
import { blockIfJailed, jail } from '../games/jail.js';

// 35% chance to steal 1–3 credits. Otherwise the Tanod catches you: pay a fine to your target and go to jail.
const SUCCESS_CHANCE = 0.35;
const FINE = 2;
const FAIL_JAIL_MINUTES = 5;
const MIN_TARGET_BALANCE = 3; // don't pick on people who are nearly broke
const COOLDOWN_MS = 60 * 60_000;

export const steal: Command = {
  data: new SlashCommandBuilder()
    .setName('steal')
    .setDescription('Try to steal credits from someone 🥷 (risky!)')
    .addUserOption((o) => o.setName('user').setDescription('Who to rob').setRequired(true)),
  async execute(interaction) {
    if (await blockIfJailed(interaction)) return;
    const thief = interaction.user;
    const target = interaction.options.getUser('user', true);
    const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

    if (target.id === thief.id) return void (await reply("You can't rob yourself. 🤔"));
    if (target.bot) return void (await reply('The Tanod bot is not afraid of you. 🤖'));

    const wait = lastSteal(thief.id) + COOLDOWN_MS - Date.now();
    if (wait > 0) return void (await reply(`You're laying low. Try again <t:${Math.floor((Date.now() + wait) / 1000)}:R>. 🕶️`));
    if (balance(thief.id) < FINE) return void (await reply(`You need at least **${FINE}** credits to try (in case you get caught). 🪙`));
    if (balance(target.id) < MIN_TARGET_BALANCE) {
      return void (await reply(`${target} only has ${balance(target.id)} credit(s). Pick on someone richer. 💸`));
    }

    markSteal(thief.id);
    let content: string;
    if (Math.random() < SUCCESS_CHANCE) {
      const amount = take(target.id, 1 + Math.floor(Math.random() * 3));
      add(thief.id, amount);
      content = `🥷 ${thief} sneaked into ${target}'s house and stole **${amount}** credit(s)! 💰`;
    } else {
      const fine = take(thief.id, FINE);
      add(target.id, fine);
      await jail(thief.id, FAIL_JAIL_MINUTES, `Caught stealing from ${target.username}`);
      content = `🚨 **CAUGHT!** The Tanod caught ${thief} trying to rob ${target}! ${thief} pays ${target} a **${fine}**-credit fine and spends **${FAIL_JAIL_MINUTES} minutes** in jail. 🚔`;
    }
    await interaction.reply({ content, allowedMentions: { users: [thief.id, target.id] } });
  },
};
