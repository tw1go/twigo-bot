import type { StatsData } from '@mikazuki/shared';

// ❤️ Players' HP and MP in the web town, kept here by member (in memory only: never saved; a restart fills everyone up).
// Their most is the stats rules' (derivedStats: class, level, points, worn gear), given by the host. HP only goes down
// in battle maps (the Slums), from mobs' and the golem's hits; the town and the neighbourhood are safe, and arriving there
// fills both up. A reload in the Slums keeps what they had. In the Slums they come back by stats.json `regen`: HP not
// while in combat (hit, or hitting, in the last outOfCombatAfterSec), else outOfCombatPctPerSec of the most a second; MP
// its mpPerSec ("1 + 0.05 * INT", derivedStats' mpRegen) all the time (skills cost no MP yet). At 0 HP they're knocked
// out for RESPAWN_MS, then the host puts them back at the map's way in with everything full; no penalty. The Bag's slow
// and the Lamp Glare's blindness are kept here too (the host halves their steps and makes their attacks miss). Pure (the
// clock is passed in), so it's tested on its own.

/** Knocked out this long before they respawn. */
export const RESPAWN_MS = 3000;

/** A character's most HP and MP, and MP a second (their derived stats). */
export interface VitalMax {
  hp: number;
  mp: number;
  mpRegen: number;
}

export interface Vital {
  hp: number;
  mp: number;
  max: VitalMax;
  /** The last time they were hit or hit something (ms). */
  combatAt: number;
  /** Regen counted up to then. */
  regenAt: number;
  /** Knocked out: back at this time (ms); 0 when up. */
  outUntil: number;
  slowUntil: number;
  blindUntil: number;
}

/** What players see: HP rounded up (alive is at least 1), MP down. */
export const shown = (v: Vital) => ({ hp: Math.ceil(v.hp), maxHp: v.max.hp, mp: Math.floor(v.mp), maxMp: v.max.mp });

export class Vitals {
  private readonly all = new Map<string, Vital>();

  constructor(private readonly regen: StatsData['regen']) {}

  get(user: string): Vital | undefined {
    return this.all.get(user);
  }

  /** Arriving in a room: a safe one fills them up; a battle map keeps what they had (a reload), full if they're new
   *  here or were knocked out. */
  arrive(user: string, max: VitalMax, battle: boolean, now: number): Vital {
    const v = this.all.get(user);
    if (!battle || !v || v.outUntil) return this.fill(user, max, now);
    v.max = max;
    v.hp = Math.min(v.hp, max.hp);
    v.mp = Math.min(v.mp, max.mp);
    v.regenAt = now;
    return v;
  }

  /** Full HP and MP (a new arrival, a level-up, a respawn). */
  fill(user: string, max: VitalMax, now: number): Vital {
    const v: Vital = { hp: max.hp, mp: max.mp, max, combatAt: -Infinity, regenAt: now, outUntil: 0, slowUntil: 0, blindUntil: 0 };
    const old = this.all.get(user);
    if (old) Object.assign(old, v, { slowUntil: old.slowUntil, blindUntil: old.blindUntil });
    else this.all.set(user, v);
    return this.all.get(user)!;
  }

  /** Their most changed (points, gear): what they have now is kept, under the new most. */
  setMax(user: string, max: VitalMax): void {
    const v = this.all.get(user);
    if (!v) return;
    v.max = max;
    v.hp = Math.min(v.hp, max.hp);
    v.mp = Math.min(v.mp, max.mp);
  }

  /** A hit for `damage`: 'out' if it knocked them out, 'hurt' if not, null if they can't be hit (unknown, or out). */
  hurt(user: string, damage: number, now: number): 'hurt' | 'out' | null {
    const v = this.all.get(user);
    if (!v || v.outUntil) return null;
    v.combatAt = now;
    v.hp = Math.max(0, v.hp - damage);
    if (v.hp > 0) return 'hurt';
    v.outUntil = now + RESPAWN_MS;
    return 'out';
  }

  /** An HP or MP Potion: `amount` more of it, up to their most. How much it gave as shown (0: it would do nothing:
   *  unknown, knocked out, or already full). */
  heal(user: string, stat: 'hp' | 'mp', amount: number): number {
    const v = this.all.get(user);
    if (!v || v.outUntil || v[stat] >= v.max[stat]) return 0;
    const before = shown(v)[stat];
    v[stat] = Math.min(v.max[stat], v[stat] + amount);
    return shown(v)[stat] - before;
  }

  /** Whether they're at their most of it. */
  full(user: string, stat: 'hp' | 'mp'): boolean {
    const v = this.all.get(user);
    return !v || v[stat] >= v.max[stat];
  }

  /** They hit something (or were missed): in combat, so no HP comes back for a while. */
  fought(user: string, now: number): void {
    const v = this.all.get(user);
    if (v && !v.outUntil) v.combatAt = now;
  }

  out(user: string): boolean {
    return !!this.all.get(user)?.outUntil;
  }

  slow(user: string, ms: number, now: number): void {
    const v = this.all.get(user);
    if (v) v.slowUntil = Math.max(v.slowUntil, now + ms);
  }

  slowed(user: string, now: number): boolean {
    return (this.all.get(user)?.slowUntil ?? 0) > now;
  }

  blind(user: string, ms: number, now: number): void {
    const v = this.all.get(user);
    if (v) v.blindUntil = Math.max(v.blindUntil, now + ms);
  }

  blinded(user: string, now: number): boolean {
    return (this.all.get(user)?.blindUntil ?? 0) > now;
  }

  /**
   * Moves the clock on for everyone in a battle map (`battle`): HP and MP come back (HP only out of combat), and the
   * knocked out whose time is up are full again. Returns whose shown HP or MP changed, and who respawns (the host puts
   * them at the way in).
   */
  tick(now: number, battle: Iterable<string>): { changed: string[]; respawned: string[] } {
    const changed: string[] = [];
    const respawned: string[] = [];
    const R = this.regen;
    for (const user of battle) {
      const v = this.all.get(user);
      if (!v) continue;
      if (v.outUntil) {
        if (now < v.outUntil) continue;
        this.fill(user, v.max, now);
        respawned.push(user);
        continue;
      }
      const before = shown(v);
      // HP from when they left combat (or the last tick, if later); MP over the whole time.
      const calm = Math.max(v.regenAt, v.combatAt + R.outOfCombatAfterSec * 1000);
      if (now > calm) v.hp = Math.min(v.max.hp, v.hp + ((now - calm) / 1000) * R.outOfCombatPctPerSec * v.max.hp);
      v.mp = Math.min(v.max.mp, v.mp + ((now - v.regenAt) / 1000) * v.max.mpRegen);
      v.regenAt = now;
      const after = shown(v);
      if (after.hp !== before.hp || after.mp !== before.mp) changed.push(user);
    }
    return { changed, respawned };
  }
}
