import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { HoodHouse, HouseLook, OutfitData, TownHoodActionResponse, TownHoodResponse, TownRace, TownRaceResponse } from '@mikazuki/shared';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { doorSpot, hoodMap, lotTile } from '../../bot/src/web/hood-map.ts';
import type { Plugin } from 'vite';
import { attachTown } from '../../bot/src/web/town.ts';
import { MobRoom, loadMobKinds, loadSkillShapes } from '../../bot/src/web/town-mobs.ts';
import { type SavedProgress, addXp, freshProgress, killXp, levelTo, progressView } from '../../bot/src/web/progress.ts';
import { loadStats } from '../../bot/src/web/stats-data.ts';
import { loadGolemArt } from '../../bot/src/web/town-golem.ts';
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
//   GET /__golem?now=1   the Scrapheap Golem rises in the Slums now (the page's ?golem=now); ?demo=1&as=Alice: it rises if
//       it must and plays its whole fight against the nearest player (?golemdemo=1): each attack, the Junk at a pretend
//       half, Enrage at a pretend quarter, death (the line names Alice if nobody hit it)
//   GET /__flex?as=Bob&itemId=rock&itemName=Rock&rarity=junk   Bob flexes an item (chat line + bubble)
//   GET /__gift?as=Alice&amount=50   Alice gets the gift pop-up (as from /gift kowens); &wallet=1: only her HUD's Kowens reload
//   GET /__gift?as=Alice&item=megaphone&name=Megaphone&qty=3   Alice gets the item gift pop-up (as from /gift item)
//   GET /__title?as=Alice&id=richest&name=Richest%20Among%20All&color=%23FFD54A   Alice gets the new-title pop-up
//   GET /__look?as=Alice&look={…}&title=Kalbo&color=%23F8BF27   Alice's new look / title (the pretend Parlor calls it)
//   GET /__kit?as=Alice&cls=stick&weapon=weapon-training-stick   Alice's class and worn weapon (the pretend quests and
//   equipment call it; the page also sends them on connect as &kit=, with her level, XP and points)
//   GET /__xp?as=Alice&xp=500   Alice gains 500 XP (&level=10: her level set to 10), as from kills: her level-ups, "Level
//   up!" for her room, her HUD (the page's ?xp= / ?level= call it). Levels live here in memory (bot web/progress.ts),
//   from what the page sent on connect; kills in the Slums give XP the same way.
//   The neighbourhood (?area=hood): GET /town/hood, POST /town/house, POST /town/hood answered here with pretend
//   neighbours (one with a Bakod) and your house (by ?as=, from the page's address); &steal=win|bust|snap decides a
//   steal (else it's random). Each page load refills your Master Keys and Kalawang Potions (3 each, or &keys=N
//   &kalawang=N) and there's no steal cooldown unless &cooldown=1. Its room on the town server uses the bot's own
//   layout (web/hood-map.ts).
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
      const kits = new Map<string, { cls: string | null; weapon: string | null }>(); // class and worn weapon (the pretend quests)
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
      const neighbours: { name: string; style: string; colours: Record<string, string>; fenced: boolean }[] = [
        { name: 'Kiko', style: 'kubo', colours: {}, fenced: false },
        { name: 'Mara', style: 'cottage', colours: { walls: 'rose', roof: 'berry' }, fenced: true },
        { name: 'Tess', style: 'townhouse', colours: {}, fenced: false },
        { name: 'Jun', style: 'modern', colours: { walls: 'sun', trim: 'harbour' }, fenced: false },
        { name: 'Lola', style: 'aframe', colours: { roof: 'moss' }, fenced: false },
        { name: 'Ben', style: 'cottage', colours: { walls: 'harbour', roof: 'white' }, fenced: false },
      ];
      const houses: (HoodHouse & { name: string })[] = neighbours.map((h, lot) => ({ ...h, lot, owner: h.name, title: { name: 'Townfolk', color: '#B794F6' } }));
      /** Each pretend player's keys, potions and Kowens (by ?as=), refilled on each page load. */
      const mes = new Map<string, { keys: number; kalawang: number; kowens: number; stealAt: number }>();
      const meOf = (who: string) => mes.get(who) ?? mes.set(who, { keys: 3, kalawang: 3, kowens: 50, stealAt: 0 }).get(who)!;
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
          me: { house: mine ? { style: mine.style, colours: mine.colours } : null, kowens: me.kowens, keys: me.keys, kalawang: me.kalawang, stealAt: me.stealAt > Date.now() ? me.stealAt : null, jailed: false, repaintCost: 3 },
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
        } else houses.push({ name: who, lot: houses.length, owner: who, title: { name: 'Townfolk', color: '#B794F6' }, style: look.style, colours: look.colours, fenced: false });
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
        return done(true, 'You got away with 4 Kowens!', { stole: 4 });
      });

      // The Slums' map, read again whenever the file changes (a new map from the art folder needs no restart).
      const slumsFile = join(server.config.publicDir, 'assets/maps/slums.json');
      let slumsAt = 0;
      let slums = { size: [0, 0] as [number, number], spawn: [0, 0] as [number, number], blocked: [] as number[][], avoid: [] as [number, number][] };
      const slumsMap = () => {
        const at = statSync(slumsFile).mtimeMs;
        if (at !== slumsAt) {
          slumsAt = at;
          const sj = JSON.parse(readFileSync(slumsFile, 'utf8'));
          slums = { size: sj.size, spawn: sj.spawn, blocked: sj.blocked, avoid: Object.values((sj.gates ?? {}) as Record<string, [number, number][]>).flat() };
        }
        return slums;
      };
      const slumsMobs = new MobRoom(
        JSON.parse(readFileSync(slumsFile, 'utf8')),
        Math.random,
        Object.fromEntries(
          (JSON.parse(readFileSync(join(server.config.publicDir, 'assets/classes/classes.json'), 'utf8')).classes as { id: string; skills: { level: number }[] }[]).map((c) => [c.id, c.skills.map((k) => k.level)]),
        ),
        loadSkillShapes(),
        loadMobKinds(),
        loadGolemArt(),
      );
      const town = attachTown(httpServer as Parameters<typeof attachTown>[0], {
        map: { size: json.size, spawn: json.spawn, blocked: json.blocked, avoid: Object.values((json.gates ?? {}) as Record<string, [number, number][]>).flat() },
        rooms: {
          hood: () => {
            const m = hoodMap(houses.length);
            return { size: m.size, spawn: m.spawn, blocked: m.blocked, avoid: m.exit };
          },
          slums: slumsMap,
        },
        mobs: { slums: slumsMobs },
        shared: true,
        arenaBets,
        authenticate: async (req) => {
          const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
          const name = q.get('dev')?.slice(0, 16);
          if (!name) return null;
          try {
            const kit = (JSON.parse(q.get('kit') ?? 'null') ?? {}) as { cls?: string | null; weapon?: string | null; progress?: SavedProgress };
            kits.set(name, { cls: kit.cls ?? null, weapon: kit.weapon ?? null });
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
        profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#B794F6' }, outfit: looks.get(name) ?? ({} as OutfitData), ...kits.get(name), level: levelOf(name).level }),
        progress: {
          fighter: (name) => {
            const p = levelOf(name);
            return { cls: kits.get(name)?.cls, level: p.level, points: p.points, gear: [kits.get(name)?.weapon] };
          },
          kill: (name, mob) => {
            const r = killXp(stats, kits.get(name)?.cls ?? null, levelOf(name), mob);
            levels.set(name, r.progress);
            server.config.logger.info(`[levels] ${name} +${r.gained} XP → Lv ${r.progress.level} (${r.progress.xp}/${r.progress.next})`, { timestamp: true });
            return r;
          },
        },
        onSay: (_id, nickname, text, megaphone) => server.config.logger.info(`[town chat → Discord] ${megaphone ? '📢 ' : ''}${nickname}: ${text}`, { timestamp: true }),
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
      server.middlewares.use('/__kit', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const name = q.get('as') ?? '';
        const kit = { cls: q.get('cls') || null, weapon: q.get('weapon') || null };
        kits.set(name, kit);
        town.kit(name, kit.cls, kit.weapon);
        res.end(`${name}: ${kit.cls ?? 'no class'}, ${kit.weapon ?? 'no weapon'}\n`);
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
