import type { PresenceStatus, TownGiveResponse, TownPlayer, TownPlayerInfo, TownVerdictMode } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { inParty, invite, mayInvite, onParty } from '../net/party';
import { fakeLogin } from '../session';
import { coinIcon } from './reward';

// 👤 The picked player (left click someone in town): their name in a long box at the top of the screen. Clicking the
// box opens a menu — Give Kowens, Balance, Status — each read from the bot by the player's town id (GET /town/player;
// giving: POST /town/give, /give's rules), and Diss / Praise / Judge (POST /town/verdict, 1 Kowen like the commands:
// you say the line in town). The box goes when they leave, on Escape, or with a click anywhere outside it (a drag to
// peek doesn't count; clicking someone else picks them instead). Clicking a name in the chat opens the same box and
// menu right beside that name instead (selectAt); a press anywhere else closes it. Under it, Invite to party (net/party.ts:
// shown while you lead a party or are in none, and they're not in yours) and Trade (ui/trade.ts: only within 5 tiles,
// "Too far to trade" otherwise; the server checks again by its own positions). DOM text only.

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
  private readonly partyRow = el('div', 'tg-party');
  private readonly partyButton = el('button', 'tg-party-invite', 'Invite to party');
  private readonly tradeRow = el('div', 'tg-trade');
  private readonly tradeButton = el('button', 'tg-trade-ask', 'Trade');
  /** Trading (the town sets it): how far someone is (tiles; null: not here), the range, whether you're trading already,
   *  and the ask. */
  trade: { distance(id: string): number | null; range: number; busy(): boolean; ask(p: TownPlayer): void } | null = null;
  private target: TownPlayer | null = null;
  private view: View | null = null;
  private info: TownPlayerInfo | null = null;
  private busy = false;
  /** Opened from a name in the chat: placed beside it. */
  private beside: HTMLElement | null = null;

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
    this.box.addEventListener('click', () => (this.beside ? this.clear() : this.toggleMenu()));

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
    // Invite to party (you lead one, or you're in none): hidden for someone already in yours.
    this.partyButton.addEventListener('click', () => {
      if (!this.target) return;
      playSound('click');
      if (invite(this.target.id)) {
        this.partyButton.disabled = true;
        this.partyButton.textContent = 'Invite sent';
      }
    });
    this.partyRow.append(this.partyButton);
    onParty(() => this.drawParty());
    // Trade: within range only (kept up to date while the menu is open: either of you may walk).
    this.tradeButton.addEventListener('click', () => {
      if (!this.target || !this.trade || this.tradeButton.disabled) return;
      this.trade.ask(this.target);
      this.tradeButton.disabled = true;
      this.tradeButton.textContent = 'Request sent';
      this.tradeSent = this.target.id;
    });
    this.tradeRow.append(this.tradeButton);
    this.tradeRow.hidden = true;
    setInterval(() => !this.menu.hidden && this.drawTrade(), 400);
    // A trade opened or ended: the button is ready again.
    addEventListener('mk-trade', () => {
      this.tradeSent = null;
      if (!this.menu.hidden) this.drawTrade();
    });
    this.menu.hidden = true;
    this.menu.append(this.views, this.panel, this.actions, this.partyRow, this.tradeRow);
    this.root.append(this.box, this.menu);
    document.body.append(this.root);

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || this.root.hidden) return;
      if (!this.menu.hidden && !this.beside) this.closeMenu();
      else this.clear();
    });
    // Beside a chat name, a press anywhere else closes it (another name moves it instead). At the top, a click outside
    // it does (a press and release in about the same place: a drag to peek around the map keeps it); clicking someone
    // in town picks them right after.
    let down: { x: number; y: number; outside: boolean } | null = null;
    const outside = (t: Element) => !this.root.hidden && !this.root.contains(t) && !t.closest?.('.ch-click');
    document.addEventListener(
      'pointerdown',
      (e) => {
        const t = e.target as Element;
        if (this.beside && outside(t)) return this.clear();
        down = { x: e.clientX, y: e.clientY, outside: outside(t) };
      },
      true,
    );
    document.addEventListener(
      'pointerup',
      (e) => {
        if (down?.outside && !this.beside && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8) this.clear();
        down = null;
      },
      true,
    );
    // Your Kowens changed (in town or in Discord): an open menu reloads its numbers (what you can give), unless you're
    // typing an amount or a gift is on its way.
    window.addEventListener('mk-wallet', () => {
      if (this.menu.hidden || !this.target || this.busy || this.panel.contains(document.activeElement)) return;
      this.show(this.view ?? 'give');
    });
    // The menu's size changes as its numbers load: keep it beside the name.
    new ResizeObserver(() => this.place()).observe(this.root);
  }

  /** Someone picked from their name in the chat: the box with the menu open, right beside that name. */
  selectAt(p: TownPlayer, anchor: HTMLElement): void {
    this.select(p);
    this.beside = anchor;
    this.root.classList.add('tg-beside');
    if (this.menu.hidden) this.toggleMenu();
    this.place();
  }

  /** Beside the chat name: to its right (kept on screen), the bottom level with the name, growing upwards. */
  private place(): void {
    const a = this.beside;
    if (!a || this.root.hidden) return;
    if (!a.isConnected) return this.clear(); // the line scrolled out of the log
    const r = a.getBoundingClientRect();
    const w = this.root.offsetWidth;
    const h = this.root.offsetHeight;
    const left = Math.max(8, Math.min(r.right + 8, innerWidth - w - 8));
    const top = Math.max(8, Math.min(r.bottom - h, innerHeight - h - 8));
    this.root.style.left = `${left}px`;
    this.root.style.top = `${top}px`;
  }

  /** Who the last trade request went to (the button says so until they're picked again). */
  private tradeSent: string | null = null;

  /** The Trade button for whoever's picked: within range, else "Too far to trade" (greyed). */
  private drawTrade(): void {
    const p = this.target;
    const t = this.trade;
    this.tradeRow.hidden = !p || !t;
    if (!p || !t || this.tradeSent === p.id) return;
    const d = t.distance(p.id);
    const why = t.busy() ? 'Already trading' : d === null || d > t.range ? 'Too far to trade' : null;
    this.tradeButton.disabled = !!why;
    this.tradeButton.textContent = why ?? 'Trade';
    this.tradeButton.title = why === 'Too far to trade' ? `Walk within ${t.range} tiles of them` : '';
  }

  /** Shows someone in the box (the menu stays closed until the box is clicked). */
  /** The box's name and, if known, their level ("Mara  Lv 12"). */
  private drawName(): void {
    const p = this.target;
    if (!p) return;
    this.name.replaceChildren(p.nickname);
    if (p.level) this.name.append(el('span', 'tg-lv', `Lv ${p.level}`));
  }

  /** Someone went up a level: their box shows it if they're the one picked. */
  levelChanged(id: string, level: number): void {
    if (this.target?.id !== id) return;
    this.target.level = level;
    this.drawName();
  }

  /** Who's selected (their town id), if anyone. */
  get selectedId(): string | null {
    return this.target?.id ?? null;
  }

  select(p: TownPlayer): void {
    this.unplace();
    if (this.target?.id === p.id) return void (this.root.hidden = false);
    this.target = p;
    this.info = null;
    this.tradeSent = null;
    this.drawName();
    this.box.setAttribute('aria-label', `${p.nickname}: open the menu`);
    this.drawParty(true);
    this.root.hidden = false;
    this.closeMenu();
  }

  /** The invite button for whoever's picked (`fresh`: someone new, so "Invite sent" goes back to the button). */
  private drawParty(fresh = false): void {
    const p = this.target;
    const show = !!p && !inParty(p.id) && mayInvite();
    this.partyRow.hidden = !show;
    if (fresh || !show) {
      this.partyButton.disabled = false;
      this.partyButton.textContent = 'Invite to party';
    }
  }

  clear(): void {
    this.unplace();
    this.target = null;
    this.info = null;
    this.root.hidden = true;
    this.closeMenu();
  }

  /** Back to the top of the screen. */
  private unplace(): void {
    if (!this.beside) return;
    this.beside = null;
    this.root.classList.remove('tg-beside');
    this.root.style.left = this.root.style.top = '';
  }

  /** Drops them if they left (call when the town's players change). */
  check(here: (id: string) => boolean): void {
    if (this.target && !here(this.target.id)) this.clear();
  }

  private toggleMenu(): void {
    if (this.menu.hidden) {
      this.menu.hidden = false;
      this.box.setAttribute('aria-expanded', 'true');
      this.tradeSent = null;
      this.drawTrade();
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
