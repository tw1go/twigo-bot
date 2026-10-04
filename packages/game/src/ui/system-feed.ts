import type { TownSystemLine } from '@mikazuki/shared';

// 📰 The system feed (bottom right): what happens around the server — digs and bets from the Discord commands — as
// plain lines coloured by result (a dig's rarity; won, lost, busted). Same see-through box as the chat, lines
// stacked from the bottom, fading when quiet. Hidden on phones (no room next to the chat and the counters).

const MAX_LINES = 30;
const IDLE_MS = 15_000;

export class SystemFeed {
  private readonly root: HTMLElement;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'system-feed';
    this.root.setAttribute('role', 'log');
    this.root.setAttribute('aria-label', 'Around the server');
    this.root.addEventListener('mouseenter', () => this.wake());
    this.root.addEventListener('mouseleave', () => this.wake());
    document.body.append(this.root);
    this.wake();
  }

  add(line: TownSystemLine): void {
    const row = document.createElement('div');
    row.className = `sf-line sf-${line.kind}`;
    row.dataset.tone = line.tone;
    if (line.tone === 'secret') row.classList.add('prismatic');
    row.textContent = line.text;
    this.root.append(row);
    while (this.root.childElementCount > MAX_LINES) this.root.firstElementChild?.remove();
    this.root.scrollTop = this.root.scrollHeight;
    this.wake();
  }

  /** What happened before you arrived (as the server remembers it). */
  history(lines: TownSystemLine[]): void {
    this.root.replaceChildren();
    for (const l of lines) this.add(l);
  }

  private wake(): void {
    this.root.classList.remove('sf-idle');
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.root.matches(':hover')) return this.wake();
      this.root.classList.add('sf-idle');
    }, IDLE_MS);
  }
}
