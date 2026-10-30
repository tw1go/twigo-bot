// 📱 Which way the game is being played (CONTEXT.md "Ways to play"): the website (a browser tab), the home screen app
// (the website installed on a phone: a PWA) or the desktop app (Tauri: a window on the live game at twigo.dev/play since
// its 1.0.0; Tauri's bridge is on that page too, capabilities/default.json's remote twigo.dev).

/** Inside the desktop app (Tauri puts its bridge on the window). */
export const isDesktopApp = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Opened from the home screen icon (full screen or standalone), not in a browser tab. */
export function isHomeScreenApp(): boolean {
  if (isDesktopApp()) return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || matchMedia('(display-mode: standalone)').matches || (matchMedia('(display-mode: fullscreen)').matches && !document.fullscreenElement);
}

/** An iPhone or iPad (an iPad asks for the desktop site: a "Mac" with a touch screen). */
export const isIos = (): boolean => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Whether a request is Tauri's custom-protocol IPC on Windows (http(s)://ipc.localhost/…) made from a page served over
 *  https (the app's live page at twigo.dev). Pure, for the test. */
export const localIpcFromSite = (url: string, pageProtocol: string): boolean => pageProtocol === 'https:' && /^https?:\/\/ipc\.localhost\//i.test(url);

/** The desktop app's bridge on the live page goes straight to its message channel (30 Oct 2026). Tauri's page script
 *  tries each page's first call as a request to http://ipc.localhost and only falls back to window.ipc.postMessage once
 *  that fails; from the public https://twigo.dev page Edge (WebView2) treats it as a local network request and holds it
 *  for a permission check, so the first call on every page (every teleport and gate is a new page) stalled for 10 s or
 *  more, or for good, and everything waiting on it with it: the loading cover stayed while mobs hit you. Its fetch is
 *  the page's own, so that one request fails at once here and Tauri uses the message channel from the first call.
 *  A Mac's ipc://localhost isn't touched. Called first thing (main.ts). */
export function useAppMessageBridge(): void {
  if (!isDesktopApp() || location.protocol !== 'https:') return;
  const fetchFirst = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (localIpcFromSite(url, location.protocol)) return Promise.reject(new TypeError('Mikazuki: the app bridge uses its message channel'));
    return fetchFirst(input, init);
  };
}
