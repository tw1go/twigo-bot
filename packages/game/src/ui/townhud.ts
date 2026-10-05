import type { MeDig, MeResponse, PresenceStatus, PreregStatus } from '@mikazuki/shared';
import { renderPrereg } from '../hud';
import { fakeLogin, loadMe } from '../session';
import { playSound } from '../audio/sound';
import { jackpotTimer } from './jackpot-timer';
import { hasUnread, loadNews, showNews } from './news';
import { showSettings } from './settings';

// The town's HUD (replaces the page's login corner while you're in town): your character's head and name top left,
// in the game's pixel frame with the Settings button under them; Kowens and shovels top right, each with a "+" that
// explains how to get more. DOM text only. The numbers refresh every minute and whenever a "+" is opened.

export interface TownHudOptions {
  /** The member, or null for a guest (then only the name shows). */
  me: MeResponse | null;
  name: string;
  avatar: HTMLCanvasElement | null;
  /** The game's item frame (nine-slice) for the profile box. */
  frame: { url: string; slice: number } | null;
  /** The Kowen coin: a frame of the emote sheet. */
  coin: Sprite | null;
  /** The status dots (manifest ui.statusDots), by status. */
  dots: (Sprite & { names: string[] }) | null;
  /** The shovel counter's icon (manifest ui.shovelIcon). */
  shovel: string | null;
  /** The Settings button's gear (manifest ui.settingsIcon). */
  gear: string | null;
  /** The news button's megaphone (manifest ui.newsIcon). */
  megaphone: string | null;
  /** The jackpot counter's icon (manifest ui.jackpotIcon); the Kowen coin without it. */
  ticket: string | null;
}

/** One frame of a strip of square frames. */
interface Sprite {
  url: string;
  frame: number;
  size: number;
  frames: number;
}

/** A frame of a sprite strip as a CSS background, at a whole-number scale. */
function spriteStyle(node: HTMLElement, s: Sprite, scale: number): void {
  node.style.backgroundImage = `url("${s.url}")`;
  node.style.backgroundSize = `${s.size * s.frames * scale}px ${s.size * scale}px`;
  node.style.backgroundPosition = `-${s.frame * s.size * scale}px 0`;
  node.style.width = node.style.height = `${s.size * scale}px`;
}

const REFRESH_MS = 60_000;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** How to get Kowens (the bot's /twigo-help "Earn Kowens" is the full list; keep these in step with it). */
const EARN = [
  ['/get-kowens', '5 Kowens once a day'],
  ['Voice chat', '1 Kowen per 15 min, up to 12 a day (with someone else, not deafened)'],
  ['Weekly voice top 10', '50 · 30 · 20 · 10 Kowens, Mondays 12 PM'],
  ['Boost the server', '+20 per boost, and 20 × your boosts every month'],
  ['/dig', 'find items, then /sell them'],
  ["/claim", "Kowens found in twigo's room (3 a day)"],
];

export function mountTownHud(o: TownHudOptions): void {
  document.getElementById('hud')?.setAttribute('hidden', ''); // the page's login corner
  document.getElementById('town-hud')?.remove();
  const root = el('div');
  root.id = 'town-hud';

  // ── profile (top left) ──
  const profile = el('div', 'th-profile');
  if (o.frame) {
    profile.classList.add('th-framed');
    profile.style.setProperty('--frame', `url("${o.frame.url}")`);
    profile.style.setProperty('--slice', String(o.frame.slice));
  }
  const face = el('span', 'th-avatar');
  if (o.avatar) face.append(roundAvatar(o.avatar));
  // The status dot sits on the ring's lower right, at the avatar's pixel scale (updated with the counters).
  const dot = el('span', 'th-status');
  const setStatus = (status: PresenceStatus | undefined) => {
    dot.hidden = !status || !o.dots?.names.includes(status);
    if (dot.hidden || !o.dots || !status) return;
    spriteStyle(dot, { ...o.dots, frame: o.dots.names.indexOf(status) }, 2);
    dot.title = status === 'busy' ? 'Do not disturb' : status[0].toUpperCase() + status.slice(1);
    dot.setAttribute('aria-label', dot.title);
  };
  setStatus(o.me?.status);
  face.append(dot);
  profile.append(face, el('span', 'th-name', o.name));
  const settings = el('button', 'th-settings');
  if (o.gear) {
    const gear = el('img', 'th-gear');
    gear.src = o.gear;
    gear.alt = '';
    settings.append(gear);
  } else settings.textContent = '⚙';
  settings.setAttribute('aria-label', 'Settings');
  settings.setAttribute('aria-haspopup', 'dialog');
  settings.title = 'Settings';
  settings.addEventListener('click', () => showSettings({ loggedIn: !!o.me, onClose: () => settings.focus() }));
  // News (announcements and patch notes), with a dot while there's something new.
  const news = el('button', 'th-settings th-news');
  if (o.megaphone) {
    const icon = el('img', 'th-gear');
    icon.src = o.megaphone;
    icon.alt = '';
    news.append(icon);
  } else news.textContent = '📣';
  const unread = el('span', 'th-news-dot');
  unread.hidden = true;
  news.append(unread);
  news.setAttribute('aria-label', 'News');
  news.setAttribute('aria-haspopup', 'dialog');
  news.title = 'News';
  news.addEventListener('click', () => showNews({ onSeen: () => (unread.hidden = true) }));
  if (o.me || fakeLogin()) void loadNews().then((n) => (unread.hidden = !n || !hasUnread(n)));
  // Top left: the profile with the Kowens and shovel counters beside it; top right: the jackpot counter, News and Settings.
  const left = el('div', 'th-left');
  const row = el('div', 'th-row');
  row.append(profile);
  left.append(row);
  // Top right: the jackpot counter and the minimap side by side (ui/minimap.ts fills the slot), News and Settings under
  // the map.
  const corner = el('div', 'th-corner');
  const top = el('div', 'th-top');
  top.append(el('div', 'th-map'));
  const buttons = el('div', 'th-buttons');
  buttons.append(news, settings);
  corner.append(top, buttons);
  root.append(left, corner);

  if (o.me || fakeLogin()) {
    // The jackpot counter: the jackpot icon, else the Kowen coin.
    let icon: HTMLElement;
    if (o.ticket) {
      icon = el('img', 'jt-icon');
      (icon as HTMLImageElement).src = o.ticket;
      (icon as HTMLImageElement).alt = '';
    } else {
      icon = el('span', 'th-coin jt-icon');
      if (o.coin) spriteStyle(icon, o.coin, 2);
      else icon.textContent = '🪙';
    }
    // Left of the minimap on wide screens; on phones under the Kowens and shovels, where there's room for the whole board.
    const timer = jackpotTimer(icon);
    const phone = matchMedia('(max-width: 560px)');
    const place = () => (phone.matches ? left.insertBefore(timer, row.nextSibling) : top.prepend(timer));
    phone.addEventListener('change', place);
    place();
  }

  if (o.me) {
    void fetch('/prereg')
      .then((r) => (r.ok ? (r.json() as Promise<PreregStatus>) : null))
      .catch(() => null)
      .then((prereg) => o.me && renderPrereg(left, o.me, prereg));
  }

  // ── Kowens and shovels (beside the profile) ──
  if (o.me) {
    const right = el('div', 'th-counters');
    const coin = el('span', 'th-coin');
    if (o.coin) spriteStyle(coin, o.coin, 2);
    else coin.textContent = '🪙';
    const kowens = el('span', 'th-count');
    const shovels = el('span', 'th-count');
    const earn = el('div', 'th-pop th-earn');
    const dig = el('div', 'th-pop th-dig');
    earn.hidden = dig.hidden = true;

    const counter = (icon: HTMLElement, count: HTMLElement, label: string, pop: HTMLElement) => {
      const box = el('div', 'th-counter');
      const plus = el('button', 'th-plus', '+');
      plus.setAttribute('aria-label', label);
      plus.setAttribute('aria-expanded', 'false');
      plus.addEventListener('click', () => {
        toggle(pop, plus);
        if (!pop.hidden) void refresh();
      });
      box.append(icon, count, plus, pop);
      return box;
    };
    right.append(
      counter(coin, kowens, 'How to get Kowens', earn),
      counter(shovelIcon(o.shovel), shovels, 'Digs left', dig),
    );

    earn.append(el('div', 'th-pop-title', 'How to get Kowens'));
    for (const [what, how] of EARN) {
      const row = el('div', 'th-row');
      row.append(el('b', undefined, what), el('span', undefined, ` ${how}`));
      earn.append(row);
    }
    earn.append(el('div', 'th-pop-note', 'Commands are used in the Discord server.'));

    let shown: number | null = null;
    const show = (me: MeResponse) => {
      if (shown !== null && me.kowens > shown) playSound('coin'); // Kowens came in since the last look
      shown = me.kowens;
      setStatus(me.status);
      kowens.textContent = me.kowens.toLocaleString();
      kowens.title = plural(me.kowens, 'Kowen', 'Kowens');
      shovels.textContent = String(me.dig.shovel);
      renderDig(dig, me.dig);
    };
    const refresh = async () => {
      const me = await loadMe(true);
      if (me.status === 'ok') show(me.me);
    };
    show(o.me);
    setInterval(() => void refresh(), REFRESH_MS);
    window.addEventListener('mk-wallet', () => void refresh()); // something in town spent or paid Kowens
    row.append(right);
  }

  // Popovers close on Escape or a click elsewhere.
  document.addEventListener('click', (e) => {
    for (const pop of root.querySelectorAll<HTMLElement>('.th-pop')) {
      if (!pop.hidden && !pop.parentElement!.contains(e.target as Node)) close(pop);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') for (const pop of root.querySelectorAll<HTMLElement>('.th-pop')) close(pop);
  });
  document.body.append(root);
}

function renderDig(pop: HTMLElement, d: MeDig): void {
  pop.replaceChildren(
    el('div', 'th-pop-title', 'Digging'),
    el('div', 'th-row', `${plural(d.shovel, 'dig', 'digs')} left on your shovel`),
    el('div', 'th-row', `${d.digsLeft} of ${d.digsPerDay} digs left today`),
    el('div', 'th-row', d.shovelsLeft ? `${plural(d.shovelsLeft, 'more shovel', 'more shovels')} to buy today` : 'No more shovels to buy today'),
    el('div', 'th-pop-note', `Dig with /dig · buy a shovel with /redeem reward:Shovel (${plural(d.shovelCost, 'Kowen', 'Kowens')}, ${d.shovelUses} digs)`),
  );
}

function toggle(pop: HTMLElement, button?: HTMLElement): void {
  if (pop.hidden) {
    pop.hidden = false;
    button?.setAttribute('aria-expanded', 'true');
  } else close(pop);
}

function close(pop: HTMLElement): void {
  pop.hidden = true;
  pop.parentElement?.querySelector('.th-plus')?.setAttribute('aria-expanded', 'false');
}

/** The head in a pixel circle: a dark slot, a violet ring with gold studs at the four points, and a dark outline
 *  (the item frame's colours), drawn pixel by pixel so it scales crisply. */
function roundAvatar(head: HTMLCanvasElement): HTMLCanvasElement {
  const size = head.width + 6; // 3 px around the head: slot edge, ring, outline
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const mid = size / 2;
  const r = size / 2;
  const at = (x: number, y: number) => Math.hypot(x + 0.5 - mid, y + 0.5 - mid);
  const px = (x: number, y: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  };
  // The slot, then the head clipped to it.
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (at(x, y) < r - 2) px(x, y, '#1E1B3A');
  const inner = document.createElement('canvas');
  inner.width = inner.height = size;
  const ictx = inner.getContext('2d')!;
  ictx.drawImage(head, 3, 4);
  const img = ictx.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (at(x, y) >= r - 2) img.data[(y * size + x) * 4 + 3] = 0;
  ictx.putImageData(img, 0, 0);
  ctx.drawImage(inner, 0, 0);
  // Ring and outline.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = at(x, y);
      if (d >= r - 2 && d < r - 1) px(x, y, '#7C2AE8');
      else if (d >= r - 1 && d < r) px(x, y, '#1E1B3A');
    }
  }
  // Gold studs at north, east, south and west.
  const m = Math.floor(mid);
  for (const [x, y] of [[m, 1], [size - 2, m], [m, size - 2], [1, m]]) px(x, y, '#F8BF27');
  return c;
}

/** The shovel counter's icon: the art, or a fallback if it's missing. */
function shovelIcon(url: string | null): HTMLElement {
  if (!url) return el('span', 'th-shovel', '🪏');
  const img = el('img', 'th-shovel-img');
  img.src = url;
  img.alt = '';
  return img;
}
