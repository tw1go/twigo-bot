import { el } from './reward';

// 📢 A megaphone message (`/m` in the chat; bot items/megaphone.ts) shows to everyone in the middle of the upper part of
// the screen: the megaphone's art, the speaker's name and their words in sky blue (outlined, no box), fading in, held a
// few seconds (longer for longer messages), fading out. One at a time (the next waits its turn). DOM text only (never
// parsed as HTML); clicks go through it.

const HOLD_MS = 5000;
const PER_CHAR_MS = 40; // a long message stays a little longer…
const MAX_MS = 9000; // …up to this
const FADE_MS = 300;

/** A megaphone's (sky blue, the megaphone's art) or a Game Master's (gold, a GM badge). */
type Shout = { name: string; text: string; gm: boolean };

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

  show(name: string, text: string, gm = false): void {
    this.queue.push({ name, text, gm });
    if (!this.running) this.next();
  }

  private next(): void {
    const s = this.queue.shift();
    this.running = !!s;
    if (!s) {
      this.root.hidden = true;
      return;
    }
    const line = el('div', `mg-line${s.gm ? ' mg-gm' : ''}`);
    let mark: HTMLElement;
    if (s.gm) mark = el('span', 'mg-gm-badge', 'GM');
    else if (this.icon) {
      mark = el('img', 'mg-icon') as HTMLImageElement;
      (mark as HTMLImageElement).src = this.icon;
      (mark as HTMLImageElement).alt = '';
    } else mark = el('span', 'mg-icon', '📢');
    line.append(mark, el('b', 'mg-name', s.name), el('span', 'mg-text', s.text));
    this.root.replaceChildren(line);
    this.root.hidden = false;
    const hold = Math.min(MAX_MS, HOLD_MS + s.text.length * PER_CHAR_MS);
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    line.animate([{ opacity: 0, transform: still ? 'none' : 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: FADE_MS, easing: 'ease-out' });
    setTimeout(() => {
      line.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, fill: 'forwards' }).onfinish = () => this.next();
    }, hold);
  }
}
