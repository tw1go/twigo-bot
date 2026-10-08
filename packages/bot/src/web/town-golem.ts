import { readFileSync } from 'node:fs';
import type { GolemAttack, GolemChange, TownGolem, TownMobFacing, TownServerMessage } from '@mikazuki/shared';

// 🗿 The Scrapheap Golem, the Slums' field boss (the game's maps/slums.json `boss`), run on the server inside the Slums'
// MobRoom so everyone sees the same fight. It rises in the Golem Pit at minute 0 of every `everyMinutes` (120: the even
// hours; counted from the epoch, so UTC and Manila agree), its death anim played backwards (riseMs, not hittable
// meanwhile), with a line `warnMinutes` before and one as it rises; both, and the line when it falls, go only to those in
// the Slums (never kept for arrivals, never to Discord). Nothing is saved: after a restart it waits for the next rise.
// Left alone it idles in the pit, now and then stomping a tile or three inside it or turning a quarter; 30 min without
// a hit (since it rose or was last hit) and it sinks again (never mid-fight).
// Its body is `radius` tiles round its tile: reach to it is measured to that edge (players walk through it). The first
// hit starts a fight: it goes after whoever hit it last while they're within its leash (`leash` tiles of home), else the
// nearest player there, stepping closer within the leash, and attacks every GAP_MS (ENRAGED_GAP_MS enraged): Tire Slam
// with its target within SLAM tiles of its body's edge, Scrap Toss past TOSS, and every GLARE_EVERY-th attack a Lamp
// Glare along its facing (a cone from its tile, CONE tiles past its body's edge and degrees wide: whoever's inside is blinded, shown
// only). It turns a quarter at a time (TURN_MS) and attacks only once it faces its target. Harmless: players have no
// HP yet. At half HP it calls the Junk once (3–4 spots round the pit; its Adds crawl out there when the fx is done: the
// host spawns them as real mobs), at a quarter it enrages once. Nobody within its leash for RESET_MS: it resets (full HP,
// Adds gone, both phases again next fight) and walks home. At 0 it dies: its Adds go, and a line names everyone who hit
// it in that fight. Pure (the clock is passed in), so it's tested on its own and the dev server runs it too.

const SPEED = 1.5; // tiles a second, stomping (the game walks it at this pace: it's in every mob-move)
const IDLE_MS: [number, number] = [5000, 11_000]; // between idle stomps and turns
const TURN_MS = 500; // a quarter turn at most this often in a fight
const GAP_MS = 1500;
const ENRAGED_GAP_MS = 1000;
const FIRST_MS = 800; // from the first hit to its first attack
const SLAM = 2; // Tire Slam: its target within this of its body's edge
const TOSS = 3; // Scrap Toss: past this (between the two it steps closer)
const GLARE_EVERY = 4;
const CONE: [number, number] = [5, 60]; // tiles long (past its body's edge), degrees wide
const BLIND_MS = 3000;
const RESET_MS = 10_000;
const SINK_MS = 30 * 60_000;

/** slums.json `boss`. */
export interface GolemBoss {
  id: string;
  name: string;
  level: number;
  tile: [number, number];
  /** The Golem Pit: [col0, row0, col1, row1]; it idles inside it. */
  arena: [number, number, number, number];
  everyMinutes: number;
  warnMinutes: number;
  leash: number;
}

/** What it takes from its art and rules (manifest mobs.<id>, mobs/mobs.json): HP, body radius, and how long its rise
 *  (the death anim), its attacks and the Call the Junk fx last (ms). */
export interface GolemArt {
  hp: number;
  radius: number;
  riseMs: number;
  attackMs: Record<GolemAttack, number>;
  callMs: number;
}

/** The game's manifest and mobs.json, for the golem `id`. */
export function loadGolemArt(id = 'scrapheap-golem'): GolemArt {
  const read = (file: string) => JSON.parse(readFileSync(new URL(`../../../game/public/assets/${file}`, import.meta.url), 'utf8'));
  type Anim = { frames: number; fps: number };
  const art = read('manifest.json').mobs[id] as { animations: Record<string, Anim>; fx: Record<string, Anim> };
  const rules = read('mobs/mobs.json')[id] as { hp: number; radius: number };
  const ms = (a: Anim) => Math.round((a.frames / a.fps) * 1000);
  const a = art.animations;
  return { hp: rules.hp, radius: rules.radius, riseMs: ms(a.death), attackMs: { slam: ms(a.attack), toss: ms(a.toss), glare: ms(a.glare) }, callMs: ms(art.fx['fx-golem-call-junk']) };
}

/** What the golem sends to the room. */
export type GolemEvent = Extract<TownServerMessage, { t: 'golem' | 'golem-attack' | 'mob-move' | 'mob-face' | 'mob-add' | 'mob-remove' | 'system' }>;

/** What it needs from the room it's in. */
export interface GolemHost {
  /** A tile it (and its Adds) may stand on: on the map, open, on the pit's level, not a ramp. */
  open(col: number, row: number): boolean;
  /** Its Adds crawl out at these spots (real mobs in the room): what to send. */
  callAdds(spots: [number, number][], now: number): GolemEvent[];
  /** The fight is over: its Adds go. */
  dropAdds(): GolemEvent[];
}

/** The next rise after `now`: the next whole `everyMinutes` since the epoch. */
export const nextRiseAfter = (now: number, everyMinutes: number) => {
  const every = everyMinutes * 60_000;
  return (Math.floor(now / every) + 1) * every;
};

/** The line when it falls: everyone who hit it in that fight. */
export function downLine(names: string[], boss = 'Scrapheap Golem'): string {
  const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? 'Someone';
  return `${who} brought down the ${boss}!`;
}

/** Each facing's step on the grid (as town-mobs.ts): SE +col, SW +row, NW −col, NE −row; and in turning order. */
const AXIS: Record<TownMobFacing, [number, number]> = { se: [1, 0], sw: [0, 1], nw: [-1, 0], ne: [0, -1] };
const TURNS: TownMobFacing[] = ['se', 'sw', 'nw', 'ne'];
const STEPS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const cheb = (a: [number, number], b: [number, number]) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

/** The way to face for something `dc, dr` away (as town-mobs.ts facingTo). */
function facingTo(dc: number, dr: number): TownMobFacing | null {
  if (Math.abs(dc) > Math.abs(dr)) return dc > 0 ? 'se' : 'nw';
  if (Math.abs(dr) > Math.abs(dc)) return dr > 0 ? 'sw' : 'ne';
  if (!dc) return null;
  return dc > 0 ? 'se' : dr > 0 ? 'sw' : 'ne';
}

/** A quarter turn from `f` toward `want` (the shorter way; either way round for a half turn). */
function turnToward(f: TownMobFacing, want: TownMobFacing): TownMobFacing {
  const d = (TURNS.indexOf(want) - TURNS.indexOf(f) + 4) % 4;
  return d === 0 ? f : TURNS[(TURNS.indexOf(f) + (d === 3 ? 3 : 1)) % 4];
}

/** Whether `p` is inside the glare's cone from `from` along `f`. */
export function inCone(from: [number, number], f: TownMobFacing, p: [number, number], [length, degrees] = CONE): boolean {
  const [dx, dy] = [p[0] - from[0], p[1] - from[1]];
  const d = Math.hypot(dx, dy);
  if (!d) return true;
  const [ax, ay] = AXIS[f];
  return d <= length && (dx * ax + dy * ay) / d >= Math.cos(((degrees / 2) * Math.PI) / 180) - 1e-9;
}

type Phase = 'gone' | Exclude<TownGolem['state'], 'dead'>;

/** The dev demo's steps (?golemdemo=1): each attack, the Junk at a pretend half, Enrage at a pretend quarter, death. */
const DEMO = ['slam', 'toss', 'glare', 'call', 'slam', 'toss', 'glare', 'enrage', 'slam', 'toss', 'glare', 'death'] as const;

export class Golem {
  readonly id: string;
  private phase: Phase = 'gone';
  private col: number;
  private row: number;
  private facing: TownMobFacing = 'sw';
  private path: [number, number][] = [];
  private hopAt = 0;
  private hp: number;
  private enraged = false;
  private called = false;
  /** Rising or sinking until then. */
  private until = 0;
  private nextRise: number | null = null;
  private warned = 0;
  private risenAt = 0;
  private lastHit = 0;
  /** Whoever hit it last (it goes after them while they're within its leash). */
  private foe: string | null = null;
  /** Everyone who hit it this fight (town id → nickname), in order. */
  private readonly hitters = new Map<string, string>();
  /** Nobody within its leash since then. */
  private alone: number | null = null;
  private nextAttack = 0;
  private busyUntil = 0;
  private attacks = 0;
  private turnAt = 0;
  private restUntil = 0;
  /** The Junk called: its Adds come out then. */
  private adds: { at: number; spots: [number, number][] } | null = null;
  private demoRun: { step: number; at: number; name: string } | null = null;
  private pending: GolemEvent[] = [];

  constructor(
    private readonly boss: GolemBoss,
    private readonly art: GolemArt,
    private readonly host: GolemHost,
    private readonly random: () => number = Math.random,
  ) {
    this.id = boss.id;
    [this.col, this.row] = boss.tile;
    this.hp = art.hp;
  }

  get radius(): number {
    return this.art.radius;
  }

  /** Up and hittable (not rising, sinking or gone). */
  get hittable(): boolean {
    return this.phase === 'idle' || this.phase === 'fight' || this.phase === 'home';
  }

  /** What to send that happened outside a tick (a hit that called the Junk, enraged it or brought it down). */
  flush(): GolemEvent[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  /** Moves its clock on: the schedule (warning, rise), a hop that's over lands, rising/sinking end, idle stomps and turns,
   *  the sink, the fight. `players`: where each player in the room is. */
  tick(now: number, players: ReadonlyMap<string, [number, number]>): GolemEvent[] {
    this.schedule(now);
    if (this.adds && now >= this.adds.at) {
      this.pending.push(...this.host.callAdds(this.adds.spots, now));
      this.adds = null;
    }
    if (this.phase === 'gone') return this.flush();
    if (this.path.length && now >= this.hopAt + (this.path.length / SPEED) * 1000) {
      const [a, b] = [this.path.length > 1 ? this.path[this.path.length - 2] : [this.col, this.row], this.path[this.path.length - 1]];
      this.facing = facingTo(b[0] - a[0], b[1] - a[1]) ?? this.facing;
      [this.col, this.row] = b;
      this.path = [];
    }
    switch (this.phase) {
      case 'rising':
        if (now >= this.until) {
          this.phase = 'idle';
          this.restUntil = now + this.rest();
        }
        break;
      case 'sinking':
        if (now >= this.until) this.phase = 'gone';
        break;
      case 'idle':
        if (now - Math.max(this.risenAt, this.lastHit) >= SINK_MS) this.sink(now);
        else if (this.demoRun) this.demoTick(now, players);
        else if (!this.path.length && now >= this.restUntil) this.idle(now);
        break;
      case 'home':
        if (this.path.length) break;
        if (this.col === this.boss.tile[0] && this.row === this.boss.tile[1]) {
          this.phase = 'idle';
          this.restUntil = now + this.rest();
        } else this.goHome(now);
        break;
      case 'fight':
        if (this.demoRun) this.demoTick(now, players);
        else this.fight(now, players);
        break;
    }
    return this.flush();
  }

  /** The warning `warnMinutes` before a rise (if it isn't up), and the rise (if it isn't up still). */
  private schedule(now: number): void {
    const { everyMinutes, warnMinutes } = this.boss;
    this.nextRise ??= nextRiseAfter(now, everyMinutes);
    if (now >= this.nextRise - warnMinutes * 60_000 && this.warned !== this.nextRise) {
      this.warned = this.nextRise;
      if (this.phase === 'gone') this.line('The junk in the golem pit is stirring...', 'stir');
    }
    if (now >= this.nextRise) {
      if (this.phase === 'gone') this.rise(now);
      this.nextRise = nextRiseAfter(now, everyMinutes);
    }
  }

  /** It rises at home, whole: its death anim backwards for riseMs. */
  private rise(now: number): void {
    [this.col, this.row] = this.boss.tile;
    Object.assign(this, { facing: 'sw', path: [], hp: this.art.hp, enraged: false, called: false, foe: null, alone: null, adds: null, attacks: 0, lastHit: 0 });
    this.hitters.clear();
    this.phase = 'rising';
    this.risenAt = now;
    this.until = now + this.art.riseMs;
    this.change('rise', now);
    this.line(`The ${this.boss.name} has risen in the junkyard!`, 'rise');
  }

  /** Back into the pit (its death anim forwards, then gone). */
  private sink(now: number): void {
    this.phase = 'sinking';
    this.until = now + this.art.riseMs;
    this.demoRun = null;
    this.change('sink', now);
  }

  private rest = () => IDLE_MS[0] + this.random() * (IDLE_MS[1] - IDLE_MS[0]);

  /** Left alone: a quarter turn, or a stomp of 1–3 tiles ahead or to a side, inside the pit. */
  private idle(now: number): void {
    this.restUntil = now + this.rest();
    const i = TURNS.indexOf(this.facing);
    const ways = [this.facing, TURNS[(i + 1) % 4], TURNS[(i + 3) % 4]];
    if (this.random() >= 0.35) {
      const way = ways[Math.floor(this.random() * 3)];
      const [dc, dr] = AXIS[way];
      const n = 1 + Math.floor(this.random() * 3);
      const path: [number, number][] = [];
      for (let k = 1; k <= n; k++) {
        const t: [number, number] = [this.col + dc * k, this.row + dr * k];
        if (!this.inPit(t) || !this.host.open(...t)) break;
        path.push(t);
      }
      if (path.length) return this.hop(path, now);
    }
    this.turn(ways[1 + Math.floor(this.random() * 2)]);
  }

  private inPit([col, row]: [number, number]): boolean {
    const [c0, r0, c1, r1] = this.boss.arena;
    return col >= c0 && col <= c1 && row >= r0 && row <= r1;
  }

  private turn(f: TownMobFacing): void {
    if (f === this.facing) return;
    this.facing = f;
    this.pending.push({ t: 'mob-face', id: this.id, dir: f });
  }

  private hop(path: [number, number][], now: number): void {
    this.path = path;
    this.hopAt = now;
    this.pending.push({ t: 'mob-move', id: this.id, path: [[this.col, this.row], ...path], speed: SPEED });
  }

  /** Stops where it has got to (a hop cut short: the game jumps it there). */
  private halt(now: number): void {
    if (!this.path.length) return;
    [this.col, this.row] = this.at(now);
    this.path = [];
    this.pending.push({ t: 'mob-move', id: this.id, path: [[this.col, this.row]], speed: SPEED });
  }

  /** Where it is now: its tile, or how far it has got along a hop. */
  at(now: number): [number, number] {
    if (!this.path.length) return [this.col, this.row];
    const done = Math.floor(((now - this.hopAt) / 1000) * SPEED);
    return done > 0 ? this.path[Math.min(done, this.path.length) - 1] : [this.col, this.row];
  }

  /** Tiles from `p` to its body's edge (0 inside it). */
  edge(p: [number, number], now: number): number {
    const [c, r] = this.at(now);
    return Math.max(0, Math.hypot(p[0] - c, p[1] - r) - this.art.radius);
  }

  /** The shortest way (8 directions, no cut corners) over open tiles within its leash to the nearest tile `goal` likes. */
  private route(goal: (c: number, r: number) => boolean): [number, number][] | null {
    const home = this.boss.tile;
    const ok = (c: number, r: number) => cheb([c, r], home) <= this.boss.leash && this.host.open(c, r);
    const key = (c: number, r: number) => c * 4096 + r;
    const came = new Map<number, number>([[key(this.col, this.row), -1]]);
    const queue: [number, number][] = [[this.col, this.row]];
    for (let i = 0; i < queue.length; i++) {
      const [c, r] = queue[i];
      if (goal(c, r)) {
        const path: [number, number][] = [];
        for (let k = key(c, r); k !== -1; k = came.get(k)!) path.push([Math.floor(k / 4096), k % 4096]);
        return path.reverse().slice(1);
      }
      for (const [dc, dr] of STEPS) {
        const [nc, nr] = [c + dc, r + dr];
        if (came.has(key(nc, nr)) || !ok(nc, nr) || (dc && dr && (!ok(c + dc, r) || !ok(c, r + dr)))) continue;
        came.set(key(nc, nr), key(c, r));
        queue.push([nc, nr]);
      }
    }
    return null;
  }

  private goHome(now: number): void {
    const [hc, hr] = this.boss.tile;
    const way = this.route((c, r) => c === hc && r === hr);
    if (way?.length) this.hop(way, now);
    else {
      this.phase = 'idle'; // nowhere to go: it stays put
      this.restUntil = now + this.rest();
    }
  }

  /** In a fight: its target (whoever hit it last, within its leash; else the nearest there), closer, turned, an attack. */
  private fight(now: number, players: ReadonlyMap<string, [number, number]>): void {
    const home = this.boss.tile;
    const near = [...players].filter(([, p]) => cheb(p, home) <= this.boss.leash);
    if (!near.length) {
      this.alone ??= now;
      if (now - this.alone >= RESET_MS) this.reset(now);
      return;
    }
    this.alone = null;
    if (this.path.length || now < this.busyUntil) return;
    const target = near.find(([id]) => id === this.foe) ?? near.reduce((a, b) => (this.edge(b[1], now) < this.edge(a[1], now) ? b : a));
    const [id, p] = target;
    const d = this.edge(p, now);
    const glare = this.attacks % GLARE_EVERY === GLARE_EVERY - 1;
    // Too far to slam: a step closer (while it's still too soon to attack, or too close to toss).
    if (!glare && d > SLAM && (d <= TOSS || now < this.nextAttack)) {
      const way = this.route((c, r) => Math.hypot(p[0] - c, p[1] - r) - this.art.radius <= SLAM);
      if (way?.length) return this.hop(way.slice(0, 1), now);
    }
    if (now < this.nextAttack) return;
    const want = facingTo(p[0] - this.col, p[1] - this.row) ?? this.facing;
    if (want !== this.facing) {
      if (now >= this.turnAt) {
        this.turn(turnToward(this.facing, want));
        this.turnAt = now + TURN_MS;
      }
      return;
    }
    this.strike(glare ? 'glare' : d <= SLAM ? 'slam' : 'toss', id, p, now, players);
  }

  /** An attack at `target` (at `p`), turned its way already. */
  private strike(attack: GolemAttack, target: string, p: [number, number], now: number, players: ReadonlyMap<string, [number, number]>): void {
    this.attacks++;
    this.busyUntil = now + this.art.attackMs[attack];
    this.nextAttack = now + (this.enraged ? ENRAGED_GAP_MS : GAP_MS);
    const from: [number, number] = [this.col, this.row];
    // The glare's cone from its tile, CONE[0] tiles past its body's edge (a big body would hide a short one).
    const cone: [number, number] = [this.art.radius + CONE[0], CONE[1]];
    let at: [number, number];
    if (attack === 'toss') at = [p[0], p[1]];
    else {
      // The slam's fist lands a tile past its body toward the target (or on them, nearer); the glare's cone ends CONE ahead.
      const [ax, ay] = AXIS[this.facing];
      const [dx, dy] = [p[0] - from[0], p[1] - from[1]];
      const d = Math.hypot(dx, dy);
      const reach = attack === 'slam' ? Math.min(d, this.art.radius + 1) : cone[0];
      const [ux, uy] = attack === 'slam' && d ? [dx / d, dy / d] : [ax, ay];
      at = [Math.round(from[0] + ux * reach), Math.round(from[1] + uy * reach)];
    }
    const blinded = attack === 'glare' ? [...players].filter(([, q]) => inCone(from, this.facing, q, cone)).map(([id]) => id) : [];
    this.pending.push({
      t: 'golem-attack', id: this.id, attack, dir: this.facing, target, at, enraged: this.enraged,
      ...(attack === 'glare' ? { blinded, blindMs: BLIND_MS, cone } : {}),
    });
  }

  /** Nobody stayed: full HP, Adds gone, both phases ready again, and home. */
  private reset(now: number): void {
    Object.assign(this, { hp: this.art.hp, enraged: false, called: false, adds: null, foe: null, alone: null, attacks: 0 });
    this.hitters.clear();
    this.phase = 'home';
    this.pending.push(...this.host.dropAdds());
    this.change('reset', now);
    this.goHome(now);
  }

  /** A player's hit for `damage` (town id and nickname, for the line when it falls). Null when it can't be hit. */
  hit(player: string, name: string, damage: number, now: number): { hp: number; dead: boolean } | null {
    if (!this.hittable) return null;
    const starts = this.phase !== 'fight';
    if (starts) {
      this.halt(now);
      this.phase = 'fight';
      Object.assign(this, { alone: null, attacks: 0, nextAttack: Math.max(this.nextAttack, now + FIRST_MS) });
    }
    this.foe = player;
    this.hitters.set(player, name);
    this.lastHit = now;
    this.hp = Math.max(0, this.hp - damage);
    if (starts) this.change('fight', now);
    if (this.hp && !this.called && this.hp <= this.art.hp / 2) this.callJunk(now);
    if (this.hp && !this.enraged && this.hp <= this.art.hp / 4) this.enrage(now);
    if (!this.hp) this.die(now);
    return { hp: this.hp, dead: !this.hp };
  }

  /** Half HP: 3–4 spots round the pit; its Adds crawl out there once the fx is done. */
  private callJunk(now: number): void {
    this.called = true;
    const spots = this.spots();
    this.adds = { at: now + this.art.callMs, spots };
    this.change('call', now, { spots, ms: this.art.callMs });
  }

  /** 3–4 open tiles a tile or two outside the pit, apart from each other (round home if there are none). */
  private spots(): [number, number][] {
    const [c0, r0, c1, r1] = this.boss.arena;
    const ring: [number, number][] = [];
    for (let r = r0 - 2; r <= r1 + 2; r++)
      for (let c = c0 - 2; c <= c1 + 2; c++)
        if (!this.inPit([c, r]) && cheb([c, r], this.boss.tile) <= this.boss.leash && this.host.open(c, r)) ring.push([c, r]);
    const want = 3 + (this.random() < 0.5 ? 1 : 0);
    const out: [number, number][] = [];
    const pool = [...ring];
    while (out.length < want && pool.length) {
      const [t] = pool.splice(Math.floor(this.random() * pool.length), 1);
      if (out.every((o) => cheb(o, t) >= 3)) out.push(t);
    }
    if (!out.length) out.push(this.boss.tile);
    return out;
  }

  /** A quarter HP: red lamp, faster attacks, rubble after slams. */
  private enrage(now: number): void {
    this.enraged = true;
    this.change('enrage', now);
  }

  /** At 0: its Adds go, and a line names everyone who hit it this fight. */
  private die(now: number): void {
    this.halt(now);
    this.change('death', now);
    this.phase = 'gone';
    this.adds = null;
    this.demoRun = null;
    this.pending.push(...this.host.dropAdds());
    this.line(downLine([...this.hitters.values()], this.boss.name), 'down');
    this.hitters.clear();
  }

  /** A player left the room: it stops going after them. */
  forget(player: string): void {
    if (this.foe === player) this.foe = null;
  }

  private change(change: GolemChange, now: number, extra: { spots?: [number, number][]; ms?: number } = {}): void {
    this.pending.push({ t: 'golem', change, golem: this.state(now, change === 'death')!, ...extra });
  }

  /** A line in the Slums' system feed (only there: see town.ts). */
  private line(text: string, tone: string): void {
    this.pending.push({ t: 'system', line: { kind: 'golem', text, tone } });
  }

  /** As the room should see it now (null: not up). */
  state(now: number, dead = false): TownGolem | null {
    if (this.phase === 'gone' && !dead) return null;
    const done = Math.floor(((now - this.hopAt) / 1000) * SPEED);
    const left = this.path.length ? this.path.slice(Math.min(done, this.path.length - 1)) : [];
    const [col, row] = this.at(now);
    const state = dead ? 'dead' : this.phase === 'gone' ? 'idle' : this.phase;
    return {
      id: this.id, col, row, dir: this.facing, level: this.boss.level, hp: this.hp, maxHp: this.art.hp, state, enraged: this.enraged,
      home: this.boss.tile, leash: this.boss.leash, radius: this.art.radius,
      ...(state === 'rising' || state === 'sinking' ? { left: Math.max(0, this.until - now) } : {}),
      ...(left.length ? { path: left, speed: SPEED } : {}),
    };
  }

  /** Dev: it rises now (if it isn't up). */
  riseNow(now: number): boolean {
    if (this.phase !== 'gone') return false;
    this.rise(now);
    return true;
  }

  /** Dev (?golemdemo=1): it rises if it must, then plays its fight against the nearest player in the room: each attack,
   *  the Junk at a pretend half, Enrage at a pretend quarter, then death (the line names `name` if nobody hit it). */
  demo(now: number, name: string): void {
    if (this.demoRun) return;
    this.riseNow(now);
    this.demoRun = { step: 0, at: (this.phase === 'rising' ? this.until : now) + 800, name };
  }

  private demoTick(now: number, players: ReadonlyMap<string, [number, number]>): void {
    const run = this.demoRun!;
    if (now < run.at || this.path.length || !players.size) return;
    const [id, p] = [...players].reduce((a, b) => (this.edge(b[1], now) < this.edge(a[1], now) ? b : a));
    if (this.phase !== 'fight') {
      this.phase = 'fight';
      this.change('fight', now);
    }
    const step = DEMO[run.step++];
    if (step === 'call' || step === 'enrage') {
      this.hp = Math.floor(this.art.hp / (step === 'call' ? 2 : 4));
      if (step === 'call') this.callJunk(now);
      else this.enrage(now);
      run.at = now + (step === 'call' ? this.art.callMs + 2500 : 2000);
      return;
    }
    if (step === 'death') {
      if (!this.hitters.size) this.hitters.set('demo', run.name);
      this.hp = 0;
      return this.die(now);
    }
    this.turn(facingTo(p[0] - this.col, p[1] - this.row) ?? this.facing);
    this.strike(step, id, p, now, players);
    run.at = now + this.art.attackMs[step] + 900;
  }
}
