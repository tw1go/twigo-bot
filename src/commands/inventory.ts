import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { kowen } from '../kowens.js';
import { POTIONS, ownedPotions } from '../potions/potions.js';
import { ITEM_BY_ID, RARITY, RARITY_ORDER } from '../dig/items.js';
import { DIGS_PER_DAY, MAX_SLOTS, capacity, digsToday, inventory as itemsOf, itemCount, masterKeys, shovelUses } from '../dig/store.js';

export const inventory: Command = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('See what you\'ve dug up 🎒 · 🔒 Only you see')
    .addUserOption((o) => o.setName('user').setDescription('Whose inventory (default: you)')),
  async execute(interaction) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    const owned = itemsOf(target.id).map(([id, n]) => ({ item: ITEM_BY_ID.get(id)!, n }));
    const worth = owned.reduce((sum, { item, n }) => sum + item.value * n, 0);

    const embed = new EmbedBuilder()
      .setColor(0x8e6e53)
      .setAuthor({ name: `${target.displayName}'s inventory`, iconURL: target.displayAvatarURL() || undefined })
      .setDescription(
        `🎒 Slots: **${itemCount(target.id)}/${capacity(target.id)}**${capacity(target.id) < MAX_SLOTS ? ' (bigger bags in `/redeem`)' : ' (max!)'}\n` +
          `🪏 Shovel: **${shovelUses(target.id)}** use(s) left · ⛏️ Digs today: **${digsToday(target.id)}/${DIGS_PER_DAY}** · 🗝️ Master Keys: **${masterKeys(target.id)}**\n` +
          `💰 Total worth: **${worth} ${kowen(worth)}**` +
          (ownedPotions(target.id).length ? `\n🧪 Potions: ${ownedPotions(target.id).map(([pid, n]) => `${POTIONS[pid].emoji}×${n}`).join(' ')} · \`/potion use\`` : ''),
      );

    for (const rarity of RARITY_ORDER) {
      const group = owned.filter(({ item }) => item.rarity === rarity).sort((a, b) => b.item.value - a.item.value);
      if (!group.length) continue;
      const r = RARITY[rarity];
      const value = group.map(({ item, n }) => `${item.emoji} ${item.name}${n > 1 ? ` ×${n}` : ''} · ${item.value} each`).join('\n');
      embed.addFields({ name: `${r.emoji} ${r.label}`, value: value.length > 1024 ? value.slice(0, 1000) + '\n…' : value });
    }
    if (!owned.length) embed.addFields({ name: 'Empty', value: '_Nothing yet. Grab a 🪏 Shovel from `/redeem` and `/dig`!_' });
    embed.setFooter({ text: 'Sell items with /sell' });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
