import { keyLabel, matches, onKeybinds } from './keybinds';
import { type AdventureState, type QuestDef, newItem, nameColour } from '@mikazuki/shared';
import { itemPicture, nameOf } from './item-tip';
import { playSound } from '../audio/sound';
import { type AdventureChange, adventure, itemData, markQuestsSeen, onAdventure, questDef, unseenQuest } from '../net/adventure';

// 📜 Quests on screen (the state: net/adventure.ts, the quests: quests/quests.json). Main quests are violet and side
// quests yellow everywhere they show (manifest quests.colours):
//   • the tracker, on the left under the top-left HUD: each active quest (up to 3, main first) with its current
//     objective; an objective just done ticks to ✓ for a moment before the next shows. Click it for the log; its
//     toggle folds it to the header (remembered in localStorage mk_quests_folded). Hidden with no active quests.
//   • the log (J, or the scroll button among the HUD's buttons, which has a dot while a quest started or moved on
//     since the log was last opened): Main and Side on the left (done ones under a folded Completed row), the picked
//     quest on the right with its giver's portrait, its summary and objectives (✓ done, ○ current, later ones dim).
//     No server calls: it shows what /me brought.
//   • the "Quest complete" banner at the top centre.

export interface QuestUiOptions {
  colours: { main: string; side: string };
  /** The window frame (the inventory's: manifest ui.inventory.itemFrame). */
  frame: { url: string; slice: number } | null;
  /** A quest giver's name and portrait (the NPC dialog box's: two frames side by side, eyes open first). */
  giver: (npc: string) => { name: string; portrait: string; mirror: boolean } | null;
}

const TRACKED = 3;
const TICK_MS = 1300; // an objective's ✓ before the next shows
const BANNER_MS = 2500;
const FOLD_KEY = 'mk_quests_folded';

let opts: QuestUiOptions;
let logRoot: HTMLElement | null = null;
let picked: string | null = null;
let showDone = false;

const colour = (q: QuestDef | undefined) => (q?.type === 'side' ? opts.colours.side : opts.colours.main);

export function mountQuests(o: QuestUiOptions): void {
  opts = o;
  document.getElementById('quest-tracker')?.remove();
  document.getElementById('quest-log')?.remove();
  const tracker = new Tracker();
  const button = document.getElementById('quest-button');
  const dot = button?.querySelector<HTMLElement>('.th-quest-dot');
  button?.addEventListener('click', () => toggleQuestLog());
  onAdventure((s, change) => {
    tracker.update(s, change);
    if (logRoot && !logRoot.hidden) renderLog();
    const unseen = unseenQuest();
    if (dot) {
      dot.hidden = !unseen;
      if (unseen) dot.style.background = opts.colours[unseen];
    }
    if (change.completed) {
      if (held) heldBanners.push(change.completed);
      else banner(questDef(change.completed));
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && logRoot && !logRoot.hidden) return toggleQuestLog(false);
    if (!matches('quests', e) || e.repeat || typing()) return;
    e.preventDefault();
    toggleQuestLog();
  });
}

/** Opens or closes the quest log (J, the scroll button, a click on the tracker). */
export function toggleQuestLog(open = !logRoot || logRoot.hidden): void {
  if (!logRoot) buildLog();
  logRoot!.hidden = !open;
  document.getElementById('quest-button')?.setAttribute('aria-expanded', String(open));
  if (!open) return;
  playSound('click');
  markQuestsSeen();
  renderLog();
}

/** True while a page field has the keyboard (the chat), or the town is locked (casino, arena). */
function typing(): boolean {
  if (document.body.classList.contains('town-locked')) return true;
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
}

// ── Tracker ──

class Tracker {
  private readonly root = el('div');
  private readonly list = el('div', 'qt-list');
  private readonly fold = el('button', 'qt-fold');
  /** Objectives just done, shown ticked for a moment (by quest), with the quest's title if it's finished. */
  private readonly ticks = new Map<string, { text: string; title: string; type: QuestDef['type']; until: number }>();
  private state: AdventureState | null = null;

  constructor() {
    this.root.id = 'quest-tracker';
    this.root.hidden = true;
    const head = el('div', 'qt-head');
    const kbd = el('kbd', 'qt-key');
    onKeybinds(() => {
      kbd.textContent = keyLabel('quests');
      kbd.hidden = !keyLabel('quests');
      this.root.title = keyLabel('quests') ? `Open the quest log (${keyLabel('quests')})` : 'Open the quest log';
    });
    head.append(el('span', 'qt-label', 'Quests'), kbd, this.fold);
    this.fold.setAttribute('aria-label', 'Fold the quest tracker');
    this.fold.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setFolded(!this.root.classList.contains('qt-folded'));
    });
    this.root.append(head, this.list);
    this.root.addEventListener('click', () => toggleQuestLog(true));
    document.body.append(this.root);
    let folded = false;
    try {
      folded = localStorage.getItem(FOLD_KEY) === '1';
    } catch {
      // not remembered
    }
    this.setFolded(folded, false);
    // Under whatever is in the top-left corner (the profile, and on phones the jackpot and race boards).
    const place = () => {
      const left = document.querySelector('#town-hud .th-left')?.getBoundingClientRect();
      this.root.style.top = `${Math.round((left?.bottom ?? 0) + 12)}px`;
    };
    const corner = document.querySelector('#town-hud .th-left');
    if (corner) new ResizeObserver(place).observe(corner);
    addEventListener('resize', place);
    place();
  }

  private setFolded(on: boolean, remember = true): void {
    this.root.classList.toggle('qt-folded', on);
    this.fold.textContent = on ? '+' : '−';
    this.fold.setAttribute('aria-expanded', String(!on));
    if (!remember) return;
    try {
      localStorage.setItem(FOLD_KEY, on ? '1' : '0');
    } catch {
      // not remembered
    }
  }

  update(s: AdventureState, change: AdventureChange): void {
    this.state = s;
    if (change.advanced) {
      const q = questDef(change.advanced.quest);
      const o = q?.objectives.find((x) => x.id === change.advanced!.objective);
      if (q && o) {
        this.ticks.set(q.id, { text: o.text, title: q.title, type: q.type, until: performance.now() + TICK_MS });
        setTimeout(() => this.render(), TICK_MS + 20);
      }
    }
    this.render();
  }

  private render(): void {
    const now = performance.now();
    for (const [id, t] of this.ticks) if (t.until <= now) this.ticks.delete(id);
    const active = (this.state?.quests.active ?? [])
      .map((p) => ({ p, q: questDef(p.id) }))
      .filter((x): x is { p: { id: string; step: number }; q: QuestDef } => !!x.q)
      .sort((a, b) => (a.q.type === b.q.type ? 0 : a.q.type === 'main' ? -1 : 1));
    // A quest that just finished stays a moment with its last objective ticked.
    const rows: { id: string; title: string; type: QuestDef['type']; text: string; done: boolean }[] = [];
    for (const { p, q } of active) {
      const tick = this.ticks.get(q.id);
      rows.push({ id: q.id, title: q.title, type: q.type, text: tick?.text ?? q.objectives[p.step]?.text ?? '', done: !!tick });
    }
    for (const [id, t] of this.ticks) if (!rows.some((r) => r.id === id)) rows.push({ id, title: t.title, type: t.type, text: t.text, done: true });
    rows.sort((a, b) => (a.type === b.type ? 0 : a.type === 'main' ? -1 : 1));
    this.root.hidden = !rows.length;
    this.list.replaceChildren(
      ...rows.slice(0, TRACKED).map((r) => {
        const row = el('div', 'qt-quest');
        const title = el('div', 'qt-title', r.title);
        title.style.color = r.type === 'side' ? opts.colours.side : opts.colours.main;
        const step = el('div', `qt-step${r.done ? ' qt-done' : ''}`);
        step.append(el('span', 'qt-mark', r.done ? '✓' : '○'), el('span', undefined, r.text));
        row.append(title, step);
        return row;
      }),
    );
  }
}

// ── Log ──

function buildLog(): void {
  const root = el('div');
  root.id = 'quest-log';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Quests');
  if (opts.frame) {
    root.classList.add('ql-framed');
    root.style.setProperty('--frame', `url("${opts.frame.url}")`);
    root.style.setProperty('--slice', String(opts.frame.slice));
  }
  const head = el('div', 'ql-head');
  const close = el('button', 'ql-close', '×');
  close.setAttribute('aria-label', 'Close the quest log');
  close.addEventListener('click', () => toggleQuestLog(false));
  head.append(el('span', 'ql-heading', 'Quests'), close);
  root.append(head, el('div', 'ql-body'));
  document.body.append(root);
  logRoot = root;
}

function renderLog(): void {
  if (!logRoot) return;
  const s = adventure();
  const active = (s?.quests.active ?? []).map((p) => ({ q: questDef(p.id), step: p.step })).filter((x): x is { q: QuestDef; step: number } => !!x.q);
  const done = (s?.quests.done ?? []).map((id) => questDef(id)).filter((q): q is QuestDef => !!q);
  const all = [...active.map((a) => a.q), ...done];
  if (!picked || !all.some((q) => q.id === picked)) picked = (active.find((a) => a.q.type === 'main') ?? active[0])?.q.id ?? done[0]?.id ?? null;

  const side = el('div', 'ql-list');
  const item = (q: QuestDef, finished: boolean) => {
    const b = el('button', `ql-item${q.id === picked ? ' ql-picked' : ''}${finished ? ' ql-finished' : ''}`);
    const d = el('span', 'ql-dot');
    d.style.background = colour(q);
    b.append(d, el('span', undefined, q.title));
    b.addEventListener('click', () => {
      picked = q.id;
      renderLog();
    });
    return b;
  };
  const section = (type: QuestDef['type'], label: string, empty: string) => {
    const h = el('div', 'ql-section', label);
    h.style.color = opts.colours[type];
    const mine = active.filter((a) => a.q.type === type);
    side.append(h, ...(mine.length ? mine.map((a) => item(a.q, false)) : [el('div', 'ql-none', empty)]));
  };
  section('main', 'Main', 'No main quests right now.');
  section('side', 'Side', 'No side quests yet.');
  if (done.length) {
    const row = el('button', 'ql-completed', `${showDone ? '▾' : '▸'} Completed (${done.length})`);
    row.setAttribute('aria-expanded', String(showDone));
    row.addEventListener('click', () => {
      showDone = !showDone;
      renderLog();
    });
    side.append(row, ...(showDone ? done.map((q) => item(q, true)) : []));
  }

  const detail = el('div', 'ql-detail');
  const q = all.find((x) => x.id === picked);
  if (!q) detail.append(el('div', 'ql-none', 'No quests yet.'));
  else {
    const finished = done.includes(q);
    const step = active.find((a) => a.q === q)?.step ?? q.objectives.length;
    const title = el('div', 'ql-title', q.title);
    title.style.color = colour(q);
    detail.append(title);
    const giver = opts.giver(q.giver);
    if (giver) {
      const who = el('div', 'ql-giver');
      const frame = el('span', 'ql-portrait-frame');
      if (opts.frame) {
        frame.classList.add('ql-framed-small');
        frame.style.setProperty('--frame', `url("${opts.frame.url}")`);
        frame.style.setProperty('--slice', String(opts.frame.slice));
      }
      const face = el('span', 'ql-portrait');
      face.style.backgroundImage = `url("${giver.portrait}")`;
      if (giver.mirror) face.style.transform = 'scaleX(-1)';
      frame.append(face);
      who.append(frame, el('span', 'ql-giver-name', giver.name));
      detail.append(who);
    }
    detail.append(el('p', 'ql-summary', q.summary));
    const list = el('ol', 'ql-objectives');
    q.objectives.forEach((o, i) => {
      const state = finished || i < step ? 'done' : i === step ? 'current' : 'later';
      const li = el('li', `ql-obj ql-${state}`);
      li.append(el('span', 'ql-mark', state === 'done' ? '✓' : '○'), el('span', undefined, o.text));
      list.append(li);
    });
    detail.append(list);
    // What it gives: each item's picture and name in its colour, ×count.
    const D = itemData();
    const rewards = (q.rewards ?? []).flatMap((r) => {
      const def = D?.defs.get(r.item);
      return def && D ? [newItem(D.stats, def, 'reward', r.count)] : [];
    });
    if (rewards.length) {
      const box = el('div', 'ql-rewards');
      box.append(el('div', 'ql-rewards-head', 'Rewards'));
      for (const it of rewards) {
        const row = el('div', 'ql-reward');
        const name = el('span', 'ql-reward-name', nameOf(it));
        name.style.color = nameColour(D!, it);
        row.append(itemPicture(it, 'icon', 2), name, el('span', 'ql-reward-count', `×${it.count}`));
        box.append(row);
      }
      detail.append(box);
    }
    if (finished) detail.append(el('div', 'ql-finished-note', 'Completed'));
  }
  logRoot.querySelector('.ql-body')!.replaceChildren(side, detail);
}

// ── Banner ──

let held = false;
const heldBanners: string[] = [];

/** Holds "Quest complete" banners back (the giver has a last line to say first); releasing shows any held. */
export function holdQuestBanners(on: boolean): void {
  held = on;
  if (on) return;
  for (const id of heldBanners.splice(0)) banner(questDef(id));
}

function banner(q: QuestDef | undefined): void {
  if (!q) return;
  document.getElementById('quest-banner')?.remove();
  const b = el('div');
  b.id = 'quest-banner';
  b.setAttribute('role', 'status');
  b.style.setProperty('--quest', colour(q));
  b.append(el('div', 'qb-label', 'Quest complete'), el('div', 'qb-title', q.title));
  document.body.append(b);
  playSound('casino-win');
  setTimeout(() => b.classList.add('qb-out'), BANNER_MS);
  setTimeout(() => b.remove(), BANNER_MS + 600);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
