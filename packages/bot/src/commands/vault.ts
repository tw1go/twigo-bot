import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import {
  VAULT_CAP,
  VAULT_MIN_WITHDRAW,
  VAULT_PRICE,
  balance,
  hasVault,
  vaultBalance,
  vaultCapacity,
  vaultDeposit,
  vaultMinWithdraw,
  vaultWithdraw,
} from '../credits/store.js';
import { kowen } from '../kowens.js';

const pct = (n: number) => `${Math.round(n * 100)}%`;

export const vault: Command = {
  data: new SlashCommandBuilder()
    .setName('vault')
    .setDescription(`Your 🔐 Vault: Kowens inside are safe from /steal & bail · 🔒 Only you see`)
    .addSubcommand((s) =>
      s
        .setName('deposit')
        .setDescription(`Store Kowens (up to ${pct(VAULT_CAP)} of everything you own)`)
        .addIntegerOption((o) => o.setName('amount').setDescription('How many Kowens to store').setRequired(true).setMinValue(1)),
    )
    .addSubcommand((s) =>
      s
        .setName('withdraw')
        .setDescription(`Take Kowens out (at least ${pct(VAULT_MIN_WITHDRAW)} of what's inside)`)
        .addIntegerOption((o) => o.setName('amount').setDescription('How many Kowens to take out').setRequired(true).setMinValue(1)),
    )
    .addSubcommand((s) => s.setName('view').setDescription("See what's in your vault")),

  async execute(interaction) {
    const me = interaction.user.id;
    const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    if (!hasVault(me)) return void (await reply(`You don't have a 🔐 **Vault** yet. Get one with \`/redeem reward:Vault\` (${VAULT_PRICE} Kowens).`));

    const sub = interaction.options.getSubcommand();
    if (sub === 'deposit') {
      const amount = interaction.options.getInteger('amount', true);
      const res = vaultDeposit(me, amount);
      if (!res.ok) {
        return void (await reply(
          res.reason === 'balance'
            ? `You only have **${balance(me)}** ${kowen(balance(me))} in your wallet. 🪙`
            : res.room
              ? `Your vault can only take **${res.room}** more ${kowen(res.room)} right now (max ${pct(VAULT_CAP)} of everything you own). 🔐`
              : `Your vault is full (max ${pct(VAULT_CAP)} of everything you own). 🔐`,
        ));
      }
      return void (await reply(`🔐 Stored **${amount}** ${kowen(amount)}. Vault: **${vaultBalance(me)}** · Wallet: **${balance(me)}**`));
    }

    if (sub === 'withdraw') {
      const amount = interaction.options.getInteger('amount', true);
      const res = vaultWithdraw(me, amount);
      if (!res.ok) {
        const inside = vaultBalance(me);
        return void (await reply(
          res.reason === 'empty'
            ? 'Your vault is empty. 🔐'
            : res.reason === 'max'
              ? `Your vault only has **${inside}** ${kowen(inside)}. 🔐`
              : `You have to take out at least **${vaultMinWithdraw(me)}** (${pct(VAULT_MIN_WITHDRAW)} of the **${inside}** inside). 🔐`,
        ));
      }
      return void (await reply(`💰 Took out **${amount}** ${kowen(amount)}. Vault: **${vaultBalance(me)}** · Wallet: **${balance(me)}**`));
    }

    // view
    const inside = vaultBalance(me);
    const cap = vaultCapacity(me);
    const embed = new EmbedBuilder()
      .setColor(0x34495e)
      .setTitle('🔐 Your Vault')
      .setDescription(`## 🪙 ${inside} ${kowen(inside)} inside`)
      .addFields(
        { name: 'Room', value: `Can hold up to **${cap}** right now (${pct(VAULT_CAP)} of your **${balance(me) + inside}** total) · **${Math.max(0, cap - inside)}** more fits`, inline: false },
        { name: 'Withdraw', value: inside ? `At least **${vaultMinWithdraw(me)}**, up to **${inside}**` : '_Nothing to withdraw_', inline: false },
        { name: 'Protects from', value: '🥷 `/steal` (thieves only see your wallet) · 💸 bail (based on your wallet)\n-# Not protected: inactivity decay and loan defaults.' },
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
