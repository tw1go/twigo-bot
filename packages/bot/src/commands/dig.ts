import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { config } from '../config.js';
import { blockIfJailed } from '../games/jail.js';
import { kowen } from '../kowens.js';
import { RARITY } from '../dig/items.js';
import { digFor, digReveal, isBigFind } from '../dig/dig.js';
import { feed, townName } from '../web/town-feed.js';
import { DIGS_PER_DAY, LUCKY_EVERY, SHOVEL_COST } from '../dig/store.js';

export const dig: Command = {
  data: new SlashCommandBuilder()
    .setName('dig')
    .setDescription(`Dig for treasure with your shovel ⛏️ (${DIGS_PER_DAY} a day) · 🌐 Everyone sees`),
  async execute(interaction) {
    if (await blockIfJailed(interaction)) return;
    const id = interaction.user.id;
    const result = digFor(id);
    if (!result.ok) {
      if (result.reason === 'jailed') return; // blockIfJailed already answered
      await interaction.reply({
        content:
          result.reason === 'bag-full' ? `🎒 Your bag is full (**${result.items}/${result.slots}**)! \`/sell\` something, or get a bigger bag in \`/redeem\`.`
          : result.reason === 'no-shovel' ? `You need a 🪏 **Shovel** to dig! Get one with \`/redeem reward:Shovel\` (${SHOVEL_COST} ${kowen(SHOVEL_COST)}).`
          : `You've dug **${DIGS_PER_DAY}** times today. Your arms need a rest! Come back tomorrow. 💪🌙`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const { item: found, lucky } = result;
    const r = RARITY[found.rarity];
    const big = isBigFind(found);
    const reveal = digReveal(`${interaction.user}`, result);
    // "Digging…" animation, then the reveal. The find is already saved, so a failed edit can't lose it.
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const digging = (bar: string) => `⛏️ ${interaction.user} is digging… ${bar}`;
    const frames = ['🟫', '🟫🟫', '🟫🟫🟫'];
    const suspense: Partial<Record<typeof found.rarity, string[]>> = {
      rare: [`${r.emoji} Something is glowing…`],
      epic: [`${r.emoji} Something is glowing…`, `${r.emoji}${r.emoji} It's getting brighter…`],
      mythical: [`${r.emoji} Something is glowing…`, `${r.emoji}${r.emoji} The ground is shaking…`, `${r.emoji}${r.emoji}${r.emoji} !!!`],
      legendary: [`${r.emoji} Something is glowing…`, `${r.emoji}${r.emoji} The ground is shaking…`, `${r.emoji}${r.emoji}${r.emoji} WAIT WHAT…`, '✨✨✨✨✨'],
      secret: ['🌟 …', '🌟🌟 This isn\'t on any list…', '🌟🌟🌟 THE TANOD DIDN\'T KNOW THIS EXISTED', '✨🌟✨🌟✨🌟✨'],
    };
    const steps = [
      ...frames.map(digging),
      ...(lucky ? [`${digging('🟫🟫🟫')}\n🍀 Wait… this is the server's ${LUCKY_EVERY}th dig!`] : []),
      ...(suspense[found.rarity] ?? []).map((t) => `${digging('🟫🟫🟫')}\n${t}`),
    ];

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
    await interaction.editReply({ content: reveal, allowedMentions: { parse: [] } }).catch((err) => console.error('[dig] reveal failed:', err));
    // The web town's system feed, once revealed here (so it doesn't spoil the suspense).
    feed('dig', `${townName(interaction.user)} dug up ${found.name} (${r.label})`, found.rarity, { userId: id, itemId: found.id, itemName: found.name });

    // Legendary finds are shouted in general too.
    if ((found.rarity === 'legendary' || found.rarity === 'secret') && interaction.channelId !== config.gamesChannelId) {
      const channel = await interaction.client.channels.fetch(config.gamesChannelId).catch(() => null);
      if (channel?.isSendable()) {
        await channel.send({ content: `🟡🏆 ${interaction.user} just dug up **${found.emoji} ${found.name}**!! 🏆🟡`, allowedMentions: { parse: [] } }).catch(() => {});
      }
    }
  },
};
