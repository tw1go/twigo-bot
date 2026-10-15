import type { HoodHouse, TownHoodActionResponse, TownHoodResponse } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { el, showPopup } from './reward';
import { toast } from './toast';

// 🏠 A house in the neighbourhood, clicked (left click, or E at its door), in the reward box: whose it is and their
// title, then what you can do. Someone else's: Steal (/steal's odds; caught = a fine and jail), and on a house with a
// Bakod (the fence round it) only a Master Key gets in, or a Kalawang Potion rusts half the Bakod away. Only rogues do
// any of it (CONTEXT.md "Rogues and stealing"): anyone else gets "Become a rogue to steal", and a protected house
// offers nothing. Your own: a new look (the house creator), and becoming a rogue or quitting (each asks first, in the
// same box). The bot decides everything (POST /town/hood, /town/rogue); what happened shows as a toast under the box,
// and a bust closes it and the Tanod plays.

export interface HouseMenuHooks {
  house: HoodHouse;
  me: TownHoodResponse['me'];
  act: (action: 'steal' | 'key' | 'kalawang') => Promise<TownHoodActionResponse | null>;
  /** Become a rogue (`on`) or quit. */
  rogue: (on: boolean) => Promise<TownHoodActionResponse | null>;
  /** Your own house: open the house creator. */
  repaint: () => void;
  /** Caught by the Tanod: the bust plays (this closes first). */
  busted: (message: string) => void;
  /** At the house's Bakod, after the bot's answer: a Kalawang Potion thrown, or the Master Key opening the lock or
   *  snapping (world/bakod-fx.ts). Resolves when it's played. */
  effect: (kind: 'kalawang' | 'unlock' | 'snap') => Promise<void>;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const minutes = (until: number) => Math.max(1, Math.ceil((until - Date.now()) / 60_000));

const JOIN_TEXT =
  "Rogues can steal from anyone who isn't protected. Once you steal, other rogues can rob your house for as long as you're a rogue and for 2 days after your last steal. Becoming a rogue removes your protection.";
const QUIT_TEXT = "You'll stay marked until 2 days after your last steal.";
/** Your own state, as your house's menu says it. */
const MY_STATE = {
  protected: "Protected: you were robbed, so rogues can't touch your house.",
  marked: 'Marked: rogues can rob you.',
  open: "Open: rogues can rob you once, then you're protected.",
} as const;
const PROTECTED = 'Protected: this house was robbed already. It stays safe unless the owner turns rogue.';
const MARKED = "🎭 Marked: a rogue's house.";

export function showHouseMenu(h: HouseMenuHooks): void {
  const { house } = h;
  let me = h.me;
  let fenced = house.fenced;
  let state = house.state;
  /** The menu, or a question before becoming a rogue or quitting (in the same box). */
  let asking: 'join' | 'quit' | null = null;
  const title = el('div', 'hm-title', `<${house.title.name}>`);
  if (house.title.color === 'prismatic') title.classList.add('prismatic');
  else title.style.color = house.title.color;
  const note = el('p', 'hm-note');
  const buttons = el('div', 'hm-actions');
  let busy = false;
  /** What happened, under the box (toasts read out on their own: ui/toast.ts). */
  const say = (text: string, tone: 'bad' | 'good' | null) => toast(text, 4500, tone);
  const close = () => document.querySelector<HTMLButtonElement>('#reward .rw-x')?.click();

  const button = (text: string, onClick: () => void, disabled = false, kind = '') => {
    const b = el('button', `hm-btn${kind ? ` hm-${kind}` : ''}`, text);
    b.disabled = disabled || busy;
    b.addEventListener('click', onClick);
    return b;
  };

  const cooling = () => !!me.stealAt && me.stealAt > Date.now();
  /** Where things stand (shown under the box as the menu opens). */
  const status = () => {
    if (house.mine) {
      const mine = MY_STATE[me.marked ? 'marked' : me.protected ? 'protected' : 'open'];
      return `${mine} ${fenced ? '🧱 Your Bakod is up: only a Master Key gets past the fence.' : 'No Bakod: get one at the sari-sari store.'}`;
    }
    const wait = me.stealAt && me.stealAt > Date.now() ? minutes(me.stealAt) : 0;
    const line = me.jailed
      ? "You're in jail. No house calls till you're out."
      : wait
        ? `You're laying low: you can steal or use a Master Key again in ${wait} min.${fenced ? ' A Kalawang Potion still works.' : ''}`
        : fenced
          ? '🧱 A Bakod fences this house in. Only a Master Key gets past it (50% it snaps), or rust half of it away with a Kalawang Potion.'
          : 'Steal: 35% to take 2–5% of their Kowens. Caught by the Tanod: you pay them a fine and spend 5 minutes in jail.';
    return state === 'marked' ? `${MARKED} ${line}` : line;
  };

  /** Asks before becoming a rogue or quitting; yes: the bot's answer, then the menu again. */
  const ask = (which: 'join' | 'quit') => {
    note.textContent = which === 'join' ? JOIN_TEXT : QUIT_TEXT;
    note.hidden = false;
    buttons.classList.add('hm-ask');
    buttons.replaceChildren(
      button('Cancel', () => {
        asking = null;
        playSound('click');
        render();
      }),
      button(which === 'join' ? 'Become a rogue' : 'Quit being a rogue', () => void turn(which === 'join'), false, 'rogue'),
    );
  };

  const turn = async (on: boolean) => {
    busy = true;
    ask(on ? 'join' : 'quit');
    const r = await h.rogue(on);
    busy = false;
    asking = null;
    if (!r) {
      say("Couldn't reach the house. Try again?", 'bad');
      playSound('error');
      return render();
    }
    me = r.me;
    state = r.houses.find((x) => x.lot === house.lot)?.state ?? state;
    say(r.message, r.ok ? null : 'bad');
    playSound(r.ok ? 'click' : 'error');
    render();
  };

  const render = () => {
    if (asking) return ask(asking);
    buttons.classList.remove('hm-ask');
    note.hidden = true;
    const askFor = (which: 'join' | 'quit') => () => {
      asking = which;
      playSound('click');
      render();
    };
    if (house.mine) {
      buttons.replaceChildren(
        button(`New look · ${plural(me.repaintCost, 'Kowen', 'Kowens')}`, () => {
          close();
          h.repaint();
        }),
        me.rogue ? button('Quit being a rogue', askFor('quit')) : button('Become a rogue', askFor('join'), me.jailed, 'rogue'),
      );
      return;
    }
    // A protected house: nothing to do here (becoming a rogue wouldn't change it).
    if (state === 'protected') {
      note.textContent = PROTECTED;
      note.hidden = false;
      buttons.replaceChildren();
      return;
    }
    if (!me.rogue) {
      buttons.replaceChildren(button('Become a rogue to steal', askFor('join'), me.jailed, 'rogue'));
      return;
    }
    const wait = me.stealAt && me.stealAt > Date.now() ? minutes(me.stealAt) : 0;
    const blocked = me.jailed || !!wait;
    const later = wait && !me.jailed ? ` · ${wait} min` : ''; // the cooldown, on what it blocks
    const list = [button(`Steal${later}`, () => void act('steal'), blocked || fenced, 'steal')];
    if (fenced) {
      list.push(button(`Use a Master Key (${me.keys})${later}`, () => void act('key'), blocked || me.keys < 1));
      list.push(button(`Throw Kalawang (${me.kalawang})`, () => void act('kalawang'), me.jailed || me.kalawang < 1));
    }
    buttons.replaceChildren(...list);
  };

  const act = async (action: 'steal' | 'key' | 'kalawang') => {
    busy = true;
    render();
    const r = await h.act(action);
    busy = false;
    if (!r) {
      say("Couldn't reach the house. Try again?", 'bad');
      playSound('error');
      return render();
    }
    me = r.me;
    const now = r.houses.find((x) => x.lot === house.lot);
    fenced = now?.fenced ?? fenced;
    state = now?.state ?? state; // (robbed: protected now, and the menu has nothing left to offer)
    // A potion or a key that went in: out of the menu, the Bakod's effect plays, then what happened.
    if (r.ok && action !== 'steal') {
      close();
      await h.effect(action === 'kalawang' ? 'kalawang' : r.busted || r.stole ? 'unlock' : 'snap');
      if (r.busted) return h.busted(r.message);
      say(r.message, r.stole ? 'good' : null);
      if (r.stole) {
        playSound('coin');
        window.dispatchEvent(new Event('mk-wallet')); // the HUD's Kowens
      }
      return;
    }
    if (r.busted) {
      close();
      return h.busted(r.message);
    }
    say(r.message, r.stole ? 'good' : r.ok ? null : 'bad');
    playSound(r.stole ? 'coin' : r.ok ? 'click' : 'error');
    if (r.stole) window.dispatchEvent(new Event('mk-wallet')); // the HUD's Kowens
    render();
  };

  render();
  // Where things stand, under the box; with a Bakod and nothing to get past it with, what to buy instead.
  if (!house.mine && state === 'protected') {
    // (the line's in the box)
  } else if (!house.mine && me.rogue && fenced && me.keys < 1 && me.kalawang < 1) {
    setTimeout(() => {
      say('This house has a Bakod. Please purchase a Master Key or a Kalawang Potion at the sari-sari store.', 'bad');
      playSound('error');
    }, 200); // after the pop-up's own open sound
  } else say(status(), !house.mine && (me.jailed || cooling()) ? 'bad' : null); // laying low or in jail: in red
  void showPopup({
    title: house.mine ? 'Your house' : `${house.owner}'s house`,
    body: [title, note, buttons],
    button: 'Close',
    closeX: true,
    celebrate: false,
    sound: 'door',
  });
}
