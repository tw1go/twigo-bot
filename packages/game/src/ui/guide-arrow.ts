import type { GuideManifest } from '../assets/types';

// 👉 The guide arrow (CONTEXT.md "Guide arrow"): the bobbing arrow beside something to press, over the HUD and every
// panel, never taking a click (pointer-events: none). Two owners ask for it: the quest guide (ui/quest-guide.ts: the
// quest button, Report) and a lesson (ui/lessons.ts: its step's target, with a tip box beside the arrow). One arrow at
// a time, and the quest guide's comes first. Each owner gives a resolver, asked again every few frames, so the arrow
// follows its target as the HUD moves, the window is resized or the bag re-renders; it hides while its target isn't on
// screen or something covers it (a window opened over it: whatever is on top at the target's middle isn't it). The art
// (manifest guide.arrow, main violet or side yellow by the quest's type): 24 × 24 frames, 4 across (the bob baked in,
// 6 fps), rows down, up, left, right, the tip on the edge it points to; drawn at 2×.

/** Where the arrow sits by its target (it points back at it). */
export type GuideSide = 'left' | 'right' | 'above' | 'below';

export interface GuideAim {
  target: HTMLElement;
  type: 'main' | 'side';
  /** The sides to try, in order: the first where the arrow fits on screen. */
  sides: GuideSide[];
  /** A lesson's tip box beside the arrow (with an ×), or none. */
  tip?: string;
  /** The tip box's ×. */
  onClose?: () => void;
}

/** Asked every few frames: what to point at now, or nothing. */
export type GuideResolver = () => GuideAim | null;

const SCALE = 2;
const GAP = 2;
const TICK_MS = 120;
/** Which way the arrow points from each side (its sheet's row). */
const POINTS: Record<GuideSide, 'down' | 'up' | 'left' | 'right'> = { left: 'right', right: 'left', above: 'down', below: 'up' };

let art: GuideManifest | null = null;
let url: (file: string) => string = (f) => f;
const owners: { quest: GuideResolver | null; lesson: GuideResolver | null } = { quest: null, lesson: null };
let arrow: HTMLElement | null = null;
let tip: HTMLElement | null = null;
let tipText: HTMLElement | null = null;
let onTipClose: (() => void) | null = null;
let showing: 'quest' | 'lesson' | null = null;
let colours: { main: string; side: string } = { main: '#B794F6', side: '#FCDA4A' };
let timer = 0;

/** Starts the arrow (once a town is up): its art and the item frame for the tip box. */
export function mountGuideArrow(guide: GuideManifest, assetUrl: (file: string) => string, frame: { url: string; slice: number } | null, questColours?: { main: string; side: string }): void {
  art = guide;
  if (questColours) colours = questColours;
  url = assetUrl;
  if (!arrow) {
    arrow = document.createElement('div');
    arrow.id = 'guide-arrow';
    arrow.hidden = true;
    arrow.setAttribute('aria-hidden', 'true');
    tip = document.createElement('div');
    tip.id = 'guide-tip';
    tip.hidden = true;
    tip.setAttribute('role', 'status');
    tipText = document.createElement('span');
    const x = document.createElement('button');
    x.className = 'gt-close';
    x.type = 'button';
    x.textContent = '×';
    x.setAttribute('aria-label', 'Stop this tip');
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      onTipClose?.();
    });
    tip.append(tipText, x);
    document.body.append(arrow, tip);
  }
  if (frame && tip) {
    tip.classList.add('gt-framed');
    tip.style.setProperty('--frame', `url("${frame.url}")`);
    tip.style.setProperty('--slice', String(frame.slice));
  }
  clearInterval(timer);
  timer = window.setInterval(place, TICK_MS);
  addEventListener('resize', place);
  place();
}

/** An owner's resolver (null: it wants nothing). */
export function setGuide(owner: 'quest' | 'lesson', resolve: GuideResolver | null): void {
  owners[owner] = resolve;
  place();
}

/** Whether the quest guide's arrow is on screen now (a lesson waits while it is). */
export const questArrowShowing = (): boolean => showing === 'quest';

/** The arrow's box on screen, or null while it's hidden (a lesson's drag hint starts beside it). */
export function guideArrowBox(): DOMRect | null {
  return arrow && !arrow.hidden ? arrow.getBoundingClientRect() : null;
}

/** Whether `el` is on screen and nothing is drawn over its middle (a window opened over it). */
export function uncovered(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
  const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
  if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) return false;
  const top = document.elementFromPoint(x, y);
  return !!top && (top === el || el.contains(top) || top.contains(el));
}

/** Covering the game while taking no clicks, so `uncovered` can't see it: the quest map (Tab), the loading cover and
 *  title card (body.title-on), the casino and the arena (body.town-locked). */
const overlaid = () => !!document.querySelector('#quest-map:not([hidden])') || document.body.classList.contains('title-on') || document.body.classList.contains('town-locked');

function place(): void {
  if (!arrow || !tip || !art) return;
  if (overlaid()) {
    arrow.hidden = true;
    tip.hidden = true;
    showing = null;
    return;
  }
  const quest = owners.quest?.() ?? null;
  const questOn = !!quest && uncovered(quest.target);
  const lesson = questOn ? null : (owners.lesson?.() ?? null);
  const aim = questOn ? quest : lesson && uncovered(lesson.target) ? lesson : null;
  showing = aim ? (aim === quest ? 'quest' : 'lesson') : null;
  if (!aim) {
    arrow.hidden = true;
    tip.hidden = true;
    return;
  }
  const [fw, fh] = art.arrow.frame;
  const w = fw * SCALE;
  const h = fh * SCALE;
  const r = aim.target.getBoundingClientRect();
  const spot = (side: GuideSide) => {
    if (side === 'right') return { x: r.right + GAP, y: r.top + r.height / 2 - h / 2 };
    if (side === 'left') return { x: r.left - GAP - w, y: r.top + r.height / 2 - h / 2 };
    if (side === 'below') return { x: r.left + r.width / 2 - w / 2, y: r.bottom + GAP };
    return { x: r.left + r.width / 2 - w / 2, y: r.top - GAP - h };
  };
  const fits = (p: { x: number; y: number }) => p.x >= 0 && p.y >= 0 && p.x + w <= innerWidth && p.y + h <= innerHeight;
  const side = aim.sides.find((s) => fits(spot(s))) ?? aim.sides[0] ?? 'right';
  const at = spot(side);
  const row = art.arrow.rows.indexOf(POINTS[side]);
  arrow.hidden = false;
  arrow.style.backgroundImage = `url("${url(art.arrow.file.replace('{type}', aim.type))}")`;
  arrow.style.setProperty('--row', String(Math.max(0, row)));
  arrow.style.left = `${Math.round(at.x)}px`;
  arrow.style.top = `${Math.round(at.y)}px`;

  // A lesson's tip box: beyond the arrow (away from its target), or across it when that would run off the screen.
  if (!aim.tip) {
    tip.hidden = true;
    onTipClose = null;
    return;
  }
  if (tipText!.textContent !== aim.tip) tipText!.textContent = aim.tip;
  tip.style.setProperty('--quest', colours[aim.type]);
  onTipClose = aim.onClose ?? null;
  tip.hidden = false;
  const box = tip.getBoundingClientRect();
  const M = 8;
  const beyond = (s: GuideSide) => {
    if (s === 'right') return { x: at.x + w + 4, y: at.y + h / 2 - box.height / 2 };
    if (s === 'left') return { x: at.x - 4 - box.width, y: at.y + h / 2 - box.height / 2 };
    if (s === 'below') return { x: at.x + w / 2 - box.width / 2, y: at.y + h + 4 };
    return { x: at.x + w / 2 - box.width / 2, y: at.y - 4 - box.height };
  };
  const inside = (p: { x: number; y: number }) => p.x >= M && p.y >= M && p.x + box.width <= innerWidth - M && p.y + box.height <= innerHeight - M;
  const flip: Record<GuideSide, GuideSide[]> = { right: ['right', 'below', 'above'], left: ['left', 'below', 'above'], below: ['below', 'right', 'left'], above: ['above', 'right', 'left'] };
  const t = flip[side].map(beyond).find(inside) ?? beyond(side);
  tip.style.left = `${Math.round(Math.min(Math.max(t.x, M), innerWidth - M - box.width))}px`;
  tip.style.top = `${Math.round(Math.min(Math.max(t.y, M), innerHeight - M - box.height))}px`;
}
