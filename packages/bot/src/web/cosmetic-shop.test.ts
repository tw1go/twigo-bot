import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type AdventureState, type Item, type ShopEvents, buyCosmetic, cosmeticWares, isGearDef, newItem, pocketSlots } from '@mikazuki/shared';
import { loadHalloween } from './halloween.js';
import { loadItemData } from './stats-data.js';

// The sari-sari store's Cosmetics tab (shared cosmetic-shop.ts; CONTEXT.md Cosmetic, Set): the five Sets' ten pieces and
// their art on the doll (every animation and direction), prices from stats.json cosmeticShop, the Witch Hat and Robe only
// during Halloween, one of each at a time, and a Set for less than its two pieces.

const D = loadItemData();
const H = loadHalloween().data;
const asset = (file: string) => new URL(`../../../game/public/assets/${file}`, import.meta.url);
const M = JSON.parse(readFileSync(asset('manifest.json'), 'utf8')) as {
  characters: { animations: Record<string, { directions?: string[] }>; directions: string[]; wardrobe: Record<string, unknown> };
};
const W = M.characters.wardrobe as {
  cosmeticHats: Record<string, string>;
  cosmeticTops: Record<string, string>;
  hatPattern: string;
  topOverPattern: string;
  bodyClipPattern: string;
  pattern: string;
  cosmeticBodyClip: string[];
  topCanvas: Record<string, unknown>;
  hatCanvas: Record<string, unknown>;
};
const R = (D.stats as unknown as { cosmeticShop: { headPrice: number; bodyPrice: number; setPrice: number } }).cosmeticShop;
const SETS = ['velvet-nightwing', 'ember-imp', 'lilac-gremlin', 'gravecaller', 'moonlit-sylph'];
const OFF: ShopEvents = { halloween: { on: false, window: H } };
const ON: ShopEvents = { halloween: { on: true, window: H } };
const NOW = Date.parse('2026-10-20T12:00:00+08:00');

let n = 0;
const uid = () => `u${++n}`;
const fresh = (): Pick<AdventureState, 'bag' | 'cosmetics'> => ({ bag: [], cosmetics: {} });
const wallet = (have: number) => {
  const w = { have, spent: 0, spend: (k: number) => (w.have >= k ? ((w.have -= k), (w.spent += k), true) : false) };
  return w;
};
const item = (defId: string): Item => newItem(D.stats, D.defs.get(defId)!, uid());

test('the five Sets: ten cosmetic pieces with their icons, and every hat, top, topover and body clip sheet on the doll', () => {
  const anims = Object.entries(M.characters.animations).flatMap(([anim, a]) => (a.directions ?? M.characters.directions).map((dir) => [anim, dir] as const));
  assert.equal(anims.length, 44, '(anim, dir) pairs');
  const fill = (pattern: string, vars: Record<string, string>) => pattern.replace(/\{(\w+)\}/g, (_, k: string) => vars[k]);
  for (const set of SETS) {
    for (const place of ['head', 'body'] as const) {
      const id = `${set}-${place}`;
      const def = D.defs.get(id);
      assert.ok(def && !isGearDef(def), id);
      assert.equal(def.kind, 'cosmetic');
      assert.equal(def.cosmeticPlace, place);
      assert.equal(def.shop, 'cosmetic');
      assert.equal(def.set, set);
      assert.equal(def.lastsDays, undefined, `${id} is permanent`);
      for (const file of [def.icon, def.showcase, def.large]) assert.ok(file && existsSync(asset(file)), `${id}: ${file}`);
      const key = place === 'head' ? W.cosmeticHats[id] : W.cosmeticTops[id];
      assert.ok(key, `${id} in the manifest`);
      for (const [anim, dir] of anims) {
        const files = place === 'head'
          ? [fill(W.hatPattern, { item: key, anim, dir })]
          : [fill(W.pattern, { slot: 'top', item: key, anim, dir }), fill(W.topOverPattern, { item: key, anim, dir }), ...(W.cosmeticBodyClip.includes(key) ? [fill(W.bodyClipPattern, { item: key, anim, dir })] : [])];
        for (const f of files) assert.ok(existsSync(asset(f)), f);
      }
      assert.ok(place === 'head' ? W.hatCanvas[key] : W.topCanvas[key], `${key}: drawn from its 64x64 cell`);
    }
  }
});

test('prices come from stats.json cosmeticShop: a Head, a Body, a Set', () => {
  const wares = cosmeticWares(D, fresh(), OFF, NOW);
  assert.equal(wares.find((w) => w.id === 'ember-imp-head')?.cost, R.headPrice);
  assert.equal(wares.find((w) => w.id === 'ember-imp-body')?.cost, R.bodyPrice);
  const set = wares.find((w) => w.id === 'set:ember-imp');
  assert.equal(set?.cost, R.setPrice);
  assert.equal(set?.name, 'Ember Imp Set');
  assert.deepEqual(set?.pieces, ['ember-imp-head', 'ember-imp-body']);
  assert.ok(R.setPrice < R.headPrice + R.bodyPrice);
  // Every piece first, then a Set per Set.
  assert.deepEqual(wares.map((w) => w.id), [...SETS.flatMap((s) => [`${s}-head`, `${s}-body`]), ...SETS.map((s) => `set:${s}`)]);
});

test('the Witch Hat, Robe and Set: only while Halloween is on, Limited until its end, refused outside it', () => {
  assert.ok(!cosmeticWares(D, fresh(), OFF, NOW).some((w) => w.id.includes('witch')));
  const on = cosmeticWares(D, fresh(), ON, NOW);
  const hat = on.find((w) => w.id === 'witch-hat-5d');
  assert.equal(hat?.cost, R.headPrice);
  assert.equal(hat?.limited, 'Halloween only, until Nov 4');
  assert.equal(on.find((w) => w.id === 'witch-robe-5d')?.cost, R.bodyPrice);
  assert.equal(on.find((w) => w.id === 'set:witch')?.limited, 'Halloween only, until Nov 4');
  const s = fresh();
  const w = wallet(500);
  assert.deepEqual(buyCosmetic(D, s, 'witch-hat-5d', OFF, w, uid, NOW), { ok: false, message: "That isn't for sale." });
  assert.equal(w.spent, 0);
  // Bought during the event: timed as the event gives it (its 5 days from now), bound.
  const r = buyCosmetic(D, s, 'witch-hat-5d', ON, w, uid, NOW);
  assert.equal(r.ok, true);
  assert.equal(s.bag[0].expiresAt, NOW + 5 * 86_400_000);
  assert.equal(s.bag[0].bound, true);
  assert.equal(buyCosmetic(D, s, 'witch-hat-5d', ON, w, uid, NOW).message, 'You already have the Witch Hat.');
  // Once it has run out, another may be bought.
  assert.equal(buyCosmetic(D, s, 'witch-hat-5d', ON, w, uid, NOW + 6 * 86_400_000).ok, true);
});

test('one at a time: bought into the Costume tab, bound; one already had (in the tab or worn) is refused', () => {
  const s = fresh();
  const w = wallet(1000);
  const r = buyCosmetic(D, s, 'ember-imp-head', OFF, w, uid, NOW);
  assert.deepEqual([r.ok, r.message], [true, 'Bought the Ember Imp Horns!']);
  assert.equal(w.spent, R.headPrice);
  assert.equal(s.bag.length, 1);
  assert.equal(s.bag[0].bound, true);
  assert.equal(s.bag[0].expiresAt, undefined);
  assert.deepEqual(buyCosmetic(D, s, 'ember-imp-head', OFF, w, uid, NOW), { ok: false, message: 'You already have the Ember Imp Horns.' });
  assert.equal(cosmeticWares(D, s, OFF, NOW).find((x) => x.id === 'ember-imp-head')?.owned, true);
  // Worn counts too.
  const worn = fresh();
  worn.cosmetics.body = item('gravecaller-body');
  assert.equal(buyCosmetic(D, worn, 'gravecaller-body', OFF, w, uid, NOW).message, 'You already have the Gravecaller Robe.');
  // Kowens, and a full Costume tab.
  assert.equal(buyCosmetic(D, fresh(), 'ember-imp-body', OFF, wallet(40), uid, NOW).message, `You need ${R.bodyPrice} Kowens but have 40 Kowens.`);
  const full = fresh();
  for (let i = 0; i < pocketSlots(D, 'costume'); i++) full.bag.push(item('lamp-hat'));
  assert.equal(buyCosmetic(D, full, 'ember-imp-body', OFF, wallet(1000), uid, NOW).message, 'Your Costume tab is full.');
});

test('a Set: setPrice for both pieces at once, two free slots; refused (and not listed) once either piece is had', () => {
  const s = fresh();
  const w = wallet(1000);
  const r = buyCosmetic(D, s, 'set:moonlit-sylph', OFF, w, uid, NOW);
  assert.deepEqual([r.ok, r.message], [true, 'Bought the Moonlit Sylph Set!']);
  assert.equal(w.spent, R.setPrice);
  assert.deepEqual(s.bag.map((b) => [b.defId, b.bound]), [['moonlit-sylph-head', true], ['moonlit-sylph-body', true]]);
  assert.equal(buyCosmetic(D, s, 'set:moonlit-sylph', OFF, w, uid, NOW).message, 'You already have the Moonlit Sylph Set.');

  const one = fresh();
  one.bag.push(item('ember-imp-head'));
  assert.ok(!cosmeticWares(D, one, OFF, NOW).some((x) => x.id === 'set:ember-imp'), 'the Set card is hidden');
  const before = wallet(1000);
  assert.deepEqual(buyCosmetic(D, one, 'set:ember-imp', OFF, before, uid, NOW), { ok: false, message: 'You already have the Ember Imp Horns. Buy the Ember Imp Suit on its own.' });
  assert.equal(before.spent, 0);

  const tight = fresh();
  for (let i = 0; i < pocketSlots(D, 'costume') - 1; i++) tight.bag.push(item('lamp-hat'));
  assert.equal(buyCosmetic(D, tight, 'set:gravecaller', OFF, wallet(1000), uid, NOW).message, 'A Set needs 2 free slots in your Costume tab.');
});
