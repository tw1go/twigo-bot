import { type Item, type TownClientMessage, type TownServerMessage, type TradePut, type TradeView, tradeRefusal } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { adventure, itemData, onAdventure } from '../net/adventure';
import { RARITY_COLOUR } from './item-art';
import { itemPicture, itemTipFor, nameOf, rarityOf } from './item-tip';
import { kusingIcon } from './reward';
import { toast } from './toast';

// 🤝 Trading (combat-guide.md "Trading"; the bot's web/trade.ts decides everything). The player menu's Trade (within 5
// tiles: ui/target.ts) asks; the other player gets a request with Accept / Decline that goes after 20 s (the bar runs
// down). Accepted, the trade window opens for both, beside the bag (opened on its Combat tab): your side ("You") and
// theirs, 8 item slots each and a Kusing box. Drag items in from the combat bag (or click them while it's open); a stack
// asks how many. Bound items (training gear, worn orange gear) are greyed in the bag and bounce back; Kowens never trade.
// Click one of your items to take it out. Each side presses Lock; any change after that unlocks both (the server says
// so); with both locked each presses Trade, and the server checks it all again and moves it in one go. Walking more
// than 5 tiles apart, leaving, closing the window or being knocked out cancels it. A finished trade plays
// combat-trade-done for both. The server keeps the whole trade: this only shows its `trade` messages and asks.

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const DRAG = 'application/x-mk-item';

/** The open window (one at a time), for the bag's hooks below. */
let current: TradeWindow | null = null;

/** Whether the trade window is open (the bag greys what can't go in, and a click puts an item in). */
export const trading = (): boolean => !!current?.isOpen;

/** Why an item of your combat bag can't go into a trade (shown greyed in the bag while trading), or null. */
export function tradeBlocked(item: Item): string | null {
  const D = itemData();
  return D ? tradeRefusal(D, item) : null;
}

/** Whether an item is in your side of the open trade. */
export const inTrade = (uid: string): boolean => !!current?.offers(uid);

/** The bag's click while trading: the item goes in (true: the window was open to take it). */
export const tradePut = (uid: string): boolean => current?.put(uid) ?? false;

/** Sets the bag's combat cells to drag into the window (any item, by uid). */
export function tradeDrag(e: DragEvent, uid: string): void {
  e.dataTransfer?.setData(DRAG, uid);
}

export class TradeWindow {
  private readonly root = el('div');
  private readonly title = el('span', 'tr-title');
  private readonly body = el('div', 'tr-body');
  private readonly tip = el('div', 'eq-tip iv-tip');
  private view: TradeView | null = null;
  /** A stack dropped in: how many of it (its uid). */
  private asking: string | null = null;
  /** The request pop-ups showing, by request id (closed when the server says it's gone). */
  private readonly asks = new Map<string, () => void>();

  /** `frame`, `slot`: the inventory's art (the same window style). `openBag`: the bag on its Combat tab, beside the
   *  window. */
  constructor(
    frame: { url: string; slice: number } | null,
    slot: { url: string; picked: string; slice: number } | null,
    private readonly link: { send(m: TownClientMessage): boolean },
    private readonly openBag: () => void,
  ) {
    this.root.id = 'trade';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Trade');
    if (frame) {
      this.root.classList.add('tr-framed');
      this.root.style.setProperty('--frame', `url("${frame.url}")`);
      this.root.style.setProperty('--slice', String(frame.slice));
    }
    if (slot) {
      this.root.style.setProperty('--slot', `url("${slot.url}")`);
      this.root.style.setProperty('--slot-picked', `url("${slot.picked}")`);
      this.root.style.setProperty('--slot-slice', String(slot.slice));
    }
    const head = el('div', 'tr-head');
    const close = el('button', 'tr-close', '×');
    close.setAttribute('aria-label', 'Cancel the trade');
    close.addEventListener('click', () => this.cancel());
    head.append(this.title, close);
    this.tip.hidden = true;
    this.root.append(head, this.body);
    document.body.append(this.root, this.tip);
    current = this;
    // Your bag changed (loot, a potion): what you can put in follows.
    onAdventure(() => !this.root.hidden && this.render());
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || this.root.hidden) return;
      if (this.asking) {
        this.asking = null;
        return this.render();
      }
      this.cancel();
    });
    addEventListener('resize', () => this.fit());
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Whether this item (uid) is on your side. */
  offers(uid: string): boolean {
    return !!this.view?.you.items.some((i) => i.uid === uid);
  }

  /** Asks a player to trade (the player menu's Trade). */
  ask(playerId: string, name: string): void {
    if (this.link.send({ t: 'trade-ask', to: playerId })) toast(`Trade request sent to ${name}.`, 2400);
    else toast("You're not connected to the town.", 2400, 'bad');
  }

  /** The town's trade messages (true: it was one). */
  handle(m: TownServerMessage): boolean {
    switch (m.t) {
      case 'trade-asked':
        this.showAsk(m.ask, m.name, m.ms);
        return true;
      case 'trade-ask-gone':
        this.asks.get(m.ask)?.();
        return true;
      case 'trade-refused':
        playSound('error');
        toast(refusal(m.reason, m.name), 2800, 'bad');
        return true;
      case 'trade':
        this.show(m.trade, m.note);
        return true;
      case 'trade-bad':
        this.bounce(m.message);
        return true;
      case 'trade-end':
        this.ended(m.reason, m.name, m.message);
        return true;
    }
    return false;
  }

  /** Puts an item from your combat bag in (a stack asks how many first). */
  put(uid: string): boolean {
    if (this.root.hidden || !this.view) return false;
    const it = adventure()?.bag.find((b) => b.uid === uid);
    if (!it) return true;
    const why = tradeBlocked(it);
    if (why) {
      this.bounce(why);
      return true;
    }
    if (this.offers(uid)) {
      this.bounce('That one is in already. Click it on your side to take it out.');
      return true;
    }
    if (this.view.you.items.length >= this.view.slots) {
      this.bounce(`${this.view.slots} items at most.`);
      return true;
    }
    if (it.count > 1) {
      this.asking = uid;
      this.render();
      this.root.querySelector<HTMLInputElement>('.tr-how input')?.select();
      return true;
    }
    this.send([...this.puts(), { uid, count: 1 }]);
    return true;
  }

  /** Your side as it is (to send with a change). */
  private puts(): TradePut[] {
    return (this.view?.you.items ?? []).map((i) => ({ uid: i.uid, count: i.count }));
  }

  /** Your whole side to the server (it answers with the window, or why not). */
  private send(items: TradePut[], kusing = this.view?.you.kusing ?? 0): void {
    playSound('click');
    this.link.send({ t: 'trade-offer', items, kusing });
  }

  private cancel(): void {
    if (this.root.hidden) return;
    this.link.send({ t: 'trade-cancel' });
    this.close();
  }

  private close(): void {
    this.root.hidden = true;
    this.tip.hidden = true;
    this.view = null;
    this.asking = null;
    dispatchEvent(new Event('mk-trade')); // the bag stops greying
  }

  /** Someone asks you: Accept / Decline, gone after `ms` (the bar runs down). One at a time per asker. */
  private showAsk(ask: string, name: string, ms: number): void {
    const box = el('div', 'pt-invite tr-ask');
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-label', `Trade request from ${name}`);
    const text = el('p', 'pt-invite-text');
    text.append(el('b', undefined, name), ' wants to trade with you.');
    const timer = el('span', 'pt-invite-bar');
    const yes = el('button', 'pt-yes', 'Accept');
    const no = el('button', 'pt-no', 'Decline');
    const row = el('div', 'pt-invite-row');
    row.append(no, yes);
    box.append(text, row, timer);
    let stack = document.getElementById('party-invites');
    if (!stack) {
      stack = el('div');
      stack.id = 'party-invites';
      document.body.append(stack);
    }
    stack.append(box);
    playSound('click');
    timer.style.animationDuration = `${ms}ms`;
    const done = (accept: boolean | null) => {
      clearTimeout(lapse);
      box.remove();
      this.asks.delete(ask);
      if (accept !== null) this.link.send({ t: 'trade-answer', ask, accept });
    };
    const lapse = setTimeout(() => done(null), ms);
    this.asks.set(ask, () => done(null));
    yes.addEventListener('click', () => done(true));
    no.addEventListener('click', () => done(false));
  }

  /** The window from the server: opened (the bag too) or changed. */
  private show(v: TradeView, note?: string): void {
    const opening = this.root.hidden || this.view?.id !== v.id;
    this.view = v;
    if (this.asking && !adventure()?.bag.some((b) => b.uid === this.asking)) this.asking = null;
    if (opening) {
      this.root.hidden = false;
      this.asking = null;
      this.openBag();
      playSound('click');
      dispatchEvent(new Event('mk-trade')); // the bag greys what can't go in
    }
    if (note) toast(note, 2600);
    this.render();
    this.fit();
  }

  /** It ended: the window closes, and why (done: the sound for both; your items have come already). */
  private ended(reason: string, name?: string, message?: string): void {
    const was = this.view;
    const open = !this.root.hidden;
    this.close();
    const me = was?.you.name;
    const who = name && name === me ? 'You' : (name ?? was?.them.name ?? 'They');
    if (reason === 'done') {
      playSound('combat-trade-done');
      return toast(`Trade with ${was?.them.name ?? 'them'} done!`, 2800, 'good');
    }
    if (reason === 'cancelled' && (!open || who === 'You')) return; // you closed it
    playSound('error');
    const why =
      reason === 'far' ? 'You walked too far apart (5 tiles at most).'
      : reason === 'left' ? `${who} left.`
      : reason === 'out' ? `${who === 'You' ? 'You were' : `${who} was`} knocked out.`
      : reason === 'failed' ? `${message ?? 'Something changed.'} Nothing moved.`
      : `${who} cancelled it.`;
    toast(`Trade cancelled. ${why}`, 3600, 'bad');
  }

  /** It didn't go in (or do): a shake and why. */
  private bounce(why: string): void {
    playSound('error');
    toast(why.replace(/\.$/, ''), 2600, 'bad');
    const mine = this.root.querySelector<HTMLElement>('.tr-mine .tr-grid');
    mine?.classList.remove('tr-refused');
    void mine?.offsetWidth;
    mine?.classList.add('tr-refused');
  }

  /** Beside the bag (left of it) when there's room, else centred. */
  fit(): void {
    if (this.root.hidden) return;
    const bag = document.getElementById('inventory');
    const r = bag && !bag.hidden ? bag.getBoundingClientRect() : null;
    const w = this.root.offsetWidth;
    const room = r && r.left - 10 - w >= 8;
    this.root.classList.toggle('tr-centred', !room);
    this.root.style.right = room ? `${Math.round(innerWidth - r!.left + 10)}px` : '';
    this.root.style.top = room ? `${Math.round(r!.top)}px` : '';
  }

  private render(): void {
    const v = this.view;
    if (!v) return;
    this.title.textContent = `Trade with ${v.them.name}`;
    const halves = el('div', 'tr-halves');
    halves.append(this.half(v, 'you'), this.half(v, 'them'));
    const both = v.you.locked && v.them.locked;
    const status = el(
      'div',
      'tr-status',
      v.you.confirmed && !v.them.confirmed ? `Waiting for ${v.them.name} to press Trade…`
      : v.them.confirmed && !v.you.confirmed ? `${v.them.name} pressed Trade. Your turn.`
      : both ? 'Both locked: press Trade to finish.'
      : v.you.locked ? `Waiting for ${v.them.name} to lock…`
      : v.them.locked ? `${v.them.name} locked. Lock yours when it's ready.`
      : 'Put items in, then Lock. Any change after that unlocks both.',
    );
    const row = el('div', 'tr-actions');
    const lock = el('button', `tr-go tr-lock${v.you.locked ? ' tr-on' : ''}`, v.you.locked ? 'Unlock' : 'Lock');
    lock.addEventListener('click', () => {
      playSound('click');
      this.link.send({ t: 'trade-lock', on: !v.you.locked });
    });
    const go = el('button', `tr-go tr-trade${both && !v.you.confirmed ? ' tr-ready' : ''}`, v.you.confirmed ? 'Waiting…' : 'Trade');
    go.disabled = !both || v.you.confirmed;
    go.title = both ? '' : 'Both sides lock first';
    go.addEventListener('click', () => {
      playSound('click');
      this.link.send({ t: 'trade-confirm' });
    });
    const cancel = el('button', 'tr-go tr-cancel', 'Cancel');
    cancel.addEventListener('click', () => this.cancel());
    row.append(lock, go, cancel);
    this.body.replaceChildren(halves, status, row, el('div', 'tr-hint', "Drag items in from your combat bag (or click them). Kowens can't be traded."));
  }

  /** One side: its name and lock, its 8 slots, its Kusing (yours a box to type in). */
  private half(v: TradeView, who: 'you' | 'them'): HTMLElement {
    const side = v[who];
    const mine = who === 'you';
    const box = el('div', `tr-half ${mine ? 'tr-mine' : 'tr-theirs'}${side.locked ? ' tr-locked' : ''}`);
    const head = el('div', 'tr-side-head');
    head.append(el('span', 'tr-name', mine ? 'You' : side.name), el('span', `tr-lockmark${side.locked ? ' tr-on' : ''}`, side.confirmed ? 'Trade ✓' : side.locked ? 'Locked' : 'Not locked'));
    const grid = el('div', 'tr-grid');
    for (let i = 0; i < v.slots; i++) {
      const it = side.items[i];
      const cell = el(it ? 'button' : 'div', `tr-cell${it ? ' tr-item' : ''}`);
      if (it) {
        cell.style.setProperty('--rarity', RARITY_COLOUR[rarityOf(it)]);
        cell.setAttribute('aria-label', `${nameOf(it)}${it.count > 1 ? ` ×${it.count}` : ''}`);
        cell.append(itemPicture(it, 'icon', 3));
        if (it.count > 1) cell.append(el('span', 'tr-count', String(it.count)));
        cell.addEventListener('pointerenter', () => this.showTip(it, cell));
        cell.addEventListener('pointerleave', () => (this.tip.hidden = true));
        if (mine) {
          cell.title = 'Click to take it out';
          cell.addEventListener('click', () => {
            this.tip.hidden = true;
            this.send(this.puts().filter((p) => p.uid !== it.uid));
          });
        }
      }
      grid.append(cell);
    }
    if (mine) {
      // Drop items from the combat bag anywhere on your side.
      box.addEventListener('dragover', (e) => {
        if (!e.dataTransfer?.types.includes(DRAG)) return;
        e.preventDefault();
        box.classList.add('tr-over');
      });
      box.addEventListener('dragleave', () => box.classList.remove('tr-over'));
      box.addEventListener('drop', (e) => {
        box.classList.remove('tr-over');
        const uid = e.dataTransfer?.getData(DRAG);
        if (!uid) return;
        e.preventDefault();
        this.put(uid);
      });
    }
    box.append(head, grid);
    if (mine && this.asking) box.append(this.howMany(this.asking));
    box.append(this.kusingRow(side.kusing, mine));
    return box;
  }

  /** A stack going in: how many (all of it to start with). */
  private howMany(uid: string): HTMLElement {
    const it = adventure()?.bag.find((b) => b.uid === uid);
    const row = el('div', 'tr-how');
    if (!it) return row;
    const input = el('input');
    input.type = 'number';
    input.min = '1';
    input.max = String(it.count);
    input.value = String(it.count);
    input.setAttribute('aria-label', `How many ${nameOf(it)}`);
    const ok = el('button', 'tr-small', 'Put in');
    const no = el('button', 'tr-small tr-no', '×');
    no.setAttribute('aria-label', 'Never mind');
    const go = () => {
      const n = Math.floor(Number(input.value));
      if (!Number.isFinite(n) || n < 1 || n > it.count) return this.bounce(`1 to ${it.count}.`);
      this.asking = null;
      this.send([...this.puts(), { uid, count: n }]);
    };
    ok.addEventListener('click', go);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') go();
    });
    no.addEventListener('click', () => ((this.asking = null), this.render()));
    row.append(el('span', 'tr-how-name', `${nameOf(it)}:`), input, el('span', 'tr-of', `of ${it.count}`), ok, no);
    return row;
  }

  /** The Kusing: yours a number box (sent on Enter or leaving it; no more than you have), theirs as it is. */
  private kusingRow(amount: number, mine: boolean): HTMLElement {
    const row = el('div', 'tr-kusing');
    row.append(kusingIcon(2));
    if (!mine) {
      row.append(el('b', undefined, amount.toLocaleString()), el('span', undefined, 'Kusing'));
      return row;
    }
    const have = adventure()?.kusing ?? 0;
    const input = el('input');
    input.type = 'number';
    input.min = '0';
    input.max = String(have);
    input.step = '1';
    input.inputMode = 'numeric';
    input.value = String(amount);
    input.setAttribute('aria-label', 'Kusing to give');
    const set = () => {
      const n = Math.max(0, Math.min(have, Math.floor(Number(input.value) || 0)));
      input.value = String(n);
      if (n !== amount) this.send(this.puts(), n);
    };
    input.addEventListener('change', set);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // (typing numbers, not the hotbar's keys)
      if (e.key === 'Enter') input.blur();
    });
    row.append(input, el('span', 'tr-of', `of ${have.toLocaleString()} Kusing`));
    return row;
  }

  private showTip(it: Item, at: HTMLElement): void {
    this.tip.replaceChildren(...itemTipFor(it));
    this.tip.hidden = false;
    const r = at.getBoundingClientRect();
    const w = this.tip.offsetWidth;
    this.tip.style.left = `${Math.round(r.right + 6 + w > innerWidth - 8 ? Math.max(8, r.left - w - 6) : r.right + 6)}px`;
    this.tip.style.right = '';
    this.tip.style.top = `${Math.round(Math.max(8, Math.min(r.top, innerHeight - this.tip.offsetHeight - 8)))}px`;
  }
}

/** Why a request or trade action didn't go, as a toast. */
function refusal(reason: string, name?: string): string {
  const who = name ?? 'They';
  switch (reason) {
    case 'self':
      return "You can't trade with yourself.";
    case 'gone':
      return `${who} isn't here anymore.`;
    case 'far':
      return 'Too far to trade. Walk within 5 tiles.';
    case 'busy':
      return `${who === 'They' ? 'They are' : `${who} is`} busy trading (or being asked).`;
    case 'asked':
      return 'You already asked someone. Wait for their answer.';
    case 'slow':
      return 'One trade request a second.';
    case 'out':
      return "No trading while knocked out.";
    case 'declined':
      return `${who} declined the trade.`;
    case 'timeout':
      return `${who} didn't answer the trade request.`;
    default:
      return 'That trade request is gone.';
  }
}
