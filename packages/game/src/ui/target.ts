import type { PresenceStatus, TownGiveResponse, TownPlayer, TownPlayerInfo, TownVerdictMode } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { fakeLogin } from '../session';
import { coinIcon } from './reward';

// 👤 The picked player (left click someone in town): their name in a long box at the top of the screen. Clicking the
// box opens a menu — Give Kowens, Balance, Status — each read from the bot by the player's town id (GET /town/player;
// giving: POST /town/give, /give's rules), and Diss / Praise / Judge (POST /town/verdict, 1 Kowen like the commands:
// you say the line in town). The box goes when they leave, on Escape or with its ×. DOM text only.

type View = 'give' | 'balance' | 'status';
const VIEWS: [View, string][] = [['give', 'Give Kowens'], ['balance', 'Balance'], ['status', 'Status']];
const VERDICTS: [TownVerdictMode, string, string][] = [
  ['diss', 'Diss', 'Roast them'],
  ['praise', 'Praise', 'Hype them up'],
  ['judge', 'Judge', 'Let the Tanod decide: roast or praise'],
];

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const kowens = (n: number) => plural(n, 'Kowen', 'Kowens');
const STATUS: Record<PresenceStatus, string> = { online: 'Online', idle: 'Idle', busy: 'Do not disturb', offline: 'Offline', jailed: 'Jailed' };
const when = (ms: number) => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function load(player: TownPlayer): Promise<TownPlayerInfo | null> {
  if (fakeLogin()) return fakeInfo(player);
  const res = await fetch(`/town/player?id=${encodeURIComponent(player.id)}`, { credentials: 'same-origin' }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownPlayerInfo) : null;
}

async function post(path: string, body: object): Promise<TownGiveResponse | null> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (res?.status === 404) return { ok: false, message: 'They left the town.', player: null };
  return res?.ok ? ((await res.json()) as TownGiveResponse) : null;
}

export class TargetBox {
  private readonly root = el('div');
  private readonly box = el('button', 'tg-box');
  private readonly name = el('span', 'tg-name');
  private readonly menu = el('div', 'tg-menu');
  private readonly views = el('div', 'tg-views');
  private readonly panel = el('div', 'tg-panel');
  private readonly actions = el('div', 'tg-actions');
  private target: TownPlayer | null = null;
  private view: View | null = null;
  private info: TownPlayerInfo | null = null;
  private busy = false;

  /** `frame`: the item frame (nine-slice) the box is drawn in, like the profile. `devVerdict` plays a verdict in
   *  the dev town (no bot to broadcast it). */
  constructor(
    frame: { url: string; slice: number } | null,
    private readonly devVerdict: (kind: 'roast' | 'praise', judged: boolean, text: string) => void = () => {},
  ) {
    this.root.id = 'target';
    this.root.hidden = true;
    if (frame) {
      this.box.classList.add('tg-framed');
      this.box.style.setProperty('--frame', `url("${frame.url}")`);
      this.box.style.setProperty('--slice', String(frame.slice));
    }
    this.box.setAttribute('aria-haspopup', 'menu');
    this.box.setAttribute('aria-expanded', 'false');
    this.box.append(this.name, el('span', 'tg-caret', '▾'));
    this.box.addEventListener('click', () => this.toggleMenu());
    const close = el('button', 'tg-close', '×');
    close.setAttribute('aria-label', 'Stop looking at them');
    close.addEventListener('click', () => this.clear());

    for (const [v, label] of VIEWS) {
      const b = el('button', 'tg-view', label);
      b.dataset.view = v;
      b.addEventListener('click', () => this.show(v));
      this.views.append(b);
    }
    for (const [mode, label, hint] of VERDICTS) {
      const b = el('button', `tg-action tg-${mode}`, label);
      b.title = `${hint} (1 Kowen)`;
      b.addEventListener('click', () => void this.verdict(mode));
      this.actions.append(b);
    }
    this.menu.hidden = true;
    this.menu.append(this.views, this.panel, this.actions);
    this.root.append(this.box, close, this.menu);
    document.body.append(this.root);

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || this.root.hidden) return;
      if (!this.menu.hidden) this.closeMenu();
      else this.clear();
    });
  }

  /** Shows someone in the box (the menu stays closed until the box is clicked). */
  select(p: TownPlayer): void {
    if (this.target?.id === p.id) return void (this.root.hidden = false);
    this.target = p;
    this.info = null;
    this.name.textContent = p.nickname;
    this.box.setAttribute('aria-label', `${p.nickname}: open the menu`);
    this.root.hidden = false;
    this.closeMenu();
  }

  clear(): void {
    this.target = null;
    this.info = null;
    this.root.hidden = true;
    this.closeMenu();
  }

  /** Drops them if they left (call when the town's players change). */
  check(here: (id: string) => boolean): void {
    if (this.target && !here(this.target.id)) this.clear();
  }

  private toggleMenu(): void {
    if (this.menu.hidden) {
      this.menu.hidden = false;
      this.box.setAttribute('aria-expanded', 'true');
      this.show(this.view ?? 'give');
    } else this.closeMenu();
  }

  private closeMenu(): void {
    this.menu.hidden = true;
    this.box.setAttribute('aria-expanded', 'false');
  }

  /** One of the menu's views, with fresh numbers from the bot. */
  private show(v: View): void {
    this.view = v;
    for (const b of this.views.querySelectorAll<HTMLElement>('.tg-view')) b.setAttribute('aria-pressed', String(b.dataset.view === v));
    const p = this.target;
    if (!p) return;
    if (this.info) this.render();
    else this.panel.replaceChildren(el('div', 'tg-note', 'Loading…'));
    void load(p).then((info) => {
      if (this.target !== p) return; // picked someone else meanwhile
      if (!info) return void this.panel.replaceChildren(el('div', 'tg-note tg-bad', "Couldn't load them. They may have left."));
      this.info = info;
      this.render();
    });
  }

  private render(message?: { text: string; ok: boolean }): void {
    const i = this.info;
    if (!i) return;
    const row = (label: string, value: string | HTMLElement, cls = '') => {
      const line = el('div', `tg-row${cls ? ` ${cls}` : ''}`);
      line.append(el('span', 'tg-label', label), typeof value === 'string' ? el('span', 'tg-value', value) : value);
      return line;
    };
    const title = el('div', 'tg-title', `<${i.title.name}>`);
    if (i.title.color === 'prismatic') title.classList.add('prismatic');
    else title.style.color = i.title.color;
    const out: HTMLElement[] = [title];

    if (this.view === 'balance') {
      const wallet = el('span', 'tg-value tg-kowens');
      wallet.append(coinIcon(1), kowens(i.wallet));
      out.push(row('Wallet', wallet), row('Vault', i.vault === null ? 'None' : kowens(i.vault)), row('Rank', i.rank ? `#${i.rank}` : 'No Kowens yet'));
    } else if (this.view === 'status') {
      out.push(
        row('Discord', STATUS[i.status]),
        row('Bakod', i.bakodUntil ? `Up until ${when(i.bakodUntil)}` : 'None: open to /steal'),
        row('Jail', i.jailedUntil ? `Until ${when(i.jailedUntil)}` : 'Free', i.jailedUntil ? 'tg-warn' : ''),
        row('Loan', i.loan ? `Owes ${kowens(i.loan)}` : 'None'),
        row('Jackpot', plural(i.jackpotTickets, 'ticket', 'tickets')),
        row('Activity', i.inactiveDays ? `Inactive ${i.inactiveDays} days` : 'Active', i.inactiveDays ? 'tg-warn' : ''),
      );
    } else {
      const g = i.give;
      const max = Math.min(g.left, g.wallet);
      const amount = el('input', 'tg-amount');
      amount.type = 'number';
      amount.min = '1';
      amount.max = String(Math.max(1, max));
      amount.step = '1';
      amount.inputMode = 'numeric';
      amount.placeholder = 'Kowens';
      amount.setAttribute('aria-label', 'Kowens to give');
      const send = el('button', 'tg-give', 'Give');
      const blocked = g.inDebt ? "You can't give while you have a loan." : g.left <= 0 ? "You've given all you can today. It resets at midnight." : g.wallet <= 0 ? 'You have no Kowens in your wallet.' : null;
      amount.disabled = send.disabled = !!blocked || this.busy;
      const go = () => {
        const n = Number(amount.value);
        if (!Number.isInteger(n) || n < 1) return this.render({ text: 'Type how many Kowens to give.', ok: false });
        void this.give(n);
      };
      send.addEventListener('click', go);
      amount.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        go();
      });
      const line = el('div', 'tg-give-row');
      line.append(amount, send);
      out.push(line, el('div', 'tg-note', blocked ?? `You can give ${kowens(g.left)} more today (up to ${g.limit}).`));
    }
    if (message) out.push(el('div', `tg-note ${message.ok ? 'tg-good' : 'tg-bad'}`, message.text));
    this.panel.replaceChildren(...out);
  }

  private async verdict(mode: TownVerdictMode): Promise<void> {
    const p = this.target;
    if (!p || this.busy) return;
    this.busy = true;
    const res = fakeLogin() ? this.fakeVerdict(p, mode) : await post('/town/verdict', { to: p.id, mode });
    this.busy = false;
    this.done(p, res, "Couldn't send it. Try again in a moment.");
  }

  private async give(amount: number): Promise<void> {
    const p = this.target;
    if (!p || this.busy) return;
    this.busy = true;
    this.render();
    const res = fakeLogin() ? fakeGive(p, amount) : await post('/town/give', { to: p.id, amount });
    this.busy = false;
    this.done(p, res, "Couldn't give. Try again in a moment.");
  }

  /** After giving or a verdict: the new numbers and what happened. */
  private done(p: TownPlayer, res: TownGiveResponse | null, failed: string): void {
    if (this.target !== p) return;
    if (!res) {
      playSound('error');
      return this.render({ text: failed, ok: false });
    }
    if (res.player) this.info = res.player;
    playSound(res.ok ? 'coin' : 'error');
    if (res.ok) window.dispatchEvent(new Event('mk-wallet')); // the HUD's Kowens
    this.render({ text: res.message, ok: res.ok });
  }

  private fakeVerdict(p: TownPlayer, mode: TownVerdictMode): TownGiveResponse {
    const roast = mode === 'diss' || (mode === 'judge' && Math.random() < 0.5);
    const text = (roast ? '{u} plays like the tutorial is still on.' : '{u} carries the whole team and still says thanks.').replace('{u}', p.nickname);
    this.devVerdict(roast ? 'roast' : 'praise', mode === 'judge', text);
    return { ok: true, message: `${roast ? 'Roasted' : 'Praised'} ${p.nickname}! (1 Kowen)`, player: fakeInfo(p) };
  }
}

// ── Dev: made-up numbers for whoever is picked (no bot behind the dev server) ──

const fakeGiven = { today: 0 };
function fakeInfo(p: TownPlayer): TownPlayerInfo {
  const n = parseInt(p.id.slice(0, 6), 16) || 7;
  const wallet = Number(new URLSearchParams(location.search).get('kowens') ?? 1250);
  return {
    name: p.nickname,
    title: p.title,
    status: (['online', 'idle', 'busy'] as const)[n % 3],
    wallet: 40 + (n % 900) + fakeGiven.today,
    vault: n % 2 ? 120 : null,
    rank: 1 + (n % 30),
    bakodUntil: n % 3 === 0 ? Date.now() + 20 * 3600_000 : null,
    jailedUntil: null,
    loan: n % 4 === 0 ? 22 : null,
    jackpotTickets: n % 6,
    inactiveDays: null,
    give: { left: 20 - fakeGiven.today, limit: 20, wallet: wallet - fakeGiven.today, inDebt: false },
  };
}

function fakeGive(p: TownPlayer, amount: number): TownGiveResponse {
  if (amount > 20 - fakeGiven.today) return { ok: false, message: `You can only give ${kowens(20 - fakeGiven.today)} more today (resets at midnight).`, player: fakeInfo(p) };
  fakeGiven.today += amount;
  return { ok: true, message: `You gave ${kowens(amount)} to ${p.nickname}.`, player: fakeInfo(p) };
}
