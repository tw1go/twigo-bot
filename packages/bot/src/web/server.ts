import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { LeaderboardResponse, LeaderboardRow, MeDig, MeResponse, PresenceStatus, PreregResponse, PreregStatus, TownJackpotBuyResponse, TownJackpotResponse, TownLeaderboardResponse } from '@mikazuki/shared';
import { GatewayIntentBits, type Client } from 'discord.js';
import { config } from '../config.js';
import { balance, rankOf, setWalletHook, topBalances, totalKowens, vaultBalance } from '../credits/store.js';
import { DIGS_PER_DAY, digsToday, inventory, LUCKY_EVERY, serverDigProgress, SHOVEL_COST, SHOVEL_USES, SHOVELS_PER_DAY, shovelsBoughtToday, shovelUses } from '../dig/store.js';
import { ITEM_BY_ID } from '../dig/items.js';
import { getNickname, parseNickname, setNickname } from './nickname.js';
import { titleIsNew, titleOf, titleSeen } from './titles.js';
import { attachTown, loadTownMap } from './town.js';
import { bridgeTownChat } from './town-chat.js';
import { connectTownFeed, feed } from './town-feed.js';
import { MAX_TICKETS, buyTickets, entries, lastDraw, nextDraw, pot, raidMoney, ticketWord, ticketsOf } from '../games/jackpot.js';
import { jailedUntil } from '../games/jail.js';
import { bankAction, townBank } from './town-bank.js';
import { buyFromShop, townShop } from './town-shop.js';
import { type PlayerDeps, giveInTown, playerInfo, verdictInTown } from './town-player.js';
import type { Town } from './town.js';
import { bailFromTown, townOutpost } from './town-outpost.js';
import { digInTown } from './town-mine.js';
import { gambleInTown } from './town-casino.js';
import { parlorAction, townParlor } from './town-parlor.js';
import { flexInTown, sellInTown, sellManyInTown, townInventory } from './town-bag.js';
import { boardAction, townBoard } from './town-board.js';
import { townNews } from './town-news.js';
import { useMegaphone } from '../items/megaphone.js';
import { claimStay, stayInfo, stayMinute } from './town-stay.js';
import { arenaBets, refundHeldBets } from './town-arena-bets.js';
import { kowen } from '../kowens.js';
import { filterText, kickedUntil, mutedUntil } from './town-mod.js';
import { getOutfit, parseOutfit, saveOutfit } from './outfit.js';
import { LAUNCH_REWARD, isPreregistered, launched, preregCount, preregister } from '../prereg/prereg.js';
import { callback, clearSessionCookie, endSessions, isMember, login, loginEnabled, logout, sessionUser } from './auth.js';
import { roll } from './finds.js';
import { type CmsDeps, cms } from './cms.js';

// A tiny HTTP API for twigo's room (tw1go.github.io). Read-only apart from
// the find roll, which only ever hands out a claim code — Kowens are
// credited in Discord by /claim, never over HTTP.
//
// Listens on localhost only. Caddy sits in front on the server and adds
// HTTPS (deploy/Caddyfile), which the site needs: a page served over HTTPS
// may not call a plain-HTTP address.
//
//   GET  /leaderboard   top 10 by Kowens, with display names and avatars
//   POST /find          { character, fairy? } -> { found, code?, expires? }
//   GET  /health        "ok"
//
// Web game (/play, same origin, so no CORS): Discord login (see auth.ts) and
//   GET  /me            the logged-in member: name, avatar, Kowens, items (401 if not logged in or not in the server)
//   GET  /prereg        pre-registration status: open, count, reward (public)
//   POST /prereg        pre-register the logged-in member (from the game's page only)
//   PUT  /outfit        save the logged-in member's first character look, in the creator (from the game's page only)
//   PUT  /nickname      { nickname } -> 200 { nickname } | 400 invalid | 409 taken (from the game's page only)
//   GET  /town/leaderboard  top 10 by Kowens with town nicknames and titles, and the viewer's rank (members)
//   GET  /town/news     the latest announcements and patch notes from Discord (members)
//   GET  /town/jackpot  the jackpot booth: pot, players, the viewer's tickets, next and last draw (members)
//   POST /town/jackpot  { tickets } buy jackpot tickets (from the game's page only; members)
//   GET  /town/bank     wallet, vault and loans (members)
//   POST /town/bank     { action: deposit|withdraw|borrow|repay, amount? } (from the game's page only; members)
//   GET  /town/shop     the rewards shop: what /redeem sells, as the viewer sees it (members)
//   POST /town/shop     { id, quantity } redeem a reward (from the game's page only; members)
//   GET  /town/player?id=  another player in town (by town id): /balance and /status for them (members)
//   POST /town/give     { to, amount } give Kowens to a player in town (from the game's page only; members)
//   POST /town/verdict  { to, mode: diss|praise|judge } on a player in town, 1 Kowen (from the game's page only; members)
//   GET  /town/outpost  the Tanod outpost: who's in jail and how Tanod Patrol works (members)
//   POST /town/bail     { id } bail someone out (yourself or a friend), /bail's rules (from the game's page only; members)
//   GET  /town/board    the notice board: open and in-progress quests (members)
//   POST /town/board    { action: post|accept|giveup|complete|cancel, id? | task + reward } (from the game's page only; members)
//   GET  /town/inventory  the bag: dug-up items, Master Keys and potions, slots, wallet (members)
//   POST /town/sell     { id, quantity } (or { items: [{ id, quantity }] }) sell dug-up items, /sell's prices (from the game's page only; members)
//   POST /town/flex     { id } flex a dug-up item in the games channel, /flex's cooldown (from the game's page only; members)
//   POST /town/gamble   { bet, call: kara|krus } Kara y Krus at the Casino, /gamble's odds (from the game's page only; members)
//   GET  /town/parlor   the Parlor: the viewer's look, Kowens, and the titles they have (members)
//   POST /town/parlor   { action: look, outfit } (3 Kowens) | { action: title, id } (free) (from the game's page only; members)
//   POST /town/dig      dig at the Mine (/dig's rules; from the game's page only; members)
//   POST /title/seen    the game showed the member their new title (from the game's page only)
//   CMS_PATH/*          the CMS, for the gifter (see cms.ts)
//   WS   /ws            the live town: who else is there and where (see town.ts; from the game's page only)

const ALLOWED_ORIGINS = new Set([
  'https://tw1go.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
]);

/** Leaderboard responses are reused this long, so a burst of visitors is one lookup. */
const BOARD_TTL_MS = 30_000;
/** Names and avatars change rarely; looked up at most this often per member. */
const PROFILE_TTL_MS = 60 * 60_000;

interface Profile {
  name: string;
  avatar: string;
  at: number;
}

const profiles = new Map<string, Profile>();
let board: { at: number; body: string } | null = null;

async function profile(client: Client, id: string): Promise<Profile> {
  const cached = profiles.get(id);
  if (cached && Date.now() - cached.at < PROFILE_TTL_MS) return cached;
  // The server nickname if there is one, else their Discord display name.
  // Single-member fetches do not need the privileged members intent.
  const channel = await client.channels.fetch(config.gamesChannelId).catch(() => null);
  const guild = channel && 'guild' in channel ? channel.guild : null;
  const member = guild ? await guild.members.fetch(id).catch(() => null) : null;
  const user = member?.user ?? (await client.users.fetch(id).catch(() => null));
  const fresh = {
    name: member?.displayName ?? user?.globalName ?? user?.username ?? 'someone',
    avatar: (member ?? user)?.displayAvatarURL({ size: 64, extension: 'png' }) ?? '',
    at: Date.now(),
  };
  profiles.set(id, fresh);
  return fresh;
}

async function leaderboard(client: Client): Promise<string> {
  if (board && Date.now() - board.at < BOARD_TTL_MS) return board.body;
  const top = topBalances(10);
  const rows = await Promise.all(
    top.map(async ([id, kowens], i) => {
      const { name, avatar } = await profile(client, id);
      return { rank: i + 1, name, avatar, kowens } satisfies LeaderboardRow;
    }),
  );
  const body = JSON.stringify({ updated: Date.now(), rows } satisfies LeaderboardResponse);
  board = { at: Date.now(), body };
  return body;
}

/** The visitor's address. Behind Caddy the socket is always localhost, so
 *  the real one is the first hop of X-Forwarded-For — trusted only then. */
function clientIp(req: IncomingMessage): string {
  const socket = req.socket.remoteAddress ?? '';
  const forwarded = req.headers['x-forwarded-for'];
  if ((socket === '127.0.0.1' || socket === '::1' || socket === '::ffff:127.0.0.1') && typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return socket;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => {
      data += chunk;
      // Nothing legitimate is anywhere near this big.
      if (data.length > 1024) req.destroy();
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: string, type = 'application/json', headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

/** The member's dot in the town: jailed, else their Discord status (needs the Presence intent; Discord leaves
 *  offline and invisible members out). Without the intent: online, as they're in the town right now. */
async function statusOf(client: Client, userId: string): Promise<PresenceStatus> {
  if (jailedUntil(userId)) return 'jailed';
  if (!client.options.intents.has(GatewayIntentBits.GuildPresences)) return 'online';
  const channel = await client.channels.fetch(config.gamesChannelId).catch(() => null);
  const guild = channel && 'guild' in channel ? channel.guild : null;
  const status = guild?.presences.cache.get(userId)?.status;
  return status === 'dnd' ? 'busy' : status === 'idle' ? 'idle' : status === 'online' ? 'online' : 'offline';
}

/** Digs left today and on the shovel, and shovels left to buy (for /me and the Mine). */
function digStatus(userId: string): MeDig {
  return {
    shovel: shovelUses(userId),
    digsLeft: Math.max(0, DIGS_PER_DAY - digsToday(userId)),
    digsPerDay: DIGS_PER_DAY,
    shovelsLeft: Math.max(0, SHOVELS_PER_DAY - shovelsBoughtToday(userId)),
    shovelCost: SHOVEL_COST,
    shovelUses: SHOVEL_USES,
    lucky: serverDigProgress(),
    luckyEvery: LUCKY_EVERY,
  };
}

async function me(client: Client, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const userId = sessionUser(req);
  if (!userId) return send(res, 401, '{"error":"not logged in"}');
  if (!(await isMember(client, userId))) {
    endSessions(userId); // left the server
    return send(res, 401, '{"error":"not logged in"}', 'application/json', { 'Set-Cookie': clearSessionCookie() });
  }
  const { name, avatar } = await profile(client, userId);
  const items = inventory(userId).map(([id, count]) => {
    const item = ITEM_BY_ID.get(id)!;
    return { id, name: item.name, emoji: item.emoji, rarity: item.rarity, count };
  });
  const body: MeResponse = { id: userId, name, avatar, kowens: balance(userId), vault: vaultBalance(userId), rank: rankOf(userId), items, preregistered: isPreregistered(userId), outfit: getOutfit(userId), nickname: getNickname(userId), title: titleOf(userId), newTitle: titleIsNew(userId), status: await statusOf(client, userId),
    dig: digStatus(userId) };
  send(res, 200, JSON.stringify(body));
}

/** The town's leaderboard: the top 10 by total Kowens with town nicknames and titles, and the viewer's own rank. */
async function townLeaderboard(client: Client, userId: string): Promise<TownLeaderboardResponse> {
  const rows = await Promise.all(
    topBalances(10).map(async ([id, kowens], i) => ({
      rank: i + 1,
      name: getNickname(id) ?? (await profile(client, id)).name,
      title: titleOf(id),
      kowens,
      ...(id === userId ? { me: true } : {}),
      ...(i < 3 ? { outfit: getOutfit(id) } : {}), // the podium shows the top 3's characters
    })),
  );
  return { rows, me: { rank: rankOf(userId), kowens: totalKowens(userId) } };
}

/** A member's name in the town: their nickname, else their Discord name. */
const nameOf = async (client: Client, id: string) => getNickname(id) ?? (await profile(client, id)).name;

/** The jackpot booth as the viewer sees it. */
async function townJackpot(client: Client, userId: string): Promise<TownJackpotResponse> {
  const prev = lastDraw();
  return {
    pot: pot(),
    raid: raidMoney(),
    max: MAX_TICKETS,
    minPlayers: 2,
    nextDraw: nextDraw().getTime(),
    players: await Promise.all(
      entries().map(async ([id, tickets]) => ({ name: await nameOf(client, id), tickets, ...(id === userId ? { me: true } : {}) })),
    ),
    mine: ticketsOf(userId),
    kowens: balance(userId),
    jailedUntil: jailedUntil(userId),
    last: prev && {
      at: prev.at,
      winner: prev.winner && (await nameOf(client, prev.winner)),
      pot: prev.pot,
      players: prev.players,
      ...(prev.winner === userId ? { me: true } : {}),
    },
  };
}

/** Buys jackpot tickets from the town: tells the town's feed and the games channel, like /jackpot does. */
async function buyFromTown(client: Client, userId: string, count: number): Promise<TownJackpotBuyResponse> {
  if (jailedUntil(userId)) return { ...(await townJackpot(client, userId)), refused: 'jailed' };
  const result = buyTickets(userId, count);
  const booth = await townJackpot(client, userId);
  if ('refused' in result) return { ...booth, refused: result.refused };
  const name = await nameOf(client, userId);
  const total = pot();
  feed('jackpot', `${name} bought ${ticketWord(result.bought)} · the pot is ${total} ${kowen(total)}`, 'jackpot');
  const channel = await client.channels.fetch(config.gamesChannelId).catch(() => null);
  if (channel?.isSendable()) {
    await channel
      .send({
        content: `🎟️ <@${userId}> bought **${result.bought}** jackpot ticket(s) in the town! The pot is now **${total}** ${kowen(total)}. Next draw <t:${Math.floor(booth.nextDraw / 1000)}:R>.`,
        allowedMentions: { parse: [] },
      })
      .catch((err) => console.error('[web] jackpot post failed:', err));
  }
  return { ...booth, bought: result.bought };
}

/** Logout and pre-registration must come from the game's own page (SameSite=Lax already keeps other sites' POSTs cookie-less). */
const fromGame = (req: IncomingMessage) => !!config.publicUrl && req.headers.origin === config.publicUrl;

export function startWebServer(client: Client): void {
  const port = config.webPort;
  if (!port) {
    console.log('[web] WEB_PORT not set, room API disabled');
    return;
  }

  let town: Town | null = null; // set once the town is attached, below
  const playerDeps: PlayerDeps = {
    nameOf: (id) => nameOf(client, id),
    statusOf: (id) => statusOf(client, id),
    gifted: (userId, from, amount) => town?.gifted(userId, from, amount),
    verdict: (userId, kind, judged, text) => town?.verdict(userId, kind, judged, text),
  };
  const cmsDeps: CmsDeps = { town: () => town, discordName: async (id) => (await profile(client, id)).name };
  const cmsPath = loginEnabled() ? config.cmsPath : undefined;
  if (cmsPath) console.log('[web] CMS on');

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    try {
      if (cmsPath && (path === cmsPath || path.startsWith(`${cmsPath}/`))) return await cms(client, req, res, url, cmsDeps);
      if (req.method === 'OPTIONS') return void res.writeHead(204).end();
      if (req.method === 'GET' && path === '/health') return send(res, 200, 'ok', 'text/plain');
      if (req.method === 'GET' && path === '/leaderboard') return send(res, 200, await leaderboard(client));
      if (req.method === 'GET' && path === '/prereg') {
        return send(res, 200, JSON.stringify({ open: !launched(), count: preregCount(), reward: LAUNCH_REWARD } satisfies PreregStatus));
      }
      if (req.method === 'POST' && path === '/prereg') {
        if (!loginEnabled()) return send(res, 404, '{"error":"login is off"}');
        if (!fromGame(req)) return send(res, 403, '{"error":"forbidden"}');
        const userId = sessionUser(req);
        if (!userId) return send(res, 401, '{"error":"not logged in"}');
        const result = preregister(userId, 'web');
        return send(res, 200, JSON.stringify({ result, count: preregCount() } satisfies PreregResponse));
      }
      if (req.method === 'PUT' && path === '/outfit') {
        if (!loginEnabled()) return send(res, 404, '{"error":"login is off"}');
        if (!fromGame(req)) return send(res, 403, '{"error":"forbidden"}');
        const userId = sessionUser(req);
        if (!userId) return send(res, 401, '{"error":"not logged in"}');
        let body: unknown = null;
        try {
          body = JSON.parse((await readBody(req)) || 'null');
        } catch {
          // invalid JSON → rejected below
        }
        if (!(await isMember(client, userId))) return send(res, 403, '{"error":"members of the server only"}');
        const outfit = parseOutfit(body);
        if (!outfit) return send(res, 400, '{"error":"invalid outfit"}');
        // Free in the creator only (no look or nickname yet); after that a new look is bought at the Parlor.
        if (getOutfit(userId) && getNickname(userId)) return send(res, 409, '{"error":"change your look at the Parlor"}');
        saveOutfit(userId, outfit);
        return send(res, 200, '{"ok":true}');
      }
      if (req.method === 'GET' && path === '/town/leaderboard') {
        if (!loginEnabled()) return send(res, 404, '{"error":"login is off"}');
        const userId = sessionUser(req);
        if (!userId) return send(res, 401, '{"error":"not logged in"}');
        if (!(await isMember(client, userId))) return send(res, 403, '{"error":"members of the server only"}');
        return send(res, 200, JSON.stringify(await townLeaderboard(client, userId)));
      }
      if (req.method === 'GET' && path === '/town/news') {
        if (!loginEnabled()) return send(res, 404, '{"error":"login is off"}');
        const userId = sessionUser(req);
        if (!userId) return send(res, 401, '{"error":"not logged in"}');
        if (!(await isMember(client, userId))) return send(res, 403, '{"error":"members of the server only"}');
        return send(res, 200, JSON.stringify(await townNews(client)));
      }
      if (path === '/town/jackpot' && (req.method === 'GET' || req.method === 'POST')) {
        if (!loginEnabled()) return send(res, 404, '{"error":"login is off"}');
        if (req.method === 'POST' && !fromGame(req)) return send(res, 403, '{"error":"forbidden"}');
        const userId = sessionUser(req);
        if (!userId) return send(res, 401, '{"error":"not logged in"}');
        let body: { tickets?: unknown } | null = null;
        if (req.method === 'POST') {
          try {
            body = JSON.parse((await readBody(req)) || 'null');
          } catch {
            // invalid JSON → rejected below
          }
        }
        if (!(await isMember(client, userId))) return send(res, 403, '{"error":"members of the server only"}');
        if (req.method === 'GET') return send(res, 200, JSON.stringify(await townJackpot(client, userId)));
        const count = body?.tickets;
        if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_TICKETS) {
          return send(res, 400, '{"error":"invalid tickets"}');
        }
        return send(res, 200, JSON.stringify(await buyFromTown(client, userId, count)));
      }
      if (path === '/town/bank' && (req.method === 'GET' || req.method === 'POST')) {
        if (!loginEnabled()) return send(res, 404, '{"error":"login is off"}');
        if (req.method === 'POST' && !fromGame(req)) return send(res, 403, '{"error":"forbidden"}');
        const userId = sessionUser(req);
        if (!userId) return send(res, 401, '{"error":"not logged in"}');
        let body: { action?: unknown; amount?: unknown } | null = null;
        if (req.method === 'POST') {
          try {
            body = JSON.parse((await readBody(req)) || 'null');
          } catch {
            // invalid JSON → rejected below
          }
        }
        if (!(await isMember(client, userId))) return send(res, 403, '{"error":"members of the server only"}');
        const names = (id: string) => nameOf(client, id);
        if (req.method === 'GET') return send(res, 200, JSON.stringify(await townBank(userId, names)));
        const action = body?.action;
        const amount = body?.amount;
        if (action !== 'deposit' && action !== 'withdraw' && action !== 'borrow' && action !== 'repay') return send(res, 400, '{"error":"invalid action"}');
        if (amount !== undefined && (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > 1_000_000)) {
          return send(res, 400, '{"error":"invalid amount"}');
        }
        return send(res, 200, JSON.stringify(await bankAction(client, userId, action, amount, names)));
      }
      if (path === '/town/shop' && (req.method === 'GET' || req.method === 'POST')) {
        if (!loginEnabled()) return send(res, 404, '{"error":"login is off"}');
        if (req.method === 'POST' && !fromGame(req)) return send(res, 403, '{"error":"forbidden"}');
        const userId = sessionUser(req);
        if (!userId) return send(res, 401, '{"error":"not logged in"}');
        let body: { id?: unknown; quantity?: unknown } | null = null;
        if (req.method === 'POST') {
          try {
            body = JSON.parse((await readBody(req)) || 'null');
          } catch {
            // invalid JSON → rejected below
          }
        }
        if (!(await isMember(client, userId))) return send(res, 403, '{"error":"members of the server only"}');
        if (req.method === 'GET') return send(res, 200, JSON.stringify(townShop(userId)));
        const id = body?.id;
        const quantity = body?.quantity ?? 1;
        if (typeof id !== 'string' || typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
          return send(res, 400, '{"error":"invalid purchase"}');
        }
        return send(res, 200, JSON.stringify(await buyFromShop(client, userId, id, quantity, await nameOf(client, userId))));
      }
      if ((req.method === 'GET' && path === '/town/player') || (req.method === 'POST' && (path === '/town/give' || path === '/town/verdict'))) {
        if (!loginEnabled()) return send(res, 404, '{"error":"login is off"}');
        if (req.method === 'POST' && !fromGame(req)) return send(res, 403, '{"error":"forbidden"}');
        const userId = sessionUser(req);
        if (!userId) return send(res, 401, '{"error":"not logged in"}');
        let body: { to?: unknown; amount?: unknown; mode?: unknown } | null = null;
        if (req.method === 'POST') {
          try {
            body = JSON.parse((await readBody(req)) || 'null');
          } catch {
            // invalid JSON → rejected below
          }
        }
        if (!(await isMember(client, userId))) return send(res, 403, '{"error":"members of the server only"}');
        const playerId = req.method === 'GET' ? url.searchParams.get('id') : body?.to;
        const target = typeof playerId === 'string' ? town?.memberOf(playerId) : null;
        if (!target) return send(res, 404, '{"error":"not in town"}');
        if (req.method === 'GET') return send(res, 200, JSON.stringify(await playerInfo(userId, target, playerDeps)));
        if (path === '/town/verdict') {
          const mode = body?.mode;
          if (mode !== 'diss' && mode !== 'praise' && mode !== 'judge') return send(res, 400, '{"error":"invalid mode"}');
          return send(res, 200, JSON.stringify(await verdictInTown(client, userId, target, mode, playerDeps)));
        }
        const amount = body?.amount;
        if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > 1_000_000) return send(res, 400, '{"error":"invalid amount"}');
        return send(res, 200, JSON.stringify(await giveInTown(client, userId, target, amount, playerDeps)));
      }
      if ((req.method === 'GET' && path === '/town/outpost') || (req.method === 'POST' && path === '/town/bail')) {
        if (!loginEnabled()) return send(res, 404, '{"error":"login is off"}');
        if (req.method === 'POST' && !fromGame(req)) return send(res, 403, '{"error":"forbidden"}');
        const userId = sessionUser(req);
        if (!userId) return send(res, 401, '{"error":"not logged in"}');
        let body: { id?: unknown } | null = null;
        if (req.method === 'POST') {
          try {
            body = JSON.parse((await readBody(req)) || 'null');
          } catch {
            // invalid JSON → rejected below
          }
        }
        if (!(await isMember(client, userId))) return send(res, 403, '{"error":"members of the server only"}');
        const names = (id: string) => nameOf(client, id);
        if (req.method === 'GET') return send(res, 200, JSON.stringify(await townOutpost(userId, names)));
        if (typeof body?.id !== 'string') return send(res, 400, '{"error":"invalid id"}');
        return send(res, 200, JSON.stringify(await bailFromTown(client, userId, body.id, names)));
      }
      if (path === '/town/board' && (req.method === 'GET' || req.method === 'POST')) {
        if (!loginEnabled()) return send(res, 404, '{"error":"login is off"}');
        if (req.method === 'POST' && !fromGame(req)) return send(res, 403, '{"error":"forbidden"}');
        const userId = sessionUser(req);
        if (!userId) return send(res, 401, '{"error":"not logged in"}');
        let body: { action?: unknown; id?: unknown; task?: unknown; reward?: unknown } | null = null;
        if (req.method === 'POST') {
          try {
            body = JSON.parse((await readBody(req)) || 'null');
          } catch {
            // invalid JSON → rejected below
          }
        }
        if (!(await isMember(client, userId))) return send(res, 403, '{"error":"members of the server only"}');
        const names = (id: string) => nameOf(client, id);
        if (req.method === 'GET') return send(res, 200, JSON.stringify(await townBoard(userId, names)));
        const action = body?.action;
        if (action !== 'post' && action !== 'accept' && action !== 'giveup' && action !== 'complete' && action !== 'cancel') return send(res, 400, '{"error":"invalid action"}');
        const { id, task, reward } = body ?? {};
        if ((id !== undefined && typeof id !== 'string') || (task !== undefined && typeof task !== 'string') || (reward !== undefined && typeof reward !== 'number')) {
          return send(res, 400, '{"error":"invalid quest"}');
        }
        return send(res, 200, JSON.stringify(await boardAction(client, userId, { action, id, task, reward }, names)));
      }
      if ((req.method === 'GET' && path === '/town/inventory') || (req.method === 'POST' && (path === '/town/sell' || path === '/town/flex'))) {
        if (!loginEnabled()) return send(res, 404, '{"error":"login is off"}');
        if (req.method === 'POST' && !fromGame(req)) return send(res, 403, '{"error":"forbidden"}');
        const userId = sessionUser(req);
        if (!userId) return send(res, 401, '{"error":"not logged in"}');
        let body: { id?: unknown; quantity?: unknown; items?: unknown } | null = null;
        if (req.method === 'POST') {
          try {
            body = JSON.parse((await readBody(req)) || 'null');
          } catch {
            // invalid JSON → rejected below
          }
        }
        if (!(await isMember(client, userId))) return send(res, 403, '{"error":"members of the server only"}');
        if (req.method === 'GET') return send(res, 200, JSON.stringify(townInventory(userId)));
        // Several at once (the bag's multi-select): { items: [{ id, quantity }] }.
        if (path === '/town/sell' && Array.isArray(body?.items)) {
          const picks = body.items as { id?: unknown; quantity?: unknown }[];
          const ok = picks.length >= 1 && picks.length <= 100 && picks.every((p) => typeof p?.id === 'string' && Number.isInteger(p.quantity) && (p.quantity as number) >= 1 && (p.quantity as number) <= 1000);
          if (!ok) return send(res, 400, '{"error":"invalid items"}');
          return send(res, 200, JSON.stringify(sellManyInTown(userId, picks as { id: string; quantity: number }[])));
        }
        if (typeof body?.id !== 'string') return send(res, 400, '{"error":"invalid item"}');
        if (path === '/town/flex') {
          return send(res, 200, JSON.stringify(await flexInTown(client, userId, body.id, (id) => nameOf(client, id), (uid, item) => town?.flexed(uid, item))));
        }
        const quantity = body.quantity ?? 1;
        if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000) return send(res, 400, '{"error":"invalid quantity"}');
        return send(res, 200, JSON.stringify(sellInTown(userId, body.id, quantity)));
      }
      if (path === '/town/parlor' && (req.method === 'GET' || req.method === 'POST')) {
        if (!loginEnabled()) return send(res, 404, '{"error":"login is off"}');
        if (req.method === 'POST' && !fromGame(req)) return send(res, 403, '{"error":"forbidden"}');
        const userId = sessionUser(req);
        if (!userId) return send(res, 401, '{"error":"not logged in"}');
        let body: { action?: unknown; outfit?: unknown; id?: unknown } | null = null;
        if (req.method === 'POST') {
          try {
            body = JSON.parse((await readBody(req)) || 'null');
          } catch {
            // invalid JSON → rejected below
          }
        }
        if (!(await isMember(client, userId))) return send(res, 403, '{"error":"members of the server only"}');
        if (req.method === 'GET') return send(res, 200, JSON.stringify(townParlor(userId)));
        const result = body && parlorAction(userId, body, (id, outfit) => town?.restyle(id, outfit, titleOf(id)));
        if (!result) return send(res, 400, '{"error":"invalid change"}');
        return send(res, 200, JSON.stringify(result));
      }
      if (req.method === 'POST' && path === '/town/gamble') {
        if (!loginEnabled()) return send(res, 404, '{"error":"login is off"}');
        if (!fromGame(req)) return send(res, 403, '{"error":"forbidden"}');
        const userId = sessionUser(req);
        if (!userId) return send(res, 401, '{"error":"not logged in"}');
        let body: { bet?: unknown; call?: unknown } | null = null;
        try {
          body = JSON.parse((await readBody(req)) || 'null');
        } catch {
          // invalid JSON → rejected below
        }
        if (!(await isMember(client, userId))) return send(res, 403, '{"error":"members of the server only"}');
        const bet = body?.bet;
        const call = body?.call;
        if (typeof bet !== 'number' || !Number.isInteger(bet) || bet < 1 || bet > 1_000_000 || (call !== 'kara' && call !== 'krus')) {
          return send(res, 400, '{"error":"invalid bet"}');
        }
        return send(res, 200, JSON.stringify(await gambleInTown(client, userId, await nameOf(client, userId), bet, call)));
      }
      if (path === '/town/stay' && (req.method === 'GET' || req.method === 'POST')) {
        if (!loginEnabled()) return send(res, 404, '{"error":"login is off"}');
        if (req.method === 'POST' && !fromGame(req)) return send(res, 403, '{"error":"forbidden"}');
        const userId = sessionUser(req);
        if (!userId) return send(res, 401, '{"error":"not logged in"}');
        if (!(await isMember(client, userId))) return send(res, 403, '{"error":"members of the server only"}');
        return send(res, 200, JSON.stringify(req.method === 'GET' ? stayInfo(userId) : claimStay(userId)));
      }
      if (req.method === 'POST' && path === '/town/dig') {
        if (!loginEnabled()) return send(res, 404, '{"error":"login is off"}');
        if (!fromGame(req)) return send(res, 403, '{"error":"forbidden"}');
        const userId = sessionUser(req);
        if (!userId) return send(res, 401, '{"error":"not logged in"}');
        if (!(await isMember(client, userId))) return send(res, 403, '{"error":"members of the server only"}');
        return send(res, 200, JSON.stringify(await digInTown(client, userId, await nameOf(client, userId), digStatus)));
      }
      if (req.method === 'POST' && path === '/title/seen') {
        if (!loginEnabled()) return send(res, 404, '{"error":"login is off"}');
        if (!fromGame(req)) return send(res, 403, '{"error":"forbidden"}');
        const userId = sessionUser(req);
        if (!userId) return send(res, 401, '{"error":"not logged in"}');
        titleSeen(userId);
        return send(res, 200, '{"ok":true}');
      }
      if (req.method === 'PUT' && path === '/nickname') {
        if (!loginEnabled()) return send(res, 404, '{"error":"login is off"}');
        if (!fromGame(req)) return send(res, 403, '{"error":"forbidden"}');
        const userId = sessionUser(req);
        if (!userId) return send(res, 401, '{"error":"not logged in"}');
        let body: { nickname?: unknown } | null = null;
        try {
          body = JSON.parse((await readBody(req)) || 'null');
        } catch {
          // invalid JSON → rejected below
        }
        if (!(await isMember(client, userId))) return send(res, 403, '{"error":"members of the server only"}');
        const nickname = parseNickname(body?.nickname);
        if (!nickname) return send(res, 400, '{"error":"invalid nickname"}');
        if (setNickname(userId, nickname) === 'taken') return send(res, 409, '{"error":"taken"}');
        return send(res, 200, JSON.stringify({ nickname }));
      }
      if (path.startsWith('/auth/') || path === '/me') {
        if (!loginEnabled()) return send(res, 404, '{"error":"login is off"}');
        if (req.method === 'GET' && path === '/auth/login') return login(res, url.searchParams.get('next'));
        if (req.method === 'GET' && path === '/auth/callback') return await callback(client, req, res, url.searchParams);
        if (req.method === 'POST' && path === '/auth/logout') return fromGame(req) ? logout(req, res) : send(res, 403, '{"error":"forbidden"}');
        if (req.method === 'GET' && path === '/me') return await me(client, req, res);
      }
      if (req.method === 'POST' && path === '/find') {
        // Only the room may roll: without an allowed Origin there is no find.
        if (!origin || !ALLOWED_ORIGINS.has(origin)) return send(res, 403, '{"found":false}');
        const body = JSON.parse((await readBody(req)) || '{}') as { character?: unknown; fairy?: unknown };
        const character = typeof body.character === 'string' ? body.character : 'someone';
        const result = roll(clientIp(req), character, body.fairy === true);
        if (result.found) console.log(`[web] find issued via ${character}`);
        return send(res, 200, JSON.stringify(result));
      }
      send(res, 404, '{"error":"not found"}');
    } catch (err) {
      console.error('[web] request failed:', err);
      send(res, 500, '{"error":"failed"}');
    }
  });

  // The live town (/ws): logged-in members who've made a character, from the game's own page.
  try {
    let toDiscord: (userId: string, nickname: string, text: string, megaphone: boolean) => void = () => {};
    refundHeldBets(); // an arena match the bot didn't finish: both get their stake back
    town = attachTown(server, {
      arenaBets: arenaBets(),
      onSay: (userId, nickname, text, megaphone) => toDiscord(userId, nickname, text, megaphone),
      megaphone: useMegaphone,
      moderation: { mutedUntil, kickedUntil, filter: filterText },
      map: loadTownMap(),
      authenticate: async (req) => {
        if (!loginEnabled() || !fromGame(req)) return null;
        const userId = sessionUser(req);
        return userId && (await isMember(client, userId)) ? userId : null; // members of the server
      },
      profile: (userId) => {
        const nickname = getNickname(userId);
        const outfit = getOutfit(userId);
        return nickname && outfit ? { nickname, outfit, title: titleOf(userId), ...(jailedUntil(userId) ? { jailed: true } : {}) } : null;
      },
    });
    toDiscord = bridgeTownChat(client, town);
    connectTownFeed(town);
    const live = town;
    setWalletHook((userId) => live.wallet(userId)); // the HUD's Kowens follow any change, wherever it came from
    // Staying in town pays: a minute for everyone here, and a pop-up for whoever now has a Kowen to claim.
    setInterval(() => {
      for (const id of stayMinute(live.here())) live.stay(id, stayInfo(id));
    }, 60_000).unref();
  } catch (err) {
    console.error('[web] town disabled, map not loaded:', err);
  }

  server.listen(port, '127.0.0.1', () => console.log(`[web] room API on 127.0.0.1:${port}`));
}
