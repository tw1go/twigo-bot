import { markdown } from './news';
import { el, showPopup } from './reward';
import { keys, mouse, panel } from './tutorial';

// 📘 The tutorial (the "?" beside News and Settings; toggles): a tab per feature down the left (a scrolling row on
// phones), what it is and how to use it on the right, in the news board's markdown. The numbers are the bot's rules
// (games/*.ts, dig/store.ts, loans/loans.ts…); prices the CMS can change are left out. The last tab seen is kept in
// localStorage `mk_guide_tab`. Moving opens with the first-visit tutorial's pictures (ui/tutorial.ts).

interface Topic {
  id: string;
  icon: string;
  label: string;
  text: string;
}

const TOPICS: Topic[] = [
  {
    id: 'move',
    icon: '🚶',
    label: 'Moving',
    text: [
      '• **W A S D** or the **arrow keys** walk (a tap from standing only turns you)',
      '• **Right click** a spot to walk there; on a phone, **tap** it',
      '• **Left click** a building to go in, or a bench to sit; **E** or **Space** does it at a door',
      '• **Drag** the map to peek around; it snaps back when you let go',
      '• The **minimap** (top right) shows the whole town: you in gold, everyone else in green',
      '• Hover a building to see its name',
    ].join('\n'),
  },
  {
    id: 'chat',
    icon: '💬',
    label: 'Chat & emotes',
    text: [
      '• **Enter** opens the chat; Enter again sends. Esc or a click outside closes it',
      '• The chat is linked to Discord: lines from there show with the Discord mark',
      '• **Megaphone** (bought at the rewards shop): `/m your message` shouts it across the whole screen for everyone; `/g` goes back to General',
      '• **Emotes**: the face button beside the chat, or keys **1–8**',
      '• **N online** beside the chat lists who is in town',
      '• Click a name in the chat to open that player’s menu',
      '-# Be kind: mods can mute, kick and filter words.',
    ].join('\n'),
  },
  {
    id: 'kowens',
    icon: '🪙',
    label: 'Kowens',
    text: [
      'Kowens are the server’s money, the same ones as in Discord. Yours show top left.',
      '',
      '**Ways to earn**',
      '• **Daily Kowens**: **5 a day**. Claim them in town (the gold line bottom right) or with `/get-kowens` in Discord',
      '• **Stay in town**: a Kowen every **15 minutes**, up to **20 a day**. Press **Claim** when the pop-up shows',
      '• **Voice chat** in Discord: up to **12 a day**',
      '• Dig up items at the **Mine** and sell them',
      '• Win at the **Casino**, the **Arena** or the **jackpot**',
      '• Finish quests on the **notice board**',
      '',
      '**Ways to spend**: the rewards shop, the Parlor, jackpot tickets, shovels, bets.',
      '-# The "+" beside your Kowens and shovels explains them too.',
    ].join('\n'),
  },
  {
    id: 'players',
    icon: '👥',
    label: 'Players',
    text: [
      'Left click (or tap) another player to open their menu:',
      '• **Give Kowens** (up to 20 a day)',
      '• **Balance** and **Status**: how they’re doing',
      '• **Diss**, **Praise** or **Judge**: 1 Kowen; your character says it out loud',
    ].join('\n'),
  },
  {
    id: 'mine',
    icon: '⛏️',
    label: 'Mine',
    text: [
      'Left click the **Mine** and press **Dig**.',
      '• Up to **9 digs a day**. A shovel lasts **3 digs**; buy a new one at the Mine (up to 3 a day)',
      '• Finds go from Common to Legendary (and a few secrets 🤫). **📜 Items** lists them all, with their odds and what they sell for',
      '• **Lucky dig**: every 60th dig on the server is Epic or better. The bar shows how close it is',
      '• What you dig up goes to your **bag**',
    ].join('\n'),
  },
  {
    id: 'bag',
    icon: '🎒',
    label: 'Bag',
    text: [
      'The bag button beside the chat (or **B**).',
      '• Dug-up items: **Sell** for Kowens or **Flex** to show off in Discord',
      '• Select many (Ctrl/⌘/Shift click, or the **Select** toggle) and **Sell selected**',
      '• Master Keys and potions live here too',
      '• Slots marked X are locked; bigger bags are at the rewards shop',
    ].join('\n'),
  },
  {
    id: 'casino',
    icon: '🎰',
    label: 'Casino',
    text: [
      'Left click the **Casino** for **Kara y Krus**: bet, pick a side, flip.',
      '• **45%** to win double, otherwise the bet is lost',
      '• 🚨 **Raids**: the Tanod raids **3%** of tables. Your bet is taken (most of it goes into the jackpot pot) and you spend **5 minutes** in jail',
      '-# Bet what you can lose, citizen.',
    ].join('\n'),
  },
  {
    id: 'jackpot',
    icon: '🎟️',
    label: 'Jackpot',
    text: [
      'Left click the **jackpot booth**, or the **Jackpot draw** counter top right.',
      '• Tickets are **1 Kowen** each, up to **5** per draw',
      '• Draws at **10 AM** and **10 PM** (Manila time); one ticket wins the whole pot',
      '• Casino raid money is added to the pot',
    ].join('\n'),
  },
  {
    id: 'arena',
    icon: '✊',
    label: 'Arena',
    text: [
      'Left click the **Arena** for **jack en poy** (rock, paper, scissors).',
      '• **Vs Bot**, or **Vs Player**: you join a queue and can walk around until a match is found',
      '• Pick a hand with keys **1–3** within 10 seconds. First to **2** wins; draws replay',
      '• Every match is for Kowens (**1–100**). Vs a player the stake is the smaller of both bets and the winner takes both',
      '• Leaving mid-match gives the other player the win',
    ].join('\n'),
  },
  {
    id: 'bank',
    icon: '🏦',
    label: 'Bank',
    text: [
      'Left click the **bank**.',
      '• **Vault**: keeps Kowens safe from thieves (up to **30%** of what you have). Unlock it at the rewards shop',
      '• **Loan**: borrow from the Tanod Bank (from **20** up to **100** Kowens as you repay on time), **10%** interest, due in **3 days**',
      '• Late loans get fees, then half of what you earn goes to the debt, and then jail',
    ].join('\n'),
  },
  {
    id: 'shop',
    icon: '🎁',
    label: 'Shop & Parlor',
    text: [
      '**Rewards shop**: items (megaphones, Master Keys), potions, bigger bags and passes. Click an item, pick how many, buy.',
      '',
      '**Parlor** (north of the shop):',
      '• **Appearance**: a new look for your character, **3 Kowens**',
      '• **Title**: choose which of your titles shows under your name (free). Hover a title to read about it',
      '-# The leaderboard’s #1 gets <Richest Among All> automatically.',
    ].join('\n'),
  },
  {
    id: 'board',
    icon: '📜',
    label: 'Quests',
    text: [
      'Left click the **notice board**.',
      '• **Accept** someone’s quest, do it, and they press **Complete** to pay you',
      '• **Post a quest**: describe the task and the reward (up to **100** Kowens). The reward is held until you complete or cancel it',
      '• Up to **3** open quests at a time',
    ].join('\n'),
  },
  {
    id: 'hood',
    icon: '🏘️',
    label: 'Neighbourhood',
    text: [
      'Follow the road to the **bridge** over the river (**Neighbourhood →**).',
      '• Your first house is **free**: pick a house and its colours. A new look later is **3 Kowens**',
      '• Next visit you start at your own door',
      '• **Steal**: click someone’s house. **35%** to take 2–5% of their Kowens; caught = a fine and **5 minutes** in jail. Once an hour',
      '• **Bakod**: a fence that keeps thieves out (rewards shop). Only a **Master Key** gets past it (**50%** it snaps), or a **Kalawang Potion** rusts half of it away',
    ].join('\n'),
  },
  {
    id: 'jail',
    icon: '🚔',
    label: 'Jail & Tanod',
    text: [
      'Caught by the Tanod (a casino raid, a robbery gone wrong, unpaid loans): you show behind bars.',
      '• In jail: no games, no stealing, no diss/praise/judge',
      '• **Bail** at the **Tanod outpost**: pay to get out early (yourself or a friend). Admin sentences can’t be bailed',
      '• The outpost’s **Patrol** tab has the rules and whether roll is being called',
    ].join('\n'),
  },
  {
    id: 'more',
    icon: '⚙️',
    label: 'News & settings',
    text: [
      '• **📣 News** (top right): announcements and patch notes. A red dot means something new',
      '• **⚙ Settings**: music and sound volumes, mute, log out, credits',
      '• **🏆 Leaderboard monument**: the top 10 by Kowens',
      '• When a new version is out, press **Reload now**',
      '-# Found a bug? Tell twigo in Discord 💬',
    ].join('\n'),
  },
];

const TAB_KEY = 'mk_guide_tab';

function lastTab(): string {
  try {
    return localStorage.getItem(TAB_KEY) ?? TOPICS[0].id;
  } catch {
    return TOPICS[0].id;
  }
}

export function showGuide(): void {
  const open = document.querySelector<HTMLButtonElement>('#reward:has(.gd-body) .rw-ok');
  if (open) return void open.click(); // the button toggles it

  const bar = el('div', 'gd-tabs');
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-orientation', 'vertical');
  const page = el('div', 'gd-panel nw-text');
  page.setAttribute('role', 'tabpanel');
  page.tabIndex = 0;
  const wrap = el('div', 'gd-body');
  wrap.append(bar, page);

  let tab = TOPICS.find((t) => t.id === lastTab()) ?? TOPICS[0];
  const tabs = new Map<string, HTMLButtonElement>();
  const pick = (t: Topic, focus = false) => {
    tab = t;
    try {
      localStorage.setItem(TAB_KEY, t.id);
    } catch {
      // private mode: it opens on Moving next time
    }
    render();
    const b = tabs.get(t.id)!;
    b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (focus) b.focus();
  };
  for (const t of TOPICS) {
    const b = el('button', 'gd-tab');
    b.setAttribute('role', 'tab');
    b.id = `gd-tab-${t.id}`;
    b.append(el('span', 'gd-icon', t.icon), el('span', 'gd-label', t.label));
    b.addEventListener('click', () => pick(t));
    b.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      pick(TOPICS[(TOPICS.indexOf(tab) + step + TOPICS.length) % TOPICS.length], true);
    });
    tabs.set(t.id, b);
    bar.append(b);
  }

  const render = () => {
    for (const [id, b] of tabs) {
      b.setAttribute('aria-selected', String(id === tab.id));
      b.tabIndex = id === tab.id ? 0 : -1;
    }
    page.setAttribute('aria-labelledby', `gd-tab-${tab.id}`);
    const head = el('div', 'nw-h nw-h1', `${tab.icon} ${tab.label}`);
    const extra: HTMLElement[] = [];
    if (tab.id === 'move') {
      const boxes = el('div', 'tu-boxes');
      boxes.append(panel(keys(), 'WASD', 'Walk with W A S D.'), panel(mouse(), 'Right click', 'Walk to a spot. On a phone, tap.'));
      extra.push(boxes);
    }
    page.replaceChildren(head, ...extra, ...markdown(tab.text));
    page.scrollTop = 0;
  };

  render();
  void showPopup({ title: 'Tutorial', body: [wrap], button: 'Close', celebrate: false });
  requestAnimationFrame(() => tabs.get(tab.id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
}
