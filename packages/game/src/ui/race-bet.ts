import type { TownRace, TownRaceResponse } from '@mikazuki/shared';
import { betField } from '../arena/menu';
import { playSound } from '../audio/sound';
import { betOnRace, loadRace, onRace, raceNow } from '../net/race';
import { fakeLogin } from '../session';
import { el, followWallet, showPopup } from './reward';
import { mosangName } from './race-box';

// 🏁 The Mosang race's pop-up (the race box, top right): the five runners with their portraits and the bets on each so
// far, and — while betting's open — pick one and bet 1–100 Kowens (one bet per race; she wins you PAYOUT×). The same
// race and the same rules as Discord's /race (bot games/race.ts). Follows the race live while it's open.

let portraitUrl: (id: string) => string = () => '';

/** Where a Mosang's portrait is (manifest npcs.portrait; set by the town). */
export function setRacePortraits(fn: (id: string) => string): void {
  portraitUrl = fn;
}

const kowens = (n: number) => `${n} ${n === 1 ? 'Kowen' : 'Kowens'}`;
const PORTRAIT = 32;
const PORTRAIT_PX = 2;

export function showRaceBet(): void {
  const open = document.querySelector<HTMLButtonElement>('#reward:has(.rb-body) .rw-ok');
  if (open) return void open.click(); // the race box toggles it

  const body = el('div', 'rb-body');
  const head = el('p', 'rb-status', 'Loading…');
  const cards = el('div', 'rb-cards');
  cards.setAttribute('role', 'radiogroup');
  cards.setAttribute('aria-label', 'Runners');
  const bet = betField(10);
  const go = el('button', 'rb-go', 'Bet');
  const controls = el('div', 'rb-controls');
  controls.append(bet.el, go);
  const note = el('p', 'rb-note');
  note.setAttribute('role', 'status');
  body.append(head, cards, controls, note);

  let data: TownRaceResponse | null = null;
  let picked: number | null = null;
  let busy = false;

  const render = () => {
    const r = data?.race;
    if (!r) {
      head.textContent = 'No race on right now. Talk to an Aling in town to start one!';
      cards.replaceChildren();
      controls.hidden = true;
      return;
    }
    const open = !r.run && raceNow() < r.closesAt;
    const left = Math.max(0, Math.ceil((r.closesAt - raceNow()) / 1000));
    head.textContent = open
      ? `Bets close in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · started by ${r.startedBy}`
      : r.run && raceNow() >= r.run.endsAt
        ? `${mosangName(r.runners[r.run.winner])}${r.run.tie >= 0 ? ` and ${mosangName(r.runners[r.run.tie])}` : ''} won!`
        : "Betting's closed: they're off! Watch on the main road.";
    cards.replaceChildren(...r.runners.map((id, lane) => card(r, id, lane, open)));
    const mine = data?.mine;
    controls.hidden = !open || !!mine || (!data && !fakeLogin());
    go.disabled = busy || picked === null;
    if (mine) note.textContent = `You bet ${kowens(mine.amount)} on ${mosangName(r.runners[mine.lane])}. If she wins you get ${kowens(mine.amount * (data?.payout ?? 4))}.`;
    else if (open) note.textContent = picked === null ? `Pick a Mosang, then bet 1–${data?.maxBet ?? 100} Kowens. She wins you ${data?.payout ?? 4}× your bet.` : `On ${mosangName(r.runners[picked])}. You have ${kowens(data?.kowens ?? 0)}.`;
    else note.textContent = '';
  };

  const card = (r: TownRace, id: string, lane: number, open: boolean) => {
    const b = el('button', 'rb-card');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(picked === lane));
    b.disabled = !open || !!data?.mine;
    const face = el('span', 'rb-face');
    face.style.backgroundImage = `url("${portraitUrl(id)}")`;
    face.style.width = face.style.height = `${PORTRAIT * PORTRAIT_PX}px`;
    face.style.backgroundSize = `${PORTRAIT * PORTRAIT_PX * 2}px ${PORTRAIT * PORTRAIT_PX}px`;
    const bets = r.bets[lane] ?? { count: 0, pot: 0 };
    const won = r.run && raceNow() >= r.run.endsAt && (lane === r.run.winner || lane === r.run.tie);
    if (won) b.classList.add('rb-won');
    if (data?.mine?.lane === lane) b.classList.add('rb-mine');
    b.append(face, el('span', 'rb-name', mosangName(id).replace('Aling ', '')), el('span', 'rb-bets', `${bets.count} ${bets.count === 1 ? 'bet' : 'bets'} · ${bets.pot}`));
    b.addEventListener('click', () => {
      picked = lane;
      render();
    });
    return b;
  };

  go.addEventListener('click', async () => {
    const r = data?.race;
    if (!r || picked === null || busy) return;
    busy = true;
    render();
    const res = await betOnRace(r.id, picked, bet.value());
    busy = false;
    if (res) data = res;
    playSound(res?.ok ? 'coin' : 'error');
    render();
    if (res?.message) note.textContent = res.message;
    if (res?.ok) window.dispatchEvent(new Event('mk-wallet')); // the HUD's Kowens
  });

  const closed = showPopup({ title: 'Mosang race', body: [body], button: 'Close', celebrate: false, closeX: true });
  // Live: bets coming in, the race going off and being won (the countdown ticks too).
  const off = onRace((r) => {
    if (data) data = { ...data, race: r };
    render();
  });
  const ticking = setInterval(render, 1000);
  void closed.then(() => {
    off();
    clearInterval(ticking);
  });
  followWallet(closed, () => void loadRace().then((d) => d && ((data = d), render())));
  void loadRace().then((d) => {
    data = d;
    if (!d) head.textContent = "Couldn't load the race. Try again?";
    render();
  });
}
