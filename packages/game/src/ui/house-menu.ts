import type { HoodHouse, TownHoodActionResponse, TownHoodResponse } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { el, showPopup } from './reward';
import { toast } from './toast';

// 🏠 A house in the neighbourhood, clicked (left click, or E at its door), in the reward box: whose it is and their
// title, then what you can do. Someone else's: Steal (/steal's odds; caught = a fine and jail), and on a house with a
// Bakod (the fence round it) only a Master Key gets in, or a Kalawang Potion rusts half the Bakod away. Your own: a new
// look (the house creator). The bot decides everything (POST /town/hood); what happened shows as a toast under the
// box, and a bust closes it and the Tanod plays.

export interface HouseMenuHooks {
  house: HoodHouse;
  me: TownHoodResponse['me'];
  act: (action: 'steal' | 'key' | 'kalawang') => Promise<TownHoodActionResponse | null>;
  /** Your own house: open the house creator. */
  repaint: () => void;
  /** Caught by the Tanod: the bust plays (this closes first). */
  busted: (message: string) => void;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const minutes = (until: number) => Math.max(1, Math.ceil((until - Date.now()) / 60_000));

export function showHouseMenu(h: HouseMenuHooks): void {
  const { house } = h;
  let me = h.me;
  let fenced = house.fenced;
  const title = el('div', 'hm-title', `<${house.title.name}>`);
  if (house.title.color === 'prismatic') title.classList.add('prismatic');
  else title.style.color = house.title.color;
  const buttons = el('div', 'hm-actions');
  let busy = false;
  /** What happened, under the box (toasts read out on their own: ui/toast.ts). */
  const say = (text: string, tone: 'bad' | 'good' | null) => toast(text, 4500, tone);
  const close = () => document.querySelector<HTMLButtonElement>('#reward .rw-ok')?.click();

  const button = (text: string, onClick: () => void, disabled = false, kind = '') => {
    const b = el('button', `hm-btn${kind ? ` hm-${kind}` : ''}`, text);
    b.disabled = disabled || busy;
    b.addEventListener('click', onClick);
    return b;
  };

  /** Where things stand (shown under the box as the menu opens). */
  const status = () => {
    if (house.mine) return fenced ? '🧱 Your Bakod is up: only a Master Key gets past the fence.' : 'No Bakod: anyone can try to rob you. Get one at the rewards shop.';
    const wait = me.stealAt && me.stealAt > Date.now() ? minutes(me.stealAt) : 0;
    return me.jailed
      ? "You're in jail. No house calls till you're out."
      : wait
        ? `You're laying low: you can steal again in ${wait} min.`
        : fenced
          ? '🧱 A Bakod fences this house in. Only a Master Key gets past it (50% it snaps), or rust half of it away with a Kalawang Potion.'
          : 'Steal: 35% to take 2–5% of their Kowens. Caught by the Tanod: you pay them a fine and spend 5 minutes in jail.';
  };

  const render = () => {
    if (house.mine) {
      buttons.replaceChildren(button(`New look · ${plural(me.repaintCost, 'Kowen', 'Kowens')}`, () => {
        close();
        h.repaint();
      }));
      return;
    }
    const wait = me.stealAt && me.stealAt > Date.now() ? minutes(me.stealAt) : 0;
    const blocked = me.jailed || !!wait;
    const list = [button('Steal', () => void act('steal'), blocked || fenced, 'steal')];
    if (fenced) {
      list.push(button(`Use a Master Key (${me.keys})`, () => void act('key'), blocked || me.keys < 1));
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
    fenced = r.houses.find((x) => x.lot === house.lot)?.fenced ?? fenced;
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
  if (!house.mine && fenced && me.keys < 1 && me.kalawang < 1) {
    setTimeout(() => {
      say('This house has a Bakod. Please purchase a Master Key or a Kalawang Potion at the rewards shop.', 'bad');
      playSound('error');
    }, 200); // after the pop-up's own open sound
  } else say(status(), null);
  void showPopup({
    title: house.mine ? 'Your house' : `${house.owner}'s house`,
    body: [title, buttons],
    button: 'Close',
    celebrate: false,
    sound: 'door',
  });
}
