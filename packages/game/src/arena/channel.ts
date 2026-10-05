import type { ArenaHand, ArenaServerMessage, OutfitData, TitleData, TownClientMessage } from '@mikazuki/shared';
import type { CharacterDefs } from '../assets/types';
import { randomOutfit } from '../characters/doll';
import { hash, rng } from '../world/rng';
import type { TownLink } from '../net/town';

// ✊ How the arena's match screen talks: one protocol (the arena-* messages, bot web/town-arena.ts) whether the other
// side is a player or the server's bot — through the town's connection, decided by the server — or the bot played here
// (guests, and dev's &rounds=) with the same messages and timings, never for Kowens. Messages wait in a queue until the screen listens (it may still be walking in).

export const HANDS: ArenaHand[] = ['bato', 'papel', 'gunting'];
export const beats = (a: ArenaHand, b: ArenaHand) => (a === 'bato' && b === 'gunting') || (a === 'gunting' && b === 'papel') || (a === 'papel' && b === 'bato');
export const FIRST_TO = 2;
/** Keep in step with the bot's web/town-arena.ts. */
export const PICK_MS = 10_000;
export const INTRO_MS = 3400;
export const REMATCH_MS = 900;
export const REVEAL_MS = 3200;
/** The most anyone can bet on one match. */
export const MAX_BET = 100;
/** The bot goes by an everyday name (a new one each match); the robot icon beside it says it's the bot. */
const BOT_NAMES = ['Juan', 'Maria', 'Pedro', 'Ana', 'Jose', 'Liza', 'Carlo', 'Bea', 'Migs', 'Joy', 'Paolo', 'Kim', 'Rico', 'Tess', 'Nico', 'Lea', 'Ramon', 'Gab', 'Ella', 'Benjo'];

export type ArenaClientMessage = Extract<TownClientMessage, { t: `arena-${string}` }>;
export type ArenaOpponent = { id: string; nickname: string; title: TitleData; outfit: OutfitData; bot?: boolean };

export abstract class ArenaChannel {
  private queue: ArenaServerMessage[] = [];
  private listener: ((m: ArenaServerMessage) => void) | null = null;
  abstract readonly mode: 'bot' | 'player';
  abstract send(m: ArenaClientMessage): void;

  /** From the other side. */
  push(m: ArenaServerMessage): void {
    if (this.listener) this.listener(m);
    else this.queue.push(m);
  }

  /** Starts listening (what came before is delivered first); returns how to stop. */
  listen(fn: (m: ArenaServerMessage) => void): () => void {
    this.listener = fn;
    for (const m of this.queue.splice(0)) fn(m);
    return () => {
      if (this.listener === fn) this.listener = null;
    };
  }
}

/** Against another player or the server's bot: through the town's connection (TownScene passes the server's arena-* messages in). */
export class PlayerChannel extends ArenaChannel {
  readonly mode = 'player';
  constructor(private readonly link: TownLink) {
    super();
  }
  send(m: ArenaClientMessage): void {
    this.link.send(m);
  }
}

/**
 * Against the bot, played here: the same messages and timings as the server. `forced` (dev: &rounds=win,lose,draw)
 * decides rounds in order — the bot picks the hand that loses to, beats or matches yours.
 */
export class BotChannel extends ArenaChannel {
  readonly mode = 'bot';
  readonly opponent: ArenaOpponent;
  private wins: [number, number] = [0, 0];
  private round = 0;
  private open = false;
  private over = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private forced: ('win' | 'lose' | 'draw')[];

  constructor(C: CharacterDefs, seed: number, forced: ('win' | 'lose' | 'draw')[] = []) {
    super();
    this.forced = [...forced];
    // A random look from the wardrobe and an everyday name, seeded per match.
    const r = rng(hash(seed, 77));
    const nickname = BOT_NAMES[Math.floor(r() * BOT_NAMES.length)];
    this.opponent = { id: 'bot', nickname, title: { name: 'Bot', color: '#7A8099' }, outfit: randomOutfit(C, r) as OutfitData, bot: true };
    this.start(false);
  }

  send(m: ArenaClientMessage): void {
    if (m.t === 'arena-pick' && this.open) this.reveal(m.hand, false);
    else if (m.t === 'arena-rematch' && this.over) {
      this.wins = [0, 0];
      this.round = 0;
      this.over = false;
      this.start(true);
    } else if (m.t === 'arena-leave') this.stop();
  }

  private start(rematch: boolean): void {
    this.push({ t: 'arena-start', opponent: this.opponent, firstTo: FIRST_TO, rematch, stake: 0 });
    this.later(() => this.openRound(), rematch ? REMATCH_MS : INTRO_MS);
  }

  private openRound(): void {
    this.round += 1;
    this.open = true;
    this.push({ t: 'arena-round', round: this.round, ms: PICK_MS });
    this.later(() => this.reveal(HANDS[Math.floor(Math.random() * 3)], true), PICK_MS + 400); // too slow: a random hand
  }

  private reveal(mine: ArenaHand, random: boolean): void {
    if (!this.open) return;
    this.open = false;
    const want = this.forced.shift();
    const theirs =
      want === 'win' ? HANDS.find((h) => beats(mine, h))!
      : want === 'lose' ? HANDS.find((h) => beats(h, mine))!
      : want === 'draw' ? mine
      : HANDS[Math.floor(Math.random() * 3)];
    const result = beats(mine, theirs) ? 'win' : beats(theirs, mine) ? 'lose' : 'draw';
    if (result === 'win') this.wins[0] += 1;
    if (result === 'lose') this.wins[1] += 1;
    this.over = this.wins[0] >= FIRST_TO || this.wins[1] >= FIRST_TO;
    this.push({
      t: 'arena-reveal',
      you: mine,
      them: theirs,
      result,
      score: [...this.wins],
      random: [random, false],
      ...(this.over ? { over: this.wins[0] >= FIRST_TO ? ('you' as const) : ('them' as const) } : {}),
    });
    if (!this.over) this.later(() => this.openRound(), REVEAL_MS);
  }

  private later(fn: () => void, ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(fn, ms);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
