import Phaser from 'phaser';
import { queueImage, queueTown } from '../assets/queue';
import type { Dir, Manifest, TownMap } from '../assets/types';
import { Character } from '../characters/character';
import { type Outfit, assetProblems, buildOutfit, outfitFiles } from '../characters/doll';
import { saveOutfit, startingOutfit } from '../characters/looks';
import type { MeResult } from '../session';
import { mountWardrobe } from '../ui/wardrobe';
import { screenToTile, tileToScreen } from '../iso';
import { toast } from '../ui/toast';
import { minutesNow, setTimeSource, skyAt } from '../world/daynight';
import { Culler } from '../world/cull';
import { type Tile, WalkGrid } from '../world/grid';
import { Ground } from '../world/ground';
import { type Bench, type Building, WorldObjects, characterDepth } from '../world/objects';

// The playable town: ground, buildings, props and the player, all placed from manifest.json + maps/town.json.
// Click (or tap) to walk; click a building to walk to its door; click a bench to sit.

const ZOOMS = [1, 2, 3, 4];
const TWIGO_ROOM_URL = 'https://tw1go.github.io';

/** What a door does. twigo's house leads back to twigo's room; the rest are hooks to fill in later. */
const DOOR_LABELS: Record<string, string> = {
  'rewards-shop': '🎁 Rewards shop',
  bank: '🏦 Bank',
  casino: '🎰 Casino',
  'mine-entrance': '⛏️ Mine',
  'tanod-outpost': '🚔 Tanod outpost',
  arena: '⚔️ Arena',
  'notice-board': '📜 Notice board',
  'leaderboard-monument': '🏆 Leaderboard',
  'jackpot-booth': '🎟️ Jackpot booth',
};

/** Keyboard walking: screen direction → grid step (col runs screen right-down, row runs screen left-down). */
const DIR_STEP: Record<Dir, [number, number]> = {
  n: [-1, -1], s: [1, 1], e: [1, -1], w: [-1, 1],
  ne: [0, -1], nw: [-1, 0], se: [1, 0], sw: [0, 1],
};
const DIR_FOR_KEYS: Record<string, Dir> = {
  '0,-1': 'n', '0,1': 's', '1,0': 'e', '-1,0': 'w', '1,-1': 'ne', '-1,-1': 'nw', '1,1': 'se', '-1,1': 'sw',
};

/** The tile a player stands on to sit on a bench facing `faces`. */
const benchApproach = (b: Bench): Tile =>
  ({ se: { col: b.col + 1, row: b.row }, sw: { col: b.col, row: b.row + 1 }, ne: { col: b.col, row: b.row - 1 }, nw: { col: b.col - 1, row: b.row } })[
    b.faces as 'se' | 'sw' | 'ne' | 'nw'
  ] ?? { col: b.col, row: b.row + 1 };

export class TownScene extends Phaser.Scene {
  private M!: Manifest;
  private map!: TownMap;
  private outfit!: Outfit;
  private ground!: Ground;
  private objects!: WorldObjects;
  private grid!: WalkGrid;
  private player!: Character;
  private doorAt = new Map<string, Building>();
  private pending: { sit: Bench } | null = null;
  private buildingAlert: Phaser.GameObjects.Sprite | null = null;
  private zoomIndex = 1;
  private tint = -1;
  private nextSkyCheck = 0;
  private culler!: Culler;
  private lampsOn = false;
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd' | 'e' | 'space', Phaser.Input.Keyboard.Key>;
  /** Whether the current walk is keyboard-driven (doors then wait for E instead of entering on arrival). */
  private byKeys = false;
  /** The camera glides after the player (off while debugging a fixed view). */
  follow = true;

  constructor() {
    super('town');
  }

  private me: MeResult | null = null;

  init(data: { manifest: Manifest; town: TownMap; me: MeResult | null }): void {
    this.M = data.manifest;
    this.map = data.town;
    this.me = data.me;
    this.outfit = startingOutfit(this.M.characters, data.me);
  }

  preload(): void {
    this.load.setPath(`${import.meta.env.BASE_URL}assets/`);
    queueTown(this.load, this.textures, this.M, this.map);
    for (const f of outfitFiles(this.M.characters, this.outfit)) queueImage(this.load, this.textures, f);
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => assetProblems.add(`failed to load ${file.src}`));
    this.showLoading();
  }

  /** A loading bar while the town's art downloads (a build fetches a dozen packed sheets; dev, a few hundred loose images). */
  private showLoading(): void {
    const { width, height } = this.scale;
    const w = Math.min(320, width - 64);
    const x = Math.round((width - w) / 2);
    const y = Math.round(height / 2);
    const frame = this.add.graphics().setScrollFactor(0);
    const bar = this.add.graphics().setScrollFactor(0);
    const text = this.add
      .text(width / 2, y - 18, 'Loading Mikazuki town…', { fontFamily: 'system-ui, sans-serif', fontSize: '14px', color: '#c0caf5' })
      .setOrigin(0.5)
      .setScrollFactor(0);
    frame.lineStyle(1, 0x565f89).strokeRect(x - 1, y - 1, w + 2, 10);
    const progress = (p: number) => {
      bar.clear().fillStyle(0x9ece6a).fillRect(x, y, Math.round(w * p), 8);
      text.setText(`Loading Mikazuki town… ${this.load.totalComplete}/${this.load.totalToLoad}`);
    };
    this.load.on(Phaser.Loader.Events.PROGRESS, progress);
    // Only for the first load: later ones (a new outfit's layers) would update a destroyed bar.
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.load.off(Phaser.Loader.Events.PROGRESS, progress);
      [frame, bar, text].forEach((g) => g.destroy());
    });
  }

  create(): void {
    applyTimeOverride();
    buildOutfit(this, this.M.characters, this.outfit);
    this.ground = new Ground(this, this.M, this.map);
    this.objects = new WorldObjects(this, this.M, this.map);
    this.grid = new WalkGrid(this.map);
    for (const b of this.objects.buildings) for (const [c, r] of b.doors) this.doorAt.set(`${c},${r}`, b);

    const [sc, sr] = this.map.spawn;
    this.player = new Character(this, this.M, this.outfit, { col: sc, row: sr });
    this.player.depthFn = (c, r, d, b) => characterDepth(this.objects, c, r, d, b);
    this.player.onArrive = (tile) => this.arrived(tile);
    this.player.nextStep = () => this.keyStep();
    this.player.onSpawn = (obj) => this.tint >= 0 && obj.setTint(this.tint);

    this.setupCamera();
    // Only what the camera can see is drawn and animated.
    this.culler = new Culler([...this.ground.cullable, ...this.objects.cullable]);
    this.culler.onShow = (img) => this.ground.refresh(img);
    this.culler.update(this.cameras.main.worldView);
    this.setupInput();
    this.updateSky(true);
    mountWardrobe(this.M.characters, {
      current: () => ({ ...this.outfit }),
      apply: (o) => this.setOutfit(o),
      save: (o) => saveOutfit(o, this.me?.status === 'ok'),
      loggedIn: () => this.me?.status === 'ok',
    });
    exposeDebug(this);
    if (assetProblems.size) console.warn('[town] asset problems:\n' + [...assetProblems].join('\n'));
  }

  update(time: number, delta: number): void {
    this.ground.tick(time);
    this.player.update(delta);
    if (this.follow) this.followPlayer();
    this.culler.update(this.cameras.main.worldView);
    this.objects.setLamps(this.lampsOn); // glows follow their lamp's visibility
    if (time >= this.nextSkyCheck) {
      this.nextSkyCheck = time + 1000;
      this.updateSky(false);
    }
  }

  // ── Camera ──

  private setupCamera(): void {
    const cam = this.cameras.main;
    const [cols, rows] = this.map.size;
    // The town's pixel extent: the tile diamond, grown to include anything that sticks out (tall trees, roofs).
    const bounds = new Phaser.Geom.Rectangle(-rows * 16, 0, (cols + rows) * 16, (cols + rows) * 8);
    for (const s of this.objects.sprites) Phaser.Geom.Rectangle.Union(bounds, s.getBounds(), bounds);
    cam.setBounds(Math.floor(bounds.x), Math.floor(bounds.y), Math.ceil(bounds.width), Math.ceil(bounds.height));
    cam.roundPixels = true;
    this.zoomIndex = defaultZoomIndex(this.scale.width, this.scale.height);
    cam.setZoom(ZOOMS[this.zoomIndex]);
    cam.centerOn(this.player.sprite.x, this.player.sprite.y);
  }

  /**
   * Camera follow: holds still while the player is inside a deadzone of 1/5 of the view, then glides (12% of the
   * gap per frame) in whole-pixel steps, so the scroll is always rounded and sprites never shimmer. The camera's
   * bounds clamp it to the town.
   */
  private followPlayer(): void {
    const cam = this.cameras.main;
    const p = this.player.sprite;
    const zoneW = cam.width / cam.zoom / 5;
    const zoneH = cam.height / cam.zoom / 5;
    const midX = cam.scrollX + cam.width / 2;
    const midY = cam.scrollY + cam.height / 2;
    const gap = (target: number, mid: number, half: number) => (target < mid - half ? target - (mid - half) : target > mid + half ? target - (mid + half) : 0);
    const step = (d: number) => (d === 0 ? 0 : Math.sign(d) * Math.min(Math.abs(d), Math.max(1, Math.round(Math.abs(d) * 0.12))));
    cam.scrollX = Math.round(cam.scrollX + step(gap(p.x, midX, zoneW / 2)));
    cam.scrollY = Math.round(cam.scrollY + step(gap(p.y - 24, midY, zoneH / 2))); // centre on the body, not the feet
  }

  // ── Input ──

  private setupInput(): void {
    for (const b of this.objects.buildings) b.sprite.setInteractive({ pixelPerfect: true, useHandCursor: true });

    this.input.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (p.getDistance() > 8) return; // a drag, not a click
      const building = this.objects.buildings.find((b) => over.includes(b.sprite));
      if (building) return this.goToBuilding(building);
      const world = this.cameras.main.getWorldPoint(p.x, p.y);
      const { col, row } = screenToTile(world.x, world.y);
      this.goToTile({ col, row });
    });

    // WASD / arrow keys walk in screen directions; E or Space enters a door or sits on a bench.
    // No key capture, so typing in page inputs (chat, later) is never swallowed.
    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      up: kb.addKey(K.UP, false), down: kb.addKey(K.DOWN, false), left: kb.addKey(K.LEFT, false), right: kb.addKey(K.RIGHT, false),
      w: kb.addKey(K.W, false), a: kb.addKey(K.A, false), s: kb.addKey(K.S, false), d: kb.addKey(K.D, false),
      e: kb.addKey(K.E, false), space: kb.addKey(K.SPACE, false),
    };
    kb.on('keydown', (e: KeyboardEvent) => {
      if (typing()) return;
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) {
        this.pending = null;
        this.player.cancelPath(); // the keys take over from a click path
      }
      if (e.key.toLowerCase() === 'e' || e.key === ' ') this.interact();
    });

    // Wheel zooms in whole steps only (1×–4×), keeping pixels crisp.
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.zoomIndex = Phaser.Math.Clamp(this.zoomIndex + (dy < 0 ? 1 : -1), 0, ZOOMS.length - 1);
      this.cameras.main.setZoom(ZOOMS[this.zoomIndex]);
    });
  }

  /** The screen direction held on the keyboard, if any. */
  private heldDir(): Dir | null {
    if (typing()) return null;
    const k = this.keys;
    const h = (k.d.isDown || k.right.isDown ? 1 : 0) - (k.a.isDown || k.left.isDown ? 1 : 0);
    const v = (k.s.isDown || k.down.isDown ? 1 : 0) - (k.w.isDown || k.up.isDown ? 1 : 0);
    return DIR_FOR_KEYS[`${h},${v}`] ?? null;
  }

  /**
   * Next tile for keyboard walking. Up/down/left/right are diagonal grid steps: when one is blocked, slide along
   * the wall through either of its two halves. Pressing into a wall just turns the player.
   */
  private keyStep(): Tile | null {
    const dir = this.heldDir();
    if (!dir) return null;
    const from = this.player.tile;
    const [dc, dr] = DIR_STEP[dir];
    const tries: [number, number][] = [[dc, dr]];
    if (dc && dr) tries.push([dc, 0], [0, dr]);
    for (const [c, r] of tries) {
      const to = { col: from.col + c, row: from.row + r };
      if (this.grid.canStep(from, to)) {
        if (!this.byKeys) this.setBuildingAlert(null);
        this.byKeys = true;
        this.pending = null;
        return to;
      }
    }
    this.player.face(dir);
    return null;
  }

  /** E / Space: enter the door you're standing at, or sit on the bench you're in front of. */
  private interact(): void {
    if (this.player.isSitting) return this.player.standUp();
    const t = this.player.tile;
    const building = this.doorAt.get(`${t.col},${t.row}`);
    if (building) return this.enter(building);
    const bench = this.objects.benches.find((b) => {
      const spot = benchApproach(b);
      return spot.col === t.col && spot.row === t.row;
    });
    if (bench) this.player.sit({ col: bench.col, row: bench.row }, bench.faces, bench.depth);
  }

  /** Walk to a tile; a bench means sit on it; a blocked tile means the nearest reachable one. */
  goToTile(target: Tile): void {
    this.pending = null;
    this.byKeys = false;
    const bench = this.objects.benches.find((b) => b.col === target.col && b.row === target.row);
    if (bench) {
      const spot = benchApproach(bench);
      if (this.walkTo(spot)) this.pending = { sit: bench };
      return;
    }
    if (this.grid.walkable(target.col, target.row)) return void this.walkTo(target);
    const near = this.grid.nearestReachable(this.player.tile, target);
    if (near) this.walkTo(near);
  }

  /** Walk to the closest of a building's door tiles. */
  goToBuilding(b: Building): void {
    this.pending = null;
    this.byKeys = false;
    const from = this.player.tile;
    const paths = b.doors.map(([col, row]) => this.grid.findPath(from, { col, row })).filter((p): p is Tile[] => !!p);
    paths.sort((a, z) => a.length - z.length);
    if (!paths[0]) return;
    this.setBuildingAlert(null); // leaving the door we were at
    this.player.walk(paths[0]);
  }

  private walkTo(target: Tile): boolean {
    const path = this.grid.findPath(this.player.tile, target);
    if (!path) return false;
    this.setBuildingAlert(null); // leaving the door we were at
    this.player.walk(path);
    return true;
  }

  private arrived(tile: Tile): void {
    if (this.pending?.sit) {
      const b = this.pending.sit;
      this.pending = null;
      this.player.sit({ col: b.col, row: b.row }, b.faces, b.depth);
      return;
    }
    const building = this.doorAt.get(`${tile.col},${tile.row}`);
    this.setBuildingAlert(building ?? null);
    if (!building) return;
    if (!this.byKeys) return this.enter(building); // clicked the building: go in
    // Walked here with the keys: wait for E, so walking past a door never throws you inside.
    toast(`${DOOR_LABELS[building.id] ?? "🏠 twigo's room"} · press E to enter`);
  }

  /** Door hook: twigo's house goes back to twigo's room; the others are stubs for now. */
  private enter(b: Building): void {
    this.events.emit('door', b.id);
    if (b.id === 'twigos-house') {
      toast("🏠 Back to twigo's room…");
      this.time.delayedCall(700, () => location.assign(TWIGO_ROOM_URL));
      return;
    }
    toast(`${DOOR_LABELS[b.id] ?? b.id}: coming soon`);
  }

  /** fx-alert over a building while the player stands at its door. */
  private setBuildingAlert(b: Building | null): void {
    this.buildingAlert?.destroy();
    this.buildingAlert = null;
    const fx = this.M.fx.alert;
    if (!b || !fx?.file) return;
    const key = `anim:${fx.file}`;
    if (!this.anims.exists(key)) {
      this.anims.create({ key, frames: this.anims.generateFrameNumbers(fx.file, { start: 0, end: (fx.frames ?? 1) - 1 }), frameRate: fx.fps ?? 4, repeat: -1 });
    }
    const top = b.sprite.getBounds();
    this.buildingAlert = this.add.sprite(Math.round(top.centerX), Math.round(top.top - 2), fx.file).setOrigin(0.5, 1).setDepth(b.depth + 0.2);
    this.buildingAlert.play(key);
  }

  // ── Day / night ──

  private updateSky(force: boolean): void {
    const sky = skyAt(minutesNow());
    this.lampsOn = sky.lampsOn;
    this.objects.setLamps(sky.lampsOn);
    if (!force && sky.tint === this.tint) return;
    this.tint = sky.tint;
    const all = [...this.ground.sprites, ...this.objects.sprites, ...this.player.tintables];
    for (const s of all) s.setTint(sky.tint);
  }

  // ── For debugging and the headless check ──

  debugState() {
    const t = this.player.tile;
    const s = skyAt(minutesNow());
    return {
      tile: t,
      facing: this.player.facing,
      sitting: this.player.isSitting,
      anim: this.player.sprite.anims.currentAnim?.key.split(':').slice(2).join(':'),
      depth: this.player.sprite.depth,
      sky: { tint: s.tint.toString(16).padStart(6, '0'), stop: s.stop, lampsOn: s.lampsOn },
      zoom: this.cameras.main.zoom,
      scroll: { x: this.cameras.main.scrollX, y: this.cameras.main.scrollY },
      outfit: this.outfit,
      problems: [...assetProblems],
      fps: Math.round(this.game.loop.actualFps),
      drawn: this.culler.visibleCount,
      objects: this.children.list.length,
    };
  }

  debugTeleport(col: number, row: number, dir: Dir = 's'): void {
    this.setBuildingAlert(null);
    this.player.place({ col, row }, dir);
    this.cameras.main.centerOn(this.player.sprite.x, this.player.sprite.y);
  }

  debugSetTime(hhmm: string | null): void {
    if (!hhmm) setTimeSource(() => new Date());
    else {
      const [h, m] = hhmm.split(':').map(Number);
      setTimeSource(() => {
        const d = new Date();
        d.setHours(h, m, 0, 0);
        return d;
      });
    }
    this.updateSky(true);
  }

  /** Dress the player in a look, loading any layers it needs first. */
  setOutfit(o: Outfit): Promise<void> {
    const missing = outfitFiles(this.M.characters, o).filter((f) => !this.textures.exists(f));
    return new Promise((resolve) => {
      const done = () => {
        buildOutfit(this, this.M.characters, o);
        this.outfit = o;
        this.player.setOutfit(o);
        if (this.tint >= 0) this.player.sprite.setTint(this.tint);
        resolve();
      };
      if (!missing.length) return done();
      for (const f of missing) queueImage(this.load, this.textures, f);
      this.load.once(Phaser.Loader.Events.COMPLETE, done);
      this.load.start();
    });
  }

  get debugPlayer(): Character {
    return this.player;
  }

  get debugWorld() {
    return { objects: this.objects, grid: this.grid, map: this.map, tileToScreen };
  }
}

/** True while the user is typing into a page input, so movement keys stay with the input. */
function typing(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

/** Whole-number zoom that shows a comfortable slice of town for the window size. */
function defaultZoomIndex(w: number, h: number): number {
  const z = Math.max(1, Math.min(4, Math.floor(Math.min(w / 480, h / 360))));
  return ZOOMS.indexOf(z);
}

/** ?time=HH:MM pins the clock (testing the night cycle). */
function applyTimeOverride(): void {
  const t = new URLSearchParams(location.search).get('time');
  if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return;
  const [h, m] = t.split(':').map(Number);
  setTimeSource(() => {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  });
}

function exposeDebug(scene: TownScene): void {
  if (!import.meta.env.DEV && !new URLSearchParams(location.search).has('debug')) return;
  (window as unknown as { __town: unknown }).__town = {
    scene,
    state: () => scene.debugState(),
    teleport: (c: number, r: number, dir?: Dir) => scene.debugTeleport(c, r, dir),
    walk: (c: number, r: number) => scene.goToTile({ col: c, row: r }),
    building: (id: string) => {
      const b = scene.debugWorld.objects.buildings.find((x) => x.id === id);
      if (b) scene.goToBuilding(b);
    },
    time: (hhmm: string | null) => scene.debugSetTime(hhmm),
    outfit: (o: Partial<Outfit>) => scene.setOutfit({ ...scene.debugState().outfit, ...o }),
    emote: (a: 'wave' | 'cheer') => scene.debugPlayer.emote(a),
    /** Fixed view for screenshots: zoom and centre on a world point (follow off), or follow again. */
    view: (zoom?: number, x?: number, y?: number) => {
      const cam = scene.cameras.main;
      if (zoom) cam.setZoom(zoom);
      scene.follow = x === undefined;
      if (x !== undefined && y !== undefined) cam.centerOn(x, y);
    },
  };
}
