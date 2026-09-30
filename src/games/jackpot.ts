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

  // Pick and pay first, so a restart mid-animation can't lose the pot.
  const pickWeighted = () => {
    let pick = Math.random() * total;
    return (entries.find(([, n]) => (pick -= n) < 0) ?? entries[entries.length - 1])[0];
  };
  const winner = pickWeighted();
  add(winner, total);
  saveLast({ at: Date.now(), winner, pot: total, players: entries.length });

  // Slot-machine reveal: edit one message through weighted random names, slowing down, landing on the winner.
  // Edits stay ~1s+ apart to respect Discord's rate limits, and edits never ping anyone.
  const guild = 'guild' in channel ? channel.guild : null;
  const names = new Map<string, string>();
  for (const [id] of entries) {
    const member = await guild?.members.fetch(id).catch(() => null);
    names.set(id, member?.displayName ?? (await client.users.fetch(id).catch(() => null))?.displayName ?? 'someone');
  }
  const header = `🎰 **Drawing the jackpot…** 🪙 **${total} ${kowen(total)}** · ${entries.length} players`;
  const frame = (name: string, mark = '🎟️') => `${header}\n\n## ${mark} ${name} ${mark}`;

  const message = await channel.send({ content: frame('❔ ❔ ❔', '🎲'), allowedMentions: { parse: [] } });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const delays = [1000, 1000, 1100, 1200, 1400, 1700, 2100];
  let previous = '';
  try {
    for (const delay of delays) {
      await sleep(delay);
      let id = pickWeighted();
      if (entries.length > 1) for (let tries = 0; id === previous && tries < 5; tries++) id = pickWeighted(); // keep it visibly moving
      previous = id;
      await message.edit({ content: frame(names.get(id)!), allowedMentions: { parse: [] } });
    }
    await sleep(2500);
  } catch (err) {
    console.error('[jackpot] animation failed:', err); // the winner is already paid; just reveal
  }

  await message
    .edit({
      content: `🎉 **JACKPOT!** 🎉\n\n## 🏆 <@${winner}> 🏆\nwins the pot of **${total} ${kowen(total)}** from ${entries.length} players! 🤑`,
      allowedMentions: { parse: [] },
    })
    .catch((err) => console.error('[jackpot] reveal failed:', err));
  // Edits don't notify, so tell the winner with one small ping.
  await message
    .reply({ content: `🎊 Congrats <@${winner}>, you won the jackpot! Check \`/balance\` 🪙`, allowedMentions: { users: [winner] } })
    .catch(() => {});
}
