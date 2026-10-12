import type { Item } from '@mikazuki/shared';

// 🎲 Rolls for rare loot (shared loot-roll.ts says which items; web/town.ts runs them): one per item, asked of everyone
// it dropped for who's in the room. Each answers once, a roll (1..max, the server's random) or a pass; the roll ends
// when everyone has answered or its time is up (the silent count as passing). The highest roll wins; a tie goes to
// whoever rolled it first. Pure: no sockets and no clock of its own (the town asks `due`).

export interface LootRoll {
  id: string;
  room: string;
  item: Item;
  /** Where it dropped: where it lands if nobody wins it, or the winner's bag is full. */
  at: [number, number];
  /** Who's asked: members, and their names for the others' lines. */
  members: { member: string; name: string }[];
  /** Answers in the order given: a roll, or null (passed). */
  answers: Map<string, number | null>;
  endsAt: number;
}

export class LootRolls {
  private n = 0;
  private readonly open = new Map<string, LootRoll>();

  constructor(private readonly max = 1000) {}

  start(room: string, item: Item, at: [number, number], members: { member: string; name: string }[], now: number, ms: number): LootRoll {
    const r: LootRoll = { id: `r${++this.n}`, room, item, at, members, answers: new Map(), endsAt: now + ms };
    this.open.set(r.id, r);
    return r;
  }

  get(id: string): LootRoll | undefined {
    return this.open.get(id);
  }

  /** A member's answer: their roll (null: passed) and whether it was the last one. Null: no such roll, not asked, or
   *  answered already. */
  answer(id: string, member: string, roll: boolean, random: () => number): { roll: LootRoll; value: number | null; done: boolean } | null {
    const r = this.open.get(id);
    if (!r || !r.members.some((m) => m.member === member) || r.answers.has(member)) return null;
    const value = roll ? 1 + Math.floor(Math.max(0, Math.min(0.999999, random())) * this.max) : null;
    r.answers.set(member, value);
    return { roll: r, value, done: r.answers.size >= r.members.length };
  }

  /** Rolls whose time is up, taken out: finish them. */
  due(now: number): LootRoll[] {
    const out = [...this.open.values()].filter((r) => now >= r.endsAt);
    for (const r of out) this.open.delete(r.id);
    return out;
  }

  /** Takes a roll out (every answer is in): finish it. */
  finish(id: string): LootRoll | undefined {
    const r = this.open.get(id);
    this.open.delete(id);
    return r;
  }

  /** The highest roll (a tie: the earlier), or null when everyone passed or nobody answered. */
  winner(r: LootRoll): { member: string; name: string; value: number } | null {
    let best: { member: string; value: number } | null = null;
    for (const [member, value] of r.answers) if (value !== null && (!best || value > best.value)) best = { member, value };
    if (!best) return null;
    const who = best.member;
    return { ...best, name: r.members.find((m) => m.member === who)?.name ?? '?' };
  }
}
