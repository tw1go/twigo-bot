import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { config } from '../config.js';
import { balance, take } from '../credits/store.js';
import { GAME_NAME, recordRedemption, rewards } from '../games/rewards.js';

const fmt = (n: number) => n.toLocaleString('en-US');

export const redeem: Command = {
  data: new SlashCommandBuilder()
    .setName('redeem')
    .setDescription(`Trade your credits for ${GAME_NAME} passes 🎁 (leave empty to see the list)`)
    .addStringOption((o) =>
      o
        .setName('reward')
        .setDescription('What to redeem')
        .addChoices(...rewards.map((r) => ({ name: `${r.name} — ${fmt(r.cost)} credits`, value: r.id }))),
    ),
  async execute(interaction) {
    const have = balance(interaction.user.id);
    const choice = interaction.options.getString('reward');

    if (!choice) {
      const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle(`🎁 Rewards — ${GAME_NAME}`)
        .setDescription(
          rewards
            .map((r) => `${r.emoji} **${r.name}** — ${fmt(r.cost)} credits ${have >= r.cost ? '✅' : `(${fmt(r.cost - have)} to go)`}`)
            .join('\n'),
        )
        .setFooter({ text: `You have ${fmt(have)} credits. Use /redeem reward:<name> to redeem.` });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const reward = rewards.find((r) => r.id === choice)!;
    if (have < reward.cost) {
      await interaction.reply({
        content: `You need **${fmt(reward.cost)}** credits for the ${reward.emoji} **${reward.name}**, but you have **${fmt(have)}**. Keep grinding! 💪`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    take(interaction.user.id, reward.cost);
    recordRedemption(interaction.user.id, reward.id, reward.cost);
    console.log(`[redeem] ${interaction.user.id} redeemed ${reward.id} for ${reward.cost}`);
    await interaction.reply({
      content:
        `🎉 ${interaction.user} redeemed the ${reward.emoji} **${GAME_NAME} ${reward.name}** for **${fmt(reward.cost)}** credits!\n` +
        `<@${config.rewardOwnerId}> — please send it over. 🫡`,
      allowedMentions: { users: [config.rewardOwnerId] },
    });
  },
};
