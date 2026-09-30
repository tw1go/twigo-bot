// Everything /dig can turn up. `value` is what /sell pays, in Kowens.
// A dig first rolls a rarity (RARITY_CHANCE), then an item of that rarity — cheaper items come up much more often.

export type Rarity = 'junk' | 'common' | 'uncommon' | 'rare' | 'epic' | 'mythical' | 'legendary';

export const RARITY: Record<Rarity, { label: string; emoji: string }> = {
  junk: { label: 'Junk', emoji: '⚫' },
  common: { label: 'Common', emoji: '⚪' },
  uncommon: { label: 'Uncommon', emoji: '🟢' },
  rare: { label: 'Rare', emoji: '🔵' },
  epic: { label: 'Epic', emoji: '🟣' },
  mythical: { label: 'Mythical', emoji: '🟠' },
  legendary: { label: 'Legendary', emoji: '🟡' },
};

/** Chance of each rarity per dig (sums to 1). Tuned so a dig is worth ~0.6 Kowens on average: mostly junk
 *  and laughs, with the value in rare finds. At 3 digs/day that's only ~+1.3 Kowens/day after the shovel. */
export const RARITY_CHANCE: Record<Rarity, number> = {
  junk: 0.7,
  common: 0.22,
  uncommon: 0.05,
  rare: 0.02,
  epic: 0.0075,
  mythical: 0.002,
  legendary: 0.0005,
};

export const RARITY_ORDER: Rarity[] = ['legendary', 'mythical', 'epic', 'rare', 'uncommon', 'common', 'junk'];

export interface Item {
  id: string;
  name: string;
  emoji: string;
  value: number;
  rarity: Rarity;
  exclusive?: boolean; // one of the server's own items
}

const item = (id: string, name: string, emoji: string, value: number, rarity: Rarity, exclusive = false): Item => ({
  id,
  name,
  emoji,
  value,
  rarity,
  exclusive,
});

export const ITEMS: Item[] = [
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

export const ITEM_BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

/** Rolls one dig: a rarity by RARITY_CHANCE, then an item weighted toward cheaper ones. */
export function rollItem(random = Math.random): Item {
  let r = random();
  let rarity: Rarity = 'junk';
  for (const [key, chance] of Object.entries(RARITY_CHANCE) as [Rarity, number][]) {
    if ((r -= chance) < 0) {
      rarity = key;
      break;
    }
  }
  const pool = ITEMS.filter((i) => i.rarity === rarity);
  const weight = (i: Item) => 1 / (i.value + 1) ** 2;
  let w = random() * pool.reduce((n, i) => n + weight(i), 0);
  return pool.find((i) => (w -= weight(i)) < 0) ?? pool[pool.length - 1];
}
