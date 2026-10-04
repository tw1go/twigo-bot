import { kvLoad, kvSave } from '../db/db.js';

// 🛡️ Town chat moderation: mutes (no chatting in town for a while), kicks (out of the town and kept out for a while)
// and a word filter (matches become ***). Set with /town by mods; kept in the bot's database (kv
// 'town-moderation'), so deploys don't lift them. The blocked words live only there, never in the code.

interface Timed {
  until: number; // ms
  reason?: string;
}

interface ModState {
  mutes: Record<string, Timed>;
  kicks: Record<string, Timed>;
  words: string[];
}

const KEY = 'town-moderation';
const state = kvLoad<ModState>(KEY, { mutes: {}, kicks: {}, words: [] });
state.mutes ??= {};
state.kicks ??= {};
state.words ??= [];
const save = () => kvSave(KEY, state);

/** When a timed entry runs out, it's dropped. */
function current(list: Record<string, Timed>, userId: string): Timed | null {
  const t = list[userId];
  if (!t) return null;
  if (t.until > Date.now()) return t;
  delete list[userId];
  save();
  return null;
}

export const mutedUntil = (userId: string): number | null => current(state.mutes, userId)?.until ?? null;
export const kickedUntil = (userId: string): number | null => current(state.kicks, userId)?.until ?? null;

export function mute(userId: string, minutes: number, reason?: string): number {
  const until = Date.now() + minutes * 60_000;
  state.mutes[userId] = { until, reason };
  save();
  return until;
}

export function unmute(userId: string): boolean {
  const had = !!current(state.mutes, userId);
  delete state.mutes[userId];
  save();
  return had;
}

export function kick(userId: string, minutes: number, reason?: string): number {
  const until = Date.now() + minutes * 60_000;
  state.kicks[userId] = { until, reason };
  save();
  return until;
}

// ── The word filter ──

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let pattern: RegExp | null = null;

/** One pattern for all words: whole words only (so "class" isn't caught by "ass"), letters may repeat ("heeey"). */
function build(): void {
  const parts = state.words.map((w) => [...w].map((ch) => `${escape(ch)}+`).join(''));
  pattern = parts.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${parts.join('|')})(?![\\p{L}\\p{N}])`, 'giu') : null;
}
build();

/** The text with blocked words replaced by asterisks. */
export function filterText(text: string): string {
  return pattern ? text.replace(pattern, (m) => '*'.repeat([...m].length)) : text;
}

const clean = (word: string) => word.trim().toLowerCase().slice(0, 32);

export function addWord(word: string): boolean {
  const w = clean(word);
  if (!w || state.words.includes(w)) return false;
  state.words.push(w);
  save();
  build();
  return true;
}

export function removeWord(word: string): boolean {
  const w = clean(word);
  const before = state.words.length;
  state.words = state.words.filter((x) => x !== w);
  save();
  build();
  return state.words.length < before;
}

export const blockedWords = (): string[] => [...state.words];
