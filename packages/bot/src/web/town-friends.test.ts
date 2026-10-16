import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { FRIEND_RULES, type TownServerMessage, lastOnline } from '@mikazuki/shared';
import { type FriendData, type FriendSaves, Friends } from './town-friends.js';
import { attachTown } from './town.js';

// Friends (CONTEXT.md Friend, Friend request): the rules (Friends: asking, answering, both asking, taking back,
// removing, the limits, lapsing, what's saved), and over the town's socket: a request to someone here, accepted, each
// seeing the other online and where; a request by nickname to someone offline, waiting for them; a friend's arrival
// announced.

const DAY = 86_400_000;
const empty = (): FriendData => ({ friends: [], requests: [], seen: [], blocks: [] });

/** Friends whose saves are written down, to check what's kept. */
function friends(data = empty()) {
  const log: string[] = [];
  const saves: FriendSaves = {
    friend: (a, b, since) => log.push(`friend ${a} ${b} ${since === null ? 'gone' : 'on'}`),
    request: (from, to, at) => log.push(`request ${from} ${to} ${at === null ? 'gone' : 'on'}`),
    seen: (user) => log.push(`seen ${user}`),
    block: (by, who, at) => log.push(`block ${by} ${who} ${at === null ? 'gone' : 'on'}`),
  };
  return { F: new Friends(data, saves), log };
}

test('asking and accepting: friends both ways, the request gone, each change saved', () => {
  const { F, log } = friends();
  assert.deepEqual(F.ask('mara', 'bob', 1000), { ok: true, friends: false });
  assert.deepEqual(F.outgoing('mara', 2000), [{ to: 'bob', at: 1000 }]);
  assert.deepEqual(F.incoming('bob', 2000), [{ from: 'mara', at: 1000 }]);
  assert.deepEqual(F.ask('mara', 'bob', 1500), { ok: false, reason: 'asked' });
  assert.deepEqual(F.answer('bob', 'mara', true, 3000), { ok: true, friends: true });
  assert.ok(F.areFriends('mara', 'bob') && F.areFriends('bob', 'mara'));
  assert.deepEqual(F.incoming('bob', 3000), []);
  assert.deepEqual(F.ask('bob', 'mara', 4000), { ok: false, reason: 'already' });
  assert.deepEqual(F.ask('mara', 'mara', 4000), { ok: false, reason: 'self' });
  assert.deepEqual(log, ['request mara bob on', 'request mara bob gone', 'friend bob mara on'], 'the pair saved smaller id first');
});

test('declining, taking back, two asking each other, removing', () => {
  const { F } = friends();
  F.ask('mara', 'bob', 0);
  assert.deepEqual(F.answer('bob', 'mara', false, 10), { ok: true, friends: false });
  assert.ok(!F.areFriends('mara', 'bob'));
  assert.deepEqual(F.answer('bob', 'mara', true, 20), { ok: false, reason: 'expired' }, 'declined: gone');
  F.ask('mara', 'cleo', 0);
  assert.deepEqual(F.cancel('mara', 'cleo', 10), { ok: true });
  assert.deepEqual(F.incoming('cleo', 10), []);
  // Both asking: friends at once, no request left either way.
  F.ask('dan', 'eve', 0);
  assert.deepEqual(F.ask('eve', 'dan', 5), { ok: true, friends: true });
  assert.deepEqual([F.outgoing('dan', 5), F.outgoing('eve', 5)], [[], []]);
  assert.deepEqual(F.remove('eve', 'dan'), { ok: true });
  assert.ok(!F.areFriends('dan', 'eve') && !F.areFriends('eve', 'dan'), 'gone for both');
  assert.deepEqual(F.remove('eve', 'dan'), { ok: false, reason: 'gone' });
});

test('limits: friends each, requests out, and a request lapses after its days', () => {
  const data = empty();
  for (let i = 0; i < FRIEND_RULES.max; i++) data.friends.push(['full', `f${i}`, 0]);
  const { F } = friends(data);
  assert.deepEqual(F.ask('full', 'new', 0), { ok: false, reason: 'full' });
  assert.deepEqual(F.ask('new', 'full', 0), { ok: false, reason: 'their-full' });
  for (let i = 0; i < FRIEND_RULES.asks; i++) assert.equal(F.ask('keen', `p${i}`, 0).ok, true);
  assert.deepEqual(F.ask('keen', 'one-more', 0), { ok: false, reason: 'asks' });
  // Lapsed: not open (answering it is refused), and pruned away (freeing a request).
  const late = FRIEND_RULES.requestDays * DAY;
  assert.deepEqual(F.incoming('p0', late), []);
  assert.deepEqual(F.answer('p0', 'keen', true, late), { ok: false, reason: 'expired' });
  assert.equal(F.prune(late).length, FRIEND_RULES.asks);
  assert.deepEqual(F.ask('keen', 'one-more', late), { ok: true, friends: false });
});

test('keys: random, the same for a member, and back to them; what was saved comes back', () => {
  const { F } = friends({ friends: [['a', 'b', 5]], requests: [{ from: 'c', to: 'a', at: 7 }], seen: [['b', 9]], blocks: [] });
  const k = F.key('b');
  assert.equal(F.key('b'), k);
  assert.notEqual(F.key('a'), k);
  assert.equal(F.member(k), 'b');
  assert.equal(F.member('nope'), null);
  assert.deepEqual(F.friendsOf('a'), ['b']);
  assert.deepEqual(F.incoming('a', 8), [{ from: 'c', at: 7 }]);
  assert.equal(F.seenAt('b'), 9);
});

test('last online in words: today, yesterday, days ago (by calendar day)', () => {
  const now = new Date(2026, 9, 16, 9).getTime();
  assert.equal(lastOnline(new Date(2026, 9, 16, 1).getTime(), now), 'Today');
  assert.equal(lastOnline(new Date(2026, 9, 15, 23).getTime(), now), 'Yesterday');
  assert.equal(lastOnline(new Date(2026, 9, 13, 12).getTime(), now), '3 days ago');
});

type Msg = TownServerMessage;
const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function town() {
  const server = createServer();
  const saved: string[] = [];
  const names = ['Mara', 'Bob', 'Cleo', 'Dan'];
  attachTown(server, {
    map: { size: [4, 4], spawn: [1, 1], blocked: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
    authenticate: async (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('as'),
    profile: (name) => (names.includes(name) ? { nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} as never, cls: 'broom', level: 7 } : null),
    friends: {
      store: { load: () => ({ ...empty(), friends: [['Dan', 'Mara', 0]] }), friend: (a, b) => saved.push(`friend ${a} ${b}`), request: (f, t, at) => saved.push(`request ${f} ${t} ${at === null ? 'gone' : 'on'}`), seen: () => {}, block: () => {} },
      byName: (n) => names.find((x) => x.toLowerCase() === n.toLowerCase()) ?? null,
    },
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  const open = (as: string) =>
    new Promise<{ ws: WebSocket; got: Msg[]; send: (m: object) => void; id: () => string; last: <K extends Msg['t']>(t: K) => Extract<Msg, { t: K }> | undefined }>((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?as=${as}`);
      const got: Msg[] = [];
      ws.on('message', (d) => got.push(JSON.parse(String(d))));
      const c = {
        ws, got, send: (m: object) => ws.send(JSON.stringify(m)),
        id: () => (got.find((m) => m.t === 'welcome') as Extract<Msg, { t: 'welcome' }>).you,
        last: <K extends Msg['t']>(t: K) => got.filter((m): m is Extract<Msg, { t: K }> => m.t === t).at(-1),
      };
      ws.on('open', () => ok(c));
    });
  return { open, saved, close: () => new Promise((ok) => server.close(ok)) };
}

/** Waits until `c` has heard a message matching `ok` (at most 2 s). */
async function until(c: { got: Msg[] }, ok: (m: Msg) => boolean) {
  for (let k = 0; k < 80 && !c.got.some(ok); k++) await wait(25);
  const m = c.got.find(ok);
  assert.ok(m, 'heard it');
  return m;
}

test("over the town's socket: asked, accepted, online with where they are; by nickname to someone offline; an arrival announced", async () => {
  const T = await town();
  const mara = await T.open('Mara');
  const bob = await T.open('Bob');
  await until(mara, (m) => m.t === 'friends');
  const first = mara.last('friends')!.friends;
  assert.deepEqual([first.friends.map((f) => [f.name, f.online, f.id]), first.incoming, first.outgoing], [[['Dan', false, undefined]], [], []], 'their list on arrival: Dan, saved before, offline');
  // Dan arrives (not back from a reload): announced to Mara.
  const dan = await T.open('Dan');
  assert.equal(((await until(mara, (m) => m.t === 'friends' && !!m.online)) as Extract<Msg, { t: 'friends' }>).online, 'Dan');
  mara.send({ t: 'friend-ask', to: bob.id() });
  const asked = (await until(bob, (m) => m.t === 'friends' && !!m.asked)) as Extract<Msg, { t: 'friends' }>;
  assert.equal(asked.asked?.name, 'Mara');
  assert.equal(asked.friends.incoming[0]?.key, asked.asked?.key);
  assert.equal(mara.last('friends')?.note, 'Friend request sent to Bob.');
  bob.send({ t: 'friend-answer', key: asked.asked!.key, accept: true });
  const made = (await until(mara, (m) => m.t === 'friends' && m.note === 'You and Bob are friends now.')) as Extract<Msg, { t: 'friends' }>;
  const seen = made.friends.friends.find((f) => f.name === 'Bob')!;
  assert.deepEqual([seen.name, seen.online, seen.id, seen.area, seen.cls, seen.level], ['Bob', true, bob.id(), 'town', 'broom', 7]);
  assert.ok(!('lastSeen' in seen));
  // By nickname, any case: Cleo isn't here; it waits for her.
  mara.got.length = 0;
  await wait(1050); // (one a second)
  mara.send({ t: 'friend-ask', name: 'cLEO' });
  await until(mara, (m) => m.t === 'friends' && m.note === 'Friend request sent to Cleo.');
  assert.equal(mara.last('friends')?.friends.outgoing[0]?.name, 'Cleo');
  await wait(1050);
  mara.send({ t: 'friend-ask', name: 'Nobody' });
  assert.deepEqual(await until(mara, (m) => m.t === 'friend-refused'), { t: 'friend-refused', reason: 'gone', name: 'Nobody' });
  // Cleo arrives: her request waiting; she accepts, then comes back later and is announced.
  const cleo = await T.open('Cleo');
  const hers = (await until(cleo, (m) => m.t === 'friends')) as Extract<Msg, { t: 'friends' }>;
  assert.equal(hers.friends.incoming[0]?.name, 'Mara');
  cleo.send({ t: 'friend-answer', key: hers.friends.incoming[0].key, accept: true });
  await until(mara, (m) => m.t === 'friends' && m.note === 'You and Cleo are friends now.');
  assert.ok(!mara.got.some((m) => m.t === 'friends' && m.online), 'nobody else announced');
  // Bob leaves: still online for a moment (a reload), no town id.
  bob.ws.close();
  await until(mara, (m) => m.t === 'friends' && m.friends.friends.some((f) => f.name === 'Bob' && !f.id));
  assert.equal(mara.last('friends')?.friends.friends.find((f) => f.name === 'Bob')?.online, true);
  // Removing: gone for both.
  await wait(1050);
  mara.send({ t: 'friend-remove', key: mara.last('friends')!.friends.friends.find((f) => f.name === 'Cleo')!.key });
  await until(mara, (m) => m.t === 'friends' && m.note === 'Cleo is no longer your friend.');
  await until(cleo, (m) => m.t === 'friends' && m.friends.friends.length === 0);
  assert.deepEqual(T.saved, ['request Mara Bob on', 'request Mara Bob gone', 'friend Bob Mara', 'request Mara Cleo on', 'request Mara Cleo gone', 'friend Cleo Mara', 'friend Cleo Mara']);
  for (const c of [mara, cleo, dan]) c.ws.close();
  await T.close();
});
