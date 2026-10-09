// ✨ The buffs on you (top right, under the HUD's buttons; it goes in the HUD's .th-buffs slot): one row each, its icon
// (manifest ui.skillIcons), its name, what it gives ("+ATK", or the numbers the server sends), and the time left
// ("4:32", seconds under a minute; a stance, which lasts until changed, says "On"). Amber under 30 s, the icon fading
// under 10 s, gone at 0. Phones show the icon and time only. Buffs can't be cast yet: nothing calls `set` but the dev
// demo (?buffs=demo) and the debug hook (__town.buffs).

/** A buff on you: whose class's it is and its name (classes.json buffs), when it ends (null: until changed, a stance),
 *  and the stats it gives as lines ("+24 ATK"; empty: its classes.json effect is shown). */
export interface ActiveBuff {
  cls: string;
  name: string;
  endsAt: number | null;
  stats: string[];
}

export interface BuffTrayOptions {
  /** A buff's icon (manifest ui.skillIcons), if there is one. */
  icon: (cls: string, name: string) => string | null;
  /** A buff's effect in words (classes.json buffs' `effect`), for a buff without numbers yet. */
  effect: (cls: string, name: string) => string | null;
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
  private buffs: { b: ActiveBuff; time: HTMLElement; row: HTMLElement }[] = [];
  private readonly timer: number;

  constructor(private readonly o: BuffTrayOptions) {
    this.el.setAttribute('aria-label', 'Buffs');
    (document.querySelector('#town-hud .th-buffs') ?? document.body).append(this.el);
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
      row.title = [b.name, ...stats].join('\n');
      return { b, time, row };
    });
    this.el.replaceChildren(...this.buffs.map((x) => x.row));
    this.tick();
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
  }

  destroy(): void {
    clearInterval(this.timer);
    this.el.remove();
  }
}
