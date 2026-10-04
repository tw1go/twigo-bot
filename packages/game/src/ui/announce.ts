import type { TownAnnouncement } from '@mikazuki/shared';

// 📣 Banners floating top centre, below the HUD: a jackpot win (gold, with casino lights) or the owner's notice
// (amber; e.g. maintenance). One at a time, queued; each slides in, stays a while (or until ×), and slides out.

const SHOW_MS: Record<TownAnnouncement['kind'], number> = { jackpot: 9000, notice: 15000 };
const queue: TownAnnouncement[] = [];
let showing = false;

export function announce(a: TownAnnouncement): void {
  queue.push(a);
  if (!showing) next();
}

function next(): void {
  const a = queue.shift();
  showing = !!a;
  if (!a) return;
  const box = document.createElement('div');
  box.className = `announce an-${a.kind}`;
  box.setAttribute('role', 'status');
  if (a.kind === 'jackpot') {
    const lights = document.createElement('div');
    lights.className = 'an-lights';
    lights.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 11; i++) {
      const b = document.createElement('span');
      b.className = i % 2 ? 'an-bulb an-odd' : 'an-bulb';
      lights.append(b);
    }
    box.append(lights);
  }
  const title = document.createElement('div');
  title.className = 'an-title';
  title.textContent = a.title;
  const text = document.createElement('div');
  text.className = 'an-text';
  text.textContent = a.text;
  const close = document.createElement('button');
  close.className = 'an-close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '×';
  box.append(title, text, close);
  document.body.append(box);

  let gone = false;
  const leave = () => {
    if (gone) return;
    gone = true;
    box.classList.add('an-out');
    setTimeout(() => {
      box.remove();
      next();
    }, 300);
  };
  close.addEventListener('click', leave);
  setTimeout(leave, SHOW_MS[a.kind]);
}
