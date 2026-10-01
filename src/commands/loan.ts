import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, SlashCommandBuilder, type ButtonInteraction } from 'discord.js';
import type { Command } from '../types.js';
import { balance } from '../credits/store.js';
import { kowen } from '../kowens.js';
import {
  BANK,
  DUE_DAYS,
  GARNISH,
  INTEREST,
  OFFER_MS,
  P2P_MAX,
  P2P_MAX_OUT,
  bankLimit,
  blacklistedUntil,
  createLoan,
  createOffer,
  debtOf,
  lentOut,
  owedWithInterest,
  payLoan,
  peekOffer,
  takeOffer,
} from '../loans/loans.js';

const PREFIX = 'loanoffer:';
const ts = (ms: number, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

export const loan: Command = {
  data: new SlashCommandBuilder()
    .setName('loan')
    .setDescription(`Borrow or lend Kowens 🏦 (+${pct(INTEREST)} interest, due in ${DUE_DAYS} days)`)
    .addSubcommand((s) =>
      s
        .setName('take')
        .setDescription('Borrow from the Tanod Bank 🏦 · 🌐 Everyone sees')
        .addIntegerOption((o) => o.setName('amount').setDescription('How many Kowens to borrow').setRequired(true).setMinValue(1).setMaxValue(100)),
    )
    .addSubcommand((s) =>
      s
        .setName('offer')
        .setDescription(`Offer a loan to a member (max ${P2P_MAX}) · 🌐 Everyone sees`)
        .addUserOption((o) => o.setName('user').setDescription('Who to lend to').setRequired(true))
        .addIntegerOption((o) => o.setName('amount').setDescription(`How many Kowens (1–${P2P_MAX})`).setRequired(true).setMinValue(1).setMaxValue(P2P_MAX)),
    )
    .addSubcommand((s) =>
      s
        .setName('pay')
        .setDescription('Pay back your loan (leave empty to pay it all) · 🔒 Only you see')
        .addIntegerOption((o) => o.setName('amount').setDescription('How many Kowens to pay').setMinValue(1)),
    )
    .addSubcommand((s) => s.setName('status').setDescription('Your loan, what you lent out, and your bank limit · 🔒 Only you see')),

  async execute(interaction) {
    const me = interaction.user.id;
    const sub = interaction.options.getSubcommand();
    const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    const debt = debtOf(me);
    const black = blacklistedUntil(me);

    if (sub === 'take') {
      const amount = interaction.options.getInteger('amount', true);
      if (debt) return void (await reply(`You already owe **${debt.owed}** ${kowen(debt.owed)}. Pay it back first with \`/loan pay\`. 💳`));
      if (black) return void (await reply(`🚫 The Tanod Bank won't lend to you until ${ts(black, 'f')} (you defaulted on a loan).`));
      const limit = bankLimit(me);
      if (amount > limit) return void (await reply(`The Tanod Bank will lend you up to **${limit}** ${kowen(limit)} right now. Repay loans on time to raise it. 📈`));
      const l = createLoan(BANK, me, amount);
      await interaction.reply({
        content: `🏦 ${interaction.user} borrowed **${amount}** ${kowen(amount)} from the **Tanod Bank**!\n-# Owes **${l.owed}** (+${pct(INTEREST)}) by ${ts(l.due, 'f')}. ${pct(GARNISH)} of their earnings go to the bank until it's paid.`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (sub === 'offer') {
      const target = interaction.options.getUser('user', true);
      const amount = interaction.options.getInteger('amount', true);
      if (target.id === me) return void (await reply("You can't lend to yourself. 🤔"));
      if (target.bot) return void (await reply("Bots don't borrow Kowens. 🤖"));
      if (debt) return void (await reply("You can't lend while you're in debt yourself. Pay your loan first. 💳"));
      if (lentOut(me).length >= P2P_MAX_OUT) return void (await reply(`You already have **${P2P_MAX_OUT}** loans out. Wait for them to be repaid. 📋`));
      if (balance(me) < amount) return void (await reply(`You only have **${balance(me)}** ${kowen(balance(me))}. 🪙`));
      if (debtOf(target.id)) return void (await reply(`${target} already has a loan to pay off. 💳`));
      if (blacklistedUntil(target.id)) return void (await reply(`${target} is blacklisted from borrowing (defaulted on a loan). 🚫`));

      const id = createOffer(me, target.id, amount);
      const owed = owedWithInterest(amount);
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}${id}:accept`).setLabel(`Accept ${amount}`).setEmoji('🤝').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${PREFIX}${id}:decline`).setLabel('Decline').setStyle(ButtonStyle.Secondary),
      );
      await interaction.reply({
        content: `💸 ${target}, ${interaction.user} is offering you a loan of **${amount}** ${kowen(amount)}!\n-# You'd owe **${owed}** (+${pct(INTEREST)}) in ${DUE_DAYS} days, and ${pct(GARNISH)} of your earnings go to them until it's paid. Offer expires ${ts(Date.now() + OFFER_MS)}.`,
        components: [row],
        allowedMentions: { users: [target.id] },
      });
      return;
    }

    if (sub === 'pay') {
      if (!debt) return void (await reply("You don't owe anything. ✅"));
      const amount = interaction.options.getInteger('amount') ?? undefined;
      const res = payLoan(me, amount)!;
      if (res.paid === 0) return void (await reply(`You don't have any Kowens to pay with. You owe **${res.loan.owed}**. 🪙`));
      await reply(
        res.loan.owed <= 0
          ? `✅ Paid **${res.paid}** ${kowen(res.paid)}. Your loan is **fully paid**! 🎉`
          : `💳 Paid **${res.paid}** ${kowen(res.paid)}. You still owe **${res.loan.owed}**, due ${ts(res.loan.due)}.`,
      );
      return;
    }

    // status
    const out = lentOut(me);
    const embed = new EmbedBuilder()
      .setColor(0x1abc9c)
      .setTitle('🏦 Your loans')
      .addFields(
        {
          name: '💳 You owe',
          value: debt
            ? `**${debt.owed}** ${kowen(debt.owed)} to ${debt.lender === BANK ? '🏦 the Tanod Bank' : `<@${debt.lender}>`}\n` +
              (debt.status === 'defaulted' ? '⛔ **Defaulted.** Earnings are still garnished until it\'s paid' : `Due ${ts(debt.due, 'f')} (${ts(debt.due)})`) +
              `\n-# ${pct(GARNISH)} of your earnings go to your lender until it's paid · \`/loan pay\` to pay faster`
            : '✅ Nothing',
        },
        {
          name: `📤 You lent out (${out.length}/${P2P_MAX_OUT})`,
          value: out.length ? out.map((l) => `<@${l.borrower}> owes **${l.owed}** · ${l.status === 'defaulted' ? '⛔ defaulted' : `due ${ts(l.due)}`}`).join('\n') : '_No active loans_',
        },
        { name: '🏦 Tanod Bank limit', value: black ? `🚫 Blacklisted until ${ts(black, 'f')}` : `Up to **${bankLimit(me)}** ${kowen(bankLimit(me))} · repay on time to raise it` },
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  },
};

export const isLoanButton = (customId: string) => customId.startsWith(PREFIX);

export async function handleLoanButton(interaction: ButtonInteraction): Promise<void> {
  const [id, action] = interaction.customId.slice(PREFIX.length).split(':');
  const offer = peekOffer(id);
  const deny = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
  if (!offer) return void (await interaction.update({ content: '⌛ This loan offer expired.', components: [] }));
  if (interaction.user.id !== offer.borrower && !(action === 'decline' && interaction.user.id === offer.lender)) {
    return void (await deny('This offer isn\'t for you. 🙅'));
  }
  takeOffer(id);
  if (action === 'decline') {
    return void (await interaction.update({ content: `❌ Loan offer of **${offer.amount}** ${kowen(offer.amount)} was declined.`, components: [], allowedMentions: { parse: [] } }));
  }
  // Re-check everything at accept time.
  if (Date.now() > offer.until) return void (await interaction.update({ content: '⌛ This loan offer expired.', components: [] }));
  if (debtOf(offer.borrower)) return void (await interaction.update({ content: '💳 Already has a loan to pay off. Offer cancelled.', components: [] }));
  if (debtOf(offer.lender) || balance(offer.lender) < offer.amount || lentOut(offer.lender).length >= P2P_MAX_OUT) {
    return void (await interaction.update({ content: "The lender can't cover this loan anymore. Offer cancelled. 💸", components: [] }));
  }
  const l = createLoan(offer.lender, offer.borrower, offer.amount);
  await interaction.update({
    content: `🤝 <@${offer.borrower}> borrowed **${offer.amount}** ${kowen(offer.amount)} from <@${offer.lender}>!\n-# Owes **${l.owed}** by ${ts(l.due, 'f')}.`,
    components: [],
    allowedMentions: { users: [offer.lender] },
  });
}
