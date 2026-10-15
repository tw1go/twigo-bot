import { type AdventureState, type Item, type ItemData, type TownForgeAction, type TownForgeResponse, breaksFrom, enhanceView, fragmentsPerWhetstone, isGearDef, itemStats } from '@mikazuki/shared';
import { cantWear } from '../net/adventure';
import { hotbarItemIds } from './hotbar';
import { keyLabel } from './keybinds';
import type { GuideSide } from './guide-arrow';

// 🎓 The lessons (CONTEXT.md "Lesson"): four one-time walkthroughs of a new player's first items, each a list of steps;
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
/** The first empty hotbar slot a potion fits (- = ~, then the top row). (A slot pulsing for a lesson lifts the hotbar
 *  over the bag and the equipment panel, which can cover it on a short screen.) */
const freeSlot = () => [...document.querySelectorAll<HTMLElement>('#hotbar .hb-slot.hb-util.hb-free'), ...document.querySelectorAll<HTMLElement>('#hotbar .hb-slot.hb-top.hb-free')].find(shown) ?? null;
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

// ── The four lessons ──

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
  {
    // 2. Wear the quest piece (Just In Time's, the first mini boss quest).
    id: 'wear',
    starts: (c) => c.s.bag.some((it) => isQuestPiece(c, it)),
    note: (c) => ({ piece: c.s.bag.find((it) => isQuestPiece(c, it))?.uid ?? '' }),
    goal: (c) => Object.values(c.s.equipped).some((it) => it?.uid === c.memo.piece) || !c.s.bag.some((it) => it.uid === c.memo.piece),
    blocked: (c) => {
      const d = defOf(c, c.s.bag.find((it) => it.uid === c.memo.piece));
      return isGearDef(d) && !!cantWear(d);
    },
    steps: [
      ...openTheBag(() => `The mini boss dropped gear for you! Open your bag${bagKey()}.`, (c) => shown(cellOf(c.memo.piece)), 'It\'s in the Combat tab.'),
      { applies: (c) => shown(cellOf(c.memo.piece)), target: (c) => cellOf(c.memo.piece), line: () => 'Click it to see what it does.', sides: ['left', 'below'] },
      {
        applies: (c) => picked(c.memo.piece) && !!action('Wear'),
        target: () => action('Wear'),
        // Not wearable yet (a stat short): the game's own reason, and the lesson waits.
        line: () => {
          const b = action('Wear');
          return b?.disabled && b.title ? `${b.title.replace(/[.!]?$/, '.')} It goes on once you can wear it.` : 'Press Wear to put it on.';
        },
        sides: ['right', 'below', 'above'],
      },
    ],
    after: (c) => {
      const place = Object.entries(c.s.equipped).find(([, it]) => it?.uid === c.memo.piece)?.[0];
      return { target: place ? $(`#equipment .eq-slot[data-place="${CSS.escape(place)}"]`) : null, line: "It's on! Its agimat is already filled in." };
    },
  },
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
];

const fragUid = (c: LessonCtx) => c.s.bag.find((it) => it.defId === c.memo.fragment)?.uid;
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
