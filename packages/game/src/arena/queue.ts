import { el } from '../ui/reward';
import type { PlayerChannel } from './channel';

// ✊ Waiting for a Vs Player match: a small bar at the top ("Matchmaking in progress…", the time waited and ×) while the
// player walks around town as usual. × leaves the queue. When the match starts the
// bar goes and the match screen opens. One at a time: queueing again replaces it.

let current: { stop: () => void } | null = null;

/** Takes the bar down (another match started; the server has dropped the queue). */
export function stopQueue(): void {
  current?.stop();
}

export function showQueue(channel: PlayerChannel, onMatched: () => void): void {
  current?.stop();
  const bar = el('div');
  bar.id = 'arena-queue';
  bar.setAttribute('role', 'status');
  const time = el('span', 'aq-time', '0:00');
  const close = el('button', 'aq-close', '×');
  close.type = 'button';
  close.title = 'Stop matchmaking';
  close.setAttribute('aria-label', 'Stop matchmaking');
  bar.append(el('span', 'aq-dot'), el('span', 'aq-text', 'Matchmaking in progress…'), time, close);
  document.body.append(bar);
  const since = Date.now();
  const tick = setInterval(() => {
    const s = Math.floor((Date.now() - since) / 1000);
    time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 1000);
  const stopListening = channel.listen((m) => {
    if (m.t !== 'arena-start') return;
    stop();
    channel.push(m); // the match screen's first message
    onMatched();
  });
  const stop = () => {
    clearInterval(tick);
    stopListening();
    bar.remove();
    if (current?.stop === stop) current = null;
  };
  close.addEventListener('click', () => {
    stop();
    channel.send({ t: 'arena-cancel' });
  });
  current = { stop };
}
