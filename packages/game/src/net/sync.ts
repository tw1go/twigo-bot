import { api } from './endpoints';

// 💾 Settings kept on the server (the hotbar, keybinds): a change waits SAVE_MS for more before it's sent (several
// drags or key presses: one request), and whatever's waiting goes at once, with keepalive, as the page goes. One
// pending body per path: the latest wins.

const SAVE_MS = 600;
const pending = new Map<string, unknown>();
let timer: ReturnType<typeof setTimeout> | null = null;
let leaving = false;

function flush(onLeave = false): void {
  if (timer) clearTimeout(timer);
  timer = null;
  for (const [path, body] of pending) {
    void api(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: onLeave }).catch(() => null);
  }
  pending.clear();
}

/** Sends `body` to `path` (POST, JSON) a moment later, replacing anything of that path's still waiting. */
export function queueSave(path: string, body: unknown): void {
  pending.set(path, body);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => flush(), SAVE_MS);
  if (!leaving) {
    leaving = true;
    addEventListener('pagehide', () => flush(true));
  }
}
