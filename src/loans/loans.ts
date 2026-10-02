import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { EmbedBuilder, type Client } from 'discord.js';
import { config } from '../config.js';
import { add, balance, setGarnishHook, take } from '../credits/store.js';
import { jail } from '../games/jail.js';
import { kowen } from '../kowens.js';

// 🏦 Loans. The Tanod Bank or another member lends Kowens; the borrower owes the loan + INTEREST, due in DUE_DAYS.
// Once a loan is OVERDUE, GARNISH of everything they earn goes to the lender automatically. Overdue loans add a late fee each
// day (with a threatening public "text message" in general), and after DEFAULT_AFTER_DAYS overdue the borrower defaults: their balance is
// seized toward the debt, they get utang jail (no bail) and a blacklist. Bank repayments are removed from the economy.
export const INTEREST = 0.1;
export const DUE_DAYS = 3;
export const GARNISH = 0.5;
export const LATE_FEE = 0.1; // of the original loan, per overdue day
export const DEFAULT_AFTER_DAYS = 3; // overdue days before default
export const UTANG_JAIL_MINUTES = 60;
export const BLACKLIST_DAYS = 30;
export const BANK_BASE_LIMIT = 20;
export const BANK_STEP = 10; // limit grows per on-time repayment
export const BANK_MAX_LIMIT = 100;
export const P2P_MAX = 50;
export const P2P_MAX_OUT = 3; // active loans a member can have lent out
const DAY_MS = 86_400_000;
export const BANK = 'bank';

export interface Loan {
  id: string;
  lender: string; // BANK or a member id
  borrower: string;
  principal: number;
  owed: number; // what's left to pay, including interest and fees
  created: number;
  due: number;
  lateDays: number; // late fees applied so far
  status: 'active' | 'paid' | 'defaulted';
}

interface State {
  loans: Record<string, Loan>;
  onTime: Record<string, number>; // userId -> loans repaid on time
  blacklistUntil: Record<string, number>;
}
const DIR = 'data';
const FILE = `${DIR}/loans.json`;
const state: State = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { loans: {}, onTime: {}, blacklistUntil: {} };
function save(): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(state, null, 2));
}

/** The borrower's open debt (active, or defaulted but not yet paid off). */
export const debtOf = (userId: string) =>
  Object.values(state.loans).find((l) => l.borrower === userId && (l.status === 'active' || l.status === 'defaulted') && l.owed > 0);
export const inDebt = (userId: string) => !!debtOf(userId);
export const lentOut = (userId: string) => Object.values(state.loans).filter((l) => l.lender === userId && l.status !== 'paid' && l.owed > 0);
export const blacklistedUntil = (userId: string) => ((state.blacklistUntil[userId] ?? 0) > Date.now() ? state.blacklistUntil[userId] : null);
export const bankLimit = (userId: string) => (blacklistedUntil(userId) ? 0 : Math.min(BANK_MAX_LIMIT, BANK_BASE_LIMIT + BANK_STEP * (state.onTime[userId] ?? 0)));
export const owedWithInterest = (principal: number) => Math.ceil(principal * (1 + INTEREST));

/** Hands out a loan: borrower gets `principal` (never garnished), owes principal + interest. */
export function createLoan(lender: string, borrower: string, principal: number): Loan {
  const loan: Loan = {
    id: randomBytes(4).toString('hex'),
    lender,
    borrower,
    principal,
    owed: owedWithInterest(principal),
    created: Date.now(),
    due: Date.now() + DUE_DAYS * DAY_MS,
    lateDays: 0,
    status: 'active',
  };
  state.loans[loan.id] = loan;
  save();
  if (lender !== BANK) take(lender, principal);
  add(borrower, principal, { garnish: false });
  return loan;
}

/** Applies a payment the borrower has already handed over. Pays the lender (bank payments vanish). */
function applyPayment(loan: Loan, amount: number): void {
  const paid = Math.min(amount, loan.owed);
  if (paid <= 0) return;
  loan.owed -= paid;
  if (loan.lender !== BANK) add(loan.lender, paid); // lender's own debts may garnish this, which is fine
  if (loan.owed <= 0) {
    if (loan.status === 'active' && Date.now() <= loan.due) state.onTime[loan.borrower] = (state.onTime[loan.borrower] ?? 0) + 1;
    loan.status = 'paid';
  }
  save();
}

/** /loan pay: pays up to `amount` (default: all owed) from the borrower's balance. Returns what was paid. */
export function payLoan(userId: string, amount?: number): { paid: number; loan: Loan } | null {
  const loan = debtOf(userId);
  if (!loan) return null;
  const want = Math.min(amount ?? loan.owed, loan.owed);
  const paid = take(userId, want);
  applyPayment(loan, paid);
  return { paid, loan };
}

/** Past the due date (or defaulted): only then are earnings garnished. */
export const isOverdue = (loan: Loan) => loan.status === 'defaulted' || Date.now() > loan.due;

// Garnish: once overdue, part of every earning goes to the lender. Before the due date, borrowers keep what they earn.
setGarnishHook((userId, earned) => {
  const loan = debtOf(userId);
  if (!loan || !isOverdue(loan)) return;
  const share = Math.min(loan.owed, Math.max(1, Math.floor(earned * GARNISH)));
  applyPayment(loan, take(userId, share));
});

// ── 📱 "SMS" from the lender ──
const bankSms = [
  'Good day! This is TANOD BANK. Your utang of {owed} Kowens is OVERDUE. Settle now or we will settle it in the BARANGAY HALL. 📋',
  'CONGRATULATIONS! You have been selected for a FREE barangay hearing 🎉 Just pay {owed} Kowens and we\'ll cancel it. Reply STOP to be visited in person.',
  'Ma\'am/Sir, kumusta po? 😊 Paalala lang po, {owed} Kowens po ang utang ninyo. Alam po namin kung saan kayo nakatira. 🏠',
  'URGENT: Your Kowen account will be FROZEN 🥶 unless you pay {owed} Kowens. Click here: totally-not-a-scam.tanod 🔗',
  'TANOD BANK: Hello! We noticed you have {owed} Kowens of utang. We also noticed your tsinelas outside. Nice tsinelas. Would be a shame. 🩴',
  'Final Notice from TANOD BANK 📢 Pay {owed} Kowens or your name goes on the barangay bulletin board. In Comic Sans. 😱',
  'Hi this is the Tanod. Not threatening you, just reminding you that I know the way to your house. {owed} Kowens po. 🫡',
  'Your utang of {owed} Kowens has been forwarded to Aling Marites. The whole barangay will know by lunch. 🗣️',
];
const memberSms = [
  'Hoy. {owed} Kowens. Sa barangay tayo magkita kung hindi mo babayaran. 😤 — {lender}',
  'Hello! You have won a free trip to the BARANGAY HALL 🎉 Claim it by not paying me {owed} Kowens. — {lender}',
  'Bes, bayad na? 🥺 {owed} Kowens lang. Hindi ako galit. Pa. 🙂🔪 — {lender}',
  'Good evening! This is {lender} from the Department of Utang 🏛️ Your balance of {owed} Kowens is overdue. Kindly settle before we "settle" it. 👊',
  'Seen 9:42 PM. I know you saw this. {owed} Kowens. — {lender} 👀',
  'Pa-reply naman. Sabi mo babayaran mo ako "bukas". Ilang bukas na ba? 📅 {owed} Kowens. — {lender}',
  'Reminder lang po! {owed} Kowens. Sasabihin ko kay Aling Marites kung hindi ka magbabayad. 🗣️ — {lender}',
  'I told the Tanod. The Tanod told the Mosangs. The Mosangs told EVERYONE. Pay {owed} Kowens. — {lender}',
];
const fill = (t: string, loan: Loan, lenderName: string) => t.replaceAll('{owed}', String(loan.owed)).replaceAll('{lender}', lenderName);

/** Posts a public "text message" from the lender to the borrower in general, styled like a phone notification. */
async function sms(client: Client, loan: Loan, title: string): Promise<void> {
  const channel = await client.channels.fetch(config.gamesChannelId).catch(() => null);
  if (!channel?.isSendable()) return;
  const lenderName = loan.lender === BANK ? 'TANOD BANK 🏦' : ((await client.users.fetch(loan.lender).catch(() => null))?.displayName ?? 'Unknown number');
  const pool = loan.lender === BANK ? bankSms : memberSms;
  const text = fill(pool[Math.floor(Math.random() * pool.length)], loan, lenderName);
  const time = new Date().toLocaleTimeString('en-US', { timeZone: config.timezone, hour: 'numeric', minute: '2-digit' });
  const bubble = new EmbedBuilder()
    .setColor(0x34c759) // phone-message green
    .setAuthor({ name: `📱 Message · ${lenderName}` })
    .setDescription(`💬 ${text}`)
    .setFooter({ text: `${time} · ${title}` });
  await channel
    .send({ content: `📲 <@${loan.borrower}> you have **1 new message**`, embeds: [bubble], allowedMentions: { users: [loan.borrower] } })
    .catch(() => {});
}

/** Hourly: late fees and SMS for overdue loans, then default after DEFAULT_AFTER_DAYS overdue. */
export async function processLoans(client: Client): Promise<void> {
  const now = Date.now();
  for (const loan of Object.values(state.loans)) {
    if (loan.status !== 'active' || loan.owed <= 0 || now <= loan.due) continue;
    const overdueDays = Math.floor((now - loan.due) / DAY_MS) + 1; // day 1 starts right after the due time
    if (overdueDays > DEFAULT_AFTER_DAYS) {
      // Default: seize what they have, utang jail, blacklist. Any remaining debt stays and keeps being garnished.
      loan.status = 'defaulted';
      save();
      const owedAtDefault = loan.owed;
      const seized = take(loan.borrower, Math.min(balance(loan.borrower), loan.owed));
      applyPayment(loan, seized);
      await jail(loan.borrower, UTANG_JAIL_MINUTES, 'Utang (defaulted on a loan)', false);
      state.blacklistUntil[loan.borrower] = now + BLACKLIST_DAYS * DAY_MS;
      save();
      const left = loan.owed > 0 ? ` · still owing ${loan.owed} ${kowen(loan.owed)}` : '';
      await sms(client, { ...loan, owed: owedAtDefault }, `⛔ DEFAULTED · seized ${seized} ${kowen(seized)} · 🚔 ${UTANG_JAIL_MINUTES} min utang jail · blacklisted ${BLACKLIST_DAYS} days${left}`);
      continue;
    }
    if (overdueDays > loan.lateDays) {
      const fee = Math.ceil(loan.principal * LATE_FEE) * (overdueDays - loan.lateDays);
      loan.owed += fee;
      loan.lateDays = overdueDays;
      save();
      await sms(client, loan, `⚠️ Overdue day ${overdueDays}/${DEFAULT_AFTER_DAYS} · late fee +${fee} · now owing ${loan.owed} ${kowen(loan.owed)}`);
    }
  }
}

// ── Member-to-member offers (button flow lives in the command) ──
interface Offer {
  lender: string;
  borrower: string;
  amount: number;
  until: number;
}
const offers = new Map<string, Offer>();
export const OFFER_MS = 10 * 60_000;
export function createOffer(lender: string, borrower: string, amount: number): string {
  const id = randomBytes(4).toString('hex');
  offers.set(id, { lender, borrower, amount, until: Date.now() + OFFER_MS });
  return id;
}
export function takeOffer(id: string): Offer | null {
  const offer = offers.get(id);
  offers.delete(id);
  return offer && offer.until > Date.now() ? offer : null;
}
export const peekOffer = (id: string) => offers.get(id);
