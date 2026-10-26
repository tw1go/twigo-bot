// 🔥 The combo counter (CONTEXT.md Combo): your own hits on mobs in a row, on battle maps. A big number with "HITS"
// beside it, one more for each of your hits that lands (TownScene `showHit` as its damage number pops, and your Boiling
// Splash puddle's burn ticks); under it "KILLS", one more for each mob your hit kills (only a mob still alive here before
// that hit: Mobs.hit says so, so one death never counts twice). A miss or a blocked hit lands nothing and counts for
// nothing. COMBO_MS without a new hit of yours ends the streak: a thin bar under it drains meanwhile, then both fade out
// and go back to 0. Being hit never ends it; leaving the map, a knock-out or the tab going hidden ends it at once. Only
// yours: a party member's hits, a pet's and a mob's never count. Page only (the server says who hit what), DOM, never in
// the way of clicks. Settings → Game → Combo counter (on by default; localStorage `mk_combo`) hides it and stops it.

/** How long a streak lasts without a new hit (ms). */
export const COMBO_MS = 2000;
/** The fade at its end (ms). */
const FADE_MS = 300;
const STORE = 'mk_combo';

/** Whether the combo counter is on (Settings → Game; on unless switched off). */
export function comboOn(): boolean {
  try {
    return localStorage.getItem(STORE) !== '0';
  } catch {
    return true;
  }
}

/** Switches the combo counter on or off (kept in this browser; the counter on screen follows at once). */
export function setComboOn(on: boolean): void {
  try {
    localStorage.setItem(STORE, on ? '1' : '0');
  } catch {
    // not remembered
  }
  window.dispatchEvent(new Event('mk-combo'));
}

/** The HUD's pieces on the right it must never cover (the minimap, the buttons and buff tray, the stay box, the feed). */
const KEEP_CLEAR = ['#town-hud .th-top', '#town-hud .th-buffs', '#minimap', '#stay', '#system-feed', '#hotbar', '#boss-bar'];
/** Its place: the right edge (px in from it), 38% down; the gap it keeps from anything in the way. */
const RIGHT = 24;
const TOP = 0.38;
const GAP = 10;
/** Never lower than this share of the screen at the edge (down in a corner it's missed mid-fight): left of them instead. */
const LOWEST = 0.6;

/** The hits number's colour by how many: 1-9 white, 10-24 gold, 25-49 orange, 50+ purple. */
const STEPS: [number, string][] = [[50, '#C084FC'], [25, '#FB923C'], [10, '#F8BF27'], [0, '#FFFFFF']];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class ComboCounter {
  private readonly root = el('div');
  private readonly hitsLine = el('div', 'cc-hits');
  private readonly hitsN = el('span', 'cc-n');
  private readonly killsLine = el('div', 'cc-kills');
  private readonly killsN = el('span', 'cc-n');
  private readonly fill = el('span', 'cc-fill');
  private hits = 0;
  private kills = 0;
  /** When the last hit landed (performance.now()); 0: no streak. */
  private lastAt = 0;
  /** Fading out since then (performance.now()); 0: not fading. */
  private fadeAt = 0;
  private raf = 0;
  private on = comboOn();
  private readonly quiet = matchMedia('(prefers-reduced-motion: reduce)');
  private readonly hidden = () => document.hidden && this.end();
  private readonly toggled = () => {
    this.on = comboOn();
    if (!this.on) this.end();
  };

  constructor() {
    this.root.id = 'combo-counter';
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true'); // (it's for the eye; the damage numbers say the same)
    this.hitsLine.append(this.hitsN, el('span', 'cc-word', 'HITS'));
    this.killsLine.append(this.killsN, el('span', 'cc-word', 'KILLS'));
    this.killsLine.hidden = true;
    const bar = el('div', 'cc-bar');
    bar.append(this.fill);
    this.root.append(this.hitsLine, this.killsLine, bar);
    document.body.append(this.root);
    document.addEventListener('visibilitychange', this.hidden);
    window.addEventListener('mk-combo', this.toggled);
  }

  /** One of your hits as it lands: a miss or a blocked one counts for nothing; `killed`: it killed a mob that was alive. */
  hit(h: { damage: number; miss?: boolean; blocked?: boolean }, killed: boolean): void {
    if (!this.on || h.miss || h.blocked || h.damage <= 0) return;
    const now = performance.now();
    if (this.fadeAt) this.reset(); // (a hit while it fades: a new streak)
    this.hits++;
    this.lastAt = now;
    this.hitsN.textContent = String(this.hits);
    this.hitsN.style.color = STEPS.find(([n]) => this.hits >= n)![1];
    this.pop(this.hitsN);
    if (killed) {
      this.kills++;
      this.killsN.textContent = String(this.kills);
      this.killsLine.hidden = false;
      this.pop(this.killsLine);
    }
    const starts = this.root.hidden;
    this.root.hidden = false;
    this.root.style.opacity = '1';
    if (starts) this.place();
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  /** The streak over at once (a knock-out, leaving the map): no fade. */
  end(): void {
    this.reset();
  }

  /** Gone for good (the scene closing). */
  destroy(): void {
    this.reset();
    document.removeEventListener('visibilitychange', this.hidden);
    window.removeEventListener('mk-combo', this.toggled);
    this.root.remove();
  }

  /** Each frame while a streak runs: the bar drains; COMBO_MS after the last hit it fades, then resets. */
  private tick(now: number): void {
    this.raf = 0;
    if (!this.lastAt) return;
    const left = 1 - (now - this.lastAt) / COMBO_MS;
    if (left > 0) this.fill.style.transform = `scaleX(${left.toFixed(3)})`;
    else {
      this.fill.style.transform = 'scaleX(0)';
      this.fadeAt ||= now;
      const fade = (now - this.fadeAt) / FADE_MS;
      if (fade >= 1) return this.reset();
      this.root.style.opacity = String(1 - fade);
    }
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  private reset(): void {
    cancelAnimationFrame(this.raf);
    Object.assign(this, { raf: 0, hits: 0, kills: 0, lastAt: 0, fadeAt: 0 });
    this.root.hidden = true;
    this.root.style.opacity = '1';
    this.killsLine.hidden = true;
    this.fill.style.transform = 'scaleX(1)';
  }

  /** Where it goes as a streak starts: the right edge a little above the middle, else just under whatever HUD piece is in
   *  the way there (no lower than LOWEST), else (no room in that column) just left of them, 38% down. Measured each time: the buff tray grows and
   *  shrinks, and the screen's size and the text size change it all. */
  private place(): void {
    const W = innerWidth;
    const H = innerHeight;
    // At its biggest (a two-digit streak with kills), so it never grows into something.
    const w = Math.max(this.root.offsetWidth, 110);
    const h = Math.max(this.root.offsetHeight, 80);
    const boxes = KEEP_CLEAR.flatMap((sel) => [...document.querySelectorAll<HTMLElement>(sel)])
      .map((e) => e.getBoundingClientRect())
      .filter((b) => b.width > 0 && b.height > 0);
    const clear = (x: number, y: number) => boxes.every((b) => x + w + GAP <= b.left || x >= b.right + GAP || y + h + GAP <= b.top || y >= b.bottom + GAP);
    const x = W - RIGHT - w;
    let y = Math.round(H * TOP);
    for (let k = 0; k < boxes.length + 1 && !clear(x, y); k++) {
      const under = boxes.filter((b) => x < b.right && b.left < x + w && y < b.bottom + GAP && b.top < y + h + GAP);
      y = Math.max(...under.map((b) => b.bottom)) + GAP;
    }
    if (clear(x, y) && y <= H * LOWEST) return void Object.assign(this.root.style, { right: `${RIGHT}px`, top: `${y}px` });
    // No room in that column: left of everything in it, 38% down.
    const y0 = Math.round(H * TOP);
    const column = boxes.filter((b) => b.right > x - GAP && b.top < y0 + h + GAP && b.bottom > y0 - GAP);
    const left = Math.min(x, ...column.map((b) => b.left)) - GAP;
    Object.assign(this.root.style, { right: `${Math.max(RIGHT, W - left)}px`, top: `${y0}px` });
  }

  /** A number or line pops: 1.25× down to 1 (none under reduced motion). */
  private pop(node: HTMLElement): void {
    if (this.quiet.matches) return;
    node.animate([{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 120, easing: 'ease-out' });
  }
}
