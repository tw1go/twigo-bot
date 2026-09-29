import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { balance, spend } from '../credits/store.js';

// Shared by /diss and /praise: pick a line for @user. Costs 1 credit (see /get-credits); targeting yourself or the bot is free.
// Lines use {u} for the target's mention.
interface ShoutoutOptions {
  name: string;
  description: string;
  userDescription: string;
  lines: string[];
  botLines: string[];
}

const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];

/** Every line is used once before any repeats. */
function shuffleBag(items: string[]): () => string {
  let bag: string[] = [];
  return () => {
    if (bag.length === 0) {
      bag = [...items];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    }
    return bag.pop()!;
  };
}

export function shoutoutCommand(opts: ShoutoutOptions): Command {
  const next = shuffleBag(opts.lines);

  return {
    data: new SlashCommandBuilder()
      .setName(opts.name)
      .setDescription(opts.description)
      .addUserOption((o) => o.setName('user').setDescription(opts.userDescription).setRequired(true)),
    async execute(interaction) {
      const target = interaction.options.getUser('user', true);
      let content: string;
      if (target.id === interaction.client.user.id) content = `${interaction.user} ${pick(opts.botLines)}`;
      else if (target.id === interaction.user.id) content = next().replace('{u}', `${target}`);
      else {
        if (!spend(interaction.user.id)) {
          await interaction.reply({
            content: `You're out of credits! 🪙 Use /get-credits to claim your daily credits.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const left = balance(interaction.user.id);
        content = `${next().replace('{u}', `${target}`)}\n-# ${interaction.user.username} has ${left} credit${left === 1 ? '' : 's'} left`;
      }

      await interaction.reply({ content, allowedMentions: { users: [...new Set([target.id, interaction.user.id])] } });
    },
  };
}
