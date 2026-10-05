import type { MeDig, TownDigResponse } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { fakeLogin, fakeName, loadMe } from '../session';
import { type Rarity, RARITY_COLOUR, isRarity, itemArt } from './item-art';
import { installPixelTiles } from './pixel-tiles';
import { el, followWallet, showPopup } from './reward';

// ⛏️ The Mine (left click the mine entrance), in the reward box dressed as stone (pixel tiles: ui/pixel-tiles.ts): digs left today and uses left on your shovel, and a
// Dig button (POST /town/dig, /dig's rules). A find comes back as your feed line, which plays the dig panel over this
// pop-up (ui/dig-panel.ts), and then shows here as a card: its picture, name, rarity and worth. A dig that can't
// happen says why. The pop-up stays open to dig again.

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const LABEL: Record<Rarity, string> = { junk: 'Junk', common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', mythical: 'Mythical', legendary: 'Legendary', secret: 'Secret' };

/** The last find: its picture in its rarity frame, "You dug up", its name in the rarity's colour, rarity and worth. */
function findCard(item: NonNullable<TownDigResponse['item']>): HTMLElement {
  const rarity: Rarity = isRarity(item.rarity) ? item.rarity : 'common';
  const card = el('div', `mn-find mn-${rarity}`);
  card.style.setProperty('--rarity', RARITY_COLOUR[rarity]);
  const pic = itemArt(item.id, rarity, 'showcase', 2);
  const text = el('div', 'mn-find-text');
  const name = el('div', 'mn-find-name', item.name);
  name.style.color = RARITY_COLOUR[rarity];
  text.append(el('div', 'mn-find-head', 'You dug up'), name, el('div', 'mn-find-meta', `${LABEL[rarity]} · worth ${plural(item.value, 'Kowen', 'Kowens')}`));
  if (pic) card.append(pic);
  card.append(text);
  return card;
}

async function dig(): Promise<TownDigResponse | null> {
  if (fakeLogin()) return fakeDig();
  const res = await fetch('/town/dig', { method: 'POST', credentials: 'same-origin' }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownDigResponse) : null;
}

export function showMine(): void {
  installPixelTiles();
  const digs = el('div', 'mn-stat');
  const shovel = el('div', 'mn-stat');
  const button = el('button', 'mn-dig', 'Dig');
  const note = el('div', 'bk-note mn-note');
  note.setAttribute('role', 'status');
  const found = el('div', 'mn-found');
  const wrap = el('div', 'mn-body');
  const stats = el('div', 'mn-stats');
  stats.append(digs, shovel);
  wrap.append(stats, found, button, note, el('p', 'mn-hint', 'Each dig uses your shovel once. Buy shovels at the rewards shop; finds go to your bag (sell them with /sell in Discord).'));

  let busy = false;
  const render = (d: MeDig) => {
    const stat = (box: HTMLElement, value: string, label: string) => box.replaceChildren(el('b', undefined, value), el('span', undefined, label));
    stat(digs, `${d.digsLeft}/${d.digsPerDay}`, 'digs left today');
    stat(shovel, String(d.shovel), d.shovel === 1 ? 'use left on your shovel' : 'uses left on your shovel');
    button.disabled = busy;
  };
  const say = (text: string, ok: boolean) => {
    note.textContent = text;
    note.classList.toggle('bk-refused', !ok);
  };
  const showFind = (item: TownDigResponse['item']) => found.replaceChildren(...(item ? [findCard(item)] : []));

  button.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    say('Digging…', true);
    showFind(undefined);
    const res = await dig();
    busy = false;
    button.disabled = false;
    if (!res) {
      playSound('error');
      return say("Couldn't reach the Mine. Try again in a moment.", false);
    }
    render(res.dig);
    if (!res.ok) {
      playSound('error');
      return say(res.message, false);
    }
    // The dig panel plays from the feed line; the find stays here as a card.
    say('', true);
    showFind(res.item);
    window.dispatchEvent(new Event('mk-wallet')); // the HUD's shovel counter
  });

  const closed = showPopup({ title: 'Mine', body: [wrap], button: 'Close', celebrate: false, sound: 'door' });
  followWallet(closed, () => !busy && void loadMe(true).then((me) => me.status === 'ok' && !busy && render(me.me.dig)));
  void loadMe(true).then((me) => {
    if (me.status === 'ok') render(me.me.dig);
    else say('Log in to dig.', false);
  });
}

// ── Dev: a pretend dig (no bot behind the dev server). The find goes through the dev town as your feed line, so the
// dig panel plays as it does live. ──

const DEV_FINDS: [string, string, string][] = [
  ['rock', 'Rock', 'junk'],
  ['bottle-cap', 'Bottle Cap', 'common'],
  ['kalamansi', 'Kalamansi', 'uncommon'],
  ['nokia-3310', 'Nokia 3310', 'rare'],
  ['karaoke-mic', 'Karaoke Mic', 'epic'],
  ['barong', 'Barong', 'mythical'],
  ['twigo-treasure', "twigo's Treasure", 'legendary'],
];
const fakeState = { digs: Number(new URLSearchParams(location.search).get('digs') ?? 7), shovel: Number(new URLSearchParams(location.search).get('shovels') ?? 6) };

async function fakeDig(): Promise<TownDigResponse> {
  const d = (): MeDig => ({ shovel: fakeState.shovel, digsLeft: fakeState.digs, digsPerDay: 9, shovelsLeft: 2, shovelCost: 2, shovelUses: 3 });
  if (fakeState.shovel <= 0) return { ok: false, message: 'You need a shovel to dig. Get one at the rewards shop (2 Kowens).', dig: d() };
  if (fakeState.digs <= 0) return { ok: false, message: "You've dug 9 times today. Your arms need a rest! Come back tomorrow.", dig: d() };
  fakeState.digs--;
  fakeState.shovel--;
  const pick = new URLSearchParams(location.search).get('find');
  const [id, name, rarity] = DEV_FINDS.find(([i]) => i === pick) ?? DEV_FINDS[Math.floor(Math.random() * DEV_FINDS.length)];
  const q = new URLSearchParams({ kind: 'dig', tone: rarity, text: `${fakeName()} dug up ${name}`, itemId: id, itemName: name, as: fakeName() });
  await fetch(`/__system?${q}`).catch(() => null);
  return { ok: true, message: `You dug up ${name}.`, dig: d(), item: { id, name, rarity, value: 1 } };
}
