import { onOpenUrl, getCurrent } from '@tauri-apps/plugin-deep-link';
import { openUrl } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { exit } from '@tauri-apps/plugin-process';
import { type Update, check } from '@tauri-apps/plugin-updater';
import { api, setAppToken } from './endpoints';
import { notifyDownload, notifyUpdate } from '../ui/version';
import { startWindow, toggleFullscreen } from './window-mode';

// 🖥️ The desktop app's own parts (packages/desktop, Tauri 2): only ever loaded inside it (net/platform.ts isDesktopApp),
// so the website never downloads them.
// - Logging in: "Log in with Discord" opens the system browser at twigo.dev/auth/login?client=desktop; once Discord says
//   yes the server sends the browser to mikazuki://auth?code=… (the app's own link: Tauri's deep-link plugin), and the
//   app swaps the code at POST /auth/exchange for its session token (kept in its storage: net/endpoints.ts), then reloads
//   logged in. mikazuki://auth?error=… says why not.
// - The window: Settings → Display → Window (net/window-mode.ts), applied as it opens; F11 (Windows) or Ctrl+Cmd+F
//   (Mac) swaps Full screen and the last other mode.
// - Updates: on start and every minute after (until it has told the player), twigo.dev/downloads/latest.json (the updater plugin reads its `platforms`, signed by
//   packages/desktop/scripts/publish.mjs): a newer version shows "A new version of Mikazuki is ready" with Update now,
//   which downloads it, installs it and restarts the app (the app's own `install_update` command: lib.rs). If the updater can't (no signed release for this system, a
//   failed download), the notice's Download opens this system's installer in the browser instead. The server turning
//   this version away (/me's 426) shows it too.

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
  let checking = false;
  const ask = async () => {
    if (checking) return;
    checking = true;
    const told = await checkForNewVersion().catch(() => false);
    checking = false;
    if (told) clearInterval(every);
  };
  const every = setInterval(() => void ask(), CHECK_EVERY_MS);
  void ask();
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

async function latestRelease(): Promise<Latest | null> {
  const r = await fetch(`${SERVER}/downloads/latest.json`, { cache: 'no-store' }).catch(() => null);
  return r?.ok ? ((await r.json().catch(() => null)) as Latest | null) : null;
}

/** This system's installer, in the browser (the front page if there's none). */
const downloadFrom = (latest: Latest | null) => () => void openUrl((isMac() ? latest?.mac : latest?.windows) ?? `${SERVER}/`);

/** The updater's word: an update, null (up to date), or undefined (it couldn't tell: no signed release for this system,
 *  no network). */
const askUpdater = (): Promise<Update | null | undefined> => check().catch(() => undefined);

/** What the app's install says as it goes (the `mk-update` event of the app's `install_update` command). */
export type UpdateProgress = { state: 'downloading'; got: number; total: number | null } | { state: 'installing' };

/** Downloads and installs the update the app has found, through the app's own `install_update` command (lib.rs): it
 *  reports its progress, and on Windows closes the game's window before the installer runs and the app quits (the
 *  installer reopens it by itself); on a Mac it swaps the app and restarts it. Rejects with the app's reason. */
export async function installUpdate(onProgress: (p: UpdateProgress) => void): Promise<void> {
  const off = await listen<UpdateProgress>('mk-update', (e) => onProgress(e.payload)).catch(() => () => {});
  try {
    await invoke('install_update');
  } finally {
    off();
  }
}

/** The old notice's words for the install's progress. */
async function install(_update: Update, say: (text: string) => void): Promise<void> {
  await installUpdate((p) => {
    if (p.state === 'downloading') say(p.total ? `Downloading the update… ${Math.min(100, Math.floor((p.got * 100) / p.total))}%` : 'Downloading the update…');
    else say('Installing… Mikazuki will close and open again by itself.');
  });
}

/** A newer version on twigo.dev/downloads: Update now (the updater), else the notice with Download. True: the player was
 *  told (no need to ask again). */
async function checkForNewVersion(): Promise<boolean> {
  const [update, latest] = await Promise.all([askUpdater(), latestRelease()]);
  if (update) {
    notifyUpdate(update.version, (say) => install(update, say), downloadFrom(latest));
    return true;
  }
  if (update === null || !latest?.version || !newer(latest.version, __BUILD__.version)) return false;
  if (!(isMac() ? latest.mac : latest.windows)) return false;
  notifyDownload(latest.version, downloadFrom(latest));
  return true;
}

/** Settings → Exit game: the app quits. */
export const exitApp = (): Promise<void> => exit(0);

/** The server no longer takes this version (/me answered 426): Update now if the updater has one, else Download. */
export async function tooOld(): Promise<void> {
  const [update, latest] = await Promise.all([askUpdater(), latestRelease()]);
  if (update) return notifyUpdate(update.version, (say) => install(update, say), downloadFrom(latest));
  notifyDownload(latest?.version ?? null, downloadFrom(latest), 'This version of Mikazuki is too old');
}

/** Whether version a ("v0.1.560") is newer than b. */
function newer(a: string, b: string): boolean {
  const n = (v: string) => (/^v?(\d+)\.(\d+)\.(\d+)/.exec(v) ?? []).slice(1).map(Number);
  const [x, y] = [n(a), n(b)];
  if (x.length < 3 || y.length < 3) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
