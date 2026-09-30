import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Client } from 'discord.js';
import { config } from '../config.js';
import { add } from '../credits/store.js';
import { kowen } from '../kowens.js';

// Daily jackpot: tickets cost 1 Kowen each (up to MAX_TICKETS per person). At draw time a random ticket wins
// the whole pot. Needs at least 2 players, otherwise everyone is refunded.
export const MAX_TICKETS = 5;
export const DRAW_LABEL = '10:00 PM';

const DIR = 'data';
const FILE = `${DIR}/jackpot.json`;
let tickets: Record<string, number> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};

function save(): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(tickets));
}

export const ticketsOf = (userId: string) => tickets[userId] ?? 0;
export const pot = () => Object.values(tickets).reduce((a, b) => a + b, 0);
export const players = () => Object.keys(tickets).length;
/** Everyone in tonight's draw, most tickets first. */
export const entries = () => Object.entries(tickets).sort(([, a], [, b]) => b - a);

// The last draw, for the /jackpot status card.
export interface LastDraw {
  at: number;
  winner: string | null; // null = refunded (fewer than 2 players)
  pot: number;
  players: number;
}
const LAST_FILE = `${DIR}/jackpot-last.json`;
let last: LastDraw | null = existsSync(LAST_FILE) ? JSON.parse(readFileSync(LAST_FILE, 'utf8')) : null;
export const lastDraw = () => last;
function saveLast(draw: LastDraw): void {
  last = draw;
  mkdirSync(DIR, { recursive: true });
  writeFileSync(LAST_FILE, JSON.stringify(draw));
}

/** Records bought tickets (caller has already taken the credits). */
export function addTickets(userId: string, count: number): void {
  tickets[userId] = ticketsOf(userId) + count;
  save();
}

export async function drawJackpot(client: Client): Promise<void> {
  const entries = Object.entries(tickets);
  if (entries.length === 0) return;

  const channel = await client.channels.fetch(config.gamesChannelId);
  if (!channel?.isSendable()) throw new Error(`Channel ${config.gamesChannelId} not found or not sendable`);

  const total = pot();
  tickets = {};
  save();

  if (entries.length < 2) {
    const [[id, n]] = entries;
    add(id, n);
    saveLast({ at: Date.now(), winner: null, pot: total, players: 1 });
    await channel.send({
      content: `🎰 **Jackpot draw:** only <@${id}> joined tonight, so their **${n}** ${kowen(n)} ${n === 1 ? 'was' : 'were'} refunded. Bring friends tomorrow!`,
      allowedMentions: { parse: [] },
    });
    return;
  }

  let pick = Math.random() * total;
  const [winner] = entries.find(([, n]) => (pick -= n) < 0) ?? entries[entries.length - 1];
  add(winner, total);
  saveLast({ at: Date.now(), winner, pot: total, players: entries.length });
  await channel.send({
    content: `🎰 **JACKPOT!** <@${winner}> wins the pot of **${total} ${kowen(total)}** from ${entries.length} players! 🤑🎉`,
    allowedMentions: { users: [winner] },
  });
}
