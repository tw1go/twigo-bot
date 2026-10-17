import { EVENT_POTIONS, type HalloweenData, type HalloweenReward, eventEndDay } from '@mikazuki/shared';
import { anyDef } from '../net/adventure';
import { coinIcon, el, kusingIcon, showPopup } from './reward';

// 🎃 The Halloween event's own UI (CONTEXT.md Event, Mikko Kalabasa, Biikko Kalabasa, Manananggal): the HUD badge while
// it's on (top right, under the buttons: the 16 px Mikko and "Halloween · ends Nov 4"; a click opens a panel with a line
// per activity), and the pop-ups for a find and a reunite (the 64 px Mikko, then each reward with its picture). Every
// number in them is halloween.json's.

const url = (file: string) => `${import.meta.env.BASE_URL}assets/${file}`;

/** The event's pictures (manifest ui.eventHalloween), set by the town. */
let icons: { icon16: string; icon32: string; icon64: string } | null = null;
export const setHalloweenArt = (a: typeof icons) => (icons = a);

/** The 16 px Mikko (event lines in the chat and the badge), or null without its art. */
export const mikkoIcon16 = (): string | null => (icons ? url(icons.icon16) : null);

let badge: HTMLButtonElement | null = null;

/** Shows the badge while the event is on (`data` and `on`), hides it while it's off. */
export function setHalloweenBadge(data: HalloweenData | null, on: boolean): void {
  if (!data || !on) {
    badge?.remove();
    badge = null;
    return;
  }
  if (badge?.isConnected) return;
  const slot = document.querySelector('#town-hud .th-event');
  if (!slot) return;
  const b = el('button', 'th-halloween');
  b.type = 'button';
  if (icons) {
    const img = el('img', 'hw-icon');
    img.src = url(icons.icon16);
    img.alt = '';
    b.append(img);
  }
  b.append(el('span', 'hw-text', `Halloween · ends ${eventEndDay(data)}`));
  b.title = `${data.name}: what's on`;
  b.addEventListener('click', () => void openPanel(data));
  slot.append(b);
  badge = b;
}

/** A line per activity, from the event's own words and numbers. */
function openPanel(d: HalloweenData): Promise<void> {
  const [k0, k1] = d.mikko.rewards.kowens;
  const lines: [string, string][] = [
    [d.mikko.name, `A golden pumpkin hides somewhere in ${d.mikko.maps.map(mapName).join(' or ')}. The first to click it gets ${k0}–${k1} Kowens, Kusing and more; then it hides again.`],
    [d.biikko.name, `A ${d.biikko.title.toLowerCase()} pumpkin wanders ${mapName(d.biikko.map)} (Lv ${d.biikko.level}). It never fights back: fell it with your party for its loot, maybe a Witch Hat or Robe.`],
    [d.manananggal.name, `Now and then her lower half waits in ${mapName('town')} and her upper half flies over ${mapName(d.manananggal.upper.map)}. Defeat the upper half, carry it back and reunite them.`],
  ];
  const body = lines.map(([name, text]) => {
    const p = el('p', 'hw-line');
    p.append(el('b', '', `${name}: `), text);
    return p;
  });
  const head = el('div', 'rw-graphic');
  if (icons) head.append(picture(url(icons.icon64), 64));
  head.append(el('p', 'hw-ends', `Until ${eventEndDay(d)}`));
  return showPopup({ title: d.name, body: [head, ...body], button: 'Close', celebrate: false, closeX: true });
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
  if (icons) head.append(picture(url(icons.icon64), 64));
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
