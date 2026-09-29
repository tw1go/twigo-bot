import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { balance, spend } from '../credits/store.js';
import { botComebacks, botPraises, disses, praises } from '../judge/lines.js';

// /diss always roasts, /praise always praises, /judge flips a coin. All share the same line rotation.
// Costs 1 credit (see /get-credits); targeting yourself or the bot is free.

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

const verdicts = {
  roast: { header: '🔥 **ROASTED**', next: shuffleBag(disses), botLines: botComebacks },
  praise: { header: '💖 **PRAISED**', next: shuffleBag(praises), botLines: botPraises },
};

type Mode = keyof typeof verdicts | 'random';

function verdictCommand(name: string, description: string, mode: Mode): Command {
  return {
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription(description)
      .addUserOption((o) => o.setName('user').setDescription('Who to target (leave empty for yourself)')),
    async execute(interaction) {
      const target = interaction.options.getUser('user') ?? interaction.user;
      const kind = mode === 'random' ? (Math.random() < 0.5 ? 'roast' : 'praise') : mode;
      const verdict = verdicts[kind];

      let line: string;
      let footer = '';
      if (target.id === interaction.client.user.id) line = `${interaction.user} ${pick(verdict.botLines)}`;
      else if (target.id === interaction.user.id) line = verdict.next().replace('{u}', `${target}`);
      else {
        if (!spend(interaction.user.id)) {
          await interaction.reply({
            content: `You're out of credits! 🪙 Use /get-credits to claim your daily credits.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const left = balance(interaction.user.id);
        line = verdict.next().replace('{u}', `${target}`);
        footer = `\n-# ${interaction.user.username} has ${left} credit${left === 1 ? '' : 's'} left`;
      }

      const header = mode === 'random' ? `🎲 The Tanod has judged ${target}...\n${verdict.header}\n` : '';
      await interaction.reply({
        content: `${header}${line}${footer}`,
        // Discord rejects duplicate IDs here (self-target case).
        allowedMentions: { users: [...new Set([target.id, interaction.user.id])] },
      });
    },
  };
}

export const diss = verdictCommand('diss', 'Playfully roast someone 🔥', 'roast');
export const praise = verdictCommand('praise', 'Hype someone up 💖', 'praise');
export const judge = verdictCommand('judge', 'Let the Tanod decide: roast or praise? 🎲', 'random');
