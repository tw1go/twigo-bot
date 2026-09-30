import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { config } from '../config.js';
import { addFence, balance, fencedUntil, take } from '../credits/store.js';
import { FENCE_DAYS, FENCE_MAX_DAYS, GAME_NAME, recordRedemption, rewards } from '../games/rewards.js';
import { kowen } from '../kowens.js';

const fmt = (n: number) => n.toLocaleString('en-US');

export const redeem: Command = {
  data: new SlashCommandBuilder()
    .setName('redeem')
    .setDescription(`Trade Kowens for a Bakod or ${GAME_NAME} passes 🎁 · 🔒 list · 🌐 redeeming`)
    .addStringOption((o) =>
      o
        .setName('reward')
        .setDescription('What to redeem')
        .addChoices(...rewards.map((r) => ({ name: `${r.name} — ${fmt(r.cost)} ${kowen(r.cost)}`, value: r.id }))),
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
              const note = r.kind === 'fence' ? ` — blocks /steal for ${FENCE_DAYS} days` : ` — ${GAME_NAME}`;
              return `${r.emoji} **${r.name}**${note} · **${fmt(r.cost)}** ${kowen(r.cost)} ${have >= r.cost ? '✅' : `(${fmt(r.cost - have)} to go)`}`;
            })
            .join('\n') + (fencedUntil(interaction.user.id) ? `\n\n🧱 Your Bakod is up until <t:${Math.floor(fencedUntil(interaction.user.id)! / 1000)}:f>.` : ''),
        )
        .setFooter({ text: `You have ${fmt(have)} ${kowen(have)}. Use /redeem reward:<name> to redeem.` });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const reward = rewards.find((r) => r.id === choice)!;
    if (have < reward.cost) {
      await interaction.reply({
        content: `You need **${fmt(reward.cost)}** ${kowen(reward.cost)} for the ${reward.emoji} **${reward.name}**, but you have **${fmt(have)}**. Keep grinding! 💪`,
        flags: MessageFlags.Ephemeral,
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
