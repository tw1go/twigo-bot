import { applyUpdate, checkForUpdate } from '../net/pwa';

// The game's version (bottom right, faint), and a notice at the top when a newer one has been deployed: the build
// publishes version.json (scripts/version.ts), and an open game checks it every minute; the home screen app's service
// worker says so too when it has the new version ready (net/pwa.ts). Reload now applies it (never on its own, so never
// in the middle of a game). Dev: shows "dev", no checks.

declare const __BUILD__: { version: string; commit: string; built: string };

const CHECK_MS = 60_000;

export function showVersion(): void {
  const label = document.createElement('div');
  label.id = 'version';
  label.textContent = __BUILD__.version;
  if (__BUILD__.commit) label.title = `${__BUILD__.version} · ${__BUILD__.commit} · built ${new Date(__BUILD__.built).toLocaleString()}`;
  document.body.append(label);
  // (The desktop app plays the live game too since its 1.0.0, so it reloads into a new build like the website; the app's
  // own new versions come from twigo.dev/downloads instead, net/desktop.ts.)
  if (__BUILD__.version === 'dev') return;

  const look = async () => {
    if (told) return;
    const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' }).catch(() => null);
    const live = res?.ok ? ((await res.json().catch(() => null)) as { version?: string } | null) : null;
    if (live?.version && live.version !== __BUILD__.version) {
      checkForUpdate(); // (the home screen app fetches it meanwhile)
      notify(live.version);
    }
  };
  check = look;
  setInterval(() => void look(), CHECK_MS);
  // Coming back to the tab is a good moment to look too.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void look());
}

let told = false;
/** Asks version.json whether a newer build is out (set once showVersion has run on a build). */
let check: (() => Promise<void>) | null = null;

/** Something of this build couldn't be loaded (an art sheet a deploy removed): look for a newer version now, not in a
 *  minute, so its notice says to reload. */
export function checkVersionNow(): void {
  void check?.();
}

/** The home screen app's service worker has a new version ready. */
export function newVersionReady(): void {
  notify(null);
}

/** "New version available" at the top centre, with Reload now (and ×); once. */
function notify(version: string | null): void {
  if (told) return;
  told = true;
  showNotice(version ? `New version available (${version})` : 'New version available', 'Reload now', (b) => {
    b.disabled = true;
    void applyUpdate();
  });
}

/** The desktop app's notice: a newer version to download (or this one is too old), and Download. */
export function notifyDownload(version: string | null, download: () => void, text = 'A new version of Mikazuki is out'): void {
  if (told) return;
  told = true;
  showNotice(version ? `${text} (${version})` : text, 'Download', () => download());
}

/** The desktop app's own new version, found while the player is in the game: "A new version of Mikazuki is ready (v…).
 *  It installs the next time you open Mikazuki.", Update now → `update` (the update screen, net/desktop.ts startUpdate:
 *  the player's own choice, never a restart they didn't ask for). `download` is kept for the too-old line's Download. */
export function notifyUpdate(version: string, update: () => void, download: () => void, text = 'A new version of Mikazuki is ready'): void {
  if (told) return;
  told = true;
  const v = version.startsWith('v') ? version : `v${version}`;
  const n = showNotice(`${text} (${v}). It installs the next time you open Mikazuki.`, 'Update now', () => {
    n.close.hidden = true;
    update();
  });
  void download;
}

/** The notice at the top centre: its text, its button, and × (later). `act` can be swapped while it's up. */
function showNotice(message: string, label: string, act: (button: HTMLButtonElement) => void): { text: HTMLElement; close: HTMLButtonElement; act: (button: HTMLButtonElement) => void } {
  const box = document.createElement('div');
  box.id = 'new-version';
  box.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = message;
  const reload = document.createElement('button');
  reload.className = 'nv-reload';
  reload.textContent = label;
  const close = document.createElement('button');
  close.className = 'nv-close';
  close.setAttribute('aria-label', 'Later');
  close.textContent = '×';
  close.addEventListener('click', () => box.remove());
  const notice = { text, close, act };
  reload.addEventListener('click', () => notice.act(reload));
  box.append(text, reload, close);
  document.body.append(box);
  return notice;
}
