import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { config } from '../config.js';
import { addFence, balance, fencedUntil, take } from '../credits/store.js';
import { BAG_SLOTS, FENCE_DAYS, FENCE_MAX_DAYS, GAME_NAME, recordRedemption, rewards } from '../games/rewards.js';
import { kowen } from '../kowens.js';
import { debtOf } from '../loans/loans.js';
import { SHOVELS_PER_DAY, SHOVEL_USES, addBag, addMasterKey, addShovel, capacity, ownedBags, shovelsBoughtToday } from '../dig/store.js';

const fmt = (n: number) => n.toLocaleString('en-US');
const MAX_KEYS_AT_ONCE = 10;

export const redeem: Command = {
  data: new SlashCommandBuilder()
    .setName('redeem')
    .setDescription(`Trade Kowens for a Bakod or ${GAME_NAME} passes 🎁 · 🔒 list · 🌐 redeeming`)
    .addStringOption((o) =>
      o
        .setName('reward')
        .setDescription('What to redeem')
        .addChoices(...rewards.map((r) => ({ name: `${r.name} — ${fmt(r.cost)} ${kowen(r.cost)}`, value: r.id }))),
    )
    .addIntegerOption((o) =>
      o.setName('quantity').setDescription(`How many (Shovels: up to ${SHOVELS_PER_DAY}/day · Master Keys: up to ${MAX_KEYS_AT_ONCE})`).setMinValue(1).setMaxValue(MAX_KEYS_AT_ONCE),
    ),
  async execute(interaction) {
    const have = balance(interaction.user.id);
    const choice = interaction.options.getString('reward');

    if (!choice) {
      const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle('🎁 Rewards')
        .setDescription(
          rewards
            .map((r) => {
              const note = r.kind === 'fence' ? ` — blocks /steal for ${FENCE_DAYS} days` : r.kind === 'shovel' ? ` — ${SHOVEL_USES} digs, up to ${SHOVELS_PER_DAY} a day` : r.kind === 'key' ? ' — 50% chance to break through a Bakod on /steal' : r.kind === 'bag' ? ` — +${BAG_SLOTS} inventory slots${ownedBags(interaction.user.id).includes(r.id) ? ' (owned ✅)' : ''}` : ` — ${GAME_NAME}`;
              return `${r.emoji} **${r.name}**${note} · **${fmt(r.cost)}** ${kowen(r.cost)} ${have >= r.cost ? '✅' : `(${fmt(r.cost - have)} to go)`}`;
            })
            .join('\n') + (fencedUntil(interaction.user.id) ? `\n\n🧱 Your Bakod is up until <t:${Math.floor(fencedUntil(interaction.user.id)! / 1000)}:f>.` : ''),
        )
        .setFooter({ text: `You have ${fmt(have)} ${kowen(have)}. Use /redeem reward:<name> to redeem.` });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const reward = rewards.find((r) => r.id === choice)!;
    const asked = interaction.options.getInteger('quantity') ?? 1;
    const stackable = reward.kind === 'shovel' || reward.kind === 'key';
    if (asked > 1 && !stackable) {
      await interaction.reply({ content: `Quantity only works for the 🪏 **Shovel** and 🗝️ **Master Key**. The ${reward.emoji} **${reward.name}** is one at a time.`, flags: MessageFlags.Ephemeral });
      return;
    }
    if (reward.kind === 'pass' && debtOf(interaction.user.id)) {
      await interaction.reply({ content: "💳 You can't redeem passes while you have a loan. Pay it off first with `/loan pay`.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (reward.kind === 'bag' && ownedBags(interaction.user.id).includes(reward.id)) {
      await interaction.reply({ content: `You already have the ${reward.emoji} **${reward.name}**. Each bag can only be bought once. 🎒`, flags: MessageFlags.Ephemeral });
      return;
    }

    // How many can actually be bought: Shovels are limited per day.
    let quantity = asked;
    if (reward.kind === 'shovel') {
      const left = SHOVELS_PER_DAY - shovelsBoughtToday(interaction.user.id);
      if (left <= 0) {
        await interaction.reply({ content: `🪏 You already bought **${SHOVELS_PER_DAY}** Shovels today. The hardware store opens again tomorrow! 🌙`, flags: MessageFlags.Ephemeral });
        return;
      }
      quantity = Math.min(asked, left);
    }
    const total = reward.cost * quantity;
    if (have < total) {
      const canAfford = Math.floor(have / reward.cost);
      await interaction.reply({
        content:
          `You need **${fmt(total)}** ${kowen(total)} for ${quantity > 1 ? `${quantity}× ` : 'the '}${reward.emoji} **${reward.name}**, but you have **${fmt(have)}**.` +
          (stackable && canAfford > 0 ? ` You can afford **${canAfford}**.` : ' Keep grinding! 💪'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (reward.kind === 'key') {
      take(interaction.user.id, total);
      let keys = 0;
      for (let i = 0; i < quantity; i++) keys = addMasterKey(interaction.user.id);
      await interaction.reply({
        content: `🗝️ ${interaction.user} bought ${quantity > 1 ? `**${quantity} Master Keys**` : 'a **Master Key**'}… no Bakod is safe now 👀\n-# You have ${keys} key${keys === 1 ? '' : 's'}. A key is only used when you /steal from someone with a Bakod (50% to break in).`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (reward.kind === 'shovel') {
      take(interaction.user.id, total);
      let uses = 0;
      for (let i = 0; i < quantity; i++) uses = addShovel(interaction.user.id);
      const capped = quantity < asked ? ` (you asked for ${asked}, but only ${quantity} more ${quantity === 1 ? 'was' : 'were'} available today)` : '';
      await interaction.reply({
        content: `🪏 ${interaction.user} bought ${quantity > 1 ? `**${quantity} Shovels**` : 'a **Shovel**'}${capped}! Time to \`/dig\` for treasure ⛏️\n-# ${uses} dig${uses === 1 ? '' : 's'} on your shovel · ${SHOVELS_PER_DAY - shovelsBoughtToday(interaction.user.id)} more shovel(s) available today.`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (reward.kind === 'bag') {
      take(interaction.user.id, reward.cost);
      addBag(interaction.user.id, reward.id);
      const slots = capacity(interaction.user.id);
      await interaction.reply({
        content: `${reward.emoji} ${interaction.user} got a **${reward.name}**! Inventory is now **${slots}** slots. 🎒`,
        allowedMentions: { parse: [] },
      });
      return;
    }


    if (reward.kind === 'fence') {
      const current = fencedUntil(interaction.user.id);
      if (current && current - Date.now() > (FENCE_MAX_DAYS - FENCE_DAYS) * 86_400_000) {
        await interaction.reply({
          content: `🧱 Your Bakod already lasts until <t:${Math.floor(current / 1000)}:f> — the max is ${FENCE_MAX_DAYS} days. Come back later!`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      take(interaction.user.id, reward.cost);
      const until = addFence(interaction.user.id, FENCE_DAYS * 86_400_000, FENCE_MAX_DAYS * 86_400_000);
      await interaction.reply({
        content: `🧱 ${interaction.user} built a **Bakod**! Nobody can steal from them until <t:${Math.floor(until / 1000)}:f>. 🛡️`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    take(interaction.user.id, reward.cost);
    recordRedemption(interaction.user.id, reward.id, reward.cost);
    console.log(`[redeem] ${interaction.user.id} redeemed ${reward.id} for ${reward.cost}`);
    await interaction.reply({
      content:
        `🎉 ${interaction.user} redeemed the ${reward.emoji} **${GAME_NAME} ${reward.name}** for **${fmt(reward.cost)}** ${kowen(reward.cost)}!\n` +
        `<@${config.rewardOwnerId}> — please send it over. 🫡`,
      allowedMentions: { users: [config.rewardOwnerId] },
    });
  },
};
