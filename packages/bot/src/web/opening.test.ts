import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { type TownServerMessage, lanternPostOf, mapOpensAt, opensLine } from '@mikazuki/shared';
import { attachTown, loadTownMap } from './town.js';

// A map's opening time (CONTEXT.md Opening time; shared travel.ts mapOpensAt, the bot's web/town.ts): before it nobody but
// Game Masters comes in, by a link or a Lantern Post, and each welcome says what's still closed.

const palengke = JSON.parse(readFileSync(new URL('../../../game/public/assets/maps/palengke.json', import.meta.url), 'utf8')) as { opensAt?: string };

test('mapOpensAt: its ISO time while it is still ahead, else null; the line says it in Philippine time', () => {
  const at = Date.parse('2026-10-26T09:00:00+08:00');
  assert.equal(mapOpensAt({ opensAt: '2026-10-26T09:00:00+08:00' }, at - 1), at);
  assert.equal(mapOpensAt({ opensAt: '2026-10-26T09:00:00+08:00' }, at), null);
  assert.equal(mapOpensAt({}, 0), null);
  assert.equal(mapOpensAt({ opensAt: 'soon' }, 0), null);
  assert.equal(opensLine('The Old Market', at), 'The Old Market opens Oct 26 at 9:00 AM (Philippine time).');
  assert.equal(palengke.opensAt && Number.isFinite(Date.parse(palengke.opensAt)), true, "the Old Market's map has its opening time");
  assert.equal(loadTownMap('palengke').opensAt, palengke.opensAt);
});

test('before its opening: a link is sent back, a teleport refused, Game Masters let in; after it, everyone', async () => {
  let opensAt = new Date(Date.now() + 60_000).toISOString();
  const server = createServer();
  attachTown(server, {
    map: loadTownMap(),
    rooms: { slums: () => loadTownMap('slums'), palengke: () => loadTownMap('palengke') },
    opening: { get palengke() { return { name: 'The Old Market', opensAt }; } },
    gm: (u) => u === 'gm',
    lanterns: { count: () => 5, use: () => true },
    authenticate: async (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('as'),
    profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} as never }),
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  const open = (as: string, room = 'town') =>
    new Promise<{ ws: WebSocket; got: TownServerMessage[]; closed: number | null }>((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?as=${as}&room=${room}`);
      const c = { ws, got: [] as TownServerMessage[], closed: null as number | null };
      ws.on('message', (d) => {
        const m = JSON.parse(String(d)) as TownServerMessage;
        c.got.push(m);
        if (m.t === 'welcome') ok(c);
      });
      ws.on('close', (code) => ok(Object.assign(c, { closed: code })));
    });
  const wait = (ms = 120) => new Promise((ok) => setTimeout(ok, ms));
  const find = (c: { got: TownServerMessage[] }, t: string) => c.got.find((m) => m.t === t);
  try {
    // A link straight into the Old Market: told when it opens, closed.
    const alice = await open('alice', 'palengke');
    assert.equal(alice.closed, 4002);
    const told = find(alice, 'area-closed') as Extract<TownServerMessage, { t: 'area-closed' }>;
    assert.equal(told.area, 'palengke');
    assert.equal(told.opensAt, Date.parse(opensAt));
    assert.match(told.message, /^The Old Market opens /);
    assert.equal(find(alice, 'welcome'), undefined);

    // In the Slums: the welcome lists it; a teleport there is refused with the same line.
    const bob = await open('bob', 'slums');
    assert.deepEqual((find(bob, 'welcome') as { closed?: Record<string, number> }).closed, { palengke: Date.parse(opensAt) });
    const post = lanternPostOf(JSON.parse(readFileSync(new URL('../../../game/public/assets/maps/slums.json', import.meta.url), 'utf8')))!;
    bob.ws.send(JSON.stringify({ t: 'here', col: post.arrive[0], row: post.arrive[1], dir: 's' }));
    await wait();
    bob.ws.send(JSON.stringify({ t: 'lantern', to: 'palengke' }));
    await wait();
    assert.match((bob.got.find((m) => m.t === 'lantern-refused') as { message: string }).message, /^The Old Market opens /);
    assert.equal(bob.got.some((m) => m.t === 'lantern-go'), false);

    // A Game Master goes in, and their welcome lists nothing closed.
    const gm = await open('gm', 'palengke');
    assert.equal(gm.closed, null);
    assert.equal((find(gm, 'welcome') as { closed?: unknown }).closed, undefined);

    // The time comes: everyone, no restart.
    opensAt = new Date(Date.now() - 1000).toISOString();
    const carol = await open('carol', 'palengke');
    assert.equal(carol.closed, null);
    assert.equal((find(carol, 'welcome') as { closed?: unknown }).closed, undefined);
    for (const c of [bob, gm, carol]) c.ws.close();
  } finally {
    server.close();
  }
});
