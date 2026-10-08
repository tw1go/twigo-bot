import { readFileSync } from 'node:fs';
import type { AnyItemDef, CombatItemsFile, EquipmentDef, EquipmentFile, ItemData, StatsData } from '@mikazuki/shared';

// 📊 The game's stats rules data (classes/stats.json: levels, stats, requirements, damage, XP, the mob table, items' rolls)
// and its item kinds (items/equipment.json: gear; items/items.json: whetstones, potions, agimats…), read like the maps;
// the rules themselves are @mikazuki/shared's stats and items modules. No database here, so the mob room (and the dev
// server) can use it.

const asset = <T>(path: string): T => JSON.parse(readFileSync(new URL(`../../../game/public/assets/${path}`, import.meta.url), 'utf8')) as T;

let stats: StatsData | null = null;
let gear: Map<string, EquipmentDef> | null = null;
let items: ItemData | null = null;

/** classes/stats.json (read once). */
export const loadStats = (): StatsData => (stats ??= asset<StatsData>('classes/stats.json'));

/** items/equipment.json by item id (read once). */
export const loadGear = (): Map<string, EquipmentDef> => (gear ??= new Map(asset<EquipmentFile>('items/equipment.json').items.map((i) => [i.id, i])));

/** Every item kind (gear and the rest) by id, with the stats rules (read once). */
export function loadItemData(): ItemData {
  if (items) return items;
  const defs = new Map<string, AnyItemDef>(loadGear());
  for (const i of asset<CombatItemsFile>('items/items.json').items) defs.set(i.id, i);
  return (items = { stats: loadStats(), defs });
}
