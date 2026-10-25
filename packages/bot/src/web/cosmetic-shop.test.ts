import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type AdventureState, type Item, type ShopEvents, buyCosmetic, cosmeticWares, giftableCosmetics, giveCosmetic, isGearDef, newItem, pocketSlots } from '@mikazuki/shared';
import { loadHalloween } from './halloween.js';
import { loadItemData } from './stats-data.js';

// The sari-sari store's Cosmetics tab (shared cosmetic-shop.ts; CONTEXT.md Cosmetic, Set): the seven Sets' fourteen pieces and
// their art on the doll (every animation and direction) and on every combat pose, prices from stats.json cosmeticShop, the Witch Hat and Robe only
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
  hatClipPattern: string;
  hatClips: Record<string, boolean>;
  topOverPattern: string;
  bodyClipPattern: string;
  pattern: string;
  cosmeticBodyClip: string[];
  topCanvas: Record<string, unknown>;
  hatCanvas: Record<string, unknown>;
};
const R = (D.stats as unknown as { cosmeticShop: { headPrice: number; bodyPrice: number; setPrice: number } }).cosmeticShop;
const SETS = ['velvet-nightwing', 'ember-imp', 'lilac-gremlin', 'gravecaller', 'moonlit-sylph', 'midnight-agent', 'little-visitor'];
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

test('the seven Sets: fourteen cosmetic pieces with their icons, and every hat, hair clip, top, topover and body clip sheet on the doll', () => {
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
          ? [fill(W.hatPattern, { item: key, anim, dir }), ...(W.hatClips[key] ? [fill(W.hatClipPattern, { item: key, anim, dir })] : [])]
          : [fill(W.pattern, { slot: 'top', item: key, anim, dir }), fill(W.topOverPattern, { item: key, anim, dir }), ...(W.cosmeticBodyClip.includes(key) ? [fill(W.bodyClipPattern, { item: key, anim, dir })] : [])];
        for (const f of files) assert.ok(existsSync(asset(f)), f);
      }
      assert.ok(place === 'head' ? W.hatCanvas[key] : W.topCanvas[key], `${key}: drawn from its 64x64 cell`);
    }
  }
});

test('pose art: every cosmeticPoseTops key (the seven Sets\' tops and the Witch Robe) has a sheet for each class, combat pose and direction, frame for frame', () => {
  const C = JSON.parse(readFileSync(asset('manifest.json'), 'utf8')) as {
    characters: { wardrobe: { cosmeticPoseTops: string[]; cosmeticPosePattern: string; cosmeticTops: Record<string, string> } };
    classes: { list: Record<string, { anims: Record<string, { dirs: Record<string, { body: string }> }> }> };
  };
  const { cosmeticPoseTops: keys, cosmeticPosePattern: pattern, cosmeticTops } = C.characters.wardrobe;
  assert.deepEqual([...keys].sort(), [...SETS.map((s) => cosmeticTops[`${s}-body`]), cosmeticTops['witch-robe']].sort(), "the seven Sets' tops and the Witch Robe");
  /** A PNG's width and height (its IHDR). */
  const size = (file: string) => {
    const b = readFileSync(asset(file));
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  };
  let n = 0;
  for (const [cls, art] of Object.entries(C.classes.list))
    for (const [anim, a] of Object.entries(art.anims))
      for (const [dir, d] of Object.entries(a.dirs)) {
        const frames = size(d.body)[0] / 32;
        for (const key of keys) {
          const file = pattern.replace('{class}', cls).replaceAll('{anim}', anim).replace('{item}', key).replace('{dir}', dir);
          assert.ok(existsSync(asset(file)), file);
          assert.deepEqual(size(file), [frames * 64, 64], `${file}: ${frames} frames of 64x64`);
          n++;
        }
      }
  assert.equal(n, 3520); // (440 each)
});

test('prices come from stats.json cosmeticShop: a Head, a Body, a Weapon, a Set', () => {
  const wares = cosmeticWares(D, fresh(), OFF, NOW);
  assert.equal(wares.find((w) => w.id === 'ember-imp-head')?.cost, R.headPrice);
  assert.equal(wares.find((w) => w.id === 'ember-imp-body')?.cost, R.bodyPrice);
  const set = wares.find((w) => w.id === 'set:ember-imp');
  assert.equal(set?.cost, R.setPrice);
  assert.equal(set?.name, 'Ember Imp Set');
  assert.deepEqual(set?.pieces, ['ember-imp-head', 'ember-imp-body']);
  assert.ok(R.setPrice < R.headPrice + R.bodyPrice);
  assert.equal(wares.find((w) => w.id === 'moonlight-stick')?.cost, (R as unknown as { weaponPrice: number }).weaponPrice);
  // Every piece first (the Moonlight weapons after the Sets' pieces: moonlight.test.ts), then a Set per Set.
  const MOONLIGHT = ['slingshot', 'stick', 'greatstick', 'broom', 'potlid', 'hilot'].map((c) => `moonlight-${c}`);
  assert.deepEqual(wares.map((w) => w.id), [...SETS.flatMap((s) => [`${s}-head`, `${s}-body`]), ...MOONLIGHT, ...SETS.map((s) => `set:${s}`)]);
});

test('the Witch Hat, Robe and Set: only while Halloween is on, Limited until its end, refused outside it, and permanent', () => {
  assert.ok(!cosmeticWares(D, fresh(), OFF, NOW).some((w) => w.id.includes('witch')));
  const on = cosmeticWares(D, fresh(), ON, NOW);
  const hat = on.find((w) => w.id === 'witch-hat');
  assert.equal(hat?.cost, R.headPrice);
  assert.equal(hat?.limited, 'Halloween only, until Nov 4');
  assert.equal(on.find((w) => w.id === 'witch-robe')?.cost, R.bodyPrice);
  assert.deepEqual(on.find((w) => w.id === 'set:witch')?.pieces, ['witch-hat', 'witch-robe']);
  assert.equal(on.find((w) => w.id === 'set:witch')?.limited, 'Halloween only, until Nov 4');
  assert.ok(!on.some((w) => w.id.endsWith('-5d')), "Biikko's 5-day ones are never sold");
  const s = fresh();
  const w = wallet(500);
  assert.deepEqual(buyCosmetic(D, s, 'witch-hat', OFF, w, uid, NOW), { ok: false, message: "That isn't for sale." });
  assert.equal(w.spent, 0);
  // Bought during the event: theirs for good (no clock), bound.
  const r = buyCosmetic(D, s, 'witch-hat', ON, w, uid, NOW);
  assert.equal(r.ok, true);
  assert.equal(s.bag[0].expiresAt, undefined);
  assert.equal(s.bag[0].bound, true);
  assert.equal(buyCosmetic(D, s, 'witch-hat', ON, w, uid, NOW).message, 'You already have the Witch Hat.');
  // A 5-day one from Biikko doesn't count: the permanent one can still be bought.
  const dropped = fresh();
  dropped.cosmetics.body = { ...item('witch-robe-5d'), expiresAt: NOW + 86_400_000 };
  assert.equal(buyCosmetic(D, dropped, 'witch-robe', ON, wallet(500), uid, NOW).ok, true);
  // Both look the same on the doll.
  assert.equal(W.cosmeticHats['witch-hat'], W.cosmeticHats['witch-hat-5d']);
  assert.equal(W.cosmeticTops['witch-robe'], W.cosmeticTops['witch-robe-5d']);
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

test("the CMS gives cosmetics: every piece and every Set listed (the Moonlight weapons and Biikko's timed ones too); given unbound into the Costume tab, a Set's two pieces; never one they have; room needed", () => {
  const list = giftableCosmetics(D);
  const ids = list.map((c) => c.id);
  for (const id of ['lamp-hat', 'witch-hat', 'witch-hat-5d', 'moonlight-potlid', 'midnight-agent-head', 'set:midnight-agent', 'set:witch']) assert.ok(ids.includes(id), id);
  assert.equal(list.find((c) => c.id === 'moonlight-stick')?.forClass, 'stick');
  assert.equal(list.find((c) => c.id === 'witch-hat-5d')?.name, 'Witch Hat (5 days)');
  assert.deepEqual([...new Set(list.map((c) => c.place))], ['head', 'body', 'weapon', 'set'], 'by place, Sets last');
  // A piece: into the Costume tab, unbound (it binds as it's worn).
  const s = fresh();
  const r = giveCosmetic(D, s, 'moonlight-broom', uid, NOW);
  assert.deepEqual([r.ok, r.message, r.names], [true, 'Gave the Moonlight Broom.', ['Moonlight Broom']]);
  assert.equal(s.bag.length, 1);
  assert.equal(s.bag[0].bound, false);
  // Not again, and not while worn.
  assert.deepEqual(giveCosmetic(D, s, 'moonlight-broom', uid, NOW), { ok: false, message: 'They already have the Moonlight Broom.', names: [] });
  const worn = { bag: [], cosmetics: { head: item('midnight-agent-head') } };
  assert.equal(giveCosmetic(D, worn, 'set:midnight-agent', uid, NOW).message, 'They already have the Midnight Agent Shades.');
  // A Set: both pieces.
  const t = fresh();
  assert.equal(giveCosmetic(D, t, 'set:little-visitor', uid, NOW).message, 'Gave the Little Visitor Set.');
  assert.deepEqual(t.bag.map((i) => [i.defId, i.bound]), [['little-visitor-head', false], ['little-visitor-body', false]]);
  // Room: a full Costume tab takes nothing; one free slot takes a piece but not a Set.
  const slots = pocketSlots(D, 'costume');
  const full = { bag: Array.from({ length: slots }, () => item('lamp-hat')), cosmetics: {} };
  assert.equal(giveCosmetic(D, full, 'moonlight-hilot', uid, NOW).message, 'Their Costume tab is full.');
  const one = { bag: Array.from({ length: slots - 1 }, () => item('lamp-hat')), cosmetics: {} };
  assert.equal(giveCosmetic(D, one, 'set:gravecaller', uid, NOW).message, 'Their Costume tab needs 2 free slots.');
  assert.equal(one.bag.length, slots - 1, 'nothing given');
  // Not a cosmetic, or no such thing.
  assert.equal(giveCosmetic(D, fresh(), 'rough-whetstone', uid, NOW).message, 'No such cosmetic.');
  assert.equal(giveCosmetic(D, fresh(), 'set:nothing', uid, NOW).message, 'No such cosmetic.');
});
