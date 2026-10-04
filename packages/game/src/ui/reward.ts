import type { TitleData } from '@mikazuki/shared';

// 🎁 The reward pop-up: the town dims, golden rays turn slowly behind a white box in the game's pixel frame, and
// the box shows what you got — a title, Kowens, or a picture — with a congratulations line and a cheerful button.
// Several rewards queue up and show one after another. DOM text only.

export type RewardGraphic =
  | { kind: 'title'; title: TitleData }
  | { kind: 'kowens'; amount: number }
  | { kind: 'image'; url: string; alt: string };

export interface Reward {
  title: string;
  graphic: RewardGraphic;
  message: string;
}

/** Art from the manifest, set once by the town: the item frame (nine-slice) and the Kowen coin (an emote frame). */
interface RewardArt {
  frame: { url: string; slice: number } | null;
  coin: { url: string; frame: number; size: number; frames: number } | null;
}

const CHEERS = ['Great!', 'Nice!', 'Awesome!', 'Sweet!', 'Yay!', 'Woohoo!', 'Amazing!', 'Lovely!'];

let art: RewardArt = { frame: null, coin: null };
/** A pop-up in the reward box: a heading, content, and a button; rewards add the rays and casino lights. */
export interface Popup {
  title: string;
  body: HTMLElement[];
  button: string;
  celebrate: boolean;
}

const queue: { popup: Popup; done: () => void }[] = [];
let showing = false;

export function setRewardArt(a: RewardArt): void {
  art = a;
  if (a.frame) void whiteFrame(a.frame.url).then((url) => url && art.frame && (art.frame = { ...art.frame, url }));
}

/** The item frame with its dark fill (the colour at its centre) painted white, for the white pop-up. */
async function whiteFrame(url: string): Promise<string | null> {
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  const mid = (Math.floor(c.height / 2) * c.width + Math.floor(c.width / 2)) * 4;
  const [r, g, b] = [d[mid], d[mid + 1], d[mid + 2]];
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] && d[i] === r && d[i + 1] === g && d[i + 2] === b) d[i] = d[i + 1] = d[i + 2] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return c.toDataURL();
}

/** Shows a reward (after any already showing); resolves when it's dismissed. */
export function showReward(reward: Reward): Promise<void> {
  return showPopup({
    title: reward.title,
    body: [graphic(reward.graphic), el('p', 'rw-message', reward.message)],
    button: CHEERS[Math.floor(Math.random() * CHEERS.length)],
    celebrate: true,
  });
}

/** Shows a pop-up in the reward box (after any already showing); resolves when it's dismissed. */
export function showPopup(popup: Popup): Promise<void> {
  return new Promise((done) => {
    queue.push({ popup, done });
    if (!showing) next();
  });
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function next(): void {
  const item = queue.shift();
  showing = !!item;
  if (!item) return;
  const { popup, done } = item;

  const root = el('div');
  root.id = 'reward';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', popup.title);
  const stage = el('div', 'rw-stage');
  const rays = el('div', 'rw-rays');
  rays.setAttribute('aria-hidden', 'true');
  const card = el('div', 'rw-card');
  if (art.frame) {
    card.classList.add('rw-framed');
    card.style.setProperty('--frame', `url("${art.frame.url}")`);
    card.style.setProperty('--slice', String(art.frame.slice));
  }

  const button = el('button', 'rw-ok', popup.button);
  if (popup.celebrate) {
    // Casino lights in their own marquee box over the top edge, every other one lit, swapping.
    const lights = el('div', 'rw-lights');
    lights.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 9; i++) lights.append(el('span', i % 2 ? 'rw-bulb rw-odd' : 'rw-bulb'));
    card.append(lights);
  }
  card.append(el('h2', 'rw-title', popup.title), ...popup.body, button);
  if (popup.celebrate) stage.append(rays);
  stage.append(card);
  root.append(stage);
  document.body.append(root);
  button.focus();

  const close = () => {
    document.removeEventListener('keydown', keys);
    root.classList.add('rw-out');
    setTimeout(() => {
      root.remove();
      done();
      next();
    }, 180);
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      close();
    }
  };
  button.addEventListener('click', close);
  document.addEventListener('keydown', keys);
}

function graphic(g: RewardGraphic): HTMLElement {
  const box = el('div', 'rw-graphic');
  if (g.kind === 'title') {
    const panel = el('div', 'rw-new-title');
    const t = el('span', undefined, `<${g.title.name}>`);
    if (g.title.color === 'prismatic') t.classList.add('prismatic');
    else t.style.color = g.title.color;
    panel.append(t);
    box.append(panel);
  } else if (g.kind === 'kowens') {
    const coin = el('span', 'rw-coin');
    const c = art.coin;
    if (c) {
      const z = 5;
      coin.style.backgroundImage = `url("${c.url}")`;
      coin.style.backgroundSize = `${c.size * c.frames * z}px ${c.size * z}px`;
      coin.style.backgroundPosition = `-${c.frame * c.size * z}px 0`;
      coin.style.width = coin.style.height = `${c.size * z}px`;
    }
    box.append(coin, el('div', 'rw-amount', `+${g.amount.toLocaleString()} ${g.amount === 1 ? 'Kowen' : 'Kowens'}`));
  } else {
    const img = el('img', 'rw-image');
    img.src = g.url;
    img.alt = g.alt;
    box.append(img);
  }
  return box;
}
