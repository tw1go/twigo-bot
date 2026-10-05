import type { ArenaHand, ArenaServerMessage, TownPlayer } from '@mikazuki/shared';

// ✊ The Arena's jack en poy between two players in town, decided here (the browsers only show it). Players queue
// (arena-queue) and are matched two at a time. Each round opens for PICK_MS: both pick (arena-pick), held hidden until
// both are in, then revealed together with the result; whoever hasn't picked by then gets a random hand. First to
// FIRST_TO round wins; a draw is replayed. After the match either may ask for a rematch: the other is asked, and accepts
// or declines. Leaving or disconnecting mid-match gives the other player the win.
// Against the bot (arena-bot) the same match is played here too, the bot picking at random as each round opens; it
// always takes a rematch. Bets work against it as well: the stake is held, a win pays it back doubled, a loss keeps it.
// Bets (Kowens, at least 1: no free matches): each player names one (joining the queue, asking for or accepting a rematch); the stake is the
// smaller of the two (so 5 against 8 plays for 5), no more than both have. Both stakes are held when the match starts
// and the winner gets them both (`bets`, given by the web server: the money lives in the bot). Every finished match is
// announced in the town's system feed with a gently mocking line about the loser (`report` → `arenaLine`). No Discord
// code, so the dev server's town can run it (with pretend bets).

export const FIRST_TO = 2;
export const PICK_MS = 10_000;
/** Time for the browsers to walk in (the door transition, ~1.2 s) and play the VS intro (~2 s) before round 1; a rematch
 *  skips both. Keep in step with the game's arena/channel.ts. */
export const INTRO_MS = 3400;
export const REMATCH_MS = 900;
/** Time for the hands' reveal and the round's line before the next round opens. */
export const REVEAL_MS = 3200;
/** A pick that arrives just after the round closes on the browser's own timer still counts. */
const GRACE_MS = 400;
const HANDS: ArenaHand[] = ['bato', 'papel', 'gunting'];
/** The most anyone can bet on one match. */
export const MAX_BET = 100;
/** A bet is 1 to MAX_BET Kowens (no free matches: a missing or 0 bet counts as 1; the hold still caps it at what both have). */
const betOf = (bet: unknown) => (Number.isInteger(bet) ? Math.max(1, Math.min(MAX_BET, bet as number)) : 1);

/** Where the Kowens move (the web server's; keys are the seats' keys, i.e. member ids). */
export interface ArenaBets {
  /** Takes up to `want` from each of the two (never more than both have) and holds it; returns the stake each put in
   *  (0: no bet). */
  hold(a: string, b: string, want: number): number;
  /** The match is decided: the winner gets both stakes. */
  pay(winner: string, loser: string, stake: number): void;
  /** Against the bot: holds up to `want` of the player's (no more than they have); returns the stake. */
  holdSolo(player: string, want: number): number;
  /** Against the bot, decided: a win pays the stake back doubled, a loss keeps it. */
  paySolo(player: string, stake: number, won: boolean): void;
}

/** The bot goes by an everyday name, a new one each match (the browser shows it with the robot icon). */
const BOT_NAMES = ['Juan', 'Maria', 'Pedro', 'Ana', 'Jose', 'Liza', 'Carlo', 'Bea', 'Migs', 'Joy', 'Paolo', 'Kim', 'Rico', 'Tess', 'Nico', 'Lea', 'Ramon', 'Gab', 'Ella', 'Benjo'];

/** How a match ended, for the town's system feed. Names are town nicknames; hands are the deciding round's. */
export interface ArenaResult {
  winner: string;
  loser: string;
  win?: ArenaHand;
  lose?: ArenaHand;
  stake: number;
  /** Against the bot: which of the two it was. */
  bot?: 'winner' | 'loser';
  /** The loser walked out mid-match. */
  walkout?: boolean;
}

const VERB: Record<ArenaHand, string> = { bato: 'crushed', papel: 'wrapped up', gunting: 'snipped' };

/** A gently mocking line about the loser (`pick` chooses among a few, given a number in [0, 1)). */
export function arenaLine(r: ArenaResult, pick: number): string {
  const { winner: w, loser: l, win, lose, stake } = r;
  const kowens = stake ? `${stake} ${stake === 1 ? 'Kowen' : 'Kowens'}` : '';
  const lines =
    r.walkout ? [`${l} fled the Arena mid-match. ${w} wins by default${kowens ? ` and pockets ${kowens}` : ''}.`, `${l} ran for the exit. The crowd boos. ${w} takes the win${kowens ? ` (and ${kowens})` : ''}.`]
    : r.bot === 'winner' ? [`${l} lost to the practice bot. The bot!${kowens ? ` ${kowens} gone.` : ''}`, `${w} the bot outplayed ${l}${kowens ? ` and kept ${kowens}` : ''}. Beep boop.`, `${l} got schooled by a bot named ${w}${kowens ? `, ${kowens} poorer` : ''}.`]
    : r.bot === 'loser' ? [`${w} beat the practice bot${kowens ? ` for ${kowens}` : ''}. The bot will think about what it did.`, `${w} sent ${l} the bot back to the factory${kowens ? ` (+${kowens})` : ''}.`]
    : [
        ...(win && lose ? [`${w}'s ${win} ${VERB[win]} ${l}'s ${lose}${kowens ? `, ${kowens} changing hands` : ''}. Better luck next time, ${l}.`] : []),
        `${w} beat ${l} at jack en poy${kowens ? ` for ${kowens}` : ''}. ${l} is sitting under a rain cloud.`,
        `${l} lost to ${w} in the Arena${kowens ? ` (−${kowens})` : ''}. The crowd felt that one.`,
        `${w} sent ${l} home sulking${kowens ? ` with ${kowens} less` : ''}.`,
      ];
  return lines[Math.min(lines.length - 1, Math.floor(pick * lines.length))];
}

/** Bato beats gunting, gunting beats papel, papel beats bato. */
export const beats = (a: ArenaHand, b: ArenaHand) => (a === 'bato' && b === 'gunting') || (a === 'gunting' && b === 'papel') || (a === 'papel' && b === 'bato');

/** A player as the arena sees them: who (a stable key per member), what to show the other, and how to reach them. */
export interface ArenaSeat {
  key: string;
  player: TownPlayer;
  send(m: ArenaServerMessage): void;
}

interface Match {
  seats: [ArenaSeat, ArenaSeat];
  /** Against the bot (seat 1 is the bot). */
  bot: boolean;
  bets: [number, number];
  stake: number;
  /** A rematch asked for: by whom (0 / 1) and their bet. */
  ask: { from: number; bet: number } | null;
  wins: [number, number];
  round: number;
  picks: [ArenaHand | null, ArenaHand | null];
  open: boolean;
  over: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

type Clock = { set: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>; clear: (t: ReturnType<typeof setTimeout>) => void };

export class Arena {
  private readonly queue: ArenaSeat[] = [];
  private readonly matches = new Map<string, Match>(); // by seat key, both players

  private readonly bet = new Map<string, number>(); // queued players' bets

  constructor(
    private readonly clock: Clock = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t) },
    private readonly random: () => number = Math.random,
    private readonly bets: ArenaBets | null = null,
    /** Every finished match, for the system feed. */
    private readonly report: ((r: ArenaResult) => void) | null = null,
  ) {}

  join(seat: ArenaSeat, bet: unknown = 0): void {
    if (this.matches.has(seat.key)) return;
    const at = this.queue.findIndex((s) => s.key === seat.key);
    if (at >= 0) this.queue.splice(at, 1);
    this.bet.set(seat.key, betOf(bet));
    const other = this.queue.shift();
    if (!other) {
      this.queue.push(seat);
      return seat.send({ t: 'arena-queued' });
    }
    const bets: [number, number] = [this.bet.get(other.key) ?? 0, this.bet.get(seat.key) ?? 0];
    this.bet.delete(other.key);
    this.bet.delete(seat.key);
    const m: Match = { seats: [other, seat], bot: false, bets, stake: 0, ask: null, wins: [0, 0], round: 0, picks: [null, null], open: false, over: false, timer: null };
    this.matches.set(other.key, m);
    this.matches.set(seat.key, m);
    this.start(m, false);
  }

  /** A match against the bot (seat 1), with a bet if any. */
  playBot(seat: ArenaSeat, bet: unknown = 0): void {
    if (this.matches.has(seat.key)) return;
    this.cancel(seat.key);
    const name = BOT_NAMES[Math.floor(this.random() * BOT_NAMES.length)];
    const player = { id: 'bot', nickname: name, title: { name: 'Bot', color: '#7A8099' }, outfit: {}, col: 0, row: 0, dir: 's', sit: false } as unknown as TownPlayer;
    const bot: ArenaSeat = { key: `bot:${seat.key}`, player, send: () => {} };
    const b = betOf(bet);
    const m: Match = { seats: [seat, bot], bot: true, bets: [b, b], stake: 0, ask: null, wins: [0, 0], round: 0, picks: [null, null], open: false, over: false, timer: null };
    this.matches.set(seat.key, m);
    this.matches.set(bot.key, m);
    this.start(m, false);
  }

  cancel(key: string): void {
    const at = this.queue.findIndex((s) => s.key === key);
    if (at >= 0) this.queue.splice(at, 1);
    this.bet.delete(key);
  }

  pick(key: string, hand: unknown): void {
    const m = this.matches.get(key);
    if (!m || !m.open || !HANDS.includes(hand as ArenaHand)) return;
    const i = m.seats[0].key === key ? 0 : 1;
    if (m.picks[i]) return; // no changing your mind
    m.picks[i] = hand as ArenaHand;
    if (m.picks[0] && m.picks[1]) this.reveal(m);
  }

  /** Asks for a rematch (the other player is asked), or accepts the other's ask; with this player's bet. */
  rematch(key: string, bet: unknown = 0): void {
    const m = this.matches.get(key);
    if (!m || !m.over) return;
    const i = m.seats[0].key === key ? 0 : 1;
    if (m.bot) {
      // The bot always takes a rematch.
      m.bets = [betOf(bet), betOf(bet)];
      Object.assign(m, { wins: [0, 0], round: 0, picks: [null, null], over: false });
      return this.start(m, true);
    }
    if (m.ask && m.ask.from !== i) {
      // Accepted: the stake is the smaller of the two bets.
      m.bets[m.ask.from] = m.ask.bet;
      m.bets[i] = betOf(bet);
      Object.assign(m, { ask: null, wins: [0, 0], round: 0, picks: [null, null], over: false });
      return this.start(m, true);
    }
    m.ask = { from: i, bet: betOf(bet) };
    m.seats[1 - i].send({ t: 'arena-rematch-ask', bet: m.ask.bet });
    m.seats[i].send({ t: 'arena-rematch-wait' });
  }

  /** Says no to the other player's rematch. */
  decline(key: string): void {
    const m = this.matches.get(key);
    if (!m?.ask) return;
    const i = m.seats[0].key === key ? 0 : 1;
    if (m.ask.from === i) return;
    m.seats[m.ask.from].send({ t: 'arena-rematch-declined' });
    m.ask = null;
  }

  /** Left the match (or the queue), on purpose or by disconnecting. */
  leave(key: string): void {
    this.cancel(key);
    const m = this.matches.get(key);
    if (!m) return;
    if (m.timer) this.clock.clear(m.timer);
    for (const s of m.seats) this.matches.delete(s.key);
    const other = m.seats[0].key === key ? m.seats[1] : m.seats[0];
    if (!m.over && m.stake) {
      // Walked out: the stake goes to the other (against the bot, it's lost).
      if (m.bot) this.bets?.paySolo(m.seats[0].key, m.stake, false);
      else this.bets?.pay(other.key, key, m.stake);
    }
    // A walk-out after a round has been played is a loss worth mentioning (not leaving the intro or against the bot).
    if (!m.over && !m.bot && m.round > 0) {
      const leaver = m.seats[0].key === key ? m.seats[0] : m.seats[1];
      this.report?.({ winner: other.player.nickname, loser: leaver.player.nickname, stake: m.stake, walkout: true });
    }
    other.send({ t: 'arena-left', youWin: !m.over });
  }

  /** Who's in a match now (for tests and the dev server). */
  get playing(): number {
    return this.matches.size;
  }

  private start(m: Match, rematch: boolean): void {
    const [a, b] = m.seats;
    const want = Math.min(m.bets[0], m.bets[1]);
    m.stake = want > 0 && this.bets ? (m.bot ? this.bets.holdSolo(a.key, want) : this.bets.hold(a.key, b.key, want)) : 0;
    const face = (p: TownPlayer) => ({ id: p.id, nickname: p.nickname, title: p.title, outfit: p.outfit });
    a.send({ t: 'arena-start', opponent: { ...face(b.player), ...(m.bot ? { bot: true } : {}) }, firstTo: FIRST_TO, rematch, stake: m.stake });
    b.send({ t: 'arena-start', opponent: face(a.player), firstTo: FIRST_TO, rematch, stake: m.stake });
    m.timer = this.clock.set(() => this.openRound(m), rematch ? REMATCH_MS : INTRO_MS);
  }

  private openRound(m: Match): void {
    m.round += 1;
    m.picks = [null, null];
    if (m.bot) m.picks[1] = HANDS[Math.floor(this.random() * HANDS.length)]; // the bot picks at once, unseen
    m.open = true;
    for (const s of m.seats) s.send({ t: 'arena-round', round: m.round, ms: PICK_MS });
    m.timer = this.clock.set(() => this.reveal(m), PICK_MS + GRACE_MS);
  }

  private reveal(m: Match): void {
    if (!m.open) return;
    m.open = false;
    if (m.timer) this.clock.clear(m.timer);
    const random: [boolean, boolean] = [!m.picks[0], !m.picks[1]];
    const any = () => HANDS[Math.floor(this.random() * HANDS.length)];
    const hands: [ArenaHand, ArenaHand] = [m.picks[0] ?? any(), m.picks[1] ?? any()];
    const winner = beats(hands[0], hands[1]) ? 0 : beats(hands[1], hands[0]) ? 1 : -1;
    if (winner !== -1) m.wins[winner] += 1;
    m.over = m.wins[0] >= FIRST_TO || m.wins[1] >= FIRST_TO;
    if (m.over) {
      const w = m.wins[0] >= FIRST_TO ? 0 : 1;
      if (m.stake) {
        if (m.bot) this.bets?.paySolo(m.seats[0].key, m.stake, w === 0);
        else this.bets?.pay(m.seats[w].key, m.seats[1 - w].key, m.stake);
      }
      this.report?.({
        winner: m.seats[w].player.nickname,
        loser: m.seats[1 - w].player.nickname,
        win: hands[w],
        lose: hands[1 - w],
        stake: m.stake,
        ...(m.bot ? { bot: w === 1 ? ('winner' as const) : ('loser' as const) } : {}),
      });
    }
    m.seats.forEach((s, i) => {
      const o = 1 - i;
      s.send({
        t: 'arena-reveal',
        you: hands[i],
        them: hands[o],
        result: winner < 0 ? 'draw' : winner === i ? 'win' : 'lose',
        score: [m.wins[i], m.wins[o]],
        random: [random[i], random[o]],
        ...(m.over ? { over: m.wins[i] >= FIRST_TO ? ('you' as const) : ('them' as const) } : {}),
      });
    });
    m.timer = m.over ? null : this.clock.set(() => this.openRound(m), REVEAL_MS);
  }
}
