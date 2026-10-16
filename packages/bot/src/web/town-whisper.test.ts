import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { DEFAULT_PRIVACY, type PrivacySettings, type TownServerMessage } from '@mikazuki/shared';
import { attachTown } from './town.js';

// Whispers over the town's socket (CONTEXT.md Whisper, Friends-only whispers): to one player who's online, any case;
// the sender's copy back; never to anyone else, Discord or the kept lines; to yourself, someone offline or someone
// taking whispers from friends only (unless you're friends, or a Game Master) refused; a muted player can't; the
// setting kept and sent on arrival.

type Msg = TownServerMessage;
const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function town() {
  const server = createServer();
  const said: string[] = [];
  const kept: string[] = [];
  const privacy = new Map<string, PrivacySettings>();
  attachTown(server, {
    map: { size: [4, 4], spawn: [1, 1], blocked: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
    authenticate: async (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('as'),
    profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} as never }),
    onSay: (_u, _n, text) => said.push(text),
    memory: { chat: [], system: [], save: (chat) => kept.push(...chat.map((l) => l.text)) },
    gm: (name) => name === 'Gemma',
    moderation: { mutedUntil: (name) => (name === 'Muted' ? Date.now() + 60_000 : null), kickedUntil: () => null, filter: (t) => t.replace(/darn/g, '****') },
    friends: {
      store: { load: () => ({ friends: [['Cleo', 'Mara', 0]], requests: [], seen: [], blocks: [] }), friend: () => {}, request: () => {}, seen: () => {}, block: () => {} },
      byName: () => null,
    },
    privacy: {
      get: (name) => privacy.get(name) ?? DEFAULT_PRIVACY,
      set: (name, change) => {
        const next = { ...(privacy.get(name) ?? DEFAULT_PRIVACY), ...change };
        privacy.set(name, next);
        return next;
      },
    },
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
  return { open, said, kept, privacy, close: () => new Promise((ok) => server.close(ok)) };
}

/** Waits until `c` has heard a message matching `ok` (at most 2 s) and gives it. */
async function until<M extends Msg>(c: { got: Msg[] }, ok: (m: Msg) => m is M): Promise<M> {
  for (let k = 0; k < 80 && !c.got.some(ok); k++) await wait(25);
  const m = c.got.find(ok);
  assert.ok(m, 'heard it');
  return m;
}
const whisper = (m: Msg): m is Extract<Msg, { t: 'whisper' }> => m.t === 'whisper';
const refused = (m: Msg): m is Extract<Msg, { t: 'whisper-refused' }> => m.t === 'whisper-refused';

test("whispers: to one player only, the sender's copy, never to Discord or the kept lines; refusals; friends-only; Game Masters; mutes", async () => {
  const T = await town();
  const [mara, bob, cleo, gemma, muted] = await Promise.all(['Mara', 'Bob', 'Cleo', 'Gemma', 'Muted'].map(T.open));
  await wait(100);
  assert.deepEqual((await until(bob, (m): m is Extract<Msg, { t: 'privacy' }> => m.t === 'privacy')).privacy, DEFAULT_PRIVACY, 'the setting on arrival');

  mara.send({ t: 'whisper', to: 'bOB', text: 'meet me at the  fountain, darn it' });
  const got = await until(bob, whisper);
  assert.deepEqual(got, { t: 'whisper', id: mara.id(), name: 'Mara', text: 'meet me at the fountain, **** it' }, 'tidied and filtered, from Mara');
  const copy = await until(mara, whisper);
  assert.deepEqual(copy, { t: 'whisper', id: bob.id(), name: 'Bob', text: 'meet me at the fountain, **** it', sent: true });
  await wait(100);
  for (const c of [cleo, gemma, muted]) assert.ok(!c.got.some(whisper), 'nobody else hears it');
  assert.deepEqual([T.said, T.kept], [[], []], 'not to Discord, not kept');

  // To yourself, to someone who isn't online.
  mara.got.length = 0;
  mara.send({ t: 'whisper', to: 'Mara', text: 'hi me' });
  assert.deepEqual(await until(mara, refused), { t: 'whisper-refused', reason: 'self', name: 'Mara' });
  mara.got.length = 0;
  mara.send({ t: 'whisper', to: 'Nobody', text: 'hello?' });
  assert.deepEqual(await until(mara, refused), { t: 'whisper-refused', reason: 'offline', name: 'Nobody' });

  // Friends only: Bob's refused, Cleo (Mara's friend) and a Game Master still get through.
  mara.send({ t: 'privacy', whispers: 'friends' });
  assert.deepEqual((await until(mara, (m): m is Extract<Msg, { t: 'privacy' }> => m.t === 'privacy' && m.privacy.whispers === 'friends')).privacy, { whispers: 'friends' });
  assert.deepEqual(T.privacy.get('Mara'), { whispers: 'friends' }, 'kept');
  bob.got.length = 0;
  bob.send({ t: 'whisper', to: 'Mara', text: 'you there?' });
  assert.deepEqual(await until(bob, refused), { t: 'whisper-refused', reason: 'closed', name: 'Mara' });
  mara.got.length = 0;
  cleo.send({ t: 'whisper', to: 'Mara', text: 'friend here' });
  assert.equal((await until(mara, whisper)).name, 'Cleo');
  mara.got.length = 0;
  gemma.send({ t: 'whisper', to: 'Mara', text: 'staff here' });
  const fromGm = await until(mara, whisper);
  assert.deepEqual([fromGm.name, fromGm.gm], ['Gemma', true]);
  // Muted: like chat.
  muted.send({ t: 'whisper', to: 'Bob', text: 'psst' });
  assert.equal((await until(muted, (m): m is Extract<Msg, { t: 'say-refused' }> => m.t === 'say-refused')).reason, 'muted');
  for (const c of [mara, bob, cleo, gemma, muted]) c.ws.close();
  await T.close();
});
