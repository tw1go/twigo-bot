import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The neighbourhood against a throwaway database, with made-up config (never the real .env or data/).
const dir = mkdtempSync(join(tmpdir(), 'hood-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { hoodMap, lotTile } = await import('./hood-map.js');
const { REPAINT_COST, hoodAction, saveHouse, townHood } = await import('./hood.js');
const { add, addFence, balance, fencedUntil } = await import('../credits/store.js');
const { addMasterKey } = await import('../dig/store.js');
const { addPotions, potionCount } = await import('../potions/potions.js');
const { closeDatabase } = await import('../db/db.js');

const names = async (id: string) => `name-${id}`;
const client = { channels: { fetch: async () => null } } as never;
const look = { style: 'cottage', colours: { walls: 'cream', roof: 'moss' } };

/** Every walkable tile reachable from the first exit tile. */
function reachable(m: ReturnType<typeof hoodMap>): Set<string> {
  const seen = new Set<string>();
  const todo = [m.exit[0]];
  while (todo.length) {
    const [c, r] = todo.pop()!;
    const k = `${c},${r}`;
    if (seen.has(k) || c < 0 || r < 0 || c >= m.size[0] || r >= m.size[1] || m.blocked[r][c]) continue;
    seen.add(k);
    todo.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
  }
  return seen;
}

test('lots go 5, 4, 5, 4 down the bands, the map grows with the houses, and every door can be walked to', () => {
  assert.deepEqual([0, 4, 5, 8, 9, 13, 14].map((l) => lotTile(l).band), [0, 0, 1, 1, 2, 2, 3]);
  assert.equal(lotTile(5).row - lotTile(0).row, 2); // the band of 4 sits half a lot along
  const small = hoodMap(1);
  const big = hoodMap(12);
  assert.ok(big.size[0] > small.size[0]);
  assert.equal(big.objects.filter((o) => o.kind === 'building').length, 12);
  const open = reachable(big);
  for (const [c, r] of Object.values(big.doors)) assert.ok(open.has(`${c},${r}`), `door ${c},${r} reachable`);
  assert.ok(open.has(big.spawn.join(',')));
});

test('the first house is free and goes on the next lot; a new look costs Kowens', async () => {
  const first = await saveHouse('a', look, names);
  assert.ok(first.ok && first.me.house?.style === 'cottage');
  await saveHouse('b', { ...look, style: 'kubo' }, names);
  const h = await townHood('b', names);
  assert.deepEqual(h.houses.map((x) => [x.lot, x.owner, !!x.mine]), [[0, 'name-a', false], [1, 'name-b', true]]);
  assert.equal((await saveHouse('a', look, names)).ok, false); // the same look
  assert.equal((await saveHouse('a', { ...look, style: 'modern' }, names)).ok, false); // no Kowens for it
  add('a', 10);
  assert.ok((await saveHouse('a', { ...look, style: 'modern' }, names)).ok);
  assert.equal(balance('a'), 10 - REPAINT_COST);
});

test('a Bakod fences the house: stealing needs a Master Key, a Kalawang Potion halves it', async () => {
  add('b', 20);
  addFence('a', 60 * 60_000, 7 * 86_400_000);
  const h = await townHood('b', names);
  assert.equal(h.houses[0].fenced, true);
  assert.equal(h.map.fence.length, 20); // round the yard: 5 a side
  assert.equal((await hoodAction(client, 'b', 'steal', 0, names)).ok, false); // the fence
  assert.equal((await hoodAction(client, 'b', 'key', 0, names)).ok, false); // no key
  addPotions('b', 'kalawang', 1);
  const before = fencedUntil('a')!;
  assert.ok((await hoodAction(client, 'b', 'kalawang', 0, names)).ok);
  assert.ok(fencedUntil('a')! < before && potionCount('b', 'kalawang') === 0);
  addMasterKey('b');
  const r = await hoodAction(client, 'b', 'key', 0, names); // snapped, stole or caught: an attempt either way
  assert.ok(r.ok);
  assert.equal((await hoodAction(client, 'b', 'steal', 1, names)).ok, false); // your own house
});

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
