import { el, showPopup } from '../ui/reward';
import { MAX_BET, type PlayerChannel } from './channel';
import { showQueue } from './queue';

// ✊ The Arena's menu (click the Arena, or E at its door), in the reward box: a bet (logged in; at least 1) and Vs Bot
// (straight to the match) or Vs Player (the arena queue: the menu closes and the matchmaking bar waits at the top,
// arena/queue.ts, while the player walks around town). Cancel or Escape closes it. Vs Player needs the town's connection, and isn't open from
// jail. Logged in, the bot's match is played on the server too (so it can be bet on).

export interface ArenaMenu {
  /** The menu's icons (manifest ui.arenaModes: frame 0 Vs Bot, 1 Vs Player). */
  icons: { url: string; size: number } | null;
  /** Why Vs Player can't be played right now (null: it can). */
  noPlayer: string | null;
  /** Bets can be placed (logged in). */
  canBet: boolean;
  /** Vs Bot: a server match to wait for (its channel hears it start), or null when it was started here. */
  bot: (bet: number) => PlayerChannel | null;
  /** Joins the queue; the channel hears the match start. */
  queue: (bet: number) => PlayerChannel | null;
  onMatched: (channel: PlayerChannel, bet: number) => void;
}

/** The bet: − [n] + Kowens, 1 to MAX_BET (every match is played for Kowens; the server holds no more than you have). */
export function betField(start: number): { el: HTMLElement; value: () => number } {
  const row = el('div', 'bet-field');
  const input = el('input', 'bet-input');
  Object.assign(input, { type: 'number', min: '1', max: String(MAX_BET), step: '1', inputMode: 'numeric', value: String(start) });
  input.setAttribute('aria-label', 'Bet (Kowens)');
  const value = () => Math.max(1, Math.min(MAX_BET, Math.floor(Number(input.value) || 1)));
  const step = (by: number, text: string) => {
    const b = el('button', 'bet-step', text);
    b.type = 'button';
    b.addEventListener('click', () => (input.value = String(Math.max(1, Math.min(MAX_BET, value() + by)))));
    return b;
  };
  input.addEventListener('change', () => (input.value = String(value())));
  row.append(el('span', 'bet-label', 'Bet'), step(-1, '−'), input, step(1, '+'), el('span', 'bet-unit', 'Kowens'));
  return { el: row, value };
}

export function showArenaMenu(o: ArenaMenu): void {
  let channel: PlayerChannel | null = null;
  let matched = false;
  let stopListening: (() => void) | null = null;

  const icon = (frame: number) => {
    const i = el('span', 'am-icon');
    if (o.icons) {
      const z = 2;
      i.style.backgroundImage = `url("${o.icons.url}")`;
      i.style.backgroundSize = `${o.icons.size * 2 * z}px ${o.icons.size * z}px`;
      i.style.backgroundPosition = `-${frame * o.icons.size * z}px 0`;
    }
    return i;
  };
  const mode = (frame: number, label: string, hint: string) => {
    const b = el('button', 'am-mode');
    b.append(icon(frame), el('span', 'am-label', label), el('span', 'am-hint', hint));
    return b;
  };
  const bet = betField(1);
  bet.el.hidden = !o.canBet;
  const bot = mode(0, 'Vs Bot', 'Spar with the Tanod’s bot');
  const player = mode(1, 'Vs Player', o.noPlayer ?? 'Face a challenger from town');
  if (o.noPlayer) player.disabled = true;
  const modes = el('div', 'am-modes');
  modes.append(bot, player);
  const waiting = el('div', 'am-waiting');
  waiting.hidden = true;
  const waitText = el('span');
  waiting.append(el('span', 'am-dots', '…'), waitText);
  const rules = el(
    'p',
    'am-rules',
    `Bato crushes gunting, gunting cuts papel, papel wraps bato. First to 2 rounds wins.${o.canBet ? ' Against a player the stake is the smaller bet; the winner takes it.' : ''}`,
  );
  const wrap = el('div', 'am-body');
  wrap.append(el('p', 'am-tag', 'Two enter. One leaves victorious.'), bet.el, modes, waiting, rules);

  const closeMenu = () => document.querySelector<HTMLButtonElement>('#reward:has(.am-body) .rw-ok')?.click();
  /** Waits for the server's match to start: hands its first message on to the match screen, and closes the menu. */
  const await_ = (c: PlayerChannel, text: string, placed: number) => {
    channel = c;
    modes.hidden = true;
    bet.el.hidden = true;
    waitText.textContent = text;
    waiting.hidden = false;
    stopListening = c.listen((m) => {
      if (m.t !== 'arena-start') return;
      stopListening?.();
      matched = true;
      c.push(m);
      closeMenu();
      o.onMatched(c, placed);
    });
  };
  bot.addEventListener('click', () => {
    const placed = bet.value();
    const c = o.bot(placed);
    if (c) return await_(c, 'Starting…', placed);
    matched = true; // played here: not a queue to leave
    closeMenu();
  });
  player.addEventListener('click', () => {
    const placed = bet.value();
    const c = o.queue(placed);
    if (!c) return;
    matched = true; // the queue is the matchmaking bar's now
    closeMenu();
    showQueue(c, () => o.onMatched(c, placed));
  });

  void showPopup({ title: 'Arena', body: [wrap], button: 'Retreat', celebrate: false, sound: 'door', theme: 'arena' }).then(() => {
    stopListening?.();
    if (channel && !matched) channel.send({ t: 'arena-cancel' });
  });
}
