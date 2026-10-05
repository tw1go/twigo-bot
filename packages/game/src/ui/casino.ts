import type { TownCoinSide, TownGambleResponse } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { fakeLogin, loadMe } from '../session';
import { coinIcon } from './reward';

// 🎰 The casino screen: Kara y Krus on a full-screen felt table under the casino lights (the town scene zooms in to the
// casino's door and fades out first; see TownScene.enterCasino). The peso sits in the middle; pick a bet, press Kara or
// Krus, and the coin flips — the flip for the side it lands on (ui.coinFlip.sides), ticking as it spins and clinking
// as it lands — and rests on that face (the flip's last cell). A win plays the win sound, then the coin's ka-ching, and
// bursts coins over it (fx coin-burst); a loss is a line of text and a soft sound. A raid (the Tanod busts the round):
// his whistle, the Tanod rising big at the bottom centre with the siren looping over his head; he holds for 3 s while
// the screen flashes faint red and blue, then you're taken out of the casino (and the jail takes over).
// The bets are the bot's (POST /town/gamble: /gamble's odds at the gambling channel's low raid chance). Everything is
// pixel art at whole-number scales; text is HTML in Pixelify Sans. Your profile (with Settings), the chat and the system
// feed stay over the table. Leave (or Escape) hands back to the town.

/** A horizontal strip of same-size cells (a sprite sheet) in the page. */
export interface Strip {
  url: string;
  w: number;
  h: number;
  frames: number;
  fps: number;
}

export interface CasinoArt {
  /** The flip for each side the coin can land on; each ends on that face, which is the coin at rest. */
  flips?: Record<TownCoinSide, Strip>;
  tanod?: Strip;
  siren?: Strip;
  burst?: Strip;
  felt?: { url: string; slice: number };
}

let art: CasinoArt = {};
export function setCasinoArt(a: CasinoArt): void {
  art = a;
}

const CHIPS = [1, 5, 10, 25, 50];
const RAID_HOLD_MS = 3000; // after the Tanod's animation, the raid holds this long (flashing) before you're taken out
const SPIN_TICK_MS = 120; // the spin's tick repeats this often while the coin flips
const BULBS = 15; // the casino lights along the top edge
const side = (s: TownCoinSide) => (s === 'kara' ? 'Kara' : 'Krus');
const kowens = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'Kowen' : 'Kowens'}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function gamble(bet: number, call: TownCoinSide): Promise<TownGambleResponse | null> {
  if (fakeLogin()) return fakeGamble(bet, call);
  const res = await fetch('/town/gamble', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bet, call }),
  }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownGambleResponse) : null;
}

/** Shows one cell of a strip in `node` at `scale`×. */
function cell(node: HTMLElement, s: Strip, frame: number, scale: number): void {
  node.style.backgroundImage = `url("${s.url}")`;
  node.style.backgroundSize = `${s.w * s.frames * scale}px ${s.h * scale}px`;
  node.style.backgroundPosition = `${-frame * s.w * scale}px 0`;
  node.style.width = `${s.w * scale}px`;
  node.style.height = `${s.h * scale}px`;
}

/** Plays a strip once (holding its last cell) or looping until stopped. `done` resolves when a once-through ends. */
function play(node: HTMLElement, s: Strip, scale: number, loop: boolean): { stop: () => void; done: Promise<void> } {
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  cell(node, s, 0, scale);
  const done = new Promise<void>((resolve) => {
    timer = setInterval(() => {
      frame++;
      if (frame >= s.frames) {
        if (!loop) {
          clearInterval(timer);
          return resolve();
        }
        frame = 0;
      }
      cell(node, s, frame, scale);
    }, 1000 / s.fps);
  });
  return { stop: () => clearInterval(timer), done };
}

/** The table's whole-number scale: 3× where there's room, else 2× (phones). The coin, its flips and the coin burst
 *  are drawn bigger: 6× on the big table, 3× on phones (room for the chat under it). */
const tableScale = () => (window.innerWidth >= 900 && window.innerHeight >= 680 ? 3 : 2);
const coinScale = (table: number) => (table === 3 ? 6 : 3);

let open: { close: () => void } | null = null;

/** Opens the casino screen over the town; `leave` runs when the player leaves (the button or Escape). */
export function openCasino(leave: () => void): void {
  if (open) return;
  const root = el('div');
  root.id = 'casino-screen';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Kara y Krus');
  const table = el('div', 'cz-table');
  if (art.felt) {
    table.classList.add('cz-felt');
    table.style.setProperty('--felt', `url("${art.felt.url}")`);
    table.style.setProperty('--felt-slice', String(art.felt.slice));
  }

  const head = el('div', 'cz-head');
  const wallet = el('div', 'cz-wallet');
  const leaveButton = el('button', 'cz-leave', 'Leave');
  head.append(el('h1', 'cz-title', 'Kara y Krus'), wallet, leaveButton);

  // The coin on the table, with the win's coin burst over it; Kara and Krus either side (under it when narrow).
  const stage = el('div', 'cz-stage');
  const coin = el('div', 'cz-coin');
  const burst = el('div', 'cz-burst');
  stage.append(coin, burst);
  const kara = el('button', 'cz-call cz-kara', 'Kara');
  const krus = el('button', 'cz-call cz-krus', 'Krus');
  const row = el('div', 'cz-play');
  row.append(kara, stage, krus);

  const result = el('div', 'cz-result', 'Call it: Kara or Krus?');
  result.setAttribute('role', 'status');

  const bet = el('input', 'cz-bet');
  bet.type = 'number';
  bet.min = '1';
  bet.step = '1';
  bet.inputMode = 'numeric';
  bet.value = '5';
  bet.setAttribute('aria-label', 'Your bet in Kowens');
  const chips = el('div', 'cz-chips');
  for (const n of CHIPS) {
    const c = el('button', 'cz-chip', String(n));
    c.setAttribute('aria-label', `Bet ${n}`);
    c.addEventListener('click', () => {
      bet.value = String(n);
      playSound('chip');
    });
    chips.append(c);
  }
  const bets = el('div', 'cz-bets');
  const betLabel = el('label', 'cz-bet-label', 'Bet');
  betLabel.append(bet);
  bets.append(betLabel, chips);
  const rules = el('div', 'cz-rules', 'Win and your bet doubles (45%). Now and then (3%) the Tanod raids the table: the bet is taken and you spend 5 minutes in jail.');

  // The raid: the Tanod rising at the bottom centre of the screen with the siren over his head, and a red/blue flash.
  const raidBox = el('div', 'cz-raid');
  const siren = el('div', 'cz-siren');
  const tanod = el('div', 'cz-tanod');
  raidBox.append(siren, tanod);
  const flash = el('div', 'cz-flash');

  // The casino lights along the top edge: every other bulb lit, swapping.
  const lights = el('div', 'cz-lights');
  lights.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < BULBS; i++) lights.append(el('span', i % 2 ? 'cz-bulb cz-odd' : 'cz-bulb'));

  table.append(lights, head, row, result, bets, rules);
  root.append(table, flash, raidBox);
  document.body.append(root);

  let scale = tableScale();
  let lastFace: TownCoinSide = 'kara';
  const restFace = (s: TownCoinSide) => {
    const f = art.flips?.[s];
    if (f) cell(coin, f, f.frames - 1, coinScale(scale)); // each flip ends on its face
    else coin.textContent = side(s);
  };
  const resize = () => {
    scale = tableScale();
    root.style.setProperty('--s', String(scale));
    if (!coin.classList.contains('cz-flying')) restFace(lastFace);
  };
  resize();
  window.addEventListener('resize', resize);
  const showWallet = (n: number) => wallet.replaceChildren(coinIcon(2), el('b', undefined, n.toLocaleString()), el('span', undefined, n === 1 ? ' Kowen' : ' Kowens'));

  let busy = false;
  let jailed = false;
  const lock = () => (kara.disabled = krus.disabled = busy || jailed);
  const say = (text: string, tone: '' | 'good' | 'bad' | 'bust' = '') => {
    result.textContent = text;
    result.className = `cz-result${tone ? ` cz-${tone}` : ''}`;
  };

  const raid = async (message: string) => {
    const stopSiren = art.siren ? play(siren, art.siren, scale * 2, true).stop : () => {};
    root.classList.add('cz-raiding');
    playSound('busted');
    say(`Busted! ${message}`, 'bust');
    // He plays once and holds his last frame; then the screen flashes while he stays.
    if (art.tanod) await play(tanod, art.tanod, scale * 2, false).done;
    else tanod.textContent = 'Huli ka!';
    root.classList.add('cz-flashing');
    await wait(RAID_HOLD_MS);
    stopSiren();
    leave(); // off to jail: out of the casino, and the town's jail takes over
  };

  const call = async (choice: TownCoinSide) => {
    if (busy || jailed) return;
    const n = Number(bet.value);
    if (!Number.isInteger(n) || n < 1) return say('Pick a bet first.', 'bad');
    busy = true;
    lock();
    burst.classList.remove('cz-on');
    say(`${side(choice)}…`);
    const res = await gamble(n, choice);
    if (!res) {
      busy = false;
      lock();
      playSound('error');
      return say("Couldn't reach the table. Try again in a moment.", 'bad');
    }
    showWallet(res.kowens);
    if (!res.ok) {
      busy = false;
      lock();
      playSound('error');
      return say(res.message, 'bad');
    }
    if (res.outcome === 'bust') {
      jailed = true;
      await raid(res.message);
      busy = false;
      lock();
      window.dispatchEvent(new Event('mk-wallet'));
      return;
    }
    // The flip for the side it landed on (ticking while it spins), then that face at rest.
    const landed = res.landed ?? choice;
    const flip = art.flips?.[landed];
    if (flip) {
      coin.classList.add('cz-flying');
      playSound('flip-spin');
      const tick = setInterval(() => playSound('flip-spin'), SPIN_TICK_MS);
      await play(coin, flip, coinScale(scale), false).done;
      clearInterval(tick);
      coin.classList.remove('cz-flying');
    }
    playSound('flip-land');
    lastFace = landed;
    restFace(landed);
    if (res.outcome === 'win') {
      if (art.burst) {
        burst.classList.add('cz-on');
        void play(burst, art.burst, coinScale(scale), false).done.then(() => burst.classList.remove('cz-on'));
      }
      playSound('casino-win');
      setTimeout(() => playSound('coin'), 220); // ka-ching
      say(res.message, 'good');
    } else {
      playSound('casino-lose');
      say(res.message, 'bad');
    }
    busy = false;
    lock();
    window.dispatchEvent(new Event('mk-wallet')); // the HUD's Kowens
  };
  kara.addEventListener('click', () => void call('kara'));
  krus.addEventListener('click', () => void call('krus'));

  // Escape leaves (and no other Escape handler hears it) — unless it's for the chat or Settings, which stay over the
  // table; Enter in the bet stays there.
  const keys = (e: KeyboardEvent) => {
    const elsewhere = document.getElementById('settings') || (document.activeElement instanceof HTMLInputElement && document.activeElement !== bet);
    if (e.key === 'Escape' && !elsewhere) {
      e.preventDefault();
      e.stopPropagation();
      leave();
    } else if (e.key === 'Enter' && document.activeElement === bet) e.stopPropagation();
  };
  document.addEventListener('keydown', keys, true);
  leaveButton.addEventListener('click', () => leave());

  open = {
    close: () => {
      document.removeEventListener('keydown', keys, true);
      window.removeEventListener('resize', resize);
      root.remove();
      open = null;
    },
  };

  void loadMe(true).then((me) => {
    if (me.status !== 'ok') {
      jailed = true;
      lock();
      return say('Log in to play.', 'bad');
    }
    showWallet(me.me.kowens);
    if (me.me.status === 'jailed') {
      jailed = true;
      lock();
      say("You're in jail. No gambling till you're out.", 'bad');
    }
  });
  leaveButton.focus();
}

/** Removes the casino screen (the town has faded to navy over it first). */
export function closeCasino(): void {
  open?.close();
}

// ── Dev: a pretend table (no bot behind the dev server). &bust=1 / &win=1 / &lose=1 force the outcome. ──

const q = new URLSearchParams(location.search);
const fakeState = { kowens: Number(q.get('kowens') ?? 1250), jailed: false };

function fakeGamble(bet: number, call: TownCoinSide): TownGambleResponse {
  const odds = { winChance: 0.45, bustChance: 0.03 };
  if (fakeState.jailed) return { ok: false, message: "You're in jail. No gambling till you're out.", kowens: fakeState.kowens, ...odds };
  if (bet > fakeState.kowens) return { ok: false, message: `You only have ${kowens(fakeState.kowens)}.`, kowens: fakeState.kowens, ...odds };
  const r = Math.random();
  const outcome = q.has('bust') ? 'bust' : q.has('win') ? 'win' : q.has('lose') ? 'lose' : r < 0.03 ? 'bust' : r < 0.48 ? 'win' : 'lose';
  if (outcome === 'bust') {
    fakeState.kowens -= bet;
    fakeState.jailed = true;
    return { ok: true, outcome, bet, message: `The Tanod raided the table: ${kowens(bet)} confiscated and 5 minutes in jail.`, kowens: fakeState.kowens, ...odds };
  }
  const landed: TownCoinSide = outcome === 'win' ? call : call === 'kara' ? 'krus' : 'kara';
  fakeState.kowens += outcome === 'win' ? bet : -bet;
  return { ok: true, outcome, landed, bet, message: outcome === 'win' ? `${side(call)}! You won ${kowens(bet)}.` : `${side(landed)}. You lost ${kowens(bet)}.`, kowens: fakeState.kowens, ...odds };
}
