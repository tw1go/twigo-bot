import { type EquipSlot, type EquipmentDef, type FieldBossLoot, type GearRarity, type ItemData, type Item, type Odds, type SilongData, type WarrensData, agimatSlots, boosted, cascade, gearKind, isGearDef, itemStats, kusingFor, kusingRange, mobStats, nearestGearLevel, newAgimat, newItem, numbersIn, rollGear } from '@mikazuki/shared';
import type { LootContent } from './combat-bag.js';

// 🎲 What a kill drops, rolled on the server by stats.json (rarity.mobGearDrop and bossGearDrop, potions, currencies,
// bossLoot; combat-guide.md "Death, parties and loot"): every mob drops Kusing (a whole number in 0.6–1.2 × round(100 ×
// 1.08^(level − 1)), currencies.kusingPerMobRange: a Tin Can 60–120); about 3%
// of kills a weapon or armor piece for a random class or gear type at the map's gear level (Wire Tangle and Scrap Crab
// sometimes Lv 20), brown, white or grey with no lines; about 5% a potion of the map's tier (HP or MP). The Scrapheap
// Golem gives everyone who did 5% of its HP their own loot: its Kusing, Rough Whetstones, 1–2 blue or orange gear pieces
// (lines rolled), now and then an accessory, an agimat and, rarely, the Lamp-head Hat. Every dropped piece of gear comes
// with a plus of +0 to +3 (rarity.dropPlus). Every pick of a tier (a rarity, a plus, a level, an affix, slots) is a
// cascade (CONTEXT.md Cascade; shared cascade.ts): the best tier tried first with the table's own odds, down to the
// floor. `boost` is the earner's Drop rate (CONTEXT.md; stats.json rarity.cascade, `dropBoost`): it raises every chance
// but a floor's and every chance of an extra item (gear or a potion at all, an accessory, agimat, hat, ticket), never
// amounts. Pure: `random` and `uid` come in (`plusRandom`: the plus's own, for the dev town's rich loot; the same
// `random` otherwise).

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

/** An odds table as a cascade: its tiers best first. Rarities by the game's order (stats.json rarity.nameColour: brown …
 *  darkOrange), an affix orange over blue, numbers (a level, a plus, slots) the higher first. */
function bestFirst(data: ItemData, odds: Record<string, number>): [string, number][] {
  const order = Object.keys((itemStats(data.stats).rarity as { nameColour: Record<string, unknown> }).nameColour);
  const rank = (k: string) => (/^\d+$/.test(k) ? Number(k) : k === 'orange' ? 1 : k === 'blue' ? 0 : order.indexOf(k));
  return Object.entries(odds).filter((e): e is [string, number] => typeof e[1] === 'number').sort(([a], [b]) => rank(b) - rank(a));
}
/** One tier from an odds table, best first; `boost` (Drop rate) favours the better ones. */
const tier = (data: ItemData, odds: Record<string, number>, random: () => number, boost = 0): string => cascade(bestFirst(data, odds), random, boost);

/** A Drop rate (the stat, a fraction) as the cascades' boost: × stats.json rarity.cascade.dropRate.perChance. */
export function dropBoost(data: ItemData, dropRate: number): number {
  const per = (itemStats(data.stats).rarity as { cascade?: { dropRate?: { perChance?: number } } }).cascade?.dropRate?.perChance ?? 1;
  return Math.max(0, dropRate) * per;
}

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
export function dropLevel(data: ItemData, kind: string, random: () => number, boost = 0): number {
  const L = itemStats(data.stats).rarity.mobGearDrop.level;
  const own = L[kind];
  if (own && typeof own === 'object') return Number(tier(data, own as Record<string, number>, random, boost));
  return numbersIn(String(L.default))[0] ?? 1;
}

/** A dropped piece's plus, +0 to +3 by stats.json rarity.dropPlus (its number keys; never more than +3): a cascade,
 *  +3 tried first. */
export function dropPlus(data: ItemData, random: () => number, boost = 0): number {
  const odds = Object.entries(itemStats(data.stats).rarity.dropPlus ?? {}).flatMap(([k, w]): [number, number][] =>
    /^\d+$/.test(k) && typeof w === 'number' ? [[Math.min(3, Number(k)), w]] : [],
  );
  return odds.length ? cascade(odds.sort(([a], [b]) => b - a), random, boost) : 0;
}

/** A piece of gear as it drops: rolled at its rarity, with its plus. */
const dropped = (data: ItemData, def: EquipmentDef, rarity: GearRarity, uid: string, random: () => number, plusRandom: () => number, boost = 0): Item => {
  const item = rollGear(data.stats, def, rarity, uid, random);
  item.plus = dropPlus(data, plusRandom, boost);
  return item;
};

/** A normal mob's drops: Kusing always (a random amount round its level's), now and then gear (brown, white or grey, +0 to +3) or an HP or MP Potion. */
export function mobDrops(data: ItemData, kind: string, level: number, random: () => number, uid: () => string, plusRandom = random, boost = 0, area?: string): LootContent[] {
  const S = itemStats(data.stats);
  const out: LootContent[] = [{ kusing: between(kusingRange(data.stats, level), random) }];
  const G = S.rarity.mobGearDrop;
  // A map with drops of its own (stats.json drops.<map>: the Palengke's Lv 30 gear, Lv 40 from some kinds, Medium potions).
  const A = area ? S.drops?.[area] : undefined;
  const higher = A?.lv40Chance?.[kind] ?? 0;
  if (random() < boosted(A?.gearChance ?? G.chancePerKill, boost)) {
    const gearLevel = A ? (higher ? cascade<number>([[40, higher], [A.gearLevel, 1 - higher]], random, boost) : A.gearLevel) : dropLevel(data, kind, random, boost);
    const kinds = dropGear(data, gearLevel);
    if (kinds.length) {
      const rarity = tier(data, G.odds, random, boost) as GearRarity;
      out.push({ item: dropped(data, pick(kinds, random), rarity, uid(), random, plusRandom, boost) });
    }
  }
  if (random() < boosted(A?.potionChance ?? S.potions.mobDropChance, boost)) {
    const potionTier = A?.potionTier ?? tierAt(data, dropLevel(data, 'default', random, boost));
    const potions = [...data.defs.values()].filter((d) => !isGearDef(d) && d.kind === 'potion' && d.tier === potionTier);
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
  boost = 0,
): LootContent[] {
  const S = itemStats(data.stats);
  const mob = mobStats(data.stats, kind)?.level ?? level;
  const out: LootContent[] = [{ kusing: between(kusingRange(data.stats, mob), random) * rules.kusingTimes }];
  const levels = [...new Set([...data.defs.values()].filter((d): d is EquipmentDef => isGearDef(d) && !d.training && gearKind(d.slot) !== 'accessory').map((d) => d.level))];
  const gearLevel = nearestGearLevel(levels, level);
  for (let n = rules.gearPieces; n > 0; n--) {
    const kinds = dropGear(data, gearLevel);
    if (!kinds.length) break;
    const rarity = tier(data, S.rarity.mobGearDrop.odds, random, boost) as GearRarity;
    out.push({ item: dropped(data, pick(kinds, random), rarity, uid(), random, plusRandom, boost) });
  }
  if (random() < boosted(rules.fragmentChance, boost)) {
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
export function golemLoot(data: ItemData, random: () => number, uid: () => string, plusRandom = random, ticketChance = 0, boost = 0): LootContent[] {
  return fieldBossLoot(data, itemStats(data.stats).bossLoot.perEligiblePlayer, random, uid, plusRandom, ticketChance, boost);
}

/** A field boss's loot table by its kind: the Great Scale's (stats.json bossLoot.greatScale), else the golem's. */
export function fieldBossTable(data: ItemData, kind: string): FieldBossLoot {
  const B = itemStats(data.stats).bossLoot;
  return (kind === 'great-scale' && B.greatScale?.perEligiblePlayer) || B.perEligiblePlayer;
}

/** A field boss's loot for one player who earned it (a FieldBossLoot table): its Kusing, its tier's whetstones (Rough, or
 *  Polished for the Great Scale), 1-2 affix gear pieces at its levels (its own `gearLevel` and `affix`, else
 *  rarity.bossGearDrop's), now and then an accessory, an agimat, the Lamp-head Hat (the golem's) and a Mid Repair Kit
 *  (the Great Scale's); `ticketChance`: a Warren Ticket that often too. */
export function fieldBossLoot(data: ItemData, P: FieldBossLoot, random: () => number, uid: () => string, plusRandom = random, ticketChance = 0, boost = 0, key?: { id: string; chance: number }): LootContent[] {
  const S = itemStats(data.stats);
  const B = S.rarity.bossGearDrop;
  const out: LootContent[] = [{ kusing: P.kusing }];
  const [stoneTier, stones]: [string, [number, number]] = P.polishedWhetstones ? ['mid', P.polishedWhetstones] : ['low', P.roughWhetstones ?? [0, 0]];
  const whetstone = [...data.defs.values()].find((d) => !isGearDef(d) && d.shop === 'whetstone' && d.tier === stoneTier);
  if (whetstone && stones[1] > 0) out.push({ item: newItem(data.stats, whetstone, uid(), between(stones, random)) });
  const level = () => Number(tier(data, P.gearLevel ?? B.level, random, boost));
  const affix = () => tier(data, P.affix ?? B.affix, random, boost) as 'blue' | 'orange';
  const colour = (t: 'blue' | 'orange', slots: number): GearRarity => `${slots >= 2 ? 'dark' : 'light'}${t === 'blue' ? 'Blue' : 'Orange'}` as GearRarity;
  for (let n = between(P.gearPieces, random); n > 0; n--) {
    const kinds = dropGear(data, level());
    const slots = Number(tier(data, B.slots, random, boost));
    if (kinds.length) out.push({ item: dropped(data, pick(kinds, random), colour(affix(), slots), uid(), random, plusRandom, boost) });
  }
  if (random() < boosted(P.accessoryChance, boost)) {
    const kinds = dropGear(data, level(), true);
    if (kinds.length) out.push({ item: dropped(data, pick(kinds, random), colour(affix(), 1), uid(), random, plusRandom, boost) });
  }
  if (random() < boosted(P.agimatChance, boost)) {
    const stat = rollAgimatStat(data, random);
    const def = [...data.defs.values()].find((d) => !isGearDef(d) && d.kind === 'agimat' && d.stat === stat);
    if (def && !isGearDef(def)) out.push({ item: newAgimat(data.stats, def, pick(P.agimatLevels, random), uid()) });
  }
  if (P.lampHatChance && random() < boosted(P.lampHatChance, boost)) {
    const hat = data.defs.get('lamp-hat');
    if (hat) out.push({ item: newItem(data.stats, hat, uid()) });
  }
  if (P.midRepairKitChance && random() < boosted(P.midRepairKitChance, boost)) {
    const kit = [...data.defs.values()].find((d) => !isGearDef(d) && d.forge === 'repairKit' && d.tier === 'mid');
    if (kit) out.push({ item: newItem(data.stats, kit, uid()) });
  }
  ticket(data, ticketChance, random, uid, out, boost);
  // (The Great Scale's: a Susi ng Silong now and then.)
  if (key) ticket(data, key.chance, random, uid, out, boost, key.id);
  return out;
}

// ── The Scrap Warrens (classes/dungeons.json warrens.loot) ──

/** A Warren Ticket (or another item: `id`), `chance` of the time (Drop rate raises it). */
function ticket(data: ItemData, chance: number, random: () => number, uid: () => string, out: LootContent[], boost = 0, id = 'warren-ticket'): void {
  const def = data.defs.get(id);
  if (def && chance > 0 && random() < boosted(chance, boost)) out.push({ item: newItem(data.stats, def, uid()) });
}

/** One pick by odds ({ blue: 0.8, orange: 0.2 }): a cascade, the better first. */
const byOdds = (data: ItemData, odds: Odds, random: () => number, boost = 0) => tier(data, odds, random, boost);

/** A blue or orange rarity by its odds and its slot count (1: light, 2: dark). */
const affixColour = (data: ItemData, affix: Odds, slots: Odds, random: () => number, boost = 0): GearRarity => {
  const t = byOdds(data, affix, random, boost);
  const n = Number(byOdds(data, slots, random, boost));
  return `${n >= 2 ? 'dark' : 'light'}${t === 'orange' ? 'Orange' : 'Blue'}` as GearRarity;
};

/** Weapons and armor of a level for a class (its own weapon, its gear type's armor); any class's when it has none. */
function classGear(data: ItemData, level: number, cls: string | null): EquipmentDef[] {
  const all = dropGear(data, level);
  const gearType = cls ? data.stats.classes[cls]?.gearType : undefined;
  const mine = cls ? all.filter((d) => (d.class ? d.class === cls : !!gearType && d.gear?.toLowerCase() === gearType.toLowerCase())) : [];
  return mine.length ? mine : all;
}

/** The Rough Whetstones (or a tier's: Polished, 'mid') `n` of them. */
const whetstones = (data: ItemData, n: number, uid: () => string, tierId = 'low'): LootContent | null => {
  const def = [...data.defs.values()].find((d) => !isGearDef(d) && d.shop === 'whetstone' && d.tier === tierId);
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
  boost = 0,
): LootContent[] {
  const R = W.loot.miniBoss.roll;
  const out: LootContent[] = boss.kusingPile ? [{ kusing: boss.kusingPile }] : [];
  const cls = () => pick(classes.length ? classes : [null], random);
  for (let n = 0; n < Math.max(1, players); n++) {
    // Affix, plain or unlucky: a cascade (affix tried first; Drop rate favours the first two).
    const roll = cascade<'affix' | 'plain' | 'unlucky'>([['affix', R.affix.chance], ['plain', R.plain.chance], ['unlucky', Math.max(0, 1 - R.affix.chance - R.plain.chance)]], random, boost);
    if (roll !== 'unlucky') {
      const kinds = classGear(data, W.loot.gearLevel, cls());
      if (!kinds.length) continue;
      const rarity = roll === 'affix' ? affixColour(data, R.affix.affix, R.affix.slots, random, boost) : (byOdds(data, R.plain.colour, random, boost) as GearRarity);
      out.push({ item: dropped(data, pick(kinds, random), rarity, uid(), random, plusRandom, boost) });
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
export function warrensBossLoot(data: ItemData, W: WarrensData, classes: (string | null)[], players: number, random: () => number, uid: () => string, plusRandom = random, boost = 0): LootContent[] {
  const P = W.loot.lastBoss.perPlayerInside;
  const out: LootContent[] = [];
  const cls = () => pick(classes.length ? classes : [null], random);
  for (let n = 0; n < Math.max(1, players); n++) {
    for (let k = 0; k < P.affixGear; k++) {
      const kinds = classGear(data, W.loot.gearLevel, cls());
      if (kinds.length) out.push({ item: dropped(data, pick(kinds, random), affixColour(data, P.affix, P.slots, random, boost), uid(), random, plusRandom, boost) });
    }
    for (let k = 0; k < P.accessories; k++) {
      const kinds = dropGear(data, P.accessoryLevel, true);
      if (kinds.length) out.push({ item: dropped(data, pick(kinds, random), affixColour(data, P.accessoryAffix, { 1: 1 }, random, boost), uid(), random, plusRandom, boost) });
    }
    out.push({ kusing: P.kusing });
    const stones = whetstones(data, between(P.roughWhetstones, random), uid);
    if (stones) out.push(stones);
    if (random() < boosted(P.agimatChance, boost)) {
      const stat = rollAgimatStat(data, random);
      const def = [...data.defs.values()].find((d) => !isGearDef(d) && d.kind === 'agimat' && d.stat === stat);
      if (def && !isGearDef(def)) out.push({ item: newAgimat(data.stats, def, P.agimatLevel, uid()) });
    }
    ticket(data, P.ticketChance, random, uid, out, boost);
  }
  return out;
}

/** A normal Warrens mob's drops: as a Slums mob's (its Kusing from the dungeon, `kusing` round it), but its gear at the
 *  loot's gear level (20). */
export function warrensMobDrops(data: ItemData, W: WarrensData, kind: string, level: number, kusing: number, random: () => number, uid: () => string, plusRandom = random, boost = 0): LootContent[] {
  const out = mobDrops(data, kind, level, random, uid, plusRandom, boost);
  const [lo, hi] = itemStats(data.stats).currencies.kusingPerMobRange ?? [0.6, 1.2];
  out[0] = { kusing: Math.round(kusing * (lo + random() * (hi - lo))) };
  for (const [i, l] of out.entries()) {
    if (!('item' in l) || !isGearDef(data.defs.get(l.item.defId))) continue;
    const kinds = dropGear(data, W.loot.gearLevel);
    if (kinds.length) out[i] = { item: dropped(data, pick(kinds, random), l.item.rarity as GearRarity, uid(), random, plusRandom, boost) };
  }
  return out;
}

// ── Ang Silong (classes/dungeons.json silong.loot): the Warrens' a tier up ──

/** A Silong mini boss's loot (silong.loot.miniBoss): its Kusing pile, then a roll for each player inside — an affix item
 *  (blue or orange; its slots by rarity.bossGearDrop), a plain one (white or grey), or unlucky (3 × its level's Kusing and
 *  a few Polished Whetstones). Gear at Lv 40 for a class picked from `classes` (the players inside). */
export function silongMiniLoot(data: ItemData, S: SilongData, boss: { level: number; kusingPile?: number }, classes: (string | null)[], players: number, random: () => number, uid: () => string, plusRandom = random, boost = 0): LootContent[] {
  const R = S.loot.miniBoss.roll;
  const slots = itemStats(data.stats).rarity.bossGearDrop.slots;
  const out: LootContent[] = boss.kusingPile ? [{ kusing: boss.kusingPile }] : [];
  const cls = () => pick(classes.length ? classes : [null], random);
  for (let n = 0; n < Math.max(1, players); n++) {
    const roll = cascade<'affix' | 'plain' | 'unlucky'>([['affix', R.affix.chance], ['plain', R.plain.chance], ['unlucky', Math.max(0, 1 - R.affix.chance - R.plain.chance)]], random, boost);
    if (roll !== 'unlucky') {
      const kinds = classGear(data, S.loot.gearLevel, cls());
      if (!kinds.length) continue;
      const rarity = roll === 'affix' ? affixColour(data, R.affix.affix, slots, random, boost) : (byOdds(data, R.plain.colour, random, boost) as GearRarity);
      out.push({ item: dropped(data, pick(kinds, random), rarity, uid(), random, plusRandom, boost) });
      continue;
    }
    out.push({ kusing: R.unlucky.kusingTimes * kusingFor(data.stats, boss.level) });
    const stones = whetstones(data, between(R.unlucky.polishedWhetstones, random), uid, 'mid');
    if (stones) out.push(stones);
  }
  return out;
}

/** Ang Makinang Yelo's loot (silong.loot.lastBoss), for each player inside: affix gear (Lv 40, a class from `classes`),
 *  Lv 40 accessories, 50,000 Kusing, Polished Whetstones, now and then a Lv 40 agimat and a Susi ng Silong. No cosmetic. */
export function silongBossLoot(data: ItemData, S: SilongData, classes: (string | null)[], players: number, random: () => number, uid: () => string, plusRandom = random, boost = 0): LootContent[] {
  const P = S.loot.lastBoss.perPlayerInside;
  const slots = itemStats(data.stats).rarity.bossGearDrop.slots;
  const out: LootContent[] = [];
  const cls = () => pick(classes.length ? classes : [null], random);
  for (let n = 0; n < Math.max(1, players); n++) {
    for (let k = 0; k < P.affixGear; k++) {
      const kinds = classGear(data, S.loot.gearLevel, cls());
      if (kinds.length) out.push({ item: dropped(data, pick(kinds, random), affixColour(data, P.affix, slots, random, boost), uid(), random, plusRandom, boost) });
    }
    for (let k = 0; k < P.accessories; k++) {
      const kinds = dropGear(data, P.accessoryLevel, true);
      if (kinds.length) out.push({ item: dropped(data, pick(kinds, random), affixColour(data, P.affix, { 1: 1 }, random, boost), uid(), random, plusRandom, boost) });
    }
    out.push({ kusing: P.kusing });
    const stones = whetstones(data, between(P.polishedWhetstones, random), uid, 'mid');
    if (stones) out.push(stones);
    if (random() < boosted(P.agimatChance, boost)) {
      const stat = rollAgimatStat(data, random);
      const def = [...data.defs.values()].find((d) => !isGearDef(d) && d.kind === 'agimat' && d.stat === stat);
      if (def && !isGearDef(def)) out.push({ item: newAgimat(data.stats, def, P.agimatLevel, uid()) });
    }
    ticket(data, P.keyChance, random, uid, out, boost, S.key.id);
  }
  return out;
}

/** A Silong room mob's drops: a Palengke mob's (its potions; its gear chance unless silong.loot.mobGearChance says),
 *  its Kusing from its room's `kusing`, its gear at the loot's level (40). */
export function silongMobDrops(data: ItemData, S: SilongData, kind: string, level: number, kusing: number, random: () => number, uid: () => string, plusRandom = random, boost = 0): LootContent[] {
  const out = mobDrops(data, kind, level, random, uid, plusRandom, boost, 'palengke');
  // The Cellar's own gear chance (higher than the Old Market's): its roll in place of the map's.
  const G = S.loot.mobGearChance;
  if (G !== undefined) {
    const at = out.findIndex((l) => 'item' in l && isGearDef(data.defs.get(l.item.defId)));
    if (at >= 0) out.splice(at, 1);
    if (random() < boosted(G, boost)) {
      const kinds = dropGear(data, S.loot.gearLevel);
      if (kinds.length) out.push({ item: dropped(data, pick(kinds, random), tier(data, itemStats(data.stats).rarity.mobGearDrop.odds, random, boost) as GearRarity, uid(), random, plusRandom, boost) });
    }
  }
  const [lo, hi] = itemStats(data.stats).currencies.kusingPerMobRange ?? [0.6, 1.2];
  out[0] = { kusing: Math.round(kusing * (lo + random() * (hi - lo))) };
  for (const [i, l] of out.entries()) {
    if (!('item' in l) || !isGearDef(data.defs.get(l.item.defId))) continue;
    const kinds = dropGear(data, S.loot.gearLevel);
    if (kinds.length) out[i] = { item: dropped(data, pick(kinds, random), l.item.rarity as GearRarity, uid(), random, plusRandom, boost) };
  }
  return out;
}

/** What a piece of loot is called (for logs and tests). */
export const lootLabel = (l: LootContent): string =>
  'kusing' in l ? `${l.kusing} Kusing` : 'kowens' in l ? `${l.kowens} Kowens` : 'potion' in l ? `potion ${l.potion}` : `${(l.item as Item).defId}${l.item.count > 1 ? ` ×${l.item.count}` : ''}`;
