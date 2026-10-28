import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import type { TownServerMessage } from '@mikazuki/shared';
import { attachTown } from './town.js';

// The town's step budget over its socket (web/town.ts `spend`, STEP_BURST 8 at 6 a second): a turn (`face`) is free, a
// full bucket takes seven steps in a row, a step with an empty bucket is snapped back with reason 'budget', a step two
// tiles away with 'place' (28 Oct 2026: right clicks that went dead when a refused step snapped a walk away).

/** An open 12 x 12 floor (as town-vitals.test.ts's): steps east from the spawn at (1, 1) never meet a wall. */
const N = 12;
const map = { size: [N, N] as [number, number], spawn: [1, 1] as [number, number], blocked: Array.from({ length: N }, () => Array.from({ length: N }, () => 0)) };

async function town(): Promise<{ port: number; close: () => void }> {
  const server = createServer();
  attachTown(server, {
    map,
    authenticate: async (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('as'),
    profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} as never }),
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return { port: (server.address() as AddressInfo).port, close: () => server.close() };
}

/** A player in town: their messages as they come, a `send`, and where the server put them (the spawn, or the last snap:
 *  accepted steps aren't echoed to their sender). */
async function player(port: number, as: string): Promise<{ ws: WebSocket; got: TownServerMessage[]; send: (m: object) => void; at: () => [number, number]; close: () => void }> {
  const got: TownServerMessage[] = [];
  let me: { col: number; row: number } = { col: 0, row: 0 };
  const ws = await new Promise<WebSocket>((ok, no) => {
    const w = new WebSocket(`ws://127.0.0.1:${port}/ws?as=${as}&room=town`);
    w.on('message', (d) => {
      const m = JSON.parse(String(d)) as TownServerMessage;
      got.push(m);
      if (m.t === 'welcome') {
        me = { col: m.spawn[0], row: m.spawn[1] };
        ok(w);
      }
      if (m.t === 'snap') me = { col: m.col, row: m.row };
    });
    w.on('error', no);
  });
  return { ws, got, send: (m) => ws.send(JSON.stringify(m)), at: () => [me.col, me.row], close: () => ws.close() };
}

const tick = (ms = 60) => new Promise((ok) => setTimeout(ok, ms));
const open = (col: number, row: number) => col >= 0 && row >= 0 && col < N && row < N && !map.blocked[row][col];

/** A walk of `n` steps from where they are, along the first open straight line (east, west, south or north), as the
 *  page sends them: the tiles stepped to. */
function line(from: [number, number], n: number): [number, number][] {
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const tiles: [number, number][] = [];
    for (let k = 1; k <= n; k++) {
      const t: [number, number] = [from[0] + dc * k, from[1] + dr * k];
      if (!open(...t)) break;
      tiles.push(t);
    }
    if (tiles.length === n) return tiles;
  }
  throw new Error(`no ${n} open tiles in a line from ${from}`);
}

test("a turn (face) spends no step; seven steps in a row pass on a full bucket (the burst is 8); the next with it empty is snapped with reason 'budget'", async () => {
  const T = await town();
  try {
    const a = await player(T.port, 'alice');
    a.send({ t: 'here', col: a.at()[0], row: a.at()[1], dir: 's' });
    await tick();
    // Ten turns: free (they would have emptied the old bucket).
    for (const dir of ['n', 'e', 's', 'w', 'n', 'e', 's', 'w', 'n', 'e']) a.send({ t: 'face', dir });
    await tick();
    assert.ok(!a.got.some((m) => m.t === 'snap'), 'no snap from turns');
    // Seven steps in a row, as fast as a page could send them: all taken (the eighth token is the drift's headroom).
    const walk = line(a.at(), 7);
    for (const [col, row] of walk) a.send({ t: 'step', col, row });
    await tick(120);
    assert.ok(!a.got.some((m) => m.t === 'snap'), `seven steps pass: ${JSON.stringify(a.got.filter((m) => m.t === 'snap'))}`);
    // The bucket run dry (the eighth and ninth steps in the same instant): snapped back with 'budget', where they were.
    const more = line(walk[6], 2);
    a.send({ t: 'step', col: more[0][0], row: more[0][1] });
    a.send({ t: 'step', col: more[1][0], row: more[1][1] });
    await tick(120);
    const snaps = a.got.filter((m): m is Extract<TownServerMessage, { t: 'snap' }> => m.t === 'snap');
    assert.ok(snaps.length >= 1 && snaps.every((s) => s.reason === 'budget'), JSON.stringify(snaps));
    a.close();
  } finally {
    T.close();
  }
});

test("a step two tiles away is snapped with reason 'place'; a turn that isn't a direction is dropped quietly", async () => {
  const T = await town();
  try {
    const a = await player(T.port, 'bob');
    a.send({ t: 'here', col: a.at()[0], row: a.at()[1], dir: 's' });
    await tick();
    const [c, r] = a.at();
    const far = line([c, r], 2)[1];
    a.send({ t: 'step', col: far[0], row: far[1] });
    await tick(120);
    const snap = a.got.find((m): m is Extract<TownServerMessage, { t: 'snap' }> => m.t === 'snap');
    assert.ok(snap && snap.reason === 'place' && snap.col === c && snap.row === r, JSON.stringify(snap));
    a.send({ t: 'face', dir: 'up' });
    await tick();
    assert.equal(a.got.filter((m) => m.t === 'snap').length, 1);
    a.close();
  } finally {
    T.close();
  }
});
