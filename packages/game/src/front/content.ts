import type { Outfit } from '../characters/doll.ts';

// 📝 Everything the front page says, and which classes, mobs and features it shows. Edit the words here; the layout is
// in render.ts and front.css. `{name}` tokens are filled from the game's own data when the page is built (facts.ts:
// levels, stat pairs, skill levels, counts), so the numbers always match the game. Each class's `look` is the outfit it
// wears on its card (the paper doll's keys: manifest characters.wardrobe, colourPresets, skinTones).

export const content = {
  head: {
    title: 'Mikazuki | twigo',
    description: 'A cosy night-time pixel town. Hang out with friends, then grab a slingshot and clear the Slums and the Old Market.',
    url: 'https://twigo.dev/',
    image: 'https://twigo.dev/play/mikazuki-og-1200x630.png',
    imageAlt: 'The Mikazuki logo over the night-time pixel town',
  },

  nav: {
    brand: 'MIKAZUKI',
    links: [
      { href: '#classes', label: 'Classes' },
      { href: '#maps', label: 'The maps' },
      { href: '#warrens', label: 'Dungeons' },
      { href: '#town', label: 'Town life' },
      { href: '#get', label: 'Get the game' },
    ],
    play: 'Play',
  },

  hero: {
    badge: 'Close beta',
    /** The logo's alt text (the hero shows the logo: render.ts). */
    title: 'Mikazuki',
    tagline: 'A cosy night-time pixel town. Hang out with friends, then grab a slingshot and clear the Slums and the Old Market.',
    apply: 'Apply to close beta',
    play: 'Play',
    madeBy: 'a game made by',
  },

  /** The Play buttons by device (main.ts: the hero's, the closing call's and the sent dialog's; the nav's stays Play). The
   *  downloads come from /downloads/latest.json: without it, or without this system's file, the plain Play button. */
  devices: {
    windows: 'Download for Windows',
    mac: 'Download for Mac',
    otherMac: 'Mac? Download here',
    otherWindows: 'Windows? Download here',
    browser: 'or play in your browser',
    phone: 'Add it to your home screen to play full screen',
  },

  /** The "Get the game" section, just before the closing call. */
  get: {
    eyebrow: 'Get the game',
    title: 'Play it your way',
    soon: 'Coming soon',
    windows: { name: 'Windows', button: 'Download for Windows', note: 'Windows may say it protected your PC. Click More info, then Run anyway.' },
    mac: { name: 'Mac', button: 'Download for Mac', note: 'The first time, open System Settings, then Privacy & Security, and click Open Anyway.' },
    phone: { name: 'Phone', text: 'Open twigo.dev/play on your phone. On Android, tap Install. On iPhone, tap Share, then Add to Home Screen.', button: 'Play' },
  },

  about: {
    eyebrow: 'What is Mikazuki',
    title: 'A town that stays up late',
    lede: 'Mikazuki is a multiplayer town you can play on your computer or your phone. Walk the plaza under the lamps, dress your character, play a round in the Arena, and when you are ready, head out to the Slums where the junk has come alive, then on to the Old Market, where the wares have too.',
    pillars: [
      { title: 'Hang out', text: 'Chat, wave and sit by the fountain. Dress up at the Parlor and build a house of your own.' },
      { title: 'Fight the junk', text: 'Choose one of 6 classes, level to {levelCap} through two maps of quests, and hunt rare loot with blue and orange affixes.' },
      { title: 'Play the town', text: 'Jack en poy in the Arena, flip coins at Kara y Krus, and turn rogue and break into a neighbour’s house.' },
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

  /** Every map in one section: what they're like, a few of their mobs and field bosses as a taste (never the full list:
   *  more keep coming), so the page doesn't grow with each one. `scale`: whole-number; sprites cropped to their art
   *  (scripts/front-page.ts). */
  maps: {
    eyebrow: 'The maps',
    title: 'The junk came alive',
    lede: 'Step out of town and the trouble starts. Every map has its own kinds of mob, each at its own level with its own trick: packs that come for you together, shells that block, umbrellas that shield, tubs that hide in the floodwater. Lv 1 to {levelCap} so far.',
    points: [
      { title: 'Every mob has a trick', text: 'Learn when its guard drops, where its tears land and how far it throws, and the fight gets easier.' },
      { title: 'Named mini bosses', text: '{miniBosses} of them roam the maps, bigger and tougher than their kind, with better loot.' },
      { title: 'Field bosses', text: 'Each map has one that wakes every few hours for everyone there. Deal 5% of its HP and a drop is yours.' },
    ],
    mobs: [
      { id: 'tin-can', name: 'Tin Can', variant: '', scale: 3, text: 'Minds its own business, until you hit it. Then it snaps its jagged lid.' },
      { id: 'scrap-crab', name: 'Scrap Crab', variant: 'rust', scale: 3, text: 'Its shell blocks every hit, except right after it swings.' },
      { id: 'monobloc-stack', name: 'Monobloc Stack', variant: 'green', scale: 2, text: 'Throws plastic chairs from across the room. Keep moving and they miss.' },
      { id: 'banyera-lurker', name: 'Banyera Lurker', variant: 'armour', scale: 2, text: 'Lies under the floodwater, unseen, until you wade too close.' },
    ],
    bosses: [
      { mob: 'scrapheap-golem', dir: 'se', scale: 3, caption: 'A golem of tires and roofing sheets, in the Slums' },
      { mob: 'great-scale', dir: 'se', scale: 3, caption: 'A weighing scale the size of a stall, in the Old Market' },
    ],
    more: 'More maps are on the way.',
  },


  /** Every dungeon in one section: what they're like, a couple of what's waiting at the bottom as a taste (never the
   *  full list: more keep coming), so the page doesn't grow with each one. */
  dungeon: {
    eyebrow: 'Dungeons',
    title: 'Go below',
    lede: 'Under the maps are dungeons for you and up to {partyFriends} friends. A ticket or a key opens a timed run for the whole party: each area is sealed until its mini boss falls, and something enormous waits at the bottom.',
    points: [
      { title: 'Party up', text: 'Up to {partyMax} in a run, and the mobs grow tougher with every one of you.' },
      { title: 'Sealed areas', text: 'Each area stays shut until its mini boss falls, and every boss has moves to read and dodge.' },
      { title: 'Worth the trip', text: 'Better gear than up top, and loot rolled for the whole party.' },
    ],
    /** A taste of what waits at the bottom (scripts/front-page.ts crops their art; `scale`: whole-number, about the same size). */
    bosses: [
      { mob: 'barong-barong', dir: 's', scale: 1, caption: 'A shack-built giant, under the Slums' },
      { mob: 'makinang-yelo', dir: 'sw', scale: 2, caption: 'A frozen machine, under the Old Market' },
    ],
    more: 'More dungeons are being dug.',
  },



  town: {
    eyebrow: 'Town life',
    title: 'More to do between fights',
    /** `live`: in the game now (a green tag); false: a grey "Coming soon". */
    features: [
      { tag: 'Quests', title: 'Two stories', text: 'The Tanod’s {questCount} quests take you to Lv {questTop}; the Old Market’s story, The Last Regular, carries on to {levelCap}. {miniBosses} named mini bosses to hunt.', live: true },
      { tag: 'Loot', title: 'Gear worth chasing', text: 'Blue and orange affixes, agimat slots, and enhancement up to +20 with weapon auras.', live: true },
      { tag: 'Party', title: 'Party up and trade', text: 'Parties of up to 6 share XP and Kusing. Trade gear and Kusing with other players.', live: true },
      { tag: 'Minigame', title: 'Jack en poy Arena', text: 'Bato, papel, gunting. First to two wins, against a bot or a real player, for Kowens.', live: true },
      { tag: 'Minigame', title: 'Kara y Krus', text: 'Call heads or tails on the gold coin and test your luck. Watch out for the Tanod.', live: true },
      { tag: 'Heist', title: 'Bakod heist', text: 'Turn rogue, sneak into a neighbour’s house and try to pocket a few percent of their Kowens. Get caught (it happens more often than not) and you pay them a fine and cool off in jail. Once you steal, other rogues can rob you back, and a house that’s been robbed is safe. A Bakod keeps rogues out: rust it with a Kalawang Potion, or gamble a Master Key on its lock.', live: true },
      { tag: 'Style', title: 'Dress up', text: 'Paper-doll outfits: {skins} skin tones, {hairs} hairstyles, hats, glasses, tops, bottoms and shoes. Restyle any time at the Parlor.', live: true },
      { tag: 'Housing', title: 'Houses and the Parlor', text: 'Build a house on your own street and give it a new look whenever you like. Wear your titles at the Parlor. Put up a Bakod, because rogues can break in.', live: true },
      { tag: 'Pets', title: 'A pet at your heels', text: '{petCount} pets to raise. Each one follows you everywhere, levels up as you fight and grows its own stat tree.', live: true },
      { tag: 'Style', title: 'Costume sets', text: 'Five costume sets in the sari-sari store, from bat wings to imp horns, worn over your gear in town and in every combat pose.', live: true },
      { tag: 'Food', title: 'Aling Conching’s cooking', text: 'Lugaw, pancit and more from the one stall still open. Each dish is a buff that lasts through every map.', live: true },
      { tag: 'Travel', title: 'Lantern Posts', text: 'Light a Return Lantern at a post to cross between the town, the Slums and the Old Market in a flash.', live: true },
      { tag: 'Friends', title: 'Friends and mail', text: 'Add friends, whisper, and choose who sees your balance. Letters in your mailbox can carry gifts.', live: true },
      { tag: 'Event', title: 'Halloween in Mikazuki', text: 'Find Mikko Kalabasa hiding round town, beat the giant Biikko in the Slums and reunite the Manananggal, until {halloweenEnds}.', live: true, event: 'halloween' },
    ] as { tag: string; title: string; text: string; live: boolean; event?: string }[],
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
