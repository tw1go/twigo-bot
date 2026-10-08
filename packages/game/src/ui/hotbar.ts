import { actionOf, keyLabel, matches, onKeybinds } from './keybinds';
import type { ClassInfo } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { MOBILITY_PREVIEWS, SKILL_PREVIEWS } from '../combat/skill-previews';
import { GAP_MS, STAGE_H, STAGE_W, type Skill, type SkillStage } from '../combat/skill-stage';
import { itemArt, isRarity } from './item-art';
import { cooldownOf, mpCostOf, seconds } from '../combat/cooldowns';
import { SkillTip, skillTipLines } from './skill-tip';
import { type SkillView, adventure, adventureData, onAdventure, raiseSkill, resetSkills, skillViews } from '../net/adventure';
import { toast } from './toast';

// ⚔️ The hotbar, bottom centre (members, not on phones): two rows of slots in the bag's slot art.
//   Bottom row: 10 skill slots (keys 1–0), then 3 for potions and other usables (keys - = `).
//   Top row: 13 more (Alt+1–0, Alt+- Alt+= Alt+`; each labelled "Alt+1"…), for skills or usables.
//   (Those are the default keys: each slot's key is a keybind, ui/keybinds.ts, and its label follows it.)
// Skills come from the Skills panel on the right of the screen (the K button at the bar's left, or K): your skill
// points, then each skill in unlock order with its description, "Lv N / cap" and cooldown, played on a small stage while
// hovered (the class choice's preview, combat/skill-stage.ts); a + raises an unlocked skill below its cap (a skill point,
// POST /town/skills), Reset gives every point back (free). Locked skills are greyed with "Unlocks at Lv N" (on the bar
// too, with a padlock: they can't be used until then). Drag one onto a slot, or click it and then a slot. Potions are
// dragged in from the bag: HP and MP Potions from the combat bag (onItem uses one: the town asks the server, which
// keeps their one shared cooldown, shown as a pie on every potion slot; the count you carry in the corner), the
// Discord buff potions from the old bag (they're used in Discord). Drag a slot onto another to swap them; drag it off the bar to empty it (right-click leaves it). Per class, saved in this browser (localStorage `mk_hotbar`); a class's first bar has
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
  /** An item slot's key or click (an HP or MP Potion: its item id): true if it was used (or asked for). */
  onItem?: (id: string) => boolean;
  /** How many of an item you carry (shown in its slot's corner), or undefined: not counted. */
  countOf?: (id: string) => number | undefined;
  /** A skill's icon (32 px), or null: its initials over the class badge stand in. */
  icon?: (cls: string, skill: string) => string | null;
  /** The preview stage for a class (built once its poses and fx have loaded). */
  stage?: (cls: ClassInfo) => Promise<SkillStage | null>;
}

type SkillEntry = { t: 'skill'; name: string };
/** An item on the bar: its id, name, emoji (no art) and rarity; `cooldown`: the key of a cooldown it shares (HP and MP
 *  Potions: potionCooldownKey). */
type ItemEntry = { t: 'item'; id: string; name: string; emoji: string; rarity: string; cooldown?: string };
type Entry = SkillEntry | ItemEntry | null;
type Row = 'top' | 'main' | 'util';
interface Layout {
  top: Entry[];
  main: Entry[];
  util: Entry[];
}

const SIZE: Record<Row, number> = { top: 13, main: 10, util: 3 };
/** Each slot's keybind action (ui/keybinds.ts: main1–10, util1–3, top1–13). */
const slotAction = (row: Row, i: number) => `${row}${i + 1}`;
const SLOT_ACTIONS = (['main', 'util', 'top'] as Row[]).flatMap((row) => Array.from({ length: SIZE[row] }, (_, i) => slotAction(row, i)));
const DRAG = 'application/x-mk-hotbar';
const STORE = 'mk_hotbar';

/** What a row takes: the bottom row's first ten are for skills, its last three for usables, the top row either. */
const fits = (row: Row, e: Entry) => !e || row === 'top' || (row === 'main' ? e.t === 'skill' : e.t === 'item');

/** Old-bag items that can go on the bar (the Discord buff potions; the combat bag's HP and MP Potions too). */
export const hotbarItem = (kind: string) => kind === 'potion';
/** The cooldown HP and MP Potions share (one key for every slot holding one). */
export const potionCooldownKey = 'hp-mp-potion';
/** Bag cells call this as a usable is dragged: the bar takes it. */
export function hotbarDragItem(e: DragEvent, it: { id: string; name: string; emoji: string; rarity: string; cooldown?: string }): void {
  e.dataTransfer?.setData(DRAG, JSON.stringify({ entry: { t: 'item', id: it.id, name: it.name, emoji: it.emoji, rarity: it.rarity, ...(it.cooldown ? { cooldown: it.cooldown } : {}) } }));
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
  private readonly skillTip = new SkillTip();
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

  private raising = false;

  constructor(private readonly o: HotbarOptions) {
    this.root.id = 'hotbar';
    this.root.hidden = true;
    if (o.slot) {
      this.root.style.setProperty('--slot', `url("${o.slot.url}")`);
      this.root.style.setProperty('--slot-picked', `url("${o.slot.picked}")`);
      this.root.style.setProperty('--slot-slice', String(o.slot.slice));
    }
    this.book.setAttribute('aria-label', 'Skills');
    this.book.setAttribute('aria-expanded', 'false');
    onKeybinds(() => {
      this.book.title = keyLabel('skills') ? `Skills (${keyLabel('skills')})` : 'Skills';
      this.book.textContent = keyLabel('skills') || 'K';
      this.draw();
    });
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
    top.prepend(el('span', 'hb-spacer')); // (lines the top row up with the bottom's)
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
    // Your level and skill levels: locks, caps and cooldowns follow.
    let seen = '';
    onAdventure((s) => {
      const now = JSON.stringify([s.cls, s.progress.level, s.progress.skills, s.progress.skillPoints]);
      if (now === seen) return;
      seen = now;
      if (this.cls?.id !== s.cls) return; // (setClass redraws)
      this.drawList();
      this.draw();
    });
    // What you carry: the potions' counts.
    let carried = '';
    onAdventure((s) => {
      const now = JSON.stringify(s.bag.map((i) => [i.defId, i.count]));
      if (now === carried) return;
      carried = now;
      this.draw();
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
    // A skill's details on hover (its key last).
    b.addEventListener('pointerenter', () => {
      const entry = this.layout[row][i];
      const s = entry?.t === 'skill' ? this.skill(entry.name) : undefined;
      if (!s || !this.cls) return;
      const key = keyLabel(slotAction(row, i));
      this.skillTip.show([...skillTipLines(this.cls, s), ...(key ? [el('div', 'sk-tip-key', `Key: ${key}`)] : [])], b);
    });
    b.addEventListener('pointerleave', () => this.skillTip.hide());
    b.addEventListener('pointerdown', () => this.skillTip.hide());
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
        b.replaceChildren();
        b.draggable = !!entry;
        const icon = entry?.t === 'skill' && this.cls ? this.iconOf(entry.name) : null;
        const s = entry?.t === 'skill' ? this.skill(entry.name) : undefined;
        b.classList.toggle('hb-skill', entry?.t === 'skill' && !icon);
        b.classList.toggle('hb-off', entry?.t === 'skill' && !!this.o.usable && !this.o.usable(entry.name)); // damage skills: no combat in town
        b.classList.toggle('hb-locked', !!s?.locked);
        const key = keyLabel(slotAction(row, i));
        const named = key ? ` (${key})` : '';
        if (entry?.t === 'skill') {
          b.append(icon ?? el('span', 'hb-initials', initials(entry.name)));
          if (s?.locked) b.append(padlock(s.unlock));
          b.removeAttribute('title'); // (its details show on hover: ui/skill-tip.ts)
        } else if (entry?.t === 'item') {
          b.append(itemArt(entry.id, isRarity(entry.rarity) ? entry.rarity : 'common', 'icon', 2, true) ?? el('span', 'hb-emoji', entry.emoji));
          b.title = `${entry.name}${named ? `\n${named.trim()}` : ''}`;
          const n = this.o.countOf?.(entry.id);
          if (n !== undefined) b.append(el('span', `hb-count${n ? '' : ' hb-none'}`, String(n)));
          b.classList.toggle('hb-empty', n === 0);
        } else b.title = `Empty${named}`;
        if (key) b.append(el('span', key.length > 2 ? 'hb-key hb-key-alt' : 'hb-key', key));
        b.setAttribute('aria-label', b.title.replace(/\n/g, ' '));
      });
    }
  }

  /** The Skills panel: a stage on top (the hovered skill plays on it), your skill points and Reset, then your class's
   *  skills in unlock order with their descriptions, levels and cooldowns, a + on each you can raise; each to drag (or
   *  click, then click a slot). Locked ones are greyed with their unlock level. */
  private drawList(): void {
    const skills = this.views();
    const close = el('button', 'sb-close', '×');
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.toggleList(false));
    const head = el('div', 'sb-head');
    head.append(el('span', 'sb-title', this.cls ? `${this.cls.name} skills` : 'Skills'), close);
    this.list.replaceChildren(head);
    const p = adventure()?.progress;
    const points = el('div', 'sb-points');
    points.append(el('span', 'sb-points-label', 'Skill points:'), el('b', 'sb-points-n', String(p?.skillPoints ?? 0)));
    if (!skills.length) {
      points.append(el('span', 'sb-points-hint', 'Choose a class to spend them'));
      this.list.append(points, el('p', 'hb-note', 'Choose a class with the Tanod to get skills.'));
      return;
    }
    const reset = el('button', 'sb-reset', 'Reset');
    reset.title = 'Get every skill point back (free)';
    reset.disabled = !Object.keys(p?.skills ?? {}).length;
    reset.addEventListener('click', () => void this.raise(null));
    points.append(reset);
    this.list.append(this.stageBox, points, el('p', 'hb-note', 'Hover a skill to see it. Drag it onto a slot, or click it and then a slot. + raises it (a skill point).'), this.rows);
    const plays = previewsOf(this.cls);
    const stats = adventureData()?.stats;
    const spare = p?.skillPoints ?? 0;
    this.rows.replaceChildren(
      ...skills.map((s) => {
        const row = el('div', `hb-skill-row${this.picked?.name === s.name ? ' hb-picked' : ''}${s.locked ? ' sb-locked' : ''}`);
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.draggable = true;
        if (this.cls) {
          const cls = this.cls;
          row.addEventListener('pointerenter', () => this.skillTip.show(skillTipLines(cls, s), row, true));
          row.addEventListener('pointerleave', () => this.skillTip.hide());
        }
        const text = el('span', 'sb-text');
        const line = el('span', 'sb-line');
        const mp = stats ? mpCostOf(stats, this.cls?.id, s, s.level) : 0;
        const cd = stats ? ` · ${seconds(cooldownOf(stats, s, s.level))}${mp ? ` · ${mp} MP` : ''}` : '';
        line.append(el('span', 'hb-name', s.name), el('span', 'hb-lv', s.locked ? `Unlocks at Lv ${s.unlock}` : `Lv ${s.level} / ${s.cap}${cd}`));
        text.append(line, el('span', 'sb-desc', s.desc));
        const pic = this.iconOf(s.name) ?? el('span', 'hb-initials', initials(s.name));
        row.append(pic, text);
        if (!s.locked && s.level < s.cap && spare > 0) {
          const add = el('button', 'sb-plus', '+');
          add.title = `Raise ${s.name} to Lv ${s.level + 1} (a skill point)`;
          add.setAttribute('aria-label', add.title);
          add.addEventListener('click', (e) => {
            e.stopPropagation();
            void this.raise(s.key);
          });
          row.append(add);
        }
        row.addEventListener('dragstart', (e) => {
          e.dataTransfer?.setData(DRAG, JSON.stringify({ entry: { t: 'skill', name: s.name } }));
          e.dataTransfer?.setDragImage(pic, pic.offsetWidth / 2, pic.offsetHeight / 2); // just the icon follows the pointer
        });
        const pick = () => {
          this.picked = this.picked?.name === s.name ? null : { t: 'skill', name: s.name };
          this.drawList();
        };
        row.addEventListener('click', pick);
        row.addEventListener('keydown', (e) => e.key === 'Enter' && pick());
        row.addEventListener('pointerenter', () => this.preview(plays.get(s.name) ?? null));
        return row;
      }),
    );
  }

  /** A skill point into a skill (by key), or (null) all of them back. */
  private async raise(key: string | null): Promise<void> {
    if (this.raising) return;
    this.raising = true;
    const r = await (key ? raiseSkill(key) : resetSkills());
    this.raising = false;
    if (!r?.ok) {
      playSound('error');
      return toast(r?.message?.replace(/\.$/, '') ?? "Couldn't reach the bot", 2200, 'bad');
    }
    playSound('click');
  }

  /** Your class's skills with their levels (net/adventure.ts skillViews), in unlock order. */
  private views(): SkillView[] {
    return skillViews(this.cls);
  }

  private skill(name: string): SkillView | undefined {
    return this.views().find((k) => k.name === name);
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

  /** A new skill unlocked: a dot on the Skills button until the panel is opened. */
  markNew(): void {
    this.book.classList.add('hb-new');
  }

  private toggleList(show = this.list.hidden): void {
    this.list.hidden = !show;
    if (show) this.book.classList.remove('hb-new');
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
  /** The skills on the bar in key order (1–0, then the Alt row), each once. */
  skillOrder(): string[] {
    const seen = new Set<string>();
    for (const e of [...this.layout.main, ...this.layout.top]) if (e?.t === 'skill') seen.add(e.name);
    return [...seen];
  }

  /** Every slot holding that skill glows while it's auto-casting (null: none). */
  setAuto(name: string | null): void {
    for (const row of ['top', 'main', 'util'] as Row[]) {
      this.cells[row].forEach((b, i) => {
        const e = this.layout[row][i];
        b.classList.toggle('hb-auto', !!name && e?.t === 'skill' && e.name === name);
      });
    }
  }

  cooldown(name: string, seconds: number): void {
    const now = performance.now();
    this.cds.set(name, { from: now, until: now + seconds * 1000 });
    cancelAnimationFrame(this.cdRaf);
    const tick = (t: number) => {
      for (const row of ['top', 'main', 'util'] as Row[]) {
        this.cells[row].forEach((b, i) => {
          const e = this.layout[row][i];
          const cd = e?.t === 'skill' ? this.cds.get(e.name) : e?.t === 'item' && e.cooldown ? this.cds.get(e.cooldown) : undefined;
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
    if (this.root.hidden || e.repeat || busy()) return;
    if (matches('skills', e)) return this.toggleList();
    const a = actionOf(e, SLOT_ACTIONS);
    if (!a) return;
    e.preventDefault();
    const [, row, n] = /^(main|util|top)(\d+)$/.exec(a)!;
    this.use(row as Row, Number(n) - 1);
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
      const s = this.skill(entry.name);
      if (s?.locked) {
        playSound('error');
        return toast(`${s.name} unlocks at Lv ${s.unlock}.`, 2000);
      }
      const cd = this.o.onSkill?.(entry.name);
      if (typeof cd === 'number') this.cooldown(entry.name, cd);
      if (cd !== undefined) return;
    } else if (this.o.onItem?.(entry.id)) return; // (an HP or MP Potion: the server answers with its cooldown)
    const now = performance.now();
    if (now - this.nagged < 4000) return;
    this.nagged = now;
    toast(entry.t === 'skill' ? `${entry.name}: skills work in combat, coming soon.` : `${entry.name}: use it with /potion use in Discord for now.`, 2400);
  }
}

/** The class's skills and then its movement skills (classes.json `mobility`). */
function skillsOf(c: ClassInfo | null): { level: number; name: string; desc: string }[] {
  return c ? [...c.skills, ...(c.mobility ?? [])] : [];
}

/** A locked slot's padlock (pixel art, 7 × 8) with the level it unlocks at. */
function padlock(level: number): HTMLElement {
  const box = el('span', 'hb-lock');
  box.innerHTML =
    '<svg viewBox="0 0 7 8" width="14" height="16" shape-rendering="crispEdges" aria-hidden="true"><path fill="#0B0A1A" d="M1 0h5v1h1v3H0V1h1z"/><path fill="#A9B1D6" d="M2 1h3v1h1v2H5V2H2v2H1V2h1z"/><path fill="#0B0A1A" d="M0 3h7v5H0z"/><path fill="#F8BF27" d="M1 4h5v3H1z"/><path fill="#0B0A1A" d="M3 5h1v1H3z"/></svg>';
  box.append(el('span', 'hb-lock-lv', `Lv ${level}`));
  return box;
}

/** Each skill's stage preview by name: the first 7 in order, then the movement skills by id. */
function previewsOf(c: ClassInfo | null): Map<string, Skill> {
  const out = new Map<string, Skill>();
  if (!c) return out;
  c.skills.forEach((s, i) => {
    const p = SKILL_PREVIEWS[c.id]?.[i];
    if (p) out.set(s.name, p);
  });
  for (const m of c.mobility ?? []) {
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
