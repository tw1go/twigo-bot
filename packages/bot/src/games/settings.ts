import { kvLoad, kvSave } from '../db/db.js';

// ⚙️ Reward amounts the CMS can change without a deploy (its Rewards tab). Each has its code default here; the CMS keeps
// only what it changed (kv 'settings', key → number), and clearing one goes back to the default. Read them when they're
// used (never keep a copy), so a change counts at once.

export interface SettingDef {
  group: string;
  label: string;
  /** What the number means, shown under it. */
  help: string;
  default: number;
  min: number;
  max: number;
}

export const SETTINGS = {
  'minewars-attend': { group: 'Mine Wars (9 PM, /gift minewars)', label: 'Attending', help: 'Kowens for each member who attended', default: 2, min: 0, max: 1000 },
  'minewars-top': { group: 'Mine Wars (9 PM, /gift minewars)', label: 'Top 10', help: 'Kowens in total for a Top 10 finish (counts as attending)', default: 3, min: 0, max: 1000 },
  'daily-kowens': { group: 'Daily Kowens', label: 'Daily claim', help: 'Kowens for /get-kowens or the town\'s daily claim, once a day (doubled on Christmas)', default: 5, min: 0, max: 1000 },
  'welcome-gift': { group: 'Welcome gift', label: 'Welcome gift', help: 'Kowens each new player gets once they finish their character', default: 50, min: 0, max: 10_000 },
  'stay-minutes': { group: 'Staying in town', label: 'Minutes per Kowen', help: 'Minutes in the web town for each Kowen to claim', default: 15, min: 1, max: 240 },
  'stay-cap': { group: 'Staying in town', label: 'Most a day', help: 'The most stay Kowens a member can claim in a day', default: 20, min: 0, max: 1000 },
} satisfies Record<string, SettingDef>;

export type SettingKey = keyof typeof SETTINGS;

const KEY = 'settings';
let changed = kvLoad<Partial<Record<SettingKey, number>>>(KEY, {});

export const isSettingKey = (k: string): k is SettingKey => k in SETTINGS;

/** A setting's value now: the CMS's, else the code's default. */
export const setting = (key: SettingKey): number => changed[key] ?? SETTINGS[key].default;

/** Sets a setting (null: back to the default). False if the value is out of range. */
export function setSetting(key: SettingKey, value: number | null): boolean {
  const def = SETTINGS[key];
  if (value !== null && (!Number.isInteger(value) || value < def.min || value > def.max)) return false;
  const { [key]: _, ...rest } = changed;
  changed = value === null || value === def.default ? rest : { ...rest, [key]: value };
  kvSave(KEY, changed);
  return true;
}

/** Every setting as the CMS shows it. */
export const settingList = () =>
  (Object.entries(SETTINGS) as [SettingKey, SettingDef][]).map(([key, d]) => ({ key, ...d, value: setting(key), custom: changed[key] !== undefined }));
