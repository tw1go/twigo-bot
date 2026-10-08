import { playSound } from '../audio/sound';
import { type Rarity, RARITY_LABEL as LABEL, RARITY_TEXT, isRarity, itemArt } from './item-art';
import { showReward } from './reward';

// ⛏️ The dig panel: when you dig (at the Mine, or /dig in Discord while you're in town), the town dims and the dig
// plays once in the middle of the screen at the UI's whole-number scale — the shovel digs, and from the manifest's
// itemFrom cell your find rises out of the hole with its rarity glow (Epic or better shakes the panel). The last cell
// holds with the find's name and rarity under it; a click or 2.5 s closes it. Digs that arrive meanwhile queue up.
// Without the panel art it falls back to the reward pop-up with the item's picture.

export interface DigPanelArt {
  url: string;
  size: [number, number];
  frames: number;
  fps: number;
  hole: [number, number];
  itemFrom: number;
}

export interface Find {
  itemId: string;
  name: string;
  rarity: string;
}

const RISE = 8; // art px
const RISE_FRAMES = 4;
const HOLD_MS = 2500;
const BIG: Rarity[] = ['epic', 'mythical', 'legendary', 'secret'];

let art: DigPanelArt | null = null;
const queue: Find[] = [];
let playing = false;

export function setDigPanelArt(a: DigPanelArt | null): void {
  art = a;
}

/** Plays a dig (after any already playing). */
export function playDig(find: Find): void {
  queue.push(find);
  if (!playing) void next();
}

async function next(): Promise<void> {
  const find = queue.shift();
  playing = !!find;
  if (!find) return;
  await (art ? panel(art, find) : fallback(find));
  void next();
}

/** No panel art: the reward pop-up, with the find's picture when it has one. */
function fallback(find: Find): Promise<void> {
  const rarity = isRarity(find.rarity) ? find.rarity : 'common';
  return showReward({
    title: 'You dug up…',
    graphic: { kind: 'item', id: find.itemId, name: find.name, rarity },
    message: `${LABEL[rarity]} find`,
  });
}

/** The UI's whole-number scale for the panel: 3× where it fits, else 2× (else 1×). */
function scaleFor(w: number, h: number): number {
  for (const s of [3, 2]) if (w * s <= window.innerWidth - 32 && h * s + 80 <= window.innerHeight - 32) return s;
  return 1;
}

function panel(a: DigPanelArt, find: Find): Promise<void> {
  return new Promise((done) => {
    const rarity: Rarity = isRarity(find.rarity) ? find.rarity : 'common';
    const [w, h] = a.size;
    const s = scaleFor(w, h);
    const root = document.createElement('div');
    root.id = 'dig-panel';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', `You dug up ${find.name}`);
    const box = document.createElement('div');
    box.className = 'dp-box';
    box.style.width = `${w * s}px`;
    box.style.height = `${h * s}px`;
    const sheet = document.createElement('div');
    sheet.className = 'dp-sheet';
    sheet.style.backgroundImage = `url("${a.url}")`;
    sheet.style.backgroundSize = `${w * a.frames * s}px ${h * s}px`;
    box.append(sheet);

    // The find, hidden until it comes out of the hole: its bottom centre on the hole, then rising.
    const pic = itemArt(find.itemId, rarity, 'showcase', s, true);
    if (pic) {
      pic.classList.add('dp-find');
      const cell = 34 * s; // 32 + the frame's 1 px each side
      pic.style.left = `${a.hole[0] * s - cell / 2}px`;
      pic.style.top = `${a.hole[1] * s - 33 * s}px`;
      pic.style.setProperty('--rise', `${-RISE * s}px`);
      pic.style.transitionDuration = `${(RISE_FRAMES / a.fps) * 1000}ms`;
      box.append(pic);
    }
    const label = document.createElement('div');
    label.className = 'dp-label';
    const name = document.createElement('div');
    name.className = 'dp-name';
    name.textContent = find.name;
    const tier = document.createElement('div');
    tier.className = 'dp-rarity';
    tier.textContent = LABEL[rarity];
    label.style.color = RARITY_TEXT[rarity];
    const head = document.createElement('div');
    head.className = 'dp-head';
    head.textContent = 'You dug up';
    label.append(head, name, tier);
    label.style.marginTop = `${-(h - 116) * s}px`; // the art's empty bottom rows: the text sits right under the mound
    root.append(box, label);
    document.body.append(root);
    playSound('click');

    let frame = 0;
    let timer: ReturnType<typeof setTimeout>;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      root.classList.add('dp-out');
      setTimeout(() => {
        root.remove();
        done();
      }, 180);
    };
    const show = (n: number) => {
      sheet.style.backgroundPosition = `${-n * w * s}px 0`;
      if (n === a.itemFrom) {
        pic?.classList.add('dp-up');
        if (BIG.includes(rarity)) {
          box.classList.add('dp-shake');
          box.style.setProperty('--shake', `${Math.min(2, s)}px`);
        }
      }
    };
    const step = () => {
      show(frame);
      if (frame < a.frames - 1) {
        frame++;
        timer = setTimeout(step, 1000 / a.fps);
      } else {
        label.classList.add('dp-shown'); // hold the last cell with the name
        timer = setTimeout(close, HOLD_MS);
      }
    };
    root.addEventListener('click', close);
    step();
  });
}
