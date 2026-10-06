import { el, showPopup } from './reward';

// The movement tutorial, shown in the reward box the first time a member walks into town (straight from the
// character creator): two boxes side by side, WASD (the keys light up in turn) and right click (the button
// blinks), and a line about doors, benches and chat.

/** A pixel mouse drawn in squares (12 × 18 art pixels), its right button lit. */
export function mouse(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 12 18');
  svg.setAttribute('class', 'tu-mouse');
  svg.setAttribute('aria-hidden', 'true');
  const rect = (x: number, y: number, w: number, h: number, cls: string) => {
    const r = document.createElementNS(ns, 'rect');
    for (const [k, v] of Object.entries({ x, y, width: w, height: h })) r.setAttribute(k, String(v));
    r.setAttribute('class', cls);
    svg.append(r);
  };
  // Body (with stepped corners), the left button, the lit right button, the seam and the wheel.
  rect(2, 0, 8, 18, 'tu-ink');
  rect(1, 1, 10, 16, 'tu-ink');
  rect(0, 3, 12, 12, 'tu-ink');
  rect(1, 3, 10, 12, 'tu-body');
  rect(2, 1, 8, 16, 'tu-body');
  rect(2, 1, 3, 6, 'tu-btn');
  rect(7, 1, 3, 6, 'tu-btn tu-lit');
  rect(1, 7, 10, 1, 'tu-ink');
  rect(5, 1, 2, 6, 'tu-ink');
  rect(5, 2, 2, 3, 'tu-wheel');
  return svg;
}

export function keys(): HTMLElement {
  const grid = el('div', 'tu-keys');
  grid.setAttribute('aria-hidden', 'true');
  ['W', 'A', 'S', 'D'].forEach((k, i) => {
    const key = el('span', `tu-key tu-key-${k.toLowerCase()}`, k);
    key.style.animationDelay = `${i * 0.6}s`;
    grid.append(key);
  });
  return grid;
}

export function panel(picture: Element, title: string, text: string): HTMLElement {
  const box = el('div', 'tu-box');
  const art = el('div', 'tu-art');
  art.append(picture);
  box.append(art, el('div', 'tu-box-title', title), el('div', 'tu-box-text', text));
  return box;
}

export function showMovementTutorial(): Promise<void> {
  const boxes = el('div', 'tu-boxes');
  boxes.append(
    panel(keys(), 'WASD', 'Walk with W A S D (or the arrow keys).'),
    panel(mouse(), 'Right click', 'Right click a spot to walk there. On a phone, tap it.'),
  );
  const tip = el('p', 'tu-tip', 'Left click a door to go in, or a bench to sit. Press Enter to chat. The ? button (top right) explains the rest.');
  return showPopup({ title: 'How to move', body: [boxes, tip], button: 'Got it!', celebrate: false });
}
