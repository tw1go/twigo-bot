import { markFound } from '../games/found.js';
import { jailedUntil } from '../games/jail.js';
import { useSwerteDig } from '../potions/potions.js';
import { kowen } from '../kowens.js';
import { type Item, RARITY, rollItem, rollLucky } from './items.js';
import { DIGS_PER_DAY, capacity, countLuckyDig, digStreak, digsToday, recordDig, resetLuck, shovelUses } from './store.js';
import { usedSlots } from './bag.js';

// ⛏️ One dig, shared by /dig and the town's Mine: every check, then the roll and the saving. Callers word the result
// their own way (the slash command's reveal, the town's dig panel).

export type DigResult =
  | { ok: false; reason: 'jailed'; until: number }
  | { ok: false; reason: 'bag-full'; items: number; slots: number }
  | { ok: false; reason: 'no-shovel' }
  | { ok: false; reason: 'no-digs' }
  | {
      ok: true;
      item: Item;
      /** Their lucky dig (store.ts: the streak reached their hidden threshold): Epic or better. */
      lucky: boolean;
      /** Digs since their last Epic or better, after this one (0: this one was). */
      streak: number;
      /** Digs left today, uses left on the shovel, and the bag after the find. */
      left: number;
      shovel: number;
      items: number;
      slots: number;
    };

export function digFor(userId: string): DigResult {
  const until = jailedUntil(userId);
  if (until) return { ok: false, reason: 'jailed', until };
  const slots = capacity(userId);
  if (usedSlots(userId) >= slots) return { ok: false, reason: 'bag-full', items: usedSlots(userId), slots };
  if (shovelUses(userId) <= 0) return { ok: false, reason: 'no-shovel' };
  if (digsToday(userId) >= DIGS_PER_DAY) return { ok: false, reason: 'no-digs' };

  const lucky = countLuckyDig(userId); // 🍀 their streak reached its hidden threshold: Epic or better
  const swerte = useSwerteDig(userId); // 🍀 Swerte Elixir: junk gets one reroll
  const first = rollItem();
  const rolled = swerte && first.rarity === 'junk' ? rollItem() : first;
  // The lucky dig never downgrades a secret find.
  const item = lucky && rolled.rarity !== 'secret' ? rollLucky() : rolled;
  recordDig(userId, item.id);
  if (item.rarity === 'secret') markFound(userId, 'secret-item');
  if (EPIC_PLUS.has(item.rarity)) resetLuck(userId); // any Epic or better: the streak starts over, a new threshold
  return { ok: true, item, lucky, streak: digStreak(userId), left: DIGS_PER_DAY - digsToday(userId), shovel: shovelUses(userId), items: usedSlots(userId), slots };
}

/** Epic or better: what resets the dig streak (CONTEXT.md Lucky dig). */
const EPIC_PLUS: ReadonlySet<Item['rarity']> = new Set(['epic', 'mythical', 'legendary', 'secret']);

/** The dig streak as the reveals say it. */
export const streakLine = (streak: number) => (streak === 0 ? '🍀 Your luck starts over' : `🍀 ${streak} dig${streak === 1 ? '' : 's'} since your last Epic or better`);

/** Finds big enough to shout about (the reveal says so, and the games channel hears of it). */
export const isBigFind = (item: Item) => item.rarity === 'mythical' || item.rarity === 'legendary' || item.rarity === 'secret';

/** The reveal as /dig shows it in Discord: the find, and the digger's dig, shovel, bag and lucky-dig counters. */
export function digReveal(who: string, result: Extract<DigResult, { ok: true }>): string {
  const { item: found, lucky, streak, left, shovel, items, slots } = result;
  const r = RARITY[found.rarity];
  const luckyBanner = lucky ? '🍀✨ **LUCKY DIG!** Your luck came through: guaranteed Epic or better!\n' : '';
  return [
    luckyBanner +
    (isBigFind(found)
      ? `🚨✨ **${r.label.toUpperCase()} FIND!** ✨🚨\n${who} dug up…\n# ${found.emoji} ${found.name}\n${r.emoji} **${r.label}** · worth **${found.value}** ${kowen(found.value)}`
      : `⛏️ ${who} dug up…\n## ${found.emoji} ${found.name}\n${r.emoji} ${r.label} · worth **${found.value}** ${kowen(found.value)}`),
    `-# ${left} dig${left === 1 ? '' : 's'} left today · 🪏 ${shovel} use${shovel === 1 ? '' : 's'} left on your shovel${shovel === 0 ? ' — it broke!' : ''} · 🎒 ${items}/${slots} · ${streakLine(streak)}`,
  ].join('\n');
}
