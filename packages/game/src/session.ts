import type { MeResponse, PresenceStatus } from '@mikazuki/shared';

// One /me request shared by the HUD and the game. "anon" = not logged in; "off" = login disabled or API down.
export type MeResult = { status: 'ok'; me: MeResponse } | { status: 'anon' } | { status: 'off' };

let cached: Promise<MeResult> | null = null;

/** Dev only (no local bot needed): ?me=anon | new (logged in, no look or nickname yet) | saved (logged in, the look
 *  saved in this browser; also what dev falls back to when no bot answers /me). Saving a look then stays in this
 *  browser. Test values: ?kowens= ?shovels= ?digs= ?status= ?lucky= (the server's digs toward the lucky dig). */
export function fakeLogin(): string | null {
  const fake = import.meta.env.DEV ? new URLSearchParams(location.search).get('me') : null;
  if (fake === 'anon' || fake === 'new' || fake === 'saved') return fake;
  return noBot ? 'saved' : null;
}

/** Dev only: no bot answered /me (the usual dev setup), so the fake login stands in as ?me=saved. */
let noBot = false;

/** Dev only: a number from the address (?kowens=500), or `fallback`. */
const devNumber = (key: string, fallback: number) => {
  const n = Number(new URLSearchParams(location.search).get(key));
  return Number.isFinite(n) && new URLSearchParams(location.search).has(key) ? Math.max(0, Math.floor(n)) : fallback;
};

/** Dev only: the fake member's name (?as=Name lets two browsers be two people). */
export function fakeName(): string {
  return new URLSearchParams(location.search).get('as')?.slice(0, 16) || 'Dev tester';
}

/** Dev only: ?status=online|idle|busy|offline|jailed (online by default). */
function fakeStatus(): PresenceStatus {
  const s = new URLSearchParams(location.search).get('status');
  return s === 'idle' || s === 'busy' || s === 'offline' || s === 'jailed' ? s : 'online';
}

function fakeMe(fake: string): MeResult {
  if (fake === 'anon') return { status: 'anon' };
  let outfit: MeResponse['outfit'] = null;
  try {
    if (fake === 'saved') outfit = JSON.parse(localStorage.getItem('mk_outfit') ?? 'null'); // looks.ts LOCAL_KEY
  } catch {
    // no saved look: the creator shows
  }
  return { status: 'ok', me: { id: '0', name: fakeName(), avatar: '', kowens: devNumber('kowens', 1250), vault: 0, rank: null, items: [], preregistered: false, outfit, nickname: fake === 'saved' ? fakeName() : null, title: { name: 'Townfolk', color: '#B794F6' },
      newTitle: null,
      welcomeGift: new URLSearchParams(location.search).has('welcome') ? 50 : null, // dev: &welcome=1 shows the welcome gift
      house: new URLSearchParams(location.search).has('house'), // dev: &house=1 starts you at your door in the neighbourhood
      tester: new URLSearchParams(location.search).get('tester') !== '0', // dev: &tester=0 = without the Tester role
      dig: { shovel: devNumber('shovels', 6), digsLeft: devNumber('digs', 7), digsPerDay: 9, shovelsLeft: 2, shovelCost: 2, shovelUses: 3, lucky: devNumber('lucky', 57), luckyEvery: 60 },
      status: fakeStatus() } };
}

export function loadMe(refresh = false): Promise<MeResult> {
  const fake = fakeLogin();
  if (fake) return Promise.resolve(fakeMe(fake));
  if (!cached || refresh) {
    cached = fetch('/me', { credentials: 'same-origin' })
      .then(async (r): Promise<MeResult> => (r.ok ? { status: 'ok', me: (await r.json()) as MeResponse } : r.status === 401 ? { status: 'anon' } : { status: 'off' }))
      .catch((): MeResult => ({ status: 'off' }))
      .then((me) => {
        if (me.status !== 'off' || !import.meta.env.DEV) return me;
        noBot = true;
        return fakeMe('saved');
      });
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
