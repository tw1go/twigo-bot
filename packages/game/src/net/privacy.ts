import type { PrivacySettings, TownClientMessage } from '@mikazuki/shared';

// 🔒 Your privacy settings (Settings → Privacy; CONTEXT.md Friends-only whispers), as the town's connection last said;
// a change goes out through it and comes back as the settings now.

let state: PrivacySettings | null = null;
let link: { send(m: TownClientMessage): boolean } | null = null;
const listeners = new Set<() => void>();

export function setPrivacyLink(l: { send(m: TownClientMessage): boolean } | null): void {
  link = l;
}

/** Your settings, or null before the town has said (not in town, or logged out). */
export const privacy = (): PrivacySettings | null => state;

export function setPrivacy(p: PrivacySettings): void {
  state = p;
  for (const fn of listeners) fn();
}

export function onPrivacy(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Changes what's given (the server answers with the settings now). */
export const changePrivacy = (change: Partial<PrivacySettings>): boolean => link?.send({ t: 'privacy', ...change }) ?? false;
