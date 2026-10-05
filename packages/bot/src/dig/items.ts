import { kvLoad, kvSave } from '../db/db.js';

// Everything /dig can turn up. `value` is what /sell pays, in Kowens.
// A dig first rolls a rarity (RARITY_CHANCE), then an item of that rarity — cheaper items come up much more often.
// The items below are the defaults: the CMS changes them, adds new ones and takes some out of the ground (kv
// 'dig-items', see setDigItem). An item out of the ground (`off`) isn't dug up any more, but the ones already found stay
// in bags and still sell.

export type Rarity = 'junk' | 'common' | 'uncommon' | 'rare' | 'epic' | 'mythical' | 'legendary' | 'secret';

export const RARITY: Record<Rarity, { label: string; emoji: string }> = {
  junk: { label: 'Junk', emoji: '⚫' },
  common: { label: 'Common', emoji: '⚪' },
  uncommon: { label: 'Uncommon', emoji: '🟢' },
  rare: { label: 'Rare', emoji: '🔵' },
  epic: { label: 'Epic', emoji: '🟣' },
  mythical: { label: 'Mythical', emoji: '🟠' },
  legendary: { label: 'Legendary', emoji: '🟡' },
  secret: { label: 'Secret', emoji: '🌟' },
};

/** Chance of each rarity per dig (sums to 1). Tuned so a dig is worth ~0.75 Kowens on average: mostly junk
 *  and cheap commons, with the value in rare finds. A shovel (2 Kowens, 3 digs) returns ~2.2 on average. */
export const RARITY_CHANCE: Record<Rarity, number> = {
  junk: 0.6,
  common: 0.32,
  uncommon: 0.05,
  rare: 0.02,
  epic: 0.0075,
  mythical: 0.002,
  legendary: 0.0005,
  secret: 0, // 🤫 rolled separately (SECRET_CHANCE), never listed
};

export const RARITY_ORDER: Rarity[] = ['secret', 'legendary', 'mythical', 'epic', 'rare', 'uncommon', 'common', 'junk'];

export interface Item {
  id: string;
  name: string;
  emoji: string;
  value: number;
  rarity: Rarity;
  exclusive?: boolean; // one of the server's own items
  /** Out of the ground: not dug up any more (the CMS). */
  off?: boolean;
  /** Added in the CMS (not one of the items below). */
  custom?: boolean;
}

const item = (id: string, name: string, emoji: string, value: number, rarity: Rarity, exclusive = false): Item => ({
  id,
  name,
  emoji,
  value,
  rarity,
  exclusive,
});

const BUILT_IN: Item[] = [
  // ── Exclusive: the barangay's own treasures ──
  item('junwuu-socks', "Junwuu's Socks", '🧦', 1, 'uncommon', true),
  item('kei-cup', "Kei's Specimen Cup", '🧪', 1, 'uncommon', true),
  item('scrappy-milk', "Scrappy's Coconut Milk", '🥥', 3, 'uncommon', true),
  item('brother-j-letter', "Brother J's Love Letter", '💌', 3, 'uncommon', true),
  item('charlene-lipstick', "Charlene's Lipstick", '💄', 3, 'uncommon', true),
  item('fig-boxers', "Fig's Boxer Shorts", '🩲', 2, 'rare', true),
  item('pittu-book', "Pittu's Psych Book", '📘', 3, 'rare', true),
  item('kyuu-letter', "Kyuu's Apology Letter", '✉️', 4, 'rare', true),
  item('trot-shelf', "Trot's Magical Shelf", '🪄', 4, 'rare', true),
  item('hypercrade-wheels', "Hypercrade's Hot Wheels", '🏎️', 4, 'rare', true),
  item('hei-battery', "Hei's 20% Battery", '🪫', 5, 'epic', true),
  item('nami-plate', "Nami's Silver Plate", '🍽️', 6, 'epic', true),
  item('scel-burrito', "Scel's Burrito", '🌯', 6, 'epic', true),
  item('jord-fork', 'Fork of Jord', '🍴', 7, 'epic', true),
  item('nyaru-cardboard', "Nyaru's Cardboard", '📦', 7, 'epic', true),
  item('ushiik-keycaps', "ushiik's Keycaps", '⌨️', 7, 'epic', true),
  item('mikko-kalabasa', "Mikko's Golden Kalabasa", '🎃', 8, 'epic', true),
  item('aka-poknat', "Aka's Poknat", '✨', 10, 'mythical', true),
  item('troyangs-frog', "Troyangs' Golden Frog", '🐸', 20, 'mythical', true),
  item('twigo-treasure', "twigo's Hidden Treasure", '💰', 50, 'legendary', true),
  // 🤫 Never listed anywhere. 1 in 10,000 digs.
  item('twigo-tsinelas', "twigo's Lost Tsinelas (Signed)", '🩴', 100, 'secret', true),

  // ── Junk: the ground's leftovers ──
  item('rock', 'Rock', '🪨', 0, 'junk'),
  item('dirt', 'Clump of Dirt', '🟫', 0, 'junk'),
  item('plastic', 'Plastic Waste', '🛍️', 0, 'junk'),
  item('bottle-cap', 'Bottle Cap', '🔘', 0, 'junk'),
  item('rusty-nail', 'Rusty Nail', '📌', 0, 'junk'),
  item('chewed-gum', 'Chewed Gum (Vintage)', '🫧', 0, 'junk'),
  item('deflated-balloon', 'Deflated Birthday Balloon', '🎈', 0, 'junk'),
  item('broken-tsinelas', 'One Broken Tsinelas', '🩴', 0, 'junk'),
  item('expired-load', 'Expired Load Card', '📶', 0, 'junk'),
  item('losing-lotto', 'Losing Lotto Ticket', '🎫', 0, 'junk'),
  item('empty-sachet', 'Empty Shampoo Sachet', '🧴', 0, 'junk'),
  item('soggy-wrapper', 'Soggy Chichirya Wrapper', '🍟', 0, 'junk'),
  item('wet-mystery-sock', 'Mysteriously Wet Sock', '🧦', 0, 'junk'),
  item('half-pencil', 'Half a Pencil', '✏️', 1, 'junk'),
  item('tangled-earphones', 'Hopelessly Tangled Earphones', '🎧', 1, 'junk'),
  item('mystery-bone', 'Mystery Bone (Probably Chicken)', '🦴', 1, 'junk'),
  item('crossword', 'Unfinished Crossword', '📰', 1, 'junk'),

  // ── Common: someone's lost stuff ──
  item('spoon', 'Spoon', '🥄', 1, 'common'),
  item('bottle', 'Bottle', '🍾', 1, 'common'),
  item('piso', 'Lost Piso Coin', '🪙', 1, 'common'),
  item('single-earring', 'Single Earring', '💎', 1, 'common'),
  item('rubber-band', 'Lucky Rubber Band', '➰', 1, 'common'),
  item('bbq-stick', 'Barbecue Stick (Licked Clean)', '🍢', 1, 'common'),
  item('kalamansi', 'Lone Kalamansi', '🍋', 1, 'common'),
  item('ketchup-packet', 'Jollibee Ketchup Packet', '🍅', 1, 'common'),
  item('guitar-string', 'Broken Guitar String', '🎸', 1, 'common'),
  item('pandesal', 'Half-eaten Pandesal', '🥖', 1, 'common'),
  item('holen', 'Holen (Marble)', '🔮', 1, 'common'),
  item('tex-card', 'Tex Card', '🃏', 1, 'common'),
  item('chair-leg', 'Monobloc Chair Leg', '🪑', 1, 'common'),
  item('tabo', 'Tabo', '🪣', 2, 'common'),
  item('tupperware-lid', 'Tupperware Lid (No Container)', '🫙', 2, 'common'),
  item('walis-handle', 'Walis Tambo Handle', '🧹', 2, 'common'),
  item('walis-tingting', "Lola's Walis Ting-ting", '🌾', 2, 'common'),
  item('skyflakes', 'Pack of Skyflakes', '🍘', 2, 'common'),
  item('pancit-canton', 'Unopened Pancit Canton', '🍜', 2, 'common'),
  item('pogs', 'Pog Collection', '🥏', 2, 'common'),
  item('tv-remote', 'Remote Control (TV Unknown)', '📺', 2, 'common'),
  item('fan-blade', 'Electric Fan Blade', '🌀', 2, 'common'),
  item('sardines', 'Can of Sardines', '🐟', 2, 'common'),
  item('snake-stick', 'Stick That Looks Like a Snake', '🐍', 2, 'common'),
  item('blurry-dvd', 'Pirated DVD (Very Blurry)', '💿', 2, 'common'),
  item('jeepney-sign', 'Old Jeepney Signboard', '🚌', 3, 'common'),
  item('crushed-parol', 'Slightly Crushed Parol', '⭐', 3, 'common'),
  item('tito-shades', "Tito's Lost Sunglasses", '🕶️', 3, 'common'),
  item('hard-hat', 'Hard Hat', '⛑️', 3, 'common'),
  item('usb-drive', 'USB Drive (Do Not Open)', '💾', 3, 'common'),
  item('windup-robot', 'Wind-up Toy Robot', '🤖', 3, 'common'),
  item('karaoke-mic', 'Mini Karaoke Mic', '🎤', 4, 'common'),
  item('tamiya', 'Tamiya Race Car', '🏁', 4, 'common'),
  item('barong', 'Tattered Barong', '👔', 4, 'common'),
  item('tamagotchi', 'Tamagotchi (Still Alive!)', '🐣', 5, 'common'),
  item('nokia-3310', 'Nokia 3310 (Indestructible)', '📱', 5, 'common'),
];

/** The CMS's changes: edits to an item (by id), or a whole new item (`custom`). */
export type ItemChange = Partial<Omit<Item, 'id'>>;

const KEY = 'dig-items';
const changes = kvLoad<Record<string, ItemChange>>(KEY, {});

/** Every item there is now, and by id (refilled in place, so every importer sees changes). */
export const ITEMS: Item[] = [];
export const ITEM_BY_ID = new Map<string, Item>();
const listeners: (() => void)[] = [];
/** Called after every change (e.g. /gift item's list). */
export const onItemsChange = (fn: () => void) => void listeners.push(fn);

function refill(): void {
  const builtIn = BUILT_IN.map((i) => ({ ...i, ...changes[i.id], id: i.id }));
  const added = Object.entries(changes)
    .filter(([id, c]) => c.custom && !BUILT_IN.some((i) => i.id === id))
    .map(([id, c]) => ({ id, name: id, emoji: '❔', value: 0, rarity: 'junk' as Rarity, ...c }));
  ITEMS.splice(0, ITEMS.length, ...builtIn, ...added);
  ITEM_BY_ID.clear();
  for (const i of ITEMS) ITEM_BY_ID.set(i.id, i);
  for (const fn of listeners) fn();
}
refill();

export const isBuiltIn = (id: string) => BUILT_IN.some((i) => i.id === id);
export const defaultItem = (id: string): Item | null => BUILT_IN.find((i) => i.id === id) ?? null;

/** The rarities a dig can land on (chance above 0): each needs at least one item in the ground. */
const needed = (Object.entries(RARITY_CHANCE) as [Rarity, number][]).filter(([, c]) => c > 0).map(([r]) => r);

/** Changes an item, or adds one (a new id). Why not, if it can't be done. */
export function setDigItem(id: string, item: Omit<Item, 'id' | 'exclusive' | 'custom'>): 'ok' | 'last-of-rarity' {
  const was = ITEM_BY_ID.get(id);
  // Every rarity a dig can land on keeps something to find.
  if (was && !was.off && (item.off || item.rarity !== was.rarity) && needed.includes(was.rarity) && pool(was.rarity).length === 1) return 'last-of-rarity';
  const base = defaultItem(id);
  if (base) {
    const change: ItemChange = {};
    for (const k of ['name', 'emoji', 'value', 'rarity'] as const) if (item[k] !== base[k]) (change as Record<string, unknown>)[k] = item[k];
    if (item.off) change.off = true;
    if (Object.keys(change).length) changes[id] = change;
    else delete changes[id];
  } else changes[id] = { name: item.name, emoji: item.emoji, value: item.value, rarity: item.rarity, ...(item.off ? { off: true } : {}), custom: true };
  kvSave(KEY, changes);
  refill();
  return 'ok';
}

/** The items of a rarity still in the ground. */
const pool = (rarity: Rarity) => ITEMS.filter((i) => i.rarity === rarity && !i.off);
const weight = (i: Item) => 1 / (i.value + 1) ** 2;

/** Rolls one dig: a rarity by RARITY_CHANCE, then an item weighted toward cheaper ones. */
export const SECRET_CHANCE = 0.0001;

/** Each item's chance on a plain dig (no potion, not the lucky dig), for the CMS. */
export function itemChances(): Map<string, number> {
  const out = new Map<string, number>();
  const secret = pool('secret').length ? SECRET_CHANCE : 0;
  for (const r of Object.keys(RARITY) as Rarity[]) {
    const items = pool(r);
    const total = items.reduce((n, i) => n + weight(i), 0);
    const chance = r === 'secret' ? secret : (1 - secret) * RARITY_CHANCE[r];
    for (const i of items) out.set(i.id, (chance * weight(i)) / total);
  }
  return out;
}

export function rollItem(random = Math.random): Item {
  if (random() < SECRET_CHANCE && pool('secret').length) return rollOfRarity('secret', random); // 🤫
  let r = random();
  let rarity: Rarity = 'junk';
  for (const [key, chance] of Object.entries(RARITY_CHANCE) as [Rarity, number][]) {
    if ((r -= chance) < 0) {
      rarity = key;
      break;
    }
  }
  return rollOfRarity(rarity, random);
}

/** An item of the given rarity, cheaper ones more likely. */
export function rollOfRarity(rarity: Rarity, random = Math.random): Item {
  const items = pool(rarity);
  let w = random() * items.reduce((n, i) => n + weight(i), 0);
  return items.find((i) => (w -= weight(i)) < 0) ?? items[items.length - 1];
}

/** The server-wide lucky dig (every LUCKY_EVERY digs) is guaranteed Epic or better. */
export const LUCKY_ODDS: [Rarity, number][] = [
  ['epic', 0.75],
  ['mythical', 0.2],
  ['legendary', 0.05],
];
export function rollLucky(random = Math.random): Item {
  let r = random();
  const rarity = LUCKY_ODDS.find(([, chance]) => (r -= chance) < 0)?.[0] ?? 'epic';
  return rollOfRarity(rarity, random);
}
