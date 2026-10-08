import { readFileSync } from 'node:fs';
import type { EquipmentDef, EquipmentFile, StatsData } from '@mikazuki/shared';

// 📊 The game's stats rules data (classes/stats.json: levels, stats, requirements, damage, XP, the mob table) and its
// equipment (items/equipment.json), read like the maps; the rules themselves are @mikazuki/shared's stats module. No
// database here, so the mob room (and the dev server) can use it.

const asset = <T>(path: string): T => JSON.parse(readFileSync(new URL(`../../../game/public/assets/${path}`, import.meta.url), 'utf8')) as T;

let stats: StatsData | null = null;
let gear: Map<string, EquipmentDef> | null = null;

/** classes/stats.json (read once). */
export const loadStats = (): StatsData => (stats ??= asset<StatsData>('classes/stats.json'));

/** items/equipment.json by item id (read once). */
export const loadGear = (): Map<string, EquipmentDef> => (gear ??= new Map(asset<EquipmentFile>('items/equipment.json').items.map((i) => [i.id, i])));
