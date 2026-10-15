import type { AdventureState, Item, ItemData, TownForgeAction, TownForgeResponse } from '@mikazuki/shared';
import { adventure, itemData, onForge } from '../net/adventure';
import { type GuideAim, guideArrowBox, questArrowShowing, setGuide, uncovered } from './guide-arrow';
import { itemPicture } from './item-tip';
import { LESSONS, type Lesson, type LessonCtx } from './lessons';
import { toast } from './toast';

// 🎓 Runs the lessons (ui/lessons.ts, CONTEXT.md "Lesson"), one at a time. A lesson starts the first time its moment
// comes (looked at TICK_MS apart) and waits in a queue, in the order they came, behind the one running; it doesn't start
// in a fight, while you type or while the quest guide's arrow shows, only once you've been out of a fight CALM_MS. Its
// step is the furthest that applies now; the guide arrow points at the step's target with the step's line in the tip
// box (and a step's drag hint and pulsing slot). Its goal reached, it's done for good (a moment's tip or a toast after);
// the tip box's × ends it for good too. Remembered per character in this browser (localStorage mk_guide_done: lesson
// ids under the character's id). A character this browser first sees past the last guided quest (Just In Time) is a
// veteran: every lesson is marked done for them then, so only new players get them.

const TICK_MS = 250;
const CALM_MS = 3000;
const AFTER_MS = 3000;
const STORE = 'mk_guide_done';
/** The last guided quest: a character first seen past it gets no lessons. */
const VETERAN_AFTER = 'tanod-02';

export interface LessonRunnerHooks {
  /** The character's id (lessons are remembered per character). */
  who: string;
  /** Since when you've been out of a fight (performance.now ms), or null while in one. */
  calmSince: () => number | null;
}

const touch = () => matchMedia('(hover: none) and (pointer: coarse)').matches;
const typing = () => {
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
};

function loadDone(): Record<string, string[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? '{}') as unknown;
    return raw && typeof raw === 'object' ? (raw as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

function saveDone(all: Record<string, string[]>): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    // a private window: they come back next time
  }
}

export function mountLessons(h: LessonRunnerHooks): () => void {
  const all = loadDone();
  const s0 = adventure();
  // First seen here: past the guided quests already, a veteran (every lesson done).
  if (!all[h.who] && s0) {
    all[h.who] = s0.quests.done.includes(VETERAN_AFTER) ? LESSONS.map((l) => l.id) : [];
    saveDone(all);
  }
  const done = new Set(all[h.who] ?? []);
  const finish = (id: string) => {
    done.add(id);
    const now = loadDone();
    now[h.who] = [...new Set([...(now[h.who] ?? []), id])];
    saveDone(now);
  };

  const queue: { lesson: Lesson; memo: Record<string, string>; since: number; running: boolean }[] = [];
  const heard: { a: TownForgeAction; r: TownForgeResponse; at: number }[] = [];
  const offForge = onForge((a, r) => heard.push({ a, r, at: performance.now() }));
  let after: { aim: GuideAim; until: number } | null = null;
  const ghost = new DragHint();
  let pulsing: HTMLElement | null = null;
  // A pulsing hotbar slot lifts the hotbar over the panels (the bag can cover it on a short screen).
  const pulse = (el: HTMLElement | null) => {
    if (pulsing === el) return;
    pulsing?.classList.remove('gd-pulse');
    pulsing = el;
    el?.classList.add('gd-pulse');
    document.body.classList.toggle('hb-lesson', !!el);
  };

  const ctx = (s: AdventureState, D: ItemData, memo: Record<string, string>, since: number): LessonCtx => ({
    s,
    D,
    touch: touch(),
    memo,
    forged: (yes) => heard.some((x) => x.at >= since && yes(x.a, x.r)),
  });

  let aim: GuideAim | null = null;
  setGuide('lesson', () => (after && performance.now() < after.until ? after.aim : aim));

  const tick = () => {
    const s = adventure();
    const D = itemData();
    if (!s || !D) return;
    const now = performance.now();
    // Each lesson's moment, once (it waits in the queue).
    for (const lesson of LESSONS) {
      if (done.has(lesson.id) || queue.some((q) => q.lesson === lesson)) continue;
      const c = ctx(s, D, {}, now);
      if (lesson.starts(c)) queue.push({ lesson, memo: lesson.note?.(c) ?? {}, since: now, running: false });
    }
    // The first in the queue, unless it waits on the player (and another can run meanwhile).
    const free = queue.find((q) => !q.lesson.blocked?.(ctx(s, D, q.memo, q.since)));
    const cur = free ?? queue[0];
    aim = null;
    if (!cur) return void (ghost.stop(), pulse(null));
    const c = ctx(s, D, cur.memo, cur.since);
    // Its goal reached (even before it ran): done for good, with its tip after.
    if (cur.lesson.goal(c)) {
      queue.splice(queue.indexOf(cur), 1);
      finish(cur.lesson.id);
      ghost.stop();
      pulse(null);
      if (!cur.running) return;
      const then = cur.lesson.after?.(c);
      if (then && 'toast' in then) toast(then.toast, 3200, 'good');
      else if (then?.target) after = { aim: { target: then.target, type: 'main', sides: ['left', 'right', 'below', 'above'], tip: then.line }, until: now + AFTER_MS };
      return;
    }
    if (!cur.running) {
      const calm = h.calmSince();
      if (calm === null || now - calm < CALM_MS || typing() || questArrowShowing()) return void (ghost.stop(), pulse(null));
      cur.running = true;
    }
    // The furthest step that applies, with a target to point at.
    const step = [...cur.lesson.steps].reverse().find((st) => st.applies(c) && !!st.target(c));
    const target = step?.target(c) ?? null;
    if (!step || !target) return void (ghost.stop(), pulse(null));
    aim = {
      target,
      type: 'main',
      sides: step.sides ?? ['right', 'left', 'below', 'above'],
      tip: step.line(c),
      onClose: () => {
        // ×: this lesson ends for good.
        queue.splice(queue.indexOf(cur), 1);
        finish(cur.lesson.id);
        aim = null;
        ghost.stop();
        pulse(null);
      },
    };
    pulse(questArrowShowing() ? null : (step.pulse?.(c) ?? null));
    const drag = questArrowShowing() || !guideArrowBox() ? null : step.drag?.(c);
    if (drag?.from && drag.to && uncovered(drag.from)) ghost.show(drag.item, drag.from, drag.to);
    else ghost.stop();
  };
  const timer = window.setInterval(tick, TICK_MS);
  return () => {
    clearInterval(timer);
    offForge();
    ghost.stop();
    pulse(null);
    setGuide('lesson', null);
  };
}

/** A faded copy of an item's picture sliding from where it is to where it goes (about a second, a short rest, again). */
class DragHint {
  private el: HTMLElement | null = null;
  private anim: Animation | null = null;
  private key = '';

  show(item: Item, from: HTMLElement, to: HTMLElement): void {
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const key = `${item.uid}:${Math.round(a.left)},${Math.round(a.top)}>${Math.round(b.left)},${Math.round(b.top)}`;
    if (key === this.key) return;
    this.stop();
    this.key = key;
    const el = document.createElement('div');
    el.id = 'guide-drag';
    el.append(itemPicture(item, 'icon', 2));
    document.body.append(el);
    this.el = el;
    const box = el.getBoundingClientRect();
    const x0 = a.left + a.width / 2 - box.width / 2;
    const y0 = a.top + a.height / 2 - box.height / 2;
    const x1 = b.left + b.width / 2 - box.width / 2;
    const y1 = b.top + b.height / 2 - box.height / 2;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.style.transform = `translate(${x1}px, ${y1}px)`;
      return;
    }
    this.anim = el.animate(
      [
        { transform: `translate(${x0}px, ${y0}px)`, opacity: 0 },
        { transform: `translate(${x0}px, ${y0}px)`, opacity: 0.65, offset: 0.1 },
        { transform: `translate(${x1}px, ${y1}px)`, opacity: 0.65, offset: 0.7 },
        { transform: `translate(${x1}px, ${y1}px)`, opacity: 0, offset: 0.85 },
        { transform: `translate(${x1}px, ${y1}px)`, opacity: 0 },
      ],
      { duration: 1500, iterations: Infinity, easing: 'ease-in-out' },
    );
  }

  stop(): void {
    this.anim?.cancel();
    this.anim = null;
    this.el?.remove();
    this.el = null;
    this.key = '';
  }
}
