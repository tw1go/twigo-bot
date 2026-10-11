import { isDesktopApp, isHomeScreenApp } from './platform';

// 🏠 The home screen app (a PWA: vite.config.ts homeScreenApp builds manifest.webmanifest and sw.js). The service worker
// keeps the art on the device after the first load; it's registered on the website only (never in the desktop app, whose
// art is inside it already, nor in dev). An update installs in the background and waits: the "New version available"
// notice (ui/version.ts) applies it when the player presses Reload now, never in the middle of a game. Installing: the
// browser's own prompt (Android Chrome, desktop Chrome) is caught here for the title screen's "Install Mikazuki" button.

type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let reg: ServiceWorkerRegistration | null = null;
let installEvent: InstallPrompt | null = null;
const installWatchers = new Set<() => void>();

/** No service worker was in charge as this page opened: its first open (nothing kept on the device yet). */
export const firstOpen = !isDesktopApp() && import.meta.env.PROD && 'serviceWorker' in navigator && !navigator.serviceWorker.controller;

/** Registers the service worker; `onUpdate` when a new version has installed and waits. Catches the install prompt. */
export function startHomeScreenApp(onUpdate: () => void): void {
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // (the title screen offers it instead)
    installEvent = e as InstallPrompt;
    installWatchers.forEach((fn) => fn());
  });
  addEventListener('appinstalled', () => {
    installEvent = null;
    installWatchers.forEach((fn) => fn());
  });
  if (!import.meta.env.PROD || isDesktopApp() || !('serviceWorker' in navigator)) return;
  const BASE = import.meta.env.BASE_URL;
  void navigator.serviceWorker
    .register(`${BASE}sw.js`, { scope: BASE })
    .then((r) => {
      reg = r;
      if (r.waiting && navigator.serviceWorker.controller) onUpdate();
      r.addEventListener('updatefound', () => {
        const w = r.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) onUpdate(); // (an update, not the first install)
        });
      });
    })
    .catch(() => null);
}

/** Asks the server for a newer service worker (version.json said there's a new build). */
export const checkForUpdate = (): void => void reg?.update().catch(() => null);

/** Reload now: the waiting service worker takes over, then the page reloads on it (else a plain reload). */
export async function applyUpdate(): Promise<void> {
  if (!reg) return location.reload();
  await reg.update().catch(() => null);
  const waiting = reg.waiting ?? (await installed(reg, 15_000));
  if (!waiting) return location.reload();
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

/** The new worker once it has installed (null if none comes within `ms`). */
function installed(r: ServiceWorkerRegistration, ms: number): Promise<ServiceWorker | null> {
  return new Promise((done) => {
    const end = setTimeout(() => done(r.waiting), ms);
    const look = () => {
      if (!r.waiting) return;
      clearTimeout(end);
      done(r.waiting);
    };
    r.addEventListener('updatefound', () => r.installing?.addEventListener('statechange', look));
    r.installing?.addEventListener('statechange', look);
  });
}

/** The browser offers to install it (and it isn't installed, nor the desktop app). */
export const canInstall = (): boolean => !!installEvent && !isHomeScreenApp() && !isDesktopApp();

/** `fn` whenever that changes; returns the unsubscribe. */
export function onInstallable(fn: () => void): () => void {
  installWatchers.add(fn);
  return () => installWatchers.delete(fn);
}

/** The browser's install prompt. */
export async function install(): Promise<void> {
  const e = installEvent;
  if (!e) return;
  await e.prompt();
  const choice = await e.userChoice.catch(() => null);
  if (choice?.outcome === 'accepted') installEvent = null;
  installWatchers.forEach((fn) => fn());
}
