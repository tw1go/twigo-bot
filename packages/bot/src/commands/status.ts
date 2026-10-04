import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { INACTIVE_GRACE_DAYS, DAILY_GIVE_LIMIT, daysInactive, fencedUntil, givenToday, lastSteal } from '../credits/store.js';
import { bailFor, canBail, jailList, jailedUntil } from '../games/jail.js';
import { kowen } from '../kowens.js';
import { ticketsOf } from '../games/jackpot.js';
import { boostCount } from '../games/boosts.js';
import { DIGS_PER_DAY, SHOVELS_PER_DAY, capacity, digsToday, masterKeys, shovelUses, shovelsBoughtToday } from '../dig/store.js';
import { usedSlots } from '../dig/bag.js';
import { MAX_ACTIVE, acceptedCount, activeCount } from '../quests/board.js';
import { STEAL_COOLDOWN_MS } from './steal.js';
import { BANK, debtOf } from '../loans/loans.js';
import { swerteLeft, tagoUntil } from '../potions/potions.js';

// Protections, cooldowns and daily limits in one place. /balance is for Kowens.
const at = (ms: number) => `<t:${Math.floor(ms / 1000)}:f> (<t:${Math.floor(ms / 1000)}:R>)`;

export const status: Command = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Bakod, jail, cooldowns & limits 🛡️ · 🔒 Only you see')
    .addUserOption((o) => o.setName('user').setDescription('Whose status (default: you)')),
  async execute(interaction) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    const id = target.id;

    const fence = fencedUntil(id);
    const jail = jailedUntil(id);
    const jailReason = jailList().find(([uid]) => uid === id)?.[1].reason;
    const stealReady = lastSteal(id) + STEAL_COOLDOWN_MS;
    const idle = daysInactive(id);
    const boosts = boostCount(id);
    const debt = debtOf(id);

    const embed = new EmbedBuilder()
      .setColor(jail ? 0x7f8c8d : 0x3498db)
      .setAuthor({ name: `${target.displayName}'s status`, iconURL: target.displayAvatarURL() || undefined })
      .addFields(
        {
          name: '🛡️ Protection',
          value: [
            fence ? `🧱 **Bakod up** until ${at(fence)}` : '🧱 No Bakod — open to `/steal`',
            `🗝️ Master Keys: **${masterKeys(id)}**`,
            ...(tagoUntil(id) ? [`🫥 Tago Tonic: hidden from the Tanod ${at(tagoUntil(id)!)}`] : []),
            ...(swerteLeft(id) ? [`🍀 Swerte Elixir: **${swerteLeft(id)}** lucky dig(s) left`] : []),
          ].join('\n'),
        },
        {
          name: '🚔 Jail',
          value: jail
            ? `**Jailed** until ${at(jail)}${jailReason ? `\n-# ${jailReason}` : ''}\n${canBail(id) ? `💸 Bail: **${bailFor(id)}** ${kowen(bailFor(id))} — \`/bail\`` : '🔒 No bail (admin sentence)'}`
            : '✅ Free',
        },
        {
          name: '⏱️ Cooldowns',
          value: [
            stealReady > Date.now() ? `🥷 \`/steal\` ready ${at(stealReady)}` : '🥷 `/steal` ready now',
            `🎁 \`/give\`: **${DAILY_GIVE_LIMIT - givenToday(id)}/${DAILY_GIVE_LIMIT}** left today`,
          ].join('\n'),
        },
        {
          name: '⛏️ Digging',
          value: [
            `🪏 Shovel: **${shovelUses(id)}** dig(s) left · bought **${shovelsBoughtToday(id)}/${SHOVELS_PER_DAY}** today`,
            `⛏️ Digs today: **${digsToday(id)}/${DIGS_PER_DAY}** · 🎒 Bag: **${usedSlots(id)}/${capacity(id)}**`,
          ].join('\n'),
        },
        {
          name: '📜 Activity',
          value: [
            debt
              ? `💳 Loan: owes **${debt.owed}** ${kowen(debt.owed)} to ${debt.lender === BANK ? 'the Tanod Bank' : `<@${debt.lender}>`}${debt.status === 'defaulted' ? ' · ⛔ defaulted' : ` · due <t:${Math.floor(debt.due / 1000)}:R>`}`
              : '💳 Loan: none',
            `📜 Quests: **${activeCount(id)}/${MAX_ACTIVE}** posted · **${acceptedCount(id)}** accepted`,
            `🎟️ Jackpot tickets (next draw): **${ticketsOf(id)}**`,
            boosts ? `💎 Boosting: **${boosts}** boost${boosts === 1 ? '' : 's'}` : '',
            idle !== null && idle > INACTIVE_GRACE_DAYS ? `⚠️ **Inactive ${idle} days** — losing Kowens daily!` : '🟢 Active — no inactivity loss',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      )
      .setFooter({ text: 'Kowens and rewards: /balance' });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
