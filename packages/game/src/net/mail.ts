import type { TownMailAction, TownMailActionResponse, TownMailResponse } from '@mikazuki/shared';
import { api } from './endpoints';

// ✉️ The mailbox (the bot's GET/POST /town/mail; the dev town answers the same with pretend mail): fetched as the window
// opens, and how many aren't opened yet for the HUD's mail button (from /me, then the town's `mail` messages).

let unread = 0;
const listeners = new Set<(n: number) => void>();

export const unreadMail = () => unread;

/** The unread count changed (from /me, a `mail` message, or the window). */
export function setUnreadMail(n: number): void {
  if (n === unread) return;
  unread = Math.max(0, n);
  for (const f of listeners) f(unread);
}

export function onUnreadMail(f: (n: number) => void): () => void {
  listeners.add(f);
  f(unread);
  return () => listeners.delete(f);
}

export async function loadMail(): Promise<TownMailResponse | null> {
  try {
    const r = await api('/town/mail', { credentials: 'same-origin' });
    if (!r.ok) return null;
    const m = (await r.json()) as TownMailResponse;
    setUnreadMail(m.unread);
    return m;
  } catch {
    return null;
  }
}

export async function mailAction(a: TownMailAction): Promise<TownMailActionResponse | null> {
  try {
    const r = await api('/town/mail', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) });
    if (!r.ok) return null;
    const m = (await r.json()) as TownMailActionResponse;
    setUnreadMail(m.unread);
    return m;
  } catch {
    return null;
  }
}
