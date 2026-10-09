import { type BuffDef, type BuffRefusal, type StatsData, type TownBuff, buffMpCost, buffValue, skillCooldown, strongestBuffs } from '@mikazuki/shared';

// ✨ Buffs in the web town (stats.json skills.buffs; combat-guide.md "Buffs"): who may cast one and who it reaches, and
// the buffs on each member (by member, in memory only, like HP: a restart ends them). A cast is refused off a battle map,
// for another class's buff, under its unlock level, while knocked out, on cooldown (cooldownSec, −1% a skill level; a
// stance's switch: rules.stanceSwitchSec) or without the MP (buffMpCost at its skill level). It reaches the caster, and
// one party member (`ally+self`: the one asked for if in range, else the nearest) or every one (`party`) in the same
// room, up and within rules.partyRangeTiles (tiles either way, like every tile check). The player you've picked (clicked)
// counts too, in your party or not: a one-ally buff goes to them first, a party buff reaches them as well. With
// rules.allyBuffsReachParty (a repo addition), a one-ally buff is shared like a party buff: the whole party in range too. A timed buff on someone is its
// stats at the caster's skill level (buffValue) until it runs out; casting it again restarts it. For each stat only the
// strongest buff counts (strongestBuffs). Timed buffs end on time, on leaving the battle map and on a knock-out; a
// stance (Keen Stance) stays on until cast again (off) or a class change, across maps. Soothing Touch (durationSec 0)
// is no buff: an instant heal the host gives (the caster's Power × its healPctOfPower). Pure (the clock is passed in).

/** A buff on someone: whose (the caster, by member), at which skill level, its stats then, and when it ends (null: a
 *  stance). */
export interface BuffOn {
  name: string;
  cls: string;
  by: string;
  level: number;
  stats: Record<string, number>;
  endsAt: number | null;
}

/** Who casts: their member, class, level, the buff's skill level, knocked out or not, whether the room is a battle map,
 *  their MP now and their tile. */
export interface Caster {
  member: string;
  cls: string | null | undefined;
  level: number;
  skillLevel: number;
  out: boolean;
  battle: boolean;
  mp: number;
  at: [number, number];
}

/** A member of their party in the same room. */
export interface Nearby {
  member: string;
  at: [number, number];
  out: boolean;
}

export type CastResult =
  | { ok: false; reason: BuffRefusal; ms?: number }
  /** It goes: the MP to spend, who it reaches (the caster first), its cooldown (ms), a heal's share of Power (null: a
   *  buff), and whether it turned a stance off. */
  | { ok: true; buff: BuffDef; mp: number; to: string[]; cooldownMs: number; heal: number | null; off: boolean };

const cheb = (a: [number, number], b: [number, number]) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

export class Buffs {
  private readonly on = new Map<string, BuffOn[]>();
  /** When each member's buff may be cast again (`member:name` → ms). */
  private readonly ready = new Map<string, number>();

  constructor(private readonly data: StatsData) {}

  private def(name: string): BuffDef | undefined {
    return this.data.skills.buffs?.list[name];
  }

  /** A cast (checked, then put on everyone it reaches; a heal only says who). `party`: their party members in the same
   *  room; `target`: the player they've picked (any player in the room: a party member's member id, or anyone's place). */
  cast(c: Caster, name: string, party: Nearby[], target: string | Nearby | undefined, now: number): CastResult {
    const b = this.def(name);
    if (!c.battle) return { ok: false, reason: 'here' };
    if (!b || b.class !== c.cls) return { ok: false, reason: 'skill' };
    if (c.level < b.unlock) return { ok: false, reason: 'locked' };
    if (c.out) return { ok: false, reason: 'out' };
    const key = `${c.member}:${name}`;
    const ready = this.ready.get(key) ?? 0;
    if (now < ready) return { ok: false, reason: 'slow', ms: ready - now };
    const off = !!b.stance && this.has(c.member, name);
    const mp = off ? 0 : buffMpCost(this.data, name, c.skillLevel);
    if (c.mp < mp) return { ok: false, reason: 'mp' };
    const R = this.data.skills.buffs!.rules;
    const cooldownMs = Math.round((b.stance ? Number(R.stanceSwitchSec) : skillCooldown(this.data, b.cooldownSec, c.skillLevel)) * 1000);
    this.ready.set(key, now + cooldownMs);
    // Who: the caster, their party members up and within range, and the player they've picked if up and within range
    // (a one-ally buff: the picked one, else the nearest party member).
    const reach = (p: Nearby) => p.member !== c.member && !p.out && cheb(p.at, c.at) <= Number(R.partyRangeTiles);
    const near = party.filter(reach);
    const asked = typeof target === 'string' ? party.find((p) => p.member === target) : target;
    const picked = asked && reach(asked) ? asked : undefined;
    const to = [c.member];
    const shared = b.target === 'party' || (b.target === 'ally+self' && !!(R as { allyBuffsReachParty?: boolean }).allyBuffsReachParty);
    if (shared) to.push(...near.map((p) => p.member), ...(picked && !near.some((p) => p.member === picked.member) ? [picked.member] : []));
    if (b.target === 'ally+self' && !shared) {
      const pick = picked ?? [...near].sort((x, y) => cheb(x.at, c.at) - cheb(y.at, c.at))[0];
      if (pick) to.push(pick.member);
    }
    const stats = buffValue(this.data, name, c.skillLevel);
    // An instant heal: nothing stays on them.
    if (b.durationSec === 0) return { ok: true, buff: b, mp, to, cooldownMs, heal: stats.healPctOfPower ?? 0, off: false };
    if (b.stance) {
      // One stance at a time: on (any other off), or off again.
      const mine = (this.on.get(c.member) ?? []).filter((x) => x.endsAt !== null);
      this.on.set(c.member, off ? mine : [...mine, { name, cls: b.class, by: c.member, level: c.skillLevel, stats, endsAt: null }]);
      return { ok: true, buff: b, mp, to: [c.member], cooldownMs, heal: null, off };
    }
    for (const m of to) this.give(m, { name, cls: b.class, by: c.member, level: c.skillLevel, stats, endsAt: now + (b.durationSec ?? 0) * 1000 });
    return { ok: true, buff: b, mp, to, cooldownMs, heal: null, off: false };
  }

  /** A buff on someone (the same buff again: the new one, its timer restarted). */
  private give(member: string, b: BuffOn): void {
    this.on.set(member, [...(this.on.get(member) ?? []).filter((x) => x.name !== b.name), b]);
  }

  has(member: string, name: string): boolean {
    return !!this.on.get(member)?.some((x) => x.name === name);
  }

  /** The buffs on someone. */
  list(member: string): BuffOn[] {
    return this.on.get(member) ?? [];
  }

  /** As the buff tray shows them (ms left; null: a stance). */
  view(member: string, now: number): TownBuff[] {
    return this.list(member).map((b) => ({ name: b.name, cls: b.cls, level: b.level, stats: b.stats, ms: b.endsAt === null ? null : Math.max(0, b.endsAt - now) }));
  }

  /** Their buffs as one set of stats: for each stat the strongest. */
  effective(member: string): Record<string, number> {
    return strongestBuffs(this.list(member));
  }

  /** Timed buffs that ran out: off, and whose changed. */
  tick(now: number): string[] {
    const changed: string[] = [];
    for (const [member, list] of this.on) {
      const left = list.filter((b) => b.endsAt === null || b.endsAt > now);
      if (left.length === list.length) continue;
      this.on.set(member, left);
      changed.push(member);
    }
    return changed;
  }

  /** Leaving the battle map, or knocked out: their timed buffs end (stances stay). Whether any did. */
  endTimed(member: string): boolean {
    return this.keep(member, (b) => b.endsAt === null);
  }

  /** A class change: their stances end (timed buffs run on). Whether any did. */
  endStances(member: string): boolean {
    return this.keep(member, (b) => b.endsAt !== null);
  }

  private keep(member: string, f: (b: BuffOn) => boolean): boolean {
    const list = this.on.get(member) ?? [];
    const left = list.filter(f);
    if (left.length === list.length) return false;
    this.on.set(member, left);
    return true;
  }
}
