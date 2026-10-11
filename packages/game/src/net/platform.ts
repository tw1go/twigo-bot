// 📱 Which way the game is being played (CONTEXT.md "Ways to play"): the website (a browser tab), the home screen app
// (the website installed on a phone: a PWA) or the desktop app (Tauri, the game and its art bundled inside).

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
