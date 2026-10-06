import type { TownRace } from '@mikazuki/shared';
import { onRace, race, raceNow } from '../net/race';
import { el } from './reward';
import { showRaceBet } from './race-bet';

// 🏁 The race box (top right, beside the jackpot counter; on phones under it): while a Mosang race is on, a little
// event board saying when the bets close, that they're off, then who won. A click opens the bet pop-up
// (ui/race-bet.ts). Hidden when there's no race.

/** "1:23" */
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** A Mosang's name from her NPC id ("marites" → "Aling Marites"; the race box and the bet pop-up). */
export const mosangName = (id: string) => `Aling ${id[0].toUpperCase()}${id.slice(1)}`;

/** What the box says now. */
function status(r: TownRace): string {
  const now = raceNow();
  if (!r.run || now < r.closesAt) return `Bets close in ${clock(r.closesAt - now)}`;
  if (now < r.run.endsAt) return "They're off! 🏃‍♀️";
  const tie = r.run.tie >= 0 ? ` & ${mosangName(r.runners[r.run.tie]).replace('Aling ', '')}` : '';
  return `🏆 ${mosangName(r.runners[r.run.winner]).replace('Aling ', '')}${tie} won!`;
}

export function raceBox(): HTMLElement {
  const box = el('button', 'th-jackpot th-race');
  box.setAttribute('aria-haspopup', 'dialog');
  const lights = el('span', 'jt-lights');
  lights.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 5; i++) lights.append(el('span', i % 2 ? 'jt-bulb jt-odd' : 'jt-bulb'));
  const line = el('span', 'jt-time rc-line');
  box.append(lights, el('span', 'jt-label', '🏁 Mosang race'), line);
  box.addEventListener('click', () => showRaceBet());
  const render = () => {
    const r = race();
    box.hidden = !r;
    if (!r) return;
    line.textContent = status(r);
    box.classList.toggle('jt-soon', !r.run && r.closesAt - raceNow() <= 30_000);
    box.title = `Mosang race: ${line.textContent}. Click to bet or see the runners.`;
    box.setAttribute('aria-label', box.title);
  };
  const off = onRace(render);
  const ticking = setInterval(() => (box.isConnected ? render() : (clearInterval(ticking), off())), 1000);
  render();
  return box;
}
