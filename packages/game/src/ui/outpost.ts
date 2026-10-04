import type { TownBailResponse, TownOutpostResponse } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { fakeLogin, fakeName } from '../session';
import { el, showPopup } from './reward';

// 🚔 The Tanod outpost (left click the outpost), in the reward box with two tabs. Jail: whether you're in, who else
// is, until when and why, and bail (yours or a friend's: /bail's price and rules, POST /town/bail). Patrol: how Tanod
// Patrol works, and whether the Tanod is calling roll in Discord right now.

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const kowens = (n: number) => plural(n, 'Kowen', 'Kowens');
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const hour = (h: number) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;

/** "in 12m", "in 1h 05m". */
function inTime(ms: number): string {
  const m = Math.max(1, Math.ceil((ms - Date.now()) / 60_000));
  return m < 60 ? `in ${m}m` : `in ${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

type Tab = 'jail' | 'patrol';
const TABS: [Tab, string][] = [['jail', 'Jail'], ['patrol', 'Patrol']];

async function load(): Promise<TownOutpostResponse | null> {
  if (fakeLogin()) return structuredClone(fake);
  const res = await fetch('/town/outpost', { credentials: 'same-origin' }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownOutpostResponse) : null;
}

async function bail(id: string): Promise<TownBailResponse | null> {
  if (fakeLogin()) return fakeBail(id);
  const res = await fetch('/town/bail', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownBailResponse) : null;
}

export function showOutpost(): void {
  const bar = el('div', 'bk-tabs');
  bar.setAttribute('role', 'tablist');
  const panel = el('div', 'op-panel');
  panel.setAttribute('role', 'tabpanel');
  const note = el('div', 'bk-note op-note', 'Loading…');
  note.setAttribute('role', 'status');
  const wrap = el('div', 'op-body');
  wrap.append(bar, panel, note);

  let data: TownOutpostResponse | null = null;
  let tab: Tab = 'jail';
  let busy = false;

  const tabs = new Map<Tab, HTMLButtonElement>();
  for (const [t, label] of TABS) {
    const b = el('button', 'bk-tab', label);
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => {
      tab = t;
      note.textContent = '';
      render();
    });
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      tab = tab === 'jail' ? 'patrol' : 'jail';
      render();
      tabs.get(tab)!.focus();
    });
    tabs.set(t, b);
    bar.append(b);
  }

  const bailButton = (id: string, cost: number, label: string) => {
    const b = el('button', 'op-bail', `${label} · ${kowens(cost)}`);
    b.disabled = busy || !data || data.wallet < cost;
    if (data && data.wallet < cost) b.title = `You have ${kowens(data.wallet)}`;
    b.addEventListener('click', () => void pay(id));
    return b;
  };

  const render = () => {
    for (const [t, b] of tabs) {
      b.setAttribute('aria-selected', String(t === tab));
      b.tabIndex = t === tab ? 0 : -1;
    }
    const d = data;
    if (!d) return;
    if (tab === 'patrol') {
      const p = d.patrol;
      panel.replaceChildren(
        ...(p.active ? [el('div', 'op-alert', 'The Tanod is calling roll in Discord right now! Answer in the games channel.')] : []),
        el('p', 'op-text', `At random times between ${hour(p.fromHour)} and ${hour(p.untilHour)} (every ${p.minGapHours}–${p.maxGapHours} hours), the Tanod calls roll in Discord. You have ${p.windowSeconds} seconds to answer.`),
        el('p', 'op-text', `The first three to answer get ${p.rewards.join(' · ')} Kowens.`),
        el('p', 'op-text', `If ${p.rewards.length + 1} or more answer, the slowest spends ${plural(p.slowpokeMinutes, 'minute', 'minutes')} in jail.`),
        el('p', 'op-text op-dim', "Nobody can answer from jail. If nobody answers at all, the Tanod decides the town was asleep."),
      );
      return;
    }

    const mine = d.jailed.find((j) => j.me);
    const you = el('div', `op-you${mine ? ' op-in' : ''}`);
    if (mine) {
      const line = el('div', 'op-you-line');
      line.append(el('b', undefined, "You're in jail"), ` until ${clock(mine.until)} (${inTime(mine.until)})`);
      you.append(line, el('div', 'op-reason', mine.reason));
      if (mine.bail !== null) you.append(bailButton(mine.id, mine.bail, 'Pay bail'));
      else you.append(el('div', 'op-dim', 'An admin sentence: no bail, it has to be served in full.'));
    } else you.append(el('b', undefined, "You're free."), ' Behave out there.');

    const others = d.jailed.filter((j) => !j.me);
    const list = el('div', 'op-list');
    list.append(el('div', 'op-heading', `In jail (${others.length})`));
    if (!others.length) list.append(el('div', 'op-dim', 'Nobody else. The town is behaving.'));
    for (const j of others) {
      const row = el('div', 'op-row');
      const who = el('div', 'op-who');
      who.append(el('div', 'op-name', j.name), el('div', 'op-reason', `${j.reason} · out ${inTime(j.until)}`));
      row.append(who, j.bail !== null ? bailButton(j.id, j.bail, 'Bail') : el('span', 'op-dim op-nobail', 'No bail'));
      list.append(row);
    }
    panel.replaceChildren(
      you,
      list,
      el('p', 'op-dim op-rules', `Bail is ${Math.round(d.bail.percent * 100)}% of the jailed member's Kowens (${d.bail.min}–${d.bail.max}), paid by whoever bails them out.`),
    );
  };

  const pay = async (id: string) => {
    if (busy) return;
    busy = true;
    render();
    const res = await bail(id);
    busy = false;
    if (!res) {
      playSound('error');
      note.textContent = "Couldn't reach the outpost. Try again in a moment.";
      note.classList.add('bk-refused');
      return render();
    }
    data = res;
    render();
    note.textContent = res.message;
    note.classList.toggle('bk-refused', !res.ok);
    playSound(res.ok ? 'coin' : 'error');
    if (res.ok) window.dispatchEvent(new Event('mk-wallet')); // the HUD's Kowens
  };

  void showPopup({ title: 'Tanod outpost', body: [wrap], button: 'Close', celebrate: false, sound: 'door' });
  void load().then((d) => {
    if (!d) return void (note.textContent = "Couldn't load the outpost. Try again in a moment.");
    data = d;
    note.textContent = '';
    render();
  });
}

// ── Dev: a pretend outpost (no bot behind the dev server). &status=jailed puts you in it. ──

const jailedMe = new URLSearchParams(location.search).get('status') === 'jailed';
const fake: TownOutpostResponse = {
  jailed: [
    ...(jailedMe ? [{ id: 'me', name: fakeName(), until: Date.now() + 12 * 60_000, reason: 'Caught gambling by the Tanod', bail: 5, me: true }] : []),
    { id: 'fae', name: 'Fae', until: Date.now() + 25 * 60_000, reason: 'Caught gambling by the Tanod', bail: 7 },
    { id: 'kuya', name: 'Kuya Ben', until: Date.now() + 70 * 60_000, reason: 'Sentenced by an admin', bail: null },
  ],
  wallet: Number(new URLSearchParams(location.search).get('kowens') ?? 1250),
  bail: { percent: 0.05, min: 3, max: 100 },
  patrol: { active: false, rewards: [3, 2, 1], windowSeconds: 60, slowpokeMinutes: 2, fromHour: 10, untilHour: 22, minGapHours: 3, maxGapHours: 6 },
};

function fakeBail(id: string): TownBailResponse {
  const j = fake.jailed.find((x) => x.id === id);
  if (!j || j.bail === null) return { ...structuredClone(fake), ok: false, message: "They're already out." };
  fake.wallet -= j.bail;
  fake.jailed = fake.jailed.filter((x) => x !== j);
  return { ...structuredClone(fake), ok: true, message: j.me ? `You paid ${kowens(j.bail)} bail. Freedom!` : `You bailed out ${j.name} for ${kowens(j.bail)}.` };
}
