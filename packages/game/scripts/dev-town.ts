import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OutfitData } from '@mikazuki/shared';
import type { Plugin } from 'vite';
import { attachTown } from '../../bot/src/web/town.ts';
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
//   GET /__flex?as=Bob&itemId=rock&itemName=Rock&rarity=junk   Bob flexes an item (chat line + bubble)
//   GET /__gift?as=Alice&amount=50   Alice gets the gift pop-up (as from /gift kowens); &wallet=1: only her HUD's Kowens reload
//   GET /__gift?as=Alice&item=megaphone&name=Megaphone&qty=3   Alice gets the item gift pop-up (as from /gift item)
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
      const town = attachTown(httpServer as Parameters<typeof attachTown>[0], {
        map: { size: json.size, spawn: json.spawn, blocked: json.blocked },
        shared: true,
        arenaBets,
        authenticate: async (req) => {
          const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
          const name = q.get('dev')?.slice(0, 16);
          if (!name) return null;
          try {
            looks.set(name, JSON.parse(q.get('look') ?? 'null'));
          } catch {
            // no look: the game shows a random one
          }
          return name;
        },
        profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#B794F6' }, outfit: looks.get(name) ?? ({} as OutfitData) }),
        onSay: (_id, nickname, text, megaphone) => server.config.logger.info(`[town chat → Discord] ${megaphone ? '📢 ' : ''}${nickname}: ${text}`, { timestamp: true }),
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
