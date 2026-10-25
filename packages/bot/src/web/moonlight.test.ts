import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type AdventureState, type CombatItemDef, type Item, type ShopEvents, buyCosmetic, cosmeticWares, cosmeticWeaponOf, isGearDef, itemTotals, newItem, weaponSkinFile, wearCosmetic, wornItems } from '@mikazuki/shared';
import { loadHalloween } from './halloween.js';
import { loadItemData } from './stats-data.js';
import { fighterStats } from './town-mobs.js';

// The Moonlight weapons (CONTEXT.md Weapon skin): one weapon cosmetic per class, sold in the store's Cosmetics tab for
// stats.json cosmeticShop.weaponPrice, worn in the Costume tab's Weapon place. Its look and its stats (+10 ATK, +3% crit
// damage) only while the wearer is of its class; every class weapon sheet has a -moonlight twin of the same size.

const D = loadItemData();
const H = loadHalloween().data;
const ASSETS = fileURLToPath(new URL('../../../game/public/assets/', import.meta.url));
const M = JSON.parse(readFileSync(join(ASSETS, 'manifest.json'), 'utf8')) as {
  characters: { wardrobe: { cosmeticWeapons: Record<string, { class: string; skin: string }> } };
  classes: { list: Record<string, { anims: Record<string, { dirs: Record<string, { back: { file: string }[]; front: { file: string }[] }> }>; rest: { anims?: Record<string, Record<string, { back: { file: string }[]; front: { file: string }[] }>>; dirs?: Record<string, { back: { file: string }[]; front: { file: string }[] }> } }> };
};
const CLASSES = ['slingshot', 'stick', 'greatstick', 'broom', 'potlid', 'hilot'];
const PRICE = (D.stats as unknown as { cosmeticShop: { weaponPrice: number } }).cosmeticShop.weaponPrice;
const OFF: ShopEvents = { halloween: { on: false, window: H } };
const NOW = Date.parse('2026-10-25T12:00:00+08:00');
let n = 0;
const uid = () => `m${++n}`;
const piece = (cls: string): Item => ({ ...newItem(D.stats, D.defs.get(`moonlight-${cls}`)!, uid()), bound: true });
const plus = (items: Item[], cls: string) => {
  const main = D.stats.classes[cls]?.main ?? null;
  const [a, b] = [itemTotals(D, [], main, cls), itemTotals(D, items, main, cls)];
  return Object.fromEntries((Object.keys(b) as (keyof typeof b)[]).flatMap((k) => (Math.abs((b[k] ?? 0) - (a[k] ?? 0)) > 1e-9 ? [[k, +((b[k] ?? 0) - (a[k] ?? 0)).toFixed(6)]] : [])));
};

test('six Moonlight weapons: weapon cosmetics, one for each class, +10 ATK and +3% crit damage, bound once bought; the manifest skins them for the same class', () => {
  for (const cls of CLASSES) {
    const def = D.defs.get(`moonlight-${cls}`) as CombatItemDef | undefined;
    assert.ok(def && !isGearDef(def), cls);
    assert.deepEqual([def.kind, def.cosmeticPlace, def.shop, def.forClass], ['cosmetic', 'weapon', 'cosmetic', cls], cls);
    assert.deepEqual(def.stats, { atk: 10, critDmg: 0.03 }, cls);
    for (const f of [def.icon, def.showcase, (def as { large?: string }).large]) assert.ok(f && existsSync(join(ASSETS, f)), `${cls}: ${f}`);
    assert.deepEqual(M.characters.wardrobe.cosmeticWeapons[def.id], { class: cls, skin: 'moonlight' }, `${cls}: the manifest's skin for the same class`);
  }
});

test('the store: every Moonlight weapon for stats.json cosmeticShop.weaponPrice, the buyer\'s own class first, never in a Set; one of each, into the Costume tab bound', () => {
  assert.equal(PRICE, 250);
  for (const cls of CLASSES) {
    const wares = cosmeticWares(D, { bag: [], cosmetics: {}, cls }, OFF, NOW);
    const weapons = wares.filter((w) => w.place === 'weapon');
    assert.deepEqual(weapons.map((w) => w.id).sort(), CLASSES.map((c) => `moonlight-${c}`).sort());
    assert.equal(weapons[0].id, `moonlight-${cls}`, `${cls}'s own first`);
    assert.ok(weapons.every((w) => w.cost === PRICE && !w.set && !w.pieces), 'weaponPrice, no Set');
    assert.ok(!wares.some((w) => w.pieces?.some((p) => p.startsWith('moonlight-'))), 'no Set holds one');
  }
  const s: Pick<AdventureState, 'bag' | 'cosmetics'> = { bag: [], cosmetics: {} };
  const kowens = { have: 1000, spend: (k: number) => ((kowens.have -= k), true) };
  const r = buyCosmetic(D, s, 'moonlight-stick', OFF, kowens, uid, NOW);
  assert.ok(r.ok, r.message);
  assert.equal(kowens.have, 1000 - PRICE);
  assert.deepEqual(s.bag.map((i) => [i.defId, i.bound]), [['moonlight-stick', true]]);
  assert.equal(buyCosmetic(D, s, 'moonlight-stick', OFF, kowens, uid, NOW).message, 'You already have the Moonlight Stick.');
});

test('worn on its class it adds exactly +10 ATK and +0.03 crit damage; on another class (or none) nothing', () => {
  for (const cls of CLASSES) {
    assert.deepEqual(plus([piece(cls)], cls), { atk: 10, critDamage: 0.03 }, cls);
    const other = CLASSES.find((c) => c !== cls)!;
    assert.deepEqual(plus([piece(cls)], other), {}, `${cls}'s on a ${other}`);
    assert.deepEqual(plus([piece(cls)], null as unknown as string), {}, `${cls}'s without a class`);
  }
  // A cosmetic without stats (the Lamp-head Hat) never adds anything.
  assert.deepEqual(plus([newItem(D.stats, D.defs.get('lamp-hat')!, uid())], 'stick'), {});
});

test('in a fight: the Costume tab\'s Weapon place counts (wornItems), +10 Power on its class, nothing on another', () => {
  const s = { bag: [piece('stick')], cosmetics: {} as AdventureState['cosmetics'], equipped: {} };
  assert.ok(wearCosmetic(D, s, s.bag[0].uid).ok);
  const power = (cls: string, gear: Item[]) => fighterStats(D, { cls, level: 20, gear }).power;
  assert.equal(power('stick', wornItems(s)) - power('stick', []), 10);
  assert.equal(power('broom', wornItems(s)), power('broom', []));
});

test('the look: a worn Moonlight weapon puts its id on the look only for its class (cosmeticWeaponOf)', () => {
  const worn = { weapon: piece('broom') };
  assert.equal(cosmeticWeaponOf(D, worn, 'broom'), 'moonlight-broom');
  assert.equal(cosmeticWeaponOf(D, worn, 'stick'), null);
  assert.equal(cosmeticWeaponOf(D, worn, null), null);
  assert.equal(cosmeticWeaponOf(D, {}, 'broom'), null);
});

test('weaponSkinFile turns every class weapon sheet the manifest names (the poses\' back and front, the resting and balm-float sheets) into its -moonlight twin', () => {
  const ex: [string, string][] = [
    ['characters/classes/potlid/idle-ready/char-weapon-lid-back-idle-ready-se.png', 'characters/classes/potlid/idle-ready/char-weapon-lid-moonlight-back-idle-ready-se.png'],
    ['characters/classes/potlid/idle-ready/char-weapon-ladle-idle-ready-sw.png', 'characters/classes/potlid/idle-ready/char-weapon-ladle-moonlight-idle-ready-sw.png'],
    ['characters/resting/walk/char-weapon-slingshot-rest-back-walk-n.png', 'characters/resting/walk/char-weapon-slingshot-moonlight-rest-back-walk-n.png'],
    ['characters/classes/hilot/balm-float/char-weapon-balm-float-se.png', 'characters/classes/hilot/balm-float/char-weapon-balm-moonlight-float-se.png'],
  ];
  for (const [a, b] of ex) assert.equal(weaponSkinFile(a, 'moonlight'), b);
  let count = 0;
  for (const [cls, art] of Object.entries(M.classes.list)) {
    const sets = [...Object.values(art.anims).flatMap((a) => Object.values(a.dirs)), ...Object.values(art.rest.anims ?? {}).flatMap((a) => Object.values(a)), ...Object.values(art.rest.dirs ?? {})];
    for (const l of sets.flatMap((d) => [...d.back, ...d.front])) {
      const twin = weaponSkinFile(l.file, 'moonlight');
      assert.notEqual(twin, l.file, `${cls}: ${l.file} has a weapon key`);
      assert.ok(existsSync(join(ASSETS, twin)), `${cls}: ${twin}`);
      count++;
    }
  }
  assert.ok(count > 1000, `${count} sheets`);
});

test('every class weapon sheet under characters/ has a -moonlight twin of the same size', () => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  const size = (f: string) => {
    const b = readFileSync(f);
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  };
  const sheets = walk(join(ASSETS, 'characters')).filter((f) => /\/char-weapon-[a-z]+-.*\.png$/.test(f) && !f.includes('-moonlight'));
  assert.ok(sheets.length > 1000, `${sheets.length} sheets`);
  for (const f of sheets) {
    const twin = weaponSkinFile(f, 'moonlight');
    assert.ok(existsSync(twin), twin);
    assert.deepEqual(size(twin), size(f), twin);
  }
});
