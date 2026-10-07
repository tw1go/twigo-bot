import type { ClassInfo } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { MOBILITY_PREVIEWS, SKILL_PREVIEWS } from '../combat/skill-previews';
import { GAP_MS, STAGE_H, STAGE_W, type Skill, type SkillStage } from '../combat/skill-stage';
import { itemArt, isRarity } from './item-art';
import { toast } from './toast';

// ⚔️ The hotbar, bottom centre (members, not on phones): two rows of slots in the bag's slot art.
//   Bottom row: 10 skill slots (keys 1–0), then 3 for potions and other usables (keys - = `).
//   Top row: 13 more (Ctrl+1–0, Ctrl+- Ctrl+= Ctrl+`), for skills or usables.
// Skills come from the Skills panel on the right of the screen (the K button at the bar's left, or K): each skill
// with its description, played on a small stage while hovered (the class choice's preview, combat/skill-stage.ts);
// drag one onto a slot, or click it and then a slot. Potions are dragged in from the bag. Drag a slot onto another to swap them; drag it off the bar (or
// right-click it) to empty it. Per class, saved in this browser (localStorage `mk_hotbar`); a class's first bar has
// its skills in order. Skills show their icon (manifest ui.skillIcons) where there is one, else their initials over the
// class badge. Move skills work in town (onSkill: world/mobility.ts) and their slots show the cooldown as a
// shrinking pie with the seconds left; the rest wait for combat. Skills have no icons yet: their
// initials over the class badge stand in.

export interface HotbarOptions {
  /** The bag's slot art (nine-slice), and its selected look. */
  slot: { url: string; picked: string; slice: number } | null;
  /** A class badge (32 px). */
  badge: (cls: string) => string;
  /** A skill's key or click: its cooldown in seconds once used, 'no' if it can't go now, undefined if it has no use
   *  in town (yet). */
  onSkill?: (name: string) => number | 'no' | undefined;
  /** Whether a skill does something here (the move skills in town); the others are shown dark. */
  usable?: (name: string) => boolean;
  /** A skill's icon (32 px), or null: its initials over the class badge stand in. */
  icon?: (cls: string, skill: string) => string | null;
  /** The preview stage for a class (built once its poses and fx have loaded). */
  stage?: (cls: ClassInfo) => Promise<SkillStage | null>;
}

type SkillEntry = { t: 'skill'; name: string };
type ItemEntry = { t: 'item'; id: string; name: string; emoji: string; rarity: string };
type Entry = SkillEntry | ItemEntry | null;
type Row = 'top' | 'main' | 'util';
interface Layout {
  top: Entry[];
  main: Entry[];
  util: Entry[];
}

const SIZE: Record<Row, number> = { top: 13, main: 10, util: 3 };
const MAIN_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const UTIL_KEYS = ['-', '=', '`'];
const TOP_KEYS = [...MAIN_KEYS, ...UTIL_KEYS];
/** event.code → the slot key, so Shift or a keyboard layout doesn't change what a key does. */
const CODE_KEY: Record<string, string> = {
  Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Digit5: '5', Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9', Digit0: '0',
  Minus: '-', Equal: '=', Backquote: '`',
};
const shown = (key: string) => (key === '`' ? '~' : key);
const DRAG = 'application/x-mk-hotbar';
const STORE = 'mk_hotbar';

/** What a row takes: the bottom row's first ten are for skills, its last three for usables, the top row either. */
const fits = (row: Row, e: Entry) => !e || row === 'top' || (row === 'main' ? e.t === 'skill' : e.t === 'item');

/** Bag items that can go on the bar (potions for now). */
export const hotbarItem = (kind: string) => kind === 'potion';
/** Bag cells call this as a usable is dragged: the bar takes it. */
export function hotbarDragItem(e: DragEvent, it: { id: string; name: string; emoji: string; rarity: string }): void {
  e.dataTransfer?.setData(DRAG, JSON.stringify({ entry: { t: 'item', id: it.id, name: it.name, emoji: it.emoji, rarity: it.rarity } }));
}

export class Hotbar {
  readonly root = el('div');
  private readonly book = el('button', 'hb-book');
  private readonly list = el('div');
  private readonly rows = el('div', 'sb-rows');
  private readonly stageBox = el('div', 'sb-stage');
  private readonly numbers = el('div', 'sp-numbers');
  private stage: { cls: string; stage: SkillStage | null } | null = null;
  /** The skill under the pointer (played on the stage, again and again). */
  private hovered: Skill | null = null;
  private restUntil = 0;
  private stageRaf = 0;
  /** Skills cooling down: when they started and when they're ready (performance.now ms). */
  private readonly cds = new Map<string, { from: number; until: number }>();
  private cdRaf = 0;
  private readonly cells: Record<Row, HTMLButtonElement[]> = { top: [], main: [], util: [] };
  private cls: ClassInfo | null = null;
  private layout: Layout = blank();
  /** A skill clicked in the list, waiting for a slot click. */
  private picked: SkillEntry | null = null;
  private nagged = 0;

  constructor(private readonly o: HotbarOptions) {
    this.root.id = 'hotbar';
    this.root.hidden = true;
    if (o.slot) {
      this.root.style.setProperty('--slot', `url("${o.slot.url}")`);
      this.root.style.setProperty('--slot-picked', `url("${o.slot.picked}")`);
      this.root.style.setProperty('--slot-slice', String(o.slot.slice));
    }
    this.book.title = 'Skills (K)';
    this.book.setAttribute('aria-label', 'Skills');
    this.book.setAttribute('aria-expanded', 'false');
    this.book.textContent = 'K';
    this.book.addEventListener('click', () => this.toggleList());
    this.list.id = 'skill-book';
    this.list.hidden = true;
    const top = el('div', 'hb-row hb-toprow');
    const bottom = el('div', 'hb-row');
    for (const row of ['top', 'main', 'util'] as Row[]) {
      for (let i = 0; i < SIZE[row]; i++) {
        const cell = this.cell(row, i);
        this.cells[row].push(cell);
        (row === 'top' ? top : bottom).append(cell);
      }
    }
    top.prepend(el('span', 'hb-spacer', 'Ctrl')); // the top row's keys are Ctrl + the bottom row's
    bottom.prepend(this.book);
    this.root.append(top, bottom);
    document.body.append(this.root, this.list);
    // Dropped off the bar: that slot empties.
    this.root.addEventListener('dragend', (e) => {
      const from = (e.target as HTMLElement).dataset;
      if (e.dataTransfer?.dropEffect === 'none' && from.row) this.put(from.row as Row, Number(from.i), null);
    });
    document.addEventListener('keydown', (e) => this.key(e), true);
    document.addEventListener('pointerdown', (e) => {
      if (!this.list.hidden && !this.root.contains(e.target as Node) && !this.list.contains(e.target as Node)) this.toggleList(false);
    });
  }

  /** Your class (null: none yet): its saved bar, or its skills in order the first time. */
  setClass(c: ClassInfo | null): void {
    if (!this.root.hidden && c?.id === this.cls?.id) return;
    this.cls = c;
    this.root.hidden = false;
    document.body.classList.add('hotbar-on');
    this.root.style.setProperty('--badge', c ? `url("${this.o.badge(c.id)}")` : 'none');
    const saved = c ? load()[c.id] : undefined;
    if (c && saved) this.layout = tidy(saved, c);
    else {
      this.layout = blank();
      skillsOf(c).slice(0, SIZE.main).forEach((s, i) => (this.layout.main[i] = { t: 'skill', name: s.name }));
    }
    this.picked = null;
    this.drawList();
    this.draw();
  }

  private cell(row: Row, i: number): HTMLButtonElement {
    const b = el('button', `hb-slot hb-${row}`);
    b.dataset.row = row;
    b.dataset.i = String(i);
    b.addEventListener('click', () => {
      if (this.picked) {
        if (!fits(row, this.picked)) return toast('Skills go in the first ten slots or the top row.', 2400);
        this.put(row, i, this.picked);
        this.picked = null;
        this.drawList();
        return;
      }
      this.use(row, i);
    });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.layout[row][i]) this.put(row, i, null);
    });
    b.addEventListener('dragstart', (e) => {
      const entry = this.layout[row][i];
      if (!entry) return e.preventDefault();
      e.dataTransfer?.setData(DRAG, JSON.stringify({ entry, from: [row, i] }));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    b.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes(DRAG)) return;
      e.preventDefault();
      b.classList.add('hb-over');
    });
    b.addEventListener('dragleave', () => b.classList.remove('hb-over'));
    b.addEventListener('drop', (e) => {
      b.classList.remove('hb-over');
      const raw = e.dataTransfer?.getData(DRAG);
      if (!raw) return;
      e.preventDefault();
      const { entry, from } = JSON.parse(raw) as { entry: Entry; from?: [Row, number] };
      if (!fits(row, entry)) return toast(entry?.t === 'item' ? 'Potions go in the - = ~ slots or the top row.' : 'Skills go in the first ten slots or the top row.', 2400);
      if (from) {
        const [fr, fi] = from;
        if (fr === row && fi === i) return;
        const here = this.layout[row][i];
        // A swap where both fit; else the one moved in pushes the other out.
        this.layout[fr][fi] = fits(fr, here) ? here : null;
      }
      this.put(row, i, entry);
    });
    return b;
  }

  private put(row: Row, i: number, entry: Entry): void {
    this.layout[row][i] = entry;
    if (this.cls) {
      const all = load();
      all[this.cls.id] = this.layout;
      try {
        localStorage.setItem(STORE, JSON.stringify(all));
      } catch {
        /* private window: the bar just isn't remembered */
      }
    }
    playSound('click');
    this.draw();
  }

  private draw(): void {
    for (const row of ['top', 'main', 'util'] as Row[]) {
      this.cells[row].forEach((b, i) => {
        const entry = this.layout[row][i];
        const key = shown(row === 'top' ? TOP_KEYS[i] : row === 'main' ? MAIN_KEYS[i] : UTIL_KEYS[i]);
        b.replaceChildren();
        b.draggable = !!entry;
        const icon = entry?.t === 'skill' && this.cls ? this.iconOf(entry.name) : null;
        b.classList.toggle('hb-skill', entry?.t === 'skill' && !icon);
        b.classList.toggle('hb-off', entry?.t === 'skill' && !!this.o.usable && !this.o.usable(entry.name)); // damage skills: no combat in town
        const keyLabel = row === 'top' ? `Ctrl+${shown(TOP_KEYS[i])}` : key;
        if (entry?.t === 'skill') {
          const s = skillsOf(this.cls).find((k) => k.name === entry.name);
          b.append(icon ?? el('span', 'hb-initials', initials(entry.name)));
          b.title = `${entry.name}${s ? ` · Lv ${s.level}\n${s.desc}` : ''}\n(${keyLabel})`;
        } else if (entry?.t === 'item') {
          b.append(itemArt(entry.id, isRarity(entry.rarity) ? entry.rarity : 'common', 'icon', 2, true) ?? el('span', 'hb-emoji', entry.emoji));
          b.title = `${entry.name}\n(${keyLabel})`;
        } else b.title = `Empty (${keyLabel})`;
        b.append(el('span', 'hb-key', key));
        b.setAttribute('aria-label', b.title.replace(/\n/g, ' '));
      });
    }
  }

  /** The Skills panel: a stage on top (the hovered skill plays on it), then your class's skills and movement skills
   *  with their descriptions, each to drag (or click, then click a slot). */
  private drawList(): void {
    const skills = skillsOf(this.cls);
    const close = el('button', 'sb-close', '×');
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.toggleList(false));
    const head = el('div', 'sb-head');
    head.append(el('span', 'sb-title', this.cls ? `${this.cls.name} skills` : 'Skills'), close);
    this.list.replaceChildren(head);
    if (!skills.length) {
      this.list.append(el('p', 'hb-note', 'Choose a class with the Tanod to get skills.'));
      return;
    }
    this.list.append(this.stageBox, el('p', 'hb-note', 'Hover a skill to see it. Drag it onto a slot, or click it and then a slot.'), this.rows);
    const plays = previewsOf(this.cls);
    this.rows.replaceChildren(
      ...skills.map((s) => {
        const row = el('button', `hb-skill-row${this.picked?.name === s.name ? ' hb-picked' : ''}`);
        row.draggable = true;
        const text = el('span', 'sb-text');
        const line = el('span', 'sb-line');
        line.append(el('span', 'hb-name', s.name), el('span', 'hb-lv', `Lv ${s.level}`));
        text.append(line, el('span', 'sb-desc', s.desc));
        const pic = this.iconOf(s.name) ?? el('span', 'hb-initials', initials(s.name));
        row.append(pic, text);
        row.addEventListener('dragstart', (e) => {
          e.dataTransfer?.setData(DRAG, JSON.stringify({ entry: { t: 'skill', name: s.name } }));
          e.dataTransfer?.setDragImage(pic, pic.offsetWidth / 2, pic.offsetHeight / 2); // just the icon follows the pointer
        });
        row.addEventListener('click', () => {
          this.picked = this.picked?.name === s.name ? null : { t: 'skill', name: s.name };
          this.drawList();
        });
        row.addEventListener('pointerenter', () => this.preview(plays.get(s.name) ?? null));
        return row;
      }),
    );
  }

  /** A skill's icon as an image, if it has one. */
  private iconOf(name: string): HTMLImageElement | null {
    const url = this.cls ? this.o.icon?.(this.cls.id, name) : null;
    if (!url) return null;
    const img = el('img', 'hb-icon');
    img.src = url;
    img.alt = '';
    img.draggable = false;
    return img;
  }

  /** The stage plays `skill` now and then keeps replaying it (null: back to resting). */
  private preview(skill: Skill | null): void {
    this.hovered = skill;
    const st = this.stage?.stage;
    if (!st) return;
    this.restUntil = 0;
    if (skill) st.play(skill);
    else st.rest();
  }

  /** The stage for your class, built the first time the panel opens; it runs only while the panel is open. */
  private async openStage(): Promise<void> {
    const c = this.cls;
    if (!c || !this.o.stage) return;
    if (this.stage?.cls !== c.id) {
      this.stage = { cls: c.id, stage: null };
      this.stageBox.replaceChildren(el('div', 'sb-loading', 'Loading…'));
      const st = await this.o.stage(c);
      if (this.stage?.cls !== c.id) return; // the class changed meanwhile
      this.stage.stage = st;
      if (!st) return void this.stageBox.replaceChildren(el('div', 'sb-loading', "Couldn't load the preview."));
      st.canvas.className = 'sp-canvas';
      st.canvas.style.width = this.numbers.style.width = `${STAGE_W}px`;
      st.canvas.style.height = this.numbers.style.height = `${STAGE_H}px`;
      this.numbers.style.setProperty('--s', '1');
      st.onNumber = (at, text, kind) => {
        const n = el('span', `sp-num sp-${kind}`, text);
        n.style.left = `${Math.round(at.x)}px`;
        n.style.top = `${Math.round(at.y - 10)}px`;
        this.numbers.append(n);
        n.addEventListener('animationend', () => n.remove());
      };
      this.stageBox.replaceChildren(st.canvas, this.numbers);
      st.update(performance.now());
      st.rest();
    }
    cancelAnimationFrame(this.stageRaf);
    const tick = (now: number) => {
      const st = this.stage?.stage;
      if (this.list.hidden || !st) return;
      st.update(now);
      if (!st.busy && this.hovered) {
        if (!this.restUntil) {
          st.rest();
          this.restUntil = now + GAP_MS;
        } else if (now >= this.restUntil) this.preview(this.hovered);
      }
      this.stageRaf = requestAnimationFrame(tick);
    };
    this.stageRaf = requestAnimationFrame(tick);
  }

  private toggleList(show = this.list.hidden): void {
    this.list.hidden = !show;
    this.book.setAttribute('aria-expanded', String(show));
    this.hovered = null;
    if (show) void this.openStage();
    else cancelAnimationFrame(this.stageRaf);
    if (!show && this.picked) {
      this.picked = null;
      this.drawList();
    }
  }

  /** Every slot holding that skill gets a dark pie that shrinks round clockwise, with the seconds left on it. */
  private cooldown(name: string, seconds: number): void {
    const now = performance.now();
    this.cds.set(name, { from: now, until: now + seconds * 1000 });
    cancelAnimationFrame(this.cdRaf);
    const tick = (t: number) => {
      for (const row of ['top', 'main', 'util'] as Row[]) {
        this.cells[row].forEach((b, i) => {
          const e = this.layout[row][i];
          const cd = e?.t === 'skill' ? this.cds.get(e.name) : undefined;
          let pie = b.querySelector<HTMLElement>('.hb-cd');
          if (!cd || t >= cd.until) return void pie?.remove();
          if (!pie) {
            pie = el('span', 'hb-cd');
            pie.append(el('span', 'hb-cd-num'));
            b.append(pie);
          }
          const secs = (cd.until - t) / 1000;
          pie.style.setProperty('--left', `${(((cd.until - t) / (cd.until - cd.from)) * 360).toFixed(1)}deg`);
          pie.firstChild!.textContent = secs < 1 ? secs.toFixed(1) : String(Math.ceil(secs));
        });
      }
      for (const [k, cd] of this.cds) if (t >= cd.until) this.cds.delete(k);
      if (this.cds.size) this.cdRaf = requestAnimationFrame(tick);
    };
    this.cdRaf = requestAnimationFrame(tick);
  }

  private key(e: KeyboardEvent): void {
    if (this.root.hidden || e.altKey || e.metaKey || e.repeat || busy()) return;
    if (!e.ctrlKey && e.key.toLowerCase() === 'k') return this.toggleList();
    const k = CODE_KEY[e.code];
    if (!k) return;
    e.preventDefault();
    if (e.ctrlKey) return this.use('top', TOP_KEYS.indexOf(k));
    const main = MAIN_KEYS.indexOf(k);
    this.use(main >= 0 ? 'main' : 'util', main >= 0 ? main : UTIL_KEYS.indexOf(k));
  }

  /** A slot's key or click: it lights up; a move skill moves you (onSkill), other skills wait for combat, potions are
   *  used in Discord. */
  private use(row: Row, i: number): void {
    const entry = this.layout[row][i];
    const b = this.cells[row][i];
    b.classList.remove('hb-fire');
    void b.offsetWidth; // restart the flash
    b.classList.add('hb-fire');
    if (!entry) return;
    if (entry.t === 'skill') {
      const cd = this.o.onSkill?.(entry.name);
      if (typeof cd === 'number') this.cooldown(entry.name, cd);
      if (cd !== undefined) return;
    }
    const now = performance.now();
    if (now - this.nagged < 4000) return;
    this.nagged = now;
    toast(entry.t === 'skill' ? `${entry.name}: skills work in combat, coming soon.` : `${entry.name}: use it with /potion use in Discord for now.`, 2400);
  }
}

/** The class's skills and then its movement skills (classes.json `mobility`). */
function skillsOf(c: ClassInfo | null): { level: number; name: string; desc: string }[] {
  if (!c) return [];
  const moves = (c as ClassInfo & { mobility?: { level: number; name: string; desc: string }[] }).mobility ?? [];
  return [...c.skills, ...moves];
}

/** Each skill's stage preview by name: the first 7 in order, then the movement skills by id. */
function previewsOf(c: ClassInfo | null): Map<string, Skill> {
  const out = new Map<string, Skill>();
  if (!c) return out;
  c.skills.forEach((s, i) => {
    const p = SKILL_PREVIEWS[c.id]?.[i];
    if (p) out.set(s.name, p);
  });
  for (const m of (c as ClassInfo & { mobility?: { id: string; name: string }[] }).mobility ?? []) {
    const p = MOBILITY_PREVIEWS[c.id]?.[m.id];
    if (p) out.set(m.name, p);
  }
  return out;
}

const initials = (name: string) =>
  name
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .join('')
    .slice(0, 3);

const blank = (): Layout => ({ top: Array(SIZE.top).fill(null), main: Array(SIZE.main).fill(null), util: Array(SIZE.util).fill(null) });

/** A saved bar, trimmed to the slots there are and the skills the class still has. */
function tidy(saved: Partial<Layout>, c: ClassInfo): Layout {
  const names = new Set(skillsOf(c).map((s) => s.name));
  const out = blank();
  for (const row of ['top', 'main', 'util'] as Row[]) {
    (saved[row] ?? []).slice(0, SIZE[row]).forEach((e, i) => {
      if (e && fits(row, e) && (e.t !== 'skill' || names.has(e.name))) out[row][i] = e;
    });
  }
  return out;
}

function load(): Record<string, Layout> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

/** Typing in a field, or the town locked (casino, arena): the keys aren't the bar's. */
function busy(): boolean {
  if (document.body.classList.contains('town-locked')) return true;
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
