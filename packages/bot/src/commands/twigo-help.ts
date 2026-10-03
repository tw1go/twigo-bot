import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { LAUNCH_REWARD } from '../prereg/prereg.js';
import type { Command } from '../types.js';
import { config } from '../config.js';
import { DAILY_CREDITS } from '../credits/store.js';
import { kowen } from '../kowens.js';

// Discord rejects an embed field over 1,024 characters (that broke this command once). Sections are built from
// lines and split into as many fields as needed, so adding a line can't break /twigo-help again.
const FIELD_MAX = 1024;
function section(name: string, lines: string[]) {
  const fields: { name: string; value: string }[] = [];
  let chunk: string[] = [];
  const flush = () => {
    if (chunk.length) fields.push({ name: fields.length ? `${name} (cont.)` : name, value: chunk.join('\n') });
    chunk = [];
  };
  for (const line of lines) {
    if ([...chunk, line].join('\n').length > FIELD_MAX) flush();
    chunk.push(line.slice(0, FIELD_MAX));
  }
  flush();
  return fields;
}

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
        ...section('🎲 Fun', [
          '`/diss @someone` — roast them 🔥',
          '`/praise @someone` — hype them up 💖',
          '`/judge @someone` — the Tanod decides: roast or praise',
          '-# Leave the user empty to target yourself (free).',
        ]),
        ...section('🎰 Games', [
          '`/gamble amount` — coin flip: double or nothing. Busted 3% in 🎰 the gambling channel, 20% anywhere else 🚨',
          '`/steal @someone` — steal 2–5% of their Kowens (max 50); caught = fine of half + jail. 🗝️ Master Key: 50% to break a Bakod',
          '`/race` — 🏁 Mosang race (gambling channel only): 2 min to bet on 1 of 5 Mosangs, winner pays 4×',
          '`/jackpot` — pot, players, your odds & last winner · `/jackpot tickets` — buy (1 Kowen each, draws at 10 AM & 10 PM)',
          '`/leaderboard` — richest members and top voice chatters',
          '🚨 **Tanod Patrol** — random roll call; first 3 to click win 3/2/1 Kowens',
          '`/jail` — see who is in jail 🚔 · `/bail [user]` — pay to get out early (5% of their Kowens, 3–100; not for admin jails)',
        ]),
        ...section('⛏️ Digging', [
          '`/dig` — dig for treasure (🪏 Shovel from `/redeem`: 3 digs each, up to 3 shovels & 9 digs a day)',
          '`/inventory` — your finds · `/sell` — turn them into Kowens · `/flex` — show off an item 💪',
          '🍀 Every **60th dig on the server** is a **Lucky Dig**: guaranteed Epic or better!',
          '🎒 Inventory holds **10** items — buy bags in `/redeem` for +8 each, up to **50**',
        ]),
        ...section('🪙 Earn Kowens', [
          `\`/get-kowens\` — claim ${DAILY_CREDITS} ${kowen(DAILY_CREDITS)} once a day`,
          '🎙️ **1 Kowen per 15 min** in voice chat, **max 12 a day** (with 1+ other person, not deafened, not AFK)',
          '🏆 **Weekly voice rewards** (Mondays 12 PM): top 10 get 50 · 30 · 20 · 10 Kowens (`/leaderboard`)',
          '💎 **Boost the server**: +20 Kowens per boost, and 20 × your boosts every month while boosting',
          '`/claim code` — found a Kowen in [twigo\'s room](https://tw1go.github.io)? Claim it here (3 a day)',
          `\`/preregister\` — 🎮 sign up for the Mikazuki web game: +${LAUNCH_REWARD} Kowens when it launches`,
          '-# ⚠️ Inactive for 3+ days? You lose a growing % of Kowens each day until you\'re back.',
        ]),
        ...section('💳 Spend & manage', [
          '`/redeem` — 🧱 Bakod, 🪏 Shovel, 🗝️ Master Key, 🔐 Vault, 🧪 potions, 🎒 bags, or Crystal of Atlan passes 🎁',
          '`/potion use|list` — 🧪 Kalawang (rust a Bakod) · 🫥 Tago (no busts 30 min) · 🍀 Swerte (better digs) · 🍵 Marites (hints)',
          '`/give @someone amount` — give a friend Kowens (max 20 per day)',
          '`/vault deposit|withdraw|view` — 🔐 store up to 30% of your Kowens, safe from /steal & bail (Vault from `/redeem`, 50)',
          '`/request task reward` — post a quest; the reward is held until you mark it complete 📜',
          '`/loan take|offer|pay|status` — borrow from the 🏦 Tanod Bank or a friend (+10%, due in 3 days)',
          '`/balance` — your Kowens & next reward · `/status` — Bakod, jail, loan, cooldowns & limits (`user:` for someone else)',
          '-# /diss, /praise or /judge on someone else costs 1 Kowen. Unused Kowens carry over.',
        ]),
        ...section('⏰ Automatic', [
          '☀️ **Daily 7:00 AM** — morning greeting, joke/trivia, and holiday countdown',
          '⛏️ **Mine Wars** — alerts at 11:55 AM & 8:55 PM and at the start (12 PM & 9 PM)',
          '⚔️ **Ancient Battlefield (Sat)** — admin check at 12:30, sign-up poll until 6 PM, pings at 7:45 & 8 PM',
          '-# Click 🔔 on a Mine Wars message to get or stop Mine Wars pings.',
        ]),
        ...section('🛠️ Other', ['`/ping` — check if the Tanod is awake', '`/twigo-help` — this list']),
      );

    if (isAdmin) {
      embed.addFields(
        ...section('🔒 Admin / Mod (`/twigo`)', [
          '`abf:<ask|close|remind|start>` — run an Ancient Battlefield step now',
          '`mw:<warning|start|panel>` — send a Mine Wars message or the 🔔 opt-in panel',
          '`greet:send` — post a morning greeting now',
          '`banter:send` — make the Tanod say a random line now',
          '`announce:#channel` (+ `announce-ping:True` for @everyone) — post an announcement as the bot',
          '`game:<patrol|jackpot>` — start a Tanod Patrol or draw the jackpot now',
          '`/jail @user minutes reason` — jail someone (`minutes:0` releases)',
          '`/gift kowens|everyone|boosts|minewars` — gifter only: give/remove Kowens (one member or everyone who has used the bot), fix a boost count, or pay the 9 PM Mine Wars',
          '`/gift prereg-panel|launch` — gifter only: post the web game pre-registration panel; at launch, pay every pre-registered member and close sign-ups',
          '`/gift title` — gifter only: give a member a web game title (shown under their name in the town)',
          '`reset-kowens:@user` / `reset-all-kowens:yes` — reset Kowens',
        ]),
      );
    }

    embed.setFooter({ text: 'Times are Philippine time.' });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
