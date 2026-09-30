import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { add, balance, fencedUntil, lastSteal, markSteal, take } from '../credits/store.js';
import { blockIfJailed, jail } from '../games/jail.js';
import { masterKeys, useMasterKey } from '../dig/store.js';
import { kowen } from '../kowens.js';

// 35% chance to steal 2–5% of the target's Kowens (at least 1–3, at most MAX_STEAL). Otherwise the Tanod catches
// you: pay the target a fine of half what you tried to take (at least MIN_FINE) and go to jail — so robbing the
// rich is a real gamble, not free money. A Bakod blocks it — unless you have a Master Key: 50% it breaks in
// (then the normal roll), 50% it snaps.
const KEY_CHANCE = 0.5;
const SUCCESS_CHANCE = 0.35;
const MIN_PERCENT = 0.02;
const MAX_PERCENT = 0.05;
const MAX_STEAL = 50;
const MIN_FINE = 2;
const FINE = MIN_FINE; // you need at least this much to try
const FAIL_JAIL_MINUTES = 5;
const MIN_TARGET_BALANCE = 3; // don't pick on people who are nearly broke
const COOLDOWN_MS = 60 * 60_000;

/** How much this attempt goes for: a slice of the target's Kowens, never below 1–3 or above MAX_STEAL. */
function attemptAmount(targetBalance: number): number {
  const base = 1 + Math.floor(Math.random() * 3);
  const scaled = Math.floor(targetBalance * (MIN_PERCENT + Math.random() * (MAX_PERCENT - MIN_PERCENT)));
  return Math.min(MAX_STEAL, Math.max(base, scaled));
}

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

    if (target.id === thief.id) return void (await reply("You can't rob yourself. 🤔"));
    if (target.bot) return void (await reply('The Tanod bot is not afraid of you. 🤖'));

    const wait = lastSteal(thief.id) + COOLDOWN_MS - Date.now();
    if (wait > 0) return void (await reply(`You're laying low. Try again <t:${Math.floor((Date.now() + wait) / 1000)}:R>. 🕶️`));
    if (balance(thief.id) < FINE) return void (await reply(`You need at least **${FINE}** ${kowen(FINE)} to try (in case you get caught). 🪙`));
    if (balance(target.id) < MIN_TARGET_BALANCE) {
      return void (await reply(`${target} only has ${balance(target.id)} ${kowen(balance(target.id))}. Pick on someone richer. 💸`));
    }

    // Checked last, so a Master Key is only used on an attempt that would otherwise go ahead.
    const fence = fencedUntil(target.id);
    let intro = '';
    if (fence) {
      if (masterKeys(thief.id) <= 0) {
        return void (await reply(`🧱 ${target} has a **Bakod**! You can't steal from them until <t:${Math.floor(fence / 1000)}:f>.\n-# A 🗝️ Master Key from \`/redeem\` has a 50% chance to break in.`));
      }
      useMasterKey(thief.id);
      markSteal(thief.id);
      if (Math.random() >= KEY_CHANCE) {
        await interaction.reply({
          content: `🗝️💥 ${thief} tried a **Master Key** on ${target}'s 🧱 Bakod… and the key **snapped**! The Bakod holds. 🔒`,
          allowedMentions: { users: [thief.id, target.id] },
        });
        return;
      }
      intro = `🗝️🔓 ${thief} used a **Master Key** to break through ${target}'s Bakod!\n`;
    }

    if (!fence) markSteal(thief.id);
    let content: string;
    const attempt = attemptAmount(balance(target.id));
    if (Math.random() < SUCCESS_CHANCE) {
      const amount = take(target.id, attempt);
      add(thief.id, amount);
      content = `🥷 ${thief} sneaked into ${target}'s house and stole **${amount}** ${kowen(amount)}! 💰`;
    } else {
      const fine = take(thief.id, Math.max(MIN_FINE, Math.ceil(attempt / 2)));
      add(target.id, fine);
      await jail(thief.id, FAIL_JAIL_MINUTES, `Caught stealing from ${target.username}`);
      content = `🚨 **CAUGHT!** The Tanod caught ${thief} trying to rob ${target}! ${thief} pays ${target} a fine of **${fine}** ${kowen(fine)} and spends **${FAIL_JAIL_MINUTES} minutes** in jail. 🚔`;
    }
    await interaction.reply({ content: intro + content, allowedMentions: { users: [thief.id, target.id] } });
  },
};
