import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { balance, fencedUntil, hasVault } from '../credits/store.js';
import { BAG_SLOTS, FENCE_DAYS, FENCE_MAX_DAYS, GAME_NAME, rewards } from '../games/rewards.js';
import { redeemFeed, redeemPost, redeemReward, stackable } from '../games/redeem.js';
import { townName } from '../web/town-feed.js';
import { kowen } from '../kowens.js';
import { POTIONS, type PotionId } from '../potions/potions.js';
import { SHOVELS_PER_DAY, SHOVEL_USES, ownedBags } from '../dig/store.js';

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
              const note = r.kind === 'fence' ? ` — blocks /steal for ${FENCE_DAYS} days` : r.kind === 'shovel' ? ` — ${SHOVEL_USES} digs, up to ${SHOVELS_PER_DAY} a day` : r.kind === 'key' ? ' — 50% chance to break through a Bakod on /steal' : r.kind === 'vault' ? ` — store up to 30% of your Kowens, safe from /steal & bail${hasVault(interaction.user.id) ? ' (owned ✅)' : ''}` : r.kind === 'potion' ? ` — ${POTIONS[r.id.replace('potion-', '') as PotionId].effect}` : r.kind === 'bag' ? ` — +${BAG_SLOTS} inventory slots${ownedBags(interaction.user.id).includes(r.id) ? ' (owned ✅)' : ''}` : ` — ${GAME_NAME}`;
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
    const result = redeemReward(interaction.user.id, reward, asked);
    const deny = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

    if (!result.ok) {
      switch (result.reason) {
        case 'quantity':
          return void (await deny(`Quantity only works for the 🪏 **Shovel**, 🗝️ **Master Key** and 🧪 potions. The ${reward.emoji} **${reward.name}** is one at a time.`));
        case 'loan':
          return void (await deny("💳 You can't redeem passes while you have a loan. Pay it off first with `/loan pay`."));
        case 'owned':
          return void (await deny(reward.kind === 'vault'
            ? 'You already have a 🔐 **Vault**. Use `/vault` to store Kowens. 🪙'
            : `You already have the ${reward.emoji} **${reward.name}**. Each bag can only be bought once. 🎒`));
        case 'shovels-today':
          return void (await deny(`🪏 You already bought **${SHOVELS_PER_DAY}** Shovels today. The hardware store opens again tomorrow! 🌙`));
        case 'kowens':
          return void (await deny(
            `You need **${fmt(result.total)}** ${kowen(result.total)} for ${result.quantity > 1 ? `${result.quantity}× ` : 'the '}${reward.emoji} **${reward.name}**, but you have **${fmt(result.have)}**.` +
              (stackable(reward) && result.canAfford > 0 ? ` You can afford **${result.canAfford}**.` : ' Keep grinding! 💪'),
          ));
        case 'marites':
          return void (await deny('🍵 Aling Marites has already told you everything she knows. 🤐'));
        case 'fence-max':
          return void (await deny(`🧱 Your Bakod already lasts until <t:${Math.floor(result.until / 1000)}:f> — the max is ${FENCE_MAX_DAYS} days. Come back later!`));
      }
    }

    redeemFeed(townName(interaction.user), result);
    await interaction.reply(redeemPost(interaction.user.id, result));
  },
};
