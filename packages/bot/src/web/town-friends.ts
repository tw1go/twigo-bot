import { randomBytes } from 'node:crypto';
import { FRIEND_RULES, type FriendRefusal } from '@mikazuki/shared';

// 🤝 Friends (CONTEXT.md Friend, Friend request): both ways. One player asks, the other accepts (or declines); two
// players who ask each other are friends at once. Removing a friend removes it for both. At most FRIEND_RULES.max
// friends each and FRIEND_RULES.asks requests out; a request nobody answers lapses after FRIEND_RULES.requestDays.
// Also when each member was last online (their friends see it while they're away). Kept by member (Discord ids stay
// here: the page sees each member's friend key, made per process). Pure: what was saved comes in, every change goes out
// through `saves` (web/friends-db.ts in the bot; nothing on the game's dev server); web/town.ts sends the messages.

const DAY_MS = 86_400_000;

/** What was saved: each friendship once (with when it began), the requests waiting, and when members were last online. */
export interface FriendData {
  friends: [a: string, b: string, since: number][];
  requests: { from: string; to: string; at: number }[];
  seen: [user: string, at: number][];
}

/** Writes each change (`null`: it's gone). */
export interface FriendSaves {
  friend(a: string, b: string, since: number | null): void;
  request(from: string, to: string, at: number | null): void;
  seen(user: string, at: number): void;
}

/** Where friends are kept: loaded once, each change written. */
export interface FriendStore extends FriendSaves {
  load(): FriendData;
}

export type FriendResult<T = object> = ({ ok: true } & T) | { ok: false; reason: FriendRefusal };

export class Friends {
  /** Each member's friends, with when they became friends. */
  private readonly lists = new Map<string, Map<string, number>>();
  /** Requests waiting: from → to → when sent. */
  private readonly asks = new Map<string, Map<string, number>>();
  private readonly lastSeen = new Map<string, number>();
  private readonly keys = new Map<string, string>();
  private readonly members = new Map<string, string>();

  constructor(data: FriendData, private readonly saves: FriendSaves) {
    for (const [a, b, since] of data.friends) this.link(a, b, since);
    for (const r of data.requests) this.put(this.asks, r.from, r.to, r.at);
    for (const [user, at] of data.seen) this.lastSeen.set(user, at);
  }

  /** A member's friend key (random, the same for this process's lifetime). */
  key(user: string): string {
    let k = this.keys.get(user);
    if (!k) {
      k = randomBytes(6).toString('hex');
      this.keys.set(user, k);
      this.members.set(k, user);
    }
    return k;
  }

  /** The member behind a friend key (one this process gave out), or null. */
  member(key: string): string | null {
    return this.members.get(key) ?? null;
  }

  friendsOf(user: string): string[] {
    return [...(this.lists.get(user)?.keys() ?? [])];
  }

  areFriends(a: string, b: string): boolean {
    return !!this.lists.get(a)?.has(b);
  }

  /** Requests to `user` still open, oldest first. */
  incoming(user: string, now: number): { from: string; at: number }[] {
    const out: { from: string; at: number }[] = [];
    for (const [from, to] of this.asks) {
      const at = to.get(user);
      if (at !== undefined && this.open(at, now)) out.push({ from, at });
    }
    return out.sort((x, y) => x.at - y.at);
  }

  /** Requests `user` sent still open, oldest first. */
  outgoing(user: string, now: number): { to: string; at: number }[] {
    return [...(this.asks.get(user) ?? [])].filter(([, at]) => this.open(at, now)).map(([to, at]) => ({ to, at })).sort((x, y) => x.at - y.at);
  }

  /** `from` asks `to` to be friends. `friends`: they'd asked `from` already, so they're friends now. */
  ask(from: string, to: string, now: number): FriendResult<{ friends: boolean }> {
    if (from === to) return { ok: false, reason: 'self' };
    if (this.areFriends(from, to)) return { ok: false, reason: 'already' };
    if (this.waiting(from, to, now)) return { ok: false, reason: 'asked' };
    const room = this.room(from, to);
    if (room) return { ok: false, reason: room };
    if (this.waiting(to, from, now)) {
      this.befriend(from, to, now);
      return { ok: true, friends: true };
    }
    if (this.outgoing(from, now).length >= FRIEND_RULES.asks) return { ok: false, reason: 'asks' };
    this.put(this.asks, from, to, now);
    this.saves.request(from, to, now);
    return { ok: true, friends: false };
  }

  /** `to` answers `from`'s request: friends (accepted) or not (declined). */
  answer(to: string, from: string, accept: boolean, now: number): FriendResult<{ friends: boolean }> {
    if (!this.waiting(from, to, now)) return { ok: false, reason: 'expired' };
    if (!accept) {
      this.drop(from, to);
      return { ok: true, friends: false };
    }
    // (Their own room first, then the asker's: `full` is about the one answering.)
    const room = this.room(to, from);
    if (room) return { ok: false, reason: room };
    this.befriend(from, to, now);
    return { ok: true, friends: true };
  }

  /** `from` takes back their request to `to`. */
  cancel(from: string, to: string, now: number): FriendResult {
    if (!this.waiting(from, to, now)) return { ok: false, reason: 'expired' };
    this.drop(from, to);
    return { ok: true };
  }

  /** `a` and `b` are no longer friends (for both). */
  remove(a: string, b: string): FriendResult {
    if (!this.areFriends(a, b)) return { ok: false, reason: 'gone' };
    this.lists.get(a)!.delete(b);
    this.lists.get(b)!.delete(a);
    this.saves.friend(...pair(a, b), null);
    return { ok: true };
  }

  /** A member was online at `at`. */
  seen(user: string, at: number): void {
    this.lastSeen.set(user, at);
    this.saves.seen(user, at);
  }

  seenAt(user: string): number | undefined {
    return this.lastSeen.get(user);
  }

  /** Requests nobody answered in time, gone (who asked whom). */
  prune(now: number): { from: string; to: string }[] {
    const gone: { from: string; to: string }[] = [];
    for (const [from, to] of this.asks) for (const [user, at] of to) if (!this.open(at, now)) gone.push({ from, to: user });
    for (const g of gone) this.drop(g.from, g.to);
    return gone;
  }

  private open(at: number, now: number): boolean {
    return now - at < FRIEND_RULES.requestDays * DAY_MS;
  }

  private waiting(from: string, to: string, now: number): boolean {
    const at = this.asks.get(from)?.get(to);
    return at !== undefined && this.open(at, now);
  }

  /** Whether `me` and then `them` have room for one more friend. */
  private room(me: string, them: string): 'full' | 'their-full' | null {
    if ((this.lists.get(me)?.size ?? 0) >= FRIEND_RULES.max) return 'full';
    if ((this.lists.get(them)?.size ?? 0) >= FRIEND_RULES.max) return 'their-full';
    return null;
  }

  /** Friends now: the requests either way are done with. */
  private befriend(a: string, b: string, now: number): void {
    this.drop(a, b);
    this.drop(b, a);
    this.link(a, b, now);
    this.saves.friend(...pair(a, b), now);
  }

  private link(a: string, b: string, since: number): void {
    this.put(this.lists, a, b, since);
    this.put(this.lists, b, a, since);
  }

  private drop(from: string, to: string): void {
    const m = this.asks.get(from);
    if (!m?.delete(to)) return;
    if (!m.size) this.asks.delete(from);
    this.saves.request(from, to, null);
  }

  private put(map: Map<string, Map<string, number>>, a: string, b: string, at: number): void {
    let m = map.get(a);
    if (!m) map.set(a, (m = new Map()));
    m.set(b, at);
  }
}

/** A friendship's two members in the order it's saved in (the smaller id first). */
export const pair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);
