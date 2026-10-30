import { kvLoad, kvSave } from '../db/db.js';
import { tableSync } from '../db/sync.js';
import { markFound } from './found.js';
import type { Client } from 'discord.js';
import { Cron } from 'croner';
import { config } from '../config.js';
import { add, balance, take } from '../credits/store.js';
import { kowen } from '../kowens.js';
import { announce, townName } from '../web/town-feed.js';

// A draw the bot missed (down at 10:00, or Discord not answering then: 30 Oct 2026, the 10 AM draw) is caught up: the
// time each draw ran is kept (kv 'jackpot-ran-at', drawn, refunded or empty), and `catchUpJackpot` (at startup and
// hourly) draws when the latest scheduled draw is past that and tickets wait, taking only the tickets bought before it was
// due (kv 'jackpot-buys' keeps when each was bought): the rest wait for the next draw. The channel is fetched with retries.
// Jackpot, drawn twice a day: tickets cost 1 Kowen each (up to MAX_TICKETS per person per draw). At draw time a random ticket wins
// the whole pot. Needs at least 2 players, otherwise everyone is refunded. The pot also holds raid money: RAID_SHARE of
// every bet the Tanod confiscates (games/gamble.ts). It goes to the next winner, and rolls over when there's no winner.
export const MAX_TICKETS = 5;
export const DRAW_LABEL = '10 AM & 10 PM';
/** Draws happen at 10 AM and 10 PM (config.timezone). */
export const DRAW_CRON = '0 10,22 * * *';
/** When the next draw happens. */
export const nextDraw = () => new Cron(DRAW_CRON, { timezone: config.timezone }).nextRun()!;
/** The latest scheduled draw at or before `now` (the one that should have run by now). */
export const dueDraw = (now = new Date()) => new Cron(DRAW_CRON, { timezone: config.timezone }).previousRuns(1, now)[0] ?? null;
/** A draw the bot missed: the draw due before `now` is later than the last run, and `now` is past it by `graceMs`
 *  (the scheduled job itself gets that long first). */
export const drawMissed = (now: Date, ranAt: number, graceMs = 120_000): boolean => {
  const due = dueDraw(now);
  return !!due && due.getTime() > ranAt && now.getTime() - due.getTime() >= graceMs;
};
const UNDERDOG_BONUS = 10;
/** The share of a confiscated bet that goes into the pot (rounded down). */
export const RAID_SHARE = 0.7;

// Tickets for the next draw live in `jackpot_tickets`; the last draw is a kv document.
const table = tableSync<{ user_id: string; tickets: number }>('jackpot_tickets', ['user_id'], ['tickets']);
let tickets: Record<string, number> = Object.fromEntries(table.load().map((r) => [r.user_id, r.tickets]));

// When each member's tickets were bought (kv), so a draw made late takes only the tickets bought before it was due and
// leaves the rest for the next draw (30 Oct 2026: a catch-up draw at 10:46 took tickets bought at 10:03 for the 10 PM one).
const BUYS_KEY = 'jackpot-buys';
export type TicketBuy = { n: number; at: number };
let buys: Record<string, TicketBuy[]> = kvLoad(BUYS_KEY, {});

function save(): void {
  table.save(Object.entries(tickets).filter(([, n]) => n > 0).map(([user_id, n]) => ({ user_id, tickets: n })));
  kvSave(BUYS_KEY, buys);
}

/** A draw's tickets: of what everyone holds, the tickets bought at or before `until` (the draw's due time) are `drawn`
 *  and the later ones `kept` for the next draw with their buys. Tickets with no buy recorded (from before buys were
 *  kept) count as bought before. */
export function splitTickets(held: Record<string, number>, bought: Record<string, TicketBuy[]>, until: number): {
  drawn: Record<string, number>;
  kept: Record<string, number>;
  keptBuys: Record<string, TicketBuy[]>;
} {
  const drawn: Record<string, number> = {};
  const kept: Record<string, number> = {};
  const keptBuys: Record<string, TicketBuy[]> = {};
  for (const [id, n] of Object.entries(held)) {
    if (n <= 0) continue;
    const later = (bought[id] ?? []).filter((b) => b.at > until);
    const after = Math.min(n, later.reduce((a, b) => a + b.n, 0));
    if (n - after > 0) drawn[id] = n - after;
    if (after > 0) {
      kept[id] = after;
      keptBuys[id] = later;
    }
  }
  return { drawn, kept, keptBuys };
}

/** "1 jackpot ticket", "3 jackpot tickets". */
export const ticketWord = (n: number) => `${n} jackpot ticket${n === 1 ? '' : 's'}`;
export const ticketsOf = (userId: string) => tickets[userId] ?? 0;
/** Tickets in the next draw (the odds are counted on these). */
export const ticketTotal = () => Object.values(tickets).reduce((a, b) => a + b, 0);
// Raid money waiting in the pot (a kv number).
const RAID_KEY = 'jackpot-raid';
let raid: number = kvLoad(RAID_KEY, 0);
export const raidMoney = () => raid;
function setRaid(n: number): void {
  raid = n;
  kvSave(RAID_KEY, n);
}
/** The whole pot: tickets and raid money. */
export const pot = () => ticketTotal() + raid;

/** Puts RAID_SHARE of a confiscated bet into the pot; returns how much went in. */
export function addRaidMoney(confiscated: number): number {
  const share = Math.floor(confiscated * RAID_SHARE);
  if (share > 0) setRaid(raid + share);
  return share;
}
export const players = () => Object.keys(tickets).length;
/** Everyone in the next draw, most tickets first. */
export const entries = () => Object.entries(tickets).sort(([, a], [, b]) => b - a);

// The last draw, for the /jackpot status card.
export interface LastDraw {
  at: number;
  winner: string | null; // null = refunded (fewer than 2 players)
  pot: number;
  players: number;
}
const LAST_KEY = 'jackpot-last.json'; // kv key (its old file name)
let last: LastDraw | null = kvLoad(LAST_KEY, null);
export const lastDraw = () => last;
// When a draw last ran to its end (drawn, refunded or with nobody in it): what a missed draw is measured against. Before
// this was kept, the last draw's time.
const RAN_KEY = 'jackpot-ran-at';
let ranAt: number = kvLoad(RAN_KEY, (last as LastDraw | null)?.at ?? 0);
export const lastRanAt = () => ranAt;
function markRan(at = Date.now()): void {
  ranAt = at;
  kvSave(RAN_KEY, at);
}
/** A draw under way (the scheduled one or a catch-up): the other waits. */
let drawing = false;
function saveLast(draw: LastDraw): void {
  last = draw;
  kvSave(LAST_KEY, draw);
}

/** Records bought tickets (caller has already taken the credits; /gift jackpot gives them free) and when. */
export function addTickets(userId: string, count: number, at = Date.now()): void {
  tickets[userId] = ticketsOf(userId) + count;
  (buys[userId] ??= []).push({ n: count, at });
  save();
}

/** Buys up to `count` tickets (as many as fit under the max), paying 1 Kowen each. The caller checks jail. */
export function buyTickets(userId: string, count: number): { bought: number } | { refused: 'max' | 'kowens'; need: number } {
  const room = MAX_TICKETS - ticketsOf(userId);
  if (room <= 0) return { refused: 'max', need: 0 };
  const buy = Math.min(count, room);
  if (balance(userId) < buy) return { refused: 'kowens', need: buy };
  take(userId, buy);
  addTickets(userId, buy);
  return { bought: buy };
}

/** Draws the tickets bought by `until` (now for a draw on time; the due time for one caught up late). */
export async function drawJackpot(client: Client, until = Date.now()): Promise<void> {
  if (drawing) return;
  drawing = true;
  try {
    await draw(client, until);
  } finally {
    drawing = false;
  }
}

/** The games channel, asked for up to `tries` times (Discord not answering at the minute shouldn't cost the draw). */
async function gamesChannel(client: Client, tries = 3) {
  let lastErr: unknown = null;
  for (let i = 0; i < tries; i++) {
    try {
      const channel = await client.channels.fetch(config.gamesChannelId);
      if (channel?.isSendable()) return channel;
      lastErr = new Error(`Channel ${config.gamesChannelId} not found or not sendable`);
    } catch (err) {
      lastErr = err;
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, 3000));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function draw(client: Client, until: number): Promise<void> {
  const { drawn, kept, keptBuys } = splitTickets(tickets, buys, until);
  const entries = Object.entries(drawn);
  if (entries.length === 0) return markRan(); // (nothing bought for this draw: it's done; later buys wait for the next)

  const channel = await gamesChannel(client); // (fails: the tickets stay, the catch-up tries again within the hour)

  const ticketsIn = entries.reduce((a, [, n]) => a + n, 0);
  const total = ticketsIn + raid;
  tickets = kept;
  buys = keptBuys;
  save();

  if (entries.length < 2) {
    // Refunded; any raid money stays in the pot for the next draw.
    const [[id, n]] = entries;
    add(id, n);
    saveLast({ at: Date.now(), winner: null, pot: n, players: 1 });
    markRan();
    await channel.send({
      content: `🎰 **Jackpot draw:** only <@${id}> joined this draw, so their **${n}** ${kowen(n)} ${n === 1 ? 'was' : 'were'} refunded. Bring friends next time!`,
      allowedMentions: { parse: [] },
    });
    return;
  }

  // Pick and pay first, so a restart mid-animation can't lose the pot.
  const pickWeighted = () => {
    let pick = Math.random() * ticketsIn;
    return (entries.find(([, n]) => (pick -= n) < 0) ?? entries[entries.length - 1])[0];
  };
  const winner = pickWeighted();
  add(winner, total);
  setRaid(0); // the raid money went with the pot
  // 🤫 Lucky Underdog: won with a single ticket against 3+ players.
  const underdog = (entries.find(([id]) => id === winner)?.[1] ?? 0) === 1 && entries.length >= 3;
  if (underdog) {
    add(winner, UNDERDOG_BONUS);
    markFound(winner, 'underdog');
  }
  saveLast({ at: Date.now(), winner, pot: total, players: entries.length });
  markRan();

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
      content: `🎉 **JACKPOT!** 🎉\n\n## 🏆 <@${winner}> 🏆\nwins the pot of **${total} ${kowen(total)}** from ${entries.length} players! 🤑` +
        (underdog ? `\n🍀 **LUCKY UNDERDOG!** Won with just **1 ticket**, so here's **+${UNDERDOG_BONUS}** bonus!` : ''),
      allowedMentions: { parse: [] },
    })
    .catch((err) => console.error('[jackpot] reveal failed:', err));
  // The web town gets a banner too.
  const user = await client.users.fetch(winner).catch(() => null);
  announce({
    kind: 'jackpot',
    title: 'Jackpot!',
    text: `${user ? townName(user) : 'Someone'} won the pot of ${total} ${kowen(total)} from ${entries.length} players${underdog ? ', with just 1 ticket' : ''}!`,
  });
  // Edits don't notify, so tell the winner with one small ping.
  await message
    .reply({ content: `🎊 Congrats <@${winner}>, you won the jackpot! Check \`/balance\` 🪙`, allowedMentions: { users: [winner] } })
    .catch(() => {});
}

/** A draw the bot missed (down at the hour, or Discord not answering then): drawn now, with a line in the log; nothing
 *  to do while the scheduled draws run on time. At startup and hourly (scheduler.ts). */
export async function catchUpJackpot(client: Client, now = new Date()): Promise<void> {
  if (!drawMissed(now, ranAt)) return;
  const due = dueDraw(now)!;
  if (Object.keys(tickets).length === 0) return markRan(now.getTime()); // (nobody was in it: done)
  console.log(`[jackpot] the draw due ${due.toISOString()} was missed (last ran ${new Date(ranAt).toISOString()}): drawing now (tickets bought after it wait for the next)`);
  await drawJackpot(client, due.getTime());
}
