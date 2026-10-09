import { type Item, type ItemData, isGearDef, itemStats } from './items.js';
import type { StatsData } from './stats.js';

// 🤝 Trading (combat-guide.md "Trading"; stats.json trading): two players face to face swap items from their combat
// bags and Kusing. Anything not bound can go in; training gear is always bound, and an orange item binds once worn.
// Kowens never trade. One player asks (the player menu, within `range` tiles), the other has `timeoutMs` to accept;
// then both fill their side (`slots` items and a Kusing amount), each presses Lock (any change unlocks both), and with
// both locked each presses Trade. The server keeps the whole trade and moves everything at once at the end (bot
// web/trade.ts). Shared by the bot (which decides) and the game (which shows it and greys what can't go in).

/** The numbers (stats.json trading.flow): how near, how long a request waits, how many items a side. */
export interface TradeRules {
  range: number;
  timeoutMs: number;
  slots: number;
}

export function tradeRules(data: StatsData): TradeRules {
  const f = (itemStats(data).trading as { flow?: { rangeTiles?: number; requestTimeoutSeconds?: number; slotsEach?: number } }).flow ?? {};
  return { range: f.rangeTiles ?? 5, timeoutMs: (f.requestTimeoutSeconds ?? 20) * 1000, slots: f.slotsEach ?? 8 };
}

/** Why an item can't go into a trade (training gear, bound), or null if it can. */
export function tradeRefusal(data: ItemData, item: Item): string | null {
  const def = data.defs.get(item.defId);
  if (!def) return "That item can't be traded.";
  if (isGearDef(def) && def.training) return "Training gear can't be traded.";
  if (item.bound) return "Bound items can't be traded.";
  return null;
}

/** Why an item can't be dropped on the ground (dragged out of the bag onto the map), or null: it can. The same items as
 *  trading: never training gear or bound items. */
export function dropRefusal(data: ItemData, item: Item): string | null {
  const def = data.defs.get(item.defId);
  if (!def) return "That item can't be dropped.";
  if (isGearDef(def) && def.training) return "Training gear can't be dropped.";
  if (item.bound) return "Bound items can't be dropped.";
  return null;
}

/** One item put in: its uid in your combat bag and how many of the stack (gear: 1). */
export interface TradePut {
  uid: string;
  count: number;
}

/** What a side puts in (browser → server: the whole side each time it changes). */
export interface TradeOffer {
  items: TradePut[];
  kusing: number;
}

/** One side as both players see it: the items as they were put in (each with `count` = how many), the Kusing, and
 *  whether it's locked and has pressed Trade. */
export interface TradeSide {
  name: string;
  items: Item[];
  kusing: number;
  locked: boolean;
  confirmed: boolean;
}

/** The trade window's state, from one player's side: `with` is the other's town id. */
export interface TradeView {
  id: string;
  with: string;
  you: TradeSide;
  them: TradeSide;
  slots: number;
}

/** Why a request or trade didn't go: yourself, they left, too far (or another area), one of you is already trading or
 *  asked, too many requests, knocked out, they said no, no answer in time, the request is gone. */
export type TradeRefusal = 'self' | 'gone' | 'far' | 'busy' | 'asked' | 'slow' | 'out' | 'declined' | 'timeout' | 'expired';

/** How a trade ended: done, cancelled by one side (`name`), too far apart, one left, one knocked out, or the last check
 *  failed (`message` says why; nothing moved). */
export type TradeEnd = 'done' | 'cancelled' | 'far' | 'left' | 'out' | 'failed';
