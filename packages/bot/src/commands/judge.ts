import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { balance, spend } from '../credits/store.js';
import { botComebacks, botPraises, disses, praises } from '../judge/lines.js';
import { shuffleBag } from '../shuffle-bag.js';
import { onPraiseBot } from '../games/secrets.js';
import { kowen } from '../kowens.js';

// /diss always roasts, /praise always praises, /judge flips a coin. All share the same line rotation.
// Costs 1 credit (see /get-credits); targeting yourself or the bot is free.

const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];

const verdicts = {
  roast: { header: '🔥 **ROASTED**', next: shuffleBag('disses', disses), botLines: botComebacks },
  praise: { header: '💖 **PRAISED**', next: shuffleBag('praises', praises), botLines: botPraises },
};

export type Mode = keyof typeof verdicts | 'random';

/** A verdict from the shared rotation (also the town's player menu): the kind, its header, and the line with {u}
 *  where the target goes. */
export function drawVerdict(mode: Mode): { kind: keyof typeof verdicts; header: string; line: string } {
  const kind = mode === 'random' ? (Math.random() < 0.5 ? 'roast' : 'praise') : mode;
  return { kind, header: verdicts[kind].header, line: verdicts[kind].next() };
}

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
      if (target.id === interaction.client.user.id) {
        line = `${interaction.user} ${pick(verdict.botLines)}`;
        const bonus = kind === 'praise' ? onPraiseBot(interaction.user.id) : null; // 🤫
        if (bonus) footer = `\n${bonus}`;
      }
      else if (target.id === interaction.user.id) line = verdict.next().replace('{u}', `${target}`);
      else {
        if (!spend(interaction.user.id)) {
          await interaction.reply({
            content: `You're out of Kowens! 🪙 Use /get-kowens to claim your daily Kowens.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const left = balance(interaction.user.id);
        line = verdict.next().replace('{u}', `${target}`);
        footer = `\n-# ${interaction.user.username} has ${left} ${kowen(left)} left`;
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

export const diss = verdictCommand('diss', 'Playfully roast someone 🔥 · 🌐 Everyone sees', 'roast');
export const praise = verdictCommand('praise', 'Hype someone up 💖 · 🌐 Everyone sees', 'praise');
export const judge = verdictCommand('judge', 'Let the Tanod decide: roast or praise? 🎲 · 🌐 Everyone sees', 'random');
