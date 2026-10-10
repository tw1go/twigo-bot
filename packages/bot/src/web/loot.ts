import { type EquipSlot, type EquipmentDef, type GearRarity, type ItemData, type Item, type Odds, type WarrensData, agimatSlots, gearKind, isGearDef, itemStats, kusingFor, kusingRange, mobStats, nearestGearLevel, newAgimat, newItem, numbersIn, rollGear } from '@mikazuki/shared';
import type { LootContent } from './combat-bag.js';

// 🎲 What a kill drops, rolled on the server by stats.json (rarity.mobGearDrop and bossGearDrop, potions, currencies,
// bossLoot; combat-guide.md "Death, parties and loot"): every mob drops Kusing (a whole number in 0.6–1.2 × round(100 ×
// 1.08^(level − 1)), currencies.kusingPerMobRange: a Tin Can 60–120); about 3%
// of kills a weapon or armor piece for a random class or gear type at the map's gear level (Wire Tangle and Scrap Crab
// sometimes Lv 20), brown, white or grey with no lines; about 5% a potion of the map's tier (HP or MP). The Scrapheap
// Golem gives everyone who did 5% of its HP their own loot: its Kusing, Rough Whetstones, 1–2 blue or orange gear pieces
// (lines rolled), now and then an accessory, an agimat and, rarely, the Lamp-head Hat. Every dropped piece of gear comes
// with a plus of +0 to +3 (rarity.dropPlus). Pure: `random` and `uid` come in (`plusRandom`: the plus's own, for the dev
// town's rich loot; the same `random` otherwise).

/** One pick from weighted choices. */
function weighted<T>(choices: [T, number][], random: () => number): T {
  const total = choices.reduce((n, [, w]) => n + w, 0);
  let r = random() * total;
  for (const [c, w] of choices) if ((r -= w) < 0) return c;
  return choices[choices.length - 1][0];
}
const pick = <T>(list: T[], random: () => number): T => list[Math.floor(random() * list.length)];
/** A whole number in [lo, hi]. */
const between = ([lo, hi]: [number, number], random: () => number) => lo + Math.floor(random() * (hi - lo + 1));

/** The gear tier an item level belongs to (stats.json gearTiers: low is Lv 1–20). */
export function tierAt(data: ItemData, level: number): string | null {
  for (const [id, t] of Object.entries(itemStats(data.stats).gearTiers)) {
    const levels = (t as { levels?: number[] }).levels;
    if (levels && level >= levels[0] && level <= levels[1]) return id;
  }
  return null;
}

/** Gear that drops (weapons and armor, or accessories) of a level: never training gear. */
const dropGear = (data: ItemData, level: number, accessories = false): EquipmentDef[] =>
  [...data.defs.values()].filter((d): d is EquipmentDef => isGearDef(d) && !d.training && d.level === level && (gearKind(d.slot) === 'accessory') === accessories);

/** The map's gear level for a mob kind's drops: its own odds (Wire Tangle, Scrap Crab: Lv 10 or 20), else the map's
 *  (stats.json rarity.mobGearDrop.level.default: "map gear level (Slums 10)"). */
export function dropLevel(data: ItemData, kind: string, random: () => number): number {
  const L = itemStats(data.stats).rarity.mobGearDrop.level;
  const own = L[kind];
  if (own && typeof own === 'object') return Number(weighted(Object.entries(own).map(([lv, w]): [string, number] => [lv, w]), random));
  return numbersIn(String(L.default))[0] ?? 1;
}

/** A dropped piece's plus, +0 to +3 by stats.json rarity.dropPlus (its number keys; never more than +3). */
export function dropPlus(data: ItemData, random: () => number): number {
  const odds = Object.entries(itemStats(data.stats).rarity.dropPlus ?? {}).flatMap(([k, w]): [number, number][] =>
    /^\d+$/.test(k) && typeof w === 'number' ? [[Math.min(3, Number(k)), w]] : [],
  );
  return odds.length ? weighted(odds, random) : 0;
}

/** A piece of gear as it drops: rolled at its rarity, with its plus. */
const dropped = (data: ItemData, def: EquipmentDef, rarity: GearRarity, uid: string, random: () => number, plusRandom: () => number): Item => {
  const item = rollGear(data.stats, def, rarity, uid, random);
  item.plus = dropPlus(data, plusRandom);
  return item;
};

/** A normal mob's drops: Kusing always (a random amount round its level's), now and then gear (brown, white or grey, +0 to +3) or an HP or MP Potion. */
export function mobDrops(data: ItemData, kind: string, level: number, random: () => number, uid: () => string, plusRandom = random): LootContent[] {
  const S = itemStats(data.stats);
  const out: LootContent[] = [{ kusing: between(kusingRange(data.stats, level), random) }];
  const G = S.rarity.mobGearDrop;
  if (random() < G.chancePerKill) {
    const gearLevel = dropLevel(data, kind, random);
    const kinds = dropGear(data, gearLevel);
    if (kinds.length) {
      const rarity = weighted(Object.entries(G.odds) as [GearRarity, number][], random);
      out.push({ item: dropped(data, pick(kinds, random), rarity, uid(), random, plusRandom) });
    }
  }
  if (random() < S.potions.mobDropChance) {
    const tier = tierAt(data, dropLevel(data, 'default', random));
    const potions = [...data.defs.values()].filter((d) => !isGearDef(d) && d.kind === 'potion' && d.tier === tier);
    if (potions.length) out.push({ item: newItem(data.stats, pick(potions, random), uid()) });
  }
  return out;
}

/** A mini boss's loot for one player who earned it (classes/leveling.json miniBoss.loot): its mob's Kusing × kusingTimes,
 *  `gearPieces` of gear at the gear level nearest its own (brown, white or grey by the mobs' odds, +0 to +3), and now and
 *  then (fragmentChance) a fragment of its tier's whetstone. */
export function miniLoot(
  data: ItemData,
  kind: string,
  level: number,
  rules: { kusingTimes: number; gearPieces: number; fragmentChance: number },
  random: () => number,
  uid: () => string,
  plusRandom = random,
): LootContent[] {
  const S = itemStats(data.stats);
  const mob = mobStats(data.stats, kind)?.level ?? level;
  const out: LootContent[] = [{ kusing: between(kusingRange(data.stats, mob), random) * rules.kusingTimes }];
  const levels = [...new Set([...data.defs.values()].filter((d): d is EquipmentDef => isGearDef(d) && !d.training && gearKind(d.slot) !== 'accessory').map((d) => d.level))];
  const gearLevel = nearestGearLevel(levels, level);
  for (let n = rules.gearPieces; n > 0; n--) {
    const kinds = dropGear(data, gearLevel);
    if (!kinds.length) break;
    const rarity = weighted(Object.entries(S.rarity.mobGearDrop.odds) as [GearRarity, number][], random);
    out.push({ item: dropped(data, pick(kinds, random), rarity, uid(), random, plusRandom) });
  }
  if (random() < rules.fragmentChance) {
    const tier = tierAt(data, gearLevel);
    const fragment = [...data.defs.values()].find((d) => !isGearDef(d) && d.forge === 'fragment' && d.tier === tier);
    if (fragment) out.push({ item: newItem(data.stats, fragment, uid()) });
  }
  return out;
}

/** An agimat's stat, by stats.json agimats.dropWeight (the rare three seldom, attack rate now and then; STR, DEX and INT
 *  share a common one's weight). `rareTimes`: the rare three that many times as likely (disassembly's two slots); `slot`:
 *  only stats that fit it (agimats.onlyIn: disassembly locks the agimat to the item's slot). */
export function rollAgimatStat(data: ItemData, random: () => number, rareTimes = 1, slot?: EquipSlot): string {
  const A = itemStats(data.stats).agimats;
  const stats = Object.keys(A.valueAtLevel)
    .flatMap((s) => (s === 'stat' ? ['STR', 'DEX', 'INT'] : [s]))
    .filter((s) => !slot || !agimatSlots(data.stats, s) || agimatSlots(data.stats, s)!.includes(slot));
  const w = (s: string) => (A.rare.includes(s) ? (A.dropWeight.rare ?? 0.1) * rareTimes : A.dropWeight[s] ?? (['STR', 'DEX', 'INT'].includes(s) ? (A.dropWeight.others ?? 1) / 3 : A.dropWeight.others ?? 1));
  return weighted(stats.map((s): [string, number] => [s, w(s)]), random);
}

/** The golem's loot for one player who earned it (stats.json bossLoot.perEligiblePlayer); `ticketChance`: a Warren Ticket
 *  that often too (classes/dungeons.json warrens.ticket.sources.golemLootChance). */
export function golemLoot(data: ItemData, random: () => number, uid: () => string, plusRandom = random, ticketChance = 0): LootContent[] {
  const S = itemStats(data.stats);
  const P = S.bossLoot.perEligiblePlayer;
  const B = S.rarity.bossGearDrop;
  const out: LootContent[] = [{ kusing: P.kusing }];
  const whetstone = [...data.defs.values()].find((d) => !isGearDef(d) && d.shop === 'whetstone' && d.tier === 'low');
  if (whetstone) out.push({ item: newItem(data.stats, whetstone, uid(), between(P.roughWhetstones, random)) });
  const level = () => Number(weighted(Object.entries(B.level).map(([lv, w]): [string, number] => [lv, w]), random));
  const affix = () => weighted(Object.entries(B.affix) as ['blue' | 'orange', number][], random);
  const colour = (tier: 'blue' | 'orange', slots: number): GearRarity => `${slots >= 2 ? 'dark' : 'light'}${tier === 'blue' ? 'Blue' : 'Orange'}` as GearRarity;
  for (let n = between(P.gearPieces, random); n > 0; n--) {
    const kinds = dropGear(data, level());
    const slots = Number(weighted(Object.entries(B.slots).map(([s, w]): [string, number] => [s, w]), random));
    if (kinds.length) out.push({ item: dropped(data, pick(kinds, random), colour(affix(), slots), uid(), random, plusRandom) });
  }
  if (random() < P.accessoryChance) {
    const kinds = dropGear(data, level(), true);
    if (kinds.length) out.push({ item: dropped(data, pick(kinds, random), colour(affix(), 1), uid(), random, plusRandom) });
  }
  if (random() < P.agimatChance) {
    const stat = rollAgimatStat(data, random);
    const def = [...data.defs.values()].find((d) => !isGearDef(d) && d.kind === 'agimat' && d.stat === stat);
    if (def && !isGearDef(def)) out.push({ item: newAgimat(data.stats, def, pick(P.agimatLevels, random), uid()) });
  }
  if (random() < P.lampHatChance) {
    const hat = data.defs.get('lamp-hat');
    if (hat) out.push({ item: newItem(data.stats, hat, uid()) });
  }
  ticket(data, ticketChance, random, uid, out);
  return out;
}

// ── The Scrap Warrens (classes/dungeons.json warrens.loot) ──

/** A Warren Ticket, `chance` of the time. */
function ticket(data: ItemData, chance: number, random: () => number, uid: () => string, out: LootContent[]): void {
  const def = data.defs.get('warren-ticket');
  if (def && chance > 0 && random() < chance) out.push({ item: newItem(data.stats, def, uid()) });
}

/** One pick by odds ({ blue: 0.8, orange: 0.2 }). */
const byOdds = (odds: Odds, random: () => number) => weighted(Object.entries(odds), random);

/** A blue or orange rarity by its odds and its slot count (1: light, 2: dark). */
const affixColour = (affix: Odds, slots: Odds, random: () => number): GearRarity => {
  const tier = byOdds(affix, random);
  const n = Number(byOdds(slots, random));
  return `${n >= 2 ? 'dark' : 'light'}${tier === 'orange' ? 'Orange' : 'Blue'}` as GearRarity;
};

/** Weapons and armor of a level for a class (its own weapon, its gear type's armor); any class's when it has none. */
function classGear(data: ItemData, level: number, cls: string | null): EquipmentDef[] {
  const all = dropGear(data, level);
  const gearType = cls ? data.stats.classes[cls]?.gearType : undefined;
  const mine = cls ? all.filter((d) => (d.class ? d.class === cls : !!gearType && d.gear?.toLowerCase() === gearType.toLowerCase())) : [];
  return mine.length ? mine : all;
}

/** The Rough Whetstones `n` of them. */
const whetstones = (data: ItemData, n: number, uid: () => string): LootContent | null => {
  const def = [...data.defs.values()].find((d) => !isGearDef(d) && d.shop === 'whetstone' && d.tier === 'low');
  return def && n > 0 ? { item: newItem(data.stats, def, uid(), n) } : null;
};

/** A Warrens mini boss's loot (warrens.loot.miniBoss): its Kusing pile, then one roll for each player inside — an affix
 *  item (blue or orange, 1 or 2 slots), a plain one (white or grey), or unlucky (3 × its level's Kusing and a few Rough
 *  Whetstones). Gear is the loot's gear level (20), a weapon or armor piece for a class picked from `classes` (the
 *  players inside), with the usual drop plus. */
export function warrensMiniLoot(
  data: ItemData,
  W: WarrensData,
  boss: { level: number; kusingPile?: number },
  classes: (string | null)[],
  players: number,
  random: () => number,
  uid: () => string,
  plusRandom = random,
): LootContent[] {
  const R = W.loot.miniBoss.roll;
  const out: LootContent[] = boss.kusingPile ? [{ kusing: boss.kusingPile }] : [];
  const cls = () => pick(classes.length ? classes : [null], random);
  for (let n = 0; n < Math.max(1, players); n++) {
    const r = random();
    if (r < R.affix.chance || r < R.affix.chance + R.plain.chance) {
      const kinds = classGear(data, W.loot.gearLevel, cls());
      if (!kinds.length) continue;
      const rarity = r < R.affix.chance ? affixColour(R.affix.affix, R.affix.slots, random) : (byOdds(R.plain.colour, random) as GearRarity);
      out.push({ item: dropped(data, pick(kinds, random), rarity, uid(), random, plusRandom) });
      continue;
    }
    out.push({ kusing: R.unlucky.kusingTimes * kusingFor(data.stats, boss.level) });
    const stones = whetstones(data, between(R.unlucky.roughWhetstones, random), uid);
    if (stones) out.push(stones);
  }
  return out;
}

/** Barong-Barong's loot (warrens.loot.lastBoss), for each player inside: affix gear for a class from `classes`, Lv 20
 *  accessories, Kusing, Rough Whetstones, now and then a Lv 20 agimat and a Warren Ticket. */
export function warrensBossLoot(data: ItemData, W: WarrensData, classes: (string | null)[], players: number, random: () => number, uid: () => string, plusRandom = random): LootContent[] {
  const P = W.loot.lastBoss.perPlayerInside;
  const out: LootContent[] = [];
  const cls = () => pick(classes.length ? classes : [null], random);
  for (let n = 0; n < Math.max(1, players); n++) {
    for (let k = 0; k < P.affixGear; k++) {
      const kinds = classGear(data, W.loot.gearLevel, cls());
      if (kinds.length) out.push({ item: dropped(data, pick(kinds, random), affixColour(P.affix, P.slots, random), uid(), random, plusRandom) });
    }
    for (let k = 0; k < P.accessories; k++) {
      const kinds = dropGear(data, P.accessoryLevel, true);
      if (kinds.length) out.push({ item: dropped(data, pick(kinds, random), affixColour(P.accessoryAffix, { 1: 1 }, random), uid(), random, plusRandom) });
    }
    out.push({ kusing: P.kusing });
    const stones = whetstones(data, between(P.roughWhetstones, random), uid);
    if (stones) out.push(stones);
    if (random() < P.agimatChance) {
      const stat = rollAgimatStat(data, random);
      const def = [...data.defs.values()].find((d) => !isGearDef(d) && d.kind === 'agimat' && d.stat === stat);
      if (def && !isGearDef(def)) out.push({ item: newAgimat(data.stats, def, P.agimatLevel, uid()) });
    }
    ticket(data, P.ticketChance, random, uid, out);
  }
  return out;
}

/** A normal Warrens mob's drops: as a Slums mob's (its Kusing from the dungeon, `kusing` round it), but its gear at the
 *  loot's gear level (20). */
export function warrensMobDrops(data: ItemData, W: WarrensData, kind: string, level: number, kusing: number, random: () => number, uid: () => string, plusRandom = random): LootContent[] {
  const out = mobDrops(data, kind, level, random, uid, plusRandom);
  const [lo, hi] = itemStats(data.stats).currencies.kusingPerMobRange ?? [0.6, 1.2];
  out[0] = { kusing: Math.round(kusing * (lo + random() * (hi - lo))) };
  for (const [i, l] of out.entries()) {
    if (!('item' in l) || !isGearDef(data.defs.get(l.item.defId))) continue;
    const kinds = dropGear(data, W.loot.gearLevel);
    if (kinds.length) out[i] = { item: dropped(data, pick(kinds, random), l.item.rarity as GearRarity, uid(), random, plusRandom) };
  }
  return out;
}

/** What a piece of loot is called (for logs and tests). */
export const lootLabel = (l: LootContent): string => ('kusing' in l ? `${l.kusing} Kusing` : `${(l.item as Item).defId}${l.item.count > 1 ? ` ×${l.item.count}` : ''}`);
