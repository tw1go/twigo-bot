import type { TownStayClaim, TownStayInfo } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { fakeLogin } from '../session';
import { coinIcon, el } from './reward';

// ⏳ Staying in town pays (bot web/town-stay.ts): a Kowen to claim every 15 minutes in town, up to 20 a day. Above the
// system feed (bottom right; on phones above the bottom edge): a faint line counting down to the next one, and when
// one is ready, a little pop-up to claim it (the count to the next starts once it's claimed). The server counts the
// time and says when one is ready (`stay` message); the minutes shown between are counted here. Dev: pretend, with
// &stay=ready to start with one ready.

const TICK_MS = 60_000;

const pretend: TownStayInfo = { ready: false, minutes: 14, every: 15, claimed: 3, max: 20 };

async function load(): Promise<TownStayInfo | null> {
  if (fakeLogin()) return { ...pretend, ready: new URLSearchParams(location.search).get('stay') === 'ready' };
  const res = await fetch('/town/stay', { credentials: 'same-origin' }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownStayInfo) : null;
}

async function claim(): Promise<TownStayClaim | null> {
  if (fakeLogin()) return { ok: true, kowens: 0, stay: { ...pretend, ready: false, minutes: 0, claimed: pretend.claimed + 1 } };
  const res = await fetch('/town/stay', { method: 'POST', credentials: 'same-origin' }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownStayClaim) : null;
}

export class StayReward {
  private readonly root = el('div');
  private info: TownStayInfo | null = null;
  private busy = false;

  constructor() {
    this.root.id = 'stay';
    this.root.hidden = true;
    document.body.append(this.root);
    // A minute here is a minute counted there (the server says when one is ready; this is only the countdown shown).
    setInterval(() => {
      const s = this.info;
      if (!s || s.ready || s.claimed >= s.max) return;
      s.minutes = Math.min(s.every - 1, s.minutes + 1);
      this.render();
    }, TICK_MS);
    void load().then((s) => s && this.set(s));
    // Dev: the pretend one is ready a minute in.
    if (fakeLogin()) setTimeout(() => this.info && !this.info.ready && this.set({ ...this.info, ready: true }), TICK_MS);
  }

  /** From the server: where it stands (a Kowen ready pops up). */
  set(s: TownStayInfo): void {
    const was = this.info?.ready;
    this.info = s;
    this.render();
    if (s.ready && !was) playSound('coin', 0.5);
  }

  private render(): void {
    const s = this.info;
    if (!s) return;
    this.root.hidden = false;
    this.root.className = s.ready ? 'st-ready' : 'st-wait';
    const today = el('span', 'st-today', `${s.claimed}/${s.max} today`);
    if (!s.ready) {
      const left = s.every - s.minutes;
      const text = s.claimed >= s.max ? 'All of today’s stay Kowens claimed. Back tomorrow!' : `Staying in town: next Kowen in ${left <= 1 ? 'under a minute' : `${left} min`}`;
      this.root.replaceChildren(el('span', 'st-clock', '⏳'), el('span', 'st-text', text), today);
      this.root.title = 'A Kowen for every 15 minutes in town, up to 20 a day';
      return;
    }
    const button = el('button', 'st-claim', 'Claim');
    button.addEventListener('click', () => void this.claim(button));
    const words = el('span', 'st-words');
    words.append(el('b', undefined, '+1 Kowen'), el('span', undefined, `for staying ${s.every} minutes`));
    this.root.replaceChildren(coinIcon(2), words, today, button);
    this.root.title = '';
  }

  private async claim(button: HTMLButtonElement): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    button.disabled = true;
    const r = await claim();
    this.busy = false;
    if (!r) {
      button.disabled = false;
      playSound('error');
      return;
    }
    if (!r.ok) {
      playSound('error');
      this.set((await load()) ?? { ...this.info!, ready: false });
      return;
    }
    playSound('coin');
    this.set(r.stay);
    window.dispatchEvent(new Event('mk-wallet')); // the HUD's Kowens
  }
}
