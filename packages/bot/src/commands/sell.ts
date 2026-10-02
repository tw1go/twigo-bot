import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { add } from '../credits/store.js';
import { kowen } from '../kowens.js';
import { ITEM_BY_ID, RARITY } from '../dig/items.js';
import { inventory, removeItems } from '../dig/store.js';

const EVERYTHING = '__everything__';
const JUNK_AND_COMMON = '__junk_common__';

export const sell: Command = {
  data: new SlashCommandBuilder()
    .setName('sell')
    .setDescription('Sell items from your inventory for Kowens 💰 · 🔒 Only you see')
    .addStringOption((o) => o.setName('item').setDescription('Start typing an item name').setRequired(true).setAutocomplete(true))
    .addIntegerOption((o) => o.setName('quantity').setDescription('How many (default 1)').setMinValue(1)),

  async autocomplete(interaction) {
    const typed = interaction.options.getFocused().toLowerCase();
    const owned = inventory(interaction.user.id)
      .map(([id, n]) => ({ item: ITEM_BY_ID.get(id)!, n }))
      .filter(({ item }) => item.name.toLowerCase().includes(typed))
      .sort((a, b) => b.item.value - a.item.value)
      .map(({ item, n }) => ({ name: `${item.name} ×${n} — ${item.value} ${kowen(item.value)} each (${RARITY[item.rarity].label})`.slice(0, 100), value: item.id }));
    const bulk = [
      { name: '💰 Everything', value: EVERYTHING },
      { name: '🧹 All Junk & Common items', value: JUNK_AND_COMMON },
    ].filter((c) => c.name.toLowerCase().includes(typed) || !typed);
    await interaction.respond([...bulk, ...owned].slice(0, 25));
  },

  async execute(interaction) {
    const choice = interaction.options.getString('item', true);
    const quantity = interaction.options.getInteger('quantity') ?? 1;
    const owned = inventory(interaction.user.id);

    let targets: [string, number][];
    if (choice === EVERYTHING) targets = owned;
    else if (choice === JUNK_AND_COMMON) targets = owned.filter(([id]) => ['junk', 'common'].includes(ITEM_BY_ID.get(id)!.rarity));
    else {
      const have = owned.find(([id]) => id === choice)?.[1] ?? 0;
      if (!ITEM_BY_ID.has(choice) || !have) {
        await interaction.reply({ content: "You don't have that item. Check `/inventory`. 🎒", flags: MessageFlags.Ephemeral });
        return;
      }
      targets = [[choice, Math.min(quantity, have)]];
    }
    if (!targets.length) {
      await interaction.reply({ content: 'Nothing to sell. 🎒', flags: MessageFlags.Ephemeral });
      return;
    }

    let earned = 0;
    const lines: string[] = [];
    for (const [id, n] of targets) {
      const item = ITEM_BY_ID.get(id)!;
      const sold = removeItems(interaction.user.id, id, n);
      earned += sold * item.value;
      lines.push(`${item.emoji} ${item.name}${sold > 1 ? ` ×${sold}` : ''} → ${sold * item.value}`);
    }
    const balance = add(interaction.user.id, earned);
    const shown = lines.length > 15 ? [...lines.slice(0, 15), `…and ${lines.length - 15} more`] : lines;
    await interaction.reply({
      content: `💰 Sold for **${earned} ${kowen(earned)}**!\n${shown.join('\n')}\n-# You now have ${balance} ${kowen(balance)}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
