import { type DerivedStats, moreStats } from '@mikazuki/shared';

// 📊 The stats box's lower part (the Equipment panel's and Info's): crit damage, damage amp, attack rate, DEF rate,
// lifesteal, manasteal, HP and MP regen, drop rate (shared moreStats), under a "More stats" fold. Open on tall screens
// at first; opening or folding it is remembered in this browser (localStorage `mk_more_stats`), for both windows.

const STORE = 'mk_more_stats';

function isOpen(): boolean {
  try {
    const v = localStorage.getItem(STORE);
    if (v === '1' || v === '0') return v === '1';
  } catch {
    /* private window: the default */
  }
  return innerHeight >= 900;
}

function remember(open: boolean): void {
  try {
    localStorage.setItem(STORE, open ? '1' : '0');
  } catch {
    /* private window: not remembered */
  }
}

/** The fold and its rows. `base`: the stats without buffs, so a buff's part shows in green ("+10%"); without it, none. */
export function moreStatsSection(d: Partial<DerivedStats>, base?: Partial<DerivedStats>): HTMLElement[] {
  const rows = moreStats(d);
  if (!rows.length) return [];
  const before = new Map((base ? moreStats(base) : []).map((r) => [r.id, r]));
  const grid = el('div', 'eq-more');
  for (const r of rows) {
    const row = el('div', 'eq-stat');
    row.title = r.about;
    const value = el('b', 'eq-stat-value', r.text);
    const was = before.get(r.id);
    if (base && !was) value.classList.add('eq-buffed'); // (all of it from a buff)
    else if (was && r.value - was.value > 1e-6) {
      value.textContent = was.text;
      value.append(el('span', 'eq-buffed', ` +${moreStats({ [r.id]: r.value - was.value }).find((x) => x.id === r.id)?.text ?? ''}`));
    }
    row.append(el('span', 'eq-stat-label', r.label), value);
    grid.append(row);
  }
  const toggle = el('button', 'eq-more-toggle');
  const show = (open: boolean) => {
    grid.hidden = !open;
    toggle.textContent = `More stats ${open ? '▾' : '▸'}`;
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => {
    const open = grid.hidden !== false; // (folded: open it)
    show(open);
    remember(open);
  });
  show(isOpen());
  return [toggle, grid];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
