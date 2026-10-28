import type { SilongFloorData, SilongMapRoom, SilongMiniBoss, SilongRoom, TelegraphShape } from '@mikazuki/shared';
import { inRect } from '@mikazuki/shared';
import type { MobEvent, MobRoom, MobSpec } from './town-mobs.js';
import { inShape } from './town-warrens.js';

// 🧊 Ang Silong's mini bosses' moves (classes/dungeons.json silong.floors[].rooms[].miniBoss.mechanics), one floor's
// worth: the floor's mob room's director (town-silong.ts Floor), on the Scrap Warrens bosses' hooks. A boss's timed moves
// start once someone is in its room (the first half its interval in), one at a time, it holding still as each is cast;
// each is a `boss-move` (its red telegraph and `ms` to its hit, `data` for its effects) whose hit is decided where
// everyone stands as it lands (`boss-hit`); its HP thresholds (its calls, Mono Lisa's Split, Sangkalancelot's hooks)
// come through `hurt`.
// • Delemon: Brine Splash (a circle round her, its hit slows), Lid Spin (a line at a random player, hitting on the way
//   out and back), Jar Call.
// • Sakristan: Rice Rain (circles, two under players; each leaves spilled rice), Belly Flop (a circle on the farthest
//   player: he lands there), Sack Call.
// • Mono Lisa: Chair Barrage (chairs at up to three players, landing on the tiles they stood on), Split (two fakes beside
//   her, all three small and shuffled; only she takes damage, the fakes hit for half and go after its time).
// • Sangkalancelot: his shell (every hit from his front blocked, except just after a Cleaver Charge), Cleaver Charge (a
//   line at the farthest player: he charges down it, stopping at walls), Hook Swing (his Chompers, then hook shadows).
// • Frosty Tubbs: Ambush (under the ice, then up under a circle on a random player), Ice Slick (a cone of floor turned
//   to ice for a while: the page slides you on it), Tub Call (Lurkers out of the tanks).
// • Ang Makinang Yelo (the last boss, B3's Ice Plant; never moves, its fan the map's bossTile; reworked 28 Oct 2026,
//   the owner: dungeons.json lastBoss.reworkNote): Ice Block Drop (red tiles under up to three players, then blocks that
//   stand as walls for 12 s; whoever stood under one is shoved out beside it: `shove`, a `boss-pull`), Cold Vents (in
//   place of the Freezer Breath: every floor tile of the Ice Plant vents, the only safe ground the 8 tiles round each
//   standing ice block, its pockets; none standing: two blocks drop first), Belt Rush (both belts fast for a while, a
//   line down one of them), Frost Sweep (bands of frost rolling from its wall across the room, each landing a moment
//   after the one before: cross a band once it has landed, or outrun it), Icicle Chase (an icicle on where each player
//   stands, then the next on where they stand as it lands, three each: keep walking), Intake (from 90%: its fan
//   reversed draws everyone a tile toward it every half second, a `boss-pull` each, unless an ice block is on the line
//   between them and the fan, then the ice fist slams the floor round the fan), Brine Flood (from 70%: every Ice Plant floor tile but the pallets flooded for 6 s; its Chill
//   is the run's), Call the Frost (Frost Scales out of the tanks' side of the hall at 75%, 50% and 25%), its enrage at
//   25% (every move sooner, five blocks a drop, red eye lamps).
// Pure (the room is its hands), tested in town-silong.test.ts.

type Tile = [number, number];
const key = (t: Tile) => `${t[0]},${t[1]}`;
const hyp = (a: Tile, b: Tile) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

/** A move as dungeons.json has it (its own fields beside the shared ones). */
interface Move {
  id: string;
  every?: number;
  telegraphMs?: number;
  radius?: number;
  width?: number;
  length?: number;
  angleDeg?: number;
  count?: number;
  atkMult?: number;
  atHp?: number | number[];
  ms?: number;
  copies?: number;
  projectiles?: number;
  targets?: string;
  rangeTiles?: number;
  returns?: boolean;
  speedTilesPerSec?: number;
  /** A shell's share off a hit from its front (1: blocked), and how long it's open after a charge. */
  share?: number;
  openMs?: number;
  untargetableMs?: number;
  slow?: { pct: number; ms: number };
  leaves?: { ms: number; slowPct: number };
  calls?: { kind: string; count: number; where: string };
  then?: { every: number; shadows: number; telegraphMs: number; radius: number; atkMult: number };
  fromHp?: number;
  chillStacks?: number;
  beltSpeedTilesPerSec?: number;
  attackSpeed?: number;
  iceBlockDropCount?: number;
  /** Cold Vents: the blocks it drops first when none stand, and how long after they land it vents. */
  dropsFirst?: number;
  ventsAfterDropMs?: number;
  /** Frost Sweep: rows a band, ms between bands. */
  bandRows?: number;
  bandMs?: number;
  /** Icicle Chase: icicles a player. */
  drops?: number;
  /** Intake: how long it pulls, how many pulls, ms between them. */
  pullMs?: number;
  pulls?: number;
  stepMs?: number;
}

interface Boss {
  def: SilongMiniBoss;
  mob: string;
  room: SilongMapRoom;
  data: SilongRoom;
  moves: Move[];
  next: Map<string, number>;
  crossed: Set<string>;
  engaged: boolean;
  /** Its hooks swinging (Sangkalancelot, from his threshold): when the next shadows fall. */
  hooksAt: number | null;
  /** The last boss; enraged (every move sooner, more blocks). */
  last?: boolean;
  enraged?: boolean;
}

interface Pending {
  boss: string;
  at: number;
  /** `players`: where everyone stands as it lands (the tick's copy: a move that shoves or pulls players writes their
   *  new tiles into it, so what lands after it this tick sees them there). */
  land: (now: number, players: Map<string, Tile>) => MobEvent[];
}

/** What a floor's bosses need of it: its mob room, its map's rooms and tiles, a run's numbers (a practice run's 60%). */
export interface BossHost {
  mobs: MobRoom;
  map: { blocked: number[][]; ground?: string[][]; silong: { rooms: SilongMapRoom[]; belts: { e: Tile[]; w: Tile[] }; pallets: Tile[]; bossTile: Tile | null } };
  weaker<T extends { hp: number; atk: number }>(s: T): T;
}

/** How long Mono Lisa's chairs fly before they land (they go on her attack's frame; the telegraph shows where). */
const CHAIR_MS = 900;
/** Lid Spin's lid back to her after it reaches the end of its line. */
const LID_BACK_MS = 600;
/** Sangkalancelot's shell opens this long after each Cleaver Charge (its `shell` rule: 1.2 s). */
const SHELL_OPEN_MS = 1200;
/** An ice block's shove: the slide out beside it (the `boss-pull`'s ms); Intake's pull a tile (its `boss-pull`'s). */
const SHOVE_MS = 250;
const PULL_MS = 400;

export class FloorBosses {
  private readonly bosses = new Map<string, Boss>();
  private pending: Pending[] = [];
  private seq = 0;
  private calls = 0;
  /** A boss casting: nothing else from it until then. */
  private casting = new Map<string, number>();
  /** Ice blocks standing (the last boss's: tile → until when), each a wall on the floor's map till then. */
  readonly iceBlocks = new Map<string, number>();
  /** The Brine Flood: the tiles under it and until when (the run's Chill reads them). */
  flood: { tiles: Set<string>; until: number } | null = null;
  /** Belt Rush: both belts at its speed until then. */
  rush: { until: number; speed: number } | null = null;
  /** Cold Vents' Chill on who it caught (town ids, stacks), until the run takes them. */
  chilled: [string, number][] = [];

  constructor(
    private readonly host: BossHost,
    data: SilongFloorData,
    private readonly random: () => number,
    /** The last boss, on the floor whose map has its room (B3). */
    last: (SilongMiniBoss & { title?: string }) | null = null,
  ) {
    for (const r of data.rooms) {
      const def = r.miniBoss;
      const room = host.map.silong.rooms.find((x) => x.id === r.id);
      if (!def || !room) continue;
      const mob = `boss:${def.id}`;
      const moves = def.mechanics as unknown as Move[];
      this.bosses.set(mob, { def, mob, room, data: r, moves, next: new Map(), crossed: new Set(), engaged: false, hooksAt: null });
    }
    const lastRoom = host.map.silong.rooms.find((x) => x.boss?.last);
    const lastData = lastRoom && data.rooms.find((r) => r.id === lastRoom.id);
    if (last && lastRoom && lastData) {
      const mob = `boss:${last.id}`;
      this.bosses.set(mob, { def: last, mob, room: lastRoom, data: lastData, moves: last.mechanics as unknown as Move[], next: new Map(), crossed: new Set(), engaged: false, hooksAt: null, last: true });
    }
  }

  /** Once its bosses are placed: a shell's front block on (its share off every hit from his front, open just after his
   *  charges). */
  arm(): void {
    for (const b of this.bosses.values()) {
      const shell = b.moves.find((m) => m.id === 'shell');
      if (shell) this.mobs.frontBlock(b.mob, shell.share ?? 1);
    }
  }

  get mobs(): MobRoom {
    return this.host.mobs;
  }

  /** Its fight over (a reset, or it fell): its moves on the way stopped, its thresholds and timers armed again. */
  stop(mob: string): MobEvent[] {
    const b = this.bosses.get(mob);
    if (!b) return [];
    const had = this.pending.some((p) => p.boss === mob);
    this.pending = this.pending.filter((p) => p.boss !== mob);
    Object.assign(b, { engaged: false, hooksAt: null, enraged: false });
    if (b.last) {
      // Its blocks melt away and the flood drains (the page's go with its boss-cancel).
      for (const k of this.iceBlocks.keys()) this.unblock(k);
      this.iceBlocks.clear();
      this.flood = null;
    }
    b.next.clear();
    b.crossed.clear();
    this.casting.delete(mob);
    const events: MobEvent[] = had ? [{ t: 'boss-cancel', id: mob }] : [];
    // (Mono Lisa's fakes and Frosty Tubbs up again.)
    events.push(...this.mobs.removeMobs(this.mobs.calledBy(`split:${mob}`)));
    if (this.mobs.mobInfo(mob, 0) && b.moves.some((m) => m.id === 'ambush')) events.push(...this.mobs.setFlags(mob, { hidden: false }));
    return events;
  }

  // ── The clock ──

  tick(now: number, players: ReadonlyMap<string, Tile>): MobEvent[] {
    const events: MobEvent[] = [];
    const due = this.pending.filter((p) => p.at <= now);
    if (due.length) {
      this.pending = this.pending.filter((p) => p.at > now);
      // (The tick's own copy of where everyone stands: a shove or a pull moves players in it, and what lands after
      // it this tick sees them there; the room's own map follows from the sent `boss-pull`.)
      const live = new Map(players);
      for (const p of due) events.push(...p.land(now, live));
    }
    // Ice blocks whose time is up: gone, their tiles open again.
    for (const [k, until] of this.iceBlocks) {
      if (now < until) continue;
      this.iceBlocks.delete(k);
      this.unblock(k);
    }
    if (this.flood && now >= this.flood.until) this.flood = null;
    for (const b of this.bosses.values()) {
      const info = this.mobs.mobInfo(b.mob, now);
      if (!info || info.dead) continue;
      const near = [...players].filter(([, p]) => inRect(b.room.rect, ...p));
      if (!near.length) continue;
      if (!b.engaged) {
        b.engaged = true;
        for (const m of b.moves) if (m.every) b.next.set(m.id, now + (m.every * 1000) / 2);
      }
      if (now < (this.casting.get(b.mob) ?? 0)) continue;
      // Its hooks (after the threshold), else the first timed move that's due.
      const hooks = b.moves.find((m) => m.id === 'hookSwing');
      if (b.hooksAt !== null && hooks?.then && now >= b.hooksAt) {
        b.hooksAt = now + hooks.then.every * 1000;
        events.push(...this.hookShadows(b, hooks, near, now));
        continue;
      }
      const share = info.hp / info.maxHp;
      const m = b.moves.find((x) => x.every && now >= (b.next.get(x.id) ?? Infinity) && (x.fromHp === undefined || share <= x.fromHp));
      if (!m) continue;
      b.next.set(m.id, now + (m.every! * 1000) / this.speed(b));
      events.push(...this.start(b, m, info.at, info.foe, near, now));
    }
    return events;
  }

  /** Enraged, the last boss's moves come this much faster (its enrage's attackSpeed). */
  private speed(b: Boss): number {
    return b.enraged ? (b.moves.find((m) => m.id === 'enrage')?.attackSpeed ?? 1) : 1;
  }

  /** An ice block's tile open again (it was floor before). */
  private unblock(k: string): void {
    const [c, r] = k.split(',').map(Number);
    if (this.host.map.blocked[r]) this.host.map.blocked[r][c] = 0;
  }

  /** Whether an ice block stands between `from` and `to` (on the straight line between their tiles' middles). */
  private shielded(from: Tile, to: Tile): boolean {
    if (!this.iceBlocks.size) return false;
    const d = hyp(from, to);
    for (let k = 0.5; k < d; k += 0.25) {
      const t: Tile = [Math.round(from[0] + ((to[0] - from[0]) * k) / d), Math.round(from[1] + ((to[1] - from[1]) * k) / d)];
      if (key(t) !== key(to) && this.iceBlocks.has(key(t))) return true;
    }
    return false;
  }

  /** A boss's HP fell: its thresholds (calls, Split, Hook Swing). */
  hurt(id: string, now: number): MobEvent[] {
    const b = this.bosses.get(id);
    const info = b && this.mobs.mobInfo(id, now);
    if (!b || !info || info.dead) return [];
    const share = info.hp / info.maxHp;
    const events: MobEvent[] = [];
    for (const m of b.moves) {
      for (const at of [m.atHp ?? []].flat()) {
        const k = `${m.id}:${at}`;
        if (share > at || b.crossed.has(k)) continue;
        b.crossed.add(k);
        events.push(...this.threshold(b, m, info.at, now));
      }
    }
    return events;
  }

  // ── Moves ──

  private moveEvent(mob: string, move: string, ms: number, shape?: TelegraphShape, data?: Record<string, unknown>): Extract<MobEvent, { t: 'boss-move' }> {
    return { t: 'boss-move', id: mob, move, key: `${mob}:${++this.seq}`, ms, ...(shape ? { shape } : {}), ...(data ? { data } : {}) };
  }

  /** Hits on everyone a test catches as it lands (where they stand then), with a slow (`slowFactor`) on each one hit. */
  private landHits(mob: string, move: string, key2: string, players: ReadonlyMap<string, Tile>, test: (p: Tile) => boolean, mult: number, now: number, extra: { slow?: number; slowFactor?: number } = {}, data?: Record<string, unknown>): MobEvent[] {
    const hits: { id: string; damage: number; miss?: boolean }[] = [];
    for (const [id, p] of players) {
      if (!test(p)) continue;
      const hit = this.mobs.rollFor(id, mob, mult);
      if (!hit) continue;
      this.mobs.land(id, mob, hit, now, extra);
      hits.push({ id, damage: hit.damage, ...(hit.miss ? { miss: true } : {}) });
    }
    return [{ t: 'boss-hit', id: mob, move, key: key2, hits, ...(data ? { data } : {}) }];
  }

  /** Queues a move's hit; the boss holds still till then. */
  private queue(b: Boss, ev: Extract<MobEvent, { t: 'boss-move' }>, land: Pending['land'], at: number, now: number): MobEvent[] {
    this.pending.push({ boss: b.mob, at, land });
    this.casting.set(b.mob, at);
    return [...this.mobs.hold(b.mob, at, now), ev];
  }

  /** The belts' tiles. */
  private beltSet(): Set<string> {
    return new Set([...this.host.map.silong.belts.e, ...this.host.map.silong.belts.w].map(key));
  }

  /** Open floor of a boss's room: not blocked, no belt. */
  private floorOf(b: Boss): Tile[] {
    const [c0, r0, c1, r1] = b.room.rect;
    const belts = this.beltSet();
    const out: Tile[] = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (!this.host.map.blocked[r]?.[c] && !belts.has(key([c, r]))) out.push([c, r]);
    return out;
  }

  /** Every tile of a boss's room that can be stood on now (not blocked: the machine's body and standing ice blocks
   *  are), belts and pallets included. */
  private standable(b: Boss): Tile[] {
    const [c0, r0, c1, r1] = b.room.rect;
    const out: Tile[] = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (!this.host.map.blocked[r]?.[c]) out.push([c, r]);
    return out;
  }

  /** The last boss's fan tile (the map's bossTile): where its cold comes from, what Intake pulls toward. */
  private fanOf(b: Boss, at: Tile): Tile {
    return this.host.map.silong.bossTile ?? b.room.boss?.tile ?? at;
  }

  /** An open tile `ring` steps (Chebyshev) from `p` for a player to be put on: in the room, not blocked (ice blocks
   *  are), no belt, no mob, no player (`live`). Beside `p` (ring 1) the four straight neighbours before the diagonals,
   *  farther from the fan first (shoved away from the machine); farther out the nearest first, then farther from the
   *  fan. */
  private freeTile(b: Boss, p: Tile, fan: Tile, live: ReadonlyMap<string, Tile>, ring: number): Tile | null {
    const taken = new Set([...live.values()].map(key));
    const belts = this.beltSet();
    const cands: Tile[] = [];
    for (let dr = -ring; dr <= ring; dr++) for (let dc = -ring; dc <= ring; dc++) if (Math.max(Math.abs(dc), Math.abs(dr)) === ring) cands.push([p[0] + dc, p[1] + dr]);
    const rank = (t: Tile) => (ring === 1 ? (t[0] === p[0] || t[1] === p[1] ? 0 : 1) : hyp(t, p));
    cands.sort((x, y) => rank(x) - rank(y) || hyp(y, fan) - hyp(x, fan));
    return cands.find((t) => inRect(b.room.rect, ...t) && this.mobs.open(...t) && !belts.has(key(t)) && !this.mobs.occupied(...t) && !taken.has(key(t))) ?? null;
  }

  /** Ice blocks just landed: whoever stood where one did is shoved out beside it (never left standing inside the block;
   *  they took its hit: they were under it): the nearest free tile next to it, else within 2. One `boss-pull` for all of
   *  them, after the drop's hit; `live` moved with them. */
  private shove(b: Boss, blocks: Tile[], live: Map<string, Tile>): MobEvent[] {
    const under = new Set(blocks.map(key));
    const fan = this.fanOf(b, blocks[0] ?? [0, 0]);
    const moved: { id: string; to: Tile }[] = [];
    for (const [id, p] of live) {
      if (!under.has(key(p))) continue;
      const to = this.freeTile(b, p, fan, live, 1) ?? this.freeTile(b, p, fan, live, 2);
      if (!to) continue;
      live.set(id, to);
      moved.push({ id, to });
    }
    return moved.length ? [{ t: 'boss-pull', id: b.mob, players: moved, ms: SHOVE_MS }] : [];
  }

  /** Intake's pull: everyone in the room not within a tile of the fan, with no ice block on the line between them and
   *  it (`shielded`), is drawn one tile toward it: along the greater axis difference first, else the other, into an open
   *  tile no mob or player stands on (else they stay this pull); `live` moved with them. One `boss-pull` for those who
   *  moved. */
  private pull(b: Boss, fan: Tile, live: Map<string, Tile>): MobEvent[] {
    const moved: { id: string; to: Tile }[] = [];
    for (const [id, p] of live) {
      if (!inRect(b.room.rect, ...p) || cheb(p, fan) <= 1 || this.shielded(fan, p)) continue;
      const dc = Math.sign(fan[0] - p[0]);
      const dr = Math.sign(fan[1] - p[1]);
      const byCol: Tile = [p[0] + dc, p[1]];
      const byRow: Tile = [p[0], p[1] + dr];
      const steps = Math.abs(fan[0] - p[0]) >= Math.abs(fan[1] - p[1]) ? [byCol, byRow] : [byRow, byCol];
      const taken = new Set([...live.values()].map(key));
      const to = steps.find((t) => key(t) !== key(p) && this.mobs.open(...t) && !this.mobs.occupied(...t) && !taken.has(key(t)));
      if (!to) continue;
      live.set(id, to);
      moved.push({ id, to });
    }
    return moved.length ? [{ t: 'boss-pull', id: b.mob, players: moved, ms: PULL_MS }] : [];
  }

  /** Ice Block Drop: red tiles under up to `n` players (random floor for the rest), the blocks landing as walls for their
   *  time; whoever stands under one takes its hit and is shoved out beside it. (Cold Vents drops two this way first when
   *  none stand.) */
  private drop(b: Boss, m: Move, near: [string, Tile][], now: number, n: number): MobEvent[] {
    const ms = m.telegraphMs ?? 1200;
    const mult = m.atkMult ?? 1;
    const under = this.draw(near, n).map(([, p]) => p);
    const rest = this.draw(this.floorOf(b), n - under.length, (t, drawn) => [...under, ...drawn].every((x) => hyp(x, t) >= 2));
    const tiles = [...under, ...rest];
    const shape: TelegraphShape = { kind: 'tiles', tiles };
    const blockMs = m.leaves?.ms ?? 12_000;
    const ev = this.moveEvent(b.mob, m.id, ms, shape, { anim: 'drop', blockMs });
    return this.queue(b, ev, (t, players) => {
      // Each block a wall till its time is up.
      for (const [c, r] of tiles) {
        this.iceBlocks.set(key([c, r]), t + blockMs);
        this.host.map.blocked[r][c] = 1;
      }
      return [...this.landHits(b.mob, m.id, ev.key, players, (p) => inShape(shape, p), mult, t, {}, { blocks: tiles, ms: blockMs }), ...this.shove(b, tiles, players)];
    }, now + ms, now);
  }

  /** Up to `n` of `list` at random, each passing `ok` (given those drawn so far). */
  private draw<T>(list: T[], n: number, ok: (t: T, drawn: T[]) => boolean = () => true): T[] {
    const left = [...list];
    const out: T[] = [];
    while (out.length < n && left.length) {
      const [t] = left.splice(Math.floor(this.random() * left.length), 1);
      if (ok(t, out)) out.push(t);
    }
    return out;
  }

  /** The tiles of a straight line from `at` toward `to`, `length` long, stopping at walls (and the room's edge). */
  private line(b: Boss, at: Tile, to: Tile, length: number): Tile[] {
    const dir = Math.atan2(to[1] - at[1], to[0] - at[0]);
    const path: Tile[] = [];
    for (let k = 1; k <= length; k++) {
      const t: Tile = [Math.round(at[0] + Math.cos(dir) * k), Math.round(at[1] + Math.sin(dir) * k)];
      if (!this.mobs.open(...t) || !inRect(b.room.rect, ...t)) break;
      if (!path.length || key(path[path.length - 1]) !== key(t)) path.push(t);
    }
    return path;
  }

  private start(b: Boss, m: Move, at: Tile, foe: string | null, near: [string, Tile][], now: number): MobEvent[] {
    const ms = m.telegraphMs ?? 800;
    const mult = m.atkMult ?? 1;
    const random = <T>(list: T[]) => list[Math.floor(this.random() * list.length)];
    const farthest = () => [...near].sort((x, y) => hyp(y[1], at) - hyp(x[1], at))[0];
    switch (m.id) {
      case 'brineSplash': {
        const shape: TelegraphShape = { kind: 'circle', at, radius: m.radius ?? 2 };
        const slow = m.slow ? { slow: m.slow.ms, slowFactor: 1 - m.slow.pct / 100 } : {};
        const ev = this.moveEvent(b.mob, m.id, ms, shape, { anim: 'attack', ...(m.slow ? { slow: { ms: m.slow.ms, factor: 1 - m.slow.pct / 100 } } : {}) });
        return this.queue(b, ev, (t, players) => this.landHits(b.mob, m.id, ev.key, players, (p) => inShape(shape, p), mult, t, slow), now + ms, now);
      }
      case 'lidSpin': {
        const target = random(near);
        const path = this.line(b, at, target[1], m.length ?? 7);
        const end = path[path.length - 1] ?? at;
        const tiles = new Set(path.map(key));
        const shape: TelegraphShape = { kind: 'line', from: at, to: end, width: m.width ?? 1 };
        const ev = this.moveEvent(b.mob, m.id, ms, shape, { anim: 'attack', path, backMs: LID_BACK_MS });
        // Out (as it lands), and back along the same line.
        this.pending.push({ boss: b.mob, at: now + ms + LID_BACK_MS, land: (t, players) => this.landHits(b.mob, m.id, `${ev.key}:back`, players, (p) => tiles.has(key(p)), mult, t) });
        return this.queue(b, ev, (t, players) => this.landHits(b.mob, m.id, ev.key, players, (p) => tiles.has(key(p)), mult, t), now + ms, now);
      }
      case 'riceRain': {
        const under = this.draw(near, 2).map(([, p]) => p);
        const rest = this.draw(this.floorOf(b), (m.count ?? 5) - under.length, (t, drawn) => [...under, ...drawn].every((x) => hyp(x, t) >= 2));
        const circles = [...under, ...rest].map((t) => ({ at: t, radius: m.radius ?? 1 }));
        const shape: TelegraphShape = { kind: 'circles', circles };
        const ev = this.moveEvent(b.mob, m.id, ms, shape, { anim: 'attack' });
        return this.queue(b, ev, (t, players) => [
          ...this.landHits(b.mob, m.id, ev.key, players, (p) => inShape(shape, p), mult, t),
          // Each leaves spilled rice where it fell.
          ...(m.leaves ? circles.map((c) => this.mobs.spill(c.at, t, t + m.leaves!.ms, 1 - m.leaves!.slowPct / 100, t)) : []),
        ], now + ms, now);
      }
      case 'bellyFlop': {
        const target = farthest();
        const shape: TelegraphShape = { kind: 'circle', at: target[1], radius: m.radius ?? 1.5 };
        const ev = this.moveEvent(b.mob, m.id, ms, shape, { anim: 'attack', from: at, to: target[1] });
        // He lands there.
        return this.queue(b, ev, (t, players) => [...this.mobs.moveMob(b.mob, [target[1]], t, undefined, true), ...this.landHits(b.mob, m.id, ev.key, players, (p) => inShape(shape, p), mult, t)], now + ms, now);
      }
      case 'chairBarrage': {
        const range = m.rangeTiles ?? 7;
        const targets = this.draw(near.filter(([, p]) => hyp(p, at) <= range), 3);
        if (!targets.length) return [];
        const chairs = Array.from({ length: m.projectiles ?? 4 }, (_, k) => targets[k % targets.length][1]);
        const shape: TelegraphShape = { kind: 'circles', circles: chairs.map((t) => ({ at: t, radius: 1 })) };
        const ev = this.moveEvent(b.mob, m.id, CHAIR_MS, shape, { anim: 'attack', from: at, chairs });
        return this.queue(b, ev, (t, players) => this.landHits(b.mob, m.id, ev.key, players, (p) => inShape(shape, p), mult, t), now + CHAIR_MS, now);
      }
      case 'cleaverCharge': {
        const target = farthest();
        const path = this.line(b, at, target[1], m.length ?? 7);
        const end = path[path.length - 1] ?? at;
        const tiles = new Set([key(at), ...path.map(key)]);
        const speed = m.speedTilesPerSec ?? 10;
        const shape: TelegraphShape = { kind: 'line', from: at, to: end, width: m.width ?? 1 };
        const ev = this.moveEvent(b.mob, m.id, ms, shape, { path, speed });
        const shell = b.moves.find((x) => x.id === 'shell');
        const open = (path.length / speed) * 1000 + (shell?.openMs ?? SHELL_OPEN_MS);
        return this.queue(b, ev, (t, players) => {
          // His shell open just after (his back to them, his cleaver stuck).
          this.mobs.frontBlock(b.mob, shell?.share ?? 1, t + open);
          return [...this.mobs.moveMob(b.mob, path, t, speed), ...this.landHits(b.mob, m.id, ev.key, players, (p) => tiles.has(key(p)), mult, t, {}, { openMs: open })];
        }, now + ms, now);
      }
      case 'ambush': {
        // Under the ice now; up under the circle as it lands.
        const target = random(near);
        const shape: TelegraphShape = { kind: 'circle', at: target[1], radius: m.radius ?? 1.5 };
        const ev = this.moveEvent(b.mob, m.id, ms, shape, { from: at, to: target[1] });
        const sink = this.mobs.setFlags(b.mob, { hidden: true });
        return [
          ...sink,
          ...this.queue(b, ev, (t, players) => [
            ...this.mobs.moveMob(b.mob, [target[1]], t, undefined, true),
            ...this.mobs.setFlags(b.mob, { hidden: false }),
            ...this.landHits(b.mob, m.id, ev.key, players, (p) => inShape(shape, p), mult, t),
          ], now + ms, now),
        ];
      }
      case 'iceBlockDrop':
        return this.drop(b, m, near, now, b.enraged ? (b.moves.find((x) => x.id === 'enrage')?.iceBlockDropCount ?? m.count ?? 3) : (m.count ?? 3));
      case 'coldVents': {
        // Nothing to stand beside: two blocks drop first (the drop's own warning and hit; its own timer untouched), and
        // the vents come a moment after they land.
        if (!this.iceBlocks.size) {
          const dropMove = b.moves.find((x) => x.id === 'iceBlockDrop') ?? m;
          b.next.set(m.id, now + (dropMove.telegraphMs ?? 1200) + (m.ventsAfterDropMs ?? 2000));
          return this.drop(b, dropMove, near, now, m.dropsFirst ?? 2);
        }
        // The pockets: the 8 tiles round each ice block standing now (what the warning shows is what's safe, a block
        // that breaks meanwhile too); everything else in the room that can be stood on vents, belts and pallets too.
        const pocket = new Set<string>();
        for (const k of this.iceBlocks.keys()) {
          const [c, r] = k.split(',').map(Number);
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if ((dc || dr) && inRect(b.room.rect, c + dc, r + dr) && !this.host.map.blocked[r + dr]?.[c + dc]) pocket.add(key([c + dc, r + dr]));
        }
        const pockets = [...pocket].map((k) => k.split(',').map(Number) as Tile);
        const tiles = this.standable(b).filter((t) => !pocket.has(key(t)) && !this.iceBlocks.has(key(t)));
        const vented = new Set(tiles.map(key));
        const chill = m.chillStacks ?? 2;
        const shape: TelegraphShape = { kind: 'tiles', tiles };
        const ev = this.moveEvent(b.mob, m.id, ms, shape, { anim: 'breath-charge', chill, pockets });
        return this.queue(b, ev, (t, players) => {
          // (Its Chill on whoever it caught: the run's, as it ticks.)
          for (const [id, p] of players) if (vented.has(key(p))) this.chilled.push([id, chill]);
          return this.landHits(b.mob, m.id, ev.key, players, (p) => vented.has(key(p)), mult, t, {}, { chill, vented: tiles });
        }, now + ms, now);
      }
      case 'frostSweep': {
        // The cold rolls from the machine's wall (the room's first rows) across the room in bands of `bandRows` rows
        // (the last takes what's left), each its own warning landing `bandMs` after the one before; every standable
        // tile of its rows (belts too; ice blocks and the body are out). Ice blocks don't shield it: cross a band once
        // it has landed, or outrun it. It holds until the last band lands.
        const [, r0, , r1] = b.room.rect;
        const rows = Math.max(1, m.bandRows ?? 3);
        const bandMs = m.bandMs ?? 700;
        const n = Math.max(1, Math.floor((r1 - r0 + 1) / rows));
        const floor = this.standable(b).filter((t) => !this.iceBlocks.has(key(t)));
        const bands = Array.from({ length: n }, (_, k) => floor.filter(([, r]) => r >= r0 + k * rows && (k === n - 1 || r < r0 + (k + 1) * rows)));
        const base = `${b.mob}:${++this.seq}`;
        const until = now + ms + (n - 1) * bandMs;
        const events: MobEvent[] = [...this.mobs.hold(b.mob, until, now)];
        this.casting.set(b.mob, until);
        bands.forEach((band, k) => {
          if (!band.length) return;
          const set = new Set(band.map(key));
          const k2 = `${base}:${k}`;
          events.push({ t: 'boss-move', id: b.mob, move: m.id, key: k2, ms: ms + k * bandMs, shape: { kind: 'tiles', tiles: band }, data: { ...(k === 0 ? { anim: 'rush' } : {}), band: k, of: n } });
          this.pending.push({ boss: b.mob, at: now + ms + k * bandMs, land: (t, players) => this.landHits(b.mob, m.id, k2, players, (p) => set.has(key(p)), mult, t, {}, { band: k, of: n }) });
        });
        return events;
      }
      case 'icicleChase': {
        // Icicles that keep falling on where each player stands: a circle on their tile landing `ms` later, then the
        // next on where they stand then, `drops` in all; one who leaves the room isn't followed. It holds for the lot.
        const drops = Math.max(1, m.drops ?? 3);
        const radius = m.radius ?? 1;
        const base = `${b.mob}:${++this.seq}`;
        const until = now + ms * drops;
        const events: MobEvent[] = [...this.mobs.hold(b.mob, until, now)];
        this.casting.set(b.mob, until);
        const icicle = (id: string, on: Tile, k: number, from: number, first: boolean): MobEvent[] => {
          const shape: TelegraphShape = { kind: 'circle', at: on, radius };
          const k2 = `${base}:${id}:${k}`;
          this.pending.push({ boss: b.mob, at: from + ms, land: (t, players) => {
            const out = this.landHits(b.mob, m.id, k2, players, (p) => inShape(shape, p), mult, t, {}, { drop: k, of: drops });
            const p = players.get(id);
            if (k + 1 < drops && p && inRect(b.room.rect, ...p)) out.push(...icicle(id, p, k + 1, t, false));
            return out;
          } });
          return [{ t: 'boss-move', id: b.mob, move: m.id, key: k2, ms, shape, data: { ...(first ? { anim: 'drop' } : {}), drop: k, of: drops, player: id } }];
        };
        near.forEach(([id, p], i) => events.push(...icicle(id, p, 0, now, i === 0)));
        return events;
      }
      case 'intake': {
        // The fan reversed: `pulls` pulls a tile toward it every `stepMs` (each a boss-pull, through `pull`), its red
        // circle round the fan the whole `pullMs`; then the ice fist slams the floor there (the circle's radius).
        const fan = this.fanOf(b, at);
        const pullMs = m.pullMs ?? 2500;
        const pulls = Math.max(1, m.pulls ?? 5);
        const stepMs = m.stepMs ?? Math.round(pullMs / pulls);
        const shape: TelegraphShape = { kind: 'circle', at: fan, radius: m.radius ?? 3 };
        const ev = this.moveEvent(b.mob, m.id, pullMs, shape, { anim: 'call', pulls, stepMs });
        // (The pulls queued before the slam: the last pull and the slam on one tick land in that order.)
        for (let k = 1; k <= pulls; k++) this.pending.push({ boss: b.mob, at: now + k * stepMs, land: (_t, players) => this.pull(b, fan, players) });
        return this.queue(b, ev, (t, players) => this.landHits(b.mob, m.id, ev.key, players, (p) => inShape(shape, p), mult, t, {}, { slam: true }), now + pullMs, now);
      }
      case 'beltRush': {
        const belts = this.host.map.silong.belts;
        const which: 'e' | 'w' = this.random() < 0.5 ? 'e' : 'w';
        const belt = [...belts[which]].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
        if (!belt.length) return [];
        const tiles = new Set(belt.map(key));
        const shape: TelegraphShape = { kind: 'line', from: belt[0], to: belt[belt.length - 1], width: m.width ?? 1 };
        const rushMs = m.ms ?? 4000;
        const ev = this.moveEvent(b.mob, m.id, ms, shape, { anim: 'rush', belt: which, ms: rushMs, speed: m.beltSpeedTilesPerSec ?? 5 });
        return this.queue(b, ev, (t, players) => {
          this.rush = { until: t + rushMs, speed: m.beltSpeedTilesPerSec ?? 5 }; // (both belts fast for its time)
          return this.landHits(b.mob, m.id, ev.key, players, (p) => tiles.has(key(p)), mult, t, {}, { belt: which, ms: rushMs, speed: this.rush.speed });
        }, now + ms, now);
      }
      case 'brineFlood': {
        // Every Ice Plant floor tile but the pallets (2 × 2 each).
        const pallets = new Set(this.host.map.silong.pallets.flatMap(([c, r]) => [key([c, r]), key([c + 1, r]), key([c, r + 1]), key([c + 1, r + 1])]));
        const [c0, r0, c1, r1] = b.room.rect;
        const tiles: Tile[] = [];
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if ((!this.host.map.blocked[r]?.[c] || this.iceBlocks.has(key([c, r]))) && !pallets.has(key([c, r]))) tiles.push([c, r]);
        const floodMs = m.ms ?? 6000;
        const ev = this.moveEvent(b.mob, m.id, ms, undefined, { anim: 'flood', ms: floodMs });
        return this.queue(b, ev, (t) => {
          this.flood = { tiles: new Set(tiles.map(key)), until: t + floodMs };
          return [{ t: 'boss-hit', id: b.mob, move: m.id, key: ev.key, hits: [], data: { flood: tiles, ms: floodMs } }];
        }, now + ms, now);
      }
      case 'iceSlick': {
        const target = near.find(([id]) => id === foe) ?? [...near].sort((x, y) => hyp(x[1], at) - hyp(y[1], at))[0];
        const facing = Math.atan2(target[1][1] - at[1], target[1][0] - at[0]);
        const shape: TelegraphShape = { kind: 'cone', origin: at, facing, angle: m.angleDeg ?? 90, length: m.length ?? 5 };
        const iceMs = m.ms ?? 5000;
        const ev = this.moveEvent(b.mob, m.id, ms, shape, { anim: 'attack' });
        // No damage: its cone of floor turns to ice (the page slides you on it).
        return this.queue(b, ev, () => {
          const tiles = this.floorOf(b).filter((p) => inShape(shape, p) && cheb(p, at) <= (m.length ?? 5) + 1);
          return [{ t: 'boss-hit', id: b.mob, move: m.id, key: ev.key, hits: [], data: { ice: tiles, ms: iceMs } }];
        }, now + ms, now);
      }
    }
    return [];
  }

  /** Sangkalancelot's hooks: shadows on the floor (under players first), each a hook swinging down as it lands. */
  private hookShadows(b: Boss, m: Move, near: [string, Tile][], now: number): MobEvent[] {
    const H = m.then!;
    const under = this.draw(near, H.shadows).map(([, p]) => p);
    const rest = this.draw(this.floorOf(b), H.shadows - under.length, (t, drawn) => [...under, ...drawn].every((x) => hyp(x, t) >= 2));
    const shape: TelegraphShape = { kind: 'circles', circles: [...under, ...rest].map((t) => ({ at: t, radius: H.radius })) };
    const ev = this.moveEvent(b.mob, 'hookShadows', H.telegraphMs, shape);
    this.pending.push({ boss: b.mob, at: now + H.telegraphMs, land: (t, players) => this.landHits(b.mob, 'hookShadows', ev.key, players, (p) => inShape(shape, p), H.atkMult, t) });
    return [ev];
  }

  /** Mobs a boss calls: at its room's edge (or out of the tanks), its room's kind and numbers, after a moment. */
  private call(b: Boss, m: Move, now: number, ms = 600, side?: 'west'): MobEvent[] {
    const n = m.calls?.count ?? 2;
    const floor = this.floorOf(b);
    const set = new Set(floor.map(key));
    const tanks = m.calls?.where.includes('tank') && !side;
    const edge = floor.filter(([c, r]) =>
      side === 'west'
        ? c <= b.room.rect[0] + 3
        : tanks
        ? [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => this.host.map.ground?.[r + dr]?.[c + dc] === 'tank')
        : [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => !set.has(key([c + dc, r + dr]))),
    );
    const spots = this.draw(edge, n, (t, drawn) => !this.mobs.occupied(...t) && drawn.every((x) => hyp(x, t) >= 2));
    const R = b.data.mobs;
    const stats = this.host.weaker({ level: R.level, hp: R.hp, atk: R.atk, def: R.def, xp: R.xp });
    const specs: MobSpec[] = spots.map((t) => ({ id: `called:${b.def.id}:${++this.calls}`, kind: b.room.mob, zone: b.room.id, tile: t, stats, calledBy: b.mob }));
    const ev = this.moveEvent(b.mob, m.id, ms, undefined, { spots, kind: b.room.mob });
    this.pending.push({ boss: b.mob, at: now + ms, land: (t) => this.mobs.addMobs(specs, t) });
    return [ev];
  }

  private threshold(b: Boss, m: Move, at: Tile, now: number): MobEvent[] {
    switch (m.id) {
      case 'jarCall':
      case 'sackCall':
      case 'tubCall':
        return this.call(b, m, now);
      case 'callTheFrost':
        // Frost Scales out of the tanks' side of the hall (its west end), its call anim first.
        return this.call(b, m, now, 600, 'west');
      case 'enrage':
        b.enraged = true;
        for (const [id, t] of b.next) b.next.set(id, now + (t - now) / this.speed(b));
        return [this.moveEvent(b.mob, 'enrage', 0)];
      case 'hookSwing':
        // His Chompers, then the hooks start swinging.
        b.hooksAt = now + (m.then?.every ?? 6) * 1000;
        return this.call(b, m, now);
      case 'split': {
        // Two fakes beside her; all three small and shuffled; only she takes damage; the fakes go after its time.
        const ms = m.ms ?? 6000;
        const room = this.floorOf(b).filter((t) => hyp(t, at) >= 2 && hyp(t, at) <= 5 && !this.mobs.occupied(...t));
        const spots = this.draw(room, (m.copies ?? 3) - 1, (t, drawn) => drawn.every((x) => hyp(x, t) >= 2));
        const all = [at, ...spots];
        const mine = all.splice(Math.floor(this.random() * all.length), 1)[0];
        const info = this.mobs.mobInfo(b.mob, now)!;
        const fakeStats = { level: b.def.level, hp: info.maxHp, atk: Math.max(1, Math.round(this.host.weaker({ hp: 1, atk: b.def.atk }).atk / 2)), def: b.def.def, xp: 0 };
        const fakes = all.map((t, k) => ({ id: `fake:${b.def.id}:${++this.calls}:${k}`, tile: t }));
        const specs: MobSpec[] = fakes.map((f) => ({ id: f.id, kind: b.room.mob, zone: b.room.id, tile: f.tile, stats: fakeStats, boss: 'mini' as const, name: b.def.name, scale: 1.2, calledBy: `split:${b.mob}` }));
        const events: MobEvent[] = [
          ...this.mobs.moveMob(b.mob, [mine], now, undefined, true),
          ...this.mobs.addMobs(specs, now),
          ...fakes.flatMap((f) => this.mobs.setFlags(f.id, { blockAll: true })),
          this.moveEvent(b.mob, 'split', ms, undefined, { real: b.mob, fakes: fakes.map((f) => f.id), scale: 1.2 }),
        ];
        this.pending.push({ boss: b.mob, at: now + ms, land: () => [...this.mobs.removeMobs(fakes.map((f) => f.id)), this.moveEvent(b.mob, 'splitEnd', 0)] });
        return events;
      }
    }
    return [];
  }
}
