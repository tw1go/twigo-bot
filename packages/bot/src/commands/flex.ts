import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { kowen } from '../kowens.js';
import { ITEM_BY_ID, type Item, RARITY, type Rarity } from '../dig/items.js';
import { inventory } from '../dig/store.js';

// 💪 Show off an item from your inventory.
const COLORS: Record<Rarity, number> = {
  junk: 0x555555,
  common: 0xbdc3c7,
  uncommon: 0x2ecc71,
  rare: 0x3498db,
  epic: 0x9b59b6,
  mythical: 0xe67e22,
  legendary: 0xf1c40f,
  secret: 0xffffff,
};
const LINES: Record<Rarity, string[]> = {
  junk: [
    'Proudly showing off… this. 🫠',
    "One person's trash is… still trash. But it's *their* trash. 🗑️",
    'Flexing this takes real confidence. 😂',
    'The barangay cleanup crew wants this back. 🧹',
    'Ah yes, the finest garbage money can\'t buy. 💸🗑️',
    'Bro really said "look what I found" 💀',
    'Even the Mosangs aren\'t gossiping about this one. 🤐',
    'Certified basura. Flexed with pride. 🏅',
    'This belongs in a museum. The museum of "why". 🏛️',
    'Main character energy, side quest loot. 🎒',
  ],
  common: [
    'A humble find, flexed with pride. 😌',
    "Not rare, but it's honest work. 🧑‍🌾",
    "Hey, it's something! 🙌",
    'Lola would be proud. Probably. 👵',
    'Pang-display sa sala. 🛋️',
    'Every collection starts somewhere. 📦',
    'Mukhang mahal… pero hindi. 😅',
    'Flexing on a budget. 💯',
    'The Tanod nods politely. 🫡',
    'Ordinary item, extraordinary confidence. 😎',
  ],
  uncommon: [
    'Okay, okay, not bad! 👀',
    'A respectable find. 🫡',
    'The barangay takes note. 📋',
    'Ooh, someone\'s been digging! ⛏️',
    `That's a solid "uy, saan mo nakuha 'yan?" 🤔`,
    'Aling Marites has entered the chat. 🗣️',
    'Small flex, big energy. ⚡',
    'Respect +1. 📈',
    'Your shovel is proud of you. 🪏',
    'Not everyone has this one. Just saying. 💁',
  ],
  rare: [
    "Now THAT'S a find! 🔵✨",
    'The Mosangs are already talking about this. 🗣️',
    'Rare drip. 💧',
    'Somebody call the barangay newsletter. 📰',
    'The jealousy in this server just went up 300%. 📈😤',
    'Pang-flex talaga \'to. 💪',
    "Tito's at the reunion would ask about this. 👨‍👩‍👧",
    'The Tanod raises an eyebrow. 🤨',
    'Lucky shovel or skill? Both. 🍀',
    'Screenshot this before it gets sold. 📸',
  ],
  epic: [
    'EPIC flex incoming! 🟣🔥',
    'The whole server just went quiet. 😳',
    'Somebody frame this. 🖼️',
    'This is the moment you peaked. 🏔️',
    'Shhh… nobody tell the thieves. 🥷🤫',
    'You might want a Bakod after flexing this. 🧱',
    'The barangay hall wants this for the display case. 🏛️',
    'Mosang Marites already posted it in 47 GCs. 📱',
    'Your rizz just leveled up. 😏',
    'They\'re going to write songs about this dig. 🎶',
  ],
  mythical: [
    'A MYTHICAL flex?! 🟠😱',
    'Legends speak of this item. 📜',
    'The Tanod himself salutes. 🫡',
    'The ground is still shaking from that dig. 🌋',
    'Everyone check your inventories. Yours look sad now. 😂',
    'The barangay will remember this day. 📅',
    'This needs a fiesta. 🎉🍖',
    'Even the Mosangs stopped racing to look. 🏁👀',
    'Thieves: *taking notes* 📝🥷',
    'Is this… a flex or a declaration of war? ⚔️',
  ],
  legendary: [
    'A LEGENDARY FLEX!!! 🟡👑',
    'Everyone bow. NOW. 🙇',
    'This is the rarest thing in the barangay. 🏆',
    'The Tanod is calling the news. 📺',
    'Pack it up, everyone. We have a winner. 🏁',
    'History was made today. 📜✨',
    'Your name will be carved on the barangay arch. 🏛️',
    'Nobody else will ever top this flex. Ever. 😤',
    'Somebody give this person a parade. 🎺🥁',
    "Officially the barangay's richest-looking citizen. 💎",
  ],
  secret: [
    '…wait, WHAT is that?! 🌟🌟🌟',
    'Nobody knew this even existed. 🤯',
    'The Tanod is speechless. 🫢',
    'This item is not on any list. How?! 🕵️',
    'Is this… a glitch in the barangay? 👾',
    'The Mosangs have NO idea what this is. And that scares them. 😨',
  ],
};
const COOLDOWN_MS = 60_000;
const lastFlex = new Map<string, number>();

/** How long until the member may flex again (ms; 0 = now). Shared with the town's inventory. */
export const flexWait = (userId: string) => Math.max(0, (lastFlex.get(userId) ?? 0) + COOLDOWN_MS - Date.now());
export const markFlex = (userId: string) => void lastFlex.set(userId, Date.now());

/** The flex card: the item, its rarity and worth, how many they own, and a line for its rarity. */
export function flexEmbed(name: string, avatar: string | undefined, item: Item, owned: number): EmbedBuilder {
  const r = RARITY[item.rarity];
  const lines = LINES[item.rarity];
  return new EmbedBuilder()
    .setColor(COLORS[item.rarity])
    .setAuthor({ name: `${name} is flexing 💪`, iconURL: avatar })
    .setDescription(`# ${item.emoji} ${item.name}\n${r.emoji} **${r.label}** · worth **${item.value}** ${kowen(item.value)}${owned > 1 ? ` · owns **×${owned}**` : ''}\n\n*${lines[Math.floor(Math.random() * lines.length)]}*`)
    .setFooter({ text: 'Dig your own with /dig ⛏️' });
}

export const flex: Command = {
  data: new SlashCommandBuilder()
    .setName('flex')
    .setDescription('Show off an item from your inventory 💪 · 🌐 Everyone sees')
    .addStringOption((o) => o.setName('item').setDescription('Start typing an item name').setRequired(true).setAutocomplete(true)),

  async autocomplete(interaction) {
    const typed = interaction.options.getFocused().toLowerCase();
    const order = ['secret', 'legendary', 'mythical', 'epic', 'rare', 'uncommon', 'common', 'junk'];
    const choices = inventory(interaction.user.id)
      .map(([id, n]) => ({ item: ITEM_BY_ID.get(id)!, n }))
      .filter(({ item }) => item.name.toLowerCase().includes(typed))
      .sort((a, b) => order.indexOf(a.item.rarity) - order.indexOf(b.item.rarity) || b.item.value - a.item.value)
      .slice(0, 25)
      .map(({ item, n }) => ({ name: `${item.name}${n > 1 ? ` ×${n}` : ''} (${RARITY[item.rarity].label})`.slice(0, 100), value: item.id }));
    await interaction.respond(choices);
  },

  async execute(interaction) {
    const me = interaction.user;
    const id = interaction.options.getString('item', true);
    const owned = inventory(me.id).find(([itemId]) => itemId === id)?.[1] ?? 0;
    const item = ITEM_BY_ID.get(id);
    if (!item || !owned) {
      await interaction.reply({ content: "You don't have that item. Check `/inventory`. 🎒", flags: MessageFlags.Ephemeral });
      return;
    }
    const wait = flexWait(me.id);
    if (wait > 0) {
      await interaction.reply({ content: `Easy, show-off 😂 Flex again in ${Math.ceil(wait / 1000)}s.`, flags: MessageFlags.Ephemeral });
      return;
    }
    markFlex(me.id);

    const embed = flexEmbed(me.displayName, me.displayAvatarURL() || undefined, item, owned);
    await interaction.reply({ embeds: [embed] });
  },
};
