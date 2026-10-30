import { onOpenUrl, getCurrent } from '@tauri-apps/plugin-deep-link';
import { openUrl } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { exit } from '@tauri-apps/plugin-process';
import { type Update, check } from '@tauri-apps/plugin-updater';
import { api, setAppToken } from './endpoints';
import { notifyDownload, notifyUpdate } from '../ui/version';
import { inGame } from './pwa';
import { FAKE_VERSION, type UpdateState, fakeUpdate, newer, updateStore, within } from './update-state';
import { hideUpdateScreen, showUpdateScreen } from '../ui/update-screen';
import { startWindow, toggleFullscreen } from './window-mode';

// 🖥️ The desktop app's own parts (packages/desktop, Tauri 2): only ever loaded inside it (net/platform.ts isDesktopApp),
// so the website never downloads them.
// - Logging in: "Log in with Discord" opens the system browser at twigo.dev/auth/login?client=desktop; once Discord says
//   yes the server sends the browser to mikazuki://auth?code=… (the app's own link: Tauri's deep-link plugin), and the
//   app swaps the code at POST /auth/exchange for its session token (kept in its storage: net/endpoints.ts), then reloads
//   logged in. mikazuki://auth?error=… says why not.
// - The window: Settings → Display → Window (net/window-mode.ts), applied as it opens; F11 (Windows) or Ctrl+Cmd+F
//   (Mac) swaps Full screen and the last other mode.
// - Updates (CONTEXT.md "Update screen"; the state in net/update-state.ts's store): the title screen asks `checkUpdate`
//   before it offers Start (BootScene; "Checking for updates…" CHECK_WAIT_MS at most, then "Update" if a newer version is
//   known: an old version can't be started), and an open app asks every minute after; a newer version found in the game
//   is only the notice "A new version of Mikazuki is ready … it installs the next time you open Mikazuki" with Update now
//   (never a restart mid-game). `startUpdate` shows the update screen (ui/update-screen.ts) and runs the app's own
//   `install_update` command (lib.rs): the download's progress, "Installing…", then the app closes and reopens by itself
//   (Windows) or restarts (Mac); a failure leaves Try again and Download (this system's installer in the browser, from
//   twigo.dev/downloads/latest.json). The server turning this version away (/me's 426) shows the notice too.

declare const __BUILD__: { version: string };

const SERVER = 'https://twigo.dev';
/** How often an open app asks whether there's a new version (ms). */
const CHECK_EVERY_MS = 60_000;
const isMac = () => /Mac/.test(navigator.platform);

/** Everything the desktop app sets up as it opens (main.ts). */
export function startDesktopApp(): void {
  addEventListener('keydown', (e) => {
    const toggle = isMac() ? e.ctrlKey && e.metaKey && e.code === 'KeyF' : e.key === 'F11';
    if (!toggle) return;
    e.preventDefault();
    void toggleFullscreen().catch(() => null);
  });
  startWindow();
  // A login link that opened the app (or came while it was open).
  void getCurrent().then((urls) => urls && void handleLinks(urls)).catch(() => null);
  void onOpenUrl((urls) => void handleLinks(urls)).catch(() => null);
  // A new version: asked on start and every minute after (as the website's open games ask version.json), so an app left
  // open hears of one as soon as it's published (the desktop build lands about 10 minutes after a deploy), until it has
  // told the player once.
  const every = setInterval(() => void checkUpdate(), CHECK_EVERY_MS);
  // A newer version known while the player is in the game: the notice (the title screen shows its own button).
  updateStore.subscribe((s) => {
    if (s.state === 'idle' || s.state === 'checking') return;
    clearInterval(every);
    if (s.state === 'available' && inGame()) notifyUpdate(s.version, () => startUpdate(), downloadFrom(latest));
  });
  if (inGame()) void checkUpdate(); // (else the title screen asks, before Start)
}

let say: (text: string, problem?: boolean) => void = () => {};

/** "Log in with Discord": the system browser; the answer comes back as mikazuki://auth. */
export function desktopLogin(onSay: (text: string, problem?: boolean) => void): void {
  say = onSay;
  void openUrl(`${SERVER}/auth/login?client=desktop`);
  say('Finish logging in in your browser, then come back here.');
}

const PROBLEMS: Record<string, string> = {
  cancelled: 'You cancelled the login.',
  failed: "The login didn't work. Try again.",
  'not-member': 'Only members of the Mikazuki server can log in.',
};

async function handleLinks(urls: string[]): Promise<void> {
  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.protocol !== 'mikazuki:' || (url.hostname !== 'auth' && url.pathname.replace(/^\/+/, '') !== 'auth')) continue;
    const problem = url.searchParams.get('error');
    if (problem) return say(PROBLEMS[problem] ?? PROBLEMS.failed, true);
    const code = url.searchParams.get('code');
    if (!code) continue;
    const r = await api('/auth/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) }).catch(() => null);
    const body = r?.ok ? ((await r.json().catch(() => null)) as { token?: string } | null) : null;
    if (!body?.token) return say(PROBLEMS.failed, true);
    setAppToken(body.token);
    say('Logged in!');
    location.reload();
    return;
  }
}

interface Latest {
  version?: string;
  windows?: string;
  mac?: string;
}

/** The update the updater found (its download and install go through the app) and twigo.dev/downloads/latest.json. */
let found: Update | null = null;
let latest: Latest | null = null;
let asking: Promise<string | null> | null = null;
/** The game's logo for the update screen (manifest ui.logoMikazuki, from BootScene). */
let logoFile: string | undefined;
export const setUpdateArt = (file?: string): void => void (logoFile = file ? `${import.meta.env.BASE_URL}assets/${file}` : undefined);
export { updateStore };

async function latestRelease(): Promise<Latest | null> {
  const r = await fetch(`${SERVER}/downloads/latest.json`, { cache: 'no-store' }).catch(() => null);
  return r?.ok ? ((await r.json().catch(() => null)) as Latest | null) : null;
}

/** This system's installer, in the browser (the front page if there's none). */
const downloadFrom = (latest: Latest | null) => () => void openUrl((isMac() ? latest?.mac : latest?.windows) ?? `${SERVER}/`);

/** The updater's word: an update, null (up to date), or undefined (it couldn't tell: no signed release for this system,
 *  no network). */
const askUpdater = (): Promise<Update | null | undefined> => check().catch(() => undefined);

/** Whether a newer version of the app is out: the store goes checking, then available (its version) or idle (none, or
 *  the updater couldn't tell). Answers within CHECK_WAIT_MS at most: slower, it answers idle (the title screen lets the
 *  player start) and a late answer still makes it available later (the notice in the game). One ask at a time. */
export async function checkUpdate(): Promise<UpdateState> {
  const s = updateStore.get();
  if (s.state !== 'idle' && s.state !== 'checking') return s;
  updateStore.set({ state: 'checking' });
  asking ??= (fakeUpdate() ? new Promise<string | null>((done) => setTimeout(() => done(FAKE_VERSION), 900)) : askUpdaterAndSite()).catch(() => null).finally(() => (asking = null));
  const version = await within(asking);
  if (version === undefined) {
    void asking?.then((v) => v && updateStore.get().state === 'idle' && updateStore.set({ state: 'available', version: v }));
  }
  if (updateStore.get().state === 'checking') updateStore.set(version ? { state: 'available', version } : { state: 'idle' });
  return updateStore.get();
}

/** The updater and latest.json together: the update's version, or null. */
async function askUpdaterAndSite(): Promise<string | null> {
  const [u, l] = await Promise.all([askUpdater(), latestRelease()]);
  found = u ?? null;
  latest = l;
  if (u) return u.version;
  // No signed release the updater can take, but a newer download: still worth the notice's Download.
  if (u === undefined && l?.version && newer(l.version, __BUILD__.version) && (isMac() ? l.mac : l.windows)) notifyDownload(l.version, downloadFrom(l));
  return null;
}

/** What the app's install says as it goes (the `mk-update` event of the app's `install_update` command). */
export type UpdateProgress = { state: 'downloading'; got: number; total: number | null } | { state: 'installing' };

/** Downloads and installs the update the app has found, through the app's own `install_update` command (lib.rs): it
 *  reports its progress, and on Windows closes the game's window before the installer runs and the app quits (the
 *  installer reopens it by itself); on a Mac it swaps the app and restarts it. Rejects with the app's reason. */
async function installUpdate(onProgress: (p: UpdateProgress) => void): Promise<void> {
  const off = await listen<UpdateProgress>('mk-update', (e) => onProgress(e.payload)).catch(() => () => {});
  try {
    await invoke('install_update');
  } finally {
    off();
  }
}

/** The dev fake's install: a 48 MB download over 3 s, "Installing…" for 1.5 s, then the "restart" (the page without
 *  ?update=fake). */
async function fakeInstall(set: (p: UpdateProgress) => void): Promise<void> {
  const total = 48 * 1048576;
  for (let i = 1; i <= 30; i++) {
    await new Promise((r) => setTimeout(r, 100));
    set({ state: 'downloading', got: Math.round((total * i) / 30), total });
    if (fakeUpdate() === 'fail' && i === 15) throw new Error('the download stopped');
  }
  set({ state: 'installing' });
  await new Promise((r) => setTimeout(r, 1500));
  hideUpdateScreen();
  location.replace(location.pathname);
}

/** Update: the update screen, then the install (the store: downloading → installing → the app restarts; or failed, with
 *  Try again and Download on the screen). From the title screen's Update button, the notice's Update now, Try again. */
export function startUpdate(): void {
  const s = updateStore.get();
  if (s.state === 'downloading' || s.state === 'installing') return;
  const version = 'version' in s ? s.version : found?.version;
  if (!version) return;
  showUpdateScreen(updateStore, { retry: () => startUpdate(), download: downloadFrom(latest), from: __BUILD__.version, logo: logoFile });
  updateStore.set({ state: 'downloading', version, got: 0, total: null });
  const set = (p: UpdateProgress) => updateStore.set(p.state === 'downloading' ? { state: 'downloading', version, got: p.got, total: p.total } : { state: 'installing', version });
  (fakeUpdate() ? fakeInstall(set) : installUpdate(set)).catch((e: unknown) => updateStore.set({ state: 'failed', version, error: e instanceof Error ? e.message : String(e) }));
}

/** Settings → Exit game: the app quits. */
export const exitApp = (): Promise<void> => exit(0);

/** The server no longer takes this version (/me answered 426): Update now if the updater has one, else Download. */
export async function tooOld(): Promise<void> {
  const s = await checkUpdate();
  if (s.state === 'available' || s.state === 'failed') return notifyUpdate(s.version, () => startUpdate(), downloadFrom(latest), 'This version of Mikazuki is too old');
  notifyDownload(latest?.version ?? null, downloadFrom(latest), 'This version of Mikazuki is too old');
}
