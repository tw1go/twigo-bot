import { onOpenUrl, getCurrent } from '@tauri-apps/plugin-deep-link';
import { openUrl } from '@tauri-apps/plugin-opener';
import { api, setAppToken } from './endpoints';
import { notifyDownload } from '../ui/version';
import { startWindow, toggleFullscreen } from './window-mode';

// 🖥️ The desktop app's own parts (packages/desktop, Tauri 2): only ever loaded inside it (net/platform.ts isDesktopApp),
// so the website never downloads them.
// - Logging in: "Log in with Discord" opens the system browser at twigo.dev/auth/login?client=desktop; once Discord says
//   yes the server sends the browser to mikazuki://auth?code=… (the app's own link: Tauri's deep-link plugin), and the
//   app swaps the code at POST /auth/exchange for its session token (kept in its storage: net/endpoints.ts), then reloads
//   logged in. mikazuki://auth?error=… says why not.
// - The window: Settings → Display → Window (net/window-mode.ts), applied as it opens; F11 (Windows) or Ctrl+Cmd+F
//   (Mac) swaps Full screen and the last other mode.
// - Updates: on start, twigo.dev/downloads/latest.json; a newer version shows the version notice with a Download button
//   (this system's file, in the browser). No auto-updater. The server turning this version away (/me's 426) shows it too.

declare const __BUILD__: { version: string };

const SERVER = 'https://twigo.dev';
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
  void checkForNewVersion();
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

/** A newer version on twigo.dev/downloads: the notice with Download. */
async function checkForNewVersion(): Promise<void> {
  const r = await fetch(`${SERVER}/downloads/latest.json`, { cache: 'no-store' }).catch(() => null);
  const latest = r?.ok ? ((await r.json().catch(() => null)) as Latest | null) : null;
  if (!latest?.version || !newer(latest.version, __BUILD__.version)) return;
  const link = isMac() ? latest.mac : latest.windows;
  if (link) notifyDownload(latest.version, () => void openUrl(link));
}

/** The server no longer takes this version (/me answered 426): the notice, with this system's download if there is one. */
export async function tooOld(): Promise<void> {
  const r = await fetch(`${SERVER}/downloads/latest.json`, { cache: 'no-store' }).catch(() => null);
  const latest = r?.ok ? ((await r.json().catch(() => null)) as Latest | null) : null;
  const link = (isMac() ? latest?.mac : latest?.windows) ?? `${SERVER}/`;
  notifyDownload(latest?.version ?? null, () => void openUrl(link), 'This version of Mikazuki is too old');
}

/** Whether version a ("v0.1.560") is newer than b. */
function newer(a: string, b: string): boolean {
  const n = (v: string) => (/^v?(\d+)\.(\d+)\.(\d+)/.exec(v) ?? []).slice(1).map(Number);
  const [x, y] = [n(a), n(b)];
  if (x.length < 3 || y.length < 3) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
