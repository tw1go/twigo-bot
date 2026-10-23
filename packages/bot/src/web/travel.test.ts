import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { type CombatItemDef, LANTERN_USE_TILES, LANTERN_WALK_TILES, RETURN_LANTERN, type TownServerMessage, blockedWithPosts, lanternPostOf, lanternPostsOf, lanternRefusal, nearPost, postAt, stackLimit } from '@mikazuki/shared';
import { combatWares } from './combat-bag.js';
import { loadItemData, loadStats } from './stats-data.js';
import { Vitals } from './town-vitals.js';
import { attachTown, loadTownMap } from './town.js';

// Lantern Posts (shared travel.ts, town.ts): where the posts stand on the real maps, the Map menu's picture agreeing,
// the Return Lantern on sale, what stops a teleport, and a teleport over the town's WebSocket (a lantern used, the light
// seen as they go and as they arrive).

const asset = (path: string) => JSON.parse(readFileSync(new URL(`../../../game/public/assets/${path}`, import.meta.url), 'utf8'));
const town = asset('maps/town.json');
const slums = asset('maps/slums.json');
const palengke = asset('maps/palengke.json');

test('each map has one Lantern Post: blocked, with a walkable landing beside it, and the Map menu puts its icon there', () => {
  const layout = asset('ui/map/map-layout.json') as { posts: Record<string, { tile: [number, number] }> };
  for (const [name, map] of [['town', town], ['slums', slums]] as const) {
    assert.equal(map.objects.filter((o: { id: string }) => o.id === 'lantern-post').length, 1, name);
    const post = lanternPostOf(map)!;
    assert.ok(post, name);
    assert.equal(map.blocked[post.tile[1]][post.tile[0]], 1, `${name}: the post's tile is blocked`);
    assert.equal(map.blocked[post.arrive[1]][post.arrive[0]], 0, `${name}: its landing is walkable`);
    assert.ok(nearPost(post, post.arrive[0], post.arrive[1], LANTERN_WALK_TILES), `${name}: its landing is near enough to use it`);
    assert.deepEqual(layout.posts[name].tile, post.tile, `${name}: map-layout.json's post`);
  }
  // The Slums' post: plain ground (level 1), in no mob zone.
  const [c, r] = lanternPostOf(slums)!.tile;
  assert.equal(slums.height[r][c], 1);
  for (const z of slums.mobZones as { rect: [number, number, number, number] }[]) assert.ok(c < z.rect[0] || c > z.rect[2] || r < z.rect[1] || r > z.rect[3]);
});

test('the Old Market has four Lantern Posts: each blocked, a walkable landing in front, its own; the Map menu has them all', () => {
  const layout = asset('ui/map/map-layout.json') as { posts: Record<string, { tile: [number, number] }[] | { tile: [number, number] }> };
  const blocked = blockedWithPosts(palengke.blocked, palengke.teleporters);
  const all = lanternPostsOf({ ...palengke, blocked });
  const posts = all.filter((p) => !p.entrance);
  assert.equal(posts.length, 4);
  assert.deepEqual(all.slice(4).map((p) => p.entrance), ['silong'], 'then its dungeon entrance, the Cellar Hatch');
  assert.deepEqual(posts.map((p) => p.name), palengke.teleporters.map((t: { name: string }) => t.name));
  for (const p of posts) {
    for (let r = p.tile[1]; r < p.tile[1] + 2; r++) for (let c = p.tile[0]; c < p.tile[0] + 2; c++) assert.equal(blocked[r][c], 1, `${p.name}: its 2 × 2 is blocked`);
    assert.equal(blocked[p.arrive[1]][p.arrive[0]], 0, `${p.name}: its landing is walkable`);
    assert.ok(nearPost(p, p.arrive[0], p.arrive[1], LANTERN_WALK_TILES), `${p.name}: its landing is near enough to use it`);
    assert.equal(postAt(posts, p.arrive[0], p.arrive[1]), posts.indexOf(p), `${p.name}: its landing is at it, not another`);
  }
  // The server's map blocks them too (its list the same, the hatch last), and the Map menu shows the four where they stand.
  assert.deepEqual(loadTownMap('palengke').lanterns?.map((p) => p.tile), all.map((p) => p.tile));
  assert.deepEqual((layout.posts.palengke as { tile: [number, number] }[]).map((p) => p.tile), posts.map((p) => p.tile));
  // Post to post inside the Palengke: fine; to the post you're at: you're already there.
  const ok = { from: 'palengke', to: 'palengke', toPost: 2, toPosts: all.length, posts: all, at: posts[0].arrive, inCombat: false, out: false, lanterns: 1 };
  assert.equal(lanternRefusal(ok), null);
  assert.match(lanternRefusal({ ...ok, toPost: 0 })!, /already there/);
  assert.equal(lanternRefusal({ ...ok, toPost: 4 }), null, 'to the Cellar Hatch');
  assert.match(lanternRefusal({ ...ok, toPost: 5 })!, /no Lantern Post/);
  assert.match(lanternRefusal({ ...ok, toPost: 1.5 })!, /no Lantern Post/);
});

test("the dungeon entrances: the Warren Gate and the Cellar Hatch listed after their map's posts, landing where their runs let you out; never left from", () => {
  for (const [name, map, id, gate, arrive] of [['slums', slums, 'warrens', 'slums-warren-gate', 'warrens'], ['palengke', palengke, 'silong', 'palengke-silong-hatch', 'silong']] as const) {
    const blocked = blockedWithPosts(map.blocked, map.teleporters);
    const all = lanternPostsOf({ ...map, blocked });
    const e = all.at(-1)!;
    assert.equal(e.entrance, id, name);
    const o = map.objects.find((x: { id: string }) => x.id === gate);
    assert.deepEqual(e.tile, [o.col, o.row], `${name}: at its object`);
    assert.deepEqual(e.arrive, map.arrive[arrive], `${name}: landing where its runs let you out`);
    assert.equal(blocked[e.arrive[1]][e.arrive[0]], 0, `${name}: a walkable landing`);
    assert.equal(postAt(all, e.arrive[0], e.arrive[1]), -1, `${name}: standing there isn't standing at a post`);
    const from = { from: name, to: 'town', posts: all, at: e.arrive, inCombat: false, out: false, lanterns: 1 };
    assert.match(lanternRefusal(from)!, /Walk up/, `${name}: no teleport from it`);
    const post = all.find((p) => !p.entrance)!;
    assert.equal(lanternRefusal({ ...from, to: name, toPost: all.indexOf(e), toPosts: all.length, at: post.arrive }), null, `${name}: a teleport to it from a post`);
  }
  assert.equal(lanternPostsOf(town).filter((p) => p.entrance).length, 0, 'the Town has none');
});

test('the Return Lantern: a consumable stacking to 99, sold in the Travel tab for its own price in Kusing', () => {
  const data = loadItemData();
  const def = data.defs.get(RETURN_LANTERN) as CombatItemDef;
  assert.equal(def.kind, 'consumable');
  assert.equal(stackLimit(data.stats, def), 99);
  const ware = combatWares(data, 1).find((w) => w.def.id === RETURN_LANTERN);
  assert.deepEqual(ware && { tab: ware.tab, cost: ware.cost, currency: ware.currency }, { tab: 'travel', cost: def.price!.kusing, currency: 'kusing' });
});

test('what stops a teleport: another map with a post, by your post, up, out of combat, a lantern in hand', () => {
  const post = lanternPostOf(town)!;
  const ok = { from: 'town', to: 'slums', posts: [post], at: post.arrive, inCombat: false, out: false, lanterns: 1 };
  assert.equal(lanternRefusal(ok), null);
  assert.match(lanternRefusal({ ...ok, to: 'hood' })!, /no Lantern Post/);
  assert.match(lanternRefusal({ ...ok, to: 'town' })!, /already there/);
  assert.match(lanternRefusal({ ...ok, at: [post.tile[0] + LANTERN_USE_TILES + 1, post.tile[1]] })!, /Walk up/);
  assert.equal(lanternRefusal({ ...ok, at: [post.tile[0] + LANTERN_USE_TILES, post.tile[1]] }), null);
  assert.match(lanternRefusal({ ...ok, posts: [] })!, /Walk up/);
  assert.equal(lanternRefusal({ ...ok, to: 'palengke', toPost: 3, toPosts: 4 }), null);
  assert.match(lanternRefusal({ ...ok, inCombat: true })!, /during a fight/);
  assert.match(lanternRefusal({ ...ok, out: true })!, /knocked out/);
  assert.match(lanternRefusal({ ...ok, lanterns: 0 })!, /need a Return Lantern/);
});

test('in combat: hit, or hitting, in the last outOfCombatAfterSec', () => {
  const R = loadStats().regen;
  const v = new Vitals(R);
  const max = { hp: 100, mp: 50, mpRegen: 1 };
  v.fill('a', max, 0);
  assert.equal(v.inCombat('a', 0), false);
  v.hurt('a', 10, 1000);
  assert.equal(v.inCombat('a', 1000 + R.outOfCombatAfterSec * 1000 - 1), true);
  assert.equal(v.inCombat('a', 1000 + R.outOfCombatAfterSec * 1000), false);
  v.fought('a', 9000);
  assert.equal(v.inCombat('a', 9001), true);
  assert.equal(v.inCombat('nobody', 0), false);
});

test('a teleport over the town: a lantern used, the light seen as they leave and where they arrive; refused when far or out of lanterns', async () => {
  const lanterns = new Map([['alice', 3], ['bob', 0]]);
  const server = createServer();
  attachTown(server, {
    map: loadTownMap(),
    rooms: { slums: () => loadTownMap('slums'), palengke: () => loadTownMap('palengke') },
    lanterns: {
      count: (u) => lanterns.get(u) ?? 0,
      use: (u) => (lanterns.get(u) ?? 0) > 0 && !!lanterns.set(u, lanterns.get(u)! - 1),
    },
    authenticate: async (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('as'),
    profile: (name) => ({ nickname: name, title: { name: 'Townfolk', color: '#fff' }, outfit: {} as never }),
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  const open = (as: string, room = 'town') =>
    new Promise<{ ws: WebSocket; got: TownServerMessage[]; id: string }>((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?as=${as}&room=${room}`);
      const c = { ws, got: [] as TownServerMessage[], id: '' };
      ws.on('message', (d) => {
        const m = JSON.parse(String(d)) as TownServerMessage;
        c.got.push(m);
        if (m.t === 'welcome') ok(Object.assign(c, { id: m.you }));
      });
    });
  const wait = (ms = 120) => new Promise((ok) => setTimeout(ok, ms));
  const send = (ws: WebSocket, m: unknown) => ws.send(JSON.stringify(m));
  const last = (c: { got: TownServerMessage[] }, t: string) => [...c.got].reverse().find((m) => m.t === t);
  try {
    const townPost = lanternPostOf(town)!;
    const slumsPost = lanternPostOf(slums)!;
    const alice = await open('alice');
    const bob = await open('bob');
    const carol = await open('carol', 'slums');
    send(carol.ws, { t: 'here', col: slumsPost.arrive[0] + 1, row: slumsPost.arrive[1], dir: 's' });

    // Far from the post: refused, the lantern kept.
    send(alice.ws, { t: 'here', col: townPost.tile[0] + 6, row: townPost.tile[1], dir: 's' });
    await wait();
    send(alice.ws, { t: 'lantern', to: 'slums' });
    await wait();
    assert.match((last(alice, 'lantern-refused') as { message: string }).message, /Walk up/);
    assert.equal(lanterns.get('alice'), 3);

    // Bob at the post with no lantern: refused.
    send(bob.ws, { t: 'here', col: townPost.arrive[0], row: townPost.arrive[1], dir: 's' });
    await wait();
    send(bob.ws, { t: 'lantern', to: 'slums' });
    await wait();
    assert.match((last(bob, 'lantern-refused') as { message: string }).message, /need a Return Lantern/);

    // Alice walks up (a fresh page: 'here' at the landing) and goes: one lantern, Bob sees her light.
    alice.ws.close();
    await wait();
    const alice2 = await open('alice');
    send(alice2.ws, { t: 'here', col: townPost.arrive[0], row: townPost.arrive[1], dir: 's' });
    await wait(1100); // (one teleport ask a second)
    send(alice2.ws, { t: 'lantern', to: 'slums' });
    await wait();
    assert.deepEqual(last(alice2, 'lantern-go'), { t: 'lantern-go', to: 'slums' });
    assert.equal(lanterns.get('alice'), 2);
    assert.deepEqual(last(bob, 'lantern-fx'), { t: 'lantern-fx', id: alice2.id, col: townPost.arrive[0], row: townPost.arrive[1], phase: 'out' });

    // Her page loads the Slums: the server itself puts her arrival on the post's landing (her trip is under way), so even
    // a page that lost ?via=lantern lands there, never at the spawn point; Carol, who came the usual way, got the spawn.
    alice2.ws.close();
    const alice3 = await open('alice', 'slums');
    assert.deepEqual((last(alice3, 'welcome') as { spawn: [number, number] }).spawn, slumsPost.arrive);
    assert.notDeepEqual((last(carol, 'welcome') as { spawn: [number, number] }).spawn, slumsPost.arrive);
    // Carol sees her arrive in the light at the post's landing.
    send(alice3.ws, { t: 'here', col: slumsPost.arrive[0], row: slumsPost.arrive[1], dir: 'se' });
    await wait();
    assert.deepEqual(last(carol, 'lantern-fx'), { t: 'lantern-fx', id: alice3.id, col: slumsPost.arrive[0], row: slumsPost.arrive[1], phase: 'in' });

    // On to the Old Market's third post (it has four): a lantern; she lands on that post's landing.
    await wait(1100);
    send(alice3.ws, { t: 'lantern', to: 'palengke', post: 2 });
    await wait();
    assert.deepEqual(last(alice3, 'lantern-go'), { t: 'lantern-go', to: 'palengke', post: 2 });
    assert.equal(lanterns.get('alice'), 1);
    alice3.ws.close();
    const market = loadTownMap('palengke').lanterns!;
    const alice4 = await open('alice', 'palengke');
    assert.deepEqual((last(alice4, 'welcome') as { spawn: [number, number] }).spawn, market[2].arrive);
    // And from there to the Cellar Hatch (a dungeon entrance: after the posts): her last lantern; she lands beside it.
    send(alice4.ws, { t: 'here', col: market[2].arrive[0], row: market[2].arrive[1], dir: 'se' });
    await wait(1100);
    const hatch = market.findIndex((p) => p.entrance === 'silong');
    send(alice4.ws, { t: 'lantern', to: 'palengke', post: hatch });
    await wait();
    assert.deepEqual(last(alice4, 'lantern-go'), { t: 'lantern-go', to: 'palengke', post: hatch });
    assert.equal(lanterns.get('alice'), 0);
    alice4.ws.close();
    const alice5 = await open('alice', 'palengke');
    assert.deepEqual((last(alice5, 'welcome') as { spawn: [number, number] }).spawn, palengke.arrive.silong);
    // Standing there isn't standing at a post: no teleport from it (even with a lantern).
    lanterns.set('alice', 1);
    send(alice5.ws, { t: 'here', col: palengke.arrive.silong[0], row: palengke.arrive.silong[1], dir: 'se' });
    await wait(1100);
    send(alice5.ws, { t: 'lantern', to: 'town' });
    await wait();
    assert.match((last(alice5, 'lantern-refused') as { message: string }).message, /Walk up/);
    for (const c of [alice5, bob, carol]) c.ws.close();
  } finally {
    await new Promise((ok) => server.close(ok));
  }
});
