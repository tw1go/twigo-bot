import type { PalengkeDish } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import type { MyBuff } from '../net/buffs';
import { onAdventure } from '../net/adventure';
import { el, kusingIcon, showPopup } from './reward';
import { buffStatLines } from './buff-text';
import { toast } from './toast';

// 🍲 Aling Conching's menu (CONTEXT.md Dish; classes/palengke-leveling.json `dishes`), from her dialog box in the Lumang
// Palengke: every dish in a row, its effect, how long, its Kusing and Buy. One locked yet is greyed with the quest that
// unlocks it; one on you says so with its time left (buying it again starts it over). The town decides (`dish-buy`):
// the buy answers, and the dish comes in your buffs (the tray).

export interface DishMenuOptions {
  dishes: Record<string, PalengkeDish>;
  /** Whether a dish is on her menu for you, and the title of the quest that puts it there. */
  unlocked: (id: string) => boolean;
  unlockedBy: (id: string) => string;
  kusing: () => number;
  /** A dish's price for you (the Atchara refill at half once you've cleared Ang Silong); its Kusing without. */
  price?: (id: string) => number;
  /** The dishes on you now (your buffs with a `dish`). */
  on: () => MyBuff[];
  buy: (id: string) => Promise<{ ok: boolean; message?: string } | null>;
  /** Her Susi ng Silong (after the Great Scale's finale: `open`), at its Kusing; bought like a dish, into your bag. */
  key?: { id: string; name: string; kusing: number; open: boolean };
}

/** "7:32" (minutes and seconds). */
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function openDishMenu(o: DishMenuOptions): Promise<void> {
  const wrap = el('div', 'dm-menu');
  const wallet = el('div', 'dm-wallet');
  const list = el('div', 'dm-list');
  const minutes = Object.values(o.dishes)[0]?.minutes ?? 10;
  wrap.append(
    el('p', 'dm-rule', `One main dish and one side dish at a time, ${minutes} minutes each. They work in fights and keep running wherever you go; being knocked out ends them.`),
    wallet,
    list,
  );
  let busy = false;
  /** The time-left labels, by dish (ticked every second; a full redraw only when what's on changes). */
  let times = new Map<string, HTMLElement>();
  const onNow = () => o.on().map((b) => b.name).sort().join(',');
  let shown = '';
  const render = () => {
    times = new Map();
    shown = onNow();
    const kusing = o.kusing();
    wallet.replaceChildren(kusingIcon(1), el('span', '', `${kusing.toLocaleString('en-US')} Kusing`));
    const on = o.on();
    list.replaceChildren(
      ...Object.entries(o.dishes).map(([id, d]) => {
        const open = o.unlocked(id);
        const row = el('div', `dm-dish${open ? '' : ' dm-locked'}`);
        const text = el('div', 'dm-text');
        const name = el('div', 'dm-name');
        name.append(el('b', '', d.name.replace(/\s*\(side dish\)$/i, '')), el('span', `dm-slot dm-${d.slot}`, d.slot === 'side' ? 'Side' : 'Main'));
        const mine = on.find((b) => b.name === id);
        if (mine?.endsAt) {
          const t = el('span', 'dm-on', `On · ${clock(mine.endsAt - Date.now())}`);
          times.set(id, t);
          name.append(t);
        }
        text.append(name, el('div', 'dm-effect', buffStatLines(d.stats).join(', ') || d.effect));
        if (!open) text.append(el('div', 'dm-unlock', `Unlocks with ${o.unlockedBy(id)}`));
        const buy = el('button', 'dm-buy');
        buy.type = 'button';
        const price = o.price?.(id) ?? d.kusing;
        if (price < d.kusing) name.append(el('span', 'dm-on', 'Half price'));
        buy.append(kusingIcon(1), el('span', '', price.toLocaleString('en-US')));
        buy.disabled = !open || busy || kusing < price;
        buy.title = !open ? `Unlocks with ${o.unlockedBy(id)}` : kusing < price ? 'Not enough Kusing' : mine ? `Buy again: ${d.minutes} more minutes from now` : `Buy ${d.name}`;
        buy.addEventListener('click', () => {
          if (busy) return;
          busy = true;
          render();
          void o.buy(id).then((r) => {
            busy = false;
            if (!r) toast("Couldn't reach Aling Conching. Try again in a moment.", 3000, 'bad');
            else if (!r.ok) toast(r.message ?? "You can't have that one yet.", 3000, 'bad');
            else {
              playSound('coin');
              toast(`${d.name.replace(/\s*\(side dish\)$/i, '')}: ${d.minutes} minutes.`, 2500, 'good');
            }
            render();
          });
        });
        row.append(text, buy);
        return row;
      }),
      ...(o.key ? [keyRow(o.key)] : []),
    );
  };
  /** The Susi ng Silong's row: greyed until the finale; Buy puts one in your bag. */
  const keyRow = (k: NonNullable<DishMenuOptions['key']>) => {
    const kusing = o.kusing();
    const row = el('div', `dm-dish${k.open ? '' : ' dm-locked'}`);
    const text = el('div', 'dm-text');
    const name = el('div', 'dm-name');
    name.append(el('b', '', k.name), el('span', 'dm-slot dm-side', 'Key'));
    text.append(name, el('div', 'dm-effect', 'Opens Ang Silong for you or your party, at the hatch in the Market Hall.'));
    if (!k.open) text.append(el('div', 'dm-unlock', 'After the Great Scale rests'));
    const buy = el('button', 'dm-buy');
    buy.type = 'button';
    buy.append(kusingIcon(1), el('span', '', k.kusing.toLocaleString('en-US')));
    buy.disabled = !k.open || busy || kusing < k.kusing;
    buy.addEventListener('click', () => {
      if (busy) return;
      busy = true;
      render();
      void o.buy(k.id).then((r) => {
        busy = false;
        if (!r) toast("Couldn't reach Aling Conching. Try again in a moment.", 3000, 'bad');
        else if (!r.ok) toast(r.message ?? "You can't have that yet.", 3000, 'bad');
        else {
          playSound('coin');
          toast(`${k.name}: in your bag.`, 2500, 'good');
        }
        render();
      });
    });
    row.append(text, buy);
    return row;
  };
  render();
  const tick = () => {
    if (onNow() !== shown) return render();
    for (const b of o.on()) if (b.endsAt) times.get(b.name)?.replaceChildren(`On · ${clock(b.endsAt - Date.now())}`);
  };
  const ticking = setInterval(() => (wrap.isConnected ? tick() : clearInterval(ticking)), 1000);
  const closed = showPopup({ title: "Aling Conching's Karinderya", body: [wrap], button: 'Close', celebrate: false, closeX: true, sound: 'door' });
  // (Kusing changing, a dish served: drawn again.)
  const off = onAdventure(() => !busy && render());
  void closed.then(off);
  return closed;
}
