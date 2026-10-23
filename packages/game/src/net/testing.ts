import type { TestingSettings, TownClientMessage } from '@mikazuki/shared';

// 🧪 A Game Master's testing switches (Settings → Testing; CONTEXT.md Unkillable), as the town's connection last said
// (it only says so to Game Masters); a change goes out through it and comes back as the switches now.

let state: TestingSettings | null = null;
let link: { send(m: TownClientMessage): boolean } | null = null;
const listeners = new Set<() => void>();

export function setTestingLink(l: { send(m: TownClientMessage): boolean } | null): void {
  link = l;
}

/** Your switches, or null: not a Game Master (or not in town yet). */
export const testing = (): TestingSettings | null => state;

export function setTesting(t: TestingSettings): void {
  state = t;
  for (const fn of listeners) fn();
}

export function onTesting(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Changes what's given (the server answers with the switches now). */
export const changeTesting = (change: Partial<TestingSettings>): boolean => link?.send({ t: 'testing', ...change }) ?? false;
