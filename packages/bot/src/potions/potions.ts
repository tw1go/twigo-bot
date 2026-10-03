import { saveTogether, tableSync } from '../db/sync.js';
import { hasFound, type EggKey } from '../games/found.js';

// 🧪 Potions: bought in /redeem, used with /potion use. Counts and active effects live in data/potions.json.
export const POTIONS = {
  kalawang: { name: 'Kalawang Potion', emoji: '🧪', cost: 8, effect: "Rusts someone's 🧱 Bakod: cuts its remaining time in half" },
  tago: { name: 'Tago Tonic', emoji: '🫥', cost: 6, effect: 'For 30 minutes the Tanod can\'t see you gamble: 0% bust chance' },
  swerte: { name: 'Swerte Elixir', emoji: '🍀', cost: 5, effect: 'Your next 3 digs: any junk gets rerolled once' },
  marites: { name: 'Marites Tea', emoji: '🍵', cost: 3, effect: 'Aling Marites spills a hint about a hidden Easter egg' },
} as const;
export type PotionId = keyof typeof POTIONS;
export const POTION_IDS = Object.keys(POTIONS) as PotionId[];

export const TAGO_MINUTES = 30;
export const SWERTE_DIGS = 3;

// 🍵 One hint per Easter egg. Each cup gives a hint about an egg the drinker hasn't found and hasn't heard about yet.
export const MARITES_HINTS: { key: EggKey; text: string }[] = [
  { key: 'note', text: 'Narinig ko… the Tanod has a soft spot for people who actually *read* his notes in the outpost. React and see. 💛' },
  { key: '67', text: 'Psst… sixty-seven days before Pasko, the morning greeting gets weird. Two numbers. React with both. 6️⃣7️⃣' },
  { key: 'wish', text: 'Every night and every morning at **11:11**, sometimes the Tanod lets you make a wish. Be fast. 🌠' },
  { key: 'secret-item', text: "Sabi nila, there's something buried that's NOT on any dig list. One in ten thousand. Signed by someone important. 🩴" },
  { key: '67-bet', text: 'Bet exactly the most meme-able number in the gambling den… and win. The Tanod adds a little extra. 🎰' },
  { key: 'underdog', text: 'The jackpot loves an underdog. Win it with just **one** ticket against a crowd. 🍀' },
  { key: 'photo-finish', text: 'Sometimes two Mosangs reach the chismis at the exact same time. Both sets of bettors get paid. 📸' },
  { key: 'salute', text: 'When the Tanod Patrol calls roll, salute him fast. 🫡 Within the first few seconds. He notices.' },
  { key: 'praise-bot', text: "The Tanod is a bot with feelings. Praise him enough times… and he'll get emotional. 🤖💖" },
  { key: 'christmas', text: 'On Pasko itself, your daily Kowens hit different. 🎄' },
];

interface UserPotions {
  have: Partial<Record<PotionId, number>>;
  tagoUntil?: number;
  swerteDigs?: number;
  hintsHeard?: number[];
}
// Potions owned live in `potion_stock`, active effects and heard hints in `potion_effects`.
type EffectRow = { user_id: string; tago_until: number | null; swerte_digs: number | null; hints_heard: string | null };
const stockTable = tableSync<{ user_id: string; potion_id: string; count: number }>('potion_stock', ['user_id', 'potion_id'], ['count']);
const effectTable = tableSync<EffectRow>('potion_effects', ['user_id'], ['tago_until', 'swerte_digs', 'hints_heard']);
const state: Record<string, UserPotions> = {};
for (const r of stockTable.load()) (state[r.user_id] ??= { have: {} }).have[r.potion_id as PotionId] = r.count;
for (const r of effectTable.load()) {
  const u = (state[r.user_id] ??= { have: {} });
  if (r.tago_until !== null) u.tagoUntil = r.tago_until;
  if (r.swerte_digs !== null) u.swerteDigs = r.swerte_digs;
  if (r.hints_heard !== null) u.hintsHeard = JSON.parse(r.hints_heard) as number[];
}
function save(): void {
  const all = Object.entries(state);
  saveTogether(
    [stockTable, all.flatMap(([user_id, u]) => Object.entries(u.have).filter(([, n]) => (n ?? 0) > 0).map(([potion_id, count]) => ({ user_id, potion_id, count })))],
    [effectTable, all
      .filter(([, u]) => u.tagoUntil !== undefined || u.swerteDigs !== undefined || u.hintsHeard !== undefined)
      .map(([user_id, u]): EffectRow => ({ user_id, tago_until: u.tagoUntil ?? null, swerte_digs: u.swerteDigs ?? null,
        hints_heard: u.hintsHeard ? JSON.stringify(u.hintsHeard) : null }))],
  );
}
const of = (userId: string) => (state[userId] ??= { have: {} });

export const potionCount = (userId: string, id: PotionId) => state[userId]?.have[id] ?? 0;
export const ownedPotions = (userId: string) => POTION_IDS.map((id) => [id, potionCount(userId, id)] as const).filter(([, n]) => n > 0);

export function addPotions(userId: string, id: PotionId, n: number): number {
  const u = of(userId);
  u.have[id] = (u.have[id] ?? 0) + n;
  save();
  return u.have[id]!;
}

/** Uses one potion. Returns false if they have none. */
export function usePotion(userId: string, id: PotionId): boolean {
  const u = state[userId];
  if (!u?.have[id]) return false;
  u.have[id]! -= 1;
  save();
  return true;
}

// ── Effects ──
export const tagoUntil = (userId: string) => ((state[userId]?.tagoUntil ?? 0) > Date.now() ? state[userId]!.tagoUntil! : null);
export function startTago(userId: string): number {
  const u = of(userId);
  u.tagoUntil = Math.max(u.tagoUntil ?? 0, Date.now()) + TAGO_MINUTES * 60_000;
  save();
  return u.tagoUntil;
}

export const swerteLeft = (userId: string) => state[userId]?.swerteDigs ?? 0;
export function startSwerte(userId: string): number {
  const u = of(userId);
  u.swerteDigs = (u.swerteDigs ?? 0) + SWERTE_DIGS;
  save();
  return u.swerteDigs;
}
/** Uses one Swerte dig, if any are active. */
export function useSwerteDig(userId: string): boolean {
  const u = state[userId];
  if (!u?.swerteDigs) return false;
  u.swerteDigs -= 1;
  save();
  return true;
}

/** Hint indexes this member could still get: not heard yet, and about an egg they haven't found. */
const freshHints = (userId: string) => {
  const heard = new Set(state[userId]?.hintsHeard ?? []);
  return MARITES_HINTS.map((h, i) => ({ h, i })).filter(({ h, i }) => !heard.has(i) && !hasFound(userId, h.key)).map(({ i }) => i);
};

/** A fresh Marites hint, or null when there's nothing new to tell them. */
export function nextHint(userId: string): string | null {
  const fresh = freshHints(userId);
  if (!fresh.length) return null;
  const pick = fresh[Math.floor(Math.random() * fresh.length)];
  const u = of(userId);
  u.hintsHeard = [...(u.hintsHeard ?? []), pick];
  save();
  return MARITES_HINTS[pick].text;
}
export const hintsLeft = (userId: string) => freshHints(userId).length;
