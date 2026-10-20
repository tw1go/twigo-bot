import type { KeybindMap } from '@mikazuki/shared';
import { kvLoad, kvSave } from '../db/db.js';

// ⌨️ Members' keybinds (POST /town/keybinds, /me `keybinds`): the actions a member has changed from the defaults, each
// with its two keys, kept in kv 'keybinds:<userId>' so the same keys come back on every device (they lived only in the
// browser before). The game decides what the actions and keys are; the bot keeps the map within bounds
// (`cleanKeybinds`: action ids and key names as the game writes them, two keys each, so many actions at most).

const ACTIONS_MAX = 100;
const ID = /^[a-z][a-zA-Z0-9]{0,39}$/;
const KEY = /^[A-Za-z0-9+]{1,40}$/; // event.code with Ctrl+/Alt+/Shift+ in front (ui/keybinds.ts comboOf)
const key = (userId: string) => `keybinds:${userId}`;

/** The map within bounds, or null when it isn't a map at all. An empty map is the defaults (a reset). */
export function cleanKeybinds(input: unknown): KeybindMap | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out: KeybindMap = {};
  for (const [id, keys] of Object.entries(input as Record<string, unknown>).slice(0, ACTIONS_MAX)) {
    if (!ID.test(id) || !Array.isArray(keys)) continue;
    out[id] = keys.slice(0, 2).map((k) => (typeof k === 'string' && KEY.test(k) ? k : null));
  }
  return out;
}

/** Their keybinds (the changed actions only). */
export const keybindsOf = (userId: string): KeybindMap => kvLoad<KeybindMap>(key(userId), {});

/** Keeps their keybinds (cleaned). Returns what was kept. */
export function saveKeybinds(userId: string, keys: unknown): KeybindMap | null {
  const clean = cleanKeybinds(keys);
  if (!clean) return null;
  kvSave(key(userId), clean);
  return clean;
}
