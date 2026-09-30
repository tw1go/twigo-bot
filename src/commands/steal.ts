import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { add, balance, fencedUntil, lastSteal, markSteal, take } from '../credits/store.js';
import { blockIfJailed, jail } from '../games/jail.js';
import { kowen } from '../kowens.js';

// 35% chance to steal 1–3 credits. Otherwise the Tanod catches you: pay a fine to your target and go to jail.
const SUCCESS_CHANCE = 0.35;
const FINE = 2;
const FAIL_JAIL_MINUTES = 5;
const MIN_TARGET_BALANCE = 3; // don't pick on people who are nearly broke
const COOLDOWN_MS = 60 * 60_000;

export const steal: Command = {
  data: new SlashCommandBuilder()
    .setName('steal')
    .setDescription('Try to steal Kowens from someone 🥷 (risky!)')
    .addUserOption((o) => o.setName('user').setDescription('Who to rob').setRequired(true)),
  async execute(interaction) {
    if (await blockIfJailed(interaction)) return;
    const thief = interaction.user;
    const target = interaction.options.getUser('user', true);
    const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

    if (target.id === thief.id) return void (await reply("You can't rob yourself. 🤔"));
    if (target.bot) return void (await reply('The Tanod bot is not afraid of you. 🤖'));

    const fence = fencedUntil(target.id);
    if (fence) return void (await reply(`🧱 ${target} has a **Bakod**! You can't steal from them until <t:${Math.floor(fence / 1000)}:f>.`));

    const wait = lastSteal(thief.id) + COOLDOWN_MS - Date.now();
    if (wait > 0) return void (await reply(`You're laying low. Try again <t:${Math.floor((Date.now() + wait) / 1000)}:R>. 🕶️`));
    if (balance(thief.id) < FINE) return void (await reply(`You need at least **${FINE}** ${kowen(FINE)} to try (in case you get caught). 🪙`));
    if (balance(target.id) < MIN_TARGET_BALANCE) {
      return void (await reply(`${target} only has ${balance(target.id)} ${kowen(balance(target.id))}. Pick on someone richer. 💸`));
    }

    markSteal(thief.id);
    let content: string;
    if (Math.random() < SUCCESS_CHANCE) {
      const amount = take(target.id, 1 + Math.floor(Math.random() * 3));
      add(thief.id, amount);
      content = `🥷 ${thief} sneaked into ${target}'s house and stole **${amount}** ${kowen(amount)}! 💰`;
    } else {
      const fine = take(thief.id, FINE);
      add(target.id, fine);
      await jail(thief.id, FAIL_JAIL_MINUTES, `Caught stealing from ${target.username}`);
      content = `🚨 **CAUGHT!** The Tanod caught ${thief} trying to rob ${target}! ${thief} pays ${target} a fine of **${fine}** ${kowen(fine)} and spends **${FAIL_JAIL_MINUTES} minutes** in jail. 🚔`;
    }
    await interaction.reply({ content, allowedMentions: { users: [thief.id, target.id] } });
  },
};
