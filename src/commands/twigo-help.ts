import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { config } from '../config.js';
import { DAILY_CREDITS } from '../credits/store.js';
import { kowen } from '../kowens.js';

export const twigoHelp: Command = {
  data: new SlashCommandBuilder().setName('twigo-help').setDescription('List everything the Tanod can do · 🔒 Only you see'),
  async execute(interaction) {
    const isAdmin =
      interaction.inCachedGuild() &&
      (interaction.member.roles.cache.has(config.adminRoleId) ||
        interaction.member.permissions.has(PermissionFlagsBits.Administrator));

    const embed = new EmbedBuilder()
      .setColor(0xf5a623)
      .setTitle('🫡 Tanod on duty — commands')
      .addFields(
        {
          name: '🎲 Fun',
          value: [
            '`/diss @someone` — roast them 🔥',
            '`/praise @someone` — hype them up 💖',
            '`/judge @someone` — the Tanod decides: roast or praise',
            '-# Leave the user empty to target yourself (free).',
          ].join('\n'),
        },
        {
          name: '🎰 Games',
          value: [
            '`/gamble amount` — coin flip: double or nothing (watch out for the Tanod 🚨)',
            '`/steal @someone` — try to steal 1–3 Kowens (get caught = fine + jail)',
            '`/jackpot` — see the pot, players, your odds & last winner · `/jackpot tickets` — buy (1 Kowen each, draw at 10 PM)',
            '`/leaderboard` — richest members and top voice chatters',
            '⛏️ `/dig` — dig for treasure (needs a 🪓 Shovel from `/redeem`, 3 digs a day) · `/inventory` · `/sell`',
            '🎒 Inventory holds **10** items — buy bags in `/redeem` for +8 each, up to **50**',
            '`/jail` — see who is in jail 🚔',
            '🚨 **Tanod Patrol** — random roll call; first 3 to click win 3/2/1 Kowens',
          ].join('\n'),
        },
        {
          name: '🪙 Kowens',
          value: [
            `\`/get-kowens\` — claim ${DAILY_CREDITS} ${kowen(DAILY_CREDITS)} once a day`,
            '`/give @someone amount` — give a friend Kowens (max 20 per week, resets Monday)',
            '`/request task reward` — post a quest; the reward is held until you mark it complete 📜',
            '`/balance` — your Kowens, today\'s progress and next reward (`user:` to check someone else)',
            '`/redeem` — 🧱 Bakod (block /steal for 1.5 days, 5 Kowens) or Crystal of Atlan passes 🎁',
            '`/claim code` — found a Kowen in [twigo\'s room](https://tw1go.github.io)? Claim it here (3 a day)',
            '💎 **Boost the server**: +20 Kowens per boost, and 20 × your boosts every month while boosting',
            '🎙️ Earn **1 Kowen per 15 min** in voice chat, **max 12 a day** (with at least 1 other person, not deafened, not in AFK)',
            '-# Each /diss, /praise or /judge on someone else costs 1 Kowen. Unused Kowens carry over.',
            '-# ⚠️ Inactive for 3+ days? You lose a growing % of Kowens each day until you\'re back.',
          ].join('\n'),
        },
        {
          name: '⏰ Automatic',
          value: [
            '☀️ **Daily 7:00 AM** — morning greeting, joke/trivia, and holiday countdown',
            '⛏️ **Mine Wars** — alerts at 11:55 AM & 8:55 PM and at the start (12 PM & 9 PM)',
            '⚔️ **Ancient Battlefield (Sat)** — admin check at 12:30, sign-up poll until 6 PM, pings at 7:45 & 8 PM',
            '-# Click 🔔 on a Mine Wars message to get or stop Mine Wars pings.',
          ].join('\n'),
        },
        { name: '🛠️ Other', value: '`/ping` — check if the Tanod is awake\n`/twigo-help` — this list' },
      );

    if (isAdmin) {
      embed.addFields({
        name: '🔒 Admin / Mod (`/twigo`)',
        value: [
          '`abf:<ask|close|remind|start>` — run an Ancient Battlefield step now',
          '`mw:<warning|start|panel>` — send a Mine Wars message or the 🔔 opt-in panel',
          '`greet:send` — post a morning greeting now',
          '`banter:send` — make the Tanod say a random line now',
          '`announce:#channel` (+ `announce-ping:True` for @everyone) — post an announcement as the bot',
          '`game:<patrol|jackpot>` — start a Tanod Patrol or draw the jackpot now',
          '`/jail @user minutes reason` — jail someone (`minutes:0` releases)',
          '`/gift kowens|boosts|minewars` — gifter only: give/remove Kowens, fix a boost count, or pay the 9 PM Mine Wars',
          '`reset-kowens:@user` / `reset-all-kowens:yes` — reset Kowens',
        ].join('\n'),
      });
    }

    embed.setFooter({ text: 'Times are Philippine time.' });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
