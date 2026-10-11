import { isHomeScreenApp, isIos } from './platform';

// 🔑 "Log in with Discord" on the title screen. The website (and Android's home screen app, which shares the browser's
// cookies) follows the link: Discord, then back to /play/ with the session cookie (bot web/auth.ts). The iPhone home
// screen app can't: Discord's page opens in a browser sheet whose cookies may never reach the app. So it opens the login
// there with a random nonce and waits: every 2 s it asks GET /auth/wait?nonce=… until the sheet has finished (the bot
// answers only the phone the login finished from), swaps the one-time code at POST /auth/exchange for its own cookie,
// and reloads, logged in.

const POLL_MS = 2000;
const GIVE_UP_MS = 10 * 60_000;

/** This login has to wait for a browser sheet (the iPhone home screen app). */
export const loginWaits = (): boolean => isIos() && isHomeScreenApp();

/** Starts the waiting login: opens Discord in a sheet, then polls. `say` shows how it's going (under the button). */
export function waitingLogin(say: (text: string, problem?: boolean) => void): void {
  const nonce = randomNonce();
  window.open(`/auth/login?client=wait&nonce=${nonce}`, '_blank');
  say('Finish logging in on the Discord page, then come back here.');
  const until = Date.now() + GIVE_UP_MS;
  const poll = async (): Promise<void> => {
    if (Date.now() > until) return say('The login took too long. Try again.', true);
    const r = await fetch(`/auth/wait?nonce=${nonce}`, { credentials: 'same-origin', cache: 'no-store' }).catch(() => null);
    const w = r?.ok ? ((await r.json().catch(() => null)) as { ok?: boolean; code?: string } | null) : null;
    if (!w?.ok || !w.code) return void setTimeout(() => void poll(), POLL_MS);
    const x = await fetch('/auth/exchange', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: w.code }) }).catch(() => null);
    if (!x?.ok) return say("The login didn't work. Try again.", true);
    say('Logged in!');
    location.reload();
  };
  setTimeout(() => void poll(), POLL_MS);
}

function randomNonce(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
