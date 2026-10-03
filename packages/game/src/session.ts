import type { MeResponse } from '@mikazuki/shared';

// One /me request shared by the HUD and the game. "anon" = not logged in; "off" = login disabled or API down.
export type MeResult = { status: 'ok'; me: MeResponse } | { status: 'anon' } | { status: 'off' };

let cached: Promise<MeResult> | null = null;

export function loadMe(refresh = false): Promise<MeResult> {
  if (!cached || refresh) {
    cached = fetch('/me', { credentials: 'same-origin' })
      .then(async (r): Promise<MeResult> => (r.ok ? { status: 'ok', me: (await r.json()) as MeResponse } : r.status === 401 ? { status: 'anon' } : { status: 'off' }))
      .catch((): MeResult => ({ status: 'off' }));
  }
  return cached;
}
