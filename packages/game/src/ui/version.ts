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
  if (__BUILD__.version === 'dev') return;

  const check = async () => {
    if (told) return;
    const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' }).catch(() => null);
    const live = res?.ok ? ((await res.json().catch(() => null)) as { version?: string } | null) : null;
    if (live?.version && live.version !== __BUILD__.version) {
      checkForUpdate(); // (the home screen app fetches it meanwhile)
      notify(live.version);
    }
  };
  setInterval(() => void check(), CHECK_MS);
  // Coming back to the tab is a good moment to look too.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void check());
}

let told = false;

/** The home screen app's service worker has a new version ready. */
export function newVersionReady(): void {
  notify(null);
}

/** "New version available" at the top centre, with Reload now (and ×); once. */
function notify(version: string | null): void {
  if (told) return;
  told = true;
  const box = document.createElement('div');
  box.id = 'new-version';
  box.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = version ? `New version available (${version})` : 'New version available';
  const reload = document.createElement('button');
  reload.className = 'nv-reload';
  reload.textContent = 'Reload now';
  reload.addEventListener('click', () => {
    reload.disabled = true;
    void applyUpdate();
  });
  const close = document.createElement('button');
  close.className = 'nv-close';
  close.setAttribute('aria-label', 'Later');
  close.textContent = '×';
  close.addEventListener('click', () => box.remove());
  box.append(text, reload, close);
  document.body.append(box);
}
