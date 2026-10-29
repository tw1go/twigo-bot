import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ClassesFile, GearRarity, HoodHouse, HouseLook, OutfitData, PrivacySettings, RogueState, TestingSettings, TownHoodActionResponse, TownHoodResponse, TownItems, TownRace, TownRaceResponse } from '@mikazuki/shared';
import { type LanternPost, type TownMail, DEFAULT_PRIVACY, expireItems, MAIL_RULES, claimInto, hasAttachments, parseMailAction, RETURN_LANTERN, gainPetXp, parsePetAction, petAction, petIdOf, petRules, setPetLevel, addToBag, isGearDef, wornItems, blockedWithPosts, lanternPostsOf, postKey, newItem, rollGear, buyCosmetic, rollWorthy, takeKind, buffSkillLevels, classBuffs, classSkills, damageSkillLevels, moveUnlock, type PalengkeData, dishOf, dishRefusal, mobName, palengkeQuests, questItemDrops } from '@mikazuki/shared';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { doorSpot, hoodMap, lotTile } from '../../bot/src/web/hood-map.ts';
import type { Plugin } from 'vite';
import { attachTown } from '../../bot/src/web/town.ts';
import { MobRoom, bothDirectors, loadMobKinds, loadSkillShapes } from '../../bot/src/web/town-mobs.ts';
import { type SavedProgress, addXp, freshProgress, killXp, levelTo, progressView, raiseSkill, resetSkillPoints, resetStatPoints, spendPoint } from '../../bot/src/web/progress.ts';
import { loadItemData, loadLeveling, loadPalengkeLeveling, loadStats } from '../../bot/src/web/stats-data.ts';
import { Halloween, loadHalloween } from '../../bot/src/web/halloween.ts';
import { buyCombat, devGive, dropFromBag, makeItem, takeLoot, usePotion } from '../../bot/src/web/combat-bag.ts';
import { enhanceFeedLine, forge, parseForgeAction } from '../../bot/src/web/forge.ts';
import { settleTrade } from '../../bot/src/web/trade.ts';
import { loadGolemArt } from '../../bot/src/web/town-golem.ts';
import { type FieldBossDef, GreatScale, loadGreatScaleArt } from '../../bot/src/web/town-great-scale.ts';
import { loadSilong } from '../../bot/src/web/town-silong.ts';
import { loadWarrens } from '../../bot/src/web/town-warrens.ts';
import { LANES, finishMs, raceScript } from '../../bot/src/games/race-script.ts';
import type { ArenaBets } from '../../bot/src/web/town-arena.ts';

// Dev only: the town's live server (/ws) inside the game's dev server, so chat and other players can be tried
// without the bot. It is the bot's own web/town.ts with a fake login: the game's fake member (?as=Name) says who
// they are and what they look like in the address. Open two windows (?as=Alice, ?as=Bob) to be two people.
//   GET /__discord?name=Kuya%20Ben&text=hi   a message as if from the town's Discord channel
//   GET /__system?kind=dig&tone=rare&text=…   a system feed line (kind dig|gamble|jackpot; tone: rarity, win, lose, bust, jackpot);
//       a dig can add &itemId=rock&itemName=Rock&as=Alice (Alice's game then plays the dig panel); a bet can add
//       &as=Alice&amount=60 (kind=gamble, tone=win: coins burst over Alice; tone=bust: a siren)
//   GET /__announce?kind=jackpot|notice&title=…&text=…   a banner at the top
//   GET /__jail?name=Bob&on=1   shows Bob as jailed (on=0: released) to everyone in town
//   GET /__bakod?name=Mara&on=0 takes down (on=1 puts up) a pretend neighbour's Bakod, live in the neighbourhood
//   GET /__minibosses   every mini boss that's down comes back now, the Slums' and the Lumang Palengke's (the page's
//       ?minibosses=now)
//   GET /__warrens?as=Alice   a Scrap Warrens run for Alice, free, started at once (the page's ?warrens=solo; it then goes
//       in); &boss=crab-tain: every area before that boss cleared, and she arrives at its arena (?warrensboss=crab-tain).
//       &hp=1 with it: that boss down to 1 HP, so one hit fells it (Barong-Barong: the run clears, its warp rises).
//       The Warren Gate itself works as live, with Warren Tickets from her bag here (?give=warren-ticket::5)
//   GET /__golem?now=1   the Scrapheap Golem rises in the Slums now (the page's ?golem=now); ?demo=1&as=Alice: it rises if
//       it must and plays its whole fight against the nearest player (?golemdemo=1): each attack, the Junk at a pretend
//       half, Enrage at a pretend quarter, death (the line names Alice if nobody hit it)
//   GET /__silong?as=Alice   an Ang Silong run for Alice, free, started at once (the page's ?silong=solo; it then goes
//       down); &floor=b3: every mini boss above that floor down, the floors reached (?silong=b3); &floor=plant: B3 with
//       Frosty Tubbs down and the Ice Tanks door open (Ang Makinang Yelo next; &hp=1000: it down to that HP)
//   GET /__greatscale   the Great Scale wakes in the Lumang Palengke now (the page's ?greatscale=now); &hp=500 puts it
//       (awake) down to 500 HP, so a hit or two fells it and its bell rings
//   GET /__halloween?as=Alice   the Halloween event on now (the page's ?halloween=on calls it); &mikko=1 hides Mikko
//       Kalabasa two tiles from Alice, &biikko=1 brings Biikko Kalabasa out in the Slums now, &round=1 starts a Manananggal
//       round (the legs in town, the upper half in the Slums), &carry=1 hands Alice the dazed upper half (a round for it),
//       &biikkohp=500 puts Biikko (once out) down to 500 HP.
//       In memory only (a restart: off again). Its rewards go into her items here (Kowens and potions only printed).
//   GET /__flex?as=Bob&itemId=rock&itemName=Rock&rarity=junk   Bob flexes an item (chat line + bubble)
//   GET /__gift?as=Alice&amount=50   Alice gets the gift pop-up (as from /gift kowens); &wallet=1: only her HUD's Kowens reload
//   GET /__gift?as=Alice&item=megaphone&name=Megaphone&qty=3   Alice gets the item gift pop-up (as from /gift item)
//   GET /__title?as=Alice&id=richest&name=Richest%20Among%20All&color=%23FFD54A   Alice gets the new-title pop-up
//   GET /__look?as=Alice&look={…}&title=Kalbo&color=%23F8BF27   Alice's new look / title (the pretend Parlor calls it)
//   GET /__kit?as=Alice&cls=stick&weapon=weapon-training-stick   Alice's class and worn weapon (the pretend quests and
//   equipment call it, &progress= after a class change; the page also sends them on connect as &kit=, with her level, XP
//   and points).
//   POST /__items?as=Alice {equipped, bag, kusing}   Alice's items (the page sends them whenever they change on its
//   side): fights (and HP: her armor's DEF) use them; loot, potions, the shop and /__give change them here and send her
//   `items` (the page keeps them). GET: what's kept here ({ known: false } after a restart: the page sends its own).
//   GET /__give?as=Alice&def=weapon-sturdy-slingshot&rarity=darkOrange&plus=7   an item for Alice, rolled as drops are
//   (&count=N a stack; &level= an agimat's); &kusing=5000 sets her Kusing, &whetstones=200 gives her Rough Whetstones
//   (the page's ?give=<defId>:<rarity>:<plus>, ?kusing=, ?whetstones= call it on arrival)
//   POST /__forge?as=Alice {action, item, …}   the forge popup (enhance, repair, embed, disassemble, combine) on her
//   items here, rolled by the bot's web/forge.ts (the page's pretend /town/forge); sends her `items` (and `kit` for her aura)
//   POST /__pet?as=Alice {action: open|out|back|spend|reset, …}   a pet action on her items here (the page's pretend
//   /town/pet), by the shared rules (the swap cooldown and fights too); GET /__pet?as=Alice&level=12&xp=500: her pet out
//   (else the first in her bag) at that level and XP (the page's ?petlevel= / ?petxp=)
//   GET /__mail?as=Alice&title=Sorry&body=…&from=The%20Tanod&kusing=500&kowens=5&give=weapon-sturdy-slingshot:darkBlue:7
//       a mail for Alice (give= may repeat: defId:rarity:plus:count, as ?give=), shown to her at once; her mailbox
//       (GET/POST /town/mail, by ?as= from the page's address) is answered here by the same rules, claims into her items
//   GET /__roll?as=Alice   a rare orange item drops for Alice's party: the loot roll pop-up (alone: it just lies there)
//   GET /__loot?rich=1   nearly every kill drops gear (the first kind, brown, +0 to +3) and a potion, to try loot (rich=0: as ever)
//   POST /__shop?as=Alice {id, quantity, kowens}   buys a combat item (the sari-sari store's Healing and Smithing tabs)
//   with her Kusing here, or the pretend shop's Kowens (sent along; what's left comes back); a cosmetic or a Set too
//   (the Cosmetics tab: the Witch Hat and Robe while ?halloween=on has the event on)
//   GET /__points?as=Alice&stat=DEX   Alice spends a stat point on DEX (&reset=1: all back), by the bot's rules
//   (web/progress.ts); answers { ok, message?, progress } and sends her `progress` (the pretend equipment panel calls it)
//   GET /__skills?as=Alice&skill=0   Alice puts a skill point into her class's first skill (&skill=dash: Dash; &reset=1:
//   all back), by the bot's rules; answers and sends like /__points (the pretend Skills panel calls it)
//   GET /__xp?as=Alice&xp=500   Alice gains 500 XP (&level=10: her level set to 10), as from kills: her level-ups, "Level
//   up!" for her room, her HUD (the page's ?xp= / ?level= call it). Levels live here in memory (bot web/progress.ts),
//   from what the page sent on connect; kills in the Slums give XP the same way.
//   The neighbourhood (?area=hood): GET /town/hood, POST /town/house, POST /town/hood answered here with pretend
//   neighbours (one with a Bakod, Jun protected, Lola a marked rogue) and your house (by ?as=, from the page's address),
//   POST /town/rogue too (become a rogue or quit; GET /__rogue?name=Jun&state=open|protected|marked sets a neighbour's
//   state live); &steal=win|bust|snap decides a
//   steal (else it's random). Each page load refills your Master Keys and Kalawang Potions (3 each, or &keys=N
//   &kalawang=N) and there's no steal cooldown unless &cooldown=1. Its room on the town server uses the bot's own
//   layout (web/hood-map.ts).
//   Trades between two windows (?as=Alice / ?as=Bob, the player menu's Trade) run on the items kept here, by the bot's
//   web/trade.ts; each finished one is printed here (no trades table).
// What's said in town is printed here instead of going to Discord.

export function devTown(): Plugin {
  return {
    name: 'mikazuki-dev-town',
    apply: 'serve',
    configureServer(server) {
      const httpServer = server.httpServer;
      if (!httpServer) return;
      const json = JSON.parse(readFileSync(join(server.config.publicDir, 'assets/maps/town.json'), 'utf8'));
      const looks = new Map<string, OutfitData>();
      const privacy = new Map<string, PrivacySettings>(); // Settings → Privacy, by name
      const testing = new Map<string, TestingSettings>(); // Settings → Testing (Game Masters: names starting "GM"), by name
      const kits = new Map<string, { cls: string | null; weapon: string | null }>(); // class and worn weapon (the pretend quests and equipment)
      /** The Lantern Posts each player has restored (in memory; the page's ?lanterns=all|none sets them as it connects). */
      const restoredBy = new Map<string, Set<string>>();
      /** Every post and dungeon entrance there is (shared postKey), for ?lanterns=all. */
      const allPosts = () =>
        ['town', 'slums', 'palengke'].flatMap((m) => {
          const j = JSON.parse(readFileSync(join(server.config.publicDir, `assets/maps/${m}.json`), 'utf8'));
          const posts = lanternPostsOf({ ...j, blocked: blockedWithPosts(j.blocked, j.teleporters) });
          return posts.map((_, i) => postKey(m, posts, i));
        });
      /** Each player's pretend quests (the page sends them: on connect with &kit=, then /__quests), for the Warren Gate. */
      const questsOf = new Map<string, { active: { id: string; step: number }[]; done: string[]; flags?: string[] }>();
      // Each player's items (the page's copy, sent with /__items): loot, potions, the shop and ?give= change them here.
      const items = loadItemData();
      const gear = new Map<string, TownItems>();
      // (A fresh name starts with a stack of each Kowen Voucher, so the Bank's Exchange tab and the bag's Use can be tried:
      // ?kusing=60000000&kowens=500.)
      const starterVouchers = () => (stats.exchange?.vouchers ?? []).map((v) => makeItem(items, v.id, { count: 1 }, devUid)).filter((i): i is NonNullable<typeof i> => !!i);
      const gearOf = (name: string) => gear.get(name) ?? gear.set(name, { equipped: {}, cosmetics: {}, bag: starterVouchers(), kusing: 0, pet: null }).get(name)!;
      /** The pet each player has out (its pet id), and when they last changed it (the swap cooldown). */
      const petOf = (name: string) => petIdOf(items, gear.get(name)?.pet);
      const petChanges = new Map<string, number>();
      const devUid = () => `dev-${Math.random().toString(16).slice(2, 14)}`;
      /** Their worn weapon's + as its aura shows it (none when broken). */
      const plusOf = (name: string) => {
        const w = gear.get(name)?.equipped.weapon;
        return w && !w.broken ? w.plus : 0;
      };
      let richLoot = false;
      // Levels, XP and points (the bot's web/progress.ts, in memory; each page sends its own on connect).
      const stats = loadStats();
      const levels = new Map<string, SavedProgress>();
      const levelOf = (name: string) => levels.get(name) ?? freshProgress(stats);
      // Arena bets against pretend wallets (100 Kowens each, in memory; the HUD's Kowens don't follow them).
      const wallets = new Map<string, number>();
      const wallet = (who: string) => wallets.get(who) ?? 100;
      const move = (who: string, by: number) => {
        wallets.set(who, wallet(who) + by);
        server.config.logger.info(`[arena bets] ${who} ${by >= 0 ? '+' : ''}${by} → ${wallet(who)}`, { timestamp: true });
      };
      const arenaBets: ArenaBets = {
        hold: (a, b, want) => {
          const stake = Math.min(want, wallet(a), wallet(b));
          if (stake > 0) [a, b].forEach((x) => move(x, -stake));
          return Math.max(0, stake);
        },
        pay: (winner, _loser, stake) => move(winner, stake * 2),
        holdSolo: (who, want) => {
          const stake = Math.min(want, wallet(who));
          if (stake > 0) move(who, -stake);
          return Math.max(0, stake);
        },
        paySolo: (who, stake, won) => void (won && move(who, stake * 2)),
      };
      // ── The pretend neighbourhood ──
      // (Jun was robbed: protected, a moon charm by the door; Lola is a rogue who has stolen: marked, a mask.)
      const neighbours: { name: string; style: string; colours: Record<string, string>; fenced: boolean; state: RogueState; rogue: boolean }[] = [
        { name: 'Kiko', style: 'kubo', colours: {}, fenced: false, state: 'open', rogue: false },
        { name: 'Mara', style: 'cottage', colours: { walls: 'rose', roof: 'berry' }, fenced: true, state: 'open', rogue: false },
        { name: 'Tess', style: 'townhouse', colours: {}, fenced: false, state: 'open', rogue: false },
        { name: 'Jun', style: 'modern', colours: { walls: 'sun', trim: 'harbour' }, fenced: false, state: 'protected', rogue: false },
        { name: 'Lola', style: 'aframe', colours: { roof: 'moss' }, fenced: false, state: 'marked', rogue: true },
        { name: 'Ben', style: 'cottage', colours: { walls: 'harbour', roof: 'white' }, fenced: false, state: 'open', rogue: false },
      ];
      const houses: (HoodHouse & { name: string })[] = neighbours.map((h, lot) => ({ ...h, lot, owner: h.name, title: { name: 'Townfolk', color: '#B794F6' } }));
      /** Each pretend player's keys, potions and Kowens (by ?as=), refilled on each page load. */
      const mes = new Map<string, { keys: number; kalawang: number; kowens: number; stealAt: number; rogue: boolean; state: RogueState }>();
      const meOf = (who: string) => mes.get(who) ?? mes.set(who, { keys: 3, kalawang: 3, kowens: 50, stealAt: 0, rogue: false, state: 'open' }).get(who)!;
      /** A pretend house's rogue state changed: the neighbourhood redraws its charm or mask (as the bot's poll sends). */
      const tellState = (h: HoodHouse & { name: string }) => {
        const { col, row } = lotTile(h.lot);
        const { name: _name, ...shown } = h;
        town.house('state', shown, { col, row, door: doorSpot(h.lot, h.fenced), fence: fences() });
      };
      /** Your state, on you and on your house if you've built one. */
      const setMine = (who: string, state: RogueState, rogue: boolean) => {
        const me = meOf(who);
        Object.assign(me, { state, rogue });
        const h = houses.find((x) => x.name === who);
        if (h && (h.state !== state || h.rogue !== rogue)) {
          Object.assign(h, { state, rogue });
          tellState(h);
        }
      };
      const count = (q: URLSearchParams, key: string) => (q.has(key) ? Math.max(0, Math.floor(Number(q.get(key))) || 0) : 3);
      const asOf = (req: IncomingMessage) => {
        try {
          return new URL(req.headers.referer ?? '').searchParams;
        } catch {
          return new URLSearchParams();
        }
      };
      /** Every pretend Bakod's fence, as the bot sends it. */
      const fences = () => hoodMap(houses.length, new Set(houses.filter((h) => h.fenced).map((h) => h.lot))).fence;
      const hood = (who: string): TownHoodResponse => {
        const me = meOf(who);
        const mine = houses.find((h) => h.name === who);
        return {
          map: hoodMap(houses.length, new Set(houses.filter((h) => h.fenced).map((h) => h.lot))),
          houses: houses.map(({ name, ...h }) => ({ ...h, ...(name === who ? { mine: true } : {}) })),
          me: {
            house: mine ? { style: mine.style, colours: mine.colours } : null, kowens: me.kowens, keys: me.keys, kalawang: me.kalawang, stealAt: me.stealAt > Date.now() ? me.stealAt : null, jailed: false, repaintCost: 3,
            rogue: me.rogue, marked: me.state === 'marked', markedUntil: me.state === 'marked' && !me.rogue ? Date.now() + 2 * 86_400_000 : null, protected: me.state === 'protected',
          },
        };
      };
      const reply = (res: ServerResponse, body: unknown) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
      };
      const readJson = (req: IncomingMessage) => new Promise<Record<string, unknown>>((done) => {
        let data = '';
        req.on('data', (c: Buffer) => (data += c));
        req.on('end', () => {
          try {
            done(JSON.parse(data || '{}'));
          } catch {
            done({});
          }
        });
      });
      server.middlewares.use('/town/house', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        const who = asOf(req).get('as') ?? 'Dev tester';
        const me = meOf(who);
        const look = (await readJson(req)) as unknown as HouseLook;
        const mine = houses.find((h) => h.name === who);
        let message = 'Your house is built! Welcome to the neighbourhood.';
        if (mine) {
          me.kowens -= 3;
          Object.assign(mine, { style: look.style, colours: look.colours });
          message = 'Your house has a new look! (−3 Kowens)';
        } else houses.push({ name: who, lot: houses.length, owner: who, title: { name: 'Townfolk', color: '#B794F6' }, style: look.style, colours: look.colours, fenced: false, state: me.state, rogue: me.rogue });
        server.config.logger.info(`[hood] ${who}: ${mine ? 'new look' : 'built a house'} (${look.style})`, { timestamp: true });
        // Everyone in the neighbourhood sees it go up (or puff into its new look), as from the bot.
        const h = houses.find((x) => x.name === who)!;
        const { col, row } = lotTile(h.lot);
        const { name: _name, ...shown } = h;
        town.house(mine ? 'look' : 'built', shown, { col, row, door: doorSpot(h.lot, h.fenced), fence: fences() });
        reply(res, { ...hood(who), ok: true, message } satisfies TownHoodActionResponse);
      });
      // ── A pretend Mosang race (the bot's script, games/race-script.ts; bets from the pretend wallets) ──
      const MOSANG_IDS = ['marites', 'nena', 'puring', 'tessie', 'dolor', 'bebang', 'charing', 'lourdes', 'pacita', 'rosing'];
      let devRace: { id: string; runners: string[]; closesAt: number; startedBy: string; bets: Map<string, { lane: number; amount: number }>; run?: TownRace['run'] } | null = null;
      const raceState = (): TownRace | null =>
        devRace && {
          id: devRace.id,
          runners: devRace.runners,
          closesAt: devRace.closesAt,
          now: Date.now(),
          startedBy: devRace.startedBy,
          bets: devRace.runners.map((_, lane) => {
            const on = [...devRace!.bets.values()].filter((b) => b.lane === lane);
            return { count: on.length, pot: on.reduce((n, b) => n + b.amount, 0) };
          }),
          ...(devRace.run ? { run: devRace.run } : {}),
        };
      const tellRace = () => town.race(raceState());
      server.middlewares.use('/town/race', async (req, res) => {
        const q = asOf(req);
        const who = q.get('as') ?? 'Dev tester';
        const answer = (extra: { ok?: boolean; message?: string } = {}) =>
          reply(res, { race: raceState(), mine: devRace?.bets.get(who) ?? null, kowens: wallet(who), maxBet: 100, payout: 4, ...extra } satisfies TownRaceResponse);
        if (req.method !== 'POST') return answer();
        const body = (await readJson(req)) as { action?: string; lead?: string; race?: string; lane?: number; amount?: number };
        if (body.action === 'start') {
          if (devRace) return answer({ ok: false, message: 'A race is already on!' });
          const others = MOSANG_IDS.filter((m) => m !== body.lead).sort(() => Math.random() - 0.5);
          const runners = [...(body.lead && MOSANG_IDS.includes(body.lead) ? [body.lead] : []), ...others].slice(0, LANES).sort(() => Math.random() - 0.5);
          const betting = q.get('race') === 'now' ? 3_000 : q.get('race') === 'fast' ? 20_000 : 2 * 60_000; // &race=now: 3 s of betting, &race=fast: 20 s
          const id = Math.random().toString(16).slice(2, 10);
          devRace = { id, runners, closesAt: Date.now() + betting, startedBy: who, bets: new Map() };
          server.config.logger.info(`[race] ${who} started a race: ${runners.join(', ')}`, { timestamp: true });
          tellRace();
          setTimeout(() => {
            if (devRace?.id !== id) return;
            const s = raceScript(runners.length);
            devRace.run = { lanes: s.lanes, winner: s.winner, tie: s.tie, endsAt: Date.now() + s.ms };
            tellRace();
            setTimeout(() => {
              if (devRace?.id !== id) return;
              for (const [p, b] of devRace.bets) if (b.lane === s.winner || b.lane === s.tie) move(p, b.amount * 4);
              server.config.logger.info(`[race] ${runners[s.winner]} won`, { timestamp: true });
            }, s.ms);
            setTimeout(() => {
              if (devRace?.id !== id) return;
              devRace = null;
              tellRace();
            }, Math.max(...s.lanes.map(finishMs)) + 6_000);
          }, betting);
          return answer({ ok: true, message: 'The Mosangs are heading to the starting line! Bets close in 2 minutes.' });
        }
        if (body.action === 'bet') {
          if (!devRace || devRace.id !== body.race || Date.now() >= devRace.closesAt) return answer({ ok: false, message: 'Betting for this race is closed.' });
          if (devRace.bets.has(who)) return answer({ ok: false, message: 'You already bet on this race.' });
          const amount = Number(body.amount);
          if (!Number.isInteger(amount) || amount < 1 || amount > 100) return answer({ ok: false, message: 'Bet 1 to 100 Kowens.' });
          if (wallet(who) < amount) return answer({ ok: false, message: "You don't have that many Kowens." });
          move(who, -amount);
          devRace.bets.set(who, { lane: Number(body.lane), amount });
          tellRace();
          return answer({ ok: true, message: `You bet ${amount}! If she wins you get ${amount * 4}.` });
        }
        return answer({ ok: false, message: 'Bad request' });
      });
      // A Bakod up or down on someone's pretend house, seen live in the neighbourhood (as the bot's watcher sends it).
      server.middlewares.use('/__bakod', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const h = houses.find((x) => x.name === q.get('name'));
        if (!h) return reply(res, { ok: false, error: 'no such house' });
        h.fenced = q.get('on') !== '0';
        const { col, row } = lotTile(h.lot);
        const { name: _name, ...shown } = h;
        town.house('fence', shown, { col, row, door: doorSpot(h.lot, h.fenced), fence: fences() });
        reply(res, { ok: true, fenced: h.fenced });
      });
      // GET /__rogue?name=Jun&state=open|protected|marked: a pretend neighbour's rogue state, live in the neighbourhood.
      server.middlewares.use('/__rogue', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const h = houses.find((x) => x.name === q.get('name'));
        const state = q.get('state') as RogueState;
        if (!h || !['open', 'protected', 'marked'].includes(state)) return reply(res, { ok: false, error: 'no such house or state' });
        Object.assign(h, { state, rogue: state === 'marked' });
        tellState(h);
        reply(res, { ok: true, state });
      });
      // POST /town/rogue { on }: become a rogue (your protection goes) or quit (a mark stays: here, until the restart).
      server.middlewares.use('/town/rogue', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        const who = asOf(req).get('as') ?? 'Dev tester';
        const me = meOf(who);
        const { on } = (await readJson(req)) as { on?: boolean };
        const done = (ok: boolean, message: string) => reply(res, { ...hood(who), ok, message } satisfies TownHoodActionResponse);
        if (typeof on !== 'boolean') return done(false, 'Bad request');
        if (on === me.rogue) return done(false, on ? "You're a rogue already." : "You're not a rogue.");
        setMine(who, me.state === 'protected' ? 'open' : me.state, on);
        town.system({ kind: 'steal', text: on ? `${who} became a rogue` : `${who} quit being a rogue`, tone: on ? 'lose' : 'shop' }, who);
        server.config.logger.info(`[hood] ${who} ${on ? 'became a rogue' : 'quit being a rogue'}`, { timestamp: true });
        if (on) return done(true, "You're a rogue! Rogues can steal from anyone who isn't protected. Once you steal, other rogues can rob your house.");
        return done(true, me.state === 'marked' ? 'You quit being a rogue. You stay marked until 2 days after your last steal.' : "You quit being a rogue. You're open again.");
      });
      server.middlewares.use('/town/hood', async (req, res) => {
        const q = asOf(req);
        const who = q.get('as') ?? 'Dev tester';
        const me = meOf(who);
        if (req.method !== 'POST') {
          Object.assign(me, { keys: count(q, 'keys'), kalawang: count(q, 'kalawang'), stealAt: 0 }); // a page load: refilled
          return reply(res, hood(who));
        }
        const { action, lot } = (await readJson(req)) as { action: string; lot: number };
        const house = houses.find((h) => h.lot === lot)!;
        const done = (ok: boolean, message: string, extra = {}) => reply(res, { ...hood(who), ok, message, ...extra } satisfies TownHoodActionResponse);
        // The system feed's line, as the bot's web/hood.ts posts it.
        const line = (text: string, tone: string) => town.system({ kind: 'steal', text, tone }, who);
        // Only rogues steal or throw a Kalawang Potion; a protected house is never robbed or rusted (the bot's rules).
        if (!me.rogue) return done(false, 'Only rogues can steal. Become a rogue first: your house becomes fair game for other rogues once you steal.');
        if (house.state === 'protected') return done(false, `${house.owner} was robbed already, so their house is protected. It stays safe unless they turn rogue.`);
        if (action === 'kalawang') {
          if (me.kalawang < 1) return done(false, 'You have no Kalawang Potion.');
          me.kalawang--;
          line(`${who} rusted ${house.owner}'s Bakod with a Kalawang Potion`, 'lose');
          return done(true, `Half of ${house.owner}'s Bakod rusted away.`);
        }
        if (house.fenced && action !== 'key') return done(false, `${house.owner}'s house has a Bakod. Use a Master Key to get past it.`);
        if (action === 'key') {
          if (me.keys < 1) return done(false, 'You have no Master Key.');
          me.keys--;
        }
        if (q.has('cooldown')) me.stealAt = Date.now() + 60 * 60_000;
        const roll = q.get('steal') ?? (['win', 'bust', 'snap'] as const)[Math.floor(Math.random() * 3)];
        server.config.logger.info(`[hood] ${who} → ${house.owner}'s house: ${roll}`, { timestamp: true });
        const key = action === 'key';
        // The attempt goes ahead: you're marked (and your house shows the mask).
        setMine(who, 'marked', true);
        if (key && roll === 'snap') {
          line(`${who}'s Master Key snapped on ${house.owner}'s Bakod`, 'lose');
          return done(true, 'Your Master Key snapped! The Bakod holds.');
        }
        if (roll === 'bust') {
          line(key ? `${who} broke through ${house.owner}'s Bakod with a Master Key, but the Tanod caught them` : `The Tanod caught ${who} breaking into ${house.owner}'s house`, 'bust');
          return done(true, `Huli ka! You pay ${house.owner} a fine of 2 Kowens and spend 5 minutes in jail.`, { busted: true });
        }
        me.kowens += 4;
        line(key ? `${who} broke through ${house.owner}'s Bakod with a Master Key and robbed the house: 4 Kowens` : `${who} robbed ${house.owner}'s house: 4 Kowens`, 'win');
        // An open house whose owner isn't a rogue is protected now (a marked one never is).
        const protects = house.state === 'open' && !house.rogue;
        if (protects) {
          house.state = 'protected';
          tellState(house);
          line(`${house.owner}'s house is now protected`, 'win');
        }
        return done(true, `You got away with 4 Kowens!${protects ? ` ${house.owner}'s house is protected now.` : ''}`, { stole: 4 });
      });

      // The Slums' and the Lumang Palengke's maps, each read again whenever its file changes (a new map from the art folder
      // needs no restart); a map with several Lantern Posts has their tiles blocked, as the bot's loadTownMap.
      type RoomMap = { size: [number, number]; spawn: [number, number]; blocked: number[][]; avoid: [number, number][]; lanterns?: LanternPost[] };
      const liveMap = (name: string) => {
        const file = join(server.config.publicDir, `assets/maps/${name}.json`);
        let at = 0;
        let map: RoomMap = { size: [0, 0], spawn: [0, 0], blocked: [], avoid: [] };
        return () => {
          const now = statSync(file).mtimeMs;
          if (now !== at) {
            at = now;
            const j = JSON.parse(readFileSync(file, 'utf8'));
            const blocked = blockedWithPosts(j.blocked, j.teleporters);
            map = { size: j.size, spawn: j.spawn, blocked, avoid: Object.values((j.gates ?? {}) as Record<string, [number, number][]>).flat(), lanterns: lanternPostsOf({ ...j, blocked }) };
          }
          return map;
        };
      };
      const slumsFile = join(server.config.publicDir, 'assets/maps/slums.json');
      const slumsMap = liveMap('slums');
      const palengkeMap = liveMap('palengke');
      const classes = (JSON.parse(readFileSync(join(server.config.publicDir, 'assets/classes/classes.json'), 'utf8')) as ClassesFile).classes;
      const classOf = (name: string) => classes.find((c) => c.id === kits.get(name)?.cls);
      // The Halloween event, off until the page's ?halloween=on (/__halloween): its mobs live in the Slums' room (and
      // Biikko in the Old Market's too), in a zone of their own, run by each room's director (as the bot's server.ts).
      const hwLoaded = loadHalloween();
      const halloween = new Halloween(hwLoaded.data, hwLoaded.maps, null);
      const slumsJson = JSON.parse(readFileSync(slumsFile, 'utf8'));
      slumsJson.mobZones = [...(slumsJson.mobZones ?? []), Halloween.eventZone(slumsJson.size)];
      // (The Lumang Palengke's mob room, made with the town below: its mini bosses for /__minibosses; its field boss the
      // Great Scale run by its director in a zone of its own, as the bot's server.ts.)
      let palengkeMobs: MobRoom | null = null;
      const palengkeJson = { ...JSON.parse(readFileSync(join(server.config.publicDir, 'assets/maps/palengke.json'), 'utf8')), blocked: palengkeMap().blocked };
      const scaleDef = palengkeJson.boss as FieldBossDef & { active?: boolean };
      const greatScale = scaleDef?.active !== false ? new GreatScale(scaleDef, loadStats(), loadGreatScaleArt(scaleDef.id)) : null;
      if (greatScale) palengkeJson.mobZones = [...(palengkeJson.mobZones ?? []), GreatScale.zone(scaleDef, palengkeJson.height?.[scaleDef.tile[1]]?.[scaleDef.tile[0]] ?? 0)];
      palengkeJson.mobZones = [...(palengkeJson.mobZones ?? []), Halloween.eventZone(palengkeJson.size)];
      const slumsMobs = new MobRoom(
        slumsJson,
        Math.random,
        Object.fromEntries(classes.map((c) => [c.id, c.skills.map((k) => k.level)])),
        loadSkillShapes(),
        loadMobKinds(),
        loadGolemArt(),
        undefined,
        undefined,
        { director: halloween.directorFor('slums') },
      );
      const warrensLive = loadWarrens(Object.fromEntries(classes.map((c) => [c.id, c.skills.map((k) => k.level)])));
      const ramonDone = new Set<string>();
      // Who has cleared a practice run of the Cellar here (the real one opens to them).
      const practicedHere = new Set<string>();
      const silongLive = loadSilong(Object.fromEntries(classes.map((c) => [c.id, c.skills.map((k) => k.level)])));
      const town = attachTown(httpServer as Parameters<typeof attachTown>[0], {
        map: { size: json.size, spawn: json.spawn, blocked: json.blocked, avoid: Object.values((json.gates ?? {}) as Record<string, [number, number][]>).flat(), lanterns: lanternPostsOf(json) },
        rooms: {
          hood: () => {
            const m = hoodMap(houses.length);
            return { size: m.size, spawn: m.spawn, blocked: m.blocked, avoid: m.exit };
          },
          slums: slumsMap,
          palengke: palengkeMap,
        },
        // The Old Market's opening time (CONTEXT.md Opening time) only when asked: DEV_OPENING=1 (its map's `opensAt`) or an
        // ISO time when starting the dev server; Game Masters (?as=GM…) still go in.
        ...(process.env.DEV_OPENING ? { opening: { palengke: { name: 'The Old Market', opensAt: process.env.DEV_OPENING === '1' ? palengkeJson.opensAt : process.env.DEV_OPENING } } } : {}),
        mobs: { slums: slumsMobs, palengke: (palengkeMobs = new MobRoom(palengkeJson, Math.random, Object.fromEntries(classes.map((c) => [c.id, c.skills.map((k) => k.level)])), loadSkillShapes(), loadMobKinds(), undefined, undefined, loadPalengkeLeveling(), { area: 'palengke', director: bothDirectors(greatScale, halloween.directorFor('palengke')) })) },
        ...(greatScale ? { greatScale: { boss: greatScale, room: 'palengke' } } : {}),
        // Its rewards: Kusing and Low Repair Kits into the kept items (the kits by pretend mail when the bag is full),
        // Kowens into the pretend wallet, the potion only printed.
        halloween: {
          event: halloween,
          give: (name, r, from) => {
            const g = gearOf(name);
            g.kusing += r.kusing;
            if (r.kowens) move(name, r.kowens);
            const fitted = !r.repairKits || !!devGive(items, g, 'low-repair-kit', { count: r.repairKits }, devUid);
            if (!fitted) {
              const kit = makeItem(items, 'low-repair-kit', { count: r.repairKits }, devUid);
              const now = Date.now();
              const m: TownMail = { id: ++mailSeq, from, title: 'Your Low Repair Kit', body: 'Your bag was full, so it came by mail.', at: now, expires: now + MAIL_RULES.days * 86_400_000, read: false, claimed: false, kowens: 0, kusing: 0, items: kit ? [kit] : [] };
              mailOf(name).unshift(m);
              town.mail(name, mailView(name).unread, m.from, m.title);
            }
            server.config.logger.info(`[halloween] ${name} got ${r.kowens} Kowens, ${r.kusing} Kusing, ${r.repairKits} kits${fitted ? '' : ' (by mail)'}${r.potion ? `, a ${r.potion} potion` : ''}`, { timestamp: true });
            return { kitsByMail: !fitted };
          },
        },
        // The Scrap Warrens as live; tickets from the kept bag (no refunds: nothing's saved here); Aling Nena's quest from the
        // page's pretend quests (a real run needs it done; a practice run, her ticket; its last boss, her binoculars).
        warrens: {
          ...warrensLive,
          access: (name) => {
            const W = warrensLive.data;
            const rq = W.entry.requiresQuest;
            const P = W.practice;
            if (!rq || !P) return { done: true };
            const q = questsOf.get(name);
            const bag = gearOf(name).bag;
            const count = (id?: string) => bag.reduce((n, i) => n + (i?.defId === id ? (i.count ?? 1) : 0), 0);
            const p = q?.active.find((x) => x.id === rq);
            // (The collect objective is its second: the binoculars not in the bag yet.)
            return { done: !!q?.done.includes(rq), needs: !!p && p.step === 1 && !count(P.drop), practiceTickets: count(P.ticket) };
          },
          practice: {
            use: (name) => !!warrensLive.data.practice && takeKind(gearOf(name).bag, warrensLive.data.practice.ticket, 1),
            drop: (name) => {
              const id = warrensLive.data.practice?.drop;
              const def = id ? items.defs.get(id) : undefined;
              return def ? newItem(items.stats, def, devUid()) : null;
            },
            refund: (name) => !!warrensLive.data.practice && !!devGive(items, gearOf(name), warrensLive.data.practice.ticket, {}, devUid),
          },
          tickets: {
            count: (name) => gearOf(name).bag.reduce((n, i) => n + (i?.defId === 'warren-ticket' ? (i.count ?? 1) : 0), 0),
            use: (name) => takeKind(gearOf(name).bag, 'warren-ticket', 1),
            refund: (name) => !!devGive(items, gearOf(name), 'warren-ticket', {}, devUid),
          },
          saved: (runs) => server.config.logger.info(`[warrens] open runs: ${runs.map((r) => `${r.id} (${r.opener}${r.cleared ? ', cleared' : r.spent ? ', ticket spent' : ''})`).join(', ') || 'none'}`, { timestamp: true }),
        },
        // Ang Silong as live: keys from the kept bag (?give=susi-ng-silong::3, ?give=practice-susi-ng-silong), "Ngayon Na"
        // from the page's pretend quests (anyone may come in when the page sent none).
        silong: {
          ...silongLive,
          gate: (() => {
            const h = (palengkeJson.objects as { id?: string; col: number; row: number }[]).find((o) => o.id === 'palengke-silong-hatch');
            return [(h?.col ?? 0) + 2, (h?.row ?? 0) + 2] as [number, number];
          })(),
          keys: {
            count: (name) => gearOf(name).bag.reduce((n, i) => n + (i?.defId === 'susi-ng-silong' ? (i.count ?? 1) : 0), 0),
            use: (name) => takeKind(gearOf(name).bag, 'susi-ng-silong', 1),
            refund: (name) => !!devGive(items, gearOf(name), 'susi-ng-silong', {}, devUid),
          },
          practice: {
            use: (name) => takeKind(gearOf(name).bag, 'practice-susi-ng-silong', 1),
            refund: (name) => !!devGive(items, gearOf(name), 'practice-susi-ng-silong', {}, devUid),
          },
          access: (name) => {
            const q = questsOf.get(name);
            const bag = gearOf(name).bag;
            // (A practice run cleared here, or the page's pretend quests say so: ?practiced=1.)
            const practiced = !q || practicedHere.has(name) || !!q.flags?.some((f) => f === 'silong-practice-cleared' || f === 'silong-cleared');
            return { done: !q || q.done.includes('palengke-15'), practiceKeys: bag.reduce((n, i) => n + (i?.defId === 'practice-susi-ng-silong' ? (i.count ?? 1) : 0), 0), practiced };
          },
          buyKey: (name) => {
            const g = gearOf(name);
            if (g.kusing < 200_000) return 'Not enough Kusing.';
            if (!devGive(items, g, 'susi-ng-silong', {}, devUid)) return 'Your bag is full.';
            g.kusing -= 200_000;
            return null;
          },
          cleared: (names, practice) => {
            if (practice) for (const n of names) practicedHere.add(n);
            server.config.logger.info(`[silong] ${practice ? 'practice ' : ''}cleared by ${names.join(', ')}`, { timestamp: true });
          },
          // Mang Pido's Practice Cellar Key again (in memory: no 24 h wait here).
          practiceKey: (name) => {
            const g = gearOf(name);
            if (practicedHere.has(name)) return "You've had your practice. Go on down for real.";
            if (g.bag.some((i) => i?.defId === 'practice-susi-ng-silong')) return 'You still have a Practice Cellar Key.';
            return devGive(items, g, 'practice-susi-ng-silong', {}, devUid) ? null : 'Your bag is full.';
          },
          // Mang Ramon's box and Kuya Jun's thanks on the kept bag (whether he has the note: in memory here).
          ramon: {
            box: (name) => {
              const g = gearOf(name);
              if (ramonDone.has(name)) return 'done';
              if (g.bag.some((i) => i?.defId === 'ramon-note')) return 'have';
              return devGive(items, g, 'ramon-note', {}, devUid) ? 'given' : 'full';
            },
            give: (name) => {
              const g = gearOf(name);
              if (ramonDone.has(name)) return 'He already has it.';
              if (!takeKind(g.bag, 'ramon-note', 1)) return "You don't have Mang Ramon's note.";
              if (!devGive(items, g, 'mid-repair-kit', {}, devUid)) return 'Make room in your bag first.';
              ramonDone.add(name);
              return null;
            },
          },
          saved: (runs) => server.config.logger.info(`[silong] open runs: ${runs.map((r) => `${r.id} (${r.opener}${r.spent ? ', key spent' : ''})`).join(', ') || 'none'}`, { timestamp: true }),
        },
        // Lantern Posts: the dev town's kept items (?give=return-lantern::5); the posts each player has restored in memory
        // (?lanterns=all: every one, ?lanterns=none: none again; CONTEXT.md Restored Lantern Post).
        lanterns: {
          count: (name) => gearOf(name).bag.reduce((n, i) => n + (i?.defId === RETURN_LANTERN ? (i.count ?? 1) : 0), 0),
          use: (name) => takeKind(gearOf(name).bag, RETURN_LANTERN, 1),
          restored: (name) => [...(restoredBy.get(name) ?? [])],
          restore: (name, post) => {
            const mine = restoredBy.get(name) ?? restoredBy.set(name, new Set()).get(name)!;
            return !mine.has(post) && !!mine.add(post);
          },
        },
        moveLevel: (cls, move) => moveUnlock(classes.find((c) => c.id === cls), move),
        // Friends in memory (a restart forgets them); a request by name finds anyone who has logged in since it started.
        friends: {
          store: { load: () => ({ friends: [], requests: [], seen: [], blocks: [] }), friend: () => {}, request: () => {}, seen: () => {}, block: () => {} },
          byName: (name) => [...kits.keys()].find((n) => n.toLowerCase() === name.trim().toLowerCase()) ?? null,
        },
        // A Game Master's testing switches in memory (a restart forgets them).
        testing: {
          get: (name) => testing.get(name) ?? { unkillable: false, freeMp: false },
          set: (name, change) => {
            const next = { ...(testing.get(name) ?? { unkillable: false, freeMp: false }), ...change };
            testing.set(name, next);
            return next;
          },
        },
        // Privacy settings in memory (a restart forgets them).
        privacy: {
          get: (name) => privacy.get(name) ?? DEFAULT_PRIVACY,
          set: (name, change) => {
            const next = { ...(privacy.get(name) ?? DEFAULT_PRIVACY), ...change };
            privacy.set(name, next);
            return next;
          },
        },
        shared: true,
        arenaBets,
        authenticate: async (req) => {
          const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
          const name = q.get('dev')?.slice(0, 16);
          if (!name) return null;
          try {
            const lanterns = q.get('lanterns');
            if (lanterns === 'all') restoredBy.set(name, new Set(allPosts()));
            else if (lanterns === 'none') restoredBy.delete(name);
            const kit = (JSON.parse(q.get('kit') ?? 'null') ?? {}) as { cls?: string | null; weapon?: string | null; progress?: SavedProgress; quests?: { active: { id: string; step: number }[]; done: string[] } };
            kits.set(name, { cls: kit.cls ?? null, weapon: kit.weapon ?? null });
            if (kit.quests) questsOf.set(name, kit.quests);
            if (kit.progress) levels.set(name, progressView(stats, kit.cls ?? null, kit.progress));
          } catch {
            // no class yet
          }
          try {
            looks.set(name, JSON.parse(q.get('look') ?? 'null'));
          } catch {
            // no look: the game shows a random one
          }
          return name;
        },
        profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#B794F6' }, outfit: looks.get(name) ?? ({} as OutfitData), cls: kits.get(name)?.cls, weapon: kits.get(name)?.weapon, weaponPlus: plusOf(name), level: levelOf(name).level, pet: petOf(name) }),
        // Aling Conching's dishes, bought with the kept Kusing against the page's pretend quests (in memory: a restart
        // ends them).
        dishes: {
          buy: (name, dish) => {
            const P = loadPalengkeLeveling() as unknown as PalengkeData;
            const g = gearOf(name);
            const refused = dishRefusal({ quests: questsOf.get(name) ?? { active: [], done: [] }, kusing: g.kusing }, palengkeQuests(P, mobName), P, dish);
            if (refused) return refused;
            g.kusing -= dishOf(P, dish)!.kusing;
            server.config.logger.info(`[dishes] ${name} bought ${dish}`, { timestamp: true });
            return null;
          },
        },
        // Quest items (the Palengke's chain): dropped for a player while their pretend quests ask for them (the page
        // counts the kills itself: no `kill` here).
        quests: {
          drops: (name, kind) => {
            const P = loadPalengkeLeveling() as unknown as PalengkeData;
            const q = questsOf.get(name);
            if (!q) return [];
            return questItemDrops({ quests: q, bag: gearOf(name).bag }, palengkeQuests(P, mobName), P, kind).flatMap((id) => {
              const def = items.defs.get(id);
              return def ? [newItem(items.stats, def, devUid())] : [];
            });
          },
        },
        progress: {
          fighter: (name) => {
            const p = levelOf(name);
            const kit = kits.get(name);
            const pet = gear.get(name)?.pet;
            const worn = [...wornItems(gear.get(name) ?? { equipped: {} }), ...(pet ? [pet] : [])]; // (a Moonlight weapon's stats too, on its class)
            return { cls: kit?.cls, level: p.level, points: p.points, gear: worn.length ? worn : [kit?.weapon], skills: damageSkillLevels(classOf(name), p), buffLevels: buffSkillLevels(classOf(name), p) }; // everything worn (its DEF, HP…)
          },
          kill: (name, mob) => {
            const r = killXp(stats, kits.get(name)?.cls ?? null, levelOf(name), mob);
            levels.set(name, r.progress);
            server.config.logger.info(`[levels] ${name} +${r.gained} XP → Lv ${r.progress.level} (${r.progress.xp}/${r.progress.next})`, { timestamp: true });
            return r;
          },
        },
        // /__loot?rich=1: nearly every kill drops gear and a potion (the first kinds: the rolls come out low); their plus
        // keeps its real odds (+0 to +3).
        lootRandom: () => (richLoot ? Math.random() * 0.04 : Math.random()),
        lootPlusRandom: Math.random,
        items: {
          take: (name, loot) => {
            // (An event's Kowens into the pretend wallet, its potion only printed.)
            if ('kowens' in loot) return (move(name, loot.kowens), true);
            if ('potion' in loot) return (server.config.logger.info(`[halloween] ${name} picked up a ${loot.potion} potion`, { timestamp: true }), true);
            return takeLoot(items, gearOf(name), loot, devUid);
          },
          // Timed items that ran out: gone from the kept items (the page's copy follows the `items` sent after).
          expire: (name) => expireItems(gearOf(name), Date.now()).map((g) => ({ name: items.defs.get(g.item.defId)?.name ?? g.item.defId, worn: !!g.place })),
          usePotion: (name, defId) => usePotion(items, gearOf(name), defId),
          state: (name) => gearOf(name),
          drop: (name, uid, count) => dropFromBag(items, gearOf(name), uid, count, devUid),
          // Trades: the bot's settleTrade on the kept copies (logged here instead of the trades table).
          trade: (users, offers, names) => {
            const r = settleTrade(items, [gearOf(users[0]), gearOf(users[1])], offers, names, devUid);
            const list = (i: 0 | 1) => [...offers[i].items.map((x) => `${x.defId}${x.count > 1 ? ` ×${x.count}` : ''}`), ...(offers[i].kusing ? [`${offers[i].kusing} Kusing`] : [])].join(', ') || 'nothing';
            server.config.logger.info(r.ok ? `[trade] ${users[0]} gave ${list(0)}; ${users[1]} gave ${list(1)}` : `[trade] refused: ${r.message}`, { timestamp: true });
            return r.ok ? { ok: true } : r;
          },
        },
        // Pet XP on the kept copy's pet out (sent to the page as 'pet-xp').
        pets: {
          xp: (name, n) => {
            const pet = gear.get(name)?.pet;
            const R = petRules(stats);
            if (!pet || !R) return null;
            const g = gainPetXp(R, pet, n);
            if (g.ups) server.config.logger.info(`[pets] ${name}'s ${pet.defId} reached Lv ${pet.level}`, { timestamp: true });
            return g.gained ? { pet, ups: g.ups } : null;
          },
        },
        onSay: (_id, nickname, text, megaphone, gm) => server.config.logger.info(`[town chat → Discord] ${!gm && megaphone ? '📢 ' : ''}${nickname}: ${text}`, { timestamp: true }),
        gm: (name) => /^gm/i.test(name), // dev: players named GM… (?as=GMTwigo) are Game Masters
      });
      server.middlewares.use('/__halloween', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const said = town.halloweenDev(q.get('as') ?? '', { mikko: q.has('mikko'), biikko: q.has('biikko'), round: q.has('round'), carry: q.has('carry'), ...(q.has('biikkohp') ? { wound: Number(q.get('biikkohp')) } : {}) });
        server.config.logger.info(`[halloween] ${said}`, { timestamp: true });
        res.end(`${said}\n`);
      });
      server.middlewares.use('/__title', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        town.newTitle(q.get('as') ?? '', q.get('id') ?? 'richest', { name: q.get('name') ?? 'Richest Among All', color: q.get('color') ?? '#FFD54A' });
        res.end('title sent\n');
      });
      server.middlewares.use('/__look', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const name = q.get('as') ?? '';
        try {
          if (q.get('look')) looks.set(name, JSON.parse(q.get('look')!));
        } catch {
          // keep the look they had
        }
        town.restyle(name, looks.get(name) ?? ({} as OutfitData), { name: q.get('title') ?? 'Townfolk', color: q.get('color') ?? '#B794F6' });
        res.end(`${name} restyled\n`);
      });
      // /__dish?as=Alice&dish=lugaw: a dish served free (a pretend quest's: Q1's Lugaw, a daily order's).
      server.middlewares.use('/__dish', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        town.serveDish(q.get('as') ?? '', q.get('dish') ?? '');
        res.end('served\n');
      });
      // POST /__quests?as=Alice {active, done}: her pretend quests changed (the Warren Gate asks about Aling Nena's).
      server.middlewares.use('/__quests', async (req, res) => {
        const name = new URL(req.url ?? '/', 'http://localhost').searchParams.get('as') ?? '';
        try {
          questsOf.set(name, JSON.parse(await new Promise<string>((ok) => {
            let s = '';
            req.on('data', (d) => (s += d));
            req.on('end', () => ok(s));
          })));
        } catch {
          // keep what was known
        }
        res.end('ok');
      });
      server.middlewares.use('/__kit', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const name = q.get('as') ?? '';
        const kit = { cls: q.get('cls') || null, weapon: q.get('weapon') || null };
        kits.set(name, kit);
        try {
          if (q.get('progress')) levels.set(name, progressView(stats, kit.cls, JSON.parse(q.get('progress')!))); // a class change gives the points back
        } catch {
          // keep their level as it was
        }
        town.kit(name, kit.cls, kit.weapon, plusOf(name));
        res.end(`${name}: ${kit.cls ?? 'no class'}, ${kit.weapon ?? 'no weapon'}\n`);
      });
      server.middlewares.use('/__items', async (req, res) => {
        const name = new URL(req.url ?? '/', 'http://localhost').searchParams.get('as') ?? '';
        if (req.method !== 'POST') return reply(res, gear.has(name) ? { known: true, ...gearOf(name) } : { known: false });
        const body = (await readJson(req)) as unknown as TownItems;
        const petBefore = petOf(name);
        if (body && typeof body === 'object' && Array.isArray(body.bag)) gear.set(name, { equipped: body.equipped ?? {}, cosmetics: body.cosmetics ?? {}, bag: body.bag, kusing: Number(body.kusing) || 0, pet: body.pet ?? null });
        if (petOf(name) !== petBefore) town.pet(name, petOf(name));
        town.kit(name, kits.get(name)?.cls ?? null, gearOf(name).equipped.weapon?.defId ?? kits.get(name)?.weapon ?? null, plusOf(name)); // its HP and DEF in fights, its aura
        reply(res, { ok: true });
      });
      server.middlewares.use('/__give', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const name = q.get('as') ?? '';
        const g = gearOf(name);
        const said: string[] = [];
        if (q.has('kusing')) said.push(`Kusing ${(g.kusing = Math.max(0, Math.floor(Number(q.get('kusing'))) || 0))}`);
        if (q.has('whetstones')) said.push(devGive(items, g, 'rough-whetstone', { count: Math.max(1, Math.floor(Number(q.get('whetstones'))) || 1) }, devUid) ? `${q.get('whetstones')} Rough Whetstones` : 'no room for the whetstones');
        if (q.get('def')) {
          const it = devGive(items, g, q.get('def')!, { rarity: (q.get('rarity') || undefined) as GearRarity | undefined, plus: Number(q.get('plus') ?? 0), count: Number(q.get('count') ?? 1), level: Number(q.get('level') ?? 0) || undefined }, devUid);
          said.push(it ? `${it.defId} (${it.rarity} +${it.plus})` : `no ${q.get('def')} (unknown, or no room)`);
        }
        town.items(name);
        server.config.logger.info(`[items] ${name}: ${said.join(', ')}`, { timestamp: true });
        reply(res, { said, items: g }); // (the page takes them from here too, in case its socket isn't up yet)
      });
      // ── Pretend mail (the bot's web/mail.ts in memory, by name): /__mail sends, /town/mail reads, claims, deletes ──
      const mailboxes = new Map<string, TownMail[]>();
      let mailSeq = 0;
      const mailOf = (name: string) => {
        const list = (mailboxes.get(name) ?? []).filter((m) => m.expires > Date.now());
        mailboxes.set(name, list);
        return list;
      };
      const mailView = (name: string) => ({ mail: mailOf(name), unread: mailOf(name).filter((m) => !m.read).length });
      server.middlewares.use('/__mail', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const name = q.get('as') ?? 'Dev tester';
        const made = q.getAll('give').flatMap((g) => {
          const [defId, rarity, plus, count] = g.split(':');
          const it = makeItem(items, defId, { rarity: (rarity || undefined) as GearRarity | undefined, plus: Number(plus || 0), count: Number(count || 1) }, devUid);
          return it ? [it] : [];
        });
        const now = Date.now();
        const m: TownMail = {
          id: ++mailSeq, from: q.get('from') || 'The Tanod', title: q.get('title') || 'A letter from the Tanod', body: q.get('body') || 'Salamat for playing, citizen. Here is a little something.',
          at: now, expires: now + MAIL_RULES.days * 86_400_000, read: false, claimed: false,
          kowens: Math.max(0, Number(q.get('kowens')) || 0), kusing: Math.max(0, Number(q.get('kusing')) || 0), items: made,
        };
        m.claimed = !hasAttachments(m);
        mailOf(name).unshift(m);
        town.mail(name, mailView(name).unread, m.from, m.title);
        server.config.logger.info(`[mail] to ${name}: ${m.title}`, { timestamp: true });
        reply(res, mailView(name));
      });
      server.middlewares.use('/town/mail', async (req, res) => {
        const name = asOf(req).get('as') ?? 'Dev tester';
        if (req.method !== 'POST') return reply(res, mailView(name));
        const a = parseMailAction(await readJson(req));
        const done = (ok: boolean, extra: Record<string, unknown> = {}) => reply(res, { ...mailView(name), ok, ...extra });
        if (!a) return done(false, { message: 'invalid action' });
        const claim = (m: TownMail): string | null => {
          if (!hasAttachments(m)) return 'Nothing left to claim.';
          const why = claimInto(items, gearOf(name), m, devUid);
          if (why) return why;
          m.claimed = m.read = true;
          return null;
        };
        const sum = (list: TownMail[]) => ({ kowens: list.reduce((n, m) => n + m.kowens, 0), kusing: list.reduce((n, m) => n + m.kusing, 0), items: list.flatMap((m) => m.items) });
        if (a.action === 'claim-all') {
          const got: TownMail[] = [];
          let why: string | null = null;
          for (const m of [...mailOf(name)].reverse().filter(hasAttachments)) {
            why = claim(m);
            if (why) break;
            got.push(m);
          }
          if (got.length) town.items(name);
          return done(!!got.length || !why, { ...(got.length ? { got: sum(got) } : {}), ...(why ? { message: why } : {}) });
        }
        if (a.action === 'delete-read') {
          mailboxes.set(name, mailOf(name).filter((m) => !m.read || hasAttachments(m)));
          return done(true);
        }
        const m = mailOf(name).find((x) => x.id === a.id);
        if (!m) return done(false, { message: 'That mail is gone.' });
        if (a.action === 'read') {
          m.read = true;
          return done(true);
        }
        if (a.action === 'claim') {
          const why = claim(m);
          if (why) return done(false, { message: why });
          town.items(name);
          return done(true, { got: sum([m]) });
        }
        if (hasAttachments(m)) return done(false, { message: 'Claim what’s attached first.' });
        mailboxes.set(name, mailOf(name).filter((x) => x !== m));
        return done(true);
      });
      // GET /__roll?as=Alice   a rare item (orange, two slots, of Calamity or Flamboyance) drops for Alice and her party in
      // the room: the roll pop-up for them all (alone: it just lies there for her).
      server.middlewares.use('/__roll', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://x').searchParams;
        const name = q.get('as') ?? 'Dev tester';
        const def = [...items.defs.values()].find((d) => isGearDef(d) && d.slot === 'weapon' && !d.training);
        let item = null;
        for (let i = 0; i < 400 && def && isGearDef(def) && !item; i++) {
          const it = rollGear(items.stats, def, 'darkOrange', devUid());
          if (rollWorthy(items, it)) item = it;
        }
        res.end(item && town.rollLoot(name, item) ? `rolling ${item.defId} for ${name}` : 'no roll (no such player in town?)');
      });
      server.middlewares.use('/__loot', (req, res) => {
        richLoot = new URL(req.url ?? '/', 'http://localhost').searchParams.get('rich') === '1';
        res.end(`rich loot ${richLoot ? 'on' : 'off'}\n`);
      });
      server.middlewares.use('/__shop', async (req, res) => {
        const name = new URL(req.url ?? '/', 'http://localhost').searchParams.get('as') ?? '';
        // (Kowens: the page's pretend shop's, sent along.)
        const { id, quantity, kowens } = (await readJson(req)) as { id?: string; quantity?: number; kowens?: number };
        let have = Number(kowens) || 0;
        const spend = { have, spend: (n: number) => (have >= n ? ((have -= n), true) : false) };
        const def = items.defs.get(String(id));
        // (a cosmetic or a Set: the Cosmetics tab, Halloween's Witch pieces while it's on here)
        const r = String(id).startsWith('set:') || (def && !isGearDef(def) && def.kind === 'cosmetic')
          ? buyCosmetic(items, gearOf(name), String(id), { halloween: { on: halloween.on(Date.now()), window: hwLoaded.data } }, spend, devUid)
          : buyCombat(items, gearOf(name), levelOf(name).level, String(id), Number(quantity), spend, devUid);
        if (r.ok) town.items(name);
        reply(res, { ok: r.ok, message: r.message, kusing: gearOf(name).kusing, kowens: have });
      });
      server.middlewares.use('/__forge', async (req, res) => {
        const name = new URL(req.url ?? '/', 'http://localhost').searchParams.get('as') ?? '';
        const action = parseForgeAction(await readJson(req));
        if (!action) return reply(res, { ok: false, message: 'Invalid forge action.' });
        const g = gearOf(name);
        const before = JSON.stringify(g.equipped);
        const r = forge(items, g, action, Math.random, devUid);
        if (r.ok) {
          town.items(name);
          if (before !== JSON.stringify(g.equipped)) town.kit(name, kits.get(name)?.cls ?? null, g.equipped.weapon?.defId ?? null, plusOf(name));
          server.config.logger.info(`[forge] ${name}: ${action.action} ${r.outcome}: ${r.message}`, { timestamp: true });
          // +15 and up: the town's system feed, as live.
          const cls = kits.get(name)?.cls ?? null;
          const line = r.outcome === 'success' && r.item ? enhanceFeedLine(items, name, r.item, cls ? (items.stats.classes[cls]?.main ?? null) : null) : null;
          if (line) town.system({ kind: 'forge', text: line.text, tone: line.tone }, name);
        }
        reply(res, { ...r, items: g });
      });
      // POST /__pet?as=Alice {action, …}   a pet action on her kept items (the page's pretend /town/pet): shared petAction,
      // the swap cooldown and the town's fight rule as live.
      server.middlewares.use('/__pet', async (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const name = q.get('as') ?? '';
        const g = gearOf(name);
        // GET ?level=N&xp=M: her pet out (else the first in her bag) set to that level and XP (the page's ?petlevel= / ?petxp=).
        if (req.method !== 'POST') {
          const pet = g.pet ?? g.bag.find((i) => petIdOf(items, i));
          const R = petRules(stats);
          if (!pet || !R) return reply(res, { ok: false, message: 'No pet.' });
          setPetLevel(R, pet, Number(q.get('level') ?? pet.level), Number(q.get('xp') ?? 0));
          town.items(name);
          return reply(res, { ok: true, items: g });
        }
        const action = parsePetAction(await readJson(req));
        if (!action) return reply(res, { ok: false, message: 'Invalid pet action.' });
        const now = Date.now();
        const r = petAction(items, g, action, { lastChange: petChanges.get(name), now, inCombat: town.inCombat(name), newUid: devUid });
        if (r.changed) {
          petChanges.set(name, now);
          town.pet(name, petOf(name));
        }
        if (r.ok) town.items(name);
        server.config.logger.info(`[pets] ${name}: ${action.action} ${r.ok ? 'ok' : `refused: ${r.message}`}`, { timestamp: true });
        reply(res, { ...r, items: g });
      });
      server.middlewares.use('/__xp', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const name = q.get('as') ?? '';
        const cls = kits.get(name)?.cls ?? null;
        const r = q.has('level') ? levelTo(stats, cls, levelOf(name), Number(q.get('level'))) : addXp(stats, cls, levelOf(name), Number(q.get('xp')));
        levels.set(name, r.progress);
        town.progress(name, r.progress, r.ups, r.gained);
        res.end(`${name}: Lv ${r.progress.level}, ${r.progress.xp}/${r.progress.next} XP (+${r.gained}, ${r.ups} level-up${r.ups === 1 ? '' : 's'})\n`);
      });
      // The GM tools (ui/gm-tools.ts): /__gm?as=Name&heal=1 (full HP and MP), &to=col,row (a jump on their map),
      // &slay=8 (every mob that near down: XP, loot, quest kills theirs), &unkillable=0|1, &freemp=0|1 (the testing switches,
      // for anyone here).
      server.middlewares.use('/__gm', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const name = q.get('as') ?? '';
        const to = q.get('to')?.split(',').map(Number);
        const testing = { ...(q.has('unkillable') ? { unkillable: q.get('unkillable') === '1' } : {}), ...(q.has('freemp') ? { freeMp: q.get('freemp') === '1' } : {}) };
        const said = town.gmDev(name, {
          heal: q.has('heal'),
          ...(to?.length === 2 && to.every(Number.isFinite) ? { to: [to[0], to[1]] as [number, number] } : {}),
          ...(q.has('slay') ? { slay: Math.min(30, Math.max(1, Number(q.get('slay')) || 8)) } : {}),
          ...(Object.keys(testing).length ? { testing } : {}),
        });
        server.config.logger.info(`[gm] ${name}: ${said}`, { timestamp: true });
        res.end(`${said}\n`);
      });
      server.middlewares.use('/__points', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const name = q.get('as') ?? '';
        const cls = kits.get(name)?.cls ?? null;
        const r = q.has('reset') ? { ok: true as const, progress: resetStatPoints(stats, cls, levelOf(name)) } : spendPoint(stats, cls, levelOf(name), q.get('stat') as 'STR');
        if (r.ok) {
          levels.set(name, r.progress);
          town.progress(name, r.progress);
        }
        reply(res, r);
      });
      server.middlewares.use('/__skills', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const name = q.get('as') ?? '';
        const cls = kits.get(name)?.cls ?? null;
        const r = q.has('reset') ? { ok: true as const, progress: resetSkillPoints(stats, cls, levelOf(name)) } : raiseSkill(stats, cls, levelOf(name), [...classSkills(classOf(name)), ...classBuffs(classOf(name))].find((k) => k.key === q.get('skill')));
        if (r.ok) {
          levels.set(name, r.progress);
          town.progress(name, r.progress);
        }
        reply(res, r);
      });
      server.middlewares.use('/__announce', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        town.announce({ kind: q.get('kind') === 'jackpot' ? 'jackpot' : 'notice', title: q.get('title') ?? 'Notice', text: q.get('text') ?? '' });
        res.end('announced in town\n');
      });
      server.middlewares.use('/__system', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const kind = q.get('kind');
        const itemId = q.get('itemId');
        town.system(
          {
            kind: kind === 'gamble' || kind === 'jackpot' ? kind : 'dig',
            text: q.get('text') ?? '',
            tone: q.get('tone') ?? 'common',
            ...(itemId ? { itemId, itemName: q.get('itemName') ?? itemId } : {}),
            ...(q.get('amount') ? { amount: Number(q.get('amount')) } : {}),
          },
          q.get('as') ?? undefined,
        );
        res.end('sent to the system feed\n');
      });
      server.middlewares.use('/__gift', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const who = q.get('as') ?? '';
        if (q.has('wallet')) town.wallet(who);
        else if (q.has('item')) town.giftedItem(who, 'The gifter', { id: q.get('item')!, name: q.get('name') ?? q.get('item')!, rarity: q.get('rarity') ?? 'common' }, Number(q.get('qty') ?? 1));
        else town.gifted(who, 'The gifter', Number(q.get('amount') ?? 50));
        res.end('sent\n');
      });
      server.middlewares.use('/__jail', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        town.setJailed(q.get('name') ?? '', q.get('on') !== '0');
        res.end('jail updated in town\n');
      });
      server.middlewares.use('/__golem', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        if (q.has('demo')) {
          slumsMobs.golemDemo(Date.now(), q.get('as') ?? 'Dev tester');
          return void res.end('the golem plays its fight\n');
        }
        res.end(slumsMobs.riseGolem(Date.now()) ? 'the golem rises\n' : 'the golem is up already\n');
      });
      server.middlewares.use('/__warrens', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const hp = Number(q.get('hp'));
        reply(res, town.warrensDev(q.get('as') ?? '', q.get('boss') || undefined, hp > 0 ? hp : undefined));
      });
      if (greatScale && palengkeMobs) greatScale.attach(palengkeMobs);
      server.middlewares.use('/__greatscale', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        if (!greatScale || !palengkeMobs) return void res.end('no Great Scale\n');
        const hp = Number(q.get('hp'));
        if (hp > 0) {
          palengkeMobs.devWound(greatScale.id, hp);
          return void res.end(`the Great Scale down to ${hp} HP\n`);
        }
        res.end(greatScale.wakeNow(Date.now()) ? 'the Great Scale wakes\n' : 'the Great Scale is awake already\n');
      });
      server.middlewares.use('/__silong', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const f = q.get('floor');
        reply(res, town.silongDev(q.get('as') ?? '', f === 'b1' || f === 'b2' || f === 'b3' || f === 'plant' ? f : undefined, Number(q.get('hp')) || undefined));
      });
      server.middlewares.use('/__minibosses', (_req, res) => {
        res.end(`${slumsMobs.respawnMinis() + (palengkeMobs?.respawnMinis() ?? 0)} mini bosses back\n`);
      });
      server.middlewares.use('/__flex', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        town.flexed(q.get('as') ?? '', { id: q.get('itemId') ?? '', name: q.get('itemName') ?? '', rarity: q.get('rarity') ?? 'common' });
        res.end('flexed in town\n');
      });
      server.middlewares.use('/__discord', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        town.fromDiscord(q.get('name') ?? 'Someone', q.get('text') ?? '');
        res.end('sent to the town chat\n');
      });
    },
  };
}
