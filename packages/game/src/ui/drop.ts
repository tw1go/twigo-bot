import type { Item } from '@mikazuki/shared';
import { RARITY_TEXT } from './item-art';
import { itemPicture, nameOf, rarityOf } from './item-tip';

// 🫳 Dropping an item from the combat bag (dragged onto the map; TownScene sends `drop`): a confirm box in the forge's
// style with the item, how many (a stack: a number box, all of it to start with), who may pick it up (your party, or
// anyone) and that it's gone after 2 minutes. Resolves how many to drop, or null.

export function confirmDrop(item: Item, party: boolean): Promise<number | null> {
  return new Promise((resolve) => {
    const back = el('div', 'fg-confirm-back');
    const box = el('div', 'fg-confirm');
    box.setAttribute('role', 'alertdialog');
    const title = el('div', 'fg-confirm-title dr-title');
    title.append(itemPicture(item, 'icon', 2), 'Drop ', Object.assign(el('b', undefined, nameOf(item)), { style: `color: ${RARITY_TEXT[rarityOf(item)]}` }), '?');
    const parts: HTMLElement[] = [title];
    const count = Object.assign(el('input', 'dr-count'), { type: 'number', min: '1', max: String(item.count), value: String(item.count) });
    if (item.count > 1) {
      const row = el('label', 'fg-confirm-sub dr-row');
      row.append('How many ', count, ` of ${item.count}`);
      parts.push(row);
    }
    parts.push(el('div', 'fg-confirm-sub', party ? 'Only your party can pick it up.' : 'Anyone can pick it up.'));
    parts.push(el('div', 'fg-warn', 'It disappears after 2 minutes on the ground.'));
    const row = el('div', 'fg-actions');
    const yes = el('button', 'fg-go fg-ready fg-danger', 'Drop');
    const no = el('button', 'fg-go', 'Cancel');
    const done = (n: number | null) => {
      back.remove();
      document.removeEventListener('keydown', key, true);
      resolve(n);
    };
    const go = () => {
      const n = Math.floor(Number(count.value));
      if (n >= 1 && n <= item.count) done(n);
      else count.focus();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        done(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        go();
      }
    };
    yes.addEventListener('click', go);
    no.addEventListener('click', () => done(null));
    back.addEventListener('click', (e) => e.target === back && done(null));
    document.addEventListener('keydown', key, true);
    row.append(yes, no);
    box.append(...parts, row);
    back.append(box);
    document.body.append(back);
    if (item.count > 1) count.select();
    else yes.focus();
  });
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
