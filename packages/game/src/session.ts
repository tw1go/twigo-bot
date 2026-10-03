import type { MeResponse } from '@mikazuki/shared';

// One /me request shared by the HUD and the game. "anon" = not logged in; "off" = login disabled or API down.
export type MeResult = { status: 'ok'; me: MeResponse } | { status: 'anon' } | { status: 'off' };

let cached: Promise<MeResult> | null = null;

/** Dev only (no local bot needed): ?me=anon | new (logged in, no look yet) | saved (logged in, the look saved in
 *  this browser). Saving a look then stays in this browser. */
export function fakeLogin(): string | null {
  const fake = import.meta.env.DEV ? new URLSearchParams(location.search).get('me') : null;
  return fake === 'anon' || fake === 'new' || fake === 'saved' ? fake : null;
}

function fakeMe(fake: string): MeResult {
  if (fake === 'anon') return { status: 'anon' };
  let outfit: MeResponse['outfit'] = null;
  try {
    if (fake === 'saved') outfit = JSON.parse(localStorage.getItem('mk_outfit') ?? 'null'); // looks.ts LOCAL_KEY
  } catch {
    // no saved look: the creator shows
  }
  return { status: 'ok', me: { id: '0', name: 'Dev tester', avatar: '', kowens: 0, vault: 0, rank: null, items: [], preregistered: false, outfit } };
}

export function loadMe(refresh = false): Promise<MeResult> {
  const fake = fakeLogin();
  if (fake) return Promise.resolve(fakeMe(fake));
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
