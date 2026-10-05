import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { blockIfJailed } from '../games/jail.js';
import { STEAL_COOLDOWN_MS, STEAL_FINE, stealFrom } from '../games/steal.js';
import { kowen } from '../kowens.js';
import { feed, townName } from '../web/town-feed.js';

// /steal: the rules are in games/steal.ts (shared with the neighbourhood's houses). In Discord a Master Key is used
// by itself on a Bakod.

export { STEAL_COOLDOWN_MS };

export const steal: Command = {
  data: new SlashCommandBuilder()
    .setName('steal')
    .setDescription('Try to steal Kowens from someone 🥷 (risky!) · 🌐 Everyone sees')
    .addUserOption((o) => o.setName('user').setDescription('Who to rob').setRequired(true)),
  async execute(interaction) {
    if (await blockIfJailed(interaction)) return;
    const thief = interaction.user;
    const target = interaction.options.getUser('user', true);
    const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    if (target.bot) return void (await reply('The Tanod bot is not afraid of you. 🤖'));

    const result = await stealFrom(thief.id, target.id, true, `Caught stealing from ${target.username}`);
    if (!result.ok) {
      switch (result.reason) {
        case 'self':
          return void (await reply("You can't rob yourself. 🤔"));
        case 'cooldown':
          return void (await reply(`You're laying low. Try again <t:${Math.floor(result.until / 1000)}:R>. 🕶️`));
        case 'broke':
          return void (await reply(`You need at least **${STEAL_FINE}** ${kowen(STEAL_FINE)} to try (in case you get caught). 🪙`));
        case 'poor':
          return void (await reply(`${target} only has ${result.have} ${kowen(result.have)}. Pick on someone richer. 💸`));
        case 'fenced':
          return void (await reply(`🧱 ${target} has a **Bakod**! You can't steal from them until <t:${Math.floor(result.until / 1000)}:f>.\n-# A 🗝️ Master Key from \`/redeem\` has a 50% chance to break in.`));
      }
    }
    const mentions = { users: [...new Set([thief.id, target.id])] };
    // A Master Key used on a Bakod shows in the web town's system feed too.
    const [me, them] = [townName(thief), townName(target)];
    if (result.outcome === 'key-snapped') feed('steal', `${me}'s Master Key snapped on ${them}'s Bakod`, 'lose');
    else if (result.key && result.outcome === 'stole') feed('steal', `${me} broke through ${them}'s Bakod with a Master Key and stole ${result.amount} ${kowen(result.amount)}`, 'win', { userId: thief.id });
    else if (result.key) feed('steal', `${me} broke through ${them}'s Bakod with a Master Key, but the Tanod caught them`, 'bust', { userId: thief.id });
    if (result.outcome === 'key-snapped') {
      await interaction.reply({ content: `🗝️💥 ${thief} tried a **Master Key** on ${target}'s 🧱 Bakod… and the key **snapped**! The Bakod holds. 🔒`, allowedMentions: mentions });
      return;
    }
    const intro = result.key ? `🗝️🔓 ${thief} used a **Master Key** to break through ${target}'s Bakod!\n` : '';
    const content = result.outcome === 'stole'
      ? `🥷 ${thief} sneaked into ${target}'s house and stole **${result.amount}** ${kowen(result.amount)}! 💰`
      : `🚨 **CAUGHT!** The Tanod caught ${thief} trying to rob ${target}! ${thief} pays ${target} a fine of **${result.fine}** ${kowen(result.fine)} and spends **${result.minutes} minutes** in jail. 🚔`;
    await interaction.reply({ content: intro + content, allowedMentions: mentions });
  },
};
