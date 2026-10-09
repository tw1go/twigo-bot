// ✨ The buffs on you (top right, under the HUD's buttons; it goes in the HUD's .th-buffs slot): one row each, its icon
// (manifest ui.skillIcons), its name, what it gives ("+ATK", or the numbers the server sends), and the time left
// ("4:32", seconds under a minute; a stance, which lasts until changed, says "On"). Amber under 30 s, the icon fading
// under 10 s, gone at 0. Phones, and more than four at once, show the icon and time only: hovering (or tapping) one
// shows a card beside it with the rest (its name, what it gives, the time left); a buff another one outdoes on every
// stat it gives is faded. Right-click a buff to take it off (`remove`). TownScene sets it from the server's `buffs` message (dev:
// ?buffs=demo shows pretend ones instead; __town.buffs).

/** A buff on you: whose class's it is and its name (classes.json buffs), when it ends (null: until changed, a stance),
 *  and the stats it gives as lines ("+24 ATK"; empty: its classes.json effect is shown). */
export interface ActiveBuff {
  cls: string;
  name: string;
  endsAt: number | null;
  stats: string[];
  /** Outdone: every stat it gives, another buff gives more of (only the strongest counts): shown faded. */
  weaker?: string;
}

/** More than this many: icons with their time only (what each gives on hover), so the tray stays small. */
const COMPACT_OVER = 4;

export interface BuffTrayOptions {
  /** A buff's icon (manifest ui.skillIcons), if there is one. */
  icon: (cls: string, name: string) => string | null;
  /** A buff's effect in words (classes.json buffs' `effect`), for a buff without numbers yet. */
  effect: (cls: string, name: string) => string | null;
  /** Right-click: take the buff off (TownScene asks the server). */
  remove?: (name: string) => void;
}

const el = (tag: string, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** "4:32", or "45s" under a minute. */
const left = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
};

export class BuffTray {
  private readonly el = el('div', 'buff-tray');
  /** The card for an icon-only row (hover or tap), beside it on the left. */
  private readonly tip = el('div', 'bt-tip');
  private tipFor: { b: ActiveBuff; row: HTMLElement; stats: string[] } | null = null;
  private buffs: { b: ActiveBuff; time: HTMLElement; row: HTMLElement }[] = [];
  private readonly timer: number;

  constructor(private readonly o: BuffTrayOptions) {
    this.el.setAttribute('aria-label', 'Buffs');
    (document.querySelector('#town-hud .th-buffs') ?? document.body).append(this.el);
    this.tip.hidden = true;
    document.body.append(this.tip);
    this.timer = window.setInterval(() => this.tick(), 250);
  }

  /** The buffs on you now (replaces the last list). */
  set(list: ActiveBuff[]): void {
    this.buffs = list.map((b) => {
      const row = el('div', 'bt-buff');
      const src = this.o.icon(b.cls, b.name);
      const pic = src ? Object.assign(el('img', 'bt-icon'), { src, alt: '' }) : el('span', 'bt-icon bt-initials', b.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2));
      const text = el('div', 'bt-text');
      text.append(el('div', 'bt-name', b.name));
      const stats = b.stats.length ? b.stats : [this.o.effect(b.cls, b.name) ?? ''].filter(Boolean);
      for (const s of stats) text.append(el('div', 'bt-stat', s));
      const time = el('div', 'bt-time');
      row.append(pic, text, time);
      if (b.weaker) row.classList.add('bt-weaker');
      // Icons only (phones, or more than four): a card with the rest on hover or tap.
      const show = () => {
        if (getComputedStyle(text).display !== 'none') return;
        this.tipFor = { b, row, stats };
        this.drawTip();
      };
      const hide = () => {
        if (this.tipFor?.row !== row) return;
        this.tipFor = null;
        this.tip.hidden = true;
      };
      row.addEventListener('pointerenter', show);
      row.addEventListener('pointerleave', hide);
      row.addEventListener('click', show);
      // Right-click takes it off.
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!this.o.remove) return;
        hide();
        this.o.remove(b.name);
      });
      row.tabIndex = 0;
      row.addEventListener('focus', show);
      row.addEventListener('blur', hide);
      row.setAttribute('aria-label', [b.name, ...stats].join(', '));
      return { b, time, row };
    });
    this.el.classList.toggle('bt-compact', list.length > COMPACT_OVER);
    this.el.replaceChildren(...this.buffs.map((x) => x.row));
    // (A card open on a buff that's still there moves to its new row; else it closes.)
    const was = this.tipFor;
    const still = was && this.buffs.find((x) => x.b.name === was.b.name);
    this.tipFor = null;
    this.tip.hidden = true;
    if (still) {
      this.tipFor = { b: still.b, row: still.row, stats: still.b.stats.length ? still.b.stats : [this.o.effect(still.b.cls, still.b.name) ?? ''].filter(Boolean) };
      this.drawTip();
    }
    this.tick();
  }

  /** The card: name, what it gives, which buff outdoes it, time left; beside its row, on the left. */
  private drawTip(): void {
    const t = this.tipFor;
    if (!t || !t.row.isConnected) return void (this.tip.hidden = true);
    const ms = t.b.endsAt === null ? null : t.b.endsAt - Date.now();
    this.tip.replaceChildren(
      el('b', 'bt-tip-name', t.b.name),
      ...t.stats.map((s) => el('div', 'bt-tip-stat', s)),
      ...(t.b.weaker ? [el('div', 'bt-tip-weaker', `${t.b.weaker} is stronger: only the strongest counts`)] : []),
      el('div', 'bt-tip-time', ms === null ? 'On (a stance)' : `${left(ms)} left`),
      ...(this.o.remove ? [el('div', 'bt-tip-key', 'Right-click: remove')] : []),
    );
    this.tip.hidden = false;
    const r = t.row.getBoundingClientRect();
    this.tip.style.top = `${Math.round(r.top)}px`;
    this.tip.style.right = `${Math.round(innerWidth - r.left + 6)}px`;
  }

  private tick(): void {
    const now = Date.now();
    const gone = this.buffs.filter((x) => x.b.endsAt !== null && x.b.endsAt <= now);
    for (const x of gone) x.row.remove();
    if (gone.length) this.buffs = this.buffs.filter((x) => !gone.includes(x));
    for (const { b, time, row } of this.buffs) {
      const ms = b.endsAt === null ? Infinity : b.endsAt - now;
      time.textContent = b.endsAt === null ? 'On' : left(ms);
      row.classList.toggle('bt-soon', ms < 30_000);
      row.classList.toggle('bt-fading', ms < 10_000);
    }
    if (this.tipFor) this.drawTip(); // (its time left)
  }

  destroy(): void {
    clearInterval(this.timer);
    this.el.remove();
    this.tip.remove();
  }
}
