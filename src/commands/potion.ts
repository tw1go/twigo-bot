import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { halveFence, fencedUntil } from '../credits/store.js';
import { POTIONS, POTION_IDS, hintsLeft, nextHint, ownedPotions, startSwerte, startTago, swerteLeft, tagoUntil, usePotion, type PotionId } from '../potions/potions.js';

const ts = (ms: number, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;

export const potion: Command = {
  data: new SlashCommandBuilder()
    .setName('potion')
    .setDescription('Use a potion from /redeem 🧪')
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
          { name: 'Potions', value: owned.length ? owned.map(([id, n]) => `${POTIONS[id].emoji} **${POTIONS[id].name}** ×${n}`).join('\n') : '_None. Buy some in `/redeem`._' },
          { name: 'Active effects', value: effects.join('\n') || '_None_' },
          { name: '🍵 Marites hints', value: `${hintsLeft(me.id)} left to hear` },
        );
      return void (await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }));
    }

    const id = interaction.options.getString('potion', true) as PotionId;
    const p = POTIONS[id];
    const target = interaction.options.getUser('target');

    // Check everything before using up the potion.
    if (id === 'kalawang') {
      if (!target) return void (await reply('Who are you throwing it at? Add `target:@someone`. 🧪'));
      if (target.id === me.id) return void (await reply("Rusting your own Bakod? That's… a choice. 😅 Pick someone else."));
      if (!fencedUntil(target.id)) return void (await reply(`${target} doesn't have a 🧱 Bakod to rust.`));
    }
    if (id === 'marites' && hintsLeft(me.id) <= 0) return void (await reply('🍵 Aling Marites has already told you everything she knows. 🤐'));
    if (!usePotion(me.id, id)) return void (await reply(`You don't have a ${p.emoji} **${p.name}**. Get one in \`/redeem\`.`));

    if (id === 'kalawang') {
      const until = halveFence(target!.id)!;
      await interaction.reply({
        content: `🧪💥 ${me} threw a **Kalawang Potion** at ${target}'s 🧱 Bakod! Half of it rusted away 🟫\n-# Their Bakod now ends ${ts(until)}.`,
        allowedMentions: { users: [target!.id] },
      });
      return;
    }
    if (id === 'tago') {
      const until = startTago(me.id);
      return void (await reply(`🫥 You drank a **Tago Tonic**. The Tanod can't see you gamble until ${ts(until, 't')} (${ts(until)}). 0% bust chance! 🤫`));
    }
    if (id === 'swerte') {
      const left = startSwerte(me.id);
      return void (await reply(`🍀 You drank a **Swerte Elixir**! Your next **${left}** dig(s): any junk gets rerolled. ⛏️✨`));
    }
    // marites
    const hint = nextHint(me.id)!;
    await reply(`🍵 *Aling Marites leans in close…*\n> ${hint}\n-# ${hintsLeft(me.id)} more chismis left to hear. Don't tell anyone 🤫`);
  },
};
