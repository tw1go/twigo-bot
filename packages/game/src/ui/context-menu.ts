import { el } from './reward';

// 🖱️ A small right-click menu (the bag's `.iv-menu` look, index.html): rows of actions at a point on the screen, kept on
// screen, some greyed. One per owner (the bag, the equipment panel); hidden by a press anywhere outside it or Escape.
// On a touch screen a long press fires `contextmenu`, so the same menu opens there.

export type MenuRow = [label: string, run: () => void];

/** A long press with a finger (or pen) on `el` runs `fn` at the press (a phone's right click): browsers fire `contextmenu`
 *  on a long press too, but not all of them do on a button, so the menu's owner listens for both. A press that moves
 *  more than a few px or lifts first is a tap. */
export function onLongPress(el: HTMLElement, fn: (x: number, y: number) => void, ms = 500): void {
  let timer = 0;
  let at = { x: 0, y: 0 };
  let fired = -Infinity;
  const stop = () => window.clearTimeout(timer);
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    at = { x: e.clientX, y: e.clientY };
    stop();
    timer = window.setTimeout(() => {
      fired = performance.now();
      fn(at.x, at.y);
    }, ms);
  });
  el.addEventListener('pointermove', (e) => Math.hypot(e.clientX - at.x, e.clientY - at.y) > 8 && stop());
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) el.addEventListener(ev, stop);
  // (The finger lifting after a long press still sends a click where it was, now over the menu: swallowed, so a row
  // under it is never pressed by the lift itself.)
  document.addEventListener('click', (e) => {
    if (performance.now() - fired > 700) return;
    e.stopPropagation();
    e.preventDefault();
  }, true);
}

export class ContextMenu {
  readonly root = el('div', 'iv-menu');

  constructor() {
    this.root.hidden = true;
    this.root.setAttribute('role', 'menu');
    document.body.append(this.root);
    document.addEventListener('pointerdown', (e) => !this.root.contains(e.target as Node) && this.hide());
    document.addEventListener('keydown', (e) => e.key === 'Escape' && this.hide());
  }

  /** The rows at (x, y), kept on screen; `off`: the greyed rows (by index); `titles`: a row's tooltip (why it's greyed). */
  show(items: MenuRow[], off: Set<number>, x: number, y: number, titles: Map<number, string> = new Map()): void {
    this.root.replaceChildren(
      ...items.map(([label, run], i) => {
        const b = el('button', 'iv-menu-item', label);
        b.setAttribute('role', 'menuitem');
        b.disabled = off.has(i);
        const title = titles.get(i);
        if (title) b.title = title;
        b.addEventListener('click', () => {
          this.hide();
          run();
        });
        return b;
      }),
    );
    this.root.hidden = false;
    this.root.style.left = `${Math.round(Math.min(x, innerWidth - this.root.offsetWidth - 8))}px`;
    this.root.style.top = `${Math.round(Math.min(y, innerHeight - this.root.offsetHeight - 8))}px`;
  }

  hide(): void {
    this.root.hidden = true;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }
}
