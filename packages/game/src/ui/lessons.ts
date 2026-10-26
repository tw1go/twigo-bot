import { type AdventureState, type Item, type ItemData, type TownForgeAction, type TownForgeResponse, breaksFrom, enhanceView, fragmentsPerWhetstone, isGearDef, itemName, itemStats } from '@mikazuki/shared';
import { cantWear } from '../net/adventure';
import { myBet, race, raceNow, raceRules, raceStartedHere } from '../net/race';
import { hotbarItemIds } from './hotbar';
import { keyLabel } from './keybinds';
import { type GuideSide, uncovered } from './guide-arrow';

// 🎓 The lessons (CONTEXT.md "Lesson"): one-time walkthroughs of a new player's first items, each a list of steps;
// ui/lesson-runner.ts runs them (one at a time, after the quest guide's arrow, never in a fight). Every line a player
// reads is here, so they're easy to change. A step says when it applies (from what's on screen and in the bag) and what
// it points at; the runner shows the furthest step that applies now, so a player who goes off and does something else
// gets the step that fits where they are (the bag closed mid-lesson: "Open your bag" again). Nothing waits on a Next.

export interface LessonCtx {
  s: AdventureState;
  D: ItemData;
  /** A touch screen (taps, no dragging). */
  touch: boolean;
  /** What the lesson noted as it started (the quest piece it's about). */
  memo: Record<string, string>;
  /** A forge answer heard since the lesson started that this says yes to. */
  forged: (yes: (a: TownForgeAction, r: TownForgeResponse) => boolean) => boolean;
}

export interface LessonStep {
  /** It applies now (the furthest that does is shown). */
  applies: (c: LessonCtx) => boolean;
  target: (c: LessonCtx) => HTMLElement | null;
  line: (c: LessonCtx) => string;
  sides?: GuideSide[];
  /** A faded copy of an item sliding from its picture to where it goes, again and again (a drag to show). */
  drag?: (c: LessonCtx) => { item: Item; from: HTMLElement | null; to: HTMLElement | null } | null;
  /** A hotbar slot pulsing in the selected slot's lime (where to put it). */
  pulse?: (c: LessonCtx) => HTMLElement | null;
}

export interface Lesson {
  id: string;
  /** It's time for it (looked at a few times a second until it starts). */
  starts: (c: LessonCtx) => boolean;
  /** What it notes as it starts (memo). */
  note?: (c: LessonCtx) => Record<string, string>;
  /** Its goal is reached: it ends for good. */
  goal: (c: LessonCtx) => boolean;
  /** Waiting on the player (a piece they can't wear yet): the next lesson in the queue may run meanwhile. */
  blocked?: (c: LessonCtx) => boolean;
  /** It can't wait (the race: betting lasts minutes): it runs at once, ahead of the queue, the quest arrow and the calm
   *  wait; the others pause meanwhile. */
  urgent?: boolean;
  steps: LessonStep[];
  /** After the goal: a tip at something for a moment, or a toast. */
  after?: (c: LessonCtx) => { target: HTMLElement | null; line: string } | { toast: string } | null;
}

// ── What's on screen ──

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const shown = (el: HTMLElement | null): el is HTMLElement => !!el && !el.hidden && el.offsetParent !== null;
const bagOpen = () => shown($('#inventory'));
const bagButton = () => $('button.iv-open');
const combatTab = () => $('#inventory .iv-tab[data-tab="combat"]');
const cellOf = (uid: string | undefined) => (uid ? $(`#inventory .iv-cell[data-uid="${CSS.escape(uid)}"]`) : null);
const picked = (uid: string | undefined) => !!cellOf(uid)?.classList.contains('iv-picked');
/** The details row's button with that label (Wear, Combine, Put on hotbar). */
const action = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('#inventory .iv-detail .iv-act')].find((b) => b.textContent?.trim() === label && shown(b)) ?? null;
const forgeOpen = () => shown($('#forge'));
/** The first empty hotbar slot for a potion (any slot takes one: - = ~ first, then the top row, then 1–0). (A slot
 *  pulsing for a lesson lifts the hotbar over the bag and the equipment panel, which can cover it on a short screen.) */
const freeSlot = () => (['util', 'top', 'main'] as const).flatMap((row) => [...document.querySelectorAll<HTMLElement>(`#hotbar .hb-slot.hb-${row}.hb-free`)]).find(shown) ?? null;
/** The bag's key after "Open your bag" (none on a touch screen). */
const bagKey = () => (keyLabel('bag') && !matchMedia('(hover: none) and (pointer: coarse)').matches ? ` (${keyLabel('bag')})` : '');

/** The bag's first two steps, the same in every lesson: open it, then its Combat tab (while what it's about isn't in
 *  view: another tab is showing). */
function openTheBag(first: (c: LessonCtx) => string, inView: (c: LessonCtx) => boolean, tabLine: string): LessonStep[] {
  return [
    { applies: () => true, target: bagButton, line: first, sides: ['above', 'right', 'left'] },
    { applies: (c) => bagOpen() && !inView(c), target: combatTab, line: () => tabLine, sides: ['below', 'above'] },
  ];
}

// ── What's in the bag ──

const defOf = (c: LessonCtx, it: Item | undefined) => (it ? c.D.defs.get(it.defId) : undefined);
const potions = (c: LessonCtx, heals: 'hp' | 'mp') => c.s.bag.filter((it) => {
  const d = defOf(c, it);
  return !!d && !isGearDef(d) && d.kind === 'potion' && d.heals === heals;
});
const onBar = (c: LessonCtx, heals: 'hp' | 'mp') => [...hotbarItemIds()].some((id) => {
  const d = c.D.defs.get(id);
  return !!d && !isGearDef(d) && d.kind === 'potion' && d.heals === heals;
});
/** The potion kinds to put on the bar: those in the bag, and any already on it. */
const kinds = (c: LessonCtx) => (['hp', 'mp'] as const).filter((h) => potions(c, h).length || onBar(c, h));

/** A quest piece (CONTEXT.md): bound grey gear, not training gear; +5 as given (the forge may have raised it since). */
const isQuestPiece = (c: LessonCtx, it: Item, plusFive = true) => {
  const d = defOf(c, it);
  return isGearDef(d) && !d.training && it.bound && it.rarity === 'grey' && (!plusFive || it.plus === 5);
};
const fragments = (c: LessonCtx) => c.s.bag.find((it) => {
  const d = defOf(c, it);
  return !!d && !isGearDef(d) && d.forge === 'fragment' && it.count >= fragmentsPerWhetstone(c.D.stats);
});
/** The places quest pieces go, in the Tanod's chain's order (the mini boss quests: Tin Can body, Bottle Caps hands, Tire
 *  Roller bottoms, Plastic Bag Spook weapon, Wire Tangle head, Scrap Crab feet). */
const PIECE_PLACES = ['body', 'hands', 'bottoms', 'weapon', 'head', 'feet'] as const;
/** Quest pieces up to this level get a lesson: the Lv 10 ones replace the training gear. (The Scrap Crab's Lv 20 boots
 *  come late in the chain, when a player knows the bag by now.) */
const GUIDED_UP_TO = 10;
/** The quest piece for a place in the bag that can be worn now and would replace training gear (or fill the empty place
 *  there), up to GUIDED_UP_TO. */
const wearablePiece = (c: LessonCtx, place: string) => {
  const worn = c.s.equipped[place as keyof AdventureState['equipped']];
  if (worn && !(defOf(c, worn) as { training?: boolean } | undefined)?.training) return undefined;
  return c.s.bag.find((it) => {
    const d = defOf(c, it);
    return isQuestPiece(c, it, false) && isGearDef(d) && d.slot === place && it.level <= GUIDED_UP_TO && !cantWear({ ...d, level: it.level });
  });
};
/** Training gear (or nothing) still in a place. */
const trainingIn = (c: LessonCtx, place: string) => {
  const worn = c.s.equipped[place as keyof AdventureState['equipped']];
  return !worn || !!(defOf(c, worn) as { training?: boolean } | undefined)?.training;
};

/** The quest piece that's a weapon, worn or in the bag. */
const questWeapon = (c: LessonCtx) => {
  const worn = c.s.equipped.weapon;
  if (worn && isQuestPiece(c, worn, false)) return worn;
  return c.s.bag.find((it) => isQuestPiece(c, it, false) && (defOf(c, it) as { slot?: string } | undefined)?.slot === 'weapon');
};
/** Enough whetstones of its tier for its next try. */
const canTry = (c: LessonCtx, w: Item | undefined) => {
  const v = w && enhanceView(c.D, w, c.s.bag);
  return !!v && v.have >= v.stones;
};
const whetstonesOf = (c: LessonCtx, w: Item | undefined) => {
  const v = w && enhanceView(c.D, w, c.s.bag);
  return v?.whetstone ? c.s.bag.find((it) => it.defId === v.whetstone!.id) : undefined;
};

/** Wearing a place's quest piece (lesson 2, one for each place): it starts once the piece can be worn (its level and
 *  stats met: Just In Time's Lv 10 body waits for Lv 10) while training gear (or nothing) is in its place, and ends once
 *  it's on, or it left the bag, or something else replaced the training gear. */
function wearLesson(place: (typeof PIECE_PLACES)[number]): Lesson {
  const piece = (c: LessonCtx) => c.s.bag.find((it) => it.uid === c.memo.piece);
  return {
    id: `wear-${place}`,
    starts: (c) => !!wearablePiece(c, place),
    note: (c) => ({ piece: wearablePiece(c, place)?.uid ?? '' }),
    goal: (c) => Object.values(c.s.equipped).some((it) => it?.uid === c.memo.piece) || !piece(c) || !trainingIn(c, place),
    blocked: (c) => {
      const d = defOf(c, piece(c));
      return isGearDef(d) && !!cantWear(d);
    },
    steps: [
      ...openTheBag(
        (c) => {
          const it = piece(c);
          return `${it ? itemName(c.D, it) : 'Your mini boss gear'} fits you now: wear it in place of your training gear. Open your bag${bagKey()}.`;
        },
        (c) => shown(cellOf(c.memo.piece)),
        "It's in the Combat tab.",
      ),
      { applies: (c) => shown(cellOf(c.memo.piece)), target: (c) => cellOf(c.memo.piece), line: () => 'Click it to see what it does.', sides: ['left', 'below'] },
      {
        applies: (c) => picked(c.memo.piece) && !!action('Wear'),
        target: () => action('Wear'),
        // (Not wearable after all: a stat point reset since. The game's own reason, and the lesson waits.)
        line: () => {
          const b = action('Wear');
          return b?.disabled && b.title ? `${b.title.replace(/[.!]?$/, '.')} It goes on once you can wear it.` : 'Press Wear to put it on.';
        },
        sides: ['right', 'below', 'above'],
      },
    ],
    after: (c) => {
      const at = Object.entries(c.s.equipped).find(([, it]) => it?.uid === c.memo.piece)?.[0];
      return { target: at ? $(`#equipment .eq-slot[data-place="${CSS.escape(at)}"]`) : null, line: "It's on! Its agimat is already filled in." };
    },
  };
}

// ── The race (lesson 5) ──

/** "1:52" */
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const raceBox = () => $('#town-hud .th-race');
const betPopup = () => shown($('#reward .rb-body'));
/** The race the lesson is about, while it's the one on. */
const theRace = (c: LessonCtx) => {
  const r = race();
  return r && r.id === c.memo.race ? r : null;
};
const betting = (c: LessonCtx) => {
  const r = theRace(c);
  return !!r && !r.run && raceNow() < r.closesAt;
};
const ended = (c: LessonCtx) => {
  const r = theRace(c);
  return !!r?.run && raceNow() >= r.run.endsAt;
};
const betOn = (c: LessonCtx) => myBet(c.memo.race);
/** How long a timed tip by the race box has shown (from when the box was first in view for it: the bet pop-up over it
 *  doesn't count), so it lasts its 6 s. */
const since = (c: LessonCtx, key: string) => {
  const box = raceBox();
  if (!c.memo[key] && box && uncovered(box)) c.memo[key] = String(Date.now());
  return c.memo[key] ? Date.now() - Number(c.memo[key]) : 0;
};
const TIP_MS = 6000;
const mosangPicked = () => !!$('#reward .rb-card[aria-checked="true"]');

// ── The five lessons ──

export const LESSONS: Lesson[] = [
  {
    // 1. Potions onto the hotbar (A Weapon for the Town gives HP and MP Potions).
    id: 'potions',
    starts: (c) => kinds(c).length > 0 && !onBar(c, 'hp') && !onBar(c, 'mp'),
    goal: (c) => kinds(c).every((h) => onBar(c, h)),
    steps: [
      ...openTheBag(() => `You got potions! Open your bag${bagKey()}.`, (c) => !!potions(c, 'hp').concat(potions(c, 'mp')).some((it) => shown(cellOf(it.uid))), 'Your potions are in the Combat tab.'),
      ...(['hp', 'mp'] as const).map((h): LessonStep => {
        const it = (c: LessonCtx) => potions(c, h)[0];
        const ready = (c: LessonCtx) => !onBar(c, h) && (h === 'hp' || !kinds(c).includes('hp') || onBar(c, 'hp'));
        return {
          applies: (c) => ready(c) && shown(cellOf(it(c)?.uid)),
          // A touch screen: the cell, then its Put on hotbar, then a slot; dragging: the cell.
          target: (c) => (c.touch ? (document.querySelector('#hotbar.hb-picking') ? freeSlot() : picked(it(c)?.uid) ? action('Put on hotbar') : cellOf(it(c)?.uid)) : cellOf(it(c)?.uid)),
          line: (c) =>
            c.touch
              ? document.querySelector('#hotbar.hb-picking')
                ? 'Now tap a slot on your hotbar.'
                : picked(it(c)?.uid)
                  ? 'Tap Put on hotbar, then tap a hotbar slot.'
                  : h === 'hp'
                    ? 'Tap your HP Potion.'
                    : 'Now your MP Potion: tap it.'
              : h === 'hp'
                ? "Drag it onto your hotbar. Press that slot's key to drink one."
                : 'Now your MP Potion.',
          sides: ['left', 'below', 'above'],
          drag: (c) => (c.touch || !it(c) ? null : { item: it(c)!, from: cellOf(it(c)!.uid), to: freeSlot() }),
          pulse: () => freeSlot(),
        };
      }),
    ],
    after: (c) => ({ toast: itemStats(c.D.stats).potions.separateCooldowns ? 'Potions ready. HP and MP each have a short cooldown.' : 'Potions ready. They share a short cooldown.' }),
  },
  // 2. Wear each quest piece in place of training gear, once it can be worn (below: wearLesson).
  ...PIECE_PLACES.map(wearLesson),
  {
    // 3. Fragments into a whetstone.
    id: 'combine',
    starts: (c) => !!fragments(c),
    note: (c) => ({ fragment: fragments(c)?.defId ?? '' }),
    goal: (c) => c.forged((a, r) => a.action === 'combine' && r.ok),
    steps: [
      ...openTheBag(
        (c) => `You have ${fragmentsPerWhetstone(c.D.stats)} ${plural(c.D.defs.get(c.memo.fragment)?.name ?? 'fragment')}. Open your bag${bagKey()}.`,
        (c) => shown(cellOf(fragUid(c))),
        'They\'re in the Combat tab.',
      ),
      { applies: (c) => shown(cellOf(fragUid(c))), target: (c) => cellOf(fragUid(c)), line: () => 'Click your fragments.', sides: ['left', 'below'] },
      { applies: (c) => picked(fragUid(c)) && !!action('Combine'), target: () => action('Combine'), line: (c) => `Combine ${fragmentsPerWhetstone(c.D.stats)} fragments into 1 whetstone.`, sides: ['right', 'below'] },
      { applies: () => shown($('.fg-confirm')), target: () => $('.fg-confirm .fg-ready'), line: () => 'Press Combine.', sides: ['right', 'below', 'left'] },
    ],
    after: (c) => {
      const stone = c.s.bag.find((it) => {
        const d = defOf(c, it);
        return !!d && !isGearDef(d) && d.forge === 'whetstone';
      });
      return { target: cellOf(stone?.uid), line: 'Whetstones add a + to your gear.' };
    },
  },
  {
    // 4. Enhance the quest piece that's a weapon (whichever mini boss quest gives it), once there are enough whetstones
    //    of its tier for its next try.
    id: 'enhance',
    starts: (c) => canTry(c, questWeapon(c)),
    note: (c) => ({ weapon: questWeapon(c)?.uid ?? '' }),
    goal: (c) => c.forged((a) => a.action === 'enhance' && a.item === c.memo.weapon),
    steps: [
      ...openTheBag(() => `You can make your weapon stronger. Open your bag${bagKey()}.`, (c) => shown(cellOf(whetstonesOf(c, weaponOf(c))?.uid)) || forgeOpen(), 'Your whetstones are in the Combat tab.'),
      { applies: (c) => shown(cellOf(whetstonesOf(c, weaponOf(c))?.uid)) && !forgeOpen(), target: (c) => cellOf(whetstonesOf(c, weaponOf(c))?.uid), line: () => 'Click your whetstones.', sides: ['left', 'below'] },
      {
        applies: (c) => forgeOpen() && !weaponIn(c),
        // (A touch screen taps the weapon itself: where it is, worn or in the bag.)
        target: (c) => (c.touch ? weaponPicture(c) : $('#forge .fg-item')),
        line: (c) => (c.touch ? 'Tap your weapon to put it in.' : 'Drag your weapon in. You can also click it.'),
        sides: ['left', 'below', 'right'],
        drag: (c) => {
          const w = weaponOf(c);
          return !w || c.touch ? null : { item: w, from: weaponPicture(c), to: $('#forge .fg-item') };
        },
      },
      {
        // Its whetstones in: + until the try has them all (or drag them onto the stone slot).
        applies: (c) => forgeOpen() && weaponIn(c) && !enhanceReady(),
        target: () => $<HTMLButtonElement>('#forge .fg-stones .fg-step:last-child'),
        line: (c) => {
          const w = weaponOf(c);
          const n = w ? (enhanceView(c.D, w, c.s.bag)?.stones ?? 0) : 0;
          return `Put your whetstones in: press + until it says ${n} / ${n}.`;
        },
        sides: ['right', 'below', 'above'],
      },
      {
        applies: (c) => forgeOpen() && weaponIn(c) && !!enhanceReady(),
        target: () => enhanceReady(),
        line: (c) => `Each try uses whetstones. Up to +${breaksFrom(c.D.stats) - 1} a miss only costs the stones.`,
        sides: ['right', 'below', 'above'],
      },
    ],
  },
  {
    // 6. Spend stat points: the stats box under the Equipment panel (opened with the bag), its + on the class's main stat.
    id: 'stats',
    starts: (c) => !!c.s.cls && c.s.progress.statPoints > 0,
    note: (c) => ({ spent: String(statsSpent(c)) }),
    goal: (c) => statsSpent(c) > Number(c.memo.spent) || c.s.progress.statPoints <= 0,
    steps: [
      { applies: () => true, target: bagButton, line: (c) => `You have ${pts(c.s.progress.statPoints, 'stat point')} to spend. Open your bag${bagKey()}.`, sides: ['above', 'right', 'left'] },
      // (Phones: the equipment panel shows in the bag's place.)
      { applies: () => bagOpen() && !shown($('#equipment')), target: () => $('#inventory .iv-to-equip'), line: () => 'Open your Equipment.', sides: ['below', 'left'] },
      { applies: () => shown($('#equipment')) && !shown(statPlus()), target: () => $('#equipment .eq-tab[data-tab="gear"]'), line: () => 'Your stats are on the Gear tab.', sides: ['below', 'above'] },
      {
        applies: () => shown(statPlus()),
        target: (c) => statPlus(mainStat(c)),
        line: (c) => {
          const m = mainStat(c);
          return `Press + to put a point into ${m ?? 'a stat'}${m ? `, your class's main stat` : ''}. Every level gives you more.`;
        },
        sides: ['left', 'below', 'right'],
      },
    ],
    after: () => ({ target: $('#equipment .eq-reset'), line: 'Changed your mind? Reset gives every point back, free.' }),
  },
  {
    // 7. Spend skill points: the Skills panel (K, the button at the hotbar's left), a + on a skill.
    id: 'skills',
    starts: (c) => !!c.s.cls && c.s.progress.skillPoints > 0,
    note: (c) => ({ spent: String(skillsSpent(c)) }),
    goal: (c) => skillsSpent(c) > Number(c.memo.spent) || c.s.progress.skillPoints <= 0,
    // (No K button on screen, the hotbar hidden (phones, the casino): it waits, and the next lesson may run meanwhile.)
    blocked: () => !shown($('#hotbar .hb-book')),
    steps: [
      { applies: () => !shown($('#skill-book')), target: () => $('#hotbar .hb-book'), line: (c) => `You have ${pts(c.s.progress.skillPoints, 'skill point')}. Open your skills${keyLabel('skills') ? ` (${keyLabel('skills')})` : ''}.`, sides: ['above', 'right'] },
      {
        applies: () => shown($('#skill-book')),
        target: () => [...document.querySelectorAll<HTMLElement>('#skill-book .sb-plus')].find(shown) ?? null,
        line: () => 'Press + to raise a skill: more damage and a shorter cooldown each level.',
        sides: ['left', 'below', 'above'],
      },
    ],
    after: () => ({ toast: 'Every level gives you more skill points. Reset is free.' }),
  },
];

// 5. The first Mosang race you start from an Aling's dialog box: how to bet on it, then how it went. It can't wait (the
//    bets close in minutes), so it runs at once.
LESSONS.push({
  id: 'race',
  urgent: true,
  starts: () => !!raceStartedHere(),
  note: () => ({ race: raceStartedHere() ?? '', start: String(raceNow()) }),
  // Done once its result has shown its 6 s (or the race is gone).
  goal: (c) => !theRace(c) || (!!c.memo.result && Date.now() - Number(c.memo.result) >= TIP_MS),
  // (Its tips by the race box count their 6 s from when the box is in view: `since`.)
  steps: [
    {
      applies: (c) => betting(c) && !betOn(c),
      target: raceBox,
      line: (c) => `Your race is on! Click the Mosang race box to bet. Bets close in ${clock((theRace(c)?.closesAt ?? 0) - raceNow())}.`,
      sides: ['below', 'left'],
    },
    { applies: (c) => betting(c) && !betOn(c) && betPopup(), target: () => $('#reward .rb-cards'), line: () => 'Pick a Mosang. They all have the same chance.', sides: ['right', 'left', 'below'] },
    { applies: (c) => betting(c) && !betOn(c) && betPopup() && mosangPicked(), target: () => $('#reward .rb-go'), line: () => 'Press Bet. One bet per race.', sides: ['right', 'below', 'left'] },
    {
      // The amount for a few seconds after a pick (or while its box has the focus), then Bet.
      applies: (c) => {
        if (!(betting(c) && !betOn(c) && betPopup() && mosangPicked())) return false;
        const focus = document.activeElement?.closest('#reward .bet-field');
        c.memo.picked ??= String(Date.now());
        return !!focus || Date.now() - Number(c.memo.picked) < 4000;
      },
      target: () => $('#reward .rb-controls .bet-field'),
      line: () => {
        const input = $<HTMLInputElement>('#reward .bet-input');
        const { maxBet, payout } = raceRules();
        return `Bet ${input?.min || 1} to ${maxBet} Kowens. If she wins, you get ${payout}× back.`;
      },
      sides: ['right', 'below', 'left'],
    },
    // Bet: they're off soon (6 s).
    { applies: (c) => !!betOn(c) && !ended(c) && since(c, 'off') < TIP_MS, target: raceBox, line: () => "They're off soon! Watch them run east along the main road to the bridge.", sides: ['below', 'left'] },
    // Betting closed before a bet: until the race is run.
    {
      applies: (c) => !betOn(c) && !!theRace(c) && !betting(c) && !ended(c),
      target: raceBox,
      line: (c) => {
        const r = theRace(c);
        const minutes = r ? Math.max(1, Math.round((r.closesAt - Number(c.memo.start)) / 60_000)) : 2;
        return `Betting's closed for this one. Next time, bet within ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
      },
      sides: ['below', 'left'],
    },
    // The result (6 s): won, lost, or (no bet) how to race again.
    {
      applies: (c) => {
        if (!ended(c)) return false;
        since(c, 'result');
        return true;
      },
      target: raceBox,
      line: (c) => {
        const r = theRace(c);
        const bet = betOn(c);
        if (!bet) return 'Talk to any Aling to start another race.';
        return r?.run && (bet.lane === r.run.winner || bet.lane === r.run.tie) ? 'She won! Your Kowens are in your wallet.' : 'Not this time. Talk to any Aling to start another race.';
      },
      sides: ['below', 'left'],
    },
  ],
});

const fragUid = (c: LessonCtx) => c.s.bag.find((it) => it.defId === c.memo.fragment)?.uid;
// ── Points (lessons 6 and 7) ──

/** "3 stat points", "1 skill point" */
const pts = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const statsSpent = (c: LessonCtx) => Object.values(c.s.progress.points).reduce((n, v) => n + (v ?? 0), 0);
const skillsSpent = (c: LessonCtx) => Object.values(c.s.progress.skills).reduce((n, v) => n + (v ?? 0), 0);
/** The class's main stat (stats.json classes[cls].main). */
const mainStat = (c: LessonCtx) => (c.s.cls ? (c.D.stats.classes[c.s.cls] as { main?: string } | undefined)?.main : undefined);
/** The stats box's + for a stat (else the first one showing). */
const statPlus = (stat?: string) => {
  const all = [...document.querySelectorAll<HTMLElement>('#equipment .eq-plus')].filter(shown);
  return all.find((b) => !!stat && b.getAttribute('aria-label')?.endsWith(` ${stat}`)) ?? all[0] ?? null;
};

const weaponOf = (c: LessonCtx) => [c.s.equipped.weapon, ...c.s.bag].find((it) => it?.uid === c.memo.weapon) ?? undefined;
const plural = (name: string) => (name.endsWith('s') ? name : `${name}s`);
/** The weapon's picture: its equipment slot while it's worn and the panel shows, else its bag cell. */
const weaponPicture = (c: LessonCtx) => {
  const w = weaponOf(c);
  const worn = w && c.s.equipped.weapon?.uid === w.uid ? $('#equipment .eq-slot[data-place="weapon"]') : null;
  return shown(worn) ? worn : cellOf(w?.uid);
};
/** The forge's Enhance button, once a try is ready (its whetstones in). */
const enhanceReady = () => [...document.querySelectorAll<HTMLButtonElement>('#forge .fg-go.fg-ready')].find((b) => /^Enhanc/.test(b.textContent ?? '')) ?? null;
/** The weapon is in the forge's item slot. */
const weaponIn = (c: LessonCtx) => $('#forge .fg-item.fg-full')?.dataset.uid === c.memo.weapon;
