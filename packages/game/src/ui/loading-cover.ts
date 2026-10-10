import { LOADING_LINES } from './loading-lines';

// ⏳ The loading screen's last stretch, as a page layer over the game: once the art is in, the town is built behind it
// and it stays up until that settles (TownScene: the world streamed in, the server's first word, other players' looks
// and combat poses built, frames running smoothly), so arriving never shows a stuttering town. It looks like the scene's
// loading screen it takes over from: the loading moon over a full bar, a witty line or some trivia under it. The page's
// UI stays hidden meanwhile (body.title-on; the title card takes it from there).

export interface MoonArt {
  url: string;
  size: [number, number];
  frames: number;
  fps: number;
  loopFrames?: [number, number];
}

export class LoadingCover {
  private readonly root = document.createElement('div');
  private readonly timers: number[] = [];

  constructor(moon: MoonArt | null) {
    this.root.id = 'loading-cover';
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-label', 'Loading');
    const scale = innerWidth >= 960 && innerHeight >= 600 ? 3 : 2; // (as the scene's loading screen)
    const box = document.createElement('div');
    box.className = 'lc-box';
    if (moon) {
      const c = document.createElement('canvas');
      [c.width, c.height] = moon.size;
      c.style.width = `${moon.size[0] * scale}px`;
      c.style.height = `${moon.size[1] * scale}px`;
      c.className = 'lc-moon';
      const img = new Image();
      img.src = moon.url;
      const [from, to] = moon.loopFrames ?? [0, moon.frames - 1];
      let f = from;
      let step = 1;
      const ctx = c.getContext('2d')!;
      this.timers.push(window.setInterval(() => {
        if (!img.complete) return;
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.drawImage(img, f * moon.size[0], 0, moon.size[0], moon.size[1], 0, 0, moon.size[0], moon.size[1]);
        // Forwards, then back again (as the scene's: the loop never jumps).
        if (f + step > to || f + step < from) step = -step;
        f += step;
      }, 1000 / moon.fps));
      box.append(c);
    }
    const bar = document.createElement('div');
    bar.className = 'lc-bar';
    bar.append(document.createElement('span'));
    const line = document.createElement('p');
    line.className = 'lc-line';
    let last = -1;
    const next = () => {
      let i = Math.floor(Math.random() * LOADING_LINES.length);
      if (i === last) i = (i + 1) % LOADING_LINES.length;
      last = i;
      line.textContent = LOADING_LINES[i];
    };
    next();
    this.timers.push(window.setInterval(next, 4500));
    box.append(bar, line);
    this.root.append(box);
    document.body.append(this.root);
    document.body.classList.add('title-on');
  }

  /** What it still waits for (a data attribute, for checking: never shown). */
  waiting(what: string[]): void {
    const v = what.join(' ');
    if (this.root.dataset.waiting !== v) this.root.dataset.waiting = v;
  }

  /** Gone (a quick fade). */
  hide(): void {
    for (const t of this.timers) clearInterval(t);
    this.root.classList.add('lc-out');
    setTimeout(() => this.root.remove(), 250);
  }
}
