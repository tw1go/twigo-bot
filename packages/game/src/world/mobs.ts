import Phaser from 'phaser';
import { type LevelingData, type PlayerHit, type StatsData, type TownMob, type TownMobFacing, miniBossDef, miniBossRules, miniMobId, miniOfMobId, mobBarMs, mobRules, mobStartSpots, mobStats, mobTone, packSize, seeded } from '@mikazuki/shared';
import { playSet } from '../audio/sound';
import type { Manifest, MobData, MobDef, MobZone, TownMap, Vec2 } from '../assets/types';
import { mobCell, mobSheet, mobVariants } from '../assets/mob-art';
import { slice } from '../assets/packs';
import { CHARACTER_BIAS, HEIGHT_DEPTH } from './depth';
import type { FxLayers, Pt } from './fx-layers';
import type { Tile, WalkGrid } from './grid';
import { type WorldObjects, characterDepth } from './objects';
import { BuildingLabel } from '../ui/labels';
import { LABEL_DEPTH } from './depth';

// Mini bosses (classes/leveling.json; each zone's `miniBosses` spots in the map): their mob's art at miniBoss.scale (its
// kind's mobs.json numbers scaled with it: shadow, top, eye), one fixed look by id, "Jus Tin Lv 4" always over it in
// miniBoss.nameColour and its HP bar always shown; ids `<zone>:mini:<id>`.
//
// 🥫 The Slums' mobs (map.mobZones; art in manifest mobs, rules in mobs/mobs.json, how they live in classes/stats.json
// mobBehaviour). For each zone that's on (`active`), its `aliveperZone` mobs (ids `<zone>:<k>`) at the spread-out spawn
// points the server starts them on (mobStartSpots), or a pack round each for a kind with `pack` (the Bottle Caps: a
// seeded 3–5, ids `<zone>:<k>:<n>`, the first alive leading); any other the server has is made as it says. Each in one of
// its kind's variants (the server's pick, `variant`; the same seeded pick here until it answers), idling and now and
// then hopping a few tiles (`wanderTiles`) round its spawn,
// on a ground shadow sized per kind (a floating one, the Plastic Bag Spook, keeps it on the ground under its anchor, and
// drifts: its drawn place eases after the real one, so it glides round corners and never stops dead). The server runs
// them (bot web/town-mobs.ts: everyone sees the same mobs): its `mobs` snapshot places them (and their facing and HP) and
// each `mob-move` hop is walked here at its pace. Only with no server (nothing heard yet) do they wander on their own
// here (the move animation; at most 3 tiles away, a pack's followers near their leader, never off its zone's level or out
// of its rect, onto a blocked tile or a ramp, or into the safe zone), facing the way it goes on the art's four diagonals
// (SE for S and E, SW for W, NE for N; no mirroring). A click shows its name and its kind's one level ("Tin Can Lv 1",
// grey 5+ levels below you, red 3+ above, else white: the stats rules' mobTone) and targets it; Z targets the nearest
// (again: the next nearest): a ring under it and the info bar at the top (ui/mob-target.ts). Its level and HP are its
// kind's (classes/stats.json's mob table; the server's snapshot says the same).
// Battle (the server decides: bot web/town-mobs.ts): a hit plays the mob's hit pose and a damage number rises over it
// (gold for a crit; "Blocked" off a Scrap Crab's shell; "Miss" when it missed, the level gap's chance); at 0 HP its death
// pose, then it fades out and is gone until it respawns somewhere free in its zone (fading in). A small HP bar shows
// over it while it's your target and for `hpBar.hideAfterSeconds` after each hit (mobBarMs); a mob that gives up its fight
// heals to full (`mob-heal`). Its sounds (audio/sound.ts, within hearing of you): a hurt one per mob at most every
// HURT_SOUND_MS (area skills hit many at once), its death; by kind (combat-mob-hurt-<kind>, combat-mob-death-<kind>).
// Its own attacks (`strike`) turn it the server's way and play its attack pose; on the table's attack frame (mobs.json
// attackFrame) `onAttackFrame`, then `onHit` as it lands on the player (at once, or for the Wire Tangle when its spark gets there:
// drawn in code from its insulator eye, mobs.json `eye`, on the front fx layer); the Tire Roller's sprite lunges out
// along its facing over its charge frames and back (its tile stays). `onDeath` as one dies. The server rolled the hit
// (`hit`: damage or a miss) and takes the HP as it lands: the hooks show it then (TownScene: the number, the flash). Only the mobs near the camera are drawn and animated; the rest sleep (their
// sprites off, still walking their hops on paper) and wake right where they should be.
// The field boss (world/golem.ts runs it) is one of these too, made with `makeBoss` once its art is in: its own sheets
// or its red-lamp set (`enraged`), its rise (its death backwards), a body `radius` (reach and Z measure to its edge;
// a hit never cuts its attacks short), numbers and a wider bar at its art's `top`. Its Adds come and go with `add` /
// `remove` (their `kind`, in a zone of their own). Shadows are the shadow art's look drawn at each kind's size.

const FOLLOW = 2; // a pack's followers keep within this of their leader
const SPEED = 2.4; // tiles per second
const REST_MS: [number, number] = [2200, 6500];
const LABEL_MS = 2600;
const TARGET_RANGE = 12; // tiles: Z picks among the mobs this close
const TARGET_LOSE = 20; // tiles: a target this far away is let go
const WAKE_MARGIN = 160; // world px round the camera's view where mobs are awake
const DRIFT_MS = 220; // a drifter's drawn place eases after its real one over about this long
const LUNGE = 0.8; // tiles: the Tire Roller's charge, out and back
const SPARK_SPEED = 260; // px a second
const BODY_UP = 12; // a player's body above their feet (where a spark lands)
const DEATH_FADE_MS = 350;
/** A Scrap Crab's shell is down this long from each of its attacks if mobs.json doesn't say (as the server), and it shows its
 *  shield this long after its last hit or swing. */
const SHELL_OPEN_MS = 2000;
const FIGHT_MS = 8000;
/** A mob's hurt sound at most this often (an area skill's many hits stay one). */
const HURT_SOUND_MS = 150;

/** A burn's tick on a mob (Boiling Splash's puddle): its number in orange. */
const BURN_COLOUR = '#FB923C';

/** A mob's name colours by level gap (Mobs.tone). */
export const TONE = { grey: '#9CA3AF', white: '#FFFFFF', red: '#F87171' } as const;

/** Where the field boss lives (and its Adds' zone, in the info bar). */
export const GOLEM_PIT = 'Golem Pit';

/** The four ways the art faces, for a step in screen directions (SE for S and E, SW for W, NE for N). */
const FACING: Record<string, TownMobFacing> = { n: 'ne', ne: 'ne', e: 'se', se: 'se', s: 'se', sw: 'sw', w: 'sw', nw: 'nw' };
/** Each facing's step on the grid (SE = +col, SW = +row, NW = −col, NE = −row), as the bot's. */
const AXIS: Record<TownMobFacing, [number, number]> = { se: [1, 0], sw: [0, 1], nw: [-1, 0], ne: [0, -1] };
const STEPS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export interface Mob {
  id: string;
  zone: MobZone;
  def: MobDef;
  /** Its look ('' for a kind with one) and that look's cell and anchor. */
  variant: string;
  cell: { size: Vec2; anchor: Vec2 };
  /** Its kind's rules (mobs/mobs.json: attack frame, shadow, floating), if loaded. */
  data: MobData | null;
  level: number;
  maxHp: number;
  spawn: Tile;
  /** Where it starts and comes back (a pack's caps round the spawn point). */
  home: Tile;
  /** Its pack (the first alive leads), or null. */
  pack: Mob[] | null;
  col: number;
  row: number;
  /** Where it's drawn (a drifter's eases after col/row; the rest are the same). */
  drawCol: number;
  drawRow: number;
  dir: TownMobFacing;
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image | null;
  path: Tile[];
  restUntil: number;
  label: BuildingLabel | null;
  labelUntil: number;
  hp: number;
  dead: boolean;
  /** A one-shot pose (hit, attack, death) playing: idle / move wait; `t` = how far in (ms of its own time), `onFrame`
   *  per frame (0-based), `then` when it's over. */
  pose: { key: string; anim: string; t: number; onFrame?: (f: number) => void; then?: () => void } | null;
  bar: Phaser.GameObjects.Graphics | null;
  /** A Scrap Crab's shell: up (blocking: a shield over it while it's fighting or your target) or down until `openUntil`
   *  (scene ms) after each of its attacks; `fightUntil` (scene ms) while it's been fighting lately. */
  shield: Phaser.GameObjects.Graphics | null;
  openUntil: number;
  fightUntil: number;
  /** The pace of its hop (tiles a second; slower while slowed). */
  speed: number;
  /** Slowed or rooted until then (scene ms), shown with a cold tint. */
  slowUntil: number;
  /** Off screen: sprites off, not animated (its hops still walked on paper). */
  asleep: boolean;
  /** The sprite's offset from its tile (px): the Tire Roller's lunge. */
  lunge: Pt;
  /** The golem's red-lamp sheets (its `enraged` set) instead of its own. */
  enraged: boolean;
  /** One of the golem's Adds (no spawn point; gone when its fight ends). */
  add: boolean;
  /** A mini boss: its name and its name's colour (always shown, with its HP bar). */
  mini: { name: string; colour: string } | null;
  /** Its body's radius in tiles (the golem's; 0 for the rest): reach to it is measured to that edge. */
  radius: number;
  /** Up but not to be hit or targeted (the golem rising or sinking). */
  untouchable: boolean;
  /** Its last hit (scene ms: its HP bar shows for a while after) and its last hurt sound. */
  hitAt: number;
  hurtAt: number;
}

/** What the scene does with a mob's attack (these show it; the server takes the HP). */
export interface MobHooks {
  /** Its attack anim reaches the frame where it lands (mobs.json attackFrame); the Wire Tangle's spark leaves here. */
  onAttackFrame?: (m: Mob, target: string) => void;
  /** Its attack reaches the player (melee: on that frame; the spark: when it gets there; the golem's slam or toss: each
   *  player it caught); `slow`: ms (the Bag's); `hit`: the server's roll (damage or a miss). */
  onHit?: (m: Mob, target: string, slow?: number, hit?: PlayerHit) => void;
  /** It dies (its death pose starts). */
  onDeath?: (m: Mob) => void;
}

export class Mobs {
  readonly list: Mob[] = [];
  private zoom = 2;
  private target: Mob | null = null;
  private ring: Phaser.GameObjects.Graphics | null = null;
  /** The targeted mob changed (null: none): the scene shows the info bar. */
  onTarget: ((m: Mob | null) => void) | null = null;
  hooks: MobHooks = {};
  /** Where a player's feet are (town id; null: not here), for a spark to fly to. */
  playerAt: ((id: string) => Pt | null) | null = null;
  /** Your level (a mob's name colour is by the gap). */
  myLevel: () => number = () => 1;
  /** The stats rules' numbers (classes/stats.json), if loaded. */
  private readonly stats: StatsData | null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly M: Manifest,
    private readonly map: TownMap,
    private readonly grid: WalkGrid,
    private readonly objects: WorldObjects,
    private readonly onSpawn: (o: Phaser.GameObjects.Components.Tint) => void,
    private readonly fx: FxLayers,
  ) {
    const data = (scene.cache.json.get('mob-data') ?? {}) as Record<string, MobData | string>;
    this.stats = (scene.cache.json.get('stats') as StatsData | undefined) ?? null;
    this.roam = this.stats?.mobBehaviour.wanderTiles ?? 3;
    this.barMs = this.stats ? mobBarMs(this.stats) : 5000;
    for (const zone of map.mobZones ?? []) {
      const def = zone.active ? M.mobs?.[zone.mob] : undefined;
      if (!def || typeof def === 'string') continue;
      this.anims(zone.mob, def);
      const d = typeof data[zone.mob] === 'object' ? (data[zone.mob] as MobData) : null;
      // Where the server starts them (its first snapshot puts them where they are now).
      const alive = this.stats ? mobRules(this.stats, zone.mob).alive : zone.spawns.length;
      mobStartSpots(zone.id, zone.spawns, alive).forEach((i, k) => {
        const [col, row] = zone.spawns[i];
        const point = `${zone.id}:${k}`;
        const n = d?.pack ? packSize(point, d.pack) : 1;
        const pack: Mob[] = [];
        for (let c = 0; c < n; c++) this.place(zone, def, d, { col, row }, d?.pack ? `${point}:${c}` : point, d?.pack ? pack : null);
      });
      for (const spot of zone.miniBosses ?? []) this.placeMini(zone, miniMobId(zone.id, spot.id), { col: spot.tile[0], row: spot.tile[1] });
    }
  }

  /** classes/leveling.json (the mini bosses), if loaded. */
  private get leveling(): LevelingData | null {
    return (this.scene.cache.json.get('leveling') as LevelingData | undefined) ?? null;
  }

  /** A mini boss (`<zone>:mini:<id>`) at its spot: its mob's art and numbers at miniBoss.scale, its own level and HP,
   *  its name always over it. Null without its data. */
  private placeMini(zone: MobZone, id: string, at: Tile): Mob | null {
    const L = this.leveling;
    const mini = L ? miniBossDef(L, miniOfMobId(id) ?? '') : null;
    const def = this.M.mobs?.[zone.mob];
    if (!L || !mini || mini.kind !== zone.mob || !def || typeof def === 'string') return null;
    const raw = (this.scene.cache.json.get('mob-data') ?? {})[zone.mob];
    const k = miniBossRules(L).scale;
    const base = typeof raw === 'object' ? (raw as MobData) : null;
    const data = { ...(base ?? {}), scale: (base?.scale ?? 1) * k, pack: undefined } as MobData;
    const m = this.place(zone, def, data, at, id, null);
    if (!base?.shadow) m.shadow?.setScale(k);
    Object.assign(m, { level: mini.level, maxHp: mini.hp, hp: mini.hp, mini: { name: mini.name, colour: miniBossRules(L).nameColour } });
    this.showLabel(m);
    this.drawBar(m);
    return m;
  }

  /** Tiles from its spawn an idle mob wanders (no server), and how long its HP bar stays after a hit (ms). */
  private readonly roam: number;
  private readonly barMs: number;

  /** Its animations, one per sheet (variant × anim × direction); the golem's red-lamp set too (variant 'enraged'), and
   *  its rise: its death played backwards. */
  private anims(id: string, def: MobDef): void {
    const make = (key: string, file: string, size: Vec2, a: { frames: number; fps: number; loop: boolean }, back = false) => {
      if (this.scene.anims.exists(key) || !this.scene.textures.exists(file)) return;
      slice(this.scene.textures, file, size[0], size[1]);
      const frames = this.scene.anims.generateFrameNumbers(file, { start: 0, end: a.frames - 1 });
      this.scene.anims.create({ key, frames: back ? frames.reverse() : frames, frameRate: a.fps, repeat: a.loop ? -1 : 0 });
    };
    for (const v of mobVariants(def)) {
      const { size } = mobCell(def, v);
      for (const [anim, a] of Object.entries(def.animations)) for (const dir of def.directions) make(`mob:${id}:${v}:${anim}:${dir}`, mobSheet(def, v, anim, dir), size, a);
    }
    if (!def.enraged) return;
    for (const anim of def.enraged.animations) {
      const a = def.animations[anim];
      if (a) for (const dir of def.directions) make(`mob:${id}:enraged:${anim}:${dir}`, mobSheet(def, '', anim, dir, true), def.size, a);
    }
    const death = def.animations.death;
    if (death) for (const dir of def.directions) make(`mob:${id}::rise:${dir}`, mobSheet(def, '', 'death', dir), def.size, death, true);
  }

  private place(zone: MobZone, def: MobDef, data: MobData | null, at: Tile, id: string, pack: Mob[] | null): Mob {
    const variants = mobVariants(def);
    const variant = variants[Math.floor(seeded(`${id}:variant`) * variants.length)];
    const sprite = this.scene.add.sprite(0, 0, mobSheet(def, variant, 'idle', 'se')).setScale(data?.scale ?? 1);
    const S = this.M.fx.shadow as unknown as { file: string; size: [number, number]; anchor: [number, number] } | undefined;
    // Its kind's size of shadow (mobs.json), on the ground at its anchor (a floating one's too): the shadow art's look
    // drawn at that size (scaled up, the golem's went blocky), else the art itself.
    const shadow = !S || !this.scene.textures.exists(S.file) ? null
      : data?.shadow ? this.scene.add.image(0, 0, this.shadowSheet(S.file, ...(data.shadow.map((n) => Math.round(n * (data.scale ?? 1))) as [number, number])))
      : this.scene.add.image(0, 0, S.file).setOrigin(S.anchor[0] / S.size[0], S.anchor[1] / S.size[1]);
    // Its kind's level and HP (the server's snapshot says the same).
    const kind = this.stats ? mobStats(this.stats, zone.mob) : undefined;
    const level = kind?.level ?? zone.level;
    const hp = kind?.hp ?? 1;
    const mob: Mob = {
      id, zone, def, variant, cell: mobCell(def, variant), data, level, maxHp: hp, spawn: at, home: at, pack,
      col: at.col + 0.5, row: at.row + 0.5, drawCol: 0, drawRow: 0, dir: (['se', 'sw', 'ne', 'nw'] as const)[Math.floor(seeded(`${id}:dir`) * 4)],
      sprite, shadow, path: [], restUntil: this.scene.time.now + Phaser.Math.Between(0, REST_MS[1]), label: null, labelUntil: 0,
      hp, dead: false, pose: null, bar: null, shield: null, openUntil: 0, fightUntil: 0, speed: data?.drift?.speed ?? SPEED, slowUntil: 0, asleep: false, lunge: { x: 0, y: 0 },
      enraged: false, add: false, mini: null, radius: data?.radius ?? 0, untouchable: false, hitAt: -Infinity, hurtAt: -Infinity,
    };
    // A pack's caps start round the point, each on a tile of its own (the server's place comes with its snapshot).
    if (pack?.length) mob.home = this.besideSpawn(mob, pack, id);
    pack?.push(mob);
    mob.col = mob.home.col + 0.5;
    mob.row = mob.home.row + 0.5;
    [mob.drawCol, mob.drawRow] = [mob.col, mob.row];
    this.dress(mob);
    this.onSpawn(sprite);
    if (shadow) this.onSpawn(shadow);
    // A click: its name and level over its head for a moment.
    sprite.setInteractive({ cursor: 'pointer', pixelPerfect: true }).on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!p.leftButtonReleased() && !p.wasTouch) return;
      this.showLabel(mob);
      this.setTarget(mob);
    });
    // Its one-shot poses: each frame (hooks on the frames that matter) and their end.
    sprite.on(Phaser.Animations.Events.ANIMATION_UPDATE, (_a: Phaser.Animations.Animation, f: Phaser.Animations.AnimationFrame) => {
      if (mob.pose && sprite.anims.currentAnim?.key === mob.pose.key) mob.pose.onFrame?.(f.index - 1);
    });
    sprite.on(Phaser.Animations.Events.ANIMATION_COMPLETE, (a: Phaser.Animations.Animation) => {
      if (mob.pose?.key === a.key) this.endPose(mob);
    });
    this.play(mob, 'idle');
    this.list.push(mob);
    this.byId.set(mob.id, mob);
    this.sync(mob);
    return mob;
  }

  /** A `w × h` ground shadow like the shadow art (a pixel ellipse in its colour, taken from its middle), made once. */
  private shadowSheet(art: string, w: number, h: number): string {
    const key = `mob-shadow:${w}x${h}`;
    if (this.scene.textures.exists(key)) return key;
    const src = this.scene.textures.get(art).getSourceImage() as HTMLImageElement;
    const c = this.scene.textures.getPixel(Math.floor(src.width / 2), Math.floor(src.height / 2), art);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = c ? `rgba(${c.red}, ${c.green}, ${c.blue}, ${c.alpha / 255})` : 'rgba(30, 27, 58, 0.4)';
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (((x + 0.5 - w / 2) / (w / 2)) ** 2 + ((y + 0.5 - h / 2) / (h / 2)) ** 2 <= 1) ctx.fillRect(x, y, 1, 1);
    this.scene.textures.addCanvas(key, canvas);
    return key;
  }

  /** A free tile next to the spawn for a pack's cap (seeded, as the bot's), or the spawn. */
  private besideSpawn(m: Mob, pack: Mob[], id: string): Tile {
    const taken = new Set(pack.map((x) => `${x.home.col},${x.home.row}`));
    const first = Math.floor(seeded(`${id}:spot`) * STEPS.length);
    for (let i = 0; i < STEPS.length; i++) {
      const [dc, dr] = STEPS[(first + i) % STEPS.length];
      const t = { col: m.spawn.col + dc, row: m.spawn.row + dr };
      if (!taken.has(`${t.col},${t.row}`) && this.canStand(m, t, 1)) return t;
    }
    return m.spawn;
  }

  /** Its sprite's origin at its variant's anchor. */
  private dress(m: Mob): void {
    const { size, anchor } = m.cell;
    m.sprite.setOrigin(anchor[0] / size[0], anchor[1] / size[1]);
  }

  /** Another look (the server's pick): its cell and anchor, and the anim it was playing in the new sheets. */
  private setVariant(m: Mob, variant: string): void {
    if (variant === m.variant || !mobVariants(m.def).includes(variant)) return;
    m.variant = variant;
    m.cell = mobCell(m.def, variant);
    const anim = m.sprite.anims.currentAnim?.key.split(':')[3] ?? 'idle';
    m.sprite.setTexture(mobSheet(m.def, variant, anim, m.dir), 0);
    this.dress(m);
    const key = `mob:${m.zone.mob}:${variant}:${anim}:${m.dir}`;
    if (this.scene.anims.exists(key) && !m.asleep) m.sprite.play(key, true);
  }

  private key(m: Mob, anim: string): string {
    const v = m.enraged && m.def.enraged?.animations.includes(anim) ? 'enraged' : m.variant;
    return `mob:${m.zone.mob}:${v}:${anim}:${m.dir}`;
  }

  private play(m: Mob, anim: string): void {
    if (m.pose || m.dead || m.asleep) return;
    const key = this.key(m, anim);
    if (m.sprite.anims.currentAnim?.key !== key && this.scene.anims.exists(key)) m.sprite.play(key, true);
  }

  /** Where it can stand: its zone's level and rect, open, not a ramp, outside the safe zone, close to its spawn. */
  private canStand(m: Mob, t: Tile, reach = this.roam): boolean {
    const H = this.objects.heights;
    const [c0, r0, c1, r1] = this.map.safeZone ?? [-1, -1, -2, -2];
    const [z0, y0, z1, y1] = m.zone.rect;
    return (
      t.col >= z0 && t.col <= z1 && t.row >= y0 && t.row <= y1 &&
      this.grid.walkable(t.col, t.row) &&
      H.at(t.col, t.row) === m.zone.height &&
      !H.ramp(t.col, t.row) &&
      !(t.col >= c0 && t.col <= c1 && t.row >= r0 && t.row <= r1) &&
      Math.max(Math.abs(t.col - m.spawn.col), Math.abs(t.row - m.spawn.row)) <= reach
    );
  }

  /** (No server.) A few tiles' hop to a spot near its spawn (a follower: near its leader), every step on ground it may
   *  stand on. */
  private wander(m: Mob): void {
    const from = { col: Math.floor(m.col), row: Math.floor(m.row) };
    const lead = m.pack?.find((x) => !x.dead);
    const near = lead && lead !== m ? { col: Math.floor(lead.path.at(-1)?.col ?? lead.col), row: Math.floor(lead.path.at(-1)?.row ?? lead.row) } : null;
    const [centre, spread, reach] = near ? [near, FOLLOW, this.roam + FOLLOW] : [m.spawn, this.roam, this.roam];
    for (let tries = 0; tries < 6; tries++) {
      const to = { col: centre.col + Phaser.Math.Between(-spread, spread), row: centre.row + Phaser.Math.Between(-spread, spread) };
      if ((to.col === from.col && to.row === from.row) || !this.canStand(m, to, reach)) continue;
      const path = this.grid.findPath(from, to, 200); // a short hop: a small search
      if (!path || path.length > reach * 2 + 1 || !path.every((t) => this.canStand(m, t, reach))) continue;
      m.path = path.slice(1);
      return;
    }
  }

  /** The server runs them from now on: every mob where it says (facing its way, its HP, the rest of a hop under way); the
   *  golem's Adds in it are made (their `kind`), and Adds it no longer has are gone; a zone's mob we didn't start with is
   *  made where it is. */
  applySnapshot(mobs: TownMob[]): void {
    this.server = true;
    const ids = new Set(mobs.map((s) => s.id));
    this.remove(this.list.filter((m) => m.add && !ids.has(m.id)).map((m) => m.id), false);
    for (const s of mobs) {
      const m = this.byId.get(s.id) ?? (s.kind ? this.makeAdd(s) : this.makeZoneMob(s));
      if (m) this.apply(m, s);
    }
    if (this.target) this.onTarget?.(this.target); // its level may have changed
  }

  /** A mob as the server has it. */
  private apply(m: Mob, s: TownMob): void {
    if (s.variant !== undefined) this.setVariant(m, s.variant);
    m.col = m.drawCol = s.col + 0.5;
    m.row = m.drawRow = s.row + 0.5;
    m.level = s.level;
    m.maxHp = s.maxHp;
    if (s.dir) m.dir = s.dir;
    m.path = (s.path ?? []).map(([col, row]) => ({ col, row }));
    m.speed = s.speed ?? SPEED;
    m.hp = s.hp;
    m.pose = null;
    this.show(m, !s.dead);
    this.sync(m);
  }

  /** A zone's mob (`<zone>:<k>`, a pack's cap `<zone>:<k>:<n>` with the others of `<zone>:<k>`) we didn't start with:
   *  made where the server has it. */
  private makeZoneMob(s: TownMob): Mob | null {
    const zone = this.map.mobZones?.find((z) => z.active && s.id.startsWith(`${z.id}:`));
    if (zone && s.mini) return this.placeMini(zone, s.id, { col: s.col, row: s.row });
    const def = zone ? this.M.mobs?.[zone.mob] : undefined;
    if (!zone || !def || typeof def === 'string') return null;
    const raw = (this.scene.cache.json.get('mob-data') ?? {})[zone.mob];
    const data = typeof raw === 'object' ? (raw as MobData) : null;
    const slot = data?.pack ? s.id.slice(0, s.id.lastIndexOf(':')) : null;
    const pack = slot ? (this.list.find((x) => x.pack && x.id.startsWith(`${slot}:`))?.pack ?? []) : null;
    return this.place(zone, def, data, { col: s.col, row: s.row }, s.id, pack);
  }

  /** The golem's Adds crawling out (`mob-add`): made where the server says, fading in. */
  add(mobs: TownMob[]): void {
    for (const s of mobs) {
      if (!s.kind || this.byId.has(s.id)) continue;
      const m = this.makeAdd(s);
      if (!m) continue;
      this.apply(m, s);
      if (!m.asleep) {
        m.sprite.setAlpha(0);
        this.scene.tweens.add({ targets: m.sprite, alpha: 1, duration: 400 });
      }
    }
  }

  /** An Add of `kind` (its art is a zone's that's on: the Tin Cans' and Bottle Caps'), in a zone of its own made from its
   *  kind's (its level; it lives where the server puts it). */
  private makeAdd(s: TownMob): Mob | null {
    const def = this.M.mobs?.[s.kind!];
    if (!def || typeof def === 'string') return null;
    this.anims(s.kind!, def);
    const own = this.map.mobZones?.find((z) => z.mob === s.kind);
    const zone: MobZone = {
      id: 'golem-add', name: GOLEM_PIT, mob: s.kind!, level: own?.level ?? s.level, rect: [s.col, s.row, s.col, s.row], height: own?.height ?? 0,
      pack: 0, aggro: 'aggressive', aggroRange: 0, leash: 0, respawnSec: 0, active: true, spawns: [],
    };
    const data = (this.scene.cache.json.get('mob-data') ?? {})[s.kind!];
    const m = this.place(zone, def, typeof data === 'object' ? (data as MobData) : null, { col: s.col, row: s.row }, s.id, null);
    m.add = true;
    return m;
  }

  /** Mobs gone for good (the golem's Adds when its fight ends): faded out (`fade`), then dropped. */
  remove(ids: string[], fade = true): void {
    for (const id of ids) {
      const m = this.byId.get(id);
      if (!m) continue;
      this.byId.delete(id);
      this.list.splice(this.list.indexOf(m), 1);
      if (m === this.target) this.setTarget(null);
      const parts = [m.sprite, ...(m.shadow ? [m.shadow] : [])];
      this.scene.tweens.killTweensOf(parts);
      const drop = () => {
        parts.forEach((p) => p.destroy());
        m.bar?.destroy();
        m.shield?.destroy();
        m.label?.text.destroy();
      };
      m.bar?.destroy();
      m.bar = null;
      if (fade && !m.asleep && !m.dead) this.scene.tweens.add({ targets: parts, alpha: 0, duration: DEATH_FADE_MS, onComplete: drop });
      else drop();
    }
  }

  /** The field boss (the golem) in its pit (`zone`: its name, level and rect), made once its art is loaded; hidden (dead)
   *  until it rises. Null without its art. */
  makeBoss(id: string, zone: MobZone): Mob | null {
    const known = this.byId.get(id);
    if (known) return known;
    const def = this.M.mobs?.[id];
    if (!def || typeof def === 'string' || !this.scene.textures.exists(mobSheet(def, '', 'idle', 'se'))) return null;
    this.anims(id, def);
    const data = (this.scene.cache.json.get('mob-data') ?? {})[id];
    const m = this.place(zone, def, typeof data === 'object' ? (data as MobData) : null, { col: zone.spawns[0][0], row: zone.spawns[0][1] }, id, null);
    this.show(m, false);
    return m;
  }

  /** A mob by id. */
  get(id: string): Mob | undefined {
    return this.byId.get(id);
  }

  /** Where its feet are in the world now (asleep too: from its tile, not its sprite). */
  feet(m: Mob): Pt {
    const ground = this.objects.heights.lift(m.drawCol, m.drawRow);
    return { x: Math.round((m.drawCol - m.drawRow) * 16), y: Math.round((m.drawCol + m.drawRow) * 8 - ground) };
  }

  /** A tile's middle in the world, on its ground (grid point `col, row` = a tile's top corner; + 0.5 its middle). */
  ground(col: number, row: number): Pt {
    return { x: Math.round((col - row) * 16), y: Math.round((col + row) * 8 - this.objects.heights.lift(col, row)) };
  }

  /** Where it stands now (a hop cut short: there at once), shown or not. */
  setAt(m: Mob, col: number, row: number): void {
    m.col = m.drawCol = col + 0.5;
    m.row = m.drawRow = row + 0.5;
    m.path = [];
    this.sync(m);
  }

  /** Turns where it stands (`mob-face`: the golem's slow quarter turns): the anim it's in, in the new facing. */
  face(id: string, dir: TownMobFacing): void {
    const m = this.byId.get(id);
    if (!m || m.dir === dir) return;
    m.dir = dir;
    this.reshow(m);
  }

  /** The golem's red-lamp sheets on or off: the anim it's in, from the same frame. */
  setEnraged(m: Mob, on: boolean): void {
    if (m.enraged === on) return;
    m.enraged = on;
    this.reshow(m);
  }

  /** The anim it's in again, in its sheets now (its facing, its lamp), from the same frame. */
  private reshow(m: Mob): void {
    if (m.asleep || m.dead) return;
    const cur = m.sprite.anims.currentAnim?.key.split(':')[3] ?? 'idle';
    const key = this.key(m, cur);
    if (!this.scene.anims.exists(key)) return;
    const frame = m.sprite.anims.currentFrame?.index ?? 1;
    if (m.pose) m.pose.key = key;
    m.sprite.play({ key, startFrame: Math.max(0, frame - 1) });
  }

  /** A hop from the server: from its first tile (a jump there if we'd drifted) along the rest. */
  hop(id: string, path: [number, number][], speed = SPEED): void {
    const m = this.byId.get(id);
    if (!m || !path.length) return;
    m.speed = speed;
    const [c0, r0] = path[0];
    if (Math.floor(m.col) !== c0 || Math.floor(m.row) !== r0) {
      m.col = c0 + 0.5;
      m.row = r0 + 0.5;
      if (!m.data?.drift) [m.drawCol, m.drawRow] = [m.col, m.row];
    }
    m.path = path.slice(1).map(([col, row]) => ({ col, row }));
  }

  /** A hit (the server's word): the hit pose (or its death), a damage number ("Blocked" off a shell, "Miss" for a miss),
   *  the HP bar. */
  hit(id: string, damage: number, crit: boolean, hp: number, dead: boolean, slow?: { factor: number; ms: number }, blocked = false, miss = false, burn = false): void {
    const m = this.byId.get(id);
    if (!m || m.dead) return;
    m.hp = hp;
    const now = this.scene.time.now;
    m.fightUntil = now + FIGHT_MS;
    m.hitAt = now; // its HP bar for a while
    if (damage > 0 && !dead && now - m.hurtAt >= HURT_SOUND_MS) {
      m.hurtAt = now;
      playSet(`combat-mob-hurt-${m.zone.mob}`, { at: this.tileOf(m.id) });
    }
    if (blocked) m.shield?.setScale(1.6); // the shield bounces as it takes the hit
    if (slow && !dead) this.chill(m, slow);
    if (!m.asleep) this.number(m, blocked ? 'Blocked' : miss ? 'Miss' : String(damage), crit, burn && !blocked && !miss ? BURN_COLOUR : undefined);
    if (dead) this.kill(m);
    else if (!blocked && !miss && !(m.radius && m.pose)) this.pose(m, 'hit'); // (a hit never cuts the golem's attack short)
    this.drawBar(m);
    if (m === this.target) this.onTarget?.(m);
  }

  /** It dies: `onDeath`, let go, its death pose and gone. */
  kill(m: Mob): void {
    if (m.dead) return;
    playSet(`combat-mob-death-${m.zone.mob}`, { at: this.tileOf(m.id) });
    m.path = [];
    m.dead = true;
    this.hooks.onDeath?.(m);
    if (m === this.target) this.setTarget(null);
    this.fall(m);
  }

  /** Its death pose (from frame `from`), then it fades out and is gone (asleep: just gone). Dead already, or about to be. */
  fall(m: Mob, from = 0): void {
    m.dead = true;
    m.path = [];
    if (m === this.target) this.setTarget(null);
    if (m.asleep) return this.show(m, false);
    this.drawBar(m);
    this.pose(m, 'death', {
      from,
      then: () =>
        this.scene.tweens.add({ targets: [m.sprite, ...(m.shadow ? [m.shadow] : [])], alpha: 0, duration: DEATH_FADE_MS, onComplete: () => m.dead && this.show(m, false) }),
    });
  }

  /** It gave up its fight (`mob-heal`): full HP again as it walks home. */
  heal(id: string, hp: number): void {
    const m = this.byId.get(id);
    if (m && !m.dead) this.setHp(m, hp);
  }

  /** Its HP (and max) as the server has them now: the bar over it and the info bar. */
  setHp(m: Mob, hp: number, maxHp = m.maxHp): void {
    if (m.hp === hp && m.maxHp === maxHp) return;
    m.hp = hp;
    m.maxHp = maxHp;
    this.drawBar(m);
    if (m === this.target) this.onTarget?.(m);
  }

  /** Slowed (or rooted: factor 0) for a while: a cold blue tint and a slower step, then itself again. */
  private chill(m: Mob, slow: { factor: number; ms: number }): void {
    m.slowUntil = this.scene.time.now + slow.ms;
    m.sprite.setTint(slow.factor === 0 ? 0x7dd3fc : 0x93c5fd);
    m.sprite.anims.timeScale = Math.max(0.35, slow.factor);
  }

  /** Its attack on a player (the server's word): turned its way (`dir`), its attack pose; the hooks on its attack
   *  frame and as it lands (the Wire Tangle's spark flies there first; the Tire Roller lunges). */
  strike(id: string, target: string, dir: TownMobFacing, slow?: number, hit?: PlayerHit): void {
    const m = this.byId.get(id);
    if (!m || m.dead) return;
    m.dir = dir;
    m.fightUntil = this.scene.time.now + FIGHT_MS;
    if (m.data?.shell) m.openUntil = this.scene.time.now + (m.data.shellOpenMs ?? SHELL_OPEN_MS); // its shell drops as it swings
    const land = () => this.hooks.onHit?.(m, target, slow, hit);
    const frame = m.data?.attackFrame ?? 0;
    const fire = () => {
      this.hooks.onAttackFrame?.(m, target);
      const to = this.playerAt?.(target);
      if (m.data?.eye && to && !m.asleep) this.spark(m, { x: to.x, y: to.y - BODY_UP }, land);
      else land();
    };
    if (m.asleep) return fire();
    let fired = false;
    this.pose(m, 'attack', {
      onFrame: (f) => {
        if (f >= frame && !fired) (fired = true), fire();
      },
      then: () => {
        if (!fired) (fired = true), fire();
      },
    });
    if (frame === 0 && !fired) (fired = true), fire();
  }

  /** The Wire Tangle's zap: a spark from its insulator eye (mobs.json eye, art px in the SE cell; mirrored for SW and NW)
   *  to the player, drawn in code on the front layer: a short jagged yellow-white line, flickering. */
  private spark(m: Mob, to: Pt, onArrive: () => void): void {
    const [ex, ey] = m.data!.eye!;
    const [ax, ay] = m.cell.anchor;
    const flip = m.dir === 'sw' || m.dir === 'nw';
    const k = m.data?.scale ?? 1;
    const from = { x: m.sprite.x + (flip ? ax - ex : ex - ax) * k, y: m.sprite.y + (ey - ay) * k };
    this.fx.drawnShot('front', from, to, { speed: SPARK_SPEED, onArrive }, (g) => drawSpark(g));
  }

  /** Back (somewhere free in its zone: its spawn from now on) with full HP. */
  respawn(id: string, col: number, row: number, hp: number): void {
    const m = this.byId.get(id);
    if (!m) return;
    Object.assign(m, { col: col + 0.5, row: row + 0.5, drawCol: col + 0.5, drawRow: row + 0.5, hp, path: [], pose: null, spawn: { col, row }, home: { col, row }, hitAt: -Infinity });
    this.scene.tweens.killTweensOf([m.sprite, ...(m.shadow ? [m.shadow] : [])]);
    this.show(m, true);
    m.shadow?.setAlpha(1);
    if (!m.asleep) {
      m.sprite.setAlpha(0);
      this.scene.tweens.add({ targets: m.sprite, alpha: 1, duration: 400 });
    } else m.sprite.setAlpha(1);
    this.sync(m);
  }

  /** A one-shot pose, then idle again (or `then`); a new one replaces one under way (its `then` dropped). `from`: its
   *  first frame (one that's partly over: a late arrival's view of the golem rising). */
  pose(m: Mob, anim: string, o: { onFrame?: (f: number) => void; then?: () => void; from?: number } = {}): void {
    const key = this.key(m, anim);
    if (!this.scene.anims.exists(key) || m.asleep) return void o.then?.();
    m.pose = { key, anim, t: 0, ...o };
    m.lunge = { x: 0, y: 0 };
    m.sprite.play({ key, startFrame: o.from ?? 0 });
  }

  private endPose(m: Mob): void {
    const then = m.pose?.then;
    m.pose = null;
    m.lunge = { x: 0, y: 0 };
    if (then) then();
    else this.play(m, m.path.length ? 'move' : 'idle');
    this.sync(m);
  }

  /** Shown (alive) or gone (dead, until it respawns). */
  show(m: Mob, alive: boolean): void {
    m.dead = !alive;
    m.sprite.setVisible(alive && !m.asleep).setAlpha(1);
    m.shadow?.setVisible(alive && !m.asleep).setAlpha(1);
    if (m.mini) m.label?.text.setVisible(alive && !m.asleep);
    if (alive) {
      m.pose = null;
      this.play(m, 'idle');
    }
    this.drawBar(m);
  }

  /** A small HP bar over it while it's your target or for barMs after its last hit (none dead or asleep). */
  private barShown(m: Mob): boolean {
    return !m.dead && !m.asleep && (!!m.mini || m === this.target || this.scene.time.now < m.hitAt + this.barMs);
  }

  private drawBar(m: Mob): void {
    if (!this.barShown(m)) {
      m.bar?.destroy();
      m.bar = null;
      return;
    }
    m.bar ??= this.scene.add.graphics();
    const w = m.radius ? 40 : m.mini ? 30 : 20; // (the golem's wider, a mini boss's a little)
    m.bar.clear().fillStyle(0x0b0a1a, 0.85).fillRect(-w / 2 - 1, -1, w + 2, 4).fillStyle(0xdc2626, 1).fillRect(-w / 2, 0, Math.max(1, Math.round((w * m.hp) / m.maxHp)), 2);
    this.syncBar(m);
  }

  private syncBar(m: Mob): void {
    m.bar?.setPosition(Math.round(m.sprite.x - m.lunge.x), Math.round(this.top(m) + 2)).setDepth(LABEL_DEPTH - 1);
  }

  /** Where its art's top is now (world y): the cell's top, or mobs.json `top` (the golem's head, well under its cell's). */
  private top(m: Mob): number {
    return m.sprite.y + ((m.data?.top ?? 0) - m.cell.anchor[1]) * (m.data?.scale ?? 1);
  }

  /** A number rising over it (gold and bigger for a crit; "Blocked" and "Miss" smaller, pale); over the golem, spread across its
   *  shoulders so many hitters' numbers don't pile up. */
  private number(m: Mob, text: string, crit: boolean, colour?: string): void {
    const word = !/^\d+$/.test(text);
    const x = m.sprite.x + (m.radius ? Phaser.Math.Between(-24, 24) * (m.data?.scale ?? 1) : 0);
    const t = this.scene.add
      .text(Math.round(x), Math.round(this.top(m) - 4), text, {
        fontFamily: '"Mk Numbers", "Pixelify Sans", monospace',
        fontSize: `${crit ? 16 : word ? 10 : 12}px`,
        color: colour ?? (crit ? '#FCDA4A' : word ? '#CBD5E1' : '#FFFFFF'),
        stroke: '#1E1B3A',
        strokeThickness: 3,
        resolution: Math.max(2, this.zoom * 2),
      })
      .setOrigin(0.5, 1)
      .setDepth(LABEL_DEPTH);
    this.scene.tweens.add({ targets: t, y: t.y - 14, alpha: { from: 1, to: 0 }, duration: 800, ease: 'Quad.easeOut', onComplete: () => t.destroy() });
  }

  private server = false;
  private readonly byId = new Map<string, Mob>();

  update(deltaMs: number): void {
    const now = this.scene.time.now;
    const view = this.scene.cameras.main.worldView;
    const [vx0, vy0, vx1, vy1] = [view.x - WAKE_MARGIN, view.y - WAKE_MARGIN, view.right + WAKE_MARGIN, view.bottom + WAKE_MARGIN];
    for (const m of this.list) {
      // Near the camera, or asleep (its sprites off).
      const x = (m.col - m.row) * 16;
      const y = (m.col + m.row) * 8;
      const awake = x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1;
      if (awake === m.asleep) this.setAwake(m, awake);
      if (m.slowUntil && now >= m.slowUntil) {
        m.slowUntil = 0;
        m.sprite.clearTint();
        m.sprite.anims.timeScale = 1;
        this.onSpawn(m.sprite); // the night's tint again
      }
      if (m.dead) continue;
      if (!this.server && !m.path.length && now >= m.restUntil) {
        this.wander(m);
        m.restUntil = now + Phaser.Math.Between(...REST_MS);
      }
      const walking = m.path.length > 0;
      if (walking) this.walk(m, deltaMs);
      if (m.asleep) {
        [m.drawCol, m.drawRow] = [m.col, m.row];
        continue;
      }
      // A drifter's drawn place eases after its real one; it keeps drifting till it's there.
      let moving = walking;
      if (m.data?.drift) {
        const k = 1 - Math.exp(-deltaMs / DRIFT_MS);
        m.drawCol += (m.col - m.drawCol) * k;
        m.drawRow += (m.row - m.drawRow) * k;
        moving ||= Math.hypot(m.col - m.drawCol, m.row - m.drawRow) > 0.08;
      } else [m.drawCol, m.drawRow] = [m.col, m.row];
      if (m.pose) this.posing(m, deltaMs);
      if (m.bar && !this.barShown(m)) this.drawBar(m); // its bar's time is up
      this.play(m, moving ? 'move' : 'idle');
      if (moving || m.pose) this.sync(m);
      if (m.label) {
        if (now >= m.labelUntil) {
          m.label.show(null);
          const l = m.label;
          m.label = null;
          this.scene.time.delayedCall(200, () => l.text.destroy());
        } else {
          // The name moves with it.
          m.label.text.setX(Math.round(m.sprite.x));
          m.label.show(this.top(m) + (m.radius ? -10 : 4));
        }
      }
    }
  }

  /** Along its hop at its pace, facing each step's way. */
  private walk(m: Mob, deltaMs: number): void {
    let budget = (m.speed * deltaMs) / 1000;
    while (budget > 0 && m.path.length) {
      const next = m.path[0];
      const dx = next.col + 0.5 - m.col;
      const dy = next.row + 0.5 - m.row;
      const d = Math.hypot(dx, dy);
      const sc = Math.sign(Math.round(dx * 2));
      const sr = Math.sign(Math.round(dy * 2));
      if (sc || sr) m.dir = FACING[stepName(sc, sr)] ?? m.dir;
      if (d <= budget) {
        m.col = next.col + 0.5;
        m.row = next.row + 0.5;
        m.path.shift();
        budget -= d;
      } else {
        m.col += (dx / d) * budget;
        m.row += (dy / d) * budget;
        budget = 0;
      }
    }
  }

  /** A pose under way: the Tire Roller's lunge over its charge frames (out along its facing, then back). */
  private posing(m: Mob, deltaMs: number): void {
    const p = m.pose!;
    p.t += deltaMs * m.sprite.anims.timeScale;
    const charge = m.data?.charge;
    const a = m.def.animations.attack;
    if (!charge || p.anim !== 'attack' || !a) return;
    const f = p.t / (1000 / a.fps); // frames in
    const [c0, c1] = charge;
    const k = f < c0 ? 0 : f <= c1 ? Phaser.Math.Easing.Quadratic.In((f - c0) / Math.max(1, c1 - c0)) : Math.max(0, 1 - (f - c1) / Math.max(1, a.frames - c1));
    const [dc, dr] = AXIS[m.dir];
    m.lunge = { x: (dc - dr) * 16 * LUNGE * k, y: (dc + dr) * 8 * LUNGE * k };
  }

  /** Wakes it (sprites on, where it is now, in the anim it should be in) or puts it to sleep (sprites off; a pose under
   *  way is cut short and its end done now). */
  private setAwake(m: Mob, awake: boolean): void {
    m.asleep = !awake;
    m.sprite.setActive(awake).setVisible(awake && !m.dead);
    m.shadow?.setVisible(awake && !m.dead);
    if (m.mini) m.label?.text.setVisible(awake && !m.dead); // (a mini boss's name: with it)
    if (!awake) {
      if (m.pose) {
        const then = m.pose.then;
        m.pose = null;
        then?.();
      }
      this.scene.tweens.killTweensOf([m.sprite, ...(m.shadow ? [m.shadow] : [])]);
      if (m.dead) this.show(m, false);
      m.sprite.setAlpha(1);
      m.lunge = { x: 0, y: 0 };
      this.drawBar(m);
      return;
    }
    [m.drawCol, m.drawRow] = [m.col, m.row];
    this.play(m, m.path.length ? 'move' : 'idle');
    this.drawBar(m);
    this.sync(m);
  }

  /** Targets the nearest mob within reach of `from` that isn't the current one (so Z again goes on to the next). */
  targetNext(from: { col: number; row: number }): Mob | null {
    const near = this.list
      .map((m) => ({ m, d: Math.hypot(m.col - from.col - 0.5, m.row - from.row - 0.5) }))
      .filter((x) => x.d - x.m.radius <= TARGET_RANGE && !x.m.dead && !x.m.untouchable)
      .sort((a, b) => a.d - b.d);
    if (!near.length) return this.setTarget(null);
    const i = this.target ? near.findIndex((x) => x.m === this.target) : -1;
    return this.setTarget(near[(i + 1) % near.length].m);
  }

  /** The targeted mob, if any. */
  get current(): Mob | null {
    return this.target;
  }

  /** A mob's tile (null: no such mob). */
  tileOf(id: string): { col: number; row: number } | null {
    const m = this.byId.get(id);
    return m ? { col: Math.floor(m.col), row: Math.floor(m.row) } : null;
  }

  setTarget(m: Mob | null): Mob | null {
    if (m === this.target) return m;
    const was = this.target;
    this.target = m;
    if (was) this.drawBar(was); // (its bar only while hit lately)
    if (m) this.drawBar(m);
    this.ring?.destroy();
    this.ring = null;
    if (m) {
      // A soft gold ring on the ground under it.
      // (Round the golem's shadow.)
      const [w, h] = m.radius && m.data ? [m.data.shadow[0] * (m.data.scale ?? 1) + 8, m.data.shadow[1] * (m.data.scale ?? 1) + 6] : [22, 10];
      this.ring = this.scene.add.graphics();
      this.ring.lineStyle(1, 0xfcda4a, 0.9).strokeEllipse(0, 0, w, h).lineStyle(1, 0x1e1b3a, 0.6).strokeEllipse(0, 1, w + 2, h + 1);
      this.syncRing();
    }
    this.onTarget?.(m);
    return m;
  }

  /** Lets go of the target once it's far from `from`. */
  check(from: { col: number; row: number }): void {
    const m = this.target;
    if (m && Math.hypot(m.col - from.col - 0.5, m.row - from.row - 0.5) > TARGET_LOSE) this.setTarget(null);
  }

  private syncRing(): void {
    const m = this.target;
    if (!m || !this.ring) return;
    this.ring.setPosition(m.sprite.x - m.lunge.x, m.sprite.y - m.lunge.y).setDepth(m.sprite.depth - 0.3);
  }

  private sync(m: Mob): void {
    if (m.asleep) return;
    const ground = this.objects.heights.lift(m.drawCol, m.drawRow);
    const x = Math.round((m.drawCol - m.drawRow) * 16);
    const y = Math.round((m.drawCol + m.drawRow) * 8 - ground);
    m.sprite.setPosition(x + Math.round(m.lunge.x), y + Math.round(m.lunge.y));
    const feet = (m.drawCol + m.drawRow + 1) * 8 + CHARACTER_BIAS + ground * HEIGHT_DEPTH;
    const depth = characterDepth(this.objects, Math.floor(m.drawCol), Math.floor(m.drawRow), feet, m.sprite.getBounds());
    m.sprite.setDepth(depth);
    m.shadow?.setPosition(x + Math.round(m.lunge.x), y + Math.round(m.lunge.y)).setDepth(depth - 0.2);
    if (m === this.target) this.syncRing();
    this.syncBar(m);
    if (m.data?.shell) this.syncShield(m);
  }

  /** A crab's shield over its HP bar: shown while its shell is up and it's fighting (or your target), gone while it's
   *  down (hit it then); a blocked hit bounces it. */
  private syncShield(m: Mob): void {
    const now = this.scene.time.now;
    const show = !m.dead && !m.asleep && now >= m.openUntil && (now < m.fightUntil || m === this.target);
    if (!show) {
      m.shield?.setVisible(false);
      return;
    }
    if (!m.shield) m.shield = drawShield(this.scene.add.graphics());
    const k = m.shield.scale;
    m.shield.setScale(k > 1 ? Math.max(1, k - 0.06) : 1).setVisible(true);
    m.shield.setPosition(Math.round(m.sprite.x - m.lunge.x), Math.round(this.top(m) - 4)).setDepth(LABEL_DEPTH - 1);
  }

  private showLabel(m: Mob): void {
    const name = `${m.mini?.name ?? m.def.name} Lv ${m.level}`;
    if (!m.label) {
      m.label = new BuildingLabel(this.scene, name, m.sprite.x);
      m.label.setZoom(this.zoom);
    }
    m.label.text.setText(name).setColor(m.mini?.colour ?? TONE[this.tone(m)]);
    m.label.show(this.top(m) + (m.radius ? -10 : 4));
    m.labelUntil = m.mini ? Infinity : this.scene.time.now + LABEL_MS; // (a mini boss's name always shows)
  }

  /** Its name's colour for you: grey 5+ levels below you, red 3+ above, white between (white without the rules). */
  tone(m: Mob): 'grey' | 'white' | 'red' {
    return this.stats ? mobTone(this.stats, this.myLevel(), m.level) : 'white';
  }

  setZoom(zoom: number): void {
    this.zoom = zoom;
    for (const m of this.list) m.label?.setZoom(zoom);
  }

  /** How many are awake (near the camera) now. */
  get awakeCount(): number {
    return this.list.reduce((n, m) => n + (m.asleep ? 0 : 1), 0);
  }

  get tintables(): Phaser.GameObjects.Components.Tint[] {
    return this.list.flatMap((m) => (m.shadow ? [m.sprite, m.shadow] : [m.sprite]));
  }
}

/** A spark's look (around its own origin, pointing along +x): a short jagged line, a yellow glow round a white core,
 *  re-jagged and flickering every frame. */
function drawSpark(g: Phaser.GameObjects.Graphics): void {
  const pts: [number, number][] = [[-7, 0]];
  for (let i = 1; i < 4; i++) pts.push([-7 + i * 3.5, Phaser.Math.Between(-2, 2)]);
  pts.push([7, 0]);
  const line = (w: number, c: number, a: number) => {
    g.lineStyle(w, c, a).beginPath().moveTo(...pts[0]);
    for (const p of pts.slice(1)) g.lineTo(...p);
    g.strokePath();
  };
  const a = 0.65 + Math.random() * 0.35;
  line(3, 0xfacc15, a * 0.8);
  line(1, 0xffffff, a);
  if (Math.random() < 0.5) g.fillStyle(0xfef9c3, a).fillRect(Phaser.Math.Between(-6, 4), Phaser.Math.Between(-3, 2), 1, 1);
}

/** The Bag's slow on a player (half their walking speed meanwhile: TownScene slowMe, the server's step budget): a small
 *  badge by the head (two pale-blue chevrons pointing down on navy) and a faint cold ring at the feet, for `ms`; on the
 *  front and ground fx layers. */
export function showSlowed(fx: FxLayers, head: () => Pt, feet: () => Pt, ms: number): void {
  fx.drawFx('front', (g, t) => {
    const h = head();
    const bob = Math.round(Math.sin(t / 220));
    const x = Math.round(h.x + 8);
    const y = Math.round(h.y + 3 + bob);
    g.fillStyle(0x1e1b3a, 0.9).fillRect(x - 4, y - 4, 9, 9);
    g.fillStyle(0x7dd3fc, 1).fillRect(x - 3, y - 3, 7, 7);
    g.fillStyle(0xffffff, 1);
    for (const dy of [-2, 1]) g.fillRect(x - 2, y + dy, 1, 1).fillRect(x - 1, y + dy + 1, 1, 1).fillRect(x, y + dy + 2, 1, 1).fillRect(x + 1, y + dy + 1, 1, 1).fillRect(x + 2, y + dy, 1, 1);
  }, ms, 300);
  fx.drawFx('ground', (g, t) => {
    const f = feet();
    g.lineStyle(1, 0x93c5fd, 0.55 + 0.25 * Math.sin(t / 160)).strokeEllipse(Math.round(f.x), Math.round(f.y), 20, 9);
  }, ms, 300);
}

/** The screen direction of a grid step (as the characters' dirForStep). */
function stepName(dc: number, dr: number): string {
  const sx = dc - dr; // screen right
  const sy = dc + dr; // screen down
  if (sx > 0 && sy === 0) return 'e';
  if (sx < 0 && sy === 0) return 'w';
  if (sy > 0 && sx === 0) return 's';
  if (sy < 0 && sx === 0) return 'n';
  if (sx > 0) return sy > 0 ? 'se' : 'ne';
  return sy > 0 ? 'sw' : 'nw';
}

/** A small silver shield (code-drawn pixels, 7 × 8, centred on its bottom tip): a Scrap Crab's shell is up. */
function drawShield(g: Phaser.GameObjects.Graphics): Phaser.GameObjects.Graphics {
  const rows = ['.#####.', '#ooooo#', '#owooo#', '#owooo#', '#ooooo#', '.#ooo#.', '..#o#..', '...#...'];
  const colour: Record<string, number> = { '#': 0x1e1b3a, o: 0xa9b1d6, w: 0xeef1ff };
  rows.forEach((row, y) => [...row].forEach((ch, x) => ch !== '.' && g.fillStyle(colour[ch], 1).fillRect(x - 3.5, y - 8, 1, 1)));
  return g;
}
