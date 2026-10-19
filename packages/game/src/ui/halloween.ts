import { EVENT_POTIONS, type HalloweenData, type HalloweenReward, type ShopEvents, eventEndDay } from '@mikazuki/shared';
import { anyDef } from '../net/adventure';
import { coinIcon, el, kusingIcon, showPopup } from './reward';

// 🎃 The Halloween event's own UI (CONTEXT.md Event, Mikko Kalabasa, Biikko Kalabasa, Manananggal): the HUD's event board
// while it's on (beside the jackpot counter and made like it: "Halloween", Mikko, "Ends Nov 4" and the time left; a click
// opens a wide panel with a row per activity), and the pop-ups for a find and a reunite (the 64 px Mikko, then each reward with its picture). Every
// number in them is halloween.json's.

const url = (file: string) => `${import.meta.env.BASE_URL}assets/${file}`;

/** The event's pictures (manifest ui.eventHalloween), set by the town. */
let icons: { icon16: string; icon32: string; icon64: string; manananggal64?: string } | null = null;
export const setHalloweenArt = (a: typeof icons) => (icons = a);

/** The 16 px Mikko (event lines in the chat), or null without its art. */
export const mikkoIcon16 = (): string | null => (icons ? url(icons.icon16) : null);

/** The event as the town last said (its rules, and whether it's on). */
let state: { data: HalloweenData; on: boolean } | null = null;
let render: () => void = () => {};

/** The event for the store's Cosmetics tab (the dev town's pretend store: the Witch Hat and Robe while it's on). */
export const halloweenShopEvents = (): ShopEvents => (state ? { halloween: { on: state.on, window: state.data } } : {});

/** Shows the event board while the event is on (`data` and `on`), hides it while it's off. */
export function setHalloweenBadge(data: HalloweenData | null, on: boolean): void {
  state = data ? { data, on } : null;
  render();
}

/** "17d 09h 12m", and under a day "9h 12m 05s" (with seconds, so it visibly ticks, as the jackpot counter). */
function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${pad(h)}h ${pad(m)}m`;
  return h ? `${h}h ${pad(m)}m ${pad(s % 60)}s` : `${m}m ${pad(s % 60)}s`;
}

/** The event board (top right beside the jackpot counter, made like it: casino lights, "Halloween", the 32 px Mikko with
 *  the day it ends and the time left; on phones a tile with the rest). Hidden while the event is off; a click opens the
 *  panel of what's on. */
export function halloweenTimer(): HTMLElement {
  const box = el('button', 'th-jackpot th-halloween');
  box.setAttribute('aria-haspopup', 'dialog');
  box.hidden = true;
  const lights = el('span', 'jt-lights');
  lights.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 5; i++) lights.append(el('span', i % 2 ? 'jt-bulb jt-odd' : 'jt-bulb'));
  const ends = el('span', 'jt-pot');
  const time = el('span', 'jt-time');
  const row = el('span', 'jt-row jt-pot-row');
  const img = el('img', 'jt-icon');
  img.alt = '';
  img.hidden = true; // (until the town has set the event's art)
  row.append(img, ends);
  box.append(lights, el('span', 'jt-label', 'Halloween'), row, time);
  box.addEventListener('click', () => state && void openPanel(state.data));
  render = () => {
    const on = !!state?.on && box.isConnected;
    box.hidden = !on;
    if (!on || !state) return;
    if (icons && img.hidden) {
      img.src = url(icons.icon32);
      img.hidden = false;
    }
    const left = Date.parse(state.data.endsAt) - Date.now();
    ends.textContent = `Ends ${eventEndDay(state.data)}`;
    time.textContent = countdown(left);
    box.title = `${state.data.name}: ends ${eventEndDay(state.data)}, in ${countdown(left)}. What's on?`;
    box.setAttribute('aria-label', box.title);
  };
  const ticking = setInterval(() => (box.isConnected ? render() : clearInterval(ticking)), 1000);
  queueMicrotask(() => render());
  return box;
}

/** A line per activity, from the event's own words and numbers. */
function openPanel(d: HalloweenData): Promise<void> {
  const [k0, k1] = d.mikko.rewards.kowens;
  const lines: [string, string][] = [
    [d.mikko.name, `A golden pumpkin hides somewhere in ${d.mikko.maps.map(mapName).join(' or ')}. The first to click it gets ${k0}–${k1} Kowens, Kusing and more; then it hides again.`],
    [d.biikko.name, `A ${d.biikko.title.toLowerCase()} pumpkin wanders ${mapName(d.biikko.map)} (Lv ${d.biikko.level}). It never fights back: fell it with your party for its loot, maybe a Witch Hat or Robe.`],
    [d.manananggal.name, `Now and then her lower half waits in ${mapName('town')} and her upper half flies over ${mapName(d.manananggal.upper.map)}. Defeat the upper half, carry it back and reunite them.`],
  ];
  // (A wide box, `.hw-panel`: a row per activity, its name over its words.)
  const panel = el('div', 'hw-panel');
  const head = el('div', 'rw-graphic');
  if (icons) head.append(picture(url(icons.icon64), 64));
  head.append(el('p', 'hw-ends', `Until ${eventEndDay(d)}`));
  panel.append(head);
  for (const [name, text] of lines) {
    const row = el('div', 'hw-act');
    row.append(el('b', '', name), el('p', '', text));
    panel.append(row);
  }
  return showPopup({ title: d.name, body: [panel], button: 'Close', celebrate: false, closeX: true });
}

function mapName(id: string): string {
  return id === 'town' ? 'the town' : id === 'slums' ? 'the Slums' : id;
}

function picture(src: string, size: number): HTMLImageElement {
  const img = el('img', 'hw-pic');
  img.src = src;
  img.alt = '';
  img.width = img.height = size;
  return img;
}

/** A find's or a reunite's pop-up: "Congratulations!", the 64 px Mikko, what happened, then each reward on its line. */
export function showHalloweenReward(kind: 'mikko' | 'reunite', r: HalloweenReward, d: HalloweenData | null): Promise<void> {
  const head = el('div', 'rw-graphic');
  // (Mikko for a find, the Manananggal for a reunite)
  const art = kind === 'reunite' ? (icons?.manananggal64 ?? icons?.icon64) : icons?.icon64;
  if (art) head.append(picture(url(art), 64));
  const message = kind === 'mikko' ? `You found ${d?.mikko.name ?? 'Mikko Kalabasa'}!` : `You reunited the ${d?.manananggal.name ?? 'Manananggal'}!`;
  const list = el('ul', 'hw-rewards');
  const row = (icon: HTMLElement, text: string) => {
    const li = el('li');
    li.append(icon, el('span', '', text));
    list.append(li);
  };
  if (r.kowens) row(coinIcon(1), `${r.kowens.toLocaleString('en')} ${r.kowens === 1 ? 'Kowen' : 'Kowens'}`);
  if (r.kusing) row(kusingIcon(1), `${r.kusing.toLocaleString('en')} Kusing`);
  if (r.repairKits) {
    const kit = anyDef('low-repair-kit');
    const name = kit?.name ?? 'Low Repair Kit';
    row(kit?.showcase ? picture(url(kit.showcase), 16) : el('span'), `${name}${r.repairKits > 1 ? ` ×${r.repairKits}` : ''}${r.kitsByMail ? ' (by mail: your bag was full)' : ''}`);
  }
  if (r.potion) row(picture(url(EVENT_POTIONS[r.potion].icon), 16), EVENT_POTIONS[r.potion].name);
  return showPopup({ title: 'Congratulations!', body: [head, el('p', 'rw-message', message), list], button: 'OK', celebrate: true, sound: 'coin' });
}
