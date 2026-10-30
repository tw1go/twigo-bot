// 🔄 The desktop app's update, in one place (CONTEXT.md "Update screen"): what the app knows of a newer version of
// itself and how far its install has got. net/desktop.ts moves it (the updater's check, the app's install_update
// command), the title screen (ui/title-screen.ts through BootScene) and the update screen (ui/update-screen.ts) read it.
// Pure: no DOM, no Tauri, so it's tested (update-state.test.ts).

export type UpdateState =
  | { state: 'idle' } // nothing found (or never asked)
  | { state: 'checking' } // asking the updater
  | { state: 'available'; version: string } // a newer version, not started
  | { state: 'downloading'; version: string; got: number; total: number | null } // bytes so far, the whole if known
  | { state: 'installing'; version: string } // downloaded; the app closes and reopens by itself from here
  | { state: 'failed'; version: string; error: string }; // Try again or Download

export type UpdateListener = (s: UpdateState) => void;

/** The state and who's watching it (the listener is called at once with the state as it is). */
export class UpdateStore {
  private s: UpdateState = { state: 'idle' };
  private readonly listeners = new Set<UpdateListener>();

  get(): UpdateState {
    return this.s;
  }

  set(s: UpdateState): void {
    this.s = s;
    for (const l of [...this.listeners]) l(s);
  }

  subscribe(l: UpdateListener): () => void {
    this.listeners.add(l);
    l(this.s);
    return () => void this.listeners.delete(l);
  }
}

export const updateStore = new UpdateStore();

/** What the title screen's button is while the app's update is in this state: Start as ever (nothing found), "Checking
 *  for updates…" (disabled), "Update" (a newer version is known, or its install failed: the old version can't be
 *  started), or "Updating…" (disabled: downloading or installing). */
export function titleButton(s: UpdateState): 'start' | 'checking' | 'update' | 'updating' {
  switch (s.state) {
    case 'idle':
      return 'start';
    case 'checking':
      return 'checking';
    case 'available':
    case 'failed':
      return 'update';
    case 'downloading':
    case 'installing':
      return 'updating';
  }
}

/** How long the title screen waits for the update check before letting the player start anyway (ms). */
export const CHECK_WAIT_MS = 5000;

/** `p`'s answer, or undefined once `ms` have passed without one (the check couldn't tell in time). */
export function within<T>(p: Promise<T>, ms = CHECK_WAIT_MS): Promise<T | undefined> {
  return Promise.race([p, new Promise<undefined>((done) => setTimeout(() => done(undefined), ms))]);
}

/** Whether version a ("v0.1.560", "1.0.0") is newer than b (semver's three numbers; anything odd: false). */
export function newer(a: string, b: string): boolean {
  const n = (v: string) => (/^v?(\d+)\.(\d+)\.(\d+)/.exec(v) ?? []).slice(1).map(Number);
  const [x, y] = [n(a), n(b)];
  if (x.length < 3 || y.length < 3) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** A download's progress for the screen: the percent (null while the size isn't known) and "12.3 / 48.0 MB". */
export function progressOf(got: number, total: number | null): { percent: number | null; text: string } {
  const mb = (n: number) => (n / 1048576).toFixed(1);
  if (!total) return { percent: null, text: `${mb(got)} MB` };
  return { percent: Math.min(100, Math.floor((got * 100) / total)), text: `${mb(Math.min(got, total))} / ${mb(total)} MB` };
}

/** Dev: ?update=fake pretends a newer version (FAKE_VERSION) is out, downloads it slowly and "restarts" with a reload,
 *  so the title screen's lock and the update screen can be tried in a browser or the dev app without a real release;
 *  ?update=fail the same, its download failing half way (the screen's Try again and Download). */
export const fakeUpdate = (): 'fake' | 'fail' | null => {
  if (!import.meta.env.DEV) return null;
  const q = new URLSearchParams(location.search).get('update');
  return q === 'fake' || q === 'fail' ? q : null;
};
export const FAKE_VERSION = 'v9.9.9';

/** "v0.1.560" (the app's versions are shown with a v). */
export const vOf = (version: string): string => (version.startsWith('v') ? version : `v${version}`);
