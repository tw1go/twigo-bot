import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { markFound } from '../games/found.js';
import type { Command } from '../types.js';
import { config } from '../config.js';
import { blockIfJailed } from '../games/jail.js';
import { kowen } from '../kowens.js';
import { RARITY, rollItem, rollLucky } from '../dig/items.js';
import { feed, townName } from '../web/town-feed.js';
import { useSwerteDig } from '../potions/potions.js';
import { DIGS_PER_DAY, LUCKY_EVERY, SHOVEL_COST, capacity, countServerDig, digsToday, itemCount, recordDig, serverDigProgress, shovelUses } from '../dig/store.js';

export const dig: Command = {
  data: new SlashCommandBuilder()
    .setName('dig')
    .setDescription(`Dig for treasure with your shovel ⛏️ (${DIGS_PER_DAY} a day) · 🌐 Everyone sees`),
  async execute(interaction) {
    if (await blockIfJailed(interaction)) return;
    const id = interaction.user.id;
    const slots = capacity(id);
    if (itemCount(id) >= slots) {
      await interaction.reply({
        content: `🎒 Your bag is full (**${itemCount(id)}/${slots}**)! \`/sell\` something, or get a bigger bag in \`/redeem\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (shovelUses(id) <= 0) {
      await interaction.reply({
        content: `You need a 🪏 **Shovel** to dig! Get one with \`/redeem reward:Shovel\` (${SHOVEL_COST} ${kowen(SHOVEL_COST)}).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (digsToday(id) >= DIGS_PER_DAY) {
      await interaction.reply({ content: `You've dug **${DIGS_PER_DAY}** times today. Your arms need a rest! Come back tomorrow. 💪🌙`, flags: MessageFlags.Ephemeral });
      return;
    }

    const lucky = countServerDig(); // 🍀 every LUCKY_EVERY-th dig on the server is Epic or better
    const swerte = useSwerteDig(id); // 🍀 Swerte Elixir: junk gets one reroll
    const first = rollItem();
    const rolled = swerte && first.rarity === 'junk' ? rollItem() : first;
    // The lucky dig never downgrades a secret find.
    const found = lucky && rolled.rarity !== 'secret' ? rollLucky() : rolled;
    recordDig(id, found.id);
    if (found.rarity === 'secret') markFound(id, 'secret-item');
    const r = RARITY[found.rarity];
    const left = DIGS_PER_DAY - digsToday(id);
    const shovel = shovelUses(id);
    const big = found.rarity === 'mythical' || found.rarity === 'legendary' || found.rarity === 'secret';
    const luckyBanner = lucky ? `🍀✨ **LUCKY DIG!** You hit the server's ${LUCKY_EVERY}th dig, so it's guaranteed Epic or better!\n` : '';

    const lines = [
      luckyBanner +
      (big
        ? `🚨✨ **${r.label.toUpperCase()} FIND!** ✨🚨\n${interaction.user} dug up…\n# ${found.emoji} ${found.name}\n${r.emoji} **${r.label}** · worth **${found.value}** ${kowen(found.value)}`
        : `⛏️ ${interaction.user} dug up…\n## ${found.emoji} ${found.name}\n${r.emoji} ${r.label} · worth **${found.value}** ${kowen(found.value)}`),
      `-# ${left} dig${left === 1 ? '' : 's'} left today · 🪏 ${shovel} use${shovel === 1 ? '' : 's'} left on your shovel${shovel === 0 ? ' — it broke!' : ''} · 🎒 ${itemCount(id)}/${slots} · 🍀 Lucky dig: ${serverDigProgress()}/${LUCKY_EVERY}`,
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
    await interaction.editReply({ content: lines.join('\n'), allowedMentions: { parse: [] } }).catch((err) => console.error('[dig] reveal failed:', err));
    // The web town's system feed, once revealed here (so it doesn't spoil the suspense).
    feed('dig', `${townName(interaction.user)} dug up ${found.name} (${r.label})`, found.rarity);

    // Legendary finds are shouted in general too.
    if ((found.rarity === 'legendary' || found.rarity === 'secret') && interaction.channelId !== config.gamesChannelId) {
      const channel = await interaction.client.channels.fetch(config.gamesChannelId).catch(() => null);
      if (channel?.isSendable()) {
        await channel.send({ content: `🟡🏆 ${interaction.user} just dug up **${found.emoji} ${found.name}**!! 🏆🟡`, allowedMentions: { parse: [] } }).catch(() => {});
      }
    }
  },
};
