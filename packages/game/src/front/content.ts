import type { Outfit } from '../characters/doll';

// 📝 Everything the front page says, and which classes, mobs and features it shows. Edit the words here; the layout is
// in render.ts and front.css. `{name}` tokens are filled from the game's own data when the page is built (facts.ts:
// levels, stat pairs, skill levels, counts), so the numbers always match the game. Each class's `look` is the outfit it
// wears on its card (the paper doll's keys: manifest characters.wardrobe, colourPresets, skinTones).

export const content = {
  head: {
    title: 'Mikazuki | twigo',
    description: 'A cosy night-time pixel town. Hang out with friends, then grab a slingshot and clear the Slums.',
    url: 'https://twigo.dev/',
    image: 'https://twigo.dev/play/og-image.png',
    imageAlt: 'MIKAZUKI over the night-time pixel town: close beta open at twigo.dev',
  },

  nav: {
    brand: 'MIKAZUKI',
    links: [
      { href: '#classes', label: 'Classes' },
      { href: '#slums', label: 'The Slums' },
      { href: '#boss', label: 'Field boss' },
      { href: '#warrens', label: 'Dungeon' },
      { href: '#town', label: 'Town life' },
    ],
    play: 'Play',
  },

  hero: {
    badge: 'Close beta',
    title: 'MIKAZUKI',
    tagline: 'A cosy night-time pixel town. Hang out with friends, then grab a slingshot and clear the Slums.',
    apply: 'Apply to close beta',
    play: 'Play',
    madeBy: 'a game made by',
  },

  about: {
    eyebrow: 'What is Mikazuki',
    title: 'A town that stays up late',
    lede: 'Mikazuki is a multiplayer town you play in the browser. Walk the plaza under the lamps, dress your character, play a round in the Arena, and when you are ready, head out to the Slums where the junk has come alive.',
    pillars: [
      { title: 'Hang out', text: 'Chat, wave and sit by the fountain. Dress up at the Parlor and build a house of your own.' },
      { title: 'Fight the junk', text: 'Choose one of 6 classes, level to 20 with the Tanod’s quests, and hunt rare loot with blue and orange affixes.' },
      { title: 'Play the town', text: 'Jack en poy in the Arena, flip coins at Kara y Krus, and break into a neighbour’s house to steal from it.' },
    ],
  },

  classes: {
    eyebrow: '6 classes',
    title: 'Pick what is in your hands',
    lede: 'Every class fights with something from home. Each one gets {skillCount} damage skills, a Dash at Lv {dashLevel} and its own move at Lv {moveLevel}, plus buffs to keep the party going.',
    list: [
      {
        id: 'slingshot',
        role: 'Ranged, physical',
        line: 'Thin fast shots that land with a big hit. Stay back and pick targets off.',
        skills: [
          { name: 'Quick Shot', note: 'fast single pebble' },
          { name: 'Ricochet', note: 'bounces to two more' },
          { name: 'Volley', note: 'rain of pebbles' },
        ],
        look: { skin: 'tan', hair: 'ponytail', hairColour: 'brown', top: 'tshirt', topColour: 'green', topTrim: 'cream', bottom: 'shorts', bottomColour: 'blue', bottomTrim: 'blue', shoes: 'sneakers', shoesColour: 'cream', hat: 'cap', hatColour: 'gold' },
      },
      {
        id: 'stick',
        role: 'Melee, physical',
        line: 'Arnis-style stick held two-handed. Quick strikes, spins and flurries.',
        skills: [
          { name: 'Twin Strike', note: 'two quick hits' },
          { name: 'Flurry', note: 'five rapid hits' },
          { name: 'Spinning Stick', note: 'spin around you' },
        ],
        look: { skin: 'brown', hair: 'mohawk', hairColour: 'stone', top: 'tunic', topColour: 'magenta', topTrim: 'gold', bottom: 'pants', bottomColour: 'stone', bottomTrim: 'stone', shoes: 'boots', shoesColour: 'brown' },
      },
      {
        id: 'greatstick',
        role: 'Heavy melee, physical',
        line: 'A big plank swung in wide, slow arcs. Hits hard and hits everything in front.',
        skills: [
          { name: 'Wide Swing', note: 'big front arc' },
          { name: 'Ground Pound', note: 'area hit' },
          { name: 'Plank Toss', note: 'thrown at range' },
        ],
        look: { skin: 'deep', hair: 'crop', hairColour: 'brown', top: 'jacket', topColour: 'blue', topTrim: 'stone', bottom: 'cargo', bottomColour: 'brown', bottomTrim: 'brown', shoes: 'hightops', shoesColour: 'stone' },
      },
      {
        id: 'broom',
        role: 'Ranged caster, magic',
        line: 'A walis tingting that sweeps up dust devils, leaf darts and sparks.',
        skills: [
          { name: 'Leaf Dart', note: 'quick leaf bolt' },
          { name: 'Dust Devil', note: 'moving whirlwind' },
          { name: 'Ember Leaves', note: 'burning leaves' },
        ],
        look: { skin: 'light', hair: 'long', hairColour: 'violet', top: 'longsleeve', topColour: 'violet', topTrim: 'gold', bottom: 'skirt', bottomColour: 'magenta', bottomTrim: 'violet', shoes: 'boots', shoesColour: 'cream', glasses: 'round', glassesColour: 'stone' },
      },
      {
        id: 'potlid',
        role: 'Tank, magic',
        line: 'Lid in one hand, ladle in the other. The clang pulls every mob onto you.',
        skills: [
          { name: 'Clang', note: 'sound wave around you' },
          { name: 'Lid Toss', note: 'comes back to you' },
          { name: 'Steam Burst', note: 'steam explosion' },
        ],
        look: { skin: 'tan', hair: 'buns', hairColour: 'gold', top: 'polo', topColour: 'cream', topTrim: 'blue', bottom: 'pants', bottomColour: 'blue', bottomTrim: 'blue', shoes: 'sneakers', shoesColour: 'green', hat: 'beanie', hatColour: 'magenta' },
      },
      {
        id: 'hilot',
        role: 'Melee healer, magic',
        line: 'Open-palm strikes, rub-on heals and a floating balm that buffs the party.',
        skills: [
          { name: 'Menthol Flick', note: 'fast flick' },
          { name: 'Root Snare', note: 'roots the enemy' },
          { name: 'Camphor Cloud', note: 'lingering cloud' },
        ],
        look: { skin: 'light', hair: 'sidepart', hairColour: 'cream', top: 'striped', topColour: 'green', topTrim: 'cream', bottom: 'shorts', bottomColour: 'green', bottomTrim: 'cream', shoes: 'sneakers', shoesColour: 'stone', glasses: 'shades', glassesColour: 'stone' },
      },
    ] satisfies { id: string; role: string; line: string; skills: { name: string; note: string }[]; look: Outfit }[],
  },

  slums: {
    eyebrow: 'First map: the Slums',
    title: 'The junk came alive',
    lede: 'The people of the Slums are friendly. Their rubbish is not. Six kinds of junk roam the alleys, each with its own fixed level and its own way of fighting.',
    /** `variant`: which colour of it (manifest mobs.<id>.variants); `scale`: whole-number size on its card. */
    mobs: [
      { id: 'tin-can', name: 'Tin Can', variant: '', scale: 3, text: 'Hops about minding its own business, until you hit it. Then it snaps its jagged lid.' },
      { id: 'bottle-caps', name: 'Bottle Caps', variant: 'red', scale: 3, text: 'Roll in packs of 3 to 5. Hit one and the whole pack comes for you.' },
      { id: 'tire-roller', name: 'Tire Roller', variant: 'yellow', scale: 2, text: 'Comes for you on sight and lunges in with a charge.' },
      { id: 'plastic-bag-spook', name: 'Plastic Bag Spook', variant: 'white', scale: 2, text: 'Drifts close and wraps you in a slow.' },
      { id: 'wire-tangle', name: 'Wire Tangle', variant: '', scale: 1, text: 'Spots you from 4 tiles away and zaps from a distance.' },
      { id: 'scrap-crab', name: 'Scrap Crab', variant: 'rust', scale: 2, text: 'Its shell blocks every hit, except right after it swings. Time your attacks.' },
    ],
  },

  boss: {
    eyebrow: 'Field boss',
    id: 'scrapheap-golem',
    scale: 2,
    facts: [
      { term: 'Rises', text: 'In its pit in the Slums, {golemHours} hours after it was last beaten. The Slums get a warning {golemWarn} minutes before.' },
      { term: 'Made of', text: 'Tire fists, a body of rusty roofing sheets, a tarp cape and a street lamp for a head.' },
      { term: 'Loot', text: 'Everyone who deals 5% of its HP gets a drop of their own.' },
    ],
    moves: [
      { name: 'Tire Slam' },
      { name: 'Scrap Toss' },
      { name: 'Lamp Glare' },
      { name: 'Junk Drop' },
      { name: 'Shockwave' },
      { name: 'Call the Junk' },
      { name: 'Enrage at 25%', enrage: true },
    ],
  },

  dungeon: {
    eyebrow: 'Dungeon',
    title: 'The Scrap Warrens',
    lede: 'Under the Slums is a maze for you and up to {partyFriends} friends. Each area is sealed until its mini boss falls, and at the very bottom something enormous is waiting.',
    gate: 'Enter through the Warren Gate near the golem pit from <b>Lv {dungeonLevel}</b>. One Warren Ticket opens a {dungeonMinutes}-minute run for the whole party.',
    titan: {
      eyebrow: 'Last boss',
      text: 'A shack-built giant rising out of a junk heap. It rains roof sheets, slams its fists and calls Scraplings to its side.',
    },
  },

  town: {
    eyebrow: 'Town life',
    title: 'More to do between fights',
    /** `live`: in the game now (a green tag); false: a grey "Coming soon". */
    features: [
      { tag: 'Quests', title: 'The Tanod’s rounds', text: '{questCount} leveling quests from Lv 1 to {questTop}, and {miniBosses} named mini bosses to hunt.', live: true },
      { tag: 'Loot', title: 'Gear worth chasing', text: 'Blue and orange affixes, agimat slots, and enhancement up to +20 with weapon auras.', live: true },
      { tag: 'Party', title: 'Party up and trade', text: 'Parties of up to 6 share XP and Kusing. Trade gear and Kusing with other players.', live: true },
      { tag: 'Minigame', title: 'Jack en poy Arena', text: 'Bato, papel, gunting. First to two wins, against a bot or a real player, for Kowens.', live: true },
      { tag: 'Minigame', title: 'Kara y Krus', text: 'Call heads or tails on the gold coin and test your luck. Watch out for the Tanod.', live: true },
      { tag: 'Heist', title: 'Bakod heist', text: 'Sneak into a neighbour’s house and try to pocket a few percent of their Kowens. Get caught (it happens more often than not) and you pay them a fine and cool off in jail. A Bakod keeps thieves out: rust it with a Kalawang Potion, or gamble a Master Key on its lock.', live: true },
      { tag: 'Style', title: 'Dress up', text: 'Paper-doll outfits: {skins} skin tones, {hairs} hairstyles, hats, glasses, tops, bottoms and shoes. Restyle any time at the Parlor.', live: true },
      { tag: 'Housing', title: 'Houses and the Parlor', text: 'Build a house on your own street and give it a new look whenever you like. Wear your titles at the Parlor. Put up a Bakod, because other players can break in.', live: true },
    ],
    soon: 'Coming soon',
  },

  closing: {
    title: 'The lamps are on',
    lede: 'Close beta spots open in waves. Apply now and we will message you on Discord when yours is ready.',
  },

  footer: {
    credit: 'Mikazuki is a game by twigo. Town music “happy tune” by syncopika (CC-BY 3.0).',
    top: 'Back to top',
  },

  apply: {
    title: 'Apply to close beta',
    lede: 'Tell us who you are on Discord. We will send your invite there.',
    username: 'Discord username',
    usernameHint: 'We’ll contact you on Discord.',
    usernamePlaceholder: 'moonwalker',
    cls: 'Which class would you main?',
    notSure: 'Not sure yet',
    note: 'Anything you want us to know?',
    notePlaceholder: 'Optional',
    smallPrint: 'You must be in the Mikazuki Discord server to get an invite.',
    cancel: 'Cancel',
    send: 'Send application',
    sending: 'Sending…',
    doneTitle: 'Application sent',
    doneText: 'We will message you on Discord when your spot opens. Meanwhile, the town is open.',
    doneUpdated: 'We updated your application. We will message you on Discord when your spot opens.',
    close: 'Close',
    play: 'Play',
    offline: 'Couldn’t reach the server. Check your connection and try again.',
  },
};

export type Content = typeof content;
