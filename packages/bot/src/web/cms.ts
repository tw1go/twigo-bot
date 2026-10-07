import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Client } from 'discord.js';
import { config } from '../config.js';
import { db } from '../db/db.js';
import { accountIds, add, balance, rankOf, take, totalKowens, vaultBalance } from '../credits/store.js';
import { inventory } from '../dig/store.js';
import { ITEM_BY_ID, ITEMS, RARITY, RARITY_ORDER, type Rarity, defaultItem, itemChances, setDigItem } from '../dig/items.js';
import { setShopEntry, shopCatalogue } from '../games/rewards.js';
import { pot } from '../games/jackpot.js';
import { jailedUntil } from '../games/jail.js';
import { kowen } from '../kowens.js';
import { isCmsUser, sessionUser } from './auth.js';
import { getNickname } from './nickname.js';
import { DEFAULT_TITLE, DESCRIPTION_MAX, TITLES, autoHolder, giveTitle, isTitleColor, removeTitle, setTitle, titleHolders, titleIdOf } from './titles.js';
import { townGift } from './town-feed.js';
import { kickedUntil, mutedUntil } from './town-mod.js';
import { forgetNews } from './town-news.js';
import { BODY_MAX, TITLE_MAX, deletePost, savePost, townPosts } from './town-posts.js';
import type { Town } from './town.js';
import { isSettingKey, setSetting, setting, settingList, SETTINGS } from '../games/settings.js';
import { CLASSES, EQUIPMENT, QUESTS, adventureOf, resetAdventure } from './adventure.js';
import { renameCards } from '../items/rename-card.js';

// 🛠️ The CMS: a page for the gifter (and CMS_USER_IDS) to run the game's content without a deploy or a slash command:
// the town's own news posts, titles (make, change, give), the rewards shop's prices and what's on sale, reward amounts
// (Mine Wars, daily, welcome gift, stay), and players (look someone up, give or take Kowens, start their class over). It lives at CMS_PATH, a path nobody can guess; anyone else (logged out
// visitors get a login button, other members a plain 404) sees nothing. Every change goes in the bot's log (not Discord).
//
//   GET  <path>/                 the page, packages/bot/cms/index.html (its script: <path>/app.js)
//   GET  <path>/api/me           who's logged in (401 → the page shows the login button)
//   GET  <path>/api/overview     members, Kowens, who's in town, the jackpot
//   GET  <path>/api/posts        POST { id?, title, body, bump? } · POST /api/posts/delete { id }
//   GET  <path>/api/titles       POST { id, name, color, description? } · POST /api/titles/delete { id }
//   GET  <path>/api/shop         POST { id, cost: number | null, off }
//   GET  <path>/api/items        dig items, their odds and how many are in bags · POST { id, name, emoji, value, rarity, off }
//   GET  <path>/api/settings     reward amounts (games/settings.ts) · POST { key, value: number | null (the default) }
//   GET  <path>/api/players?q=   nickname or Discord ID; empty = the richest
//   GET  <path>/api/player?id=   POST /api/player/kowens { id, amount, reason? } · POST /api/player/title { id, title }
//                                POST /api/player/reset-class { id } (class, quests and equipment start over)

export interface CmsDeps {
  town: () => Town | null;
  /** A member's Discord name. */
  discordName: (userId: string) => Promise<string>;
}

/** The page and its script (packages/bot/cms/, beside src/ and dist/), read once. */
const files = new Map<string, string>();
const file = (name: string) => files.get(name) ?? files.set(name, readFileSync(new URL(`../../cms/${name}`, import.meta.url), 'utf8')).get(name)!;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SNOWFLAKE = /^\d{17,20}$/;

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json'): void {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    // The path is the secret: never sent on as a referrer, never indexed, never framed.
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const notFound = (res: ServerResponse) => send(res, 404, '{"error":"not found"}');

function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk: Buffer) => {
      data += chunk;
      if (data.length > 16_384) req.destroy(); // a post is at most BODY_MAX characters
    });
    req.on('end', () => {
      try {
        const body = JSON.parse(data || 'null');
        resolve(body && typeof body === 'object' && !Array.isArray(body) ? body : null);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

/** Notes what was changed, and by whom, in the bot's log (journalctl; never posted in Discord). */
async function log(_client: Client, who: string, what: string): Promise<void> {
  console.log(`[cms] ${who}: ${what}`);
}

const nameStmt = db.prepare<[string], { user_id: string; nickname: string }>("SELECT user_id, nickname FROM nicknames WHERE nickname LIKE ? ESCAPE '\\' ORDER BY nickname LIMIT 25");

/** Players by nickname (or one Discord ID); with nothing typed, the 25 with the most Kowens. */
function findPlayers(q: string): { id: string; nickname: string | null; kowens: number }[] {
  const row = (id: string) => ({ id, nickname: getNickname(id), kowens: totalKowens(id) });
  if (!q) return accountIds().map(row).sort((a, b) => b.kowens - a.kowens).slice(0, 25);
  if (SNOWFLAKE.test(q)) return accountIds().includes(q) || getNickname(q) ? [row(q)] : [];
  return nameStmt.all(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`).map((r) => row(r.user_id));
}

const known = (id: string) => SNOWFLAKE.test(id) && (accountIds().includes(id) || !!getNickname(id));

async function player(id: string, deps: CmsDeps) {
  const items = inventory(id);
  return {
    id,
    discordName: await deps.discordName(id),
    nickname: getNickname(id),
    kowens: balance(id),
    vault: vaultBalance(id),
    rank: rankOf(id),
    title: titleIdOf(id),
    items: items.reduce((n, [, count]) => n + count, 0),
    kinds: items.length,
    jailedUntil: jailedUntil(id),
    mutedUntil: mutedUntil(id),
    kickedUntil: kickedUntil(id),
    inTown: !!deps.town()?.here().includes(id),
    ...adventureView(id),
    renameCards: renameCards(id),
  };
}

const nameOrId = (id: string | null) => id && (getNickname(id) ?? id);

/** A player's class, quests and equipment, by name. */
function adventureView(id: string) {
  const s = adventureOf(id);
  const quest = (q: string) => QUESTS.find((x) => x.id === q)?.title ?? q;
  return {
    cls: CLASSES.find((c) => c.id === s.cls)?.name ?? null,
    questsActive: s.quests.active.map((p) => `${quest(p.id)} (${QUESTS.find((x) => x.id === p.id)?.objectives[p.step]?.text ?? 'done'})`),
    questsDone: s.quests.done.map(quest),
    equipped: Object.entries(s.equipped).map(([place, item]) => `${place}: ${EQUIPMENT.get(item!)?.name ?? item}`),
    gear: s.bag.map((item) => EQUIPMENT.get(item)?.name ?? item),
  };
}

const titleList = () => {
  const holders = titleHolders();
  return Object.entries(TITLES).map(([id, t]) => ({ id, ...t, holders: holders[id] ?? 0, fixed: id === DEFAULT_TITLE || !!t.auto, ...(t.auto ? { holder: nameOrId(autoHolder(id)) } : {}) }));
};

/** Dig items as the CMS shows them: current and default values, the chance per dig, copies in bags. */
function itemList() {
  const chances = itemChances();
  const held = new Map<string, number>();
  for (const id of accountIds()) for (const [item, n] of inventory(id)) held.set(item, (held.get(item) ?? 0) + n);
  return [...ITEMS]
    .sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) || a.value - b.value || a.name.localeCompare(b.name))
    .map((i) => {
      const base = defaultItem(i.id);
      return {
        id: i.id, name: i.name, emoji: i.emoji, value: i.value, rarity: i.rarity, off: !!i.off, custom: !base,
        default: base && { name: base.name, emoji: base.emoji, value: base.value, rarity: base.rarity },
        chance: chances.get(i.id) ?? 0, held: held.get(i.id) ?? 0,
      };
    });
}
const rarities = () => RARITY_ORDER.map((r) => ({ id: r, ...RARITY[r] }));

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Handles a request under CMS_PATH (the server checks the path first). */
export async function cms(client: Client, req: IncomingMessage, res: ServerResponse, url: URL, deps: CmsDeps): Promise<void> {
  const base = config.cmsPath!;
  const sub = url.pathname.slice(base.length) || '/';
  if (sub === '/' && url.pathname === base) {
    res.writeHead(308, { Location: `${base}/`, 'Referrer-Policy': 'no-referrer' }); // relative links need the slash
    return void res.end();
  }

  const userId = sessionUser(req);
  // Logged-out visitors get the page (it shows the login button); other members, nothing at all.
  if (userId && !isCmsUser(userId)) return notFound(res);
  if (req.method === 'GET' && sub === '/') return send(res, 200, file('index.html'), 'text/html; charset=utf-8');
  if (req.method === 'GET' && sub === '/app.js') return send(res, 200, file('app.js'), 'text/javascript; charset=utf-8');
  if (!sub.startsWith('/api/')) return notFound(res);
  if (!userId) return send(res, 401, '{"error":"not logged in"}');
  // Changes only from the CMS's own page (the cookie is SameSite=Lax as well).
  if (req.method === 'POST' && req.headers.origin !== config.publicUrl) return send(res, 403, '{"error":"forbidden"}');
  if (req.method !== 'GET' && req.method !== 'POST') return notFound(res);

  const who = await deps.discordName(userId);
  const body = req.method === 'POST' ? await readJson(req) : null;
  if (req.method === 'POST' && !body) return send(res, 400, '{"error":"invalid JSON"}');
  const bad = (error: string) => send(res, 400, { error });
  const route = `${req.method} ${sub}`;

  switch (route) {
    case 'GET /api/me':
      return send(res, 200, { id: userId, name: who, nickname: getNickname(userId) });

    case 'GET /api/overview': {
      const ids = accountIds();
      return send(res, 200, {
        members: ids.length,
        kowens: ids.reduce((n, id) => n + totalKowens(id), 0),
        inTown: deps.town()?.here().length ?? 0,
        pot: pot(),
        posts: townPosts().length,
        titles: Object.keys(TITLES).length,
        offSale: shopCatalogue().filter((r) => r.off).length,
        digItems: ITEMS.filter((i) => !i.off).length,
      });
    }

    case 'GET /api/posts':
      return send(res, 200, { posts: townPosts(), titleMax: TITLE_MAX, bodyMax: BODY_MAX });
    case 'POST /api/posts': {
      const id = body!.id === undefined || body!.id === null ? null : str(body!.id);
      const title = str(body!.title);
      const text = typeof body!.body === 'string' ? body!.body.replace(/\r\n/g, '\n').trim() : '';
      if (!title || title.length > TITLE_MAX) return bad(`The title needs 1–${TITLE_MAX} characters.`);
      if (!text || text.length > BODY_MAX) return bad(`The post needs 1–${BODY_MAX} characters.`);
      const post = savePost(id, title, text, body!.bump === true);
      if (!post) return send(res, 404, '{"error":"That post is gone."}');
      forgetNews();
      await log(client, who, `${id ? 'edited' : 'posted'} the town news post **${title}**${body!.bump === true ? ' (shown as new)' : ''}`);
      return send(res, 200, { post });
    }
    case 'POST /api/posts/delete': {
      const post = townPosts().find((p) => p.id === str(body!.id));
      if (!post || !deletePost(post.id)) return send(res, 404, '{"error":"That post is gone."}');
      forgetNews();
      await log(client, who, `deleted the town news post **${post.title}**`);
      return send(res, 200, { ok: true });
    }

    case 'GET /api/titles':
      return send(res, 200, { titles: titleList(), descriptionMax: DESCRIPTION_MAX });
    case 'POST /api/titles': {
      const id = str(body!.id);
      const name = str(body!.name);
      if (!SLUG.test(id) || id.length > 40) return bad('The id is lowercase letters, digits and dashes (e.g. lucky-digger).');
      if (!name || name.length > 32) return bad('The name needs 1–32 characters.');
      if (!isTitleColor(body!.color)) return bad('The colour is #RRGGBB or prismatic.');
      const description = str(body!.description).replace(/\s+/g, ' ');
      if (description.length > DESCRIPTION_MAX) return bad(`The description is at most ${DESCRIPTION_MAX} characters.`);
      const was = TITLES[id];
      setTitle(id, { name, color: body!.color, description });
      await log(client, who, `${was ? 'changed' : 'made'} the title **<${name}>** (${body!.color})${description ? `: ${description}` : ''}`);
      return send(res, 200, { titles: titleList(), descriptionMax: DESCRIPTION_MAX });
    }
    case 'POST /api/titles/delete': {
      const id = str(body!.id);
      const title = TITLES[id];
      if (!title || !removeTitle(id)) return bad(id === DEFAULT_TITLE ? 'Townfolk stays: it is everyone’s default.' : title?.auto ? 'Automatic titles stay.' : 'No such title.');
      await log(client, who, `removed the title **<${title.name}>** (anyone wearing it shows Townfolk)`);
      return send(res, 200, { titles: titleList(), descriptionMax: DESCRIPTION_MAX });
    }

    case 'GET /api/shop':
      return send(res, 200, { rewards: shopCatalogue() });
    case 'POST /api/shop': {
      const id = str(body!.id);
      const cost = body!.cost;
      if (cost !== null && (typeof cost !== 'number' || !Number.isInteger(cost) || cost < 1 || cost > 1_000_000)) return bad('The price is a whole number, 1 to 1,000,000.');
      const before = shopCatalogue().find((r) => r.id === id);
      if (!before || !setShopEntry(id, cost, body!.off === true)) return bad('No such reward.');
      const after = shopCatalogue().find((r) => r.id === id)!;
      const changes = [
        before.cost !== after.cost && `price ${before.cost} → ${after.cost} ${kowen(after.cost)}`,
        before.off !== after.off && (after.off ? 'taken off sale' : 'back on sale'),
      ].filter(Boolean);
      if (changes.length) await log(client, who, `shop: ${after.emoji} **${after.name}** ${changes.join(', ')}`);
      return send(res, 200, { rewards: shopCatalogue() });
    }

    case 'GET /api/items':
      return send(res, 200, { items: itemList(), rarities: rarities() });
    case 'POST /api/items': {
      const id = str(body!.id);
      const name = str(body!.name);
      const emoji = str(body!.emoji);
      const value = body!.value;
      const rarity = body!.rarity;
      const was = ITEM_BY_ID.get(id);
      if (!was && (!SLUG.test(id) || id.length > 32)) return bad('The id is lowercase letters, digits and dashes (e.g. golden-tabo), up to 32.');
      if (!name || name.length > 48) return bad('The name needs 1–48 characters.');
      if (!emoji || [...emoji].length > 8) return bad('Give it an emoji (it shows where the item has no art).');
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100_000) return bad('The sell value is a whole number, 0 to 100,000.');
      if (typeof rarity !== 'string' || !(rarity in RARITY)) return bad('Pick a rarity.');
      const off = body!.off === true;
      if (setDigItem(id, { name, emoji, value, rarity: rarity as Rarity, off }) === 'last-of-rarity') {
        return bad(`It's the last ${RARITY[was!.rarity].label} item in the ground: digs need at least one of each rarity.`);
      }
      const now = ITEM_BY_ID.get(id)!;
      const what = !was
        ? `added the dig item ${emoji} **${name}** (${RARITY[now.rarity].label}, sells for ${value})${off ? ', not in the ground yet' : ''}`
        : `changed the dig item ${now.emoji} **${now.name}**: ${[
            was.name !== now.name && `name ${was.name} → ${now.name}`,
            was.emoji !== now.emoji && `emoji ${was.emoji} → ${now.emoji}`,
            was.value !== now.value && `sells for ${was.value} → ${now.value}`,
            was.rarity !== now.rarity && `${RARITY[was.rarity].label} → ${RARITY[now.rarity].label}`,
            !!was.off !== !!now.off && (now.off ? 'taken out of the ground' : 'back in the ground'),
          ].filter(Boolean).join(', ') || 'nothing'}`;
      await log(client, who, what);
      return send(res, 200, { items: itemList(), rarities: rarities() });
    }

    case 'GET /api/settings':
      return send(res, 200, { settings: settingList() });
    case 'POST /api/settings': {
      const key = str(body!.key);
      const value = body!.value;
      if (!isSettingKey(key)) return bad('No such setting.');
      const def = SETTINGS[key];
      const before = setting(key);
      if (value !== null && typeof value !== 'number') return bad(`${def.label} is a whole number.`);
      if (!setSetting(key, value)) return bad(`${def.label} is a whole number, ${def.min} to ${def.max.toLocaleString('en-US')}.`);
      if (before !== setting(key)) await log(client, who, `rewards: ${def.group} · ${def.label} ${before} → ${setting(key)}${value === null ? ' (the default)' : ''}`);
      return send(res, 200, { settings: settingList() });
    }

    case 'POST /api/player/reset-class': {
      const id = str(body!.id);
      if (!known(id)) return send(res, 404, '{"error":"No such player."}');
      const was = adventureOf(id).cls;
      resetAdventure(id);
      deps.town()?.kit(id, null, null); // their resting weapon and badge go, for everyone in town
      await log(client, who, `started **${getNickname(id) ?? (await deps.discordName(id))}**'s class over (was ${was ?? 'none'}): quests and equipment too`);
      return send(res, 200, { player: await player(id, deps) });
    }

    case 'GET /api/players':
      return send(res, 200, { players: findPlayers(str(url.searchParams.get('q')).slice(0, 32)) });
    case 'GET /api/player': {
      const id = str(url.searchParams.get('id'));
      if (!known(id)) return send(res, 404, '{"error":"No such player."}');
      return send(res, 200, { player: await player(id, deps), titles: titleList() });
    }
    case 'POST /api/player/kowens': {
      const id = str(body!.id);
      const amount = body!.amount;
      const reason = str(body!.reason).slice(0, 100);
      if (!known(id)) return send(res, 404, '{"error":"No such player."}');
      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1_000_000) return bad('The amount is a whole number, not 0 (minus takes Kowens away).');
      const name = getNickname(id) ?? (await deps.discordName(id));
      if (amount > 0) {
        add(id, amount); // like /gift kowens
        townGift(id, 'The gifter', amount); // the gift pop-up, if they're in the web town
        await log(client, who, `gave **${name}** ${amount.toLocaleString('en-US')} ${kowen(amount)}${reason ? ` (${reason})` : ''}`);
      } else {
        const taken = take(id, -amount);
        await log(client, who, `took ${taken.toLocaleString('en-US')} ${kowen(taken)} from **${name}**${reason ? ` (${reason})` : ''}`);
      }
      return send(res, 200, { player: await player(id, deps) });
    }
    case 'POST /api/player/title': {
      const id = str(body!.id);
      const title = str(body!.title);
      if (!known(id)) return send(res, 404, '{"error":"No such player."}');
      if (!TITLES[title]) return bad('No such title.');
      if (TITLES[title].auto) return bad('That title is automatic: nobody gives it by hand.');
      giveTitle(id, title);
      await log(client, who, `gave **${getNickname(id) ?? (await deps.discordName(id))}** the title **<${TITLES[title].name}>**`);
      return send(res, 200, { player: await player(id, deps) });
    }
  }
  return notFound(res);
}
