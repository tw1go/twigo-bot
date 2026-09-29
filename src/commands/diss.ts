import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';

// {u} is replaced with the target's mention. Keep these playful — no looks, family, or identity.
const disses = [
  '{u}, your ping is higher than your rank. 📶',
  '{u} plays like the tutorial is still on. 🎮',
  '{u}, even the bots in practice mode feel sorry for you. 🤖',
  '{u} brings a spoon to a sword fight. 🥄⚔️',
  '{u}, your K/D ratio is a cry for help. 📉',
  '{u} is the reason the respawn button exists. 🔁',
  '{u}, you\'re not AFK — you just play like it. 💤',
  '{u} has main character energy with side quest results. 🗺️',
  '{u}, your strategy is "hope." It\'s not working. 🙏',
  '{u} would lose a 1v1 against a loading screen. ⏳',
  '{u}, you\'re like a cloud. When you disappear, the day gets better. ☁️',
  '{u} is proof that "carry" is a verb other people do. 🎒',
  '{u}, I\'d roast you harder, but my mom said not to burn trash. 🔥🗑️',
  '{u} sets alarms for Mine Wars and still shows up late. ⏰',
  '{u}, you have the reflexes of a sleeping tanod. 😴',
  '{u} types "gg" before the match even starts. Respect the confidence, not the skill. 🫡',
  '{u}, your Wi-Fi isn\'t the problem. You are. 📡',
  '{u} is the human version of a participation trophy. 🏅',
  '{u}, you\'re not useless — you can always serve as a bad example. 📚',
  '{u} studies the meta and still picks wrong. 📖',
];

const selfDisses = [
  'Roasting yourself? Respect. But the bot has already done it for you: you picked yourself. 💀',
  'Self-diss unlocked. Honestly, no notes. 🪞',
];

const botComebacks = [
  'Nice try. I run 24/7 on a free server and I still have better uptime than you. 😎',
  'You tried to diss the bot. The bot is not impressed. 🤖',
];

const COOLDOWN_MS = 30_000;
const lastUsed = new Map<string, number>();
const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];

export const diss: Command = {
  data: new SlashCommandBuilder()
    .setName('diss')
    .setDescription('Playfully roast someone')
    .addUserOption((o) => o.setName('user').setDescription('Who to roast').setRequired(true)),
  async execute(interaction) {
    const wait = (lastUsed.get(interaction.user.id) ?? 0) + COOLDOWN_MS - Date.now();
    if (wait > 0) {
      await interaction.reply({
        content: `Cool down! You can diss again in ${Math.ceil(wait / 1000)}s. 🧊`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    lastUsed.set(interaction.user.id, Date.now());

    const target = interaction.options.getUser('user', true);
    let content: string;
    if (target.id === interaction.client.user.id) content = `${interaction.user} ${pick(botComebacks)}`;
    else if (target.id === interaction.user.id) content = `${interaction.user} ${pick(selfDisses)}`;
    else content = pick(disses).replace('{u}', `${target}`);

    await interaction.reply({ content, allowedMentions: { users: [target.id, interaction.user.id] } });
  },
};
