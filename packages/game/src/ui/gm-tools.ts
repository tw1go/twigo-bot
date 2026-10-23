import type { Area } from '../assets/types';
import { adventure, devFinishQuest, onAdventure, questDef } from '../net/adventure';
import { areaUrl } from '../net/hood';
import { onTesting, testing } from '../net/testing';
import { fakeName } from '../session';
import { toast } from './toast';

// 🛠 The GM tools (the dev server only: `npm run dev:game`, a pretend login): a small panel at the left edge, folded to a
// "🛠 GM" tab (Settings → GM tools opens it too). HP and MP (can't be knocked out, skills cost no MP: the testing switches, for anyone here; a full heal), your
// level and XP, Kusing, the quests under way (a step done, or all of it, rewards and all), a jump to a tile or another
// map, and every mob near you down (its XP, loot and quest kills yours). The dev town does each (scripts/dev-town.ts:
// /__gm, /__xp, /__give), the same code the bot runs; the quests are the page's pretend store's.

export interface GmHooks {
  /** Where you are. */
  tile(): { col: number; row: number };
  area(): Area;
}

const MAPS: [Area, string][] = [['town', 'Town'], ['slums', 'Slums'], ['palengke', 'Old Market'], ['hood', 'Neighbourhood']];
const KUSING = [10_000, 100_000, 1_000_000];

export function mountGmTools(h: GmHooks): () => void {
  document.getElementById('gm-tools')?.remove();
  const root = el('div', '');
  root.id = 'gm-tools';
  let open = localStorage.getItem('mk_gm_open') === '1';
  const setOpen = (on: boolean) => {
    open = on;
    try {
      localStorage.setItem('mk_gm_open', open ? '1' : '0');
    } catch {
      // (folded again next time)
    }
    render();
  };
  const tab = button('🛠 GM', () => setOpen(!open));
  // (Settings → GM tools opens it too.)
  const fromSettings = () => setOpen(true);
  addEventListener('mk-gm-open', fromSettings);
  tab.className = 'gm-tab';
  const body = el('div', 'gm-body');
  root.append(tab, body);
  document.body.append(root);

  const call = async (path: string, params: Record<string, string>, said?: string) => {
    const r = await fetch(`${path}?${new URLSearchParams({ as: fakeName(), ...params })}`).then((x) => (x.ok ? x.text() : null)).catch(() => null);
    toast(r ? (said ?? r.trim().split('\n')[0]) : "The dev town didn't answer.", 2200, r ? 'good' : 'bad');
  };
  const render = () => {
    root.classList.toggle('gm-open', open);
    if (!open) return body.replaceChildren();
    const s = adventure();
    const p = s?.progress;
    const t = testing();
    const here = h.tile();

    // HP and MP.
    const hp = section('HP & MP');
    hp.append(
      check("Can't be knocked out", !!t?.unkillable, (on) => call('/__gm', { unkillable: on ? '1' : '0' })),
      check('Skills cost no MP', !!t?.freeMp, (on) => call('/__gm', { freemp: on ? '1' : '0' })),
      row(button('Full HP & MP', () => call('/__gm', { heal: '1' }))),
    );

    // Level and XP.
    const lv = section(`Level ${p?.level ?? 1}${p?.next ? ` · ${p.xp.toLocaleString('en-US')} / ${p.next.toLocaleString('en-US')} XP` : ' · MAX'}`);
    const level = input('number', String(p?.level ?? 1), 52);
    lv.append(
      row(
        button('+1 level', () => call('/__xp', { level: String((p?.level ?? 1) + 1) })),
        button('Fill XP bar', () => call('/__xp', { xp: String(Math.max(1, (p?.next ?? 0) - (p?.xp ?? 0))) })),
        button('+10%', () => call('/__xp', { xp: String(Math.max(1, Math.round((p?.next ?? 100) / 10))) })),
      ),
      row(level, button('Set level', () => call('/__xp', { level: level.value }))),
    );

    // Kusing.
    const kusing = s?.kusing ?? 0;
    const k = section(`Kusing ${kusing.toLocaleString('en-US')}`);
    k.append(row(...KUSING.map((n) => button(`+${n >= 1e6 ? `${n / 1e6}M` : `${n / 1e3}k`}`, () => call('/__give', { kusing: String(kusing + n) }, `+${n.toLocaleString('en-US')} Kusing`)))));

    // Quests under way.
    const q = section('Quests');
    const active = s?.quests.active ?? [];
    if (!active.length) q.append(el('div', 'gm-note', 'None under way.'));
    for (const a of active) {
      const def = questDef(a.id);
      const o = def?.objectives[a.step];
      const line = el('div', 'gm-quest');
      line.append(
        el('div', 'gm-quest-name', `${def?.title ?? a.id}`),
        el('div', 'gm-note', `Step ${a.step + 1}/${def?.objectives.length ?? '?'}${o?.text ? `: ${o.text}` : ''}`),
        row(
          button('Step done', () => void devFinishQuest(a.id, false).then((r) => toast(r?.ok ? `${def?.title}: step done` : (r?.message ?? 'No.'), 2000, r?.ok ? 'good' : 'bad'))),
          button('Complete', () => void devFinishQuest(a.id, true).then((r) => toast(r?.ok ? `${def?.title}: complete` : (r?.message ?? 'No.'), 2000, r?.ok ? 'good' : 'bad'))),
        ),
      );
      q.append(line);
    }

    // Travel.
    const tr = section(`Travel · you're at ${here.col}, ${here.row}`);
    const col = input('number', String(here.col), 58);
    const rw = input('number', String(here.row), 58);
    tr.append(
      row(col, rw, button('Jump', () => call('/__gm', { to: `${col.value},${rw.value}` }))),
      row(...MAPS.filter(([a]) => a !== h.area()).map(([a, name]) => button(name, () => void (location.href = areaUrl(a))))),
    );

    // Mobs.
    const m = section('Mobs');
    m.append(row(button('Down within 8 tiles', () => call('/__gm', { slay: '8' })), button('Within 20', () => call('/__gm', { slay: '20' }))));

    body.replaceChildren(el('div', 'gm-title', 'GM tools · dev'), hp, lv, k, q, tr, m);
  };

  const offs = [onAdventure(() => open && render()), onTesting(() => open && render())];
  // (Where you are, now and then while it's open.)
  const tick = setInterval(() => open && document.activeElement?.tagName !== 'INPUT' && render(), 2000);
  render();
  return () => {
    for (const off of offs) off();
    removeEventListener('mk-gm-open', fromSettings);
    clearInterval(tick);
    root.remove();
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

function button(text: string, run: () => unknown): HTMLButtonElement {
  const b = el('button', 'gm-button', text);
  b.type = 'button';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    void run();
  });
  return b;
}

function input(type: string, value: string, width: number): HTMLInputElement {
  const i = el('input', 'gm-input');
  i.type = type;
  i.value = value;
  i.style.width = `${width}px`;
  i.addEventListener('keydown', (e) => e.stopPropagation()); // (typing here never walks you)
  return i;
}

function check(label: string, on: boolean, change: (on: boolean) => unknown): HTMLLabelElement {
  const l = el('label', 'gm-check');
  const box = el('input', '');
  box.type = 'checkbox';
  box.checked = on;
  box.addEventListener('change', () => void change(box.checked));
  l.append(box, document.createTextNode(` ${label}`));
  return l;
}

function section(title: string): HTMLElement {
  const s = el('div', 'gm-section');
  s.append(el('div', 'gm-heading', title));
  return s;
}

function row(...items: HTMLElement[]): HTMLElement {
  const r = el('div', 'gm-row');
  r.append(...items);
  return r;
}
