import type { TownSystemLine } from '@mikazuki/shared';
import { toast } from './toast';

// 📰 The system feed (bottom right): what happens around the server — digs and bets from the Discord commands — as
// plain lines coloured by result (a dig's rarity; won, lost, busted). Same see-through box as the chat, lines
// stacked from the bottom, fading when quiet. Hidden on phones (no room next to the chat and the counters). Your own
// pickups (`mine`) are lines added here by the page only: never sent anywhere, nobody else sees them (on phones a toast).
// What the feed shows is kept per browser tab (sessionStorage `mk_feed`, your lines included) and put back on the next
// page, so a map change (a page load: TownScene `travel`) doesn't lose your "Gained …" lines; the welcome's history then
// only adds the server lines newer than what came back. A new tab, another login or 30 quiet minutes start clean.

const MAX_LINES = 30;
const IDLE_MS = 15_000;
const FEED_KEY = 'mk_feed';
/** How long a tab's snapshot is worth putting back. */
const KEEP_MS = 30 * 60_000;

type Run = { text: string; colour: string };
/** A row as kept: a server line, or one of yours (its coloured runs). */
type Row = { s: TownSystemLine } | { m: Run[] };
interface Snapshot {
  who: string | null;
  at: number;
  rows: Row[];
}

const keyOf = (l: TownSystemLine) => `${l.kind}|${l.text}`;

export class SystemFeed {
  private readonly root: HTMLElement;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  /** What's shown, oldest first (what's saved). */
  private rows: Row[] = [];
  /** The rows came back from this tab's snapshot, and the server lines among them: the welcome's history merges. */
  private restored: TownSystemLine[] | null = null;

  /** `who`: the player (nickname) the tab's kept lines belong to; another login's are dropped. */
  constructor(private readonly who: string | null = null) {
    this.root = document.createElement('div');
    this.root.id = 'system-feed';
    this.root.setAttribute('role', 'log');
    this.root.setAttribute('aria-label', 'Around the server');
    this.root.addEventListener('mouseenter', () => this.wake());
    this.root.addEventListener('mouseleave', () => this.wake());
    document.body.append(this.root);
    this.restore();
    this.wake();
  }

  add(line: TownSystemLine): void {
    this.put(this.serverRow(line), { s: line });
    this.save();
  }

  /** A line only you see, added by the page, in coloured runs (what you picked up: "Gained " in white, the item's name
   *  in its rarity's colour). Where the feed is hidden (phones) it's a short toast instead; `toastToo`: a toast as well. */
  mine(parts: Run[], toastToo = false): void {
    const text = parts.map((p) => p.text).join('');
    if (toastToo || this.hidden()) toast(text, toastToo ? 3200 : 1800);
    if (this.hidden()) return;
    this.put(this.mineRow(parts), { m: parts });
    this.save();
  }

  /** What happened before you arrived (as the server remembers it). After a reconnect (`more`) what's shown stays and
   *  only lines not shown yet are added. After a restore (a map change) the same, by what the server still remembers:
   *  only the lines newer than the newest restored server line (none of them left: all of `lines` is newer; no server
   *  line restored at all: `lines` go above yours, as older news). */
  history(lines: TownSystemLine[], more = false): void {
    const restored = this.restored;
    this.restored = null;
    if (restored && !more) {
      let from = 0; // (how many of `lines` are already shown)
      let found = false;
      for (let i = restored.length - 1; i >= 0 && !found; i--) {
        const k = keyOf(restored[i]);
        for (let j = lines.length - 1; j >= 0; j--) if (keyOf(lines[j]) === k) { from = j + 1; found = true; break; }
      }
      if (restored.length && !found) from = 0;
      if (!restored.length) {
        const first = this.root.firstElementChild;
        const older: Row[] = [];
        for (const l of lines) { this.root.insertBefore(this.serverRow(l), first); older.push({ s: l }); }
        this.rows.unshift(...older);
        this.trim();
        this.save();
        return;
      }
      for (const l of lines.slice(from)) this.add(l);
      return;
    }
    if (!more) { this.root.replaceChildren(); this.rows = []; }
    const shown = new Map<string, number>();
    for (const row of this.root.children) {
      const k = (row as HTMLElement).dataset.key ?? '';
      shown.set(k, (shown.get(k) ?? 0) + 1);
    }
    for (const l of lines) {
      const k = keyOf(l);
      const n = shown.get(k) ?? 0;
      if (n) shown.set(k, n - 1);
      else this.add(l);
    }
  }

  private hidden(): boolean {
    return getComputedStyle(this.root).display === 'none';
  }

  private serverRow(line: TownSystemLine): HTMLElement {
    const row = document.createElement('div');
    row.className = `sf-line sf-${line.kind}`;
    row.dataset.tone = line.tone;
    row.dataset.key = keyOf(line);
    if (line.tone === 'secret') row.classList.add('prismatic');
    row.textContent = line.text;
    return row;
  }

  private mineRow(parts: Run[]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'sf-line sf-mine';
    row.dataset.key = `mine|${parts.map((p) => p.text).join('')}`; // never matches a server line: a reconnect's history keeps it
    for (const p of parts) {
      const run = document.createElement('span');
      run.style.color = p.colour;
      run.textContent = p.text;
      row.append(run);
    }
    return row;
  }

  /** A row at the bottom, the oldest dropped past MAX_LINES. */
  private put(el: HTMLElement, row: Row): void {
    this.root.append(el);
    this.rows.push(row);
    this.trim();
    this.root.scrollTop = this.root.scrollHeight;
    this.wake();
  }

  private trim(): void {
    while (this.root.childElementCount > MAX_LINES) this.root.firstElementChild?.remove();
    if (this.rows.length > MAX_LINES) this.rows.splice(0, this.rows.length - MAX_LINES);
  }

  /** The tab's snapshot of what's shown (no storage, private mode, quota: nothing kept, as before). */
  private save(): void {
    try {
      const snap: Snapshot = { who: this.who, at: Date.now(), rows: this.rows };
      sessionStorage.setItem(FEED_KEY, JSON.stringify(snap));
    } catch {
      /* no storage */
    }
  }

  /** The tab's snapshot back, if it's this player's and fresh: its rows in order, no toasts or saving. */
  private restore(): void {
    let snap: Snapshot | null = null;
    try {
      const raw = sessionStorage.getItem(FEED_KEY);
      snap = raw ? (JSON.parse(raw) as Snapshot) : null;
    } catch {
      snap = null;
    }
    const fresh = snap && Array.isArray(snap.rows) && snap.who === this.who && Date.now() - snap.at < KEEP_MS;
    if (!fresh || !snap) {
      try { sessionStorage.removeItem(FEED_KEY); } catch { /* no storage */ }
      return;
    }
    const server: TownSystemLine[] = [];
    for (const r of snap.rows) {
      if ('s' in r && r.s) { this.put(this.serverRow(r.s), r); server.push(r.s); }
      else if ('m' in r && Array.isArray(r.m) && !this.hidden()) this.put(this.mineRow(r.m), r);
    }
    if (this.rows.length) this.restored = server;
  }

  private wake(): void {
    this.root.classList.remove('sf-idle');
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.root.matches(':hover')) return this.wake();
      this.root.classList.add('sf-idle');
    }, IDLE_MS);
  }
}
