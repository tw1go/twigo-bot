import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import { config } from '../config.js';
import { add } from '../credits/store.js';
import { kowen } from '../kowens.js';
import { DATA_DIR } from '../paths.js';

// Gifter panel for the 9 PM Mine Wars payout (Institute Walkway 07 server only): pick who attended and who made the Top 10, then confirm.
// Attendance = ATTEND_REWARD, Top 10 = TOP_REWARD total. A ledger per night prevents double payouts and
// lets a later run upgrade someone from attendance to Top 10 (only the difference is paid).
export const ATTEND_REWARD = 2;
export const TOP_REWARD = 3;
export const MW_SERVER = 'Institute Walkway 07';
const PREFIX = 'mwpay:';
const SESSION_MS = 14 * 60_000; // Discord interaction tokens last 15 minutes

const DIR = DATA_DIR;
const FILE = `${DIR}/minewars-payouts.json`;
let ledger: Record<string, Record<string, number>> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};

function saveLedger(): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(ledger, null, 2));
}

/** The date (YYYY-MM-DD, config.timezone) of the most recent 9 PM Mine Wars. */
function nightKey(): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hourCycle: 'h23' })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  const date = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day));
  if (+parts.hour < 21) date.setUTCDate(date.getUTCDate() - 1); // before 9 PM → last night's Mine Wars
  return date.toISOString().slice(0, 10);
}

const nightLabel = (key: string) =>
  new Date(key + 'T00:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });

interface Session {
  night: string;
  attended: Set<string>;
  top: Set<string>;
}
const sessions = new Map<string, Session>();

/** What each member would be paid now, after subtracting what they already got that night. */
function plan(s: Session): { id: string; amount: number; top: boolean }[] {
  const paid = ledger[s.night] ?? {};
  const everyone = new Set([...s.attended, ...s.top]);
  return [...everyone]
    .map((id) => {
      const top = s.top.has(id);
      return { id, top, amount: Math.max(0, (top ? TOP_REWARD : ATTEND_REWARD) - (paid[id] ?? 0)) };
    })
    .filter((p) => p.amount > 0);
}

function render(sessionId: string, s: Session) {
  const payouts = plan(s);
  const total = payouts.reduce((n, p) => n + p.amount, 0);
  const alreadyPaid = Object.keys(ledger[s.night] ?? {}).length;
  const skipped = new Set([...s.attended, ...s.top]).size - payouts.length;

  const content = [
    `## ⛏️ Mine Wars payout — ${nightLabel(s.night)}, 9 PM`,
    `-# ${MW_SERVER} server only`,
    `✅ Attended: **${s.attended.size}** selected (+${ATTEND_REWARD} each)`,
    `🏆 Top 10: **${s.top.size}** selected (${TOP_REWARD} total each — counts as attended)`,
    `🪙 Paying **${payouts.length}** member(s), **${total} ${kowen(total)}** in total`,
    alreadyPaid ? `-# ${alreadyPaid} member(s) already paid for this night — they only get the difference (e.g. attendance → Top 10).` : '',
    skipped > 0 ? `-# ${skipped} selected member(s) are already fully paid and will be skipped.` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const attended = new UserSelectMenuBuilder()
    .setCustomId(`${PREFIX}${sessionId}:attended`)
    .setPlaceholder('✅ Pick who attended (sent in Faction Chat)')
    .setMinValues(0)
    .setMaxValues(25)
    .setDefaultUsers([...s.attended].slice(0, 25));
  const top = new UserSelectMenuBuilder()
    .setCustomId(`${PREFIX}${sessionId}:top`)
    .setPlaceholder('🏆 Pick the Top 10')
    .setMinValues(0)
    .setMaxValues(10)
    .setDefaultUsers([...s.top].slice(0, 10));
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}${sessionId}:confirm`).setLabel(`Confirm & pay ${total}`).setEmoji('🪙').setStyle(ButtonStyle.Success).setDisabled(total === 0),
    new ButtonBuilder().setCustomId(`${PREFIX}${sessionId}:cancel`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );

  return {
    content,
    components: [
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(attended),
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(top),
      buttons,
    ],
  };
}

export async function openPayoutPanel(interaction: ChatInputCommandInteraction): Promise<void> {
  const sessionId = interaction.id;
  const session: Session = { night: nightKey(), attended: new Set(), top: new Set() };
  sessions.set(sessionId, session);
  setTimeout(() => sessions.delete(sessionId), SESSION_MS);
  await interaction.reply({ ...render(sessionId, session), flags: MessageFlags.Ephemeral });
}

export const isPayoutInteraction = (customId: string) => customId.startsWith(PREFIX);

export async function handlePayoutInteraction(interaction: UserSelectMenuInteraction | ButtonInteraction): Promise<void> {
  const [sessionId, action] = interaction.customId.slice(PREFIX.length).split(':');
  const session = sessions.get(sessionId);
  if (interaction.user.id !== config.rewardOwnerId) {
    await interaction.reply({ content: 'Only the gifter can do this. 🎁', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!session) {
    await interaction.update({ content: '⏰ This payout panel expired. Run `/gift minewars` again.', components: [] });
    return;
  }

  if (interaction.isUserSelectMenu()) {
    const picked = new Set(interaction.users.filter((u) => !u.bot).map((u) => u.id));
    if (action === 'attended') session.attended = picked;
    else session.top = picked;
    await interaction.update(render(sessionId, session));
    return;
  }

  if (action === 'cancel') {
    sessions.delete(sessionId);
    await interaction.update({ content: 'Payout cancelled. Nothing was paid.', components: [] });
    return;
  }

  // confirm
  const payouts = plan(session);
  sessions.delete(sessionId);
  if (!payouts.length) {
    await interaction.update({ content: 'Nothing to pay — everyone selected was already paid.', components: [] });
    return;
  }
  const night = (ledger[session.night] ??= {});
  for (const p of payouts) {
    add(p.id, p.amount);
    night[p.id] = (night[p.id] ?? 0) + p.amount;
  }
  saveLedger();
  const total = payouts.reduce((n, p) => n + p.amount, 0);
  console.log(`[minewars] paid ${payouts.length} member(s), ${total} total for ${session.night}`);

  const tops = payouts.filter((p) => p.top);
  const attendees = payouts.filter((p) => !p.top);
  const lines = [
    `**⛏️ Mine Wars rewards — ${nightLabel(session.night)}, 9 PM · ${MW_SERVER}** 🪙`,
    tops.length ? `\n🏆 **Top 10**\n${tops.map((p) => `<@${p.id}> +${p.amount}`).join(' · ')}` : '',
    attendees.length ? `\n✅ **Attendance**\n${attendees.map((p) => `<@${p.id}> +${p.amount}`).join(' · ')}` : '',
    `\n-# Thank you for joining! Only Mine Wars in the ${MW_SERVER} server counts. Check your Kowens with /balance.`,
  ].filter(Boolean);

  const channel = await interaction.client.channels.fetch(config.gamesChannelId);
  let link = '';
  if (channel?.isSendable()) {
    const msg = await channel.send({ content: lines.join('\n'), allowedMentions: { parse: [] } }); // names shown, nobody pinged
    link = `\n${msg.url}`;
  }
  await interaction.update({ content: `✅ Paid **${payouts.length}** member(s), **${total} ${kowen(total)}** in total.${link}`, components: [] });
}
