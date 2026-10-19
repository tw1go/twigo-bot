import { isDesktopApp, isHomeScreenApp } from './platform';

// 🏠 The home screen app (a PWA: vite.config.ts homeScreenApp builds manifest.webmanifest and sw.js). The service worker
// keeps the art on the device after the first load; it's registered on the website only (never in the desktop app, whose
// art is inside it already, nor in dev). An update installs in the background and waits: the "New version available"
// notice (ui/version.ts) applies it when the player presses Reload now, never in the middle of a game. Installing: the
// browser's own prompt (Android Chrome, desktop Chrome) is caught here for the title screen's "Install Mikazuki" button.
// Opening the game on the title screen while a newer build is live switches to it at once (freshStart), and the first
// open of a build drops what that deploy changed from the device (tidyCaches), so nothing old outlives a deploy.

declare const __BUILD__: { version: string; commit: string; built: string };

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
      if (navigator.serviceWorker.controller) void freshStart(r);
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

/** Pressed Start (or came through a gate): from now on a newer build waits for Reload now, never mid-game. */
let entered = false;
export const enteredGame = (): void => void (entered = true);

/** On the title screen (before Start), the device catches up at once: a newer build that's live, or a service worker
 *  that has installed and waits (a deploy's files, the data among them, ready but not in use yet), takes over and the
 *  page reloads on it, so the game opens on what's deployed rather than on what this device kept. Once per version a
 *  tab (never a loop); after Start, the notice's Reload now. */
async function freshStart(r: ServiceWorkerRegistration): Promise<void> {
  const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' }).catch(() => null);
  const live = res?.ok ? ((await res.json().catch(() => null)) as { version?: string } | null)?.version : null;
  await r.update().catch(() => null); // (sw.js asked again: a deploy's worker installs)
  const newer = !!live && live !== __BUILD__.version;
  if (entered || (!newer && !r.waiting && !r.installing)) return;
  const tried = newer ? live! : `waiting:${__BUILD__.version}`;
  try {
    if (sessionStorage.getItem('mk_fresh') === tried) return;
    sessionStorage.setItem('mk_fresh', tried);
  } catch {
    return; // (no way to know we've tried: leave it to the notice)
  }
  const waiting = r.waiting ?? (await installed(r, 20_000));
  if (!waiting || entered) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

/** The build's file list (scripts/version.ts assetFiles): each loose file's content hash, and the hashed files. */
interface AssetFiles {
  version: string;
  files: Record<string, string>;
  hashed: string[];
}

/** The first open of a build: whatever the device kept that this build changed or no longer has is dropped (the
 *  service worker's mk-assets and mk-data by each file's hash, mk-hashed by the build's list: an older build's sheets and
 *  scripts), so it's fetched fresh; what's the same stays. The list it compared with is kept (cache mk-meta). Nothing
 *  to do on a build already tidied (localStorage mk_cache_build), nor without the service worker's caches. */
export async function tidyCaches(): Promise<void> {
  if (!import.meta.env.PROD || isDesktopApp() || !('caches' in window)) return;
  const BASE = import.meta.env.BASE_URL;
  try {
    if (localStorage.getItem('mk_cache_build') === __BUILD__.version) return;
  } catch {
    // (no localStorage: look each time)
  }
  const res = await fetch(`${BASE}asset-files.json`, { cache: 'no-store' }).catch(() => null);
  const now = res?.ok ? ((await res.json().catch(() => null)) as AssetFiles | null) : null;
  if (!now?.files || now.version !== __BUILD__.version) return; // (a newer build is live: freshStart goes to it, and tidies there)
  const meta = await caches.open('mk-meta');
  const before = (await meta.match('asset-files').then((r) => r?.json()).catch(() => null)) as AssetFiles | null;
  const pathOf = (req: Request) => new URL(req.url).pathname.slice(BASE.length);
  for (const name of ['mk-assets', 'mk-data']) {
    const c = await caches.open(name);
    for (const req of await c.keys()) {
      const path = pathOf(req);
      if (!before?.files || !now.files[path] || before.files[path] !== now.files[path]) await c.delete(req);
    }
  }
  const hashed = new Set(now.hashed);
  const h = await caches.open('mk-hashed');
  for (const req of await h.keys()) if (!hashed.has(pathOf(req))) await h.delete(req);
  await meta.put('asset-files', new Response(JSON.stringify(now), { headers: { 'Content-Type': 'application/json' } }));
  try {
    localStorage.setItem('mk_cache_build', __BUILD__.version);
  } catch {
    // (it looks again next time)
  }
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

/** A phone or a tablet: touch is the main way in (an iPad says it's a Mac, but has touch points). Computers have the
 *  desktop app instead, so the title screen offers installing only here (Mac, 19 Oct 2026). */
const touchDevice = (): boolean => matchMedia('(pointer: coarse)').matches || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/** The browser offers to install it on a phone or tablet (and it isn't installed, nor the desktop app). */
export const canInstall = (): boolean => !!installEvent && touchDevice() && !isHomeScreenApp() && !isDesktopApp();

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
