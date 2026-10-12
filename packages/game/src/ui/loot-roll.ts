import { type Item, nameColour } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { itemData } from '../net/adventure';
import { itemPicture, nameOf } from './item-tip';
import { el } from './reward';

// 🎲 Rare loot a party rolls for (the server's `loot-roll`; shared loot-roll.ts says which items): a box in the invites'
// stack, top centre, in gold: the item (its icon and name in its colour), how many are asked, Roll / Pass and a bar for
// the time left. Answered (or out of time), the buttons give way to your own line ("You rolled 412"); everyone's answers
// show as they come ("Mara rolled 873", "Ana passed"); the end names the winner under them (or that nobody rolled, so
// it's on the ground for you all) and the box goes a moment later. The winner's bag gets it (the usual items line and sound); the
// rest see a feed line (`rollEndLine`).

const CLOSE_MS = 3500;
const PINK = '#F9A8D4';

interface RollBox {
  box: HTMLElement;
  row: HTMLElement;
  list: HTMLElement;
  timer: HTMLElement;
  done: boolean;
}

export interface RollEnd {
  id: string;
  item: Item;
  winner?: string;
  roll?: number;
  yours?: boolean;
  full?: boolean;
}

class LootRollBoxes {
  private readonly boxes = new Map<string, RollBox>();

  show(o: { id: string; item: Item; ms: number; players: string[]; answer(roll: boolean): void }): void {
    this.boxes.get(o.id)?.box.remove();
    const box = el('div', 'pt-invite lr-roll');
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-label', `Roll for ${nameOf(o.item)}`);
    const head = el('div', 'lr-item');
    const name = el('b', 'lr-name', nameOf(o.item));
    name.style.color = colourOf(o.item);
    head.append(itemPicture(o.item, 'icon', 2), name);
    const text = el('p', 'pt-invite-text', `Dropped for ${o.players.length} of you. The highest roll takes it.`);
    const row = el('div', 'pt-invite-row');
    const no = el('button', 'pt-no', 'Pass');
    const yes = el('button', 'pt-yes', 'Roll');
    row.append(no, yes);
    const list = el('ul', 'lr-list');
    const timer = el('span', 'pt-invite-bar');
    timer.style.animationDuration = `${o.ms}ms`;
    box.append(head, text, row, list, timer);
    stack().append(box);
    playSound('click');
    const entry: RollBox = { box, row, list, timer, done: false };
    this.boxes.set(o.id, entry);
    const decide = (roll: boolean) => {
      if (entry.done) return;
      entry.done = true;
      playSound('click');
      row.replaceChildren(el('span', 'lr-you', roll ? 'Rolling…' : 'You passed.'));
      o.answer(roll);
    };
    yes.addEventListener('click', () => decide(true));
    no.addEventListener('click', () => decide(false));
    // Out of time: the buttons go (the server counts you as passing).
    setTimeout(() => {
      if (entry.done) return;
      entry.done = true;
      row.replaceChildren(el('span', 'lr-you', 'Too late: you passed.'));
    }, o.ms);
  }

  /** Someone's answer (yours: your own line in place of the buttons). */
  rolled(m: { id: string; name: string; roll: number | null; you?: boolean }): void {
    const e = this.boxes.get(m.id);
    if (!e) return;
    if (m.you) return void e.row.replaceChildren(el('span', 'lr-you', m.roll === null ? 'You passed.' : `You rolled ${m.roll}`));
    const li = el('li');
    li.append(el('b', undefined, m.name), m.roll === null ? ' passed' : ` rolled ${m.roll}`);
    e.list.append(li);
  }

  end(m: RollEnd): void {
    const e = this.boxes.get(m.id);
    if (!e) return;
    e.done = true;
    e.timer.remove();
    const line = m.winner ? (m.yours ? `You win it with ${m.roll}!` : `${m.winner} wins it with ${m.roll}.`) : "Nobody rolled: it's on the ground for you all.";
    // (Under everyone's answers, so your own roll stays in view; the buttons go if they're still up.)
    if (e.row.querySelector('button')) e.row.replaceChildren(el('span', 'lr-you', 'You passed.'));
    e.list.append(el('li', 'lr-win', line));
    setTimeout(() => {
      e.box.remove();
      this.boxes.delete(m.id);
    }, CLOSE_MS);
  }
}

export const lootRolls = new LootRollBoxes();

/** The feed line for a roll someone else won ("Mara won Sturdy Slingshot of Calamity (rolled 873)"), or null. */
export function rollEndLine(m: RollEnd): { text: string; colour: string }[] | null {
  if (!m.winner || m.yours) return null;
  return [
    { text: m.winner, colour: PINK },
    { text: ' won ', colour: '#E6E9F2' },
    { text: nameOf(m.item), colour: colourOf(m.item) },
    { text: ` (rolled ${m.roll})`, colour: '#A9B1D6' },
  ];
}

const colourOf = (item: Item): string => {
  const D = itemData();
  return D ? nameColour(D, item) : '#E6E9F2';
};

/** The invites' stack (ui/party.ts makes it too). */
function stack(): HTMLElement {
  let s = document.getElementById('party-invites');
  if (!s) {
    s = el('div');
    s.id = 'party-invites';
    document.body.append(s);
  }
  return s;
}
