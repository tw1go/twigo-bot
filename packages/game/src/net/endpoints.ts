import { isDesktopApp } from './platform';

// 🌐 Where the server is. The website (and the home screen app) is served by it, so every call stays relative, exactly
// as before: fetch('/town/…') with the browser's cookie. Since its 1.0.0 the desktop app's page is the live game at
// https://twigo.dev/play/ too (its start page opens it), so its calls are relative as well, signed in with its token
// (Authorization: Bearer; on /ws the subprotocol `mk-token.<token>`; no cookie: the login came back through the system
// browser) and saying which app it is (X-Mikazuki-Client: desktop/<the app's own version>, for the server's oldest-version
// check). A page the server didn't serve (an app before 1.0.0 had the game inside it: tauri://localhost) calls
// https://twigo.dev by address. In dev (npm run desktop:dev) the desktop app talks to the Vite dev server's dev town like
// the page does, never the live server.

const SERVER = 'https://twigo.dev';
/** The desktop app outside dev: its calls carry its token and its version. */
const inApp = (): boolean => isDesktopApp() && !import.meta.env.DEV;
/** A page the server didn't serve (not http or https: an old app's bundled page), which calls the server by address. */
const remote = (): boolean => inApp() && !/^https?:$/.test(location.protocol);
const TOKEN_KEY = 'mk_app_token';
/** What the bundled page kept that the live page takes over once (the start page hands them on in the #hash). */
const HANDOFF = [TOKEN_KEY, 'mk_window'];

/** The app's own version (tauri.conf.json's, "1.0.0"; not the game's v0.1.N). 'dev' outside it. Every server call
 *  carries it, so none waits on the app for long: the last version this app said (kept in its storage) at once, while
 *  the app is asked again in the background; with none kept yet, the app's answer, or 'unknown' after VERSION_WAIT_MS
 *  (the server lets an unknown version in). */
const VERSION_KEY = 'mk_app_version';
const VERSION_WAIT_MS = 1500;
let shell: Promise<string> | null = null;
export function shellVersion(): Promise<string> {
  if (shell) return shell;
  if (!isDesktopApp()) return (shell = Promise.resolve('dev'));
  const asked = import('@tauri-apps/api/app')
    .then((m) => m.getVersion())
    .then((v) => {
      try {
        localStorage.setItem(VERSION_KEY, v);
      } catch {
        /* (nothing to keep it in) */
      }
      return v;
    });
  let kept: string | null = null;
  try {
    kept = localStorage.getItem(VERSION_KEY);
  } catch {
    /* (none) */
  }
  if (kept) {
    void asked.then((v) => (shell = Promise.resolve(v)), () => {});
    return (shell = Promise.resolve(kept));
  }
  return (shell = Promise.race([asked.catch(() => 'unknown'), new Promise<string>((done) => setTimeout(() => done('unknown'), VERSION_WAIT_MS))]));
}

/** The live page opened by the app's start page: the old bundled page's login and window setting, handed on once in the
 *  #hash (mk-handoff, base64 JSON), kept unless this page has its own already, and the #hash tidied away. Called first
 *  thing (main.ts), before anything reads them. */
export function takeAppHandoff(): void {
  if (!isDesktopApp()) return;
  const m = /(?:^#|&)mk-handoff=([^&]+)/.exec(location.hash);
  if (!m) return;
  try {
    const old = JSON.parse(atob(decodeURIComponent(m[1]))) as Record<string, unknown>;
    for (const key of HANDOFF) if (typeof old[key] === 'string' && localStorage.getItem(key) === null) localStorage.setItem(key, old[key]);
  } catch {
    /* (nothing usable: they log in again) */
  }
  history.replaceState(null, '', location.pathname + location.search);
}

/** The desktop app's session token (kept in the app's own storage), or null. */
export function appToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAppToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* (nothing to keep it in) */
  }
}

/** A server path ('/town/shop') as the page should ask for it. */
export const serverUrl = (path: string): string => (remote() ? `${SERVER}${path}` : path);

/** fetch() for the server's routes: on the website exactly fetch(path, init); in the desktop app with its token and the
 *  app's version (no cookies). */
export async function api(path: string, init: RequestInit = {}): Promise<Response> {
  if (!inApp()) return fetch(path, init);
  const headers = new Headers(init.headers);
  const token = appToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  headers.set('X-Mikazuki-Client', `desktop/${await shellVersion()}`);
  return fetch(serverUrl(path), { ...init, headers, credentials: 'omit' });
}

/** The town's WebSocket: its URL (from the page's address; wss://twigo.dev/ws from an old app's bundled page) and the
 *  subprotocols carrying the desktop app's token (none on the website). */
export function townSocket(query: URLSearchParams): { url: string; protocols?: string[] } {
  let url: string;
  if (remote()) url = `wss://twigo.dev/ws?${query}`;
  else {
    const here = new URL(location.href);
    here.protocol = here.protocol === 'https:' ? 'wss:' : 'ws:';
    here.pathname = '/ws';
    here.search = query.toString();
    here.hash = '';
    url = here.toString();
  }
  const token = inApp() ? appToken() : null;
  return token ? { url, protocols: ['mikazuki', `mk-token.${token}`] } : { url };
}
