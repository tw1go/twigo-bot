import type { ItemData, TownLoot } from '@mikazuki/shared';
import { LOOT_REACH, type LevelingData, itemStats, miniBossRules, numbersIn } from '@mikazuki/shared';
import type { LootContent } from './combat-bag.js';
import { golemLoot, miniLoot, mobDrops } from './loot.js';
import { loadLeveling } from './stats-data.js';

// 🪙 Loot on the ground in a battle map (one LootRoom per room with mobs, run by the town: web/town.ts). A kill's drops
// (web/loot.ts) land round where it died, each on its own tile. Who may pick each one up (stats.json `party`): a solo
// kill's are the killer's for 10 s, then anyone's; a party's are any member's (those in the room when it fell) for 10 s,
// then anyone's (Kusing a party member picks up is split equally between the party in the room: splitKusing, the
// town does it); the golem's and a mini boss's are personal, each player's own, never anyone else's (and never shown to them). Nothing is
// picked up on its own (not by walking over it, Kusing neither): a click on it or F / Space picks it up, within
// LOOT_REACH (shared). Loot lies there for LOOT_MS, then it's gone. Everything is by member (it outlasts a reload). Pure
// (the clock is passed in).

/** Kusing picked up in a party, split equally between `members` (the picker first): each the same whole share, the
 *  picker the remainder too; nobody gets 0 (a heap smaller than the party: the first in line, a Kusing each). */
export function splitKusing(amount: number, members: string[]): Map<string, number> {
  const who = members.length ? members : [];
  const share = Math.floor(amount / Math.max(1, who.length));
  const out = new Map<string, number>();
  if (!share) {
    who.slice(0, amount).forEach((m) => out.set(m, 1));
    return out;
  }
  who.forEach((m) => out.set(m, share));
  if (who.length) out.set(who[0], share + (amount - share * who.length));
  return out;
}

/** Loot lies on the ground this long. */
export const LOOT_MS = 2 * 60_000;

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
  /** A mini boss (classes/leveling.json): personal loot for each of `to` (miniLoot). */
  mini?: string;
}

export class LootRoom {
  private readonly all = new Map<string, Loot>();
  private n = 0;
  /** How long a kill's loot is kept for its killer (or party): stats.json party.solo ("killer only for 10 s"). */
  readonly reserveMs: number;
  private readonly minis: ReturnType<typeof miniBossRules> | null;

  constructor(
    private readonly data: ItemData,
    private readonly random: () => number = Math.random,
    private readonly uid: () => string = () => Math.random().toString(16).slice(2, 18),
    /** Dropped gear's plus (loot.ts dropPlus): `random` unless given (the dev town's rich loot). */
    private readonly plusRandom: () => number = random,
    leveling: LevelingData | null = loadLeveling(),
  ) {
    this.minis = leveling ? miniBossRules(leveling) : null;
    this.reserveMs = (numbersIn(itemStats(data.stats).party.solo)[0] ?? 10) * 1000;
  }

  /**
   * A kill's drops, rolled and laid out, one set that everyone sees: a normal mob's held 10 s for its killer (and
   * `party`: the members in the room with them), the golem's and a mini boss's for everyone who earned it (`to`); then
   * anyone's. `spots(at, n)` gives n tiles round where it died to lay them on. Returns the new loot.
   */
  drop(kill: LootKill, party: string[], spots: (at: [number, number], n: number) => [number, number][], now: number): Loot[] {
    const mini = kill.mini && this.minis ? this.minis : null;
    // One set for everyone (no personal copies): the golem's, a mini boss's or a mob's.
    const contents: LootContent[] = kill.boss
      ? golemLoot(this.data, this.random, this.uid, this.plusRandom)
      : mini
        ? miniLoot(this.data, kill.kind, kill.level, mini, this.random, this.uid, this.plusRandom)
        : mobDrops(this.data, kill.kind, kill.level, this.random, this.uid, this.plusRandom);
    // Its head start: everyone who earned a boss's, else the killer and their party.
    const owners = kill.boss || mini ? [...new Set([...kill.to, ...party])] : [...new Set([...kill.to.slice(0, 1), ...party])];
    const lots = kill.to.length ? [{ owners, contents }] : [];
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
          owners: lot.owners,
          personal: false,
          opensAt: now + this.reserveMs,
          goneAt: now + LOOT_MS,
        };
        this.all.set(loot.id, loot);
        out.push(loot);
      }
    }
    return out;
  }

  /** Personal loot for one member (theirs alone, never opening to anyone: a mini boss's quest piece), laid round `at`. */
  give(owner: string, contents: LootContent[], at: [number, number], spots: (at: [number, number], n: number) => [number, number][], now: number): Loot[] {
    const tiles = spots(at, contents.length);
    return contents.map((content, i) => {
      const [col, row] = tiles[i % Math.max(1, tiles.length)] ?? at;
      const loot: Loot = { id: `l${++this.n}`, col, row, content, owners: [owner], personal: true, opensAt: Infinity, goneAt: now + LOOT_MS };
      this.all.set(loot.id, loot);
      return loot;
    });
  }

  /** An item a player dropped (dragged out of their bag), at `at`: for `party` (their party: they alone may see and take
   *  it, ever), or for anyone at once (not in a party). Gone after LOOT_MS like the rest. */
  place(content: LootContent, at: [number, number], party: string[], now: number): Loot {
    const loot: Loot = { id: `l${++this.n}`, col: at[0], row: at[1], content, owners: party, personal: party.length > 0, opensAt: party.length ? Infinity : now, goneAt: now + LOOT_MS };
    this.all.set(loot.id, loot);
    return loot;
  }

  /** The tiles loot lies on now ("col,row"), so new loot lands beside it rather than on top. */
  taken(): Set<string> {
    return new Set([...this.all.values()].map((l) => `${l.col},${l.row}`));
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

  /** Whether loot is within LOOT_REACH of col,row (tiles, either way). */
  inReach(l: Loot, col: number, row: number): boolean {
    return Math.max(Math.abs(l.col - col), Math.abs(l.row - row)) <= LOOT_REACH;
  }

  /** What a member may pick up standing at col,row: `id`, if it's within reach and theirs to take; without one, the
   *  nearest such (the oldest of the nearest). Null: nothing. */
  pickable(member: string, col: number, row: number, now: number, id?: string): Loot | null {
    const ok = (l: Loot | undefined): l is Loot => !!l && this.inReach(l, col, row) && this.mayTake(l, member, now);
    if (id !== undefined) {
      const l = this.all.get(id);
      return ok(l) ? l : null;
    }
    const far = (l: Loot) => Math.abs(l.col - col) + Math.abs(l.row - row);
    return [...this.all.values()].filter(ok).sort((a, b) => far(a) - far(b))[0] ?? null;
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
