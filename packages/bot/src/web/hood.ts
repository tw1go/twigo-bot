import type { Client } from 'discord.js';
import type { HoodHouse, HouseLook, TownHoodActionResponse, TownHoodResponse } from '@mikazuki/shared';
import { config } from '../config.js';
import { db } from '../db/db.js';
import { balance, fencedUntil, halveFence, take } from '../credits/store.js';
import { masterKeys } from '../dig/store.js';
import { jailedUntil } from '../games/jail.js';
import { stealCooldown, stealFrom } from '../games/steal.js';
import { kowen } from '../kowens.js';
import { potionCount, usePotion } from '../potions/potions.js';
import { hoodMap } from './hood-map.js';
import { getNickname } from './nickname.js';
import { titleOf } from './titles.js';
import { feed } from './town-feed.js';
import type { TownMap } from './town.js';

// 🏘️ The neighbourhood (GET /town/hood, POST /town/house, POST /town/hood): every member may build one house, free, on
// the next lot (web/hood-map.ts lays them out); a new look for it later costs REPAINT_COST. Clicking someone's house
// is /steal on them (games/steal.ts, same odds, cooldown, fine and jail): a house with a Bakod has a fence round it,
// open only to a Master Key (50% it snaps), or rusted with a Kalawang Potion (halves the Bakod, as /potion use).
// Each attempt is posted in the games channel like /steal's, and shows in the town's feed. Houses can be robbed
// whether their owner is around or not.

export const REPAINT_COST = 3;

interface Row {
  user_id: string;
  lot: number;
  style: string;
  look: string;
}

const allStmt = db.prepare<[], Row>('SELECT user_id, lot, style, look FROM houses ORDER BY lot');
const mineStmt = db.prepare<[string], Row>('SELECT user_id, lot, style, look FROM houses WHERE user_id = ?');
const lotStmt = db.prepare<[number], Row>('SELECT user_id, lot, style, look FROM houses WHERE lot = ?');
const insertStmt = db.prepare('INSERT INTO houses (user_id, lot, style, look, built) VALUES (?, (SELECT COALESCE(MAX(lot) + 1, 0) FROM houses), ?, ?, ?)');
const updateStmt = db.prepare('UPDATE houses SET style = ?, look = ? WHERE user_id = ?');

const NAME = /^[a-z0-9-]{1,24}$/;

/** A house's look if `body` is one: a house type and up to 16 slot → swatch names (the game knows which exist and
 *  ignores the rest, as with outfits). */
export function parseHouseLook(body: unknown): HouseLook | null {
  if (!body || typeof body !== 'object') return null;
  const { style, colours } = body as { style?: unknown; colours?: unknown };
  if (typeof style !== 'string' || !NAME.test(style) || !colours || typeof colours !== 'object' || Array.isArray(colours)) return null;
  const entries = Object.entries(colours as Record<string, unknown>);
  if (entries.length > 16 || !entries.every(([k, v]) => NAME.test(k) && typeof v === 'string' && NAME.test(v))) return null;
  return { style, colours: Object.fromEntries(entries) as Record<string, string> };
}

const lookOf = (r: Row): HouseLook => ({ style: r.style, colours: JSON.parse(r.look) as Record<string, string> });
export const houseOf = (userId: string): HouseLook | null => {
  const r = mineStmt.get(userId);
  return r ? lookOf(r) : null;
};

/** The live server's map of the neighbourhood (steps are checked against it), kept until a house is built. */
let cached: { houses: number; map: TownMap } | null = null;
export function hoodTownMap(): TownMap {
  const houses = allStmt.all().length;
  if (cached?.houses !== houses) {
    const m = hoodMap(houses);
    cached = { houses, map: { size: m.size, spawn: m.spawn, blocked: m.blocked } };
  }
  return cached.map;
}

export async function townHood(userId: string, names: (id: string) => Promise<string>): Promise<TownHoodResponse> {
  const rows = allStmt.all();
  const fenced = new Set(rows.filter((r) => fencedUntil(r.user_id)).map((r) => r.lot));
  const houses: HoodHouse[] = await Promise.all(
    rows.map(async (r) => ({
      lot: r.lot,
      owner: getNickname(r.user_id) ?? (await names(r.user_id)),
      title: titleOf(r.user_id),
      ...lookOf(r),
      fenced: fenced.has(r.lot),
      ...(r.user_id === userId ? { mine: true } : {}),
    })),
  );
  const mine = rows.find((r) => r.user_id === userId);
  return {
    map: hoodMap(rows.length, fenced),
    houses,
    me: {
      house: mine ? lookOf(mine) : null,
      kowens: balance(userId),
      keys: masterKeys(userId),
      kalawang: potionCount(userId, 'kalawang'),
      stealAt: stealCooldown(userId),
      jailed: !!jailedUntil(userId),
      repaintCost: REPAINT_COST,
    },
  };
}

/** Builds the member's house (free, on the next lot) or gives it a new look (REPAINT_COST Kowens). */
export async function saveHouse(userId: string, look: HouseLook, names: (id: string) => Promise<string>): Promise<TownHoodActionResponse> {
  const done = async (ok: boolean, message: string) => ({ ...(await townHood(userId, names)), ok, message });
  const had = houseOf(userId);
  if (!had) {
    insertStmt.run(userId, look.style, JSON.stringify(look.colours), Date.now());
    const name = getNickname(userId) ?? (await names(userId));
    feed('shop', `${name} built a house in the neighbourhood`, 'shop');
    return done(true, 'Your house is built! Welcome to the neighbourhood.');
  }
  if (had.style === look.style && JSON.stringify(had.colours) === JSON.stringify(look.colours)) return done(false, "That's how your house looks already.");
  if (balance(userId) < REPAINT_COST) return done(false, `A new look for your house is ${REPAINT_COST} ${kowen(REPAINT_COST)}, and you have ${balance(userId)}.`);
  take(userId, REPAINT_COST);
  updateStmt.run(look.style, JSON.stringify(look.colours), userId);
  return done(true, `Your house has a new look! (−${REPAINT_COST} ${kowen(REPAINT_COST)})`);
}

/** Posts in the games channel (pinging the people in it, as /steal and /potion do). */
async function post(client: Client, content: string, users: string[]): Promise<void> {
  const channel = await client.channels.fetch(config.gamesChannelId).catch(() => null);
  if (channel?.isSendable()) await channel.send({ content, allowedMentions: { users: [...new Set(users)] } }).catch((err) => console.error('[hood] post failed:', err));
}

/** Someone's house, clicked: steal (with a Master Key on a Bakod: 'key'), or throw a Kalawang Potion at its Bakod. */
export async function hoodAction(client: Client, userId: string, action: 'steal' | 'key' | 'kalawang', lot: number, names: (id: string) => Promise<string>): Promise<TownHoodActionResponse> {
  const done = async (ok: boolean, message: string, extra: { busted?: boolean; stole?: number } = {}) => ({ ...(await townHood(userId, names)), ok, message, ...extra });
  const house = lotStmt.get(lot);
  if (!house) return done(false, 'Nobody lives there.');
  const owner = house.user_id;
  if (owner === userId) return done(false, "That's your own house!");
  if (jailedUntil(userId)) return done(false, "You're in jail. No house calls till you're out.");
  const me = getNickname(userId) ?? (await names(userId));
  const them = getNickname(owner) ?? (await names(owner));

  if (action === 'kalawang') {
    const until = fencedUntil(owner);
    if (!until) return done(false, `${them}'s house has no Bakod to rust.`);
    if (!usePotion(userId, 'kalawang')) return done(false, 'You have no Kalawang Potion. Get one at the rewards shop.');
    const now = halveFence(owner)!;
    await post(client, `🧪💥 <@${userId}> threw a **Kalawang Potion** at <@${owner}>'s 🧱 Bakod in the neighbourhood! Half of it rusted away 🟫\n-# Their Bakod now ends <t:${Math.floor(now / 1000)}:R>.`, [owner]);
    feed('steal', `${me} rusted ${them}'s Bakod with a Kalawang Potion`, 'lose');
    return done(true, `Half of ${them}'s Bakod rusted away. It holds until ${new Date(now).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: config.timezone })}.`);
  }

  const result = await stealFrom(userId, owner, action === 'key', `Caught breaking into ${them}'s house`);
  if (!result.ok) {
    switch (result.reason) {
      case 'cooldown': return done(false, `You're laying low. Try again in ${Math.ceil((result.until - Date.now()) / 60_000)} min.`);
      case 'broke': return done(false, 'You need at least 2 Kowens to try (in case you get caught).');
      case 'poor': return done(false, `${them} only has ${result.have} ${kowen(result.have)}. Pick on someone richer.`);
      case 'fenced': return done(false, result.keys ? `${them}'s house has a Bakod. Use a Master Key to get past it.` : `${them}'s house has a Bakod. You need a Master Key to get past it.`);
      default: return done(false, "You can't rob yourself.");
    }
  }
  const pings = [userId, owner];
  if (result.outcome === 'key-snapped') {
    await post(client, `🗝️💥 <@${userId}> tried a **Master Key** on <@${owner}>'s 🧱 Bakod in the neighbourhood… and the key **snapped**! The Bakod holds. 🔒`, pings);
    feed('steal', `${me}'s Master Key snapped on ${them}'s Bakod`, 'lose');
    return done(true, 'Your Master Key snapped! The Bakod holds.');
  }
  const intro = result.key ? `🗝️🔓 <@${userId}> used a **Master Key** to break through <@${owner}>'s Bakod!\n` : '';
  if (result.outcome === 'stole') {
    await post(client, `${intro}🥷 <@${userId}> sneaked into <@${owner}>'s house in the neighbourhood and stole **${result.amount}** ${kowen(result.amount)}! 💰`, pings);
    feed('steal', `${me} robbed ${them}'s house: ${result.amount} ${kowen(result.amount)}`, 'win', { userId });
    return done(true, `You got away with ${result.amount} ${kowen(result.amount)}!`, { stole: result.amount });
  }
  await post(client, `${intro}🚨 **CAUGHT!** The Tanod caught <@${userId}> breaking into <@${owner}>'s house! <@${userId}> pays <@${owner}> a fine of **${result.fine}** ${kowen(result.fine)} and spends **${result.minutes} minutes** in jail. 🚔`, pings);
  feed('steal', `The Tanod caught ${me} breaking into ${them}'s house`, 'bust', { userId });
  return done(true, `Huli ka! You pay ${them} a fine of ${result.fine} ${kowen(result.fine)} and spend ${result.minutes} minutes in jail.`, { busted: true });
}
