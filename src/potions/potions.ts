import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

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

// 🍵 One hint per Easter egg. Each cup gives a hint the drinker hasn't heard yet.
export const MARITES_HINTS = [
  'Narinig ko… the Tanod has a soft spot for people who actually *read* his notes in the outpost. React and see. 💛',
  "Psst… sixty-seven days before Pasko, the morning greeting gets weird. Two numbers. React with both. 6️⃣7️⃣",
  'Every night and every morning at **11:11**, sometimes the Tanod lets you make a wish. Be fast. 🌠',
  "Sabi nila, there's something buried that's NOT on any dig list. One in ten thousand. Signed by someone important. 🩴",
  'Bet exactly the most meme-able number in the gambling den… and win. The Tanod adds a little extra. 🎰',
  'The jackpot loves an underdog. Win it with just **one** ticket against a crowd. 🍀',
  'Sometimes two Mosangs reach the chismis at the exact same time. Both sets of bettors get paid. 📸',
  'When the Tanod Patrol calls roll, salute him fast. 🫡 Within the first few seconds. He notices.',
  "The Tanod is a bot with feelings. Praise him enough times… and he'll get emotional. 🤖💖",
  'On Pasko itself, your daily Kowens hit different. 🎄',
];

interface UserPotions {
  have: Partial<Record<PotionId, number>>;
  tagoUntil?: number;
  swerteDigs?: number;
  hintsHeard?: number[];
}
const DIR = 'data';
const FILE = `${DIR}/potions.json`;
const state: Record<string, UserPotions> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
function save(): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(state));
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

/** A Marites hint the member hasn't heard yet, or null when they've heard them all. */
export function nextHint(userId: string): string | null {
  const u = of(userId);
  const heard = new Set(u.hintsHeard ?? []);
  const fresh = MARITES_HINTS.map((_, i) => i).filter((i) => !heard.has(i));
  if (!fresh.length) return null;
  const pick = fresh[Math.floor(Math.random() * fresh.length)];
  u.hintsHeard = [...heard, pick];
  save();
  return MARITES_HINTS[pick];
}
export const hintsLeft = (userId: string) => MARITES_HINTS.length - (state[userId]?.hintsHeard?.length ?? 0);
