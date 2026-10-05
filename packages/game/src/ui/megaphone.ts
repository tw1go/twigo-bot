import { el } from './reward';

// 📢 A megaphone message (`/m` in the chat; bot items/megaphone.ts) runs across everyone's screen: a sky-blue strip in
// the upper part of the screen with the speaker's megaphone, name and words sliding from the right edge off the left.
// One at a time (the next waits its turn). Reduced motion: it stands still in the middle for a few seconds. DOM text
// only (never parsed as HTML); clicks go through it.

const SPEED = 160; // screen px a second
const STILL_MS = 6000;

type Shout = { name: string; text: string };

export class MegaphoneBanner {
  private readonly root = el('div');
  private readonly queue: Shout[] = [];
  private running = false;

  /** `icon`: the megaphone's item art (manifest items.megaphone), or null for the emoji. */
  constructor(private readonly icon: string | null) {
    this.root.id = 'megaphone';
    this.root.setAttribute('role', 'status');
    this.root.hidden = true;
    document.body.append(this.root);
  }

  show(name: string, text: string): void {
    this.queue.push({ name, text });
    if (!this.running) this.next();
  }

  private next(): void {
    const s = this.queue.shift();
    this.running = !!s;
    if (!s) {
      this.root.hidden = true;
      return;
    }
    const line = el('div', 'mg-line');
    let mark: HTMLElement;
    if (this.icon) {
      mark = el('img', 'mg-icon') as HTMLImageElement;
      (mark as HTMLImageElement).src = this.icon;
      (mark as HTMLImageElement).alt = '';
    } else mark = el('span', 'mg-icon', '📢');
    line.append(mark, el('b', 'mg-name', s.name), el('span', 'mg-text', s.text));
    this.root.replaceChildren(line);
    this.root.hidden = false;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      line.classList.add('mg-still');
      setTimeout(() => this.next(), STILL_MS);
      return;
    }
    // From just off the right edge to just off the left, at a steady speed whatever the length.
    const W = window.innerWidth;
    const width = line.getBoundingClientRect().width;
    const ms = ((W + width) / SPEED) * 1000;
    const run = line.animate([{ transform: `translateX(${W}px)` }, { transform: `translateX(${-width}px)` }], { duration: ms, easing: 'linear', fill: 'forwards' });
    run.onfinish = () => this.next();
  }
}
