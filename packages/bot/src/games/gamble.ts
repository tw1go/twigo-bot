import { add, balance, take } from '../credits/store.js';
import { tagoUntil } from '../potions/potions.js';
import { markFound } from './found.js';
import { jail, jailedUntil } from './jail.js';

// 🎲 One bet, shared by /gamble and the town's Casino (Kara y Krus): a coin flip that doubles the bet 45% of the time;
// otherwise the bet is lost, and sometimes the Tanod busts you (the bet is confiscated and you spend 5 minutes in
// jail). The bust chance depends on where: low in the gambling channel and the Casino, high anywhere else; a Tago
// Tonic hides you completely. Callers word the result their own way.

export const WIN_CHANCE = 0.45;
export const SIXTY_SEVEN_BONUS = 7; // 🤫 win a bet of exactly 67 → +7 extra
export const BUST_CHANCE_IN_CHANNEL = 0.03;
export const BUST_CHANCE_ELSEWHERE = 0.2;
export const BUST_JAIL_MINUTES = 5;
const COOLDOWN_MS = 10_000;
const lastUsed = new Map<string, number>();

/** Where the bet is placed: the gambling channel or the town's Casino (low bust chance), or anywhere else. */
export type Table = 'safe' | 'elsewhere';

export type GambleResult =
  | { ok: false; reason: 'jailed'; until: number }
  | { ok: false; reason: 'cooldown'; waitMs: number }
  | { ok: false; reason: 'kowens'; have: number }
  | { ok: true; outcome: 'win' | 'lose' | 'bust'; bet: number; bonus: number; balance: number; hidden: boolean };

export async function gambleFor(userId: string, bet: number, table: Table): Promise<GambleResult> {
  const until = jailedUntil(userId);
  if (until) return { ok: false, reason: 'jailed', until };
  const wait = (lastUsed.get(userId) ?? 0) + COOLDOWN_MS - Date.now();
  if (wait > 0) return { ok: false, reason: 'cooldown', waitMs: wait };
  const have = balance(userId);
  if (bet > have) return { ok: false, reason: 'kowens', have };
  lastUsed.set(userId, Date.now());

  const hidden = !!tagoUntil(userId); // 🫥 Tago Tonic: the Tanod can't see you
  const bustChance = hidden ? 0 : table === 'safe' ? BUST_CHANCE_IN_CHANNEL : BUST_CHANCE_ELSEWHERE;
  const roll = Math.random();
  if (roll < bustChance) {
    take(userId, bet);
    await jail(userId, BUST_JAIL_MINUTES, 'Caught gambling');
    return { ok: true, outcome: 'bust', bet, bonus: 0, balance: balance(userId), hidden };
  }
  if (roll < bustChance + WIN_CHANCE) {
    const bonus = bet === 67 ? SIXTY_SEVEN_BONUS : 0; // 🤫 6-7
    add(userId, bet + bonus);
    if (bonus) markFound(userId, '67-bet');
    return { ok: true, outcome: 'win', bet, bonus, balance: balance(userId), hidden };
  }
  take(userId, bet);
  return { ok: true, outcome: 'lose', bet, bonus: 0, balance: balance(userId), hidden };
}
