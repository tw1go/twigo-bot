import { isDesktopApp } from './platform';

// 🌐 Where the server is. The website (and the home screen app) is served by it, so every call stays relative, exactly
// as before: fetch('/town/…') with the browser's cookie. The desktop app's page is its own (tauri://localhost): it calls
// https://twigo.dev, signed in with its token (Authorization: Bearer; on /ws the subprotocol `mk-token.<token>`) and
// saying which app it is (X-Mikazuki-Client: desktop/<version>, for the server's oldest-version check). In dev (npm run
// desktop:dev) the desktop app talks to the Vite dev server's dev town like the page does, never the live server.

declare const __BUILD__: { version: string };

const SERVER = 'https://twigo.dev';
/** The desktop app outside dev: it talks to the live server by its address. */
const remote = (): boolean => isDesktopApp() && !import.meta.env.DEV;
const TOKEN_KEY = 'mk_app_token';

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

/** fetch() for the server's routes: on the website exactly fetch(path, init); in the desktop app, at twigo.dev with its
 *  token and version (no cookies). */
export function api(path: string, init: RequestInit = {}): Promise<Response> {
  if (!remote()) return fetch(path, init);
  const headers = new Headers(init.headers);
  const token = appToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  headers.set('X-Mikazuki-Client', `desktop/${__BUILD__.version}`);
  return fetch(`${SERVER}${path}`, { ...init, headers, credentials: 'omit' });
}

/** The town's WebSocket: its URL (from the page's address on the website; wss://twigo.dev/ws in the desktop app) and the
 *  subprotocols carrying the desktop app's token (none on the website). */
export function townSocket(query: URLSearchParams): { url: string; protocols?: string[] } {
  if (!remote()) {
    const url = new URL(location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/ws';
    url.search = query.toString();
    url.hash = '';
    return { url: url.toString() };
  }
  const token = appToken();
  return { url: `wss://twigo.dev/ws?${query}`, protocols: token ? ['mikazuki', `mk-token.${token}`] : undefined };
}
