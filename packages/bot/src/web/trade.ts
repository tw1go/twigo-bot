import { randomBytes } from 'node:crypto';
import { type Item, type ItemData, type TradeOffer, type TradeRefusal, type TradeRules, addToBag, itemName, tradeRefusal } from '@mikazuki/shared';
import type { CombatItems } from './combat-bag.js';

// 🤝 Trades in the web town (combat-guide.md "Trading"; the rules in @mikazuki/shared trade.ts), pure: web/town.ts
// sends the messages, checks distance by its own positions, and saves through TownOptions.items.trade.
// A request (one out per player, one waiting per player) lapses after rules.timeoutMs. Accepted, it opens a trade: each
// side's items (copies as they were put in, with how many) and Kusing, locked or not, Trade pressed or not. Any change
// to a side unlocks both (and takes back any Trade pressed); Trade needs both locked; when both have pressed it, the
// caller settles it with settleTrade: everything checked again against what they own now, then moved, or nothing.
// One trade (or request) at a time per player. In memory only: a restart ends every trade (nothing has moved yet).

/** A side as kept: copies of the items put in (`count` = how many) and the Kusing. */
export interface HeldOffer {
  items: Item[];
  kusing: number;
}

export interface Ask {
  id: string;
  from: string;
  to: string;
  until: number;
}

export interface Trade {
  id: string;
  /** [asker, the one who accepted]. */
  users: [string, string];
  offers: [HeldOffer, HeldOffer];
  locked: [boolean, boolean];
  confirmed: [boolean, boolean];
}

export type TradeResult<T = object> = ({ ok: true } & T) | { ok: false; reason: TradeRefusal };

const empty = (): HeldOffer => ({ items: [], kusing: 0 });

export class Trades {
  private readonly asks = new Map<string, Ask>();
  private readonly trades = new Map<string, Trade>();
  private readonly tradeOf = new Map<string, string>();

  constructor(readonly rules: TradeRules) {}

  /** Their open trade, if any. */
  of(user: string): Trade | null {
    const id = this.tradeOf.get(user);
    return id ? (this.trades.get(id) ?? null) : null;
  }

  /** Which side of a trade they are (0: asked, 1: accepted). */
  side(t: Trade, user: string): 0 | 1 {
    return t.users[0] === user ? 0 : 1;
  }

  private askFrom(user: string): Ask | undefined {
    for (const a of this.asks.values()) if (a.from === user) return a;
    return undefined;
  }

  private askTo(user: string): Ask | undefined {
    for (const a of this.asks.values()) if (a.to === user) return a;
    return undefined;
  }

  /** `from` asks `to` (distance is the caller's to check). Refused for yourself, either already trading, a request of
   *  yours still out, or one already waiting for them. */
  ask(from: string, to: string, now: number): TradeResult<{ ask: Ask }> {
    if (from === to) return { ok: false, reason: 'self' };
    if (this.of(from) || this.of(to)) return { ok: false, reason: 'busy' };
    const out = this.askFrom(from);
    if (out && out.until > now) return { ok: false, reason: 'asked' };
    if (out) this.asks.delete(out.id);
    const waiting = this.askTo(to);
    if (waiting && waiting.until > now) return { ok: false, reason: 'busy' };
    if (waiting) this.asks.delete(waiting.id);
    const ask: Ask = { id: randomBytes(6).toString('hex'), from, to, until: now + this.rules.timeoutMs };
    this.asks.set(ask.id, ask);
    return { ok: true, ask };
  }

  /** Who a request is from, if it's still open for `user` (the caller checks distance before accepting). */
  pending(user: string, askId: string, now: number): Ask | null {
    const a = this.asks.get(askId);
    return a && a.to === user && a.until > now ? a : null;
  }

  /** `user` answers a request: no (the asker hears it), or yes: the trade opens, empty and unlocked. */
  answer(user: string, askId: string, accept: boolean, now: number): TradeResult<{ ask: Ask; trade?: Trade }> {
    const a = this.pending(user, askId, now);
    if (!a) return { ok: false, reason: 'expired' };
    this.asks.delete(a.id);
    if (!accept) return { ok: true, ask: a };
    if (this.of(a.from) || this.of(a.to)) return { ok: false, reason: 'busy' };
    const trade: Trade = { id: randomBytes(6).toString('hex'), users: [a.from, a.to], offers: [empty(), empty()], locked: [false, false], confirmed: [false, false] };
    this.trades.set(trade.id, trade);
    for (const u of trade.users) this.tradeOf.set(u, trade.id);
    // Any other request either of them made goes.
    for (const u of trade.users) {
      const out = this.askFrom(u);
      if (out) this.asks.delete(out.id);
    }
    return { ok: true, ask: a, trade };
  }

  /** Requests whose time is up (gone now: the asker hears no, the asked one's pop-up closes). */
  prune(now: number): Ask[] {
    const out: Ask[] = [];
    for (const a of this.asks.values()) {
      if (a.until > now) continue;
      this.asks.delete(a.id);
      out.push(a);
    }
    return out;
  }

  /** Requests from or to someone who left (gone now). */
  dropAsks(user: string): Ask[] {
    const out = [...this.asks.values()].filter((a) => a.from === user || a.to === user);
    for (const a of out) this.asks.delete(a.id);
    return out;
  }

  /** A side changed (already checked: settle checks it all again): both unlocked, any Trade pressed taken back. */
  offer(user: string, offer: HeldOffer): Trade | null {
    const t = this.of(user);
    if (!t) return null;
    t.offers[this.side(t, user)] = offer;
    t.locked = [false, false];
    t.confirmed = [false, false];
    return t;
  }

  /** Locks or unlocks their side (unlocking takes back any Trade pressed, on both sides). */
  lock(user: string, on: boolean): Trade | null {
    const t = this.of(user);
    if (!t) return null;
    t.locked[this.side(t, user)] = on;
    if (!on) t.confirmed = [false, false];
    return t;
  }

  /** They press Trade: only once both sides are locked. `both`: the other had already, so it's time to settle. */
  confirm(user: string): { trade: Trade; both: boolean } | null {
    const t = this.of(user);
    if (!t || !t.locked[0] || !t.locked[1]) return null;
    t.confirmed[this.side(t, user)] = true;
    return { trade: t, both: t.confirmed[0] && t.confirmed[1] };
  }

  /** Ends their trade (done, cancelled, too far, left…): returns it, if there was one. */
  end(user: string): Trade | null {
    const t = this.of(user);
    if (!t) return null;
    this.trades.delete(t.id);
    for (const u of t.users) this.tradeOf.delete(u);
    return t;
  }
}

// ── Checking and settling ──

/** A side as asked for (the browser's trade-offer), checked against what they hold: at most `slots` items, each in
 *  their combat bag (not worn), not bound or training gear, 1 to the stack's count, no item twice; Kusing a whole number
 *  they have. The copies kept are as the items are now. */
export function checkOffer(data: ItemData, c: CombatItems, offer: TradeOffer, slots: number): { ok: true; offer: HeldOffer } | { ok: false; message: string } {
  const puts = Array.isArray(offer?.items) ? offer.items : null;
  const kusing = offer?.kusing;
  if (!puts || !Number.isInteger(kusing) || kusing < 0) return { ok: false, message: "That can't go in." };
  if (puts.length > slots) return { ok: false, message: `${slots} items at most.` };
  if (kusing > c.kusing) return { ok: false, message: `You have ${c.kusing.toLocaleString('en-US')} Kusing.` };
  const seen = new Set<string>();
  const items: Item[] = [];
  for (const p of puts) {
    if (!p || typeof p.uid !== 'string' || seen.has(p.uid)) return { ok: false, message: "That can't go in." };
    seen.add(p.uid);
    const item = c.bag.find((b) => b.uid === p.uid);
    if (!item) return { ok: false, message: 'Only items in your combat bag can be traded.' };
    const why = tradeRefusal(data, item);
    if (why) return { ok: false, message: why };
    if (!Number.isInteger(p.count) || p.count < 1 || p.count > item.count) return { ok: false, message: `You have ${item.count} of those.` };
    items.push({ ...structuredClone(item), count: p.count });
  }
  return { ok: true, offer: { items, kusing } };
}

/** Whether an item is still as it was put in (its rolls, plus, luck, agimats, broken, bound), ignoring how many. */
const same = (a: Item, b: Item) => JSON.stringify({ ...a, count: 0 }) === JSON.stringify({ ...b, count: 0 });

/** What a settled trade moved: each side's items as they went (the uid they had, how many) and Kusing. */
export interface Settled {
  gave: [HeldOffer, HeldOffer];
}

/** Settles a trade between two players' items: everything checked again (each item still in its owner's combat bag,
 *  unchanged, enough of it, still tradeable; the Kusing there; room in each bag for what comes in, after what goes out,
 *  stacks counted), then both bags and wallets changed. All or nothing: refused, neither is touched. `names` say whose
 *  check failed. */
export function settleTrade(
  data: ItemData,
  sides: [CombatItems, CombatItems],
  offers: [HeldOffer, HeldOffer],
  names: [string, string],
  uid: () => string,
): ({ ok: true } & Settled) | { ok: false; message: string } {
  for (const i of [0, 1] as const) {
    const s = sides[i];
    const o = offers[i];
    if (o.kusing > s.kusing) return { ok: false, message: `${names[i]} doesn't have ${o.kusing.toLocaleString('en-US')} Kusing anymore.` };
    for (const put of o.items) {
      const now = s.bag.find((b) => b.uid === put.uid);
      if (!now || now.count < put.count || !same(now, put)) return { ok: false, message: `${names[i]}'s ${itemName(data, put)} isn't in their bag as it was.` };
      const why = tradeRefusal(data, now);
      if (why) return { ok: false, message: why };
    }
  }
  // On copies: what goes out of each bag (a whole stack keeps its uid; part of one leaves as a new item), then what
  // comes in onto the other.
  const bags = sides.map((s) => structuredClone(s.bag)) as [Item[], Item[]];
  const moving: [Item[], Item[]] = [[], []];
  for (const i of [0, 1] as const) {
    for (const put of offers[i].items) {
      const at = bags[i].findIndex((b) => b.uid === put.uid);
      const item = bags[i][at];
      if (item.count === put.count) moving[i].push(bags[i].splice(at, 1)[0]);
      else {
        item.count -= put.count;
        moving[i].push({ ...structuredClone(item), uid: uid(), count: put.count });
      }
    }
  }
  for (const i of [0, 1] as const) {
    const to = 1 - i;
    for (const item of moving[i]) if (!addToBag(data, bags[to], item, uid)) return { ok: false, message: `${names[to]}'s combat bag has no room for it all.` };
  }
  for (const i of [0, 1] as const) {
    sides[i].bag = bags[i];
    sides[i].kusing += offers[1 - i].kusing - offers[i].kusing;
  }
  return { ok: true, gave: [structuredClone(offers[0]), structuredClone(offers[1])] };
}
