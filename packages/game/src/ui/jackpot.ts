import type { TownJackpotBuyResponse, TownJackpotResponse } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { fakeLogin, fakeName } from '../session';
import { coinIcon, el, showPopup } from './reward';

// 🎰 The jackpot booth (left click the booth): the next draw's pot with a countdown, your tickets (1 Kowen each, up
// to the max) with buttons to buy more, your chance, who's in, and the last draw — in the reward box with its casino
// lights. Buying goes through the bot (POST /town/jackpot), which also tells the town's feed and the games channel.

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const kowens = (n: number) => plural(n, 'Kowen', 'Kowens');

/** "2h 05m", "4m 09s", "now". */
function countdown(ms: number): string {
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}h ${pad(m)}m` : `${m}m ${pad(s % 60)}s`;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

async function load(): Promise<TownJackpotResponse | null> {
  if (fakeLogin()) return { ...fake };
  const res = await fetch('/town/jackpot', { credentials: 'same-origin' }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownJackpotResponse) : null;
}

async function buy(tickets: number): Promise<TownJackpotBuyResponse | null> {
  if (fakeLogin()) return fakeBuy(tickets);
  const res = await fetch('/town/jackpot', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickets }),
  }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownJackpotBuyResponse) : null;
}

export function showJackpot(): void {
  const pot = el('div', 'jp-pot');
  const draw = el('div', 'jp-draw', 'Loading…');
  const slots = el('div', 'jp-tickets');
  const chance = el('div', 'jp-chance');
  const buttons = el('div', 'jp-buy');
  const note = el('div', 'jp-note');
  note.setAttribute('role', 'status');
  const list = el('div', 'jp-players');
  const last = el('div', 'jp-last');
  const rules = el('div', 'jp-rules');

  let state: TownJackpotResponse | null = null;
  let busy = false;

  const render = (j: TownJackpotResponse) => {
    state = j;
    pot.replaceChildren(coinIcon(3), el('span', 'jp-amount', kowens(j.pot)), el('span', 'jp-in', 'in the pot'));
    rules.textContent = `1 Kowen a ticket · up to ${j.max} each per draw · needs ${j.minPlayers} players or it's refunded`;

    slots.replaceChildren();
    for (let i = 0; i < j.max; i++) slots.append(el('span', i < j.mine ? 'jp-ticket jp-owned' : 'jp-ticket'));
    slots.setAttribute('aria-label', `You have ${plural(j.mine, 'ticket', 'tickets')} of ${j.max}`);
    chance.textContent = j.mine
      ? `Your chance: ${Math.round((j.mine / j.pot) * 100)}% (${j.mine} of ${j.pot} tickets)`
      : "You're not in this draw yet.";

    const room = j.max - j.mine;
    const counts = room > 1 ? [1, room] : room === 1 ? [1] : [];
    buttons.replaceChildren(
      ...counts.map((n) => {
        const b = el('button', 'jp-button', n === 1 ? 'Buy 1 ticket' : `Buy ${n} tickets`);
        b.append(el('small', undefined, kowens(n)));
        b.disabled = busy || !!j.jailedUntil || j.kowens < n;
        b.addEventListener('click', () => void purchase(n));
        return b;
      }),
    );
    if (!counts.length) buttons.append(el('div', 'jp-full', `You have the most tickets (${j.max}).`));
    else if (j.jailedUntil) note.textContent = `You're in jail until ${clock(j.jailedUntil)}: no tickets till then.`;
    else if (j.kowens < 1) note.textContent = 'You have no Kowens in your wallet.';

    list.replaceChildren(el('div', 'jp-heading', `In this draw (${j.players.length})`));
    if (!j.players.length) list.append(el('div', 'jp-empty', 'Nobody yet. Be the first!'));
    for (const p of j.players) {
      const row = el('div', `jp-row${p.me ? ' jp-me' : ''}`);
      row.append(
        el('span', 'jp-name', p.me ? `${p.name} (you)` : p.name),
        el('span', 'jp-count', `${plural(p.tickets, 'ticket', 'tickets')} · ${Math.round((p.tickets / j.pot) * 100)}%`),
      );
      list.append(row);
    }

    const l = j.last;
    last.textContent = !l
      ? ''
      : l.winner
        ? `Last draw: ${l.me ? 'you' : l.winner} won ${kowens(l.pot)} from ${l.players} players`
        : 'Last draw: only 1 player joined, so it was refunded';
    tick();
  };

  const tick = () => {
    if (!state) return;
    const left = state.nextDraw - Date.now();
    draw.textContent = left > 0 ? `Draw at ${clock(state.nextDraw)} · in ${countdown(left)}` : 'Drawing now… check back in a moment';
  };

  const purchase = async (n: number) => {
    if (busy) return;
    busy = true;
    note.textContent = '';
    if (state) render(state); // disables the buttons
    const result = await buy(n);
    busy = false;
    if (!result) {
      playSound('error');
      note.textContent = "Couldn't buy tickets. Try again in a moment.";
      if (state) render(state);
      return;
    }
    render(result);
    if ('bought' in result) {
      playSound('chip');
      window.dispatchEvent(new Event('mk-wallet')); // the HUD's Kowens
      note.textContent = `You bought ${plural(result.bought, 'ticket', 'tickets')}. Good luck!`;
    } else {
      playSound('error');
      note.textContent =
        result.refused === 'max' ? `You already have the most tickets (${result.max}).`
        : result.refused === 'jailed' ? "You're in jail: no tickets till you're out."
        : `Not enough Kowens in your wallet (you have ${kowens(result.kowens)}).`;
    }
  };

  const body = [pot, draw, slots, chance, buttons, note, list, last, rules];
  const wrap = el('div', 'jp-body');
  wrap.append(...body);
  void showPopup({ title: 'Jackpot', body: [wrap], button: 'Close', celebrate: false, lights: true, sound: 'card' });

  // The countdown ticks; when the draw comes the booth reloads (the pot starts over).
  let drawn = false;
  const timer = setInterval(() => {
    if (!wrap.isConnected) return clearInterval(timer);
    tick();
    if (state && !drawn && Date.now() > state.nextDraw + 15_000) {
      drawn = true;
      void load().then((j) => {
        drawn = false;
        if (j && wrap.isConnected) render(j);
      });
    }
  }, 1000);

  void load().then((j) => {
    if (j) render(j);
    else draw.textContent = "Couldn't load the jackpot. Try again in a moment.";
  });
}

// ── Dev: a pretend booth (no bot behind the dev server) ──

const fake: TownJackpotResponse = {
  pot: 9,
  max: 5,
  minPlayers: 2,
  nextDraw: Date.now() + 2 * 3600_000 + 5 * 60_000,
  players: [
    { name: 'Kuya Ben', tickets: 5 },
    { name: 'Fae', tickets: 3 },
    { name: 'junwuu', tickets: 1 },
  ],
  mine: 0,
  kowens: Number(new URLSearchParams(location.search).get('kowens') ?? 1250),
  jailedUntil: null,
  last: { at: Date.now() - 10 * 3600_000, winner: 'Fae', pot: 14, players: 4 },
};

function fakeBuy(tickets: number): TownJackpotBuyResponse {
  const room = fake.max - fake.mine;
  if (room <= 0) return { ...fake, refused: 'max' };
  const n = Math.min(tickets, room);
  if (fake.kowens < n) return { ...fake, refused: 'kowens' };
  fake.kowens -= n;
  fake.mine += n;
  fake.pot += n;
  const me = fake.players.find((p) => p.me);
  if (me) me.tickets += n;
  else fake.players.push({ name: fakeName(), tickets: n, me: true });
  fake.players.sort((a, b) => b.tickets - a.tickets);
  return { ...fake, players: fake.players.map((p) => ({ ...p })), bought: n };
}
