import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import type { TownServerMessage } from '@mikazuki/shared';
import { attachTown } from './town.js';

// The chat is one for every map: a line carries its speaker's class (their badge before the name), since someone on
// another map isn't among the players a page sees; remembered lines keep it for those who come in later.

test("over the town's socket: a line from another map comes with its speaker's class, and so does the remembered line", async () => {
  const map = { size: [12, 12] as [number, number], spawn: [2, 2] as [number, number], blocked: Array.from({ length: 12 }, () => Array(12).fill(0)) };
  const cls: Record<string, string | null> = { Ana: 'stick', Ben: 'hilot', Cy: null };
  const server = createServer();
  attachTown(server, {
    map,
    rooms: { slums: () => map },
    authenticate: async (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('as'),
    profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} as never, cls: cls[name] ?? null }),
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  const open = (as: string, room: string) =>
    new Promise<{ ws: WebSocket; got: TownServerMessage[] }>((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?as=${as}&room=${room}`);
      const got: TownServerMessage[] = [];
      ws.on('message', (d) => got.push(JSON.parse(String(d))));
      ws.on('open', () => ok({ ws, got }));
    });
  const wait = (ms = 150) => new Promise((ok) => setTimeout(ok, ms));
  const ana = await open('Ana', 'town');
  const ben = await open('Ben', 'slums');
  await wait();
  ben.ws.send(JSON.stringify({ t: 'say', text: 'hello from the Slums' }));
  await wait();
  const said = ana.got.find((m) => m.t === 'say');
  assert.ok(said && said.t === 'say' && said.name === 'Ben' && said.cls === 'hilot', JSON.stringify(said));
  // No class, no cls.
  const cy = await open('Cy', 'town');
  await wait();
  cy.ws.send(JSON.stringify({ t: 'say', text: 'hi' }));
  await wait();
  const plain = ana.got.filter((m) => m.t === 'say').at(-1);
  assert.ok(plain && plain.t === 'say' && plain.name === 'Cy' && !('cls' in plain));
  // Someone coming in later: the remembered line keeps it.
  const dee = await open('Dee', 'town');
  await wait();
  const welcome = dee.got.find((m) => m.t === 'welcome');
  assert.ok(welcome && welcome.t === 'welcome');
  assert.deepEqual(welcome.recent.map((l) => [l.name, l.cls ?? null]), [['Ben', 'hilot'], ['Cy', null]]);
  for (const c of [ana, ben, cy, dee]) c.ws.close();
  await new Promise((ok) => server.close(ok));
});
