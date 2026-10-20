import type { SilongFloor, TownSilongGate, TownSilongRun } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { el, showPopup } from './reward';
import { toast } from './toast';

// 🧊 Ang Silong on the page (DOM; world/silong.ts and TownScene drive them; CONTEXT.md Silong, Freight elevator):
// - The Silong Hatch's panel (the Palengke's Market Hall: a click on the hatch, or walking up to it): "Ang Silong · Lv
//   37+ · solo or party · needs 1 Susi ng Silong", your level and keys, and what you can do: Enter (alone), Open for my
//   party, Join my party's run (no key), with the Practice Susi Practice run (alone), or why not.
// - The run's timer, top centre (the Warrens' #warrens-timer look), and its tracker in the quest tracker's place: a row
//   per floor (reached or not) with a pip per mini boss, the elevator down's state, the B3 door; Leave.
// - "Bumaba na kayo?": someone stepped into the open elevator down: Ride along / Stay, while it waits.
// - The arrival elevator's box: the floors above the run has reached, to ride up alone.

const gateLine = (minLevel: number) => `Lv ${minLevel}+ · solo or party · needs 1 Susi ng Silong (back if no mini boss falls)`;

/** The hatch's panel: `act` opens (alone or for the party), joins, or opens a practice run. */
export function showSilongGate(g: TownSilongGate, act: (what: 'open' | 'join' | 'practice') => void): void {
  const body: HTMLElement[] = [el('p', 'wr-gate-line', gateLine(g.minLevel))];
  body.push(el('p', 'wr-gate-you', `You: Lv ${g.level} · Susi ng Silong: ${g.keys}${g.practice ? ` · Practice Susi: ${g.practice.keys}` : ''}`));
  const actions = el('div', 'wr-gate-actions');
  const close = () => (document.querySelector('#reward .rw-x') as HTMLButtonElement | null)?.click();
  const button = (label: string, what: 'open' | 'join' | 'practice', primary = true) => {
    const b = el('button', primary ? 'wr-btn wr-go' : 'wr-btn', label);
    b.addEventListener('click', () => {
      close();
      act(what);
    });
    actions.append(b);
  };
  const why = (text: string) => body.push(el('p', 'wr-gate-why', text));
  if (g.partyRun) {
    body.push(el('p', 'wr-gate-run', `${g.partyRun.opener} opened a run for your party (${g.partyRun.inside} inside).`));
    button("Join my party's run", 'join');
  } else if (g.blocked === 'level' || g.blocked === 'quest') why(g.questLine ?? `You need Lv ${g.minLevel} to go in.`);
  else if (g.blocked === 'full') why('Ang Silong is full. Try again in a few minutes.');
  else if (g.blocked === 'key') why('You need a Susi ng Silong. Aling Conching sells them after the Great Scale rests.');
  else button(g.inParty ? 'Open for my party' : 'Enter', 'open');
  if (g.practice) {
    const P = g.practice;
    if (P.blocked === 'run') why("You're in a run already: the practice run waits until it's over.");
    else if (P.blocked === 'full') why('Ang Silong is full. Try again in a few minutes.');
    else if (P.blocked === 'level') why(`Ang Silong is for Lv ${g.minLevel} and up.`);
    else button('Practice run (alone)', 'practice', !actions.childElementCount);
  }
  if (actions.childElementCount) body.push(actions);
  void showPopup({ title: 'Ang Silong', body, button: 'Close', celebrate: false, closeX: true });
}

/** m:ss */
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const KEY_BACK = 'mk_silong_key_back';

/** The run ended before a mini boss fell and the opener's key went back: kept through the trip up (a page load). */
export function noteKeyBack(practice = false): void {
  try {
    sessionStorage.setItem(KEY_BACK, practice ? 'practice' : '1');
  } catch {
    /* (no storage: untold) */
  }
}

/** On arrival: the key-back toast, once. */
export function tellKeyBack(): void {
  let back: string | null;
  try {
    back = sessionStorage.getItem(KEY_BACK);
    if (!back) return;
    sessionStorage.removeItem(KEY_BACK);
  } catch {
    return;
  }
  toast(`Your ${back === 'practice' ? 'Practice Susi ng Silong' : 'Susi ng Silong'} is back: the run ended before a mini boss fell.`, 4500);
}

/** The run's tracker (top left, in the quest tracker's place) and its timer (top centre). */
export class SilongTracker {
  private readonly root = el('div');
  private readonly clock = el('div');
  private readonly clockLabel = el('span', 'wr-clock-label', 'Time left');
  private readonly time = el('span', 'wr-time');
  private readonly practice = el('span', 'wr-practice', 'Practice');
  private readonly floors = el('div', 'sl-floors');
  private readonly leave = el('button', 'wr-btn wr-leave', 'Leave');
  private run: TownSilongRun | null = null;
  private at = 0;
  private readonly tick: number;

  constructor(
    act: { leave(): void },
    /** The floor you're on. */
    private readonly here: SilongFloor,
  ) {
    this.root.id = 'warrens-tracker';
    const head = el('div', 'wr-head');
    head.append(el('span', 'wr-title', 'Ang Silong'));
    this.clock.id = 'warrens-timer';
    this.clock.setAttribute('role', 'timer');
    this.clock.append(this.clockLabel, this.time, this.practice);
    this.practice.hidden = true;
    const buttons = el('div', 'wr-buttons');
    buttons.append(this.leave);
    this.root.append(head, this.floors, buttons);
    this.leave.addEventListener('click', () => {
      playSound('click');
      act.leave();
    });
    document.body.append(this.root, this.clock);
    document.body.classList.add('warrens-on');
    const place = () => {
      const left = document.querySelector('#town-hud .th-left')?.getBoundingClientRect();
      this.root.style.top = `${Math.round((left?.bottom ?? 0) + 12)}px`;
    };
    const corner = document.querySelector('#town-hud .th-left');
    if (corner) new ResizeObserver(place).observe(corner);
    addEventListener('resize', place);
    place();
    this.tick = window.setInterval(() => this.drawTime(), 250);
    dispatchEvent(new Event('resize'));
  }

  set(run: TownSilongRun): void {
    this.run = run;
    this.at = performance.now();
    this.floors.replaceChildren(
      ...run.floors.map((f) => {
        const row = el('div', `sl-floor${f.floor === this.here ? ' sl-here' : ''}${f.reached ? '' : ' sl-dark'}`);
        row.append(el('span', 'sl-floor-name', f.floor.toUpperCase()));
        const pips = el('span', 'wr-pips');
        pips.append(
          ...f.bosses.map((b) => {
            const pip = el('span', b.dead ? 'wr-pip wr-down' : 'wr-pip');
            pip.title = `${b.name}${b.dead ? ' (down)' : ''}`;
            return pip;
          }),
        );
        row.append(pips);
        if (f.open) row.append(el('span', 'sl-open', '↓ open'));
        if (f.floor === 'b3' && f.reached) row.append(el('span', run.door ? 'sl-open' : 'sl-shut', run.door ? 'door open' : 'door shut'));
        row.title = f.name;
        return row;
      }),
    );
    this.drawTime();
    dispatchEvent(new Event('resize'));
  }

  private drawTime(): void {
    const r = this.run;
    if (!r) return;
    const gone = performance.now() - this.at;
    this.clockLabel.textContent = r.phase === 'cleared' ? 'Closing in' : 'Time left';
    this.practice.hidden = !r.practice;
    this.time.textContent = clock(r.left - gone);
    this.clock.classList.toggle('wr-late', r.phase === 'running' && r.left - gone < 60_000);
  }

  destroy(): void {
    clearInterval(this.tick);
    this.root.remove();
    this.clock.remove();
    document.body.classList.remove('warrens-on');
    dispatchEvent(new Event('resize'));
  }
}

/** "Bumaba na kayo?": the elevator down waits `ms` more; Ride along (`answer(true)`) or Stay. */
export function showRideAsk(ms: number, answer: (yes: boolean) => void): void {
  document.getElementById('silong-ride')?.remove();
  const box = el('div', 'pt-invite wr-invite');
  box.id = 'silong-ride';
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-label', 'Bumaba na kayo?');
  const text = el('p', 'pt-invite-text');
  text.append(el('b', undefined, 'Bumaba na kayo?'), ' The freight elevator is going down.');
  const timer = el('span', 'pt-invite-bar');
  const yes = el('button', 'pt-yes', 'Ride along');
  const no = el('button', 'pt-no', 'Stay');
  const row = el('div', 'pt-invite-row');
  row.append(no, yes);
  box.append(text, row, timer);
  let stack = document.getElementById('party-invites');
  if (!stack) {
    stack = el('div');
    stack.id = 'party-invites';
    document.body.append(stack);
  }
  stack.append(box);
  playSound('click');
  timer.style.animationDuration = `${ms}ms`;
  const done = (ride: boolean | null) => {
    clearTimeout(lapse);
    box.remove();
    if (ride === null) return;
    playSound('click');
    answer(ride);
  };
  const lapse = setTimeout(() => done(null), ms);
  yes.addEventListener('click', () => done(true));
  no.addEventListener('click', () => done(false));
}

/** The arrival elevator's box: the floors above you the run has reached; `choose` rides up to one (alone). */
export function showRideUp(floors: { floor: SilongFloor; name: string }[], choose: (floor: SilongFloor) => void): void {
  const body: HTMLElement[] = [el('p', 'wr-gate-line', 'Ride up alone to a floor your run has reached.')];
  const actions = el('div', 'wr-gate-actions');
  const close = () => (document.querySelector('#reward .rw-x') as HTMLButtonElement | null)?.click();
  for (const f of floors) {
    const b = el('button', 'wr-btn wr-go', `↑ ${f.name}`);
    b.addEventListener('click', () => {
      close();
      choose(f.floor);
    });
    actions.append(b);
  }
  body.push(actions);
  void showPopup({ title: 'Freight elevator', body, button: 'Stay', celebrate: false, closeX: true });
}
