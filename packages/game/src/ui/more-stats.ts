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

/** The fold and its rows. `base`: the stats without buffs, so a buff's part shows in green ("+10%"); without it, none.
 *  `bare`: without your pet too, so the pet's part shows as its own ("+1.5% Pet"). */
export function moreStatsSection(d: Partial<DerivedStats>, base?: Partial<DerivedStats>, bare?: Partial<DerivedStats>): HTMLElement[] {
  const rows = moreStats(d);
  if (!rows.length) return [];
  const before = new Map((base ? moreStats(base) : []).map((r) => [r.id, r]));
  const without = new Map((bare ? moreStats(bare) : []).map((r) => [r.id, r]));
  const part = (id: string, n: number) => moreStats({ [id]: n }).find((x) => x.id === id)?.text ?? '';
  const grid = el('div', 'eq-more');
  for (const r of rows) {
    const row = el('div', 'eq-stat');
    row.title = r.about;
    const value = el('b', 'eq-stat-value', r.text);
    const was = before.get(r.id);
    const own = without.get(r.id);
    if (base && !was) value.classList.add('eq-buffed'); // (all of it from a buff)
    else if (was) {
      const pet = own ? was.value - own.value : 0;
      const buff = r.value - was.value;
      if (pet > 1e-6 || buff > 1e-6) value.textContent = (pet > 1e-6 && own ? own : was).text;
      if (pet > 1e-6) value.append(petPart(` +${part(r.id, pet)}`));
      if (buff > 1e-6) value.append(el('span', 'eq-buffed', ` +${part(r.id, buff)}`));
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

/** A pet's part of a stat: "+1.5%" in the pet's colour, "Pet" after it. */
export function petPart(text: string): HTMLElement {
  const s = el('span', 'eq-pet-part', text);
  s.title = 'From your pet';
  s.append(el('small', 'eq-pet-word', ' Pet'));
  return s;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
