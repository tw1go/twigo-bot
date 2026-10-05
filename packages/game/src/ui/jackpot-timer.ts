import { loadJackpot, showJackpot } from './jackpot';
import { el } from './reward';

// 🎰 The jackpot counter (top right, left of the minimap): the pot and the time to the next draw, under a row of
// casino lights, like a little event board. Gold and pulsing in the last 10 minutes, "Drawing…" at the draw, then the
// next one. A click opens the booth. The pot is fetched every minute (and after anything that moves Kowens); the
// countdown ticks every second.

const REFRESH_MS = 60_000;
const SOON_MS = 10 * 60_000;
const AFTER_DRAW_MS = 15_000; // the bot draws, then the next draw is known

/** "8h 04m 09s", "4m 09s": always with seconds, so it visibly ticks. */
function countdown(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  const rest = `${pad(Math.floor((s % 3600) / 60))}m ${pad(s % 60)}s`;
  return h ? `${h}h ${rest}` : rest.replace(/^0/, '');
}

/** `icon`: the coin (or the manifest's jackpot icon) drawn at the HUD's scale. */
export function jackpotTimer(icon: HTMLElement): HTMLElement {
  const box = el('button', 'th-jackpot');
  box.setAttribute('aria-haspopup', 'dialog');
  box.hidden = true; // until the first answer
  const lights = el('span', 'jt-lights');
  lights.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 5; i++) lights.append(el('span', i % 2 ? 'jt-bulb jt-odd' : 'jt-bulb'));
  const pot = el('span', 'jt-pot');
  const time = el('span', 'jt-time');
  const potRow = el('span', 'jt-row jt-pot-row');
  potRow.append(icon, pot);
  box.append(lights, el('span', 'jt-label', 'Jackpot draw'), potRow, time);
  box.addEventListener('click', () => showJackpot());

  let nextDraw = 0;
  let loading = false;
  let askedAt = 0;
  const refresh = async () => {
    if (loading) return;
    loading = true;
    const j = await loadJackpot();
    loading = false;
    if (!j) return;
    nextDraw = j.nextDraw;
    pot.textContent = j.pot.toLocaleString();
    box.hidden = false;
    tick();
  };
  const tick = () => {
    if (!nextDraw) return;
    const left = nextDraw - Date.now();
    time.textContent = left > 0 ? countdown(left) : 'Drawing…';
    box.classList.toggle('jt-soon', left > 0 && left <= SOON_MS);
    box.title = `Jackpot draw: ${pot.textContent} Kowens · next draw ${left > 0 ? `in ${countdown(left)}` : 'now'}`;
    box.setAttribute('aria-label', box.title);
    if (left <= -AFTER_DRAW_MS && Date.now() - askedAt > AFTER_DRAW_MS) {
      askedAt = Date.now(); // the next draw, asked for at most every 15 s until the bot has drawn
      void refresh();
    }
  };
  const onWallet = () => void refresh(); // tickets bought (or Kowens moved)
  const ticking = setInterval(() => (box.isConnected || !nextDraw ? tick() : stop()), 1000);
  const polling = setInterval(() => void refresh(), REFRESH_MS);
  // Stops once the HUD it was in is gone (the HUD is rebuilt, not reused).
  const stop = () => {
    clearInterval(ticking);
    clearInterval(polling);
    window.removeEventListener('mk-wallet', onWallet);
  };
  window.addEventListener('mk-wallet', onWallet);
  void refresh();
  return box;
}
