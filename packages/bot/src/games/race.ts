import { randomBytes } from 'node:crypto';
import { markFound } from './found.js';
import { kvLoad, kvSave } from '../db/db.js';
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
import type { TownRace, TownRaceLane, TownRaceStop } from '@mikazuki/shared';
import { LANES, finishMs, laneAt, raceScript } from './race-script.js';
import { add, balance, take } from '../credits/store.js';
import { kowen } from '../kowens.js';
import { jailedUntil } from './jail.js';
import { config } from '../config.js';
import { feed, townName, townRace } from '../web/town-feed.js';
import { getNickname } from '../web/nickname.js';

// 🏁 Mosang race: 5 of the 10 Mosangs, BETTING_MS of betting (one bet per member), then the race. Started with /race
// in the gambling channel or from an Aling's dialog box in the web town (she always runs): it's the same race either
// way, one at a time. Bets come from the Discord card's buttons or the town's race box (placeBet). As betting closes
// the race is scripted (raceScript): each Mosang's pace and her stops (an arthritis attack, asthma, a juicy bit of
// gossip, her phone, a fall); the first over the line wins, so every Mosang has the same chance. The Discord card
// animates from the script and the town (web/town.ts → the game) walks the Mosangs through it. Bets on the winner
// pay PAYOUT× — each Mosang has a 1-in-5 chance, so the race is a small Kowen sink. A restart mid-race refunds every
// bet.
export const MOSANGS = [
  { id: 'marites', name: 'Aling Marites', emoji: '👵', line: 'knows the news before it happens' },
  { id: 'nena', name: 'Aling Nena', emoji: '🧓', line: 'has binoculars by the window' },
  { id: 'puring', name: 'Aling Puring', emoji: '👩‍🦳', line: '"Hindi naman sa nagchichismis ha, pero…"' },
  { id: 'tessie', name: 'Aling Tessie', emoji: '🧕', line: 'sari-sari store intelligence network' },
  { id: 'dolor', name: 'Aling Dolor', emoji: '💁‍♀️', line: 'reports live from the tricycle terminal' },
  { id: 'bebang', name: 'Aling Bebang', emoji: '🙎‍♀️', line: 'never misses a lamay' },
  { id: 'charing', name: 'Aling Charing', emoji: '👩‍🦱', line: 'group chat admin of 47 GCs' },
  { id: 'lourdes', name: 'Aling Lourdes', emoji: '🤷‍♀️', line: '"Ay, ewan ko, pero narinig ko…"' },
  { id: 'pacita', name: 'Aling Pacita', emoji: '🙋‍♀️', line: 'knows your utang, your crush, and your password' },
  { id: 'rosing', name: 'Aling Rosing', emoji: '🕵️‍♀️', line: 'retired, still investigating' },
];
export const BETTING_MS = 2 * 60_000;
const FRAME_MS = 3_000;
export const PAYOUT = 4;
export const MAX_BET = 100;
const TRACK = 14; // the Discord card's track, in dots
const PREFIX = 'race:';
const MODAL = 'racebet:';
const LANE_NUM = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

const STOP_TITLE: Record<TownRaceStop['kind'], (name: string) => string> = {
  arthritis: (n) => `🦴 Arthritis attack! ${n} stops to rub her knee!`,
  asthma: (n) => `😮‍💨 ${n} needs her inhaler!`,
  gossip: (n) => `👂 ${n} overheard some chismis!`,
  phone: (n) => `📱 New message in the GC! ${n} has to check!`,
  fall: (n) => `💥 ${n} tripped and fell!`,
};
/** After the winner crosses, how long the stragglers get before the town's race is over (they walk home). */
const STRAGGLERS_MS = 6_000;

interface Race {
  id: string;
  runners: number[]; // indexes into MOSANGS
  bets: Record<string, { lane: number; amount: number }>;
  closesAt: number;
  channelId: string;
  messageId?: string;
  startedBy?: string;
  run?: { lanes: TownRaceLane[]; winner: number; tie: number; startedAt: number; endsAt: number };
  /** The winners were paid (only the stragglers are left). */
  paid?: boolean;
}

const KEY = 'race.json'; // kv key (its old file name)
let race: Race | null = kvLoad(KEY, null);
function save(): void {
  kvSave(KEY, race);
}

const mosang = (r: Race, lane: number) => MOSANGS[r.runners[lane]];
const betsOn = (r: Race, lane: number) => Object.values(r.bets).filter((b) => b.lane === lane);

/** The race as the town sees it (no bettors' ids), or null. */
function publicRace(r: Race | null): TownRace | null {
  if (!r) return null;
  return {
    id: r.id,
    runners: r.runners.map((i) => MOSANGS[i].id),
    closesAt: r.closesAt,
    now: Date.now(),
    bets: r.runners.map((_, lane) => {
      const bets = betsOn(r, lane);
      return { count: bets.length, pot: bets.reduce((n, b) => n + b.amount, 0) };
    }),
    startedBy: r.startedBy ?? 'someone',
    ...(r.run ? { run: { lanes: r.run.lanes, winner: r.run.winner, tie: r.run.tie, endsAt: r.run.endsAt } } : {}),
  };
}

/** Tells the town (everyone in it) where the race stands. */
const tellTown = () => townRace(publicRace(race));

/** The race now (for GET /town/race) and the member's bet on it. */
export function raceFor(userId: string): { race: TownRace | null; mine: { lane: number; amount: number } | null } {
  return { race: publicRace(race), mine: race?.bets[userId] ?? null };
}

// ── Discord ──

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
    .setFooter({ text: `One bet per person · 1–${MAX_BET} Kowens · equal odds for every Mosang${r.startedBy ? ` · started by ${r.startedBy}` : ''} · watch it in the web town` });
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

/** Refreshes the bet counts on the Discord card. */
async function refreshCard(client: Client): Promise<void> {
  const r = race;
  if (!r?.messageId) return;
  const channel = await client.channels.fetch(r.channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const msg = await channel.messages.fetch(r.messageId).catch(() => null);
  await msg?.edit({ ...bettingCard(r), allowedMentions: { parse: [] } }).catch(() => {});
}

// ── Opening, betting, running ──

export type OpenResult = { ok: true } | { ok: false; reason: 'running' };

/** Opens a race: `lead` (a Mosang's index) always runs, with random others. `post` puts the betting card in the
 *  gambling channel (the /race reply, or a plain post when it's started in town). */
export async function openRace(client: Client, by: { userId: string; name: string }, post: (card: ReturnType<typeof bettingCard>) => Promise<Message | undefined>, lead?: number): Promise<OpenResult> {
  if (race) return { ok: false, reason: 'running' };
  const others = [...MOSANGS.keys()].filter((i) => i !== lead).sort(() => Math.random() - 0.5);
  const runners = (lead === undefined ? others : [lead, ...others]).slice(0, LANES).sort(() => Math.random() - 0.5);
  race = { id: randomBytes(4).toString('hex'), runners, bets: {}, closesAt: Date.now() + BETTING_MS, channelId: config.gamblingChannelId, startedBy: by.name };
  save();
  tellTown();
  feed('race', `${by.name} started a Mosang race! Bets close in 2 minutes`, 'shop', { userId: by.userId });
  const message = await post(bettingCard(race)).catch((e) => {
    console.error('[race] card failed:', e);
    return undefined;
  });
  if (race && message) {
    race.messageId = message.id;
    race.channelId = message.channelId;
    save();
  }
  const id = race.id;
  setTimeout(() => void runRace(client, id).catch((e) => console.error('[race] failed:', e)), BETTING_MS);
  return { ok: true };
}

/** /race in the gambling channel. */
export async function startRace(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.channelId !== config.gamblingChannelId) {
    await interaction.reply({ content: `🏁 The Mosangs only race in <#${config.gamblingChannelId}>. Head there to start one!`, flags: MessageFlags.Ephemeral });
    return;
  }
  const r = await openRace(interaction.client, { userId: interaction.user.id, name: townName(interaction.user) }, async (card) => (await interaction.reply({ ...card, withResponse: true })).resource?.message ?? undefined);
  if (!r.ok) await interaction.reply({ content: '🏁 A race is already on! Find it and place your bet. 👀', flags: MessageFlags.Ephemeral });
}

/** A race started from an Aling's dialog box in the web town (`lead`: her NPC id; she runs). */
export async function openRaceInTown(client: Client, userId: string, lead: string, names: (id: string) => Promise<string>): Promise<OpenResult> {
  const i = MOSANGS.findIndex((m) => m.id === lead);
  const name = getNickname(userId) ?? (await names(userId));
  return openRace(client, { userId, name }, async (card) => {
    const channel = await client.channels.fetch(config.gamblingChannelId).catch(() => null);
    return channel?.isSendable() ? channel.send({ ...card, allowedMentions: { parse: [] } }) : undefined;
  }, i >= 0 ? i : undefined);
}

export type BetResult = { ok: true; lane: number; amount: number } | { ok: false; reason: 'closed' | 'jailed' | 'already' | 'amount' | 'kowens'; lane?: number; amount?: number };

/** A bet on lane `lane` (the same rules from Discord and the town). */
export async function placeBet(client: Client, userId: string, raceId: string, lane: number, amount: number): Promise<BetResult> {
  const r = race;
  if (!r || r.id !== raceId || Date.now() >= r.closesAt || !Number.isInteger(lane) || lane < 0 || lane >= r.runners.length) return { ok: false, reason: 'closed' };
  if (jailedUntil(userId)) return { ok: false, reason: 'jailed' };
  const existing = r.bets[userId];
  if (existing) return { ok: false, reason: 'already', ...existing };
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_BET) return { ok: false, reason: 'amount' };
  if (balance(userId) < amount) return { ok: false, reason: 'kowens' };
  take(userId, amount);
  r.bets[userId] = { lane, amount };
  save();
  tellTown();
  void refreshCard(client);
  return { ok: true, lane, amount };
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
  const amount = Number(interaction.fields.getTextInputValue('amount').trim());
  const r = await placeBet(interaction.client, me, id, lane, amount);
  if (!r.ok) {
    switch (r.reason) {
      case 'closed': return void (await deny('Too late! Betting closed. 🏁'));
      case 'jailed': return void (await deny("🚔 You can't bet from jail!"));
      case 'already': return void (await deny('You already placed a bet on this race. 🎟️'));
      case 'amount': return void (await deny(`Enter a whole number from 1 to ${MAX_BET}. 🔢`));
      case 'kowens': return void (await deny(`You only have **${balance(me)}** ${kowen(balance(me))}. 🪙`));
    }
  }
  const m = race && mosang(race, lane);
  await interaction.reply({
    content: `🎟️ You bet **${amount}** ${kowen(amount)} on ${m?.emoji ?? ''} **${m?.name ?? 'her'}**! If she wins you get **${amount * PAYOUT}** 🪙`,
    flags: MessageFlags.Ephemeral,
  });
}

/** Betting's closed: the script, the race (the Discord card animated from it, the town walking it), the payout. */
async function runRace(client: Client, id: string): Promise<void> {
  const r = race;
  if (!r || r.id !== id) return;
  const script = raceScript(r.runners.length);
  const startedAt = Date.now();
  r.run = { lanes: script.lanes, winner: script.winner, tie: script.tie, startedAt, endsAt: startedAt + script.ms };
  save();
  tellTown();
  const { winner, tie } = r.run;
  const isWinner = (lane: number) => lane === winner || lane === tie;
  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

  // The Discord card: a frame every few seconds, from the same script (the winner crosses on the last frame).
  const channel = await client.channels.fetch(r.channelId).catch(() => null);
  const message = channel?.isTextBased() && r.messageId ? await channel.messages.fetch(r.messageId).catch(() => null) : null;
  const frames = Math.max(4, Math.round(script.ms / FRAME_MS));
  await message?.edit({ embeds: [trackFrame(r, Array<number>(r.runners.length).fill(0), "🏁 And they're off! 🗣️💨")], components: [], allowedMentions: { parse: [] } }).catch(() => {});
  for (let f = 1; f <= frames; f++) {
    const until = startedAt + (script.ms * f) / frames;
    await sleep(Math.max(0, until - Date.now()));
    const at = (script.ms * f) / frames;
    const now = script.lanes.map((l) => laneAt(l, at));
    const pos = now.map((p, lane) => (f === frames ? (isWinner(lane) ? TRACK : Math.min(TRACK - 1, p.at * TRACK)) : Math.min(TRACK - 1, p.at * TRACK)));
    const stopped = now.findIndex((p) => p.stop);
    const title =
      f === frames ? (tie >= 0 ? '📸 PHOTO FINISH?!' : '🏁 FINISH!')
      : stopped >= 0 ? STOP_TITLE[now[stopped].stop!.kind](mosang(r, stopped).name)
      : ['🗣️ Neck and neck!', '👀 "Ay, may balita ako!"', '💨 Kumakaripas!', '📢 Who will tell it first?!'][f % 4];
    await message?.edit({ embeds: [trackFrame(r, pos, title)], allowedMentions: { parse: [] } }).catch(() => {});
  }

  // Pay out
  const w = mosang(r, winner);
  const winners = Object.entries(r.bets).filter(([, b]) => isWinner(b.lane));
  for (const [uid, b] of winners) {
    add(uid, b.amount * PAYOUT);
    if (tie >= 0) markFound(uid, 'photo-finish');
  }
  r.paid = true;
  save();
  const bettors = Object.keys(r.bets).length;
  feed('race', tie >= 0 ? `Photo finish! ${w.name} and ${mosang(r, tie).name} won the Mosang race together` : `${w.name} won the Mosang race!${winners.length ? ` ${winners.length} ${winners.length === 1 ? 'bettor wins' : 'bettors win'} ${PAYOUT}× their bet` : ''}`, 'win');

  const results = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(tie >= 0 ? `📸 PHOTO FINISH! ${w.emoji} ${w.name} & ${mosang(r, tie).emoji} ${mosang(r, tie).name} tie!` : `🏆 ${w.emoji} ${w.name} wins!`)
    .setDescription(
      (tie >= 0
        ? `They told the chismis at the **exact same time**! 🗣️🗣️ Backers of **both** win!\n\n`
        : `${w.emoji} **${w.name}** (*${w.line}*) got the chismis there first! 🗣️\n\n`) +
        (winners.length
          ? `**Winners** (${PAYOUT}× bet):\n${winners.map(([uid, b]) => `<@${uid}> +${b.amount * PAYOUT} ${kowen(b.amount * PAYOUT)}`).join('\n')}`
          : bettors
            ? `Nobody bet on ${tie >= 0 ? 'either of them' : w.name}. The Tanod keeps all ${bettors} bet${bettors === 1 ? '' : 's'} 💸`
            : 'Nobody placed a bet. Just for the chismis 😂'),
    );
  if (message) await message.reply({ embeds: [results], allowedMentions: { parse: [] } }).catch((e) => console.error('[race] results failed:', e));
  else if (channel?.isSendable()) await channel.send({ embeds: [results], allowedMentions: { parse: [] } }).catch((e) => console.error('[race] results failed:', e));

  // The stragglers finish in town, then it's over (the Mosangs walk home).
  const last = Math.max(...script.lanes.map(finishMs));
  await sleep(Math.max(0, startedAt + last + STRAGGLERS_MS - Date.now()));
  if (race?.id === id) {
    race = null;
    save();
    tellTown();
  }
}

/** On startup: a race interrupted by a restart is refunded. */
export async function refundInterruptedRace(client: Client): Promise<void> {
  if (!race) return;
  const r = race;
  // Already won (paid out) and only the stragglers were left: nothing to refund.
  const paid = !!r.paid;
  if (!paid) for (const [id, b] of Object.entries(r.bets)) add(id, b.amount);
  race = null;
  save();
  if (paid) return;
  console.log(`[race] refunded ${Object.keys(r.bets).length} bet(s) from an interrupted race`);
  const channel = await client.channels.fetch(r.channelId).catch(() => null);
  if (channel?.isSendable()) {
    await channel.send({ content: '🏁 The last Mosang race was interrupted (the Tanod restarted), so every bet was refunded. Start a new one with `/race`!', allowedMentions: { parse: [] } }).catch(() => {});
  }
}
