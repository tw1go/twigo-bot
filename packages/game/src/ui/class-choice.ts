import type { ClassInfo } from '@mikazuki/shared';
import { playSound } from '../audio/sound';

// 🗡️ Choosing a class (the Tanod's quest, A Weapon for the Town): six cards in classes.json order, each with the class
// badge, your own character with the class's resting weapon at 2× (facing SE or SW, turning between them now and then
// and sometimes walking a few steps on the spot), its name, role, damage type and stats. A card opens the skill
// preview (ui/skill-preview.ts) over the window; there, Choose {class} asks "Become a {class}?" and Yes saves it. Closing the window without choosing is fine: the quest waits on "Choose your class".

export interface ClassChoiceOptions {
  classes: ClassInfo[];
  /** A class badge's URL (16, 32 or 64 px). */
  badge: (cls: string, size: 16 | 32 | 64) => string;
  /** The window frame (the inventory's). */
  frame: { url: string; slice: number } | null;
  /** Draws your character resting with the class's weapon into a 64x64 canvas (frame `f` of idle or walk, `t` ms). */
  drawResting: (ctx: CanvasRenderingContext2D, cls: string, anim: 'idle' | 'walk', dir: 'se' | 'sw', f: number, t: number) => void;
  idle: { frames: number; fps: number };
  walk: { frames: number; fps: number };
  /** Opens the class's skill preview in `host` (over the cards); `back` returns to the cards, `choose` asks to confirm. */
  preview: (cls: ClassInfo, host: HTMLElement, back: () => void, choose: () => void) => () => void;
  /** Yes was pressed: true once it's saved (then everything closes). */
  onChoose: (cls: ClassInfo) => Promise<boolean>;
  onClose: () => void;
}

const CARD_PX = 2;
let close: (() => void) | null = null;

export const classChoiceOpen = () => !!close;

export function openClassChoice(o: ClassChoiceOptions): void {
  close?.();
  const root = el('div');
  root.id = 'class-choice';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Choose your class');
  const win = el('div', 'cc-window');
  if (o.frame) {
    win.classList.add('cc-framed');
    win.style.setProperty('--frame', `url("${o.frame.url}")`);
    win.style.setProperty('--slice', String(o.frame.slice));
  }
  const head = el('div', 'cc-head');
  const x = el('button', 'cc-close', '×');
  x.setAttribute('aria-label', 'Close');
  x.addEventListener('click', () => done());
  head.append(el('span', 'cc-heading', 'Choose your class'), x);
  const grid = el('div', 'cc-grid');
  /** Each figure's own little life: which way it faces, and whether it's walking on the spot (until when). */
  type Life = { ctx: CanvasRenderingContext2D; cls: string; dir: 'se' | 'sw'; walkFrom: number; walkUntil: number; nextAt: number };
  const canvases: Life[] = [];
  const later = (now: number) => now + 1800 + Math.random() * 3200;
  for (const c of o.classes) {
    const card = el('button', 'cc-card');
    card.setAttribute('aria-label', `${c.name}: ${c.role}`);
    const badge = el('img', 'cc-badge');
    badge.src = o.badge(c.id, 64);
    badge.alt = '';
    const canvas = el('canvas', 'cc-figure');
    canvas.width = canvas.height = 64;
    canvas.style.width = canvas.style.height = `${64 * CARD_PX}px`;
    canvases.push({ ctx: canvas.getContext('2d')!, cls: c.id, dir: Math.random() < 0.5 ? 'se' : 'sw', walkFrom: 0, walkUntil: 0, nextAt: later(performance.now()) });
    card.append(badge, canvas, el('span', 'cc-name', c.name), el('span', 'cc-role', c.role), el('span', 'cc-stats', stats(c)));
    card.addEventListener('click', () => showPreview(c));
    grid.append(card);
  }
  const host = el('div', 'cc-preview-host');
  host.hidden = true;
  win.append(head, grid, host);
  root.append(win);
  document.body.append(root);
  playSound('click');

  // The figures idle, now and then turn (SE ↔ SW) or walk a few steps on the spot, each on its own.
  let raf = 0;
  const start = performance.now();
  const tick = (now: number) => {
    const t = now - start;
    for (const l of canvases) {
      if (now >= l.nextAt) {
        if (Math.random() < 0.4) {
          l.walkFrom = now;
          l.walkUntil = now + 900 + Math.random() * 900;
        } else l.dir = l.dir === 'se' ? 'sw' : 'se';
        l.nextAt = later(now);
      }
      const walking = now < l.walkUntil;
      const a = walking ? o.walk : o.idle;
      const f = Math.floor((((walking ? now - l.walkFrom : t) / 1000) * a.fps)) % a.frames;
      l.ctx.clearRect(0, 0, 64, 64);
      o.drawResting(l.ctx, l.cls, walking ? 'walk' : 'idle', l.dir, f, t);
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  let closePreview: (() => void) | null = null;
  function showPreview(c: ClassInfo): void {
    playSound('click');
    grid.hidden = true;
    head.hidden = true;
    host.hidden = false;
    closePreview?.();
    closePreview = o.preview(c, host, back, () => confirm(c));
  }
  function back(): void {
    closePreview?.();
    closePreview = null;
    host.replaceChildren();
    host.hidden = true;
    grid.hidden = false;
    head.hidden = false;
  }
  function confirm(c: ClassInfo): void {
    root.querySelector('.cc-confirm')?.remove();
    const box = el('div', 'cc-confirm');
    box.setAttribute('role', 'alertdialog');
    const yes = el('button', 'cc-yes', 'Yes');
    const no = el('button', 'cc-no', 'Not yet');
    const row = el('div', 'cc-confirm-row');
    row.append(yes, no);
    box.append(el('div', 'cc-confirm-text', `Become a ${c.name}?`), row);
    no.addEventListener('click', () => box.remove());
    yes.addEventListener('click', async () => {
      yes.disabled = no.disabled = true;
      if (await o.onChoose(c)) done(true);
      else {
        box.remove();
        playSound('error');
      }
    });
    win.append(box);
    yes.focus();
  }

  const keys = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    const confirmBox = root.querySelector('.cc-confirm');
    if (confirmBox) confirmBox.remove();
    else if (!host.hidden) back();
    else done();
  };
  document.addEventListener('keydown', keys, true);
  root.addEventListener('pointerdown', (e) => e.target === root && done()); // a click on the dimmed town

  function done(chosen = false): void {
    if (close !== done) return;
    close = null;
    cancelAnimationFrame(raf);
    closePreview?.();
    document.removeEventListener('keydown', keys, true);
    root.remove();
    if (!chosen) o.onClose();
  }
  close = done;
}

/** "Physical · DEX / INT" */
export const stats = (c: ClassInfo) => `${c.damage} · ${c.mainStat}${c.secondStat ? ` / ${c.secondStat}` : ''}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
