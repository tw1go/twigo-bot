import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { config } from '../config.js';
import { blockIfJailed } from '../games/jail.js';
import { kowen } from '../kowens.js';
import { RARITY, rollItem } from '../dig/items.js';
import { DIGS_PER_DAY, SHOVEL_COST, digsToday, recordDig, shovelUses } from '../dig/store.js';

export const dig: Command = {
  data: new SlashCommandBuilder()
    .setName('dig')
    .setDescription(`Dig for treasure with your shovel ⛏️ (${DIGS_PER_DAY} a day) · 🌐 Everyone sees`),
  async execute(interaction) {
    if (await blockIfJailed(interaction)) return;
    const id = interaction.user.id;
    if (shovelUses(id) <= 0) {
      await interaction.reply({
        content: `You need a 🪓 **Shovel** to dig! Get one with \`/redeem reward:Shovel\` (${SHOVEL_COST} ${kowen(SHOVEL_COST)}).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (digsToday(id) >= DIGS_PER_DAY) {
      await interaction.reply({ content: `You've dug **${DIGS_PER_DAY}** times today. Your arms need a rest! Come back tomorrow. 💪🌙`, flags: MessageFlags.Ephemeral });
      return;
    }

    const found = rollItem();
    recordDig(id, found.id);
    const r = RARITY[found.rarity];
    const left = DIGS_PER_DAY - digsToday(id);
    const shovel = shovelUses(id);
    const big = found.rarity === 'mythical' || found.rarity === 'legendary';

    const lines = [
      big
        ? `🚨✨ **${r.label.toUpperCase()} FIND!** ✨🚨\n${interaction.user} dug up **${found.emoji} ${found.name}**! (${r.emoji} ${r.label} · worth **${found.value}** ${kowen(found.value)})`
        : `⛏️ ${interaction.user} dug up **${found.emoji} ${found.name}**!\n${r.emoji} ${r.label} · worth **${found.value}** ${kowen(found.value)}`,
      `-# ${left} dig${left === 1 ? '' : 's'} left today · 🪓 ${shovel} use${shovel === 1 ? '' : 's'} left on your shovel${shovel === 0 ? ' — it broke!' : ''}`,
    ];
    // "Digging…" animation, then the reveal. The find is already saved, so a failed edit can't lose it.
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const digging = (bar: string) => `⛏️ ${interaction.user} is digging… ${bar}`;
    const frames = ['🟫', '🟫🟫', '🟫🟫🟫'];
    const suspense: Partial<Record<typeof found.rarity, string[]>> = {
      rare: [`${r.emoji} Something is glowing…`],
      epic: [`${r.emoji} Something is glowing…`, `${r.emoji}${r.emoji} It's getting brighter…`],
      mythical: [`${r.emoji} Something is glowing…`, `${r.emoji}${r.emoji} The ground is shaking…`, `${r.emoji}${r.emoji}${r.emoji} !!!`],
      legendary: [`${r.emoji} Something is glowing…`, `${r.emoji}${r.emoji} The ground is shaking…`, `${r.emoji}${r.emoji}${r.emoji} WAIT WHAT…`, '✨✨✨✨✨'],
    };
    const steps = [...frames.map(digging), ...(suspense[found.rarity] ?? []).map((t) => `${digging('🟫🟫🟫')}\n${t}`)];

    await interaction.reply({ content: steps[0], allowedMentions: { parse: [] } });
    try {
      for (const step of steps.slice(1)) {
        await sleep(900);
        await interaction.editReply({ content: step, allowedMentions: { parse: [] } });
      }
      await sleep(big ? 1500 : 900);
    } catch (err) {
      console.error('[dig] animation failed:', err);
    }
    await interaction.editReply({ content: lines.join('\n'), allowedMentions: { parse: [] } }).catch((err) => console.error('[dig] reveal failed:', err));

    // Legendary finds are shouted in general too.
    if (found.rarity === 'legendary' && interaction.channelId !== config.gamesChannelId) {
      const channel = await interaction.client.channels.fetch(config.gamesChannelId).catch(() => null);
      if (channel?.isSendable()) {
        await channel.send({ content: `🟡🏆 ${interaction.user} just dug up **${found.emoji} ${found.name}**!! 🏆🟡`, allowedMentions: { parse: [] } }).catch(() => {});
      }
    }
  },
};
