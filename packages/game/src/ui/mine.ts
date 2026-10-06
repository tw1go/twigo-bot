import type { MeDig, TownDigItemsResponse, TownDigResponse } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { fakeLogin, fakeName, loadMe } from '../session';
import { type Rarity, RARITY_COLOUR, isRarity, itemArt } from './item-art';
import { installPixelTiles } from './pixel-tiles';
import { el, followWallet, showPopup } from './reward';

// ⛏️ The Mine (left click the mine entrance), in the reward box dressed as stone (pixel tiles: ui/pixel-tiles.ts): digs left today and uses left on your shovel,
// the server's lucky dig (the dig pity: a bar of the server's digs toward the next, which is Epic or better), and a
// Dig button (POST /town/dig, /dig's rules). A find comes back as your feed line, which plays the dig panel over this
// pop-up (ui/dig-panel.ts), and then shows here as a card: its picture, name, rarity and worth. A dig that can't
// happen says why. The pop-up stays open to dig again. "Items" swaps the pop-up to the tier list: what digs can turn up,
// rarest first, each tier's and item's odds and what it sells for (GET /town/dig-items; secrets stay secret).

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
  const lucky = el('div', 'mn-lucky');
  const listButton = el('button', 'mn-list-btn', '📜 Items');
  listButton.setAttribute('aria-label', 'What you can dig up, by rarity');
  const main = [stats, lucky, found, button, listButton, note, el('p', 'mn-hint', 'Each dig uses your shovel once. Buy shovels at the rewards shop; finds go to your bag (sell them with /sell in Discord).')];
  wrap.append(...main);

  // The tier list, in place of the Mine (Back returns); loaded once per visit.
  let list: Promise<TownDigItemsResponse | null> | null = null;
  const showList = async () => {
    const back = el('button', 'mn-list-btn', '← Back to digging');
    back.addEventListener('click', () => wrap.replaceChildren(...main));
    const box = el('div', 'mn-tiers', 'Loading…');
    wrap.replaceChildren(back, box);
    const data = await (list ??= loadDigItems());
    if (!data) return void (box.textContent = "Couldn't reach the Mine. Try again in a moment.");
    box.replaceChildren(tierList(data));
  };
  listButton.addEventListener('click', () => void showList());

  let busy = false;
  const render = (d: MeDig) => {
    const stat = (box: HTMLElement, value: string, label: string) => box.replaceChildren(el('b', undefined, value), el('span', undefined, label));
    stat(digs, `${d.digsLeft}/${d.digsPerDay}`, 'digs left today');
    stat(shovel, String(d.shovel), d.shovel === 1 ? 'use left on your shovel' : 'uses left on your shovel');
    // The lucky dig: the server's digs so far toward it, as a bar.
    const left = d.luckyEvery - d.lucky;
    const bar = el('div', 'mn-lucky-bar');
    const fill = el('div', 'mn-lucky-fill');
    fill.style.width = `${Math.min(100, (d.lucky / d.luckyEvery) * 100)}%`;
    bar.append(fill);
    const head = el('div', 'mn-lucky-head');
    head.append(el('b', undefined, '🍀 Lucky dig'), el('span', undefined, `${d.lucky}/${d.luckyEvery}`));
    lucky.replaceChildren(
      head,
      bar,
      el('div', 'mn-lucky-hint', left <= 1 ? "The server's next dig is lucky: Epic or better!" : `Every ${d.luckyEvery}th dig on the server is Epic or better. ${left} to go.`),
    );
    lucky.classList.toggle('mn-lucky-next', left <= 1);
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
    say(res.lucky ? `🍀 Lucky dig! The server's ${res.dig.luckyEvery}th dig: Epic or better.` : '', true);
    showFind(res.item);
    window.dispatchEvent(new Event('mk-wallet')); // the HUD's shovel counter
  });

  const closed = showPopup({ title: 'Mine', body: [wrap], button: 'Close', celebrate: false, sound: 'door' });
  const reload = () => !busy && void loadMe(true).then((me) => me.status === 'ok' && !busy && render(me.me.dig));
  followWallet(closed, reload);
  // Others dig too: the lucky dig's bar keeps up while the Mine is open.
  const ticking = setInterval(reload, 20_000);
  void closed.then(() => clearInterval(ticking));
  void loadMe(true).then((me) => {
    if (me.status === 'ok') render(me.me.dig);
    else say('Log in to dig.', false);
  });
}

const percent = (p: number) => (p >= 0.1 ? `${Math.round(p * 100)}%` : p >= 0.01 ? `${(p * 100).toFixed(1)}%` : `${(p * 100).toFixed(2)}%`);
const oneIn = (p: number) => (p > 0 ? `1 in ${Math.max(1, Math.round(1 / p)).toLocaleString()}` : '');

/** Each rarity (rarest first) with its odds, and its items: art (or emoji), name, what it sells for, how rare. */
function tierList(data: TownDigItemsResponse): HTMLElement {
  const box = el('div', 'mn-tier-list');
  for (const t of data.tiers) {
    const rarity: Rarity = isRarity(t.rarity) ? t.rarity : 'common';
    const tier = el('section', 'mn-tier');
    tier.style.setProperty('--rarity', RARITY_COLOUR[rarity]);
    const head = el('div', 'mn-tier-head');
    const name = el('b', undefined, t.label);
    name.style.color = RARITY_COLOUR[rarity];
    head.append(name, el('span', undefined, `${percent(t.chance)} of digs`));
    tier.append(head);
    for (const i of t.items) {
      const row = el('div', 'mn-tier-item');
      const pic = itemArt(i.id, rarity, 'icon', 2) ?? el('span', 'mn-tier-emoji', i.emoji);
      const text = el('div', 'mn-tier-text');
      text.append(el('span', 'mn-tier-name', i.name), el('span', 'mn-tier-odds', `${oneIn(i.chance)} digs`));
      row.append(pic, text, el('span', 'mn-tier-value', `${i.value.toLocaleString()} ${i.value === 1 ? 'Kowen' : 'Kowens'}`));
      tier.append(row);
    }
    box.append(tier);
  }
  box.append(el('p', 'mn-hint', `The odds are for a plain dig. Every ${data.luckyEvery}th dig on the server is Epic or better, and a Swerte Elixir rerolls junk. Some finds are secret…`));
  return box;
}

async function loadDigItems(): Promise<TownDigItemsResponse | null> {
  if (fakeLogin()) return FAKE_ITEMS;
  const res = await fetch('/town/dig-items', { credentials: 'same-origin' }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownDigItemsResponse) : null;
}

// ── Dev: a pretend tier list (no bot behind the dev server) ──

const FAKE_ITEMS: TownDigItemsResponse = {
  luckyEvery: 60,
  tiers: [
    { rarity: 'legendary', label: 'Legendary', chance: 0.0005, items: [{ id: 'twigo-treasure', name: "twigo's Hidden Treasure", emoji: '💰', value: 50, chance: 0.0005 }] },
    { rarity: 'mythical', label: 'Mythical', chance: 0.002, items: [{ id: 'troyangs-frog', name: "Troyangs' Golden Frog", emoji: '🐸', value: 20, chance: 0.0004 }, { id: 'aka-poknat', name: "Aka's Poknat", emoji: '✨', value: 10, chance: 0.0016 }] },
    { rarity: 'epic', label: 'Epic', chance: 0.0075, items: [{ id: 'mikko-kalabasa', name: "Mikko's Golden Kalabasa", emoji: '🎃', value: 8, chance: 0.0006 }, { id: 'hei-battery', name: "Hei's 20% Battery", emoji: '🪫', value: 5, chance: 0.0016 }] },
    { rarity: 'rare', label: 'Rare', chance: 0.02, items: [{ id: 'trot-shelf', name: "Trot's Magical Shelf", emoji: '🪄', value: 4, chance: 0.0021 }, { id: 'fig-boxers', name: "Fig's Boxer Shorts", emoji: '🩲', value: 2, chance: 0.0059 }] },
    { rarity: 'uncommon', label: 'Uncommon', chance: 0.05, items: [{ id: 'scrappy-milk', name: "Scrappy's Coconut Milk", emoji: '🥥', value: 3, chance: 0.0038 }, { id: 'junwuu-socks', name: "Junwuu's Socks", emoji: '🧦', value: 1, chance: 0.0153 }] },
    { rarity: 'common', label: 'Common', chance: 0.32, items: [{ id: 'nokia-3310', name: 'Nokia 3310 (Indestructible)', emoji: '📱', value: 5, chance: 0.0017 }, { id: 'karaoke-mic', name: 'Mini Karaoke Mic', emoji: '🎤', value: 4, chance: 0.0025 }, { id: 'spoon', name: 'Spoon', emoji: '🥄', value: 1, chance: 0.0158 }] },
    { rarity: 'junk', label: 'Junk', chance: 0.6, items: [{ id: 'half-pencil', name: 'Half a Pencil', emoji: '✏️', value: 1, chance: 0.0118 }, { id: 'rock', name: 'Rock', emoji: '🪨', value: 0, chance: 0.0471 }] },
  ],
};

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
const fakeState = { digs: Number(new URLSearchParams(location.search).get('digs') ?? 7), shovel: Number(new URLSearchParams(location.search).get('shovels') ?? 6), lucky: Number(new URLSearchParams(location.search).get('lucky') ?? 57) };

async function fakeDig(): Promise<TownDigResponse> {
  const d = (): MeDig => ({ shovel: fakeState.shovel, digsLeft: fakeState.digs, digsPerDay: 9, shovelsLeft: 2, shovelCost: 2, shovelUses: 3, lucky: fakeState.lucky, luckyEvery: 60 });
  if (fakeState.shovel <= 0) return { ok: false, message: 'You need a shovel to dig. Get one at the rewards shop (2 Kowens).', dig: d() };
  if (fakeState.digs <= 0) return { ok: false, message: "You've dug 9 times today. Your arms need a rest! Come back tomorrow.", dig: d() };
  fakeState.digs--;
  fakeState.shovel--;
  const lucky = ++fakeState.lucky >= 60;
  if (lucky) fakeState.lucky = 0;
  const pick = new URLSearchParams(location.search).get('find');
  const [id, name, rarity] = DEV_FINDS.find(([i]) => i === pick) ?? DEV_FINDS[Math.floor(Math.random() * DEV_FINDS.length)];
  const q = new URLSearchParams({ kind: 'dig', tone: rarity, text: `${fakeName()} dug up ${name}`, itemId: id, itemName: name, as: fakeName() });
  await fetch(`/__system?${q}`).catch(() => null);
  return { ok: true, message: `You dug up ${name}.`, dig: d(), item: { id, name, rarity, value: 1 }, ...(lucky ? { lucky } : {}) };
}
