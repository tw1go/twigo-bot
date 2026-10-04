import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OutfitData } from '@mikazuki/shared';
import type { Plugin } from 'vite';
import { attachTown } from '../../bot/src/web/town.ts';

// Dev only: the town's live server (/ws) inside the game's dev server, so chat and other players can be tried
// without the bot. It is the bot's own web/town.ts with a fake login: the game's fake member (?as=Name) says who
// they are and what they look like in the address. Open two windows (?as=Alice, ?as=Bob) to be two people.
//   GET /__discord?name=Kuya%20Ben&text=hi   a message as if from the town's Discord channel
//   GET /__system?kind=dig&tone=rare&text=…   a system feed line (kind dig|gamble|jackpot; tone: rarity, win, lose, bust, jackpot)
//   GET /__announce?kind=jackpot|notice&title=…&text=…   a banner at the top
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
      const town = attachTown(httpServer as Parameters<typeof attachTown>[0], {
        map: { size: json.size, spawn: json.spawn, blocked: json.blocked },
        shared: true,
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
        onSay: (_id, nickname, text) => server.config.logger.info(`[town chat → Discord] ${nickname}: ${text}`, { timestamp: true }),
      });
      server.middlewares.use('/__announce', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        town.announce({ kind: q.get('kind') === 'jackpot' ? 'jackpot' : 'notice', title: q.get('title') ?? 'Notice', text: q.get('text') ?? '' });
        res.end('announced in town\n');
      });
      server.middlewares.use('/__system', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const kind = q.get('kind');
        town.system({ kind: kind === 'gamble' || kind === 'jackpot' ? kind : 'dig', text: q.get('text') ?? '', tone: q.get('tone') ?? 'common' });
        res.end('sent to the system feed\n');
      });
      server.middlewares.use('/__discord', (req, res) => {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
        town.fromDiscord(q.get('name') ?? 'Someone', q.get('text') ?? '');
        res.end('sent to the town chat\n');
      });
    },
  };
}
