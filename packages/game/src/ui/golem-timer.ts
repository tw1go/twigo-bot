import { el } from './reward';

// 🗿 The golem timer (the Slums only; top right beside the jackpot counter, on phones under it): the time to the field
// boss's next rise on its own, pulsing in the last `warnMinutes` (when the "stirring" line comes), and while it's up
// "Awake! Go to the pit" (short, so the box keeps about the countdown's width). TownScene feeds it from the town's `mobs` and `golem` messages (their `riseIn`: ms from
// when they were sent, so a player's clock being off doesn't matter). Hidden until the first one, so elsewhere.

type GolemTimer = { name: string; warnMs: number; riseAt: number; awake: boolean };

let state: GolemTimer | null = null;
let render: () => void = () => {};

/** What the server said: the boss's name and warning minutes (map.boss), ms until its next rise, whether it's up now. */
export function setGolemTimer(name: string, warnMinutes: number, riseIn: number, awake: boolean): void {
  state = { name, warnMs: warnMinutes * 60_000, riseAt: Date.now() + riseIn, awake };
  render();
}

/** "1h 23m 05s", "4m 09s": with seconds, so it visibly ticks (as the jackpot counter). */
function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  const rest = `${pad(Math.floor((s % 3600) / 60))}m ${pad(s % 60)}s`;
  return h ? `${h}h ${rest}` : rest.replace(/^0/, '');
}

/** `head`: the golem's head (manifest ui.golemHead), on the box's left; none: just the words. */
export function golemTimer(head: string | null): HTMLElement {
  const box = el('div', 'th-jackpot th-golem');
  box.setAttribute('role', 'status');
  box.hidden = true;
  const label = el('span', 'jt-label');
  const line = el('span', 'jt-time gt-line');
  if (head) {
    const img = el('img', 'gt-head');
    img.src = head;
    img.alt = '';
    box.classList.add('gt-headed');
    box.append(img);
  }
  box.append(label, line);
  render = () => {
    box.hidden = !state;
    if (!state) return;
    const left = state.riseAt - Date.now();
    label.textContent = state.name;
    // Past its time without word yet: it's rising (the 'rise' message is on its way).
    line.textContent = state.awake ? 'Awake! Go to the pit' :left > 0 ? `Rises in ${countdown(left)}` : 'Rising…';
    box.classList.toggle('gt-awake', state.awake);
    box.classList.toggle('jt-soon', !state.awake && left > 0 && left <= state.warnMs);
    box.title = state.awake ? `${state.name} is awake in the Golem Pit` : `${state.name}: ${line.textContent}`;
    box.setAttribute('aria-label', box.title);
  };
  const ticking = setInterval(() => (box.isConnected ? render() : clearInterval(ticking)), 1000);
  render();
  return box;
}
