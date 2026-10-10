import type { TownWarrensGate, TownWarrensRun } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { el, showPopup } from './reward';
import { toast } from './toast';

// 🕳️ The Scrap Warrens on the page (DOM; world/warrens.ts and TownScene drive them):
// - The Warren Gate's panel (the Slums: a click on the gate, or walking up to it): "Scrap Warrens · Lv 15+ · solo or
//   party · needs 1 Warren Ticket", your level and tickets, and what you can do: Enter (alone), Open for my party, or
//   Join my party's run (no ticket), or why not (under Lv 15, the Warrens full, no ticket).
// - The invite when your party opens a run while you're in the Slums: Join / Not now, with its time running out.
// - The run's timer, top centre (the boss bar and the other top-centre boxes move down under it): the time left
//   (counted down here from the server's; red in the last minute), or while it gathers "Starts in 0:57".
// - The tracker (top left, where the quest tracker sits: that hides meanwhile, body.warrens-on): "Scrap Warrens", a pip
//   per boss that ticks as it falls; while it gathers, who it waits for and the opener's Start now; Leave.
// - The banner with an area's name as you walk into it, and the countdown when you've left the party inside.

const GATE_LINE = 'Lv 15+ · solo or party · needs 1 Warren Ticket';

/** The gate's panel: `act` opens (alone or for the party) or joins. */
export function showWarrensGate(g: TownWarrensGate, act: (what: 'open' | 'join') => void): void {
  const body: HTMLElement[] = [el('p', 'wr-gate-line', GATE_LINE)];
  body.push(el('p', 'wr-gate-you', `You: Lv ${g.level} · Warren Tickets: ${g.tickets}`));
  const actions = el('div', 'wr-gate-actions');
  const close = () => (document.querySelector('#reward .rw-x') as HTMLButtonElement | null)?.click();
  const button = (label: string, what: 'open' | 'join', primary = true) => {
    const b = el('button', primary ? 'wr-btn wr-go' : 'wr-btn', label);
    b.addEventListener('click', () => {
      close();
      act(what);
    });
    actions.append(b);
  };
  const why = (text: string) => body.push(el('p', 'wr-gate-why', text));
  if (g.level < g.minLevel) why(`You need Lv ${g.minLevel} to go in.`);
  else if (g.partyRun) {
    body.push(el('p', 'wr-gate-run', `${g.partyRun.opener} opened a run for your party (${g.partyRun.inside} inside, ${g.partyRun.phase === 'gathering' ? 'gathering' : 'under way'}).`));
    button("Join my party's run", 'join');
  } else if (g.blocked === 'full') why('The Warrens are full. Try again in a few minutes.');
  else if (g.blocked === 'ticket') why('You need a Warren Ticket. The sari-sari store sells them in its Dungeons tab.');
  else button(g.inParty ? 'Open for my party' : 'Enter', 'open');
  if (actions.childElementCount) body.push(actions);
  void showPopup({ title: 'Scrap Warrens', body, button: 'Close', celebrate: false, closeX: true });
}

/** Your party opened a run: Join (`answer(true)`) or Not now, for `ms`. */
export function showWarrensInvite(from: string, ms: number, answer: (join: boolean) => void): void {
  const box = el('div', 'pt-invite wr-invite');
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-label', `${from} opened the Scrap Warrens`);
  const text = el('p', 'pt-invite-text');
  text.append(el('b', undefined, from), ' opened the Scrap Warrens. Join?');
  const timer = el('span', 'pt-invite-bar');
  const yes = el('button', 'pt-yes', 'Join');
  const no = el('button', 'pt-no', 'Not now');
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
  const done = (join: boolean | null) => {
    clearTimeout(lapse);
    box.remove();
    if (join === null) return;
    playSound('click');
    answer(join);
  };
  const lapse = setTimeout(() => done(null), ms);
  yes.addEventListener('click', () => done(true));
  no.addEventListener('click', () => done(false));
}

/** m:ss */
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The run's tracker (top left, in the quest tracker's place). */
export class WarrensTracker {
  private readonly root = el('div');
  /** The timer, top centre: its label and the time. */
  private readonly clock = el('div');
  private readonly clockLabel = el('span', 'wr-clock-label', 'Time left');
  private readonly time = el('span', 'wr-time');
  private readonly pips = el('div', 'wr-pips');
  private readonly note = el('div', 'wr-note');
  private readonly start = el('button', 'wr-btn wr-go wr-start', 'Start now');
  private readonly leave = el('button', 'wr-btn wr-leave', 'Leave');
  private run: TownWarrensRun | null = null;
  /** When the server's `left` (and `gatherLeft`) were true (ms, performance.now). */
  private at = 0;
  private readonly tick: number;

  constructor(act: { start(): void; leave(): void }) {
    this.root.id = 'warrens-tracker';
    const head = el('div', 'wr-head');
    head.append(el('span', 'wr-title', 'Scrap Warrens'));
    this.clock.id = 'warrens-timer';
    this.clock.setAttribute('role', 'timer');
    this.clock.append(this.clockLabel, this.time);
    const buttons = el('div', 'wr-buttons');
    buttons.append(this.start, this.leave);
    this.root.append(head, this.pips, this.note, buttons);
    this.start.hidden = true;
    this.start.addEventListener('click', () => {
      playSound('click');
      act.start();
    });
    this.leave.addEventListener('click', () => {
      playSound('click');
      act.leave();
    });
    document.body.append(this.root, this.clock);
    document.body.classList.add('warrens-on');
    // In the quest tracker's place (under the top-left corner); the party panel goes under it.
    const place = () => {
      const left = document.querySelector('#town-hud .th-left')?.getBoundingClientRect();
      this.root.style.top = `${Math.round((left?.bottom ?? 0) + 12)}px`;
    };
    const corner = document.querySelector('#town-hud .th-left');
    if (corner) new ResizeObserver(place).observe(corner);
    addEventListener('resize', place);
    place();
    this.tick = window.setInterval(() => this.drawTime(), 250);
    dispatchEvent(new Event('resize')); // (the party panel moves under it)
  }

  set(run: TownWarrensRun): void {
    this.run = run;
    this.at = performance.now();
    this.pips.replaceChildren(
      ...run.bosses.map((b) => {
        const pip = el('span', b.dead ? 'wr-pip wr-down' : 'wr-pip');
        pip.title = `${b.name}${b.dead ? ' (down)' : ''}`;
        return pip;
      }),
    );
    const gathering = run.phase === 'gathering';
    this.start.hidden = !(gathering && run.yours);
    this.note.textContent = gathering
      ? run.waiting?.length
        ? `Waiting for ${run.waiting.join(', ')}…`
        : 'Getting ready…'
      : run.phase === 'cleared'
        ? 'Barong-Barong is down! The Warrens close soon.'
        : '';
    this.note.hidden = !this.note.textContent;
    this.drawTime();
    dispatchEvent(new Event('resize'));
  }

  private drawTime(): void {
    const r = this.run;
    if (!r) return;
    const gone = performance.now() - this.at;
    this.clockLabel.textContent = r.phase === 'gathering' ? 'Starts in' : r.phase === 'cleared' ? 'Closing in' : 'Time left';
    this.time.textContent = r.phase === 'gathering' ? clock((r.gatherLeft ?? 0) - gone) : clock(r.left - gone);
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

/** An area's name across the top as you walk into it (a moment, then gone). */
export function showAreaBanner(name: string): void {
  document.getElementById('warrens-area')?.remove();
  const b = el('div');
  b.id = 'warrens-area';
  b.append(el('span', 'wr-area-sub', 'Scrap Warrens'), el('span', 'wr-area-name', name));
  document.body.append(b);
  setTimeout(() => b.classList.add('wr-out'), 2600);
  setTimeout(() => b.remove(), 3200);
}

/** You left the party inside: out in `ms`, counted down. */
export function showKickCountdown(ms: number): void {
  const end = Date.now() + ms;
  const say = () => {
    const s = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    toast(`You left the party: out of the Warrens in ${s} s.`, 1100, 'bad');
    if (s > 1) setTimeout(say, 1000);
  };
  say();
}
