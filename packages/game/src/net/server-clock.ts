// 🕰️ The server's clock as the page knows it: each town welcome carries the server's time, so things every player must
// see alike by the clock (the Halloween Kapre's tree) agree whatever their own clock says. Until a welcome: the page's.

let offset = 0;

/** A welcome's `now` (ms): the server's clock then. */
export function setServerNow(now: number | undefined): void {
  if (typeof now === 'number' && Number.isFinite(now)) offset = now - Date.now();
}

/** The server's time now (ms). */
export const serverNow = (): number => Date.now() + offset;
