import type { Client } from 'discord.js';
import type { TownBankAction, TownBankActionResponse, TownBankResponse } from '@mikazuki/shared';
import { config } from '../config.js';
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
import {
  BANK,
  DUE_DAYS,
  GARNISH,
  INTEREST,
  bankLimit,
  blacklistedUntil,
  createLoan,
  debtOf,
  isOverdue,
  lentOut,
  payLoan,
} from '../loans/loans.js';

// 🏦 The town's bank (GET/POST /town/bank): the wallet, the vault (deposit, withdraw) and loans (borrow from the
// Tanod Bank, pay back) — the same rules and stores as /vault and /loan. Borrowing is public, like /loan take: it's
// posted in the games channel (no pings). Offering loans to members stays in Discord.

/** A member's name in the town (nickname, else Discord name). */
type NameOf = (id: string) => Promise<string>;

const pct = (n: number) => `${Math.round(n * 100)}%`;
const kowens = (n: number) => `${n} ${kowen(n)}`;

export async function townBank(userId: string, nameOf: NameOf): Promise<TownBankResponse> {
  const debt = debtOf(userId);
  return {
    wallet: balance(userId),
    vault: hasVault(userId) ? { inside: vaultBalance(userId), capacity: vaultCapacity(userId), minWithdraw: vaultMinWithdraw(userId) } : null,
    vaultPrice: VAULT_PRICE,
    vaultCap: VAULT_CAP,
    vaultMinWithdraw: VAULT_MIN_WITHDRAW,
    loan: !debt ? null : {
      owed: debt.owed,
      lender: debt.lender === BANK ? 'Tanod Bank' : await nameOf(debt.lender),
      due: debt.due,
      overdue: isOverdue(debt),
      defaulted: debt.status === 'defaulted',
    },
    bank: { limit: bankLimit(userId), blacklistedUntil: blacklistedUntil(userId), interest: INTEREST, dueDays: DUE_DAYS, garnish: GARNISH },
    lent: await Promise.all(
      lentOut(userId).map(async (l) => ({ name: await nameOf(l.borrower), owed: l.owed, due: l.due, defaulted: l.status === 'defaulted' })),
    ),
  };
}

/** Does one bank action; `amount` is required except to repay (then: everything owed). */
export async function bankAction(
  client: Client,
  userId: string,
  action: TownBankAction,
  amount: number | undefined,
  nameOf: NameOf,
): Promise<TownBankActionResponse> {
  const result = async (ok: boolean, message: string) => ({ ...(await townBank(userId, nameOf)), ok, message });

  if (action === 'deposit' || action === 'withdraw') {
    if (!hasVault(userId)) return result(false, `You don't have a vault yet. Get one with /redeem reward:Vault in Discord (${kowens(VAULT_PRICE)}).`);
    if (!amount) return result(false, 'How many Kowens?');
    if (action === 'deposit') {
      const res = vaultDeposit(userId, amount);
      if (!res.ok) {
        return result(false,
          res.reason === 'balance' ? `You only have ${kowens(balance(userId))} in your wallet.`
          : res.room ? `Your vault can only take ${kowens(res.room)} more right now (up to ${pct(VAULT_CAP)} of everything you own).`
          : `Your vault is full (up to ${pct(VAULT_CAP)} of everything you own).`);
      }
      return result(true, `Stored ${kowens(amount)} in your vault.`);
    }
    const res = vaultWithdraw(userId, amount);
    if (!res.ok) {
      const inside = vaultBalance(userId);
      return result(false,
        res.reason === 'empty' ? 'Your vault is empty.'
        : res.reason === 'max' ? `Your vault only has ${kowens(inside)}.`
        : `Take out at least ${kowens(vaultMinWithdraw(userId))} (${pct(VAULT_MIN_WITHDRAW)} of the ${inside} inside).`);
    }
    return result(true, `Took ${kowens(amount)} out of your vault.`);
  }

  if (action === 'borrow') {
    if (!amount) return result(false, 'How many Kowens?');
    const debt = debtOf(userId);
    if (debt) return result(false, `You already owe ${kowens(debt.owed)}. Pay it back first.`);
    const black = blacklistedUntil(userId);
    if (black) return result(false, "The Tanod Bank won't lend to you for now: you defaulted on a loan.");
    const limit = bankLimit(userId);
    if (amount > limit) return result(false, `The Tanod Bank will lend you up to ${kowens(limit)} right now. Repay on time to raise it.`);
    const loan = createLoan(BANK, userId, amount);
    const channel = await client.channels.fetch(config.gamesChannelId).catch(() => null);
    if (channel?.isSendable()) {
      await channel
        .send({
          content: `🏦 <@${userId}> borrowed **${amount}** ${kowen(amount)} from the **Tanod Bank** in the town!\n-# Owes **${loan.owed}** (+${pct(INTEREST)}) by <t:${Math.floor(loan.due / 1000)}:f>. If it's late, ${pct(GARNISH)} of their earnings go to the bank until it's paid.`,
          allowedMentions: { parse: [] },
        })
        .catch((err) => console.error('[web] bank post failed:', err));
    }
    return result(true, `Borrowed ${kowens(amount)}. You owe ${kowens(loan.owed)}, due in ${DUE_DAYS} days.`);
  }

  // repay
  if (!debtOf(userId)) return result(false, "You don't owe anything.");
  const res = payLoan(userId, amount)!;
  if (res.paid === 0) return result(false, `You have no Kowens in your wallet to pay with. You owe ${kowens(res.loan.owed)}.`);
  return result(true, res.loan.owed <= 0 ? `Paid ${kowens(res.paid)}. Your loan is fully paid!` : `Paid ${kowens(res.paid)}. You still owe ${kowens(res.loan.owed)}.`);
}
