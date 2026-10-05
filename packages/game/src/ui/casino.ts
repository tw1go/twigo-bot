import type { TownCoinSide, TownGambleResponse } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { fakeLogin, loadMe } from '../session';
import { installPixelTiles } from './pixel-tiles';
import { coinIcon, el, showPopup } from './reward';

// 🎰 The Casino (left click the casino): Kara y Krus at a felt table under the casino lights. Pick a bet, call Kara or
// Krus, and the peso flips (POST /town/gamble: /gamble's odds with the gambling channel's low raid chance). It lands
// on a side and pays or takes the bet — or, now and then, the Tanod pops up mid-flip ("Huli ka!"), the table flashes red
// and blue, and you're off to jail. The coin, its faces and the Tanod come from the manifest (ui.coinFlip, coinFaces,
// tanodBust, casinoFelt); until that art exists they're drawn in code (ui/pixel-tiles.ts).

export interface CasinoArt {
  coinFlip?: { url: string; size: [number, number]; frames: number; fps: number };
  coinFaces?: { url: string; size: [number, number]; frames: string[] };
  tanodBust?: { url: string; size: [number, number]; frames: number; fps: number };
  felt?: { url: string; slice: number };
}

let art: CasinoArt = {};
export function setCasinoArt(a: CasinoArt): void {
  art = a;
}

const CHIPS = [1, 5, 10, 25, 50];
const FLIP_MS = 1100; // at least this long, so the flip reads even when the bot answers at once
const COIN_SCALE = 4; // the stand-in coin is 16 px: 64 px on screen
const side = (s: TownCoinSide) => (s === 'kara' ? 'Kara' : 'Krus');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/** The coin at rest showing a face: the coin-faces art, else the drawn stand-in. */
function face(node: HTMLElement, s: TownCoinSide): void {
  const f = art.coinFaces;
  const i = f ? f.frames.indexOf(s) : -1;
  if (f && i >= 0) {
    const scale = Math.max(1, Math.floor((16 * COIN_SCALE) / f.size[0]));
    node.style.backgroundImage = `url("${f.url}")`;
    node.style.backgroundSize = `${f.size[0] * f.frames.length * scale}px ${f.size[1] * scale}px`;
    node.style.backgroundPosition = `${-i * f.size[0] * scale}px 0`;
    node.style.width = `${f.size[0] * scale}px`;
    node.style.height = `${f.size[1] * scale}px`;
  } else {
    node.style.backgroundImage = `var(--px-coin-${s})`;
    node.style.backgroundSize = `${16 * COIN_SCALE}px ${16 * COIN_SCALE}px`;
    node.style.backgroundPosition = '0 0';
    node.style.width = node.style.height = `${16 * COIN_SCALE}px`;
  }
}

/** The coin flipping (until `stop` is called): the flip sheet, else the stand-in squashing between its faces. */
function flip(node: HTMLElement): () => void {
  const f = art.coinFlip;
  node.className = 'cs-coin cs-flying';
  if (!f) {
    // The stand-in squashes flat and back (CSS) and shows the other face at each half turn.
    node.classList.add('cs-spin');
    face(node, 'kara');
    let n = 0;
    const t = setInterval(() => face(node, ++n % 2 ? 'krus' : 'kara'), 140);
    return () => clearInterval(t);
  }
  const scale = Math.max(1, Math.floor((16 * COIN_SCALE) / f.size[0]));
  node.style.backgroundImage = `url("${f.url}")`;
  node.style.backgroundSize = `${f.size[0] * f.frames * scale}px ${f.size[1] * scale}px`;
  node.style.width = `${f.size[0] * scale}px`;
  node.style.height = `${f.size[1] * scale}px`;
  let n = 0;
  const t = setInterval(() => {
    node.style.backgroundPosition = `${-(n % f.frames) * f.size[0] * scale}px 0`;
    n++;
  }, 1000 / f.fps);
  return () => clearInterval(t);
}

/** "Huli ka!": the Tanod pops up over the table (the bust art, else a drawn stand-in) while the table flashes. */
function tanod(stage: HTMLElement): void {
  const pop = el('div', 'cs-tanod');
  const t = art.tanodBust;
  if (t) {
    const scale = 3;
    const pic = el('div', 'cs-tanod-art');
    pic.style.backgroundImage = `url("${t.url}")`;
    pic.style.backgroundSize = `${t.size[0] * t.frames * scale}px ${t.size[1] * scale}px`;
    pic.style.width = `${t.size[0] * scale}px`;
    pic.style.height = `${t.size[1] * scale}px`;
    let n = 0;
    const timer = setInterval(() => {
      pic.style.backgroundPosition = `${-Math.min(n, t.frames - 1) * t.size[0] * scale}px 0`;
      if (++n >= t.frames) clearInterval(timer); // hold the last frame
    }, 1000 / t.fps);
    pop.append(pic);
  }
  pop.append(el('div', 'cs-huli', 'Huli ka!'));
  stage.append(pop);
}

export function showCasino(): void {
  installPixelTiles();
  const stage = el('div', 'cs-stage');
  const coin = el('div', 'cs-coin');
  face(coin, 'kara');
  stage.append(coin);
  const result = el('div', 'cs-result', 'Call it: Kara or Krus?');
  result.setAttribute('role', 'status');

  const bet = el('input', 'cs-bet');
  bet.type = 'number';
  bet.min = '1';
  bet.step = '1';
  bet.inputMode = 'numeric';
  bet.value = '5';
  bet.setAttribute('aria-label', 'Your bet in Kowens');
  bet.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') e.stopPropagation(); // the pop-up closes on them otherwise
    if (e.key === 'Escape') bet.blur();
  });
  const chips = el('div', 'cs-chips');
  for (const n of CHIPS) {
    const c = el('button', 'cs-chip', String(n));
    c.setAttribute('aria-label', `Bet ${n}`);
    c.addEventListener('click', () => (bet.value = String(n)));
    chips.append(c);
  }
  const betRow = el('div', 'cs-bet-row');
  const betLabel = el('label', 'cs-bet-label', 'Bet');
  betLabel.append(bet);
  betRow.append(betLabel, chips);

  const calls = el('div', 'cs-calls');
  const kara = el('button', 'cs-call', 'Kara');
  const krus = el('button', 'cs-call', 'Krus');
  calls.append(kara, krus);
  const wallet = el('div', 'cs-wallet');
  const rules = el('div', 'cs-rules', 'Win and your bet doubles (45%). The Tanod raids the table now and then (3%): the bet is taken and you spend 5 minutes in jail.');
  const showWallet = (n: number) => wallet.replaceChildren(coinIcon(2), el('b', undefined, n.toLocaleString()), el('span', undefined, n === 1 ? ' Kowen' : ' Kowens'));

  const wrap = el('div', 'cs-body');
  wrap.append(stage, result, betRow, calls, wallet, rules);

  let busy = false;
  const play = async (call: TownCoinSide) => {
    if (busy) return;
    const n = Number(bet.value);
    if (!Number.isInteger(n) || n < 1) {
      result.textContent = 'Pick a bet first.';
      result.className = 'cs-result cs-bad';
      return;
    }
    busy = true;
    kara.disabled = krus.disabled = true;
    stage.querySelector('.cs-tanod')?.remove();
    stage.classList.remove('cs-raid');
    result.textContent = `${side(call)}…`;
    result.className = 'cs-result';
    playSound('chip');
    const stop = flip(coin);
    const [res] = await Promise.all([gamble(n, call), wait(FLIP_MS)]);
    stop();
    coin.className = 'cs-coin';
    busy = false;
    kara.disabled = krus.disabled = false;
    if (!res) {
      face(coin, call);
      playSound('error');
      result.textContent = "Couldn't reach the table. Try again in a moment.";
      result.className = 'cs-result cs-bad';
      return;
    }
    showWallet(res.kowens);
    if (!res.ok) {
      face(coin, call);
      playSound('error');
      result.textContent = res.message;
      result.className = 'cs-result cs-bad';
      return;
    }
    if (res.outcome === 'bust') {
      coin.classList.add('cs-taken');
      stage.classList.add('cs-raid');
      tanod(stage);
      playSound('error');
      result.textContent = res.message;
      result.className = 'cs-result cs-bust';
      kara.disabled = krus.disabled = true; // off to jail
    } else {
      face(coin, res.landed ?? call);
      coin.classList.add(res.outcome === 'win' ? 'cs-won' : 'cs-lost');
      playSound(res.outcome === 'win' ? 'coin' : 'card');
      result.textContent = res.message;
      result.className = `cs-result ${res.outcome === 'win' ? 'cs-good' : 'cs-bad'}`;
    }
    window.dispatchEvent(new Event('mk-wallet')); // the HUD's Kowens
  };
  kara.addEventListener('click', () => void play('kara'));
  krus.addEventListener('click', () => void play('krus'));

  void showPopup({ title: 'Kara y Krus', body: [wrap], button: 'Leave', celebrate: false, lights: true, sound: 'card' });
  if (art.felt) {
    const card = wrap.closest('.rw-card') as HTMLElement | null;
    card?.style.setProperty('--felt', `url("${art.felt.url}")`);
    card?.style.setProperty('--felt-slice', String(art.felt.slice));
    card?.classList.add('cs-felt-art');
  }
  void loadMe(true).then((me) => {
    if (me.status === 'ok') {
      showWallet(me.me.kowens);
      if (me.me.status === 'jailed') {
        kara.disabled = krus.disabled = true;
        result.textContent = "You're in jail. No gambling till you're out.";
        result.className = 'cs-result cs-bad';
      }
    } else {
      kara.disabled = krus.disabled = true;
      result.textContent = 'Log in to play.';
    }
  });
}

// ── Dev: a pretend table (no bot behind the dev server). &bust=1 / &win=1 / &lose=1 force the outcome. ──

const q = new URLSearchParams(location.search);
const fakeState = { kowens: Number(q.get('kowens') ?? 1250), jailed: false };

function fakeGamble(bet: number, call: TownCoinSide): TownGambleResponse {
  const odds = { winChance: 0.45, bustChance: 0.03 };
  if (fakeState.jailed) return { ok: false, message: "You're in jail. No gambling till you're out.", kowens: fakeState.kowens, ...odds };
  if (bet > fakeState.kowens) return { ok: false, message: `You only have ${fakeState.kowens} Kowens.`, kowens: fakeState.kowens, ...odds };
  const r = Math.random();
  const outcome = q.has('bust') ? 'bust' : q.has('win') ? 'win' : q.has('lose') ? 'lose' : r < 0.03 ? 'bust' : r < 0.48 ? 'win' : 'lose';
  if (outcome === 'bust') {
    fakeState.kowens -= bet;
    fakeState.jailed = true;
    return { ok: true, outcome, bet, message: `The Tanod raided the table: ${bet} Kowens confiscated and 5 minutes in jail.`, kowens: fakeState.kowens, ...odds };
  }
  const landed: TownCoinSide = outcome === 'win' ? call : call === 'kara' ? 'krus' : 'kara';
  fakeState.kowens += outcome === 'win' ? bet : -bet;
  return { ok: true, outcome, landed, bet, message: outcome === 'win' ? `${side(call)}! You won ${bet} Kowens.` : `${side(landed)}. You lost ${bet} Kowens.`, kowens: fakeState.kowens, ...odds };
}
