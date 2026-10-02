import { randomBytes } from 'node:crypto';
import { markFound } from './found.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Message,
  type ModalSubmitInteraction,
} from 'discord.js';
import { add, balance, take } from '../credits/store.js';
import { kowen } from '../kowens.js';
import { jailedUntil } from './jail.js';
import { config } from '../config.js';

// 🏁 Mosang race: /race picks 5 of 10 Mosangs, opens BETTING_MS of betting (one bet per member), then a RACE_MS
// animated race. Bets on the winner pay PAYOUT× — each Mosang has a 1-in-5 chance, so the race is a small Kowen sink.
// A restart mid-race refunds every bet.
export const MOSANGS = [
  { name: 'Aling Marites', emoji: '👵', line: 'knows the news before it happens' },
  { name: 'Aling Nena', emoji: '🧓', line: 'has binoculars by the window' },
  { name: 'Aling Puring', emoji: '👩‍🦳', line: '"Hindi naman sa nagchichismis ha, pero…"' },
  { name: 'Aling Tessie', emoji: '🧕', line: 'sari-sari store intelligence network' },
  { name: 'Aling Dolor', emoji: '💁‍♀️', line: 'reports live from the tricycle terminal' },
  { name: 'Aling Bebang', emoji: '🙎‍♀️', line: 'never misses a lamay' },
  { name: 'Aling Charing', emoji: '👩‍🦱', line: 'group chat admin of 47 GCs' },
  { name: 'Aling Lourdes', emoji: '🤷‍♀️', line: '"Ay, ewan ko, pero narinig ko…"' },
  { name: 'Aling Pacita', emoji: '🙋‍♀️', line: 'knows your utang, your crush, and your password' },
  { name: 'Aling Rosing', emoji: '🕵️‍♀️', line: 'retired, still investigating' },
];
const LANES = 5;
export const BETTING_MS = 2 * 60_000;
const RACE_MS = 30_000;
const FRAME_MS = 3_000;
export const PAYOUT = 4;
export const MAX_BET = 100;
const PHOTO_FINISH_CHANCE = 0.03; // 🤫 two Mosangs tie; both sets of backers win
const TRACK = 14;
const PREFIX = 'race:';
const MODAL = 'racebet:';
const LANE_NUM = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

interface Race {
  id: string;
  runners: number[]; // indexes into MOSANGS
  bets: Record<string, { lane: number; amount: number }>;
  closesAt: number;
  channelId: string;
  messageId?: string;
}

const DIR = 'data';
const FILE = `${DIR}/race.json`;
let race: Race | null = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : null;
function save(): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(race));
}

const mosang = (r: Race, lane: number) => MOSANGS[r.runners[lane]];
const betsOn = (r: Race, lane: number) => Object.values(r.bets).filter((b) => b.lane === lane);

function bettingCard(r: Race) {
  const ts = Math.floor(r.closesAt / 1000);
  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle('🏁 The Mosang Race is about to start!')
    .setDescription(
      `Bet on who'll spread the chismis first! Winners get **${PAYOUT}× their bet** 🪙\nBetting closes <t:${ts}:R>\n\n` +
        r.runners
          .map((_, lane) => {
            const m = mosang(r, lane);
            const bets = betsOn(r, lane);
            const pot = bets.reduce((n, b) => n + b.amount, 0);
            return `${LANE_NUM[lane]} ${m.emoji} **${m.name}**: *${m.line}*\n-# ${bets.length} bet${bets.length === 1 ? '' : 's'} · ${pot} ${kowen(pot)}`;
          })
          .join('\n'),
    )
    .setFooter({ text: `One bet per person · 1–${MAX_BET} Kowens · equal odds for every Mosang` });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    r.runners.map((_, lane) =>
      new ButtonBuilder().setCustomId(`${PREFIX}${r.id}:${lane}`).setLabel(mosang(r, lane).name.replace('Aling ', '')).setEmoji(mosang(r, lane).emoji).setStyle(ButtonStyle.Primary),
    ),
  );
  return { embeds: [embed], components: [row] };
}

function trackFrame(r: Race, pos: number[], title: string) {
  const lines = r.runners.map((_, lane) => {
    const p = Math.min(TRACK, Math.round(pos[lane]));
    const road = '·'.repeat(p) + mosang(r, lane).emoji + '·'.repeat(TRACK - p);
    return `${LANE_NUM[lane]} 🏁${road}🚩 **${mosang(r, lane).name.replace('Aling ', '')}**`;
  });
  return new EmbedBuilder().setColor(0xe74c3c).setTitle(title).setDescription(lines.join('\n'));
}

export async function startRace(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.channelId !== config.gamblingChannelId) {
    await interaction.reply({ content: `🏁 The Mosangs only race in <#${config.gamblingChannelId}>. Head there to start one!`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (race) {
    await interaction.reply({ content: '🏁 A race is already on! Find it and place your bet. 👀', flags: MessageFlags.Ephemeral });
    return;
  }
  const pool = [...MOSANGS.keys()].sort(() => Math.random() - 0.5).slice(0, LANES);
  race = { id: randomBytes(4).toString('hex'), runners: pool, bets: {}, closesAt: Date.now() + BETTING_MS, channelId: interaction.channelId };
  save();
  const res = await interaction.reply({ ...bettingCard(race), withResponse: true });
  race.messageId = res.resource?.message?.id;
  save();
  const message = res.resource?.message;
  if (message) setTimeout(() => void runRace(message).catch((e) => console.error('[race] failed:', e)), BETTING_MS);
}

export const isRaceButton = (id: string) => id.startsWith(PREFIX);
export const isRaceModal = (id: string) => id.startsWith(MODAL);

export async function handleRaceButton(interaction: ButtonInteraction): Promise<void> {
  const [id, laneStr] = interaction.customId.slice(PREFIX.length).split(':');
  const lane = Number(laneStr);
  const deny = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
  if (!race || race.id !== id || Date.now() >= race.closesAt) return void (await deny('Betting for this race is closed. 🏁'));
  if (jailedUntil(interaction.user.id)) return void (await deny("🚔 You can't bet from jail!"));
  const existing = race.bets[interaction.user.id];
  if (existing) return void (await deny(`You already bet **${existing.amount}** on ${mosang(race, existing.lane).emoji} **${mosang(race, existing.lane).name}**. One bet per race! 🎟️`));
  const m = mosang(race, lane);
  const modal = new ModalBuilder()
    .setCustomId(`${MODAL}${id}:${lane}`)
    .setTitle(`Bet on ${m.name}`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('amount')
          .setLabel(`Kowens to bet (1–${MAX_BET}, you have ${balance(interaction.user.id)})`)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. 10')
          .setRequired(true)
          .setMaxLength(3),
      ),
    );
  await interaction.showModal(modal);
}

export async function handleRaceModal(interaction: ModalSubmitInteraction): Promise<void> {
  const [id, laneStr] = interaction.customId.slice(MODAL.length).split(':');
  const lane = Number(laneStr);
  const me = interaction.user.id;
  const deny = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
  if (!race || race.id !== id || Date.now() >= race.closesAt) return void (await deny('Too late! Betting closed. 🏁'));
  if (race.bets[me]) return void (await deny('You already placed a bet on this race. 🎟️'));
  const amount = Number(interaction.fields.getTextInputValue('amount').trim());
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_BET) return void (await deny(`Enter a whole number from 1 to ${MAX_BET}. 🔢`));
  if (balance(me) < amount) return void (await deny(`You only have **${balance(me)}** ${kowen(balance(me))}. 🪙`));

  take(me, amount);
  race.bets[me] = { lane, amount };
  save();
  const m = mosang(race, lane);
  await interaction.reply({
    content: `🎟️ You bet **${amount}** ${kowen(amount)} on ${m.emoji} **${m.name}**! If she wins you get **${amount * PAYOUT}** 🪙`,
    flags: MessageFlags.Ephemeral,
  });
  // Refresh the bet counts on the card.
  const channel = await interaction.client.channels.fetch(race.channelId).catch(() => null);
  if (channel?.isTextBased() && race.messageId) {
    const msg = await channel.messages.fetch(race.messageId).catch(() => null);
    await msg?.edit({ ...bettingCard(race), allowedMentions: { parse: [] } }).catch(() => {});
  }
}

async function runRace(message: Message): Promise<void> {
  const r = race;
  if (!r) return;
  const winner = Math.floor(Math.random() * LANES);
  const tie = Math.random() < PHOTO_FINISH_CHANCE ? (winner + 1 + Math.floor(Math.random() * (LANES - 1))) % LANES : -1;
  const isWinner = (lane: number) => lane === winner || lane === tie;
  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

  // Positions: everyone jostles forward; the winner crosses on the last frame and the rest fall just short.
  const frames = RACE_MS / FRAME_MS;
  const pos = Array<number>(LANES).fill(0);
  await message.edit({ embeds: [trackFrame(r, pos, '🏁 And they\'re off! 🗣️💨')], components: [], allowedMentions: { parse: [] } }).catch(() => {});
  for (let f = 1; f <= frames; f++) {
    await sleep(FRAME_MS);
    for (let lane = 0; lane < LANES; lane++) {
      const target = f === frames ? (isWinner(lane) ? TRACK : TRACK - 1 - Math.floor(Math.random() * 3)) : (TRACK * f) / frames;
      const jitter = f === frames ? 0 : (Math.random() - 0.5) * 3;
      pos[lane] = Math.max(pos[lane], Math.min(isWinner(lane) || f === frames ? target : TRACK - 1, target + jitter));
    }
    const title = f === frames ? (tie >= 0 ? '📸 PHOTO FINISH?!' : '🏁 FINISH!') : ['🗣️ Neck and neck!', '👀 "Ay, may balita ako!"', '💨 Kumakaripas!', '📢 Who will tell it first?!'][f % 4];
    await message.edit({ embeds: [trackFrame(r, pos, title)], allowedMentions: { parse: [] } }).catch(() => {});
  }

  // Pay out
  const w = mosang(r, winner);
  const winners = Object.entries(r.bets).filter(([, b]) => isWinner(b.lane));
  for (const [id, b] of winners) {
    add(id, b.amount * PAYOUT);
    if (tie >= 0) markFound(id, 'photo-finish');
  }
  const bettors = Object.keys(r.bets).length;
  race = null;
  save();

  const results = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(tie >= 0 ? `📸 PHOTO FINISH! ${w.emoji} ${w.name} & ${mosang(r, tie).emoji} ${mosang(r, tie).name} tie!` : `🏆 ${w.emoji} ${w.name} wins!`)
    .setDescription(
      (tie >= 0
        ? `They told the chismis at the **exact same time**! 🗣️🗣️ Backers of **both** win!\n\n`
        : `${w.emoji} **${w.name}** (*${w.line}*) got the chismis there first! 🗣️\n\n`) +
        (winners.length
          ? `**Winners** (${PAYOUT}× bet):\n${winners.map(([id, b]) => `<@${id}> +${b.amount * PAYOUT} ${kowen(b.amount * PAYOUT)}`).join('\n')}`
          : bettors
            ? `Nobody bet on ${tie >= 0 ? 'either of them' : w.name}. The Tanod keeps all ${bettors} bet${bettors === 1 ? '' : 's'} 💸`
            : 'Nobody placed a bet. Just for the chismis 😂'),
    );
  await message.reply({ embeds: [results], allowedMentions: { parse: [] } }).catch((e) => console.error('[race] results failed:', e));
}

/** On startup: a race interrupted by a restart is refunded. */
export async function refundInterruptedRace(client: Client): Promise<void> {
  if (!race) return;
  const r = race;
  for (const [id, b] of Object.entries(r.bets)) add(id, b.amount);
  race = null;
  save();
  console.log(`[race] refunded ${Object.keys(r.bets).length} bet(s) from an interrupted race`);
  const channel = await client.channels.fetch(r.channelId).catch(() => null);
  if (channel?.isSendable()) {
    await channel.send({ content: '🏁 The last Mosang race was interrupted (the Tanod restarted), so every bet was refunded. Start a new one with `/race`!', allowedMentions: { parse: [] } }).catch(() => {});
  }
}
