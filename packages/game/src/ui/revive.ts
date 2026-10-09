// Knocked out (0 HP): "You went unconscious", a countdown to coming back on your own (300 s from the server's
// `reviveIn`), and "Revive now" to come back at once. Either way you're back at the map's way in with full HP and MP;
// the server's 'respawn' closes it. The countdown is worked out from when it should end, not by counting ticks, so a
// tab left in the background (where timers slow down) still shows the right time when you come back. DOM text only.

let timer: number | undefined;

/** mm:ss, never below 0:00. */
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function showRevive(reviveIn: number, reviveNow: () => void): void {
  hideRevive();
  const until = Date.now() + reviveIn;

  const root = document.createElement('div');
  root.id = 'revive';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'You went unconscious');
  const card = document.createElement('div');
  card.className = 'rv-card';
  const title = document.createElement('h2');
  title.textContent = 'You went unconscious';
  const line = document.createElement('p');
  line.className = 'rv-line';
  const count = document.createElement('span');
  count.className = 'rv-count';
  line.append('Revive in ', count);
  const button = document.createElement('button');
  button.className = 'rv-now';
  button.textContent = 'Revive now';
  button.addEventListener('click', () => {
    // One press is enough: the server answers with your respawn, which closes this.
    button.disabled = true;
    button.textContent = 'Reviving…';
    reviveNow();
  });

  const tick = () => {
    const left = until - Date.now();
    count.textContent = clock(left);
    // At 0:00 the server brings you back by itself; until its message lands, say so rather than sit on 0:00.
    if (left <= 0) {
      line.textContent = 'Reviving…';
      button.disabled = true;
      window.clearInterval(timer);
    }
  };
  tick();
  timer = window.setInterval(tick, 250);

  card.append(title, line, button);
  root.append(card);
  document.body.append(root);
  button.focus();
}

/** Back up (a respawn, a reconnect): the pop-up goes. */
export function hideRevive(): void {
  window.clearInterval(timer);
  timer = undefined;
  document.getElementById('revive')?.remove();
}
