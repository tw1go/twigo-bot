import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { halveFence, fencedUntil } from '../credits/store.js';
import { feed, townName } from '../web/town-feed.js';
import { POTIONS, POTION_IDS, drink, hintsLeft, ownedPotions, swerteLeft, tagoUntil, usePotion, type PotionId } from '../potions/potions.js';

const ts = (ms: number, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;

export const potion: Command = {
  data: new SlashCommandBuilder()
    .setName('potion')
    .setDescription('Use a sari-sari potion (or drink one from your bag in the town) 🧪')
    .addSubcommand((s) =>
      s
        .setName('use')
        .setDescription('Drink or throw a potion')
        .addStringOption((o) =>
          o
            .setName('potion')
            .setDescription('Which potion')
            .setRequired(true)
            .addChoices(...POTION_IDS.map((id) => ({ name: `${POTIONS[id].name} — ${POTIONS[id].effect}`.slice(0, 100), value: id }))),
        )
        .addUserOption((o) => o.setName('target').setDescription('Kalawang Potion only: whose Bakod to rust')),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Your potions and active effects · 🔒 Only you see')),

  async execute(interaction) {
    const me = interaction.user;
    const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

    if (interaction.options.getSubcommand() === 'list') {
      const owned = ownedPotions(me.id);
      const tago = tagoUntil(me.id);
      const effects = [tago ? `🫥 Tago Tonic: hidden until ${ts(tago, 't')} (${ts(tago)})` : '', swerteLeft(me.id) ? `🍀 Swerte Elixir: ${swerteLeft(me.id)} lucky dig(s) left` : ''].filter(Boolean);
      const embed = new EmbedBuilder()
        .setColor(0x8e44ad)
        .setTitle('🧪 Your potions')
        .addFields(
          { name: 'Potions', value: owned.length ? owned.map(([id, n]) => `${POTIONS[id].emoji} **${POTIONS[id].name}** ×${n}`).join('\n') : "_None. Buy some in `/redeem` or at the town's sari-sari store._" },
          { name: 'Active effects', value: effects.join('\n') || '_None_' },
          { name: '🍵 Marites hints', value: `${hintsLeft(me.id)} left to hear` },
        );
      return void (await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }));
    }

    const id = interaction.options.getString('potion', true) as PotionId;
    const p = POTIONS[id];
    const target = interaction.options.getUser('target');

    // The drinks (drink(): checked, then used up); the Kalawang Potion is thrown, checked before it's used up.
    if (id !== 'kalawang') {
      const r = drink(me.id, id);
      if (!r.ok) {
        return void (await reply(r.reason === 'no-hints' ? '🍵 Aling Marites has already told you everything she knows. 🤐' : `You don't have a ${p.emoji} **${p.name}**. Get one in \`/redeem\` or at the town's sari-sari store.`));
      }
      if (r.id === 'tago') return void (await reply(`🫥 You drank a **Tago Tonic**. The Tanod can't see you gamble until ${ts(r.until, 't')} (${ts(r.until)}). 0% bust chance! 🤫`));
      if (r.id === 'swerte') return void (await reply(`🍀 You drank a **Swerte Elixir**! Your next **${r.digs}** dig(s): any junk gets rerolled. ⛏️✨`));
      return void (await reply(`🍵 *Aling Marites leans in close…*\n> ${r.hint}\n-# ${r.left} more chismis left to hear. Don't tell anyone 🤫`));
    }
    if (!target) return void (await reply('Who are you throwing it at? Add `target:@someone`. 🧪'));
    if (target.id === me.id) return void (await reply("Rusting your own Bakod? That's… a choice. 😅 Pick someone else."));
    if (!fencedUntil(target.id)) return void (await reply(`${target} doesn't have a 🧱 Bakod to rust.`));
    if (!usePotion(me.id, id)) return void (await reply(`You don't have a ${p.emoji} **${p.name}**. Get one in \`/redeem\` or at the town's sari-sari store.`));
    const until = halveFence(target.id)!;
    feed('steal', `${townName(me)} rusted ${townName(target)}'s Bakod with a Kalawang Potion`, 'lose'); // the web town's system feed
    await interaction.reply({
      content: `🧪💥 ${me} threw a **Kalawang Potion** at ${target}'s 🧱 Bakod! Half of it rusted away 🟫\n-# Their Bakod now ends ${ts(until)}.`,
      allowedMentions: { users: [target.id] },
    });
  },
};
