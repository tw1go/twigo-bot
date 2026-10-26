// 🔒 The hotbar lock (CONTEXT.md Hotbar lock): while it's on, nothing on the bar can be dragged off it or moved (empty
// slots still fill: a skill or potion dropped or put on one, a new skill as it unlocks). One switch, two places: the
// padlock on the bar (ui/hotbar.ts) and Settings → Game (ui/settings.ts), each redrawn on 'mk-hotbar-lock'. Kept for
// every device: the server's (/me hotbarLocked; each change POST /town/hotbar-lock through `syncHotbarLock`) wins once
// logged in; this browser's (localStorage `mk_hotbar_lock`) stands in offline and in dev. Off by default.

const STORE = 'mk_hotbar_lock';
let locked = read();
/** Logged in: each change goes to the server too. */
let push: ((locked: boolean) => void) | null = null;

function read(): boolean {
  try {
    return localStorage.getItem(STORE) === '1';
  } catch {
    return false;
  }
}

/** Whether the hotbar is locked. */
export const hotbarLocked = (): boolean => locked;

/** Locks or unlocks it (both places redraw; kept here and, logged in, on the server). */
export function setHotbarLocked(on: boolean): void {
  if (on === locked) return;
  locked = on;
  try {
    localStorage.setItem(STORE, on ? '1' : '0');
  } catch {
    /* private window: just not remembered */
  }
  push?.(on);
  window.dispatchEvent(new Event('mk-hotbar-lock'));
}

/** The server's switch (/me hotbarLocked; undefined: never set there, this browser's goes up if it's on), and how a
 *  change goes back to it (TownScene: POST /town/hotbar-lock). */
export function syncHotbarLock(server: boolean | undefined, send: (locked: boolean) => void): void {
  push = send;
  if (server === undefined) {
    if (locked) send(true);
    return;
  }
  if (server !== locked) {
    locked = server;
    try {
      localStorage.setItem(STORE, server ? '1' : '0');
    } catch {
      /* private window */
    }
    window.dispatchEvent(new Event('mk-hotbar-lock'));
  }
}

/** Runs `fn` now and whenever the lock changes. */
export function onHotbarLock(fn: (locked: boolean) => void): void {
  fn(locked);
  window.addEventListener('mk-hotbar-lock', () => fn(locked));
}
