import type { TownDailyClaim, TownStayClaim, TownStayInfo } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { fakeLogin } from '../session';
import { coinIcon, el, showPopup, showReward } from './reward';

// ⏳ Staying in town pays (bot web/town-stay.ts): a Kowen to claim every 15 minutes in town, up to 20 a day. Above the
// system feed (bottom right; on phones above the bottom edge): a faint line counting down to the next one, and when
// one is ready, a little pop-up to claim it (the count to the next starts once it's claimed). The server counts the
// time and says when one is ready (`stay` message); the minutes shown between are counted here. Under it, the Kowens
// voice chat in Discord can still pay today (GET /town/stay's `voice`, fetched again every minute). Last, the daily
// Kowens (/get-kowens; GET /town/stay's `daily`, POST /town/daily): a Claim button until they're claimed (here or in
// Discord), and on the first visit of the day a pop-up offering them. Dev: pretend, with &stay=ready to start with one
// ready, &voice=N for N voice Kowens already earned, &daily=claimed for the daily Kowens already claimed.

const TICK_MS = 60_000;

const q = new URLSearchParams(location.search);
const pretend: TownStayInfo = { ready: false, minutes: 14, every: 15, claimed: 3, max: 20, voice: { earned: Number(q.get('voice') ?? 5), max: 12, minutes: 7, every: 15 }, daily: { claimed: q.get('daily') === 'claimed', amount: 5 } };
/** The day the daily Kowens were last offered in a pop-up here (once a day, even if put off). */
const OFFER_KEY = 'mk_daily_offer';

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

async function claimDaily(): Promise<TownDailyClaim | null> {
  if (fakeLogin()) {
    pretend.daily = { claimed: true, amount: 5 };
    return { ok: true, amount: 5, kowens: 1255, christmas: false };
  }
  const res = await fetch('/town/daily', { method: 'POST', credentials: 'same-origin' }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownDailyClaim) : null;
}

const kowens = (n: number) => `${n} ${n === 1 ? 'Kowen' : 'Kowens'}`;

export class StayReward {
  private readonly root = el('div');
  private info: TownStayInfo | null = null;
  private busy = false;

  constructor() {
    this.root.id = 'stay';
    this.root.hidden = true;
    document.body.append(this.root);
    // A minute here is a minute counted there (the server says when one is ready; this is only the countdown shown).
    // Voice time is counted in Discord, so that's asked again each minute.
    setInterval(() => {
      const s = this.info;
      if (!s) return;
      if (!s.ready && s.claimed < s.max) s.minutes = Math.min(s.every - 1, s.minutes + 1);
      this.render();
      if (!fakeLogin()) void load().then((fresh) => fresh && this.info && !this.info.ready && this.set(fresh));
    }, TICK_MS);
    void load().then((s) => {
      if (!s) return;
      this.set(s);
      if (s.daily && !s.daily.claimed) this.offerDaily(s.daily.amount);
    });
    // Dev: the pretend one is ready a minute in.
    if (fakeLogin()) setTimeout(() => this.info && !this.info.ready && this.set({ ...this.info, ready: true }), TICK_MS);
  }

  /** From the server: where it stands (a Kowen ready pops up). */
  set(s: TownStayInfo): void {
    const was = this.info?.ready;
    this.info = { ...s, voice: s.voice ?? this.info?.voice, daily: s.daily ?? this.info?.daily }; // `stay` messages don't carry these
    s = this.info;
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
      this.root.replaceChildren(el('span', 'st-clock', '⏳'), el('span', 'st-text', text), today, ...this.voiceLine(), ...this.dailyLine());
      this.root.title = 'A Kowen for every 15 minutes in town, up to 20 a day';
      return;
    }
    const button = el('button', 'st-claim', 'Claim');
    button.addEventListener('click', () => void this.claim(button));
    const words = el('span', 'st-words');
    words.append(el('b', undefined, '+1 Kowen'), el('span', undefined, `for staying ${s.every} minutes`));
    this.root.replaceChildren(coinIcon(2), words, today, button, ...this.voiceLine(), ...this.dailyLine());
    this.root.title = '';
  }

  /** How many voice chat Kowens are left today, and the minutes in voice to the next. */
  private voiceLine(): HTMLElement[] {
    const v = this.info?.voice;
    if (!v) return [];
    const left = Math.max(0, v.max - v.earned);
    const line = el('div', 'st-voice');
    line.title = `Voice chat in Discord: 1 Kowen per ${v.every} min (with someone else, not deafened), up to ${v.max} a day`;
    line.append(
      el('span', 'st-clock', '🎙️'),
      el('span', 'st-text', left ? `Voice chat: ${left} ${left === 1 ? 'Kowen' : 'Kowens'} left today · next after ${v.every - v.minutes} min in voice` : 'Voice chat: all of today’s Kowens earned. Back tomorrow!'),
      el('span', 'st-today', `${v.earned}/${v.max} today`),
    );
    return [line];
  }

  /** The daily Kowens: a Claim button until they're claimed today. */
  private dailyLine(): HTMLElement[] {
    const d = this.info?.daily;
    if (!d) return [];
    const line = el('div', `st-voice st-daily${d.claimed ? '' : ' st-daily-ready'}`);
    line.title = `${kowens(d.amount)} a day, claimed here or with /get-kowens in Discord`;
    if (d.claimed) {
      line.append(el('span', 'st-clock', '🪙'), el('span', 'st-text', 'Daily Kowens claimed. Back tomorrow!'));
      return [line];
    }
    const button = el('button', 'st-claim st-daily-claim', 'Claim');
    button.addEventListener('click', () => void this.takeDaily(button));
    line.append(coinIcon(1), el('span', 'st-text', `Daily Kowens: +${kowens(d.amount)}`), button);
    return [line];
  }

  /** On the day's first visit (in this browser): a pop-up offering the daily Kowens (Later leaves the button). */
  private offerDaily(amount: number): void {
    const day = new Date().toDateString();
    try {
      if (localStorage.getItem(OFFER_KEY) === day) return;
      localStorage.setItem(OFFER_KEY, day);
    } catch {
      // private mode: offered every visit
    }
    const coin = el('div', 'dk-coin');
    coin.append(coinIcon(6));
    const take = el('button', 'dk-claim', `Claim +${kowens(amount)}`);
    take.addEventListener('click', () => {
      document.querySelector<HTMLButtonElement>('#reward .rw-ok')?.click();
      void this.takeDaily(take);
    });
    void showPopup({
      title: 'Daily Kowens',
      body: [coin, el('p', 'rw-message', `Your ${kowens(amount)} for today are waiting. Spend them in town or in Discord.`), take],
      button: 'Later',
      celebrate: false,
    });
  }

  private async takeDaily(button: HTMLButtonElement): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    button.disabled = true;
    const r = await claimDaily();
    this.busy = false;
    if (!r) {
      button.disabled = false;
      playSound('error');
      return;
    }
    if (this.info?.daily) this.info.daily = { ...this.info.daily, claimed: true };
    this.render();
    if (!r.ok) return void playSound('error'); // already claimed (in Discord): the line says so now
    window.dispatchEvent(new Event('mk-wallet')); // the HUD's Kowens
    void showReward({
      title: r.christmas ? 'Merry Christmas!' : 'Daily Kowens',
      graphic: { kind: 'kowens', amount: r.amount },
      message: `${r.christmas ? 'Double Kowens today! ' : ''}You now have ${kowens(r.kowens)}. Come back tomorrow for more.`,
    });
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
