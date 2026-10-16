import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { FRIEND_RULES, type TownServerMessage } from '@mikazuki/shared';
import { type FriendData, Friends } from './town-friends.js';
import { attachTown } from './town.js';

// Blocks (CONTEXT.md Block): the rules (blocking ends a friendship and any request either way, asking either way is
// refused, unblocking, the limit, what's saved), and over the town's socket: a blocked player's friend request, whisper,
// party invite and trade request all turned away with answers that never say "blocked"; their General chat still
// reaches you; Game Masters can't be blocked; the Blocked list and Unblock.

const empty = (): FriendData => ({ friends: [], requests: [], seen: [], blocks: [] });

test('blocking: the friendship and requests either way go; asking is refused both ways; unblocking; the limit; saved', () => {
  const log: string[] = [];
  const F = new Friends({ ...empty(), friends: [['bob', 'mara', 0]], requests: [{ from: 'cleo', to: 'mara', at: 0 }] }, {
    friend: (a, b, since) => log.push(`friend ${a} ${b} ${since === null ? 'gone' : 'on'}`),
    request: (f, t, at) => log.push(`request ${f} ${t} ${at === null ? 'gone' : 'on'}`),
    seen: () => {},
    block: (by, who, at) => log.push(`block ${by} ${who} ${at === null ? 'gone' : 'on'}`),
  });
  assert.deepEqual(F.block('mara', 'bob', 10), { ok: true });
  assert.ok(!F.areFriends('mara', 'bob'), 'no longer friends');
  assert.deepEqual(F.block('mara', 'cleo', 11), { ok: true });
  assert.deepEqual(F.incoming('mara', 12), [], "Cleo's request gone");
  assert.deepEqual(F.blockedBy('mara'), [{ who: 'bob', at: 10 }, { who: 'cleo', at: 11 }]);
  assert.deepEqual(F.ask('bob', 'mara', 20), { ok: false, reason: 'closed' }, 'the blocked one: turned away');
  assert.deepEqual(F.ask('mara', 'bob', 20), { ok: false, reason: 'blocked' }, 'the one who blocked: unblock first');
  assert.deepEqual(F.block('mara', 'bob', 21), { ok: false, reason: 'blocked' });
  assert.deepEqual(F.block('mara', 'mara', 21), { ok: false, reason: 'self' });
  assert.ok(F.hasBlocked('mara', 'bob') && !F.hasBlocked('bob', 'mara'), 'one way');
  assert.deepEqual(F.unblock('mara', 'bob'), { ok: true });
  assert.deepEqual(F.unblock('mara', 'bob'), { ok: false, reason: 'gone' });
  assert.deepEqual(F.ask('bob', 'mara', 30), { ok: true, friends: false });
  assert.deepEqual(log, ['friend bob mara gone', 'block mara bob on', 'request cleo mara gone', 'block mara cleo on', 'block mara bob gone', 'request bob mara on']);
  // At most FRIEND_RULES.blocks each.
  const G = new Friends({ ...empty(), blocks: Array.from({ length: FRIEND_RULES.blocks }, (_, i) => ({ by: 'x', who: `p${i}`, at: 0 })) }, { friend() {}, request() {}, seen() {}, block() {} });
  assert.deepEqual(G.block('x', 'one-more', 1), { ok: false, reason: 'blocks' });
});

type Msg = TownServerMessage;
const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function town() {
  const server = createServer();
  const names = ['Mara', 'Bob', 'Gemma'];
  const blocks: string[] = [];
  attachTown(server, {
    map: { size: [8, 8], spawn: [3, 3], blocked: Array.from({ length: 8 }, () => Array(8).fill(0)) },
    authenticate: async (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('as'),
    profile: (name) => (names.includes(name) ? { nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} as never } : null),
    gm: (name) => name === 'Gemma',
    friends: {
      store: { load: () => ({ ...empty(), friends: [['Bob', 'Mara', 0]] }), friend: () => {}, request: () => {}, seen: () => {}, block: (by, who, at) => blocks.push(`${by} ${who} ${at === null ? 'gone' : 'on'}`) },
      byName: (n) => names.find((x) => x.toLowerCase() === n.toLowerCase()) ?? null,
    },
    items: { take: () => true, usePotion: () => null, state: () => ({ equipped: {}, cosmetics: {}, bag: [], kusing: 0 }), trade: () => ({ ok: true }) as never },
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  const open = (as: string) =>
    new Promise<{ ws: WebSocket; got: Msg[]; send: (m: object) => void; id: () => string }>((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?as=${as}`);
      const got: Msg[] = [];
      ws.on('message', (d) => got.push(JSON.parse(String(d))));
      const c = { ws, got, send: (m: object) => ws.send(JSON.stringify(m)), id: () => (got.find((m) => m.t === 'welcome') as Extract<Msg, { t: 'welcome' }>).you };
      ws.on('open', () => ok(c));
    });
  return { open, blocks, close: () => new Promise((ok) => server.close(ok)) };
}

async function until<M extends Msg>(c: { got: Msg[] }, ok: (m: Msg) => m is M): Promise<M> {
  for (let k = 0; k < 80 && !c.got.some(ok); k++) await wait(25);
  const m = c.got.find(ok);
  assert.ok(m, 'heard it');
  return m;
}
const is = <T extends Msg['t']>(t: T, also: (m: Extract<Msg, { t: T }>) => boolean = () => true) => (m: Msg): m is Extract<Msg, { t: T }> => m.t === t && also(m as Extract<Msg, { t: T }>);

test("over the town's socket: blocked, every ask turned away without saying so; their chat still shows; Game Masters can't be blocked; unblocking", async () => {
  const T = await town();
  const [mara, bob, gemma] = await Promise.all(['Mara', 'Bob', 'Gemma'].map(T.open));
  await wait(100);
  for (const c of [mara, bob]) c.send({ t: 'here', col: 3, row: 3, dir: 's' });
  mara.send({ t: 'block', to: bob.id() });
  const mine = await until(mara, is('friends', (m) => m.note === 'You blocked Bob.'));
  assert.deepEqual([mine.friends.friends, mine.friends.blocked.map((b) => b.name)], [[], ['Bob']], 'no longer friends; on the Blocked list');
  await until(bob, is('friends', (m) => m.friends.friends.length === 0));
  assert.ok(!bob.got.some((m) => m.t === 'friends' && !!m.note), 'Bob is told nothing');
  assert.deepEqual(T.blocks, ['Mara Bob on']);

  // Bob's asks: each turned away as if simply refused.
  bob.send({ t: 'whisper', to: 'Mara', text: 'hey' });
  assert.deepEqual(await until(bob, is('whisper-refused')), { t: 'whisper-refused', reason: 'closed', name: 'Mara' });
  bob.send({ t: 'friend-ask', to: mara.id() });
  assert.deepEqual(await until(bob, is('friend-refused')), { t: 'friend-refused', reason: 'closed', name: 'Mara' });
  bob.send({ t: 'party-invite', to: mara.id() });
  assert.deepEqual(await until(bob, is('party-refused')), { t: 'party-refused', reason: 'closed', name: 'Mara' });
  await wait(1050);
  bob.send({ t: 'trade-ask', to: mara.id() });
  assert.deepEqual(await until(bob, is('trade-refused')), { t: 'trade-refused', reason: 'closed', name: 'Mara' });
  assert.ok(!mara.got.some((m) => m.t === 'whisper' || m.t === 'party-invited' || m.t === 'trade-asked' || (m.t === 'friends' && !!m.asked)), 'nothing reached Mara');
  // General chat still does.
  bob.send({ t: 'say', text: 'hello all' });
  assert.equal((await until(mara, is('say'))).text, 'hello all');

  // A Game Master can't be blocked; unblocking.
  await wait(1050);
  mara.send({ t: 'block', name: 'gemma' });
  assert.deepEqual(await until(mara, is('friend-refused')), { t: 'friend-refused', reason: 'gm', name: 'Gemma' });
  await wait(1050);
  mara.send({ t: 'unblock', key: mine.friends.blocked[0].key });
  const after = await until(mara, is('friends', (m) => m.note === 'You unblocked Bob.'));
  assert.deepEqual(after.friends.blocked, []);
  mara.got.length = 0;
  bob.send({ t: 'whisper', to: 'Mara', text: 'better?' });
  assert.equal((await until(mara, is('whisper'))).text, 'better?');
  for (const c of [mara, bob, gemma]) c.ws.close();
  await T.close();
});
