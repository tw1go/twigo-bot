import type { ItemData, TownLoot } from '@mikazuki/shared';
import { itemStats, numbersIn } from '@mikazuki/shared';
import type { LootContent } from './combat-bag.js';
import { golemLoot, mobDrops } from './loot.js';

// 🪙 Loot on the ground in a battle map (one LootRoom per room with mobs, run by the town: web/town.ts). A kill's drops
// (web/loot.ts) land round where it died, each on its own tile. Who may pick each one up (stats.json `party`): a solo
// kill's are the killer's for 10 s, then anyone's; a party's are any member's (those in the room when it fell) for 10 s,
// then anyone's; the golem's are personal, each player's own, never anyone else's (and never shown to them). Kusing
// picks itself up for whoever may take it nearby (KUSING_REACH); items are walked onto or clicked. Loot lies there for
// LOOT_MS, then it's gone. Everything is by member (it outlasts a reload). Pure (the clock is passed in).

/** Loot lies on the ground this long. */
export const LOOT_MS = 2 * 60_000;
/** Kusing picks itself up for whoever may take it within this many tiles (a ranged class's reach: Kusing always
 *  auto-picks); items only on their own tile (walking onto them) or by a click. */
export const KUSING_REACH = 5;
/** Fresh Kusing lies there this long before it's picked up on its own (so it's seen to fall). */
export const KUSING_SETTLE_MS = 700;

export interface Loot {
  id: string;
  col: number;
  row: number;
  content: LootContent;
  /** Who may take it before it opens (the killer, their party), as members. */
  owners: string[];
  /** Only its owner sees it and may take it, ever (the golem's loot). */
  personal: boolean;
  /** Anyone may take it from then (ms; Infinity for personal loot). */
  opensAt: number;
  goneAt: number;
}

/** A kill, as far as its loot needs: what died (its kind and level), where, and who earned it. */
export interface LootKill {
  kind: string;
  level: number;
  at: [number, number];
  /** The killer (a normal mob), or everyone who did enough of the golem's HP. */
  to: string[];
  /** The field boss: personal loot for each of `to`. */
  boss?: boolean;
}

export class LootRoom {
  private readonly all = new Map<string, Loot>();
  private n = 0;
  /** How long a kill's loot is kept for its killer (or party): stats.json party.solo ("killer only for 10 s"). */
  readonly reserveMs: number;

  constructor(
    private readonly data: ItemData,
    private readonly random: () => number = Math.random,
    private readonly uid: () => string = () => Math.random().toString(16).slice(2, 18),
  ) {
    this.reserveMs = (numbersIn(itemStats(data.stats).party.solo)[0] ?? 10) * 1000;
  }

  /**
   * A kill's drops, rolled and laid out: a normal mob's for its killer (and `party`: the members in the room with them),
   * the golem's for each player who earned it (their own). `spots(at, n)` gives n tiles round where it died to lay them
   * on. Returns the new loot.
   */
  drop(kill: LootKill, party: string[], spots: (at: [number, number], n: number) => [number, number][], now: number): Loot[] {
    const lots: { owner: string; contents: LootContent[] }[] = kill.boss
      ? kill.to.map((owner) => ({ owner, contents: golemLoot(this.data, this.random, this.uid) }))
      : kill.to.slice(0, 1).map((owner) => ({ owner, contents: mobDrops(this.data, kill.kind, kill.level, this.random, this.uid) }));
    const total = lots.reduce((n, l) => n + l.contents.length, 0);
    const tiles = spots(kill.at, total);
    let i = 0;
    const out: Loot[] = [];
    for (const lot of lots) {
      for (const content of lot.contents) {
        const [col, row] = tiles[i++ % Math.max(1, tiles.length)] ?? kill.at;
        const loot: Loot = {
          id: `l${++this.n}`,
          col,
          row,
          content,
          owners: kill.boss ? [lot.owner] : [...new Set([lot.owner, ...party])],
          personal: !!kill.boss,
          opensAt: kill.boss ? Infinity : now + this.reserveMs,
          goneAt: now + LOOT_MS,
        };
        this.all.set(loot.id, loot);
        out.push(loot);
      }
    }
    return out;
  }

  get(id: string): Loot | undefined {
    return this.all.get(id);
  }

  /** Whether a member sees it at all (golem loot: its owner only). */
  sees(l: Loot, member: string): boolean {
    return !l.personal || l.owners.includes(member);
  }

  /** Whether a member may pick it up now. */
  mayTake(l: Loot, member: string, now: number): boolean {
    return l.owners.includes(member) || (!l.personal && now >= l.opensAt);
  }

  /** It as a member sees it (null: not at all). */
  view(l: Loot, member: string, now: number): TownLoot | null {
    if (!this.sees(l, member)) return null;
    const mine = this.mayTake(l, member, now);
    return {
      id: l.id,
      col: l.col,
      row: l.row,
      ...('kusing' in l.content ? { kusing: l.content.kusing } : { item: l.content.item }),
      mine,
      ...(!mine && Number.isFinite(l.opensAt) ? { opensIn: Math.max(0, l.opensAt - now) } : {}),
    };
  }

  /** Everything a member sees in the room. */
  viewAll(member: string, now: number): TownLoot[] {
    return [...this.all.values()].flatMap((l) => this.view(l, member, now) ?? []);
  }

  /** What a member could pick up standing at col,row: loot on that tile, and Kusing within KUSING_REACH once it has
   *  settled. */
  takeable(member: string, col: number, row: number, now: number): Loot[] {
    return [...this.all.values()].filter((l) => {
      const far = Math.max(Math.abs(l.col - col), Math.abs(l.row - row));
      const kusing = 'kusing' in l.content && far <= KUSING_REACH && now >= l.goneAt - LOOT_MS + KUSING_SETTLE_MS;
      return (far === 0 || kusing) && this.mayTake(l, member, now);
    });
  }

  /** Taken off the ground. */
  remove(id: string): void {
    this.all.delete(id);
  }

  /** Loot that has lain there long enough: gone (their ids). */
  tick(now: number): string[] {
    const gone = [...this.all.values()].filter((l) => now >= l.goneAt).map((l) => l.id);
    for (const id of gone) this.all.delete(id);
    return gone;
  }
}
