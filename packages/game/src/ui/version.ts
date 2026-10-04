// The game's version (bottom right, faint), and a notice at the top when a newer one has been deployed: the build
// publishes version.json (scripts/version.ts), and an open game checks it every minute. Dev: shows "dev", no checks.

declare const __BUILD__: { version: string; commit: string; built: string };

const CHECK_MS = 60_000;

export function showVersion(): void {
  const label = document.createElement('div');
  label.id = 'version';
  label.textContent = __BUILD__.version;
  if (__BUILD__.commit) label.title = `${__BUILD__.version} · ${__BUILD__.commit} · built ${new Date(__BUILD__.built).toLocaleString()}`;
  document.body.append(label);
  if (__BUILD__.version === 'dev') return;

  let told = false;
  const check = async () => {
    if (told) return;
    const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' }).catch(() => null);
    const live = res?.ok ? ((await res.json().catch(() => null)) as { version?: string } | null) : null;
    if (live?.version && live.version !== __BUILD__.version) {
      told = true;
      notify(live.version);
    }
  };
  setInterval(() => void check(), CHECK_MS);
  // Coming back to the tab is a good moment to look too.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void check());
}

/** "New version available" at the top centre, with Reload now (and ×). */
function notify(version: string): void {
  const box = document.createElement('div');
  box.id = 'new-version';
  box.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = `New version available (${version})`;
  const reload = document.createElement('button');
  reload.className = 'nv-reload';
  reload.textContent = 'Reload now';
  reload.addEventListener('click', () => location.reload());
  const close = document.createElement('button');
  close.className = 'nv-close';
  close.setAttribute('aria-label', 'Later');
  close.textContent = '×';
  close.addEventListener('click', () => box.remove());
  box.append(text, reload, close);
  document.body.append(box);
}
