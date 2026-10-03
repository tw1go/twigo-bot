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

const PROBLEMS: Record<string, string> = {
  'not-member': 'Only members of the Mikazuki server can log in.',
  failed: "Couldn't log in. Try again?",
};
let problem: string | null | undefined;

/** ?login=… comes back from a failed or cancelled login: read once, then tidied out of the address bar. */
export function loginProblem(): string | null {
  if (problem === undefined) {
    const url = new URL(location.href);
    problem = PROBLEMS[url.searchParams.get('login') ?? ''] ?? null;
    if (url.searchParams.has('login')) {
      url.searchParams.delete('login');
      history.replaceState(null, '', url.pathname + url.search);
    }
  }
  return problem;
}
