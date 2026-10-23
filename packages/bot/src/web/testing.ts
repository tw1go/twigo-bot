import type { TestingSettings } from '@mikazuki/shared';
import { kvLoad, kvSave } from '../db/db.js';

// 🧪 A Game Master's testing switches (Settings → Testing; CONTEXT.md Unkillable), kept in kv 'gm-testing:<userId>' so
// they stay on through reloads, map changes and restarts until turned off. Only Game Masters may change them, and they
// only count for one (web/town.ts checks `gm` on arrival and on every change).

export const DEFAULT_TESTING: TestingSettings = { unkillable: false };

const key = (userId: string) => `gm-testing:${userId}`;

export const testingOf = (userId: string): TestingSettings => ({ ...DEFAULT_TESTING, ...kvLoad<Partial<TestingSettings>>(key(userId), {}) });

/** Changes what's given (booleans only) and returns the switches now. */
export function setTesting(userId: string, change: Partial<TestingSettings>): TestingSettings {
  const next = { ...testingOf(userId) };
  if (typeof change.unkillable === 'boolean') next.unkillable = change.unkillable;
  kvSave(key(userId), next);
  return next;
}
