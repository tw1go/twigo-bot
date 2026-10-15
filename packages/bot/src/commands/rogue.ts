import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { jailedUntil } from '../games/jail.js';
import { ROGUE_MARK_MS, isRogue, markedUntil, rogueState, turnRogue } from '../games/rogue.js';
import { feed, townName } from '../web/town-feed.js';

// /rogue join | quit | status: only rogues can steal (games/rogue.ts). Joining is free (not while in jail) and ends your
// protection; quitting is free any time, and you stay marked until 2 days after your last steal. Ephemeral, except
// join's short public line. The neighbourhood's house menu does the same (POST /town/rogue).

const days = Math.round(ROGUE_MARK_MS / 86_400_000);
const ts = (ms: number, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;

/** What a member's state means, in a line. */
export function rogueStatusLine(userId: string): string {
  const state = rogueState(userId);
  const rogue = isRogue(userId);
  const until = markedUntil(userId);
  const role = rogue ? '🎭 You are a **rogue**: you can steal.' : 'You are **not a rogue**: you can\'t steal (`/rogue join`).';
  const now =
    state === 'protected' ? '🌙 **Protected**: you were robbed, so rogues can\'t touch you.'
    : state === 'marked' ? `🎭 **Marked**: rogues can rob you.${until ? ` Until ${ts(until)}.` : ' For as long as you\'re a rogue, and 2 days after your last steal.'}`
    : rogue ? '**Open**: rogues can rob you. Being a rogue, a robbery never protects you.'
    : '**Open**: rogues can rob you once, then you\'re protected.';
  return `${role}\n${now}`;
}

export const rogue: Command = {
  data: new SlashCommandBuilder()
    .setName('rogue')
    .setDescription('Become a 🎭 rogue to steal, or quit · 🔒 Only you see')
    .addSubcommand((s) => s.setName('join').setDescription('Become a rogue: you can steal, and lose your protection'))
    .addSubcommand((s) => s.setName('quit').setDescription(`Stop being a rogue (you stay marked ${days} days after your last steal)`))
    .addSubcommand((s) => s.setName('status').setDescription('Are you a rogue, open, protected or marked?')),

  async execute(interaction) {
    const me = interaction.user;
    const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();
    if (sub === 'status') return void (await reply(rogueStatusLine(me.id)));
    const on = sub === 'join';
    const r = turnRogue(me.id, on, jailedUntil(me.id));
    if (!r.ok) {
      if (r.reason === 'jailed') return void (await reply(`🚔 You're in jail until ${ts(r.until, 't')}. You can become a rogue once you're out.`));
      return void (await reply(on ? "You're a rogue already. 🎭" : "You're not a rogue. 🙂"));
    }
    if (on) {
      feed('steal', `${townName(me)} became a rogue`, 'lose');
      await interaction.reply({ content: `🎭 ${me} became a **rogue**! Their house is fair game for other rogues once they steal.`, allowedMentions: { parse: [] } });
      return;
    }
    feed('steal', `${townName(me)} quit being a rogue`, 'shop');
    const until = markedUntil(me.id);
    await reply(`You quit being a rogue. ${until ? `You stay **marked** until ${ts(until, 'f')} (2 days after your last steal): rogues can still rob you till then.` : "You're **open** again."}`);
  },
};
