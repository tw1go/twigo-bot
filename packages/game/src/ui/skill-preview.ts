import type { ClassInfo } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { SKILL_PREVIEWS } from '../combat/skill-previews';
import { GAP_MS, type NumberKind, type Pt, STAGE_H, STAGE_W, type SkillStage } from '../combat/skill-stage';
import { stats } from './class-choice';

// 🎬 A class's skill preview (over the class choice): on the left a small stage at a whole-number scale with your
// character in the class's walk-ready pose facing SE and three invisible enemies along that line (combat/skill-stage.ts);
// on the right the class (name, blurb, weapon, role, damage, stats, gear) and its first 7 skills. The skills play one
// after another and loop, the one playing lit up in the list; clicking a skill plays it next. Damage numbers rise
// over the hits in Jersey 10 (its 19 px steps): gold for a crit, small orange for burns, small mint for menthol.

export interface SkillPreviewOptions {
  /** Builds the stage once the class's poses and fx have loaded (null if they can't be). */
  stage: (cls: ClassInfo) => Promise<SkillStage | null>;
}

export function mountSkillPreview(o: SkillPreviewOptions, c: ClassInfo, host: HTMLElement, back: () => void, choose: () => void): () => void {
  const skills = SKILL_PREVIEWS[c.id] ?? [];
  const root = el('div', 'sp-body');
  const left = el('div', 'sp-stage');
  const numbers = el('div', 'sp-numbers');
  const loading = el('div', 'sp-loading', 'Loading…');
  left.append(loading, numbers);
  const right = el('div', 'sp-info');
  right.append(
    el('div', 'sp-name', c.name),
    el('p', 'sp-blurb', c.blurb),
    facts([
      ['Weapon', c.weapon],
      ['Role', c.role],
      ['Damage', stats(c)],
      ['Gear', c.gear],
    ]),
  );
  const list = el('ol', 'sp-skills');
  const rows = c.skills.map((s, i) => {
    const li = el('li', 'sp-skill');
    const b = el('button', 'sp-skill-button');
    b.append(el('span', 'sp-lv', `Lv ${s.level}`), el('span', 'sp-skill-name', s.name), el('span', 'sp-desc', s.desc));
    b.addEventListener('click', () => {
      playSound('click');
      next = i;
      if (stage && !stage.busy) startNext(performance.now());
    });
    li.append(b);
    list.append(li);
    return li;
  });
  right.append(el('div', 'sp-skills-head', 'Skills'), list);
  const buttons = el('div', 'sp-buttons');
  const backButton = el('button', 'sp-back', 'Back');
  const chooseButton = el('button', 'sp-choose', `Choose ${c.name}`);
  backButton.addEventListener('click', () => back());
  chooseButton.addEventListener('click', () => {
    playSound('click');
    choose();
  });
  buttons.append(backButton, chooseButton);
  root.append(left, right, buttons);
  host.replaceChildren(root);

  let stage: SkillStage | null = null;
  let scale = 2;
  let playing = -1;
  let next = 0;
  let restUntil = 0;
  let raf = 0;
  let gone = false;

  const startNext = (now: number) => {
    if (!stage || !skills.length) return;
    playing = next % skills.length;
    next = playing + 1;
    rows.forEach((r, i) => r.classList.toggle('sp-playing', i === playing));
    stage.play(skills[playing]);
    restUntil = 0;
    void now;
  };
  const tick = (now: number) => {
    if (gone || !stage) return;
    stage.update(now);
    if (!stage.busy) {
      if (!restUntil) {
        stage.rest();
        restUntil = now + GAP_MS; // walk-ready between skills
      } else if (now >= restUntil) startNext(now);
    }
    raf = requestAnimationFrame(tick);
  };

  void o.stage(c).then((s) => {
    if (gone) return;
    if (!s) {
      loading.textContent = "Couldn't load this class's skills.";
      return;
    }
    stage = s;
    // A whole-number scale that fits beside the class's details (2× on a computer, 1× on a phone).
    const fit = () => {
      scale = Math.max(1, Math.min(2, Math.floor((innerWidth - 460) / STAGE_W), Math.floor((innerHeight - 200) / STAGE_H)));
      numbers.style.setProperty('--s', String(scale));
      s.canvas.style.width = `${STAGE_W * scale}px`;
      s.canvas.style.height = `${STAGE_H * scale}px`;
      numbers.style.width = s.canvas.style.width;
      numbers.style.height = s.canvas.style.height;
    };
    s.canvas.className = 'sp-canvas';
    loading.replaceWith(s.canvas);
    fit();
    addEventListener('resize', fit);
    s.onNumber = (at, text, kind) => number(at, text, kind);
    cleanup.push(() => removeEventListener('resize', fit));
    s.update(performance.now());
    startNext(performance.now());
    raf = requestAnimationFrame(tick);
  });

  /** A damage number rising and fading where the hit landed. */
  const number = (at: Pt, text: string, kind: NumberKind) => {
    const n = el('span', `sp-num sp-${kind}`, text);
    n.style.left = `${Math.round(at.x * scale)}px`;
    n.style.top = `${Math.round((at.y - 10) * scale)}px`;
    numbers.append(n);
    n.addEventListener('animationend', () => n.remove());
  };

  const cleanup: (() => void)[] = [];
  return () => {
    gone = true;
    cancelAnimationFrame(raf);
    for (const f of cleanup) f();
    root.remove();
  };
}

function facts(rows: [string, string][]): HTMLElement {
  const dl = el('dl', 'sp-facts');
  for (const [k, v] of rows) dl.append(el('dt', undefined, k), el('dd', undefined, v));
  return dl;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
