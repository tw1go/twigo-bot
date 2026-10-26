import { readFileSync } from 'node:fs';
import { type GreatScaleChange, type MobStats, type StatsData, type TelegraphShape, type TownGreatScale, greatScaleHpPerPlayer, mobStats } from '@mikazuki/shared';
import { type MobDirector, type MobEvent, type MobRoom, type MobZoneData, facing8 } from './town-mobs.js';
import { inShape } from './town-warrens.js';

// ⚖️ Ang Dakilang Timbangan, the Great Scale: the Lumang Palengke's field boss in the Market Hall (CONTEXT.md Great
// Scale, Weigh-in, Bell; maps/palengke.json `boss`, stats.json's mob table `great-scale`). Built on the boss hooks the
// Scrap Warrens' bosses use (the room's director: red telegraphs as `boss-move`, their hits decided where everyone
// stands as they land, `boss-hit`; called mobs) with the golem's field boss parts: it wakes every `everyMinutes` (a line
// `warnMinutes` before and one as it wakes; its next waking kept through restarts: `setSchedule`, the bot's kv), its XP
// and personal loot for everyone who did 5% of its HP (the room's field mob: town-mobs.ts), the boss bar and the HUD
// timer (the game's).
// • Between fights it stays in the hall asleep: still, dimmed, not to be targeted (a dormant mob). At its time it wakes.
// • No basic attack: only its three moves hurt, one at a time while anyone is in its fight (its arena), it standing still
//   as each is cast:
//   - Pan Slam (every 8 s): a 2-tile circle under each of its two closest players, 1.2 s, ×skillMult.panSlam.
//   - Weigh-in (every 14 s, only with two or more in its fight, else a Pan Slam): a 1-tile circle under a random player
//     within 6 tiles of it, 1 s; whoever is in it then is grabbed (×weighIn) and held on its pan: no steps, attacks or
//     moves, 5% of their most HP a second. The pan is a mob of its own at their tile (8% of its most HP) only the others
//     can hit; killing it lets them go, else it lets go after 8 s.
//   - Kulang sa Timbang (every 12 s): a 90° cone toward its foe (else the nearest), 5 tiles past its body, 1.5 s,
//     ×shortWeight; it takes the newest timed class buff off everyone it catches.
//   At 50% HP it calls 3 Timbangan Sentinels (they drop in round the arena), at 25% it enrages: every move 30% sooner.
// • 30 s with nobody in its fight: it resets (full HP, its Sentinels and the pan gone, home). 30 minutes awake with no
//   hit and no fight: it sinks back to sleep. Its lines go only to the Palengke's room (system kind 'golem'), never
//   Discord.
// • Down: its loot and XP (the room's kill), then its bell on its tile for 60 s: ringing it (within 3 tiles) moves on
//   the "ring the bell" step of everyone near it who's on it (town.ts); then it's back asleep and wakes again
//   `everyMinutes` after its fall.

export const GREAT_SCALE_ZONE = 'great-scale';
export const PAN_KIND = 'great-scale-pan';
const SENTINEL = 'timbangan-sentinel';
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const PAN_SLAM = { everyMs: 8 * SECOND, ms: 1200, radius: 2 };
const WEIGH_IN = { everyMs: 14 * SECOND, ms: 1000, radius: 1, within: 6, holdMs: 8 * SECOND, hpPct: 0.05, panShare: 0.08 };
const SHORT_WEIGHT = { everyMs: 12 * SECOND, ms: 1500, angle: 90, past: 5 };
const CALL = { at: 0.5, sentinels: 3 };
const ENRAGE = { at: 0.25, sooner: 0.3 };
const RESET_MS = 30 * SECOND;
const SINK_MS = 30 * MINUTE;
const BELL_MS = 60 * SECOND;
/** Its first moves after its fight begins. */
const FIRST: Record<Move, number> = { panSlam: 3 * SECOND, shortWeight: 7 * SECOND, weighIn: 10 * SECOND };

type Move = 'panSlam' | 'weighIn' | 'shortWeight';
type Tile = [number, number];

/** maps/palengke.json `boss`. */
export interface FieldBossDef {
  id: string;
  name: string;
  level: number;
  tile: Tile;
  arena: [number, number, number, number];
  everyMinutes: number;
  warnMinutes: number;
  leash: number;
}

/** What the art and rules give it: its body's radius in tiles, when its moves land after their anim starts (ms: the
 *  hit frame at its fps), and how long its call takes before the Sentinels are down. */
export interface GreatScaleArt {
  radius: number;
  callMs: number;
}

/** Its art's numbers: mobs/mobs.json (its body's radius, its call's frame) at the manifest's fps. */
export function loadGreatScaleArt(id = 'great-scale'): GreatScaleArt {
  const read = (file: string) => JSON.parse(readFileSync(new URL(`../../../game/public/assets/${file}`, import.meta.url), 'utf8'));
  const data = read('mobs/mobs.json')[id] as { radius?: number; callFrame?: number };
  const fps = (read('manifest.json').mobs[id] as { animations: Record<string, { fps: number }> }).animations.call?.fps ?? 12;
  return { radius: data.radius ?? 2, callMs: Math.round(((data.callFrame ?? 0) / fps) * 1000) };
}

/** The next waking after `now`: the next whole `everyMinutes` since the epoch (the golem's rule). */
const nextAfter = (now: number, everyMinutes: number) => (Math.floor(now / (everyMinutes * MINUTE)) + 1) * everyMinutes * MINUTE;
const hyp = (a: Tile, b: Tile) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The line as it falls: everyone who hit it. */
export function scaleDownLine(names: string[], boss: string): string {
  const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? 'Someone';
  return `${who} brought down ${boss}! Ring its bell in the Market Hall.`;
}

interface Pending {
  at: number;
  land: (now: number, players: ReadonlyMap<string, Tile>) => MobEvent[];
}

export class GreatScale implements MobDirector {
  private room: MobRoom | null = null;
  private phase: 'asleep' | 'awake' | 'dead' = 'asleep';
  private nextRise: number | null = null;
  private warned = 0;
  private save: ((at: number | null) => void) | null = null;
  /** When it last was hit, when its fight began (null: none), when its arena was last seen empty mid-fight. */
  private lastHit = 0;
  private engaged: number | null = null;
  private empty: number | null = null;
  private next = new Map<Move, number>();
  private casting = 0;
  private pending: Pending[] = [];
  private moveSeq = 0;
  private called = false;
  private enraged = false;
  private calls = 0;
  /** Its fall: its bell until then, and when it fell. */
  private bellUntil = 0;
  private fellAt = 0;
  /** Someone held on its pan. */
  private held: { player: string; pan: string; until: number; nextSqueeze: number } | null = null;
  private pans = 0;
  /** Its row in the mob table (level, HP, ATK, DEF, XP, its moves' multipliers). */
  private readonly stats: MobStats;

  constructor(
    readonly boss: FieldBossDef,
    private readonly data: StatsData,
    private readonly art: GreatScaleArt,
    private readonly random: () => number = Math.random,
  ) {
    const s = mobStats(data, boss.id);
    if (!s) throw new Error(`No stats for the field boss ${boss.id} (classes/stats.json mobs.list)`);
    this.stats = s;
  }

  get id(): string {
    return this.boss.id;
  }

  /** Its most HP with `n` players in the Old Market: the mob table's × hpPerPlayer ^ n (stats.json
   *  mobBehaviour.greatScale, like the golem's), never under the table's. */
  hpFor(n: number): number {
    return Math.max(this.stats.hp, Math.round(this.stats.hp * greatScaleHpPerPlayer(this.data) ** n));
  }

  /** The zone the Palengke's mob room needs for it (its arena; added to its map's zones as it's made). */
  static zone(boss: FieldBossDef, height: number): MobZoneData {
    return { id: GREAT_SCALE_ZONE, mob: boss.id, level: boss.level, rect: boss.arena, height, active: true, spawns: [], aggro: 'aggressive', aggroRange: boss.leash, leash: boss.leash, field: true };
  }

  /** Hands it its mob room (the Palengke's): its mob there from now on, asleep (arrivals see it at once). */
  attach(room: MobRoom): void {
    this.room = room;
    if (!room.mobInfo(this.id, 0)) this.place(0, true);
  }

  /** When it wakes next as last kept (a time in the past: it was awake then, so it wakes at once; null: nothing kept,
   *  the next whole `everyMinutes`), and where to keep it as that changes. */
  setSchedule(at: number | null, save?: (at: number | null) => void): void {
    this.nextRise = at;
    this.save = save ?? null;
  }

  /** Its name and when it wakes next on its own (null: it's awake now). */
  plan(now: number): { name: string; nextRise: number | null; everyMinutes: number } {
    const nextRise = this.phase === 'awake' ? null : this.phase === 'dead' ? this.fellAt + this.boss.everyMinutes * MINUTE : (this.nextRise ?? nextAfter(now, this.boss.everyMinutes));
    return { name: this.boss.name, nextRise, everyMinutes: this.boss.everyMinutes };
  }

  /** As the room sees it now. */
  state(now: number): TownGreatScale {
    const next = this.plan(now).nextRise;
    return {
      id: this.boss.id, name: this.boss.name, state: this.phase, warnMinutes: this.boss.warnMinutes, enraged: this.enraged, arena: this.boss.arena,
      ...(next !== null ? { riseIn: Math.max(0, next - now) } : {}),
      ...(this.phase === 'dead' && now < this.bellUntil ? { bell: { at: this.boss.tile, left: this.bellUntil - now } } : {}),
      ...(this.held ? { held: { id: this.held.player, pan: this.held.pan, left: Math.max(0, this.held.until - now) } } : {}),
    };
  }

  /** As the CMS's Field boss tab shows it: awake or not, its HP, when it wakes next on its own. */
  cmsView(now: number): { name: string; everyMinutes: number; nextRise: number | null; up: boolean; state: string; hp: number; maxHp: number } {
    const info = this.room?.mobInfo(this.id, now);
    const up = this.phase === 'awake';
    return { name: this.boss.name, everyMinutes: this.boss.everyMinutes, nextRise: this.plan(now).nextRise, up, state: up ? (this.engaged !== null ? 'fight' : 'idle') : this.phase === 'dead' ? 'dead' : 'asleep', hp: up ? (info?.hp ?? 0) : 0, maxHp: info?.maxHp ?? this.stats.hp };
  }

  /** Where its bell rings now (after its fall, for 60 s), or null. */
  bell(now: number): Tile | null {
    return this.phase === 'dead' && now < this.bellUntil ? this.boss.tile : null;
  }

  /** It wakes now (dev's ?greatscale=now, the CMS's Spawn now); false: it's up already (or not attached). */
  wakeNow(now: number): boolean {
    if (this.phase === 'awake' || !this.room) return false;
    this.toWake.push(now);
    return true;
  }
  private toWake: number[] = [];

  /** Someone held who is gone (left the room, knocked out): let go. */
  forget(player: string, now: number): MobEvent[] {
    return this.held?.player === player ? this.release(now) : [];
  }

  // ── The director (the Palengke's mob room's) ──

  tick(now: number, players: ReadonlyMap<string, Tile>): MobEvent[] {
    const room = this.room;
    if (!room) return [];
    const events: MobEvent[] = [];
    // Its mob: there from the start, asleep; its most HP for the players in the Old Market (its share kept).
    if (!room.mobInfo(this.id, now)) events.push(...this.place(now, true));
    events.push(...room.setMaxHp(this.id, this.hpFor(players.size)));
    // Moves landing now.
    const due = this.pending.filter((p) => p.at <= now);
    if (due.length) {
      this.pending = this.pending.filter((p) => p.at > now);
      for (const p of due) events.push(...p.land(now, players));
    }
    if (this.toWake.length) {
      this.toWake = [];
      if (this.phase === 'dead') events.push(...this.sleep(now, false));
      events.push(...this.wake(now));
    }
    if (this.phase === 'asleep') return [...events, ...this.schedule(now)];
    if (this.phase === 'dead') {
      // Its bell's time over: back asleep, fading in.
      if (now >= this.bellUntil) events.push(...this.sleep(now, false));
      return events;
    }
    // Held on the pan: squeezed every second, let go after its time (or if they're gone).
    const h = this.held;
    if (h) {
      if (!players.has(h.player) || now >= h.until) events.push(...this.release(now));
      else if (now >= h.nextSqueeze) {
        h.nextSqueeze += SECOND;
        room.land(h.player, this.id, { damage: 0 }, now, { hpPct: WEIGH_IN.hpPct });
      }
    }
    const near = [...players].filter(([, p]) => this.inArena(p));
    const info = room.mobInfo(this.id, now);
    if (!info || info.dead) return events;
    if (info.foe && this.engaged === null) this.engaged = now;
    if (this.engaged !== null) {
      // Nobody in its fight for RESET_MS: it resets.
      if (near.length) this.empty = null;
      else if ((this.empty ??= now) && now - this.empty >= RESET_MS) return [...events, ...this.reset(now)];
    } else if (now - this.lastHit >= SINK_MS) return [...events, ...this.sink(now)];
    if (this.engaged === null || !near.length || now < this.casting) return events;
    // Its moves: whichever is due first (one at a time).
    const due2 = (['panSlam', 'shortWeight', 'weighIn'] as Move[]).filter((m) => now >= (this.next.get(m) ?? this.engaged! + FIRST[m]));
    const move = due2[0];
    if (!move) return events;
    const every = (m: Move) => ({ panSlam: PAN_SLAM.everyMs, weighIn: WEIGH_IN.everyMs, shortWeight: SHORT_WEIGHT.everyMs })[m] * (this.enraged ? 1 - ENRAGE.sooner : 1);
    this.next.set(move, now + every(move));
    // (Solo, or someone held already: no Weigh-in, a Pan Slam instead.)
    const go: Move = move === 'weighIn' && (near.length < 2 || this.held) ? 'panSlam' : move;
    return [...events, ...this.start(go, info.at, info.foe, near, now)];
  }

  /** Its mob as it starts: asleep (`dormant`) or not, on its tile, whole. */
  private place(now: number, dormant: boolean): MobEvent[] {
    const room = this.room!;
    const events = room.addMobs([{ id: this.id, kind: this.id, zone: GREAT_SCALE_ZONE, tile: this.boss.tile, stats: { ...this.stats }, name: this.boss.name, radius: this.art.radius, silent: true, field: true, dormant }], now);
    // (Asleep, it faces south: down the hall, toward whoever comes in.)
    return dormant ? [...events, ...room.face(this.id, 's')] : events;
  }

  /** Asleep: the warning `warnMinutes` before its time, then it wakes. */
  private schedule(now: number): MobEvent[] {
    this.nextRise ??= nextAfter(now, this.boss.everyMinutes);
    const events: MobEvent[] = [];
    if (now >= this.nextRise - this.boss.warnMinutes * MINUTE && this.warned !== this.nextRise) {
      this.warned = this.nextRise;
      events.push(this.line('The needle is moving... the Great Scale in the Market Hall is stirring.', 'stir'));
    }
    if (now >= this.nextRise) events.push(...this.wake(now));
    return events;
  }

  private wake(now: number): MobEvent[] {
    const room = this.room!;
    this.phase = 'awake';
    this.nextRise = null;
    this.save?.(now); // (awake: a restart now wakes it straight away)
    Object.assign(this, { lastHit: now, engaged: null, empty: null, casting: 0, called: false, enraged: false });
    this.next.clear();
    return [...room.setFlags(this.id, { dormant: false }), this.change('wake', now), this.line(`${this.boss.name} has woken in the Market Hall! Step up and be weighed.`, 'rise')];
  }

  /** Back asleep: after its bell (`sank` false; it wakes `everyMinutes` after its fall) or sunk unhit (from now). */
  private sleep(now: number, sank: boolean): MobEvent[] {
    const room = this.room!;
    const from = sank ? now : this.fellAt;
    this.phase = 'asleep';
    this.nextRise = from + this.boss.everyMinutes * MINUTE;
    this.save?.(this.nextRise);
    const events = [...this.endFight(now), ...room.removeMobs([this.id]), ...this.place(now, true)];
    events.push(this.change(sank ? 'sink' : 'sleep', now));
    return events;
  }

  /** 30 minutes awake with nobody hitting it or in its fight: it sinks back to sleep. */
  private sink(now: number): MobEvent[] {
    return [...this.sleep(now, true), this.line(`Nobody fought it. ${this.boss.name} settles back to sleep in the Market Hall.`, 'down')];
  }

  /** Nobody in its fight: full HP, its Sentinels and pan gone, home. */
  private reset(now: number): MobEvent[] {
    const room = this.room!;
    const events = [...this.endFight(now), ...room.healFull(this.id), ...room.walkHome(this.id, now)];
    Object.assign(this, { engaged: null, empty: null, called: false, enraged: false, lastHit: now });
    this.next.clear();
    events.push(this.change('reset', now));
    return events;
  }

  /** Its fight over (a reset, its fall, sleep): its moves on the way cancelled, the held let go, its Sentinels and pans
   *  gone. */
  private endFight(now: number): MobEvent[] {
    const room = this.room!;
    const events: MobEvent[] = [];
    if (this.pending.length) events.push({ t: 'boss-cancel', id: this.id });
    this.pending = [];
    this.casting = 0;
    events.push(...this.release(now));
    events.push(...room.removeMobs([...room.calledBy(this.id), ...room.calledBy(PAN_KIND)]));
    return events;
  }

  /** Its HP fell (or it died): the call at half, the enrage at a quarter, its fall; the pan breaking. */
  hurt(id: string, now: number): MobEvent[] {
    const room = this.room;
    if (!room) return [];
    if (this.held && id === this.held.pan) return room.mobInfo(id, now)?.dead ? this.release(now) : [];
    if (id !== this.id) return [];
    const info = room.mobInfo(id, now);
    if (!info) return [];
    this.lastHit = now;
    if (this.engaged === null) this.engaged = now;
    if (info.dead) return this.fall(now);
    const share = info.hp / info.maxHp;
    const events: MobEvent[] = [];
    if (!this.called && share <= CALL.at) {
      this.called = true;
      events.push(...this.call(info.at, now));
    }
    if (!this.enraged && share <= ENRAGE.at) {
      this.enraged = true;
      // (Its moves due sooner from now on.)
      for (const [m, t] of this.next) this.next.set(m, now + (t - now) * (1 - ENRAGE.sooner));
      events.push(this.change('enrage', now));
    }
    return events;
  }

  /** At half HP: 3 Timbangan Sentinels drop in round the arena (at its own level), once its call anim lands. */
  private call(at: Tile, now: number): MobEvent[] {
    const room = this.room!;
    const [c0, r0, c1, r1] = this.boss.arena;
    // Open floor 2 to 6 tiles off its body, shuffled, at least 2 tiles apart.
    const free: Tile[] = [];
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const d = hyp([c, r], at);
        if (d >= this.art.radius + 2 && d <= this.art.radius + 6 && room.open(c, r) && !room.occupied(c, r)) free.push([c, r]);
      }
    }
    for (let i = free.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [free[i], free[j]] = [free[j], free[i]];
    }
    const spots: Tile[] = [];
    for (const t of free) if (spots.length < CALL.sentinels && spots.every((s) => hyp(s, t) >= 2)) spots.push(t);
    const S = mobStats(this.data, SENTINEL);
    if (!S || !spots.length) return [];
    this.pending.push({
      at: now + this.art.callMs,
      land: (t) => room.addMobs(spots.map((tile) => ({ id: `${this.id}:sentinel:${++this.calls}`, kind: SENTINEL, zone: GREAT_SCALE_ZONE, tile, stats: { level: S.level, hp: S.hp, atk: S.atk, def: S.def, xp: S.xp }, calledBy: this.id })), t),
    });
    return [{ ...this.change('call', now), spots }];
  }

  /** It fell: its fight over, its bell for 60 s (the room's kill gives its XP and loot). */
  private fall(now: number): MobEvent[] {
    const events = this.endFight(now);
    this.phase = 'dead';
    this.fellAt = now;
    this.bellUntil = now + BELL_MS;
    this.save?.(now + this.boss.everyMinutes * MINUTE);
    events.push(this.change('death', now));
    return events;
  }

  // ── Its moves ──

  private moveEvent(move: Move, ms: number, shape: TelegraphShape, data: Record<string, unknown>): Extract<MobEvent, { t: 'boss-move' }> {
    return { t: 'boss-move', id: this.id, move, key: `${this.id}:${++this.moveSeq}`, ms, shape, data };
  }

  /** Hits on everyone in a shape as it lands (where they stand then), `extra` on each one hit. */
  private landHits(move: Move, key: string, players: ReadonlyMap<string, Tile>, shape: TelegraphShape, mult: number, now: number, extra: { strip?: boolean } = {}): MobEvent[] {
    const room = this.room!;
    const hits: { id: string; damage: number; miss?: boolean }[] = [];
    for (const [id, p] of players) {
      if (!inShape(shape, p) || id === this.held?.player) continue;
      const hit = room.rollFor(id, this.id, mult);
      if (!hit) continue;
      room.land(id, this.id, hit, now, extra);
      hits.push({ id, damage: hit.damage, ...(hit.miss ? { miss: true } : {}) });
    }
    return [{ t: 'boss-hit', id: this.id, move, key, hits }];
  }

  private start(move: Move, at: Tile, foe: string | null, near: [string, Tile][], now: number): MobEvent[] {
    const room = this.room!;
    const mult = this.stats.skillMult?.[move] ?? 1;
    const closest = [...near].sort((x, y) => hyp(x[1], at) - hyp(y[1], at));
    const aim = (p: Tile) => room.face(this.id, facing8(p[0] - at[0], p[1] - at[1]) ?? 'sw');
    const queue = (ev: Extract<MobEvent, { t: 'boss-move' }>, land: Pending['land']) => {
      this.casting = now + ev.ms;
      this.pending.push({ at: now + ev.ms, land });
      return [...room.hold(this.id, now + ev.ms, now), ev];
    };
    switch (move) {
      case 'panSlam': {
        const shape: TelegraphShape = { kind: 'circles', circles: closest.slice(0, 2).map(([, p]) => ({ at: p, radius: PAN_SLAM.radius })) };
        const ev = this.moveEvent(move, PAN_SLAM.ms, shape, { anim: 'attack' });
        return [...aim(closest[0][1]), ...queue(ev, (t, players) => this.landHits(move, ev.key, players, shape, mult, t))];
      }
      case 'shortWeight': {
        const target = near.find(([id]) => id === foe) ?? closest[0];
        const facing = Math.atan2(target[1][1] - at[1], target[1][0] - at[0]);
        const shape: TelegraphShape = { kind: 'cone', origin: at, facing, angle: SHORT_WEIGHT.angle, length: this.art.radius + SHORT_WEIGHT.past };
        const ev = this.moveEvent(move, SHORT_WEIGHT.ms, shape, { anim: 'cone' });
        return [...aim(target[1]), ...queue(ev, (t, players) => this.landHits(move, ev.key, players, shape, mult, t, { strip: true }))];
      }
      case 'weighIn': {
        const within = near.filter(([, p]) => hyp(p, at) - this.art.radius <= WEIGH_IN.within);
        if (!within.length) return this.start('panSlam', at, foe, near, now);
        const [target, p] = within[Math.floor(this.random() * within.length)];
        const shape: TelegraphShape = { kind: 'circle', at: p, radius: WEIGH_IN.radius };
        const ev = this.moveEvent(move, WEIGH_IN.ms, shape, { anim: 'weigh', target });
        return [...aim(p), ...queue(ev, (t, players) => this.grab(ev.key, players, shape, target, mult, t))];
      }
    }
  }

  /** Weigh-in lands: whoever is in its circle (its target first) is grabbed and held on the pan, the pan a mob at their
   *  tile; a miss (or nobody there): nothing. */
  private grab(key: string, players: ReadonlyMap<string, Tile>, shape: TelegraphShape, target: string, mult: number, now: number): MobEvent[] {
    const room = this.room!;
    const inside = [...players].filter(([, p]) => inShape(shape, p));
    const who = inside.find(([id]) => id === target) ?? inside[0];
    const hit = who && !this.held ? room.rollFor(who[0], this.id, mult) : null;
    if (!who || !hit) return [{ t: 'boss-hit', id: this.id, move: 'weighIn', key, hits: [] }];
    if (hit.miss) {
      room.land(who[0], this.id, hit, now);
      return [{ t: 'boss-hit', id: this.id, move: 'weighIn', key, hits: [{ id: who[0], damage: 0, miss: true }] }];
    }
    room.land(who[0], this.id, hit, now, { hold: WEIGH_IN.holdMs });
    const pan = `${PAN_KIND}:${++this.pans}`;
    const max = room.mobInfo(this.id, now)?.maxHp ?? this.stats.hp;
    const events = room.addMobs([{ id: pan, kind: PAN_KIND, zone: GREAT_SCALE_ZONE, tile: who[1], stats: { level: this.stats.level, hp: Math.round(max * WEIGH_IN.panShare), atk: 0, def: this.stats.def, xp: 0 }, name: 'Timbangan Pan', still: true, silent: true, calledBy: PAN_KIND }], now);
    this.held = { player: who[0], pan, until: now + WEIGH_IN.holdMs, nextSqueeze: now + SECOND };
    return [{ t: 'boss-hit', id: this.id, move: 'weighIn', key, hits: [{ id: who[0], damage: hit.damage }] }, ...events, this.change('hold', now)];
  }

  /** The held player let go (the pan broke, its time ran out, its fight ended): able to move again, the pan gone. */
  private release(now: number): MobEvent[] {
    const h = this.held;
    const room = this.room;
    if (!h || !room) return [];
    this.held = null;
    room.land(h.player, this.id, { damage: 0 }, now, { hold: 0 });
    return [...room.removeMobs([h.pan]), this.change('release', now)];
  }

  /** Whether a tile is in its fight (the arena). */
  inArena([c, r]: Tile): boolean {
    const [c0, r0, c1, r1] = this.boss.arena;
    return c >= c0 && c <= c1 && r >= r0 && r <= r1;
  }

  private change(change: GreatScaleChange, now: number): Extract<MobEvent, { t: 'great-scale' }> {
    return { t: 'great-scale', scale: this.state(now), change };
  }

  /** A line in the Palengke's system feed (only there: town.ts). */
  private line(text: string, tone: string): MobEvent {
    return { t: 'system', line: { kind: 'golem', text, tone } };
  }
}
