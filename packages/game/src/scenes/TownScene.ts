import Phaser from 'phaser';
import { queueImage, queueNpcs, queueTown } from '../assets/queue';
import type { Dir, Manifest, TownMap } from '../assets/types';
import { Character } from '../characters/character';
import { type Outfit, assetProblems, buildOutfit, headPortrait, headTop, loadOutfit, outfitFiles, randomOutfit, sheetKey } from '../characters/doll';
import { sanitize, startingOutfit } from '../characters/looks';
import type { MeResult } from '../session';
import { cursor } from '../ui/cursor';
import { BuildingLabel, UI_FONT } from '../ui/labels';
import { LOADING_LINES } from '../ui/loading-lines';
import { TownLink } from '../net/town';
import { showElsewhere, showKicked } from '../ui/elsewhere';
import { mountTownHud, setHudAvatar } from '../ui/townhud';
import { showParlor } from '../ui/parlor';
import { type HouseArt, composeHouse, houseFiles, houseStyles, tidyLook } from '../houses/art';
import { areaUrl, cameFrom, hoodAction, loadHood, saveHouse } from '../net/hood';
import { showHouseMenu } from '../ui/house-menu';
import { closeNpcDialog, setNpcDialogArt } from '../ui/npc-dialog';
import { race as currentRace, raceNow, setRace } from '../net/race';
import { setRacePortraits } from '../ui/race-bet';
import { mosangName } from '../ui/race-box';
import { NpcLife, TALK_LEAVE, TALK_RANGE } from '../world/npc-life';
import { mountHouseCreator } from '../ui/house-creator';
import { playBusted } from '../ui/casino';
import { drawBridge } from '../world/bridge';
import { playKalawang, playMasterKey } from '../world/bakod-fx';
import { puffHouse, riseHouse, sinkHouse } from '../world/house-rise';
import { ChatBox } from '../ui/chat';
import { StayReward } from '../ui/stay';
import { MegaphoneBanner } from '../ui/megaphone';
import { playTitleCard, titleCardMs } from '../ui/title-card';
import { SystemFeed } from '../ui/system-feed';
import { announce } from '../ui/announce';
import { OnlineList } from '../ui/online';
import { EMOTE_KEYS, emotePicker } from '../ui/emotes';
import type { ArenaServerMessage, HoodHouse, OutfitData, TitleData, TownClientMessage, TownEmote, TownHoodResponse, TownServerMessage } from '@mikazuki/shared';
import { type BubbleArt, lightBubble } from '../ui/labels';
import { type Reward, setRewardArt, showReward } from '../ui/reward';
import { showMovementTutorial } from '../ui/tutorial';
import { type Figure, showLeaderboard } from '../ui/leaderboard';
import { showJackpot } from '../ui/jackpot';
import { showBank } from '../ui/bank';
import { showOutpost } from '../ui/outpost';
import { showBoard } from '../ui/board';
import { showShop } from '../ui/shop';
import { TargetBox } from '../ui/target';
import { RARITY_TEXT, isRarity, setItemArt } from '../ui/item-art';
import { playDig, setDigPanelArt } from '../ui/dig-panel';
import { showMine } from '../ui/mine';
import { Inventory } from '../ui/inventory';
import { closeCasino, openCasino, setCasinoArt } from '../ui/casino';
import { fadeNavy } from '../ui/fade';
import { OtherPlayers } from '../world/others';
import { fakeLogin, loadMe } from '../session';
import { screenToTile, tileToScreen } from '../iso';
import { toast } from '../ui/toast';
import { GROUND_SHADOW_DEPTH, LABEL_DEPTH, frontDepth } from '../world/depth';
import { minutesNow, setTimeSource, skyAt } from '../world/daynight';
import { Culler } from '../world/cull';
import { rng } from '../world/rng';
import { type Tile, WalkGrid } from '../world/grid';
import { Ground } from '../world/ground';
import { outskirts } from '../world/outskirts';
import { NightLife } from '../world/night-life';
import { type ArenaChannel, BotChannel, PlayerChannel } from '../arena/channel';
import { showArenaMenu } from '../arena/menu';
import { stopQueue } from '../arena/queue';
import type { ArenaData } from './ArenaScene';
import { Minimap } from '../ui/minimap';
import { type Bench, type Building, WorldObjects, characterDepth } from '../world/objects';
import { enterArenaSound, enterCasinoSound, hearFrom, leaveCasinoSound, playSound, startTownSound } from '../audio/sound';

// The playable town: ground, buildings, props and the player, all placed from manifest.json + maps/town.json.
// Right click to walk; left click a building to walk to its door, or a bench to sit (a tap does all of these).

const ZOOMS = [2, 3, 4];
/** A large screen (px): small maps are padded with forest to fill at least this much at the farthest zoom. */
const BIG_SCREEN = [2560, 1440];
/** Arriving in town, the camera fades in from black, starting this close on the player and easing out to the
 *  middle zoom. */
const INTRO_ZOOM = 8;
const INTRO_MS = 1600;
/** The zoom-out lands this long before the title card is gone (as its letters swell open). */
const TITLE_LANDS_EARLY_MS = 500;
/** From a standstill, a direction key held shorter than this only turns the player. */
const TURN_HOLD_MS = 150;
const FADE_MS = 1100;
/** Dragging the map peeks around: it gives with resistance up to about this far (screen px), then snaps back. */
const PEEK_PX = 320;
const PEEK_BACK_MS = 220;

/** Everyone's title until they're given another (the bot's web/titles.ts has the list). */
const TOWNFOLK = { name: 'Townfolk', color: '#B794F6' }; // whole steps only; 1× showed too much of the town at once
const TWIGO_ROOM_URL = 'https://tw1go.github.io';

/** Each building's name (shown over it and in door messages). twigo's house leads back to twigo's room; the other
 *  doors are hooks to fill in later. */
const BUILDINGS: Record<string, string> = {
  'sari-sari-store': 'Sari-sari store',
  parlor: 'Parlor',
  bank: 'Bank',
  casino: 'Casino',
  'mine-entrance': 'Mine',
  'tanod-outpost': 'Tanod outpost',
  arena: 'Arena',
  'notice-board': 'Notice board',
  'leaderboard-monument': 'Leaderboard',
  'jackpot-booth': 'Jackpot booth',
  'twigos-house': "twigo's house",
};
/** Walking into (and out of) the casino: the camera's pan and zoom. */
const ENTER_MS = 700;
/** The server's Arena messages (a jack en poy match against another player). */
const isArena = (m: TownServerMessage): m is ArenaServerMessage => m.t.startsWith('arena-');
/** Dev: &rounds=win,lose,draw,win decides the bot's rounds in order. */
const devRounds = () =>
  (new URLSearchParams(location.search).get('rounds') ?? '').split(',').filter((r): r is 'win' | 'lose' | 'draw' => r === 'win' || r === 'lose' || r === 'draw');
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A win at least this big bursts coins over the winner in town. */
const BIG_WIN = 50;
const doorLabel = (id: string) => (id === 'twigos-house' ? "twigo's room" : (BUILDINGS[id] ?? id));

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
  private pending: { sit?: Bench; npc?: string } | null = null;
  private buildingAlert: Phaser.GameObjects.Sprite | null = null;
  private zoomIndex = 1;
  /** The arrival zoom-out while it runs (follow and label sizing wait for it). */
  private intro: Phaser.Tweens.Tween | null = null;
  /** In the casino (or walking in or out): the town takes no input, the camera doesn't follow, and the HUD hides. */
  private inside: { zoom: number } | null = null;
  private tint = -1;
  private nextSkyCheck = 0;
  private culler!: Culler;
  /** A Bakod went up round the yard you're standing in: its fence blocks walking once you're out (see bakodNews). */
  private fenceLater: { fence: NonNullable<TownMap['fence']>; yard: [number, number, number, number] } | null = null;
  private nightLife!: NightLife;
  private minimap: Minimap | null = null;
  private nextMinimap = 0;
  private lampsOn = false;
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd' | 'e' | 'space', Phaser.Input.Keyboard.Key>;
  /** Whether the current walk is keyboard-driven (doors then wait for E instead of entering on arrival). */
  private byKeys = false;
  /** The camera glides after the player (off while debugging a fixed view). */
  follow = true;
  /** Where the last press started, any button (Phaser's own down/up positions only follow the left button). */
  private pressAt = { x: 0, y: 0 };
  /** A drag on the map peeking around (the camera stops following till it has snapped back). */
  private peek: { x: number; y: number; scrollX: number; scrollY: number; dragging: boolean; back: Phaser.Tweens.Tween | null } | null = null;

  constructor() {
    super('town');
  }

  private me: MeResult | null = null;
  private readonly buildingLabels = new Map<string, BuildingLabel>();
  private hovered: Building | null = null;
  private marker: Phaser.GameObjects.Sprite | null = null;
  /** Keyboard walking: the held direction, since when, and whether the keys have us walking already. */
  private keyDir: Dir | null = null;
  private keySince = 0;
  private keyWalking = false;
  /** Plays an emote and tells the server (set once connected). */
  private emoteKeys: ((e: TownEmote) => void) | null = null;
  private others!: OtherPlayers;
  /** The town's ambient NPCs (not in the neighbourhood). */
  private npcs: NpcLife | null = null;
  private link: TownLink | null = null;
  /** The picked player's box and menu (members only). */
  private target: TargetBox | null = null;
  /** What the server last heard about the player (face / sit / stand are sent when these change). */
  private sent = { dir: '' as string, sit: false };
  private alertFor: Building | null = null;
  private labelZoom = 0;

  /** Straight from the character creator: a member's first time in town (the movement tutorial shows). */
  private firstVisit = false;
  /** In the neighbourhood (?area=hood): its houses, and the art they're drawn from. */
  private hood: TownHoodResponse | null = null;
  private art: HouseArt | null = null;
  /** Gate tiles (town.json / the neighbourhood's `gates`): walking onto one goes to that area. */
  private gateAt = new Map<string, 'hood' | 'town'>();
  private bridge: Phaser.GameObjects.Image | null = null;
  /** The gates' signs (always shown, unlike the buildings' names). */
  private readonly gateLabels: BuildingLabel[] = [];
  /** Each gate sign, where it sits, and the buildings it was lifted over: while one of them shows its name (in the same
   *  spot), the sign steps aside. */
  private readonly gateSpots: { sign: BuildingLabel; y: number; over: Set<string> }[] = [];
  /** Each house's texture, redrawn after a new look (the key changes so the sprite picks it up). */
  private houseKeys = 0;
  /** Straight from building your house: it rises on its lot as you arrive. */
  private justBuilt = false;

  init(data: { manifest: Manifest; town: TownMap; me: MeResult | null; firstVisit?: boolean; hood?: TownHoodResponse; art?: HouseArt; built?: boolean }): void {
    this.firstVisit = !!data.firstVisit;
    this.justBuilt = !!data.built;
    this.M = data.manifest;
    this.map = data.town;
    this.me = data.me;
    this.hood = data.hood ?? null;
    this.art = data.art ?? null;
    this.outfit = startingOutfit(this.M.characters, data.me);
  }

  preload(): void {
    // (The page's login corner is hidden: the loading screen is just the moon and the bar; the town's HUD follows.)
    document.getElementById('hud')?.setAttribute('hidden', '');
    this.load.setPath(`${import.meta.env.BASE_URL}assets/`);
    // The neighbourhood's houses are drawn from their layers (composited in create).
    if (this.hood && this.art) for (const st of houseStyles(this.art)) for (const f of houseFiles(this.art, st)) queueImage(this.load, this.textures, f);
    queueTown(this.load, this.textures, this.M, this.map);
    if (!this.hood) queueNpcs(this.load, this.textures, this.M);
    for (const f of outfitFiles(this.M.characters, this.outfit)) queueImage(this.load, this.textures, f);
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => assetProblems.add(`failed to load ${file.src}`));
    // (After the character creator the town has usually loaded in the background already.)
    if (this.load.list.size) this.showLoading();
  }

  /** While the town's art downloads: the loading moon over a bar, and a witty line or some trivia under it that
   *  changes every few seconds. No file counts. */
  private showLoading(): void {
    const { width, height } = this.scale;
    const scale = width >= 960 && height >= 600 ? 3 : 2; // whole-number pixels, like the town's zoom
    const w = Math.min(320, width - 64);
    const x = Math.round((width - w) / 2);
    const y = Math.round(height / 2 + 24);
    const parts: Phaser.GameObjects.GameObject[] = [];

    const m = this.M.ui.loadingMoon;
    if (m && this.textures.exists(m.file)) {
      const [from, to] = m.loopFrames ?? [0, m.frames - 1];
      const key = `anim:${m.file}`;
      if (!this.anims.exists(key)) {
        // Forwards, then back again (rewinding), so the loop never jumps.
        this.anims.create({ key, frames: this.anims.generateFrameNumbers(m.file, { start: from, end: to }), frameRate: m.fps, repeat: -1, yoyo: true });
      }
      const moon = this.add.sprite(width / 2, y - 12, m.file, from).setOrigin(m.anchor[0] / m.size[0], m.anchor[1] / m.size[1]);
      parts.push(moon.setScale(scale).setScrollFactor(0).play(key));
    }

    const frame = this.add.graphics().setScrollFactor(0);
    frame.lineStyle(2, 0x7c2ae8).strokeRect(x - 2, y - 2, w + 4, 12);
    const bar = this.add.graphics().setScrollFactor(0);
    const line = this.add
      .text(width / 2, y + 28, '', { fontFamily: UI_FONT, fontSize: '15px', color: '#a9b1d6', align: 'center', wordWrap: { width: Math.min(440, width - 48) } })
      .setOrigin(0.5, 0)
      .setScrollFactor(0);
    parts.push(frame, bar, line);

    // A line at random, then the next one after a while (never the same twice in a row).
    let last = -1;
    const next = () => {
      let i = Math.floor(Math.random() * LOADING_LINES.length);
      if (i === last) i = (i + 1) % LOADING_LINES.length;
      last = i;
      line.setText(LOADING_LINES[i]).setAlpha(0);
      this.tweens.add({ targets: line, alpha: 1, duration: 300 });
    };
    next();
    const rotate = this.time.addEvent({ delay: 4500, loop: true, callback: next });

    const progress = (p: number) => bar.clear().fillStyle(0xa3e635).fillRect(x, y, Math.round(w * p), 8);
    this.load.on(Phaser.Loader.Events.PROGRESS, progress);
    // Only for the first load: later ones (a new outfit's layers) would update a destroyed bar.
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.load.off(Phaser.Loader.Events.PROGRESS, progress);
      rotate.remove();
      parts.forEach((g) => g.destroy());
    });
  }

  create(): void {
    applyTimeOverride();
    buildOutfit(this, this.M.characters, this.outfit);
    if (this.hood) this.addHouses();
    this.objects = new WorldObjects(this, this.M, this.map);
    if (this.map.bridge) this.bridge = drawBridge(this, this.map.bridge);
    for (const [to, tiles] of Object.entries(this.map.gates ?? {}) as ['hood' | 'town', [number, number][]][]) for (const [c, r] of tiles) this.gateAt.set(`${c},${r}`, to);
    // The forest around the town fills what the camera can see past the map, without widening that view.
    const bounds = this.townBounds();
    const forest = outskirts(this.M, this.map, bounds);
    this.ground = new Ground(this, this.M, this.map, forest.tiles);
    this.objects.addOutskirts(forest.objects);
    this.nightLife = new NightLife(this, this.M, this.map, this.objects.lamps);
    this.grid = new WalkGrid(this.map);
    for (const b of this.objects.buildings) for (const [c, r] of b.doors) this.doorAt.set(`${c},${r}`, b);

    const [sc, sr] = this.map.spawn;
    this.player = new Character(this, this.M, this.outfit, { col: sc, row: sr });
    this.player.depthFn = (c, r, d, b) => characterDepth(this.objects, c, r, d, b);
    this.player.onArrive = (tile) => this.arrived(tile);
    this.player.nextStep = () => this.keyStep();
    this.player.onSpawn = (obj) => this.tint >= 0 && obj.setTint(this.tint);
    // Back through a gate: at its way in (town.json `arrive`), facing into the area, not the spawn point.
    const from = cameFrom();
    const arrive = from ? this.map.arrive?.[from] : undefined;
    if (arrive) this.player.place({ col: arrive[0], row: arrive[1] }, 'nw');
    // A fresh visit to the neighbourhood with a house there: at your door, facing the street.
    const mine = !from && this.hood?.houses.find((h) => h.mine);
    const door = mine && this.map.doors[`house-${mine.lot}`];
    if (door && !Array.isArray(door[0])) this.player.place({ col: door[0] as number, row: door[1] as number }, 'se');
    this.others = new OtherPlayers(this, this.M, this.objects, (obj) => this.tint >= 0 && obj.setTint(this.tint));
    if (!this.hood) this.npcs = this.makeNpcs();
    // The race box's bet pop-up shows the runners' portraits wherever you are (the neighbourhood too, which has no NPCs).
    const P = this.M.npcs?.portrait;
    if (P) setRacePortraits((id) => `${import.meta.env.BASE_URL}assets/${P.file.replace('{id}', id)}`);

    this.setupCamera(bounds);
    // Only what the camera can see is drawn and animated.
    this.culler = new Culler([...this.ground.cullable, ...this.objects.cullable]);
    this.culler.onShow = (img) => this.ground.refresh(img);
    this.culler.update(this.cameras.main.worldView);
    this.setupInput();
    this.updateSky(true);
    for (const b of this.objects.buildings) {
      const house = this.houseFor(b.id);
      const name = house ? (house.mine ? 'Your house' : `${house.owner}'s house`) : BUILDINGS[b.id];
      if (name) this.buildingLabels.set(b.id, new BuildingLabel(this, name, b.top.x));
    }
    this.gateSigns();
    // Your house, just built: hidden in the ground until the arrival has settled, then it rises.
    const built = this.justBuilt ? this.hood?.houses.find((h) => h.mine) : null;
    const yours = built && this.objects.buildings.find((b) => b.id === `house-${built.lot}`);
    if (yours) {
      sinkHouse(yours);
      this.time.delayedCall(titleCardMs() + 300, () => void riseHouse(this.fx(), yours)); // once the title card has opened
    }
    // Members show their nickname and title; without a login (login off, or the dev server) it's "Guest".
    const member = this.me?.status === 'ok' ? this.me.me : null;
    this.player.setNameTag(member?.nickname ?? 'Guest', member?.title ?? TOWNFOLK);
    this.player.setJailed(member?.status === 'jailed');
    this.mountHud();
    this.minimap = new Minimap(this.map); // in the HUD's corner, above its buttons
    startTownSound(this, this.fountainTile());
    if (member || fakeLogin()) this.connect();
    this.zoomIntro(); // last, once the names, labels and building cursors exist
    this.time.delayedCall(1800, () => this.announceRewards()); // once the arrival has settled
    exposeDebug(this);
    // Dev: ?arena=bot goes straight into a match against the bot (with &rounds=win,lose,draw… deciding the rounds);
    // ?arena=menu opens the arena's menu.
    const arenaFlag = new URLSearchParams(location.search).get('arena');
    const arenaB = this.objects.buildings.find((b) => b.id === 'arena');
    if (arenaFlag && arenaB) this.time.delayedCall(2600, () => (arenaFlag === 'bot' ? this.enterArena(arenaB, new BotChannel(this.M.characters, Date.now(), devRounds())) : this.openArena(arenaB)));
    if (assetProblems.size) console.warn('[town] asset problems:\n' + [...assetProblems].join('\n'));
  }

  update(time: number, delta: number): void {
    const zoom = this.cameras.main.zoom;
    if (zoom !== this.labelZoom && !this.intro && !this.inside) this.sizeForZoom(zoom);
    this.ground.tick(time);
    this.player.update(delta);
    if (this.fenceLater) {
      const { col, row } = this.player.tile;
      const [c0, r0, c1, r1] = this.fenceLater.yard;
      if (col < c0 || col > c1 || row < r0 || row > r1) {
        this.grid.setFence(this.fenceLater.fence);
        this.fenceLater = null;
      }
    }
    this.others.update(delta);
    this.raceNews();
    if (this.npcs) {
      const me = this.player.tile;
      this.npcs.update(delta, [me, ...this.others.players.map((p) => ({ col: p.col, row: p.row }))]);
      // Walked away from the NPC you're talking to: the box closes.
      const with_ = this.npcs.talkingTo;
      const at = with_ && this.npcs.tileOf(with_);
      if (at && Math.max(Math.abs(at.col - me.col), Math.abs(at.row - me.row)) > TALK_LEAVE) closeNpcDialog();
    }
    hearFrom(this.player.tile);
    this.tellServer();
    if (this.follow && !this.intro && !this.inside && !this.peek) this.followPlayer();
    this.culler.update(this.cameras.main.worldView);
    this.objects.setLamps(this.lampsOn, time); // glows follow their lamp's visibility; faulty lamps act up
    this.nightLife.update(time, this.lampsOn, this.cameras.main.worldView); // fireflies and moths, from dusk to dawn
    if (this.minimap && time >= this.nextMinimap) {
      this.nextMinimap = time + 250;
      const v = this.cameras.main.worldView;
      this.minimap.draw({ me: this.player.tile, others: this.others.players, camera: { x: v.x, y: v.y, width: v.width, height: v.height } });
    }
    if (time >= this.nextSkyCheck) {
      this.nextSkyCheck = time + 1000;
      this.updateSky(false);
    }
  }

  /** Text is drawn at the zoom it's seen at, so it stays sharp; the cursor is scaled like the world. */
  private sizeForZoom(zoom: number): void {
    this.labelZoom = zoom;
    this.player.setZoom(zoom);
    this.others.setZoom(zoom);
    this.npcs?.setZoom(zoom);
    for (const l of [...this.buildingLabels.values(), ...this.gateLabels]) l.setZoom(zoom);
    this.input.setDefaultCursor(cursor('pointer', zoom));
    for (const b of [...this.objects.buildings.flatMap((x) => x.parts), ...this.objects.benches.map((x) => x.sprite)]) if (b.input) b.input.cursor = cursor('hand', zoom);
    this.others.cursor = cursor('hand', zoom);
    if (this.npcs) this.npcs.cursor = cursor('hand', zoom);
  }

  /** The town's HUD: your head and name top left (in the game's frame), Kowens and shovels top right. */
  private mountHud(): void {
    const member = this.me?.status === 'ok' ? this.me.me : null;
    const asset = (file: string) => `${import.meta.env.BASE_URL}assets/${file}`;
    const frame = this.M.ui.inventory?.itemFrame;
    const emotes = this.M.ui.emotes;
    const dots = this.M.ui.statusDots;
    const kowen = Array.isArray(emotes?.frames) ? emotes.frames.indexOf('kowen') : -1;
    const coin = emotes?.file && kowen >= 0 && Array.isArray(emotes.frames) ? { url: asset(emotes.file), frame: kowen, size: emotes.size?.[0] ?? 12, frames: emotes.frames.length } : null;
    setRewardArt({ frame: frame ? { url: asset(frame.file), slice: frame.nineSlice } : null, coin });
    setItemArt(this.M.items, asset(''));
    const D = this.M.ui.digPanel;
    setDigPanelArt(D && this.textures.exists(D.file) ? { url: asset(D.file), size: D.size, frames: D.frames, fps: D.fps, hole: D.hole, itemFrom: D.itemFrom } : null);
    // Kara y Krus: whichever casino art exists (the table draws stand-ins for the rest).
    const U = this.M.ui;
    const strip = (fx: { file?: string; frame?: [number, number]; frames?: number; fps?: number } | undefined) =>
      fx?.file && fx.frame ? { url: asset(fx.file), w: fx.frame[0], h: fx.frame[1], frames: fx.frames ?? 1, fps: fx.fps ?? 10 } : undefined;
    const F = U.coinFlip;
    const flip = (file: string) => F && { url: asset(file), w: F.size[0], h: F.size[1], frames: F.frames, fps: F.fps };
    setCasinoArt({
      ...(F ? { flips: { kara: flip(F.sides.kara)!, krus: flip(F.sides.krus)! } } : {}),
      siren: strip(this.M.fx.siren),
      burst: strip(this.M.fx['coin-burst']),
      ...(U.tanodBust ? { tanod: { url: asset(U.tanodBust.file), w: U.tanodBust.size[0], h: U.tanodBust.size[1], frames: U.tanodBust.frames, fps: U.tanodBust.fps } } : {}),
      ...(U.casinoFelt ? { felt: { url: asset(U.casinoFelt.file), slice: U.casinoFelt.nineSlice } } : {}),
    });
    mountTownHud({
      me: member,
      name: member?.nickname ?? 'Guest',
      avatar: headPortrait(this, this.M.characters, this.outfit),
      frame: frame ? { url: asset(frame.file), slice: frame.nineSlice } : null,
      coin,
      dots: dots?.file && Array.isArray(dots.frames) ? { url: asset(dots.file), frame: 0, size: dots.size?.[0] ?? 5, frames: dots.frames.length, names: dots.frames } : null,
      shovel: this.M.ui.shovelIcon?.file ? asset(this.M.ui.shovelIcon.file) : null,
      gear: this.M.ui.settingsIcon?.file ? asset(this.M.ui.settingsIcon.file) : null,
      megaphone: this.M.ui.newsIcon?.file ? asset(this.M.ui.newsIcon.file) : null,
      guide: this.M.ui.tutorialIcon?.file ? asset(this.M.ui.tutorialIcon.file) : null,
      ticket: this.M.ui.jackpotIcon?.file ? asset(this.M.ui.jackpotIcon.file) : null,
    });
  }

  /** The middle of the plaza fountain (the map's fountain prop), where its water sound is loudest. */
  private fountainTile(): Tile | null {
    const f = this.map.objects.find((o) => o.kind === 'prop' && o.id.startsWith('fountain'));
    return f ? { col: f.col + (f.footprint[0] - 1) / 2, row: f.row + (f.footprint[1] - 1) / 2 } : null;
  }

  /** On arriving: the movement tutorial on a first visit, then rewards — a title the bot says is new to you (shown once, on whichever device comes
   *  first; the bot is told when it's been seen). In dev, ?reward= shows a demo. */
  private announceRewards(): void {
    // First time in town: how to move (before any reward). Dev: ?tutorial=1.
    if (this.firstVisit || (import.meta.env.DEV && new URLSearchParams(location.search).has('tutorial'))) void showMovementTutorial();
    const member = this.me?.status === 'ok' ? this.me.me : null;
    if (member?.newTitle) showNewTitle(member.newTitle.id, member.newTitle, member.title);
    // The welcome gift; straight from the creator it was only just given, so /me is asked again.
    if (member?.welcomeGift) showWelcomeGift(member.welcomeGift);
    else if (member && this.firstVisit) void loadMe(true).then((m) => m.status === 'ok' && m.me.welcomeGift && showWelcomeGift(m.me.welcomeGift));
    if (import.meta.env.DEV) {
      const demo = new URLSearchParams(location.search).get('reward');
      if (demo === 'kowens') void showReward({ title: 'Reward', graphic: { kind: 'kowens', amount: 50 }, message: 'Congratulations! 50 Kowens are yours.' });
      if (demo === 'title') void showReward({ title: 'New title!', graphic: { kind: 'title', title: { name: 'Game Master', color: 'prismatic' } }, message: 'Congratulations! You are now known as <Game Master>.' });
    }
  }

  /** A character for the leaderboard podium: their look idling (built like any player's), or a base look as the
   *  silhouette for someone without a character. */
  private async podiumFigure(o: OutfitData | null): Promise<Figure | null> {
    const C = this.M.characters;
    const look = sanitize(C, o, randomOutfit(C, rng(o ? Math.floor(Math.random() * 2 ** 31) : 7)));
    await loadOutfit(this, C, look);
    const key = sheetKey(look, 'idle', 's');
    if (!this.textures.exists(key)) return null;
    const idle = C.animations.idle;
    return { sheet: this.textures.get(key).getSourceImage() as HTMLCanvasElement, frames: idle.frames, fps: idle.fps || 1, cell: C.cell, mystery: !o };
  }

  /** Debug: show a reward pop-up. */
  debugReward(r: Reward): Promise<void> {
    return showReward(r);
  }

  // ── Other players ──

  /** Joins the live town: others appear, the player's steps, turns and seats are passed on, and the chat opens. */
  private connect(): void {
    const link = new TownLink(this.outfit, this.hood ? 'hood' : 'town');
    this.link = link;
    const B = this.M.ui.speechBubble;
    const bubbles: BubbleArt | null = B && this.textures.exists(B.file) ? lightBubble(this, { file: B.file, slice: B.nineSlice, tail: B.tail, tailAnchor: B.tailAnchor }) : null;
    this.others.bubbleArt = bubbles;
    const E = this.M.ui.emotes;
    const sheet = E?.file && Array.isArray(E.frames) ? { url: `${import.meta.env.BASE_URL}assets/${E.file}`, size: E.size?.[0] ?? 12, names: E.frames } : null;
    const emote = (e: TownEmote) => {
      this.playEmote(this.player, e); // right away here; the others see it via the server
      link.send({ t: 'emote', emote: e });
    };
    this.emoteKeys = emote;
    const member = this.me?.status === 'ok' ? this.me.me : null;
    // Beside the chat input: who's online, and the emote picker.
    const D = this.M.ui.statusDots;
    const online = new OnlineList(D?.file && Array.isArray(D.frames) ? { url: `${import.meta.env.BASE_URL}assets/${D.file}`, size: D.size?.[0] ?? 5, frame: Math.max(0, D.frames.indexOf('online')), frames: D.frames.length } : null);
    const me = { name: member?.nickname ?? 'Guest', title: member?.title ?? TOWNFOLK, me: true };
    // Members can pick other players (left click) for the player menu: give Kowens, balance, status, diss/praise/judge.
    const itemFrame = this.M.ui.inventory?.itemFrame;
    const frame = itemFrame ? { url: `${import.meta.env.BASE_URL}assets/${itemFrame.file}`, slice: itemFrame.nineSlice } : null;
    if (member) this.target = new TargetBox(frame, (kind, judged, text) => verdict(myId, kind, judged, text));
    this.others.onChange = () => {
      online.update([me, ...this.others.players.map((p) => ({ name: p.nickname, title: p.title }))]);
      this.target?.check((id) => this.others.has(id));
    };
    this.others.onChange();
    const tools = document.createElement('div');
    tools.className = 'ch-tools';
    // Members get the bag (inventory) button.
    const bagIcon = this.M.ui.inventoryIcon;
    const inv = this.M.ui.inventory;
    const url = (file: string) => `${import.meta.env.BASE_URL}assets/${file}`;
    const bag = member
      ? new Inventory(
          bagIcon ? url(bagIcon.file) : null,
          inv?.itemFrame ? { url: url(inv.itemFrame.file), slice: inv.itemFrame.nineSlice } : null,
          inv?.slot && inv.selected && inv.nineSlice ? { url: url(inv.slot), picked: url(inv.selected), slice: inv.nineSlice } : null,
        )
      : null;
    tools.append(online.el, emotePicker(sheet, emote));
    if (bag) document.body.append(bag.button); // its own button, just right of the chat box
    const chat = new ChatBox((text, megaphone) => link.send({ t: 'say', text, ...(megaphone ? { megaphone } : {}) }), tools);
    // Megaphone messages run across the screen (with the megaphone's art, if it's there).
    const megaphone = this.banner();
    // Members can click someone's name in the chat: the player menu opens beside it (if they're still in town).
    const target = this.target;
    if (target) {
      chat.onName = ({ id, name }, anchor) => {
        const p = this.others.players.find((o) => (id ? o.id === id : o.nickname === name));
        if (p) target.selectAt(p, anchor);
        else chat.notice(`${name} isn't in town right now.`);
      };
    }
    const feed = new SystemFeed();
    // Members earn a Kowen for every 15 minutes in town (claimed from a pop-up above the feed).
    const stay = member ? new StayReward() : null;
    let myId = '';
    let arrived = false;
    /** Someone (maybe you) says a diss, praise or judge line: a speech bubble and a tagged line in the chat. */
    const verdict = (id: string, kind: 'roast' | 'praise', judged: boolean, text: string) => {
      const mine = id === myId;
      const char = mine ? this.player : this.others.charOf(id);
      if (char && bubbles) char.say(text, bubbles);
      chat.verdict(mine ? (member?.nickname ?? 'You') : (this.others.nameOf(id) ?? 'Someone'), kind, judged, text, mine ? undefined : id);
      if (!mine) playSound('chat');
    };
    this.player.onStep = (to) => {
      link.send({ t: 'step', col: to.col, row: to.row });
      this.sent = { dir: this.player.facing, sit: false };
    };
    link.onMessage = (m) => {
      if (isArena(m)) return void this.arenaChannel?.push(m); // a jack en poy match (or the queue for one)
      if (m.t === 'snap') return this.player.place({ col: m.col, row: m.row });
      if (m.t === 'seat-taken') return this.seatTaken();
      if (m.t === 'say-refused') {
        if (m.reason === 'muted') {
          const left = Math.max(1, Math.ceil(((m.until ?? Date.now()) - Date.now()) / 60_000));
          return chat.notice(`You're muted in town chat for about ${left} more minute${left === 1 ? '' : 's'}.`);
        }
        if (m.reason === 'megaphone') return chat.notice('You have no megaphones. Get one at the sari-sari store (1 Kowen), or /g for general chat.');
        return chat.notice(m.reason === 'slow' ? "You're chatting a bit fast. Wait a moment." : "That message can't be sent.");
      }
      if (m.t === 'say') {
        // Your own words come back from the server like everyone else's, so you see what they see.
        const name = m.id === myId ? (member?.nickname ?? 'You') : (this.others.nameOf(m.id) ?? m.name ?? 'Someone');
        if (m.megaphone) megaphone.show(name, m.text);
        if (m.id === myId) {
          if (bubbles) this.player.say(m.text, bubbles);
          if (m.megaphone) window.dispatchEvent(new Event('mk-wallet')); // one megaphone fewer in the bag
          return chat.add(name, m.text, 'me', undefined, m.megaphone); // (your own words make no sound)
        }
        chat.add(name, m.text, 'town', m.id, m.megaphone);
        playSound('chat');
      }
      if (m.t === 'say-discord') {
        playSound('chat');
        return chat.add(m.name, m.text, 'discord');
      }
      if (m.t === 'system') {
        if (m.line.kind === 'gamble') playSound('chip');
        // A bet: a big win bursts coins over the winner; a bust puts a siren over them (stand-ins until the art exists).
        if (m.line.kind === 'gamble' && m.line.playerId) {
          const char = m.line.playerId === myId ? this.player : this.others.charOf(m.line.playerId);
          if (m.line.tone === 'win' && (m.line.amount ?? 0) >= BIG_WIN) char?.flash('coin-burst', 'coin-sparkle', 3);
          if (m.line.tone === 'bust') char?.flash('siren', 'alert', 8);
        }
        // A dig: yours plays the dig panel; someone else's puffs dust at the Mine's door.
        if (m.line.kind === 'dig' && m.line.itemId) {
          if (myId && m.line.playerId === myId) playDig({ itemId: m.line.itemId, name: m.line.itemName ?? m.line.itemId, rarity: m.line.tone });
          else this.mineDust();
        }
        return feed.add(m.line);
      }
      if (m.t === 'announce') return announce(m.announcement);
      if (m.t === 'verdict') return verdict(m.id, m.kind, m.judged, m.text);
      if (m.t === 'flex') {
        // A flex from someone's bag (maybe yours): they show it off in a bubble, and the chat says so.
        const mine = m.id === myId;
        const char = mine ? this.player : this.others.charOf(m.id);
        if (char && bubbles) char.say(`Check out my ${m.itemName}!`, bubbles);
        chat.flex(mine ? (member?.nickname ?? 'You') : (this.others.nameOf(m.id) ?? 'Someone'), m.itemName, m.rarity, RARITY_TEXT[isRarity(m.rarity) ? m.rarity : 'common'], mine ? undefined : m.id);
        if (!mine) playSound('chat');
        return;
      }
      if (m.t === 'new-title') return showNewTitle(m.id, m.title, member?.title ?? TOWNFOLK);
      if (m.t === 'house') return this.houseNews(m);
      if (m.t === 'race') return setRace(m.race);
      if (m.t === 'look' && m.id === myId) return void this.restyle(sanitize(this.M.characters, m.outfit, this.outfit), m.title);
      if (m.t === 'jailed' && m.id === myId) {
        this.player.setJailed(m.on);
        if (this.hood) this.hood.me.jailed = m.on; // the house menu (it asks again when it opens, too)
        window.dispatchEvent(new Event('mk-wallet')); // the HUD (its status dot shows jail too)
        return;
      }
      // Kowens changed elsewhere (Discord…). Not mid-bet at the casino: its coin lands first, then it reloads the HUD.
      if (m.t === 'stay') return void stay?.set(m.stay);
      if (m.t === 'wallet') return void (document.body.classList.contains('cz-betting') || window.dispatchEvent(new Event('mk-wallet')));
      if (m.t === 'gift') {
        window.dispatchEvent(new Event('mk-wallet')); // the HUD's Kowens
        return void showReward({ title: 'Gift', graphic: { kind: 'kowens', amount: m.amount }, message: `${m.from} gave you ${m.amount} ${m.amount === 1 ? 'Kowen' : 'Kowens'}!` });
      }
      if (m.t === 'gift-item') {
        window.dispatchEvent(new Event('mk-wallet')); // the HUD (a gifted shovel) and an open bag
        const rarity = isRarity(m.item.rarity) ? m.item.rarity : 'common';
        const what = m.quantity > 1 ? `${m.quantity}× ${m.item.name}` : `a ${m.item.name}`;
        return void showReward({ title: 'Gift', graphic: { kind: 'item', id: m.item.id, name: m.item.name, rarity }, message: `${m.from} gave you ${what}!` });
      }
      if (m.t === 'emote') {
        const char = this.others.charOf(m.id);
        if (char) this.playEmote(char, m.emote);
        return;
      }
      if (m.t === 'welcome') {
        myId = m.you;
        // A reconnect (the bot restarted, a blip): what's on screen stays; only what's new is added.
        chat.history(m.recent ?? [], member?.nickname ?? null, arrived);
        feed.history(m.system ?? [], arrived);
        if (m.notice && !arrived) announce(m.notice); // a notice still current when you arrive
        // Arriving: go to the free tile the server picked (so people don't land on each other), unless you've
        // already walked off or this is a reconnect, in which case you stay where you are ('here' below).
        const [sc, sr] = this.map.spawn;
        const at = this.player.tile;
        if (!arrived && m.spawn && at.col === sc && at.row === sr && this.player.isIdle) {
          this.player.place({ col: m.spawn[0], row: m.spawn[1] });
          this.cameras.main.centerOn(this.player.sprite.x, this.player.sprite.y - 24);
        }
        if (!arrived) chat.system(`Welcome to Mikazuki town${member ? `, ${member.nickname}` : ''}! Be kind and respectful in chat: everyone here is a neighbour.`);
        arrived = true;
        // After a reconnect, stay where you are rather than back at the spawn point.
        const t = this.player.tile;
        link.send({ t: 'here', col: t.col, row: t.row, dir: this.player.facing });
        this.sent = { dir: this.player.facing, sit: false };
      }
      this.others.handle(m);
    };
    link.onStatus = (up) => reconnecting(!up);
    link.onKicked = (until) => {
      playSound('error');
      this.others.clear();
      showKicked(until);
    };
    link.onTakenOver = () => {
      this.others.clear();
      showElsewhere(() => link.reconnect());
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => link.close());
  }

  /** An emote on a character: its icon over the head, and for laugh and wave, the cheer or wave animation too. */
  private playEmote(char: Character, e: TownEmote): void {
    const E = this.M.ui.emotes;
    const frame = Array.isArray(E?.frames) ? E.frames.indexOf(e) : -1;
    if (E?.file && frame >= 0 && this.textures.exists(E.file)) char.showEmote(E.file, frame);
    playSound('emote');
    if (e === 'laugh') char.emote('cheer');
    if (e === 'wave') char.emote('wave');
  }

  /** Turning on the spot, sitting down and standing up (steps go out as they start; see connect). */
  private tellServer(): void {
    const link = this.link;
    if (!link) return;
    const p = this.player;
    if (p.isSitting && !this.sent.sit) {
      const t = p.tile;
      link.send({ t: 'sit', col: t.col, row: t.row, dir: p.facing });
      this.sent = { dir: p.facing, sit: true };
    } else if (!p.isSitting && this.sent.sit) {
      link.send({ t: 'stand' });
      this.sent.sit = false;
    } else if (!p.isSitting && p.facing !== this.sent.dir && p.isIdle) {
      link.send({ t: 'face', dir: p.facing });
      this.sent.dir = p.facing;
    }
  }

  // ── Camera ──

  /** The town's pixel extent: the tile diamond, grown to include anything that sticks out (tall trees, roofs). */
  private townBounds(): Phaser.Geom.Rectangle {
    const [cols, rows] = this.map.size;
    const bounds = new Phaser.Geom.Rectangle(-rows * 16, 0, (cols + rows) * 16, (cols + rows) * 8);
    for (const s of this.objects.sprites) Phaser.Geom.Rectangle.Union(bounds, s.getBounds(), bounds);
    // A small map (the neighbourhood) on a big window: the camera would see past its bounds, where no forest was grown.
    // Pad them (centred) to the most the camera can show, at the farthest zoom on a large screen.
    const w = Math.max(this.scale.width, BIG_SCREEN[0]) / ZOOMS[0];
    const h = Math.max(this.scale.height, BIG_SCREEN[1]) / ZOOMS[0];
    if (bounds.width < w) bounds.setTo(bounds.centerX - w / 2, bounds.y, w, bounds.height);
    if (bounds.height < h) bounds.setTo(bounds.x, bounds.centerY - h / 2, bounds.width, h);
    return bounds;
  }

  private setupCamera(bounds: Phaser.Geom.Rectangle): void {
    const cam = this.cameras.main;
    cam.setBounds(Math.floor(bounds.x), Math.floor(bounds.y), Math.ceil(bounds.width), Math.ceil(bounds.height));
    cam.roundPixels = true;
    this.zoomIndex = defaultZoomIndex(this.scale.width, this.scale.height);
    cam.setZoom(ZOOMS[this.zoomIndex]);
    cam.centerOn(this.player.sprite.x, this.player.sprite.y);
  }

  /** Arriving: fade in from black, starting close on the player and easing out to the chosen zoom (skipped with
   *  reduced motion). */
  private zoomIntro(): void {
    // The title card over it all: the area's name, the world pulling back inside the letters (ui/title-card.ts).
    void playTitleCard(this.hood ? 'Neighbourhood' : 'Mikazuki');
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cam = this.cameras.main;
    const p = this.player.sprite;
    const centre = () => cam.centerOn(p.x, p.y - 24); // the body, not the feet
    this.sizeForZoom(ZOOMS[this.zoomIndex]); // labels and cursor as they'll be when it lands
    cam.setZoom(INTRO_ZOOM);
    centre();
    cam.fadeIn(FADE_MS, 0, 0, 0);
    this.intro = this.tweens.add({
      targets: cam,
      zoom: ZOOMS[this.zoomIndex],
      duration: Math.max(INTRO_MS, titleCardMs() - TITLE_LANDS_EARLY_MS), // landing as the letters swell open
      ease: 'Sine.easeInOut',
      onUpdate: centre,
      onComplete: () => {
        this.intro = null;
        cam.setZoom(ZOOMS[this.zoomIndex]); // land exactly on the whole-number zoom
      },
    });
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

  /**
   * Click (or touch) and drag the map: the view follows the pointer with growing resistance, never more than PEEK_PX,
   * and glides back where it was on letting go (instantly with reduced motion). Left button or touch only; a drag is
   * never a click (POINTER_UP ignores a press that moved more than 8 px).
   */
  private setupPeek(): void {
    const cam = this.cameras.main;
    const settle = () => {
      const k = this.peek;
      if (!k || k.back) return;
      k.dragging = false;
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        cam.setScroll(k.scrollX, k.scrollY);
        this.peek = null;
        return;
      }
      k.back = this.tweens.add({
        targets: cam,
        scrollX: k.scrollX,
        scrollY: k.scrollY,
        duration: PEEK_BACK_MS,
        ease: 'Cubic.easeOut',
        onComplete: () => {
          cam.setScroll(Math.round(k.scrollX), Math.round(k.scrollY));
          this.peek = null;
        },
      });
    };
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      if (this.peek || this.intro || this.inside || (!p.wasTouch && !p.leftButtonDown())) return;
      this.peek = { x: p.x, y: p.y, scrollX: cam.scrollX, scrollY: cam.scrollY, dragging: false, back: null };
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      const k = this.peek;
      if (!k || k.back || !p.isDown) return;
      const dx = p.x - k.x;
      const dy = p.y - k.y;
      const d = Math.hypot(dx, dy);
      if (!k.dragging && d <= 8) return; // still a click
      k.dragging = true;
      // Rubber band: 1:1 at first, then stiffer, approaching PEEK_PX.
      const pull = PEEK_PX * (1 - Math.exp(-d / PEEK_PX));
      const s = d ? pull / d / cam.zoom : 0;
      cam.setScroll(Math.round(k.scrollX - dx * s), Math.round(k.scrollY - dy * s));
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, () => (this.peek?.dragging ? settle() : this.peek && !this.peek.back && (this.peek = null)));
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, settle);
    this.input.on(Phaser.Input.Events.GAME_OUT, () => this.peek?.dragging && settle());
  }

  /** A building's layers clickable (the arena's back half too); its name shows while any of them is hovered. */
  private wireBuilding(b: Building): void {
    let over = 0;
    for (const part of b.parts) {
      part.setInteractive({ pixelPerfect: true, cursor: cursor('hand', this.cameras.main.zoom) });
      part.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => {
        over += 1;
        this.hovered = b;
        this.showBuildingName();
      });
      part.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => {
        over = Math.max(0, over - 1);
        if (!over && this.hovered === b) this.hovered = null;
        this.showBuildingName();
      });
    }
  }

  private setupInput(): void {
    // Benches are left-clickable too (sit), so they get the hand cursor.
    for (const b of this.objects.benches) b.sprite.setInteractive({ pixelPerfect: true, cursor: cursor('hand', this.cameras.main.zoom) });
    for (const b of this.objects.buildings) this.wireBuilding(b);

    // Left click uses things (a building's door, a bench); right click only walks. A tap on a touch screen does
    // both, as there's no right button.
    this.input.mouse?.disableContextMenu();
    this.setupPeek();
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => (this.pressAt = { x: p.x, y: p.y }));
    this.input.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      // A drag, not a click. (Measured from our own press: p.getDistance() only follows the left button, so after a
      // left drag every right click looked like a drag.)
      if (Math.hypot(p.x - this.pressAt.x, p.y - this.pressAt.y) > 8) return;
      // Someone else's character: left click (or a tap) picks them for the player menu.
      const other = this.others.pick(over);
      if (other && this.target && (p.wasTouch || p.leftButtonReleased())) return this.target.select(other);
      // An NPC: left click (or a tap) talks to them (walking over first if they're far).
      const npc = this.npcs?.pick(over);
      if (npc && (p.wasTouch || p.leftButtonReleased())) return this.talkTo(npc);
      const building = this.objects.buildings.find((b) => b.parts.some((part) => over.includes(part)));
      const world = this.cameras.main.getWorldPoint(p.x, p.y);
      const { col, row } = screenToTile(world.x, world.y);
      const bench = this.objects.benches.find((b) => over.includes(b.sprite)) ?? this.benchAt({ col, row });
      if (p.wasTouch) {
        if (building) return this.goToBuilding(building);
        return this.goToTile({ col, row });
      }
      if (p.rightButtonReleased()) return this.moveTo({ col, row });
      if (building) return this.goToBuilding(building);
      if (bench) return this.goToBench(bench);
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
      // 1–8: emotes (the picker beside the chat shows which is which).
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= EMOTE_KEYS.length) this.emoteKeys?.(EMOTE_KEYS[n - 1]);
    });

    // Wheel zooms in whole steps only (1×–4×), keeping pixels crisp.
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.intro?.complete(); // the wheel takes over from the arrival zoom
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
    if (!dir) {
      this.keyWalking = false;
      this.keyDir = null;
      return null;
    }
    // From a standstill, a tap only turns you; holding the key (TURN_HOLD_MS) walks. Already walking with the
    // keys, a new direction just carries on.
    const now = this.time.now;
    if (dir !== this.keyDir) {
      this.keyDir = dir;
      this.keySince = now;
    }
    if (!this.keyWalking && now - this.keySince < TURN_HOLD_MS) {
      this.player.face(dir);
      return null;
    }
    const from = this.player.tile;
    const [dc, dr] = DIR_STEP[dir];
    const tries: [number, number][] = [[dc, dr]];
    if (dc && dr) tries.push([dc, 0], [0, dr]);
    for (const [c, r] of tries) {
      const to = { col: from.col + c, row: from.row + r };
      if (this.grid.canStep(from, to)) {
        if (!this.byKeys) this.setBuildingAlert(null);
        this.byKeys = true;
        this.keyWalking = true;
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
    if (bench) this.sitOn(bench);
  }

  /** The town's NPCs: on the walkable tiles away from doors, gates, benches and the spawn (world/npcs.ts), with the
   *  speech bubble for their gossip and the dialog box's art. */
  private makeNpcs(): NpcLife | null {
    if (!this.M.npcs) return null;
    const avoid = new Set<string>();
    const add = (c: number, r: number) => avoid.add(`${c},${r}`);
    for (const b of this.objects.buildings) for (const [c, r] of b.doors) for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) add(c + dc, r + dr);
    for (const b of this.objects.benches) {
      const s = benchApproach(b);
      add(b.col, b.row);
      add(s.col, s.row);
    }
    for (const tiles of Object.values(this.map.gates ?? {})) for (const [c, r] of tiles) add(c, r);
    add(this.map.spawn[0], this.map.spawn[1]);
    const asset = (file: string) => `${import.meta.env.BASE_URL}assets/${file}`;
    const B = this.M.ui.speechBubble;
    const bubbles: BubbleArt | null = B && this.textures.exists(B.file) ? lightBubble(this, { file: B.file, slice: B.nineSlice, tail: B.tail, tailAnchor: B.tailAnchor }) : null;
    const box = this.M.ui.chatWindow;
    const frame = this.M.ui.inventory?.itemFrame;
    setNpcDialogArt({ box: box ? { url: asset(box.file), slice: box.nineSlice } : null, frame: frame ? { url: asset(frame.file), slice: frame.nineSlice } : null });
    const life = new NpcLife({ scene: this, M: this.M, grid: this.grid, objects: this.objects, avoid, onSpawn: (obj) => this.tint >= 0 && obj.setTint(this.tint), bubbles, asset });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => closeNpcDialog());
    return life;
  }

  private megaphone: MegaphoneBanner | null = null;
  private raceOpened: string | null = null;
  private raceCalled: string | null = null;

  /** The Mosang race in the megaphone banner, in town and the neighbourhood alike: once when it opens (while bets
   *  are still open), once when it's won. */
  private raceNews(): void {
    const r = currentRace();
    if (!r) return;
    const now = raceNow();
    if (r.id !== this.raceOpened && !r.run && now < r.closesAt) {
      this.raceOpened = r.id;
      const mins = Math.max(1, Math.round((r.closesAt - now) / 60_000));
      this.banner().show('🏁 Mosang race', `${r.startedBy} started a race! Bet on a Mosang in the race box (top right): bets close in ${mins} ${mins === 1 ? 'minute' : 'minutes'}.`);
      playSound('chip');
    }
    if (r.run && r.id !== this.raceCalled && now >= r.run.endsAt) {
      this.raceCalled = r.id;
      const tie = r.run.tie >= 0 ? mosangName(r.runners[r.run.tie]) : null;
      const winner = mosangName(r.runners[r.run.winner]);
      this.banner().show('🏁 Mosang race', tie ? `Photo finish! ${winner} and ${tie} win!` : `${winner} wins!`);
      playSound('casino-win');
    }
  }

  /** The megaphone banner (megaphone messages, the Mosang race's winner): one at a time, made once. */
  private banner(): MegaphoneBanner {
    const art = this.M.items?.megaphone?.showcase;
    this.megaphone ??= new MegaphoneBanner(art ? `${import.meta.env.BASE_URL}assets/${art}` : null);
    return this.megaphone;
  }

  /** Talk to an NPC: close enough, straight away; else walk up to them first (to the tile before theirs). */
  private talkTo(id: string): void {
    const at = this.npcs?.tileOf(id);
    if (!at) return;
    this.pending = null;
    this.byKeys = false;
    const me = this.player.tile;
    if (Math.max(Math.abs(at.col - me.col), Math.abs(at.row - me.row)) <= TALK_RANGE) return this.npcs!.talk(id, me);
    const path = this.grid.findPath(me, at) ?? this.grid.findPath(me, this.grid.nearestReachable(me, at) ?? me);
    if (!path || path.length < 2) return;
    this.setBuildingAlert(null);
    this.player.walk(path.slice(0, -1));
    this.pending = { npc: id };
  }

  /** Walk to a tile; a bench means sit on it; a blocked tile means the nearest reachable one. */
  goToTile(target: Tile): void {
    const bench = this.benchAt(target);
    if (bench) return this.goToBench(bench);
    this.moveTo(target);
  }

  private benchAt(t: Tile): Bench | undefined {
    return this.objects.benches.find((b) => b.col === t.col && b.row === t.row);
  }

  /** Walk up to a bench and sit on it (straight away if you're already in front of it) — unless it's taken. */
  private goToBench(bench: Bench): void {
    this.pending = null;
    this.byKeys = false;
    if (this.others.seatTaken(bench.col, bench.row)) return this.seatTaken();
    const spot = benchApproach(bench);
    const here = this.player.tile;
    if (here.col === spot.col && here.row === spot.row) return this.sitOn(bench);
    if (this.walkTo(spot)) this.pending = { sit: bench };
  }

  /** Sit down, if nobody beat you to it (the server checks too: 'seat-taken'). */
  private sitOn(bench: Bench): void {
    if (this.others.seatTaken(bench.col, bench.row)) return this.seatTaken();
    this.player.sit({ col: bench.col, row: bench.row }, bench.faces, bench.depth);
  }

  private seatTaken(): void {
    playSound('error');
    toast("Someone's already sitting there.");
  }

  /** Just walk there (a blocked tile: the nearest reachable one), with the click marker on where you're going. */
  private moveTo(target: Tile): void {
    this.pending = null;
    this.byKeys = false;
    const to = this.grid.walkable(target.col, target.row) ? target : this.grid.nearestReachable(this.player.tile, target);
    if (to && this.walkTo(to)) this.clickMarker(to);
  }

  /** fx click-marker, played once on the tile you're walking to (one at a time, on the ground under everyone). */
  private clickMarker(tile: Tile): void {
    const fx = this.M.fx['click-marker'];
    if (!fx?.file || !this.textures.exists(fx.file)) return;
    const key = `anim:${fx.file}`;
    if (!this.anims.exists(key)) {
      this.anims.create({ key, frames: this.anims.generateFrameNumbers(fx.file, { start: 0, end: (fx.frames ?? 1) - 1 }), frameRate: fx.fps ?? 12, repeat: 0 });
    }
    this.marker?.destroy();
    const top = tileToScreen(tile.col, tile.row);
    const [w, h] = fx.frame ?? [32, 32];
    const [ax, ay] = fx.anchor ?? [w / 2, h / 2];
    const marker = this.add.sprite(top.x, top.y + 8, fx.file).setOrigin(ax / w, ay / h).setDepth(GROUND_SHADOW_DEPTH + 1); // the tile's centre
    if (this.tint >= 0) marker.setTint(this.tint);
    marker.play(key).once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => marker.destroy());
    this.marker = marker;
  }

  /** fx dig-dust on the Mine entrance's door: someone else dug (three loops, then gone). */
  private mineDust(): void {
    const fx = this.M.fx['dig-dust'];
    const mine = this.objects.buildings.find((b) => b.id === 'mine-entrance');
    const door = mine?.doors[0];
    if (!fx?.file || !door || !this.textures.exists(fx.file)) return;
    const key = `anim:${fx.file}`;
    if (!this.anims.exists(key)) {
      this.anims.create({ key, frames: this.anims.generateFrameNumbers(fx.file, { start: 0, end: (fx.frames ?? 1) - 1 }), frameRate: fx.fps ?? 10, repeat: 2 });
    }
    const [col, row] = door;
    const top = tileToScreen(col, row);
    const [w, h] = fx.frame ?? [32, 32];
    const [ax, ay] = fx.anchor ?? [w / 2, h - 1];
    const dust = this.add.sprite(top.x, top.y + 8, fx.file).setOrigin(ax / w, ay / h); // the tile's centre
    dust.setDepth(characterDepth(this.objects, col, row, frontDepth(col, row, 1, 1), dust.getBounds()));
    if (this.tint >= 0) dust.setTint(this.tint);
    dust.play(key).once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => dust.destroy());
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
    const gate = this.gateAt.get(`${tile.col},${tile.row}`);
    if (gate) return this.travel(gate);
    if (this.pending?.npc) {
      const id = this.pending.npc;
      this.pending = null;
      return this.talkTo(id); // there now (or they moved: after them again)
    }
    if (this.pending?.sit) {
      const b = this.pending.sit;
      this.pending = null;
      this.sitOn(b); // someone may have sat down while we walked over
      return;
    }
    const building = this.doorAt.get(`${tile.col},${tile.row}`);
    this.setBuildingAlert(building ?? null);
    if (!building) return;
    if (!this.byKeys) return this.enter(building); // clicked the building: go in
    // Walked here with the keys: wait for E, so walking past a door never throws you inside.
    toast(`${doorLabel(building.id)} · press E to enter`);
  }

  /** Door hook: twigo's house goes back to twigo's room; the others are stubs for now. */
  private enter(b: Building): void {
    this.events.emit('door', b.id);
    playSound(b.id === 'casino' || b.id === 'jackpot-booth' ? 'card' : 'door');
    if (b.id === 'twigos-house') {
      toast("Back to twigo's room…");
      this.time.delayedCall(700, () => location.assign(TWIGO_ROOM_URL));
      return;
    }
    if (b.id === 'leaderboard-monument') return showLeaderboard((o) => this.podiumFigure(o));
    if (b.id === 'jackpot-booth') return showJackpot();
    if (b.id === 'bank') return showBank();
    if (b.id === 'tanod-outpost') return showOutpost();
    if (b.id === 'notice-board') return showBoard();
    if (b.id === 'sari-sari-store') return showShop();
    if (b.id === 'parlor') return this.openParlor();
    const house = this.houseFor(b.id);
    if (house) return void this.openHouse(house);
    if (b.id === 'mine-entrance') return showMine();
    if (b.id === 'casino') return void this.enterCasino(b);
    if (b.id === 'arena') return this.openArena(b);
    toast(`${doorLabel(b.id)}: coming soon`);
  }

  // ── The neighbourhood: houses, gates ──

  /** Each house drawn in its look as a texture, and a building of its own in the manifest (this scene's copy). */
  private addHouses(): void {
    const art = this.art;
    const H = this.M.houses;
    if (!art || !H || !this.hood) return;
    const buildings = { ...this.M.buildings };
    for (const house of this.hood.houses) {
      const key = this.houseTexture(house);
      if (key) buildings[`house-${house.lot}`] = { file: key, size: H.size, footprint: H.footprint, footprintTopCorner: H.footprintTopCorner, footprintBottomCorner: H.footprintBottomCorner } as Manifest['buildings'][string];
    }
    this.M = { ...this.M, buildings };
  }

  /** A house's look as a new texture (null if its art isn't loaded). */
  private houseTexture(house: HoodHouse): string | null {
    const canvas = this.art && composeHouse(this, this.art, tidyLook(this.art, house));
    if (!canvas) return null;
    const key = `house:${house.lot}:${this.houseKeys++}`;
    this.textures.addCanvas(key, canvas);
    return key;
  }

  private houseFor(buildingId: string): HoodHouse | null {
    if (!this.hood || !buildingId.startsWith('house-')) return null;
    const lot = Number(buildingId.slice(6));
    return this.hood.houses.find((h) => h.lot === lot) ?? null;
  }

  /** A house, clicked: where you stand now (jail, cooldown, keys and potions) is asked first, so the menu is never
   *  out of date (a jail term run out, a key bought in Discord). */
  private async openHouse(clicked: HoodHouse): Promise<void> {
    if (this.openingHouse) return;
    this.openingHouse = true;
    const fresh = await loadHood();
    this.openingHouse = false;
    const hood = this.hood!;
    if (fresh) {
      hood.me = fresh.me;
      for (const h of fresh.houses) {
        const known = hood.houses.find((x) => x.lot === h.lot);
        if (known) known.fenced = h.fenced;
      }
    }
    const house = hood.houses.find((x) => x.lot === clicked.lot) ?? clicked;
    showHouseMenu({
      house,
      me: hood.me,
      act: async (action) => {
        const r = await hoodAction(action, house.lot);
        if (r) this.hood = r;
        return r;
      },
      repaint: () => this.repaintHouse(house),
      busted: (message) => void playBusted(message),
      effect: (kind) => {
        const b = this.objects.buildings.find((x) => x.id === `house-${house.lot}`);
        if (!b) return Promise.resolve();
        // (Seen here only: the neighbourhood doesn't pass house actions to the others in it.)
        const at = { scene: this, M: this.M, objects: this.objects, house: { col: b.obj.col, row: b.obj.row }, from: { x: this.player.sprite.x, y: this.player.sprite.y }, tint: this.tint };
        return kind === 'kalawang' ? playKalawang(at) : playMasterKey(at, kind);
      },
    });
  }

  private openingHouse = false;

  /** Your house, a new look (the house creator over the town); its sprite is redrawn when it's saved. */
  private repaintHouse(house: HoodHouse): void {
    const art = this.art;
    if (!art || !this.hood) return;
    const frame = this.M.ui.inventory?.itemFrame;
    mountHouseCreator({
      art,
      initial: house,
      cost: this.hood.me.repaintCost,
      kowens: this.hood.me.kowens,
      frame: frame ? { url: `${import.meta.env.BASE_URL}assets/${frame.file}`, slice: frame.nineSlice } : null,
      draw: (look) => composeHouse(this, art, look),
      save: async (look) => {
        const r = await saveHouse(look);
        if (!r) return { ok: false, message: "Couldn't save. Try again?" };
        this.hood = r;
        if (r.ok) {
          playSound('coin');
          window.dispatchEvent(new Event('mk-wallet'));
          const now = r.houses.find((h) => h.lot === house.lot);
          const key = now && this.houseTexture(now);
          const b = this.objects.buildings.find((x) => x.id === `house-${house.lot}`);
          if (key && b) puffHouse(this.fx(), b, key);
        }
        return r;
      },
      onClose: () => {},
    });
  }

  /** What the house effects need: this scene, its art and the world's tint now. */
  private fx() {
    return { scene: this, M: this.M, tint: this.tint };
  }

  /** Someone else's house, live: built (it rises on its lot, if this map already has room for it) or a new look. */
  private houseNews(m: Extract<TownServerMessage, { t: 'house' }>): void {
    if (m.change === 'fence') return this.bakodNews(m);
    const hood = this.hood;
    const H = this.M.houses;
    if (!hood || !this.art || !H) return;
    const id = `house-${m.house.lot}`;
    if (hood.houses.find((h) => h.mine)?.lot === m.house.lot) return; // yours: already shown here
    const known = this.objects.buildings.find((b) => b.id === id);
    const i = hood.houses.findIndex((h) => h.lot === m.house.lot);
    if (i >= 0) hood.houses[i] = m.house;
    else hood.houses.push(m.house);
    if (m.change === 'look') {
      const key = known && this.houseTexture(m.house);
      if (key) puffHouse(this.fx(), known, key);
      return;
    }
    if (known) return;
    const [cols, rows] = this.map.size;
    if (m.col + H.footprint[0] > cols || m.row + H.footprint[1] > rows) {
      return toast(`${m.house.owner} built a house on a new street! It'll be there on your next visit.`, 3500);
    }
    const key = this.houseTexture(m.house);
    if (!key) return;
    this.M.buildings[id] = { file: key, size: H.size, footprint: H.footprint, footprintTopCorner: H.footprintTopCorner, footprintBottomCorner: H.footprintBottomCorner } as Manifest['buildings'][string];
    const o = { kind: 'building' as const, id, col: m.col, row: m.row, footprint: [H.footprint[0], H.footprint[1]] as [number, number] };
    this.map.objects.push(o);
    this.map.doors[id] = m.door;
    for (let r = m.row; r < m.row + H.footprint[1]; r++) {
      for (let c = m.col; c < m.col + H.footprint[0]; c++) {
        this.map.blocked[r][c] = 1;
        this.grid.block(c, r);
      }
    }
    const b = this.objects.addBuildingNow(o);
    if (!b) return;
    if (this.tint >= 0) b.sprite.setTint(this.tint);
    this.doorAt.set(`${m.door[0]},${m.door[1]}`, b);
    this.wireBuilding(b);
    const label = new BuildingLabel(this, `${m.house.owner}'s house`, b.top.x);
    label.setZoom(this.cameras.main.zoom);
    this.buildingLabels.set(id, label);
    sinkHouse(b);
    void riseHouse(this.fx(), b);
    toast(`${m.house.owner} built a house in the neighbourhood!`, 3000);
  }

  /** A Bakod went up (bought) or came down (ran out, rusted away) on a house here, yours included: the fence is drawn
   *  again (the bot sends all of the neighbourhood's), with its walking edges and the house's door spot. Standing in
   *  that yard as it goes up, you can still walk out (its edges block once you're out). */
  private bakodNews(m: Extract<TownServerMessage, { t: 'house' }>): void {
    const hood = this.hood;
    if (!hood) return;
    const known = hood.houses.find((h) => h.lot === m.house.lot);
    if (known) known.fenced = m.house.fenced;
    const pieces = this.objects.setFence(m.fence, (img) => this.culler.forget(img));
    if (this.tint >= 0) for (const p of pieces) p.setTint(this.tint);
    const id = `house-${m.house.lot}`;
    const b = this.objects.buildings.find((x) => x.id === id);
    if (b) {
      const old = this.map.doors[id];
      if (old) this.doorAt.delete(`${old[0]},${old[1]}`);
      this.map.doors[id] = m.door;
      this.doorAt.set(`${m.door[0]},${m.door[1]}`, b);
    }
    // The yard inside a fence: a tile round the house (hood-map's ring).
    const H = this.M.houses;
    const yard: [number, number, number, number] | null = b && H ? [b.obj.col - 1, b.obj.row - 1, b.obj.col + H.footprint[0], b.obj.row + H.footprint[1]] : null;
    const { col, row } = this.player.tile;
    const inside = (y: [number, number, number, number]) => col >= y[0] && col <= y[2] && row >= y[1] && row <= y[3];
    if (m.house.fenced && yard && inside(yard)) this.fenceLater = { fence: m.fence, yard };
    else if (this.fenceLater && inside(this.fenceLater.yard)) this.fenceLater.fence = m.fence; // still on the way out
    else {
      this.grid.setFence(m.fence);
      this.fenceLater = null;
    }
    if (m.house.fenced && !known?.mine) toast(`${m.house.owner} put up a Bakod!`, 3000);
  }

  /** A clickable sign over each gate: "Neighbourhood" at the bridge, "Back to town" at the neighbourhood's exit. */
  private gateSigns(): void {
    for (const to of ['hood', 'town'] as const) {
      const tiles = this.map.gates?.[to];
      if (!tiles?.length) continue;
      const [c, r] = tiles[Math.floor(tiles.length / 2)];
      const at = tileToScreen(c, r);
      const sign = new BuildingLabel(this, to === 'hood' ? 'Neighbourhood →' : '← Back to town', at.x);
      this.gateLabels.push(sign);
      sign.setZoom(this.cameras.main.zoom);
      // Over the gate, or higher: clear of the roof of any building it would sit on (tall houses by the way in).
      const half = sign.text.displayWidth / 2 + 4;
      const h = sign.text.displayHeight;
      const near = this.objects.buildings.filter((b) => {
        const box = b.sprite.getBounds();
        return box.right >= at.x - half && box.left <= at.x + half;
      });
      let y = at.y - 6;
      for (let moved = true; moved; ) {
        moved = false; // (again after a lift: it may now sit on a taller one)
        for (const b of near) {
          if (b.sprite.getBounds().bottom < y - h || b.top.y - 4 >= y) continue;
          y = b.top.y - 4;
          moved = true;
        }
      }
      sign.show(y);
      // The buildings whose name (shown just over their roof) would land on the sign.
      const over = new Set(near.filter((b) => b.top.y - 2 - h < y + 2 && b.top.y - 2 > y - h - 2).map((b) => b.id));
      this.gateSpots.push({ sign, y, over });
      sign.text.setInteractive({ cursor: 'pointer' }).on('pointerdown', (p: Phaser.Input.Pointer) => {
        if (!p.leftButtonDown()) return;
        p.event.stopPropagation();
        this.goToTile({ col: c, row: r });
      });
    }
  }

  /** Off to the other area: a fade, then that page (the town's art is cached, so it's quick). */
  private travel(to: 'hood' | 'town'): void {
    if (this.travelling) return;
    this.travelling = true;
    playSound('door');
    toast(to === 'hood' ? 'To the neighbourhood…' : 'Back to town…');
    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.time.delayedCall(420, () => location.assign(areaUrl(to)));
  }
  private travelling = false;

  // ── The Parlor: a new look (Kowens) or another of your titles ──

  private openParlor(): void {
    const member = this.me?.status === 'ok' ? this.me.me : null;
    if (!member) return toast('Log in to use the Parlor.');
    const C = this.M.characters;
    const frame = this.M.ui.inventory?.itemFrame;
    void showParlor({
      C,
      nickname: member.nickname ?? member.name,
      title: member.title ?? TOWNFOLK,
      outfit: this.outfit,
      frame: frame ? { url: `${import.meta.env.BASE_URL}assets/${frame.file}`, slice: frame.nineSlice } : null,
      apply: (o) => loadOutfit(this, C, o),
      sheet: (o, dir) => {
        const key = sheetKey(o, 'idle', dir);
        return this.textures.exists(key) ? (this.textures.get(key).getSourceImage() as HTMLCanvasElement) : null;
      },
      head: (o) => headTop(this, o),
      restyled: (o, title) => void this.restyle(o, title),
      onClose: () => {},
    });
  }

  /** Your new look and/or title (the Parlor, or the town's `look` message): on your character, name tag and HUD. */
  private async restyle(o: Outfit | null, title: TitleData): Promise<void> {
    const member = this.me?.status === 'ok' ? this.me.me : null;
    if (member) member.title = title;
    this.player.setNameTag(member?.nickname ?? 'Guest', title);
    if (!o || sameOutfit(o, this.outfit)) return;
    if (member) member.outfit = o;
    await this.setOutfit(o);
    setHudAvatar(headPortrait(this, this.M.characters, o));
  }

  // ── The arena: jack en poy ──

  /** A match on the server (or the queue for one): its arena-* messages go here. */
  private arenaChannel: PlayerChannel | null = null;

  /** The arena's menu: Vs Bot, or Vs Player (needs the town's connection; not from jail). */
  private openArena(b: Building): void {
    const modes = this.M.ui.arenaModes;
    const member = this.me?.status === 'ok' ? this.me.me : null;
    showArenaMenu({
      icons: modes ? { url: `${import.meta.env.BASE_URL}assets/${modes.file}`, size: modes.size[0] } : null,
      noPlayer: !this.link ? 'Log in to play others' : member?.status === 'jailed' ? 'Not from jail' : null,
      canBet: !!this.link && member?.status !== 'jailed',
      bot: (bet) => {
        // Logged in (and not jailed): the server plays the bot, so it can be bet on. Else (and dev's &rounds=) here.
        if (!this.link || member?.status === 'jailed' || devRounds().length) {
          this.enterArena(b, new BotChannel(this.M.characters, Date.now(), devRounds()));
          return null;
        }
        return this.arenaServer({ t: 'arena-bot', bet });
      },
      queue: (bet) => this.arenaServer({ t: 'arena-queue', bet }),
      onMatched: (channel, bet) => void this.matched(b, channel, bet),
    });
  }

  /** A match found while walking around town (an open pop-up closes; in the casino: out of it first). */
  private async matched(b: Building, channel: PlayerChannel, bet: number): Promise<void> {
    document.querySelector<HTMLButtonElement>('#reward .rw-ok, #reward .rw-x')?.click();
    if (this.inside) await this.leaveRoom();
    this.enterArena(b, channel, bet);
  }

  /** Starts a match on the server (Vs Player's queue, or the server's bot); its arena-* messages go to the channel. */
  private arenaServer(m: Extract<TownClientMessage, { t: 'arena-queue' | 'arena-bot' }>): PlayerChannel | null {
    if (!this.link) return null;
    const channel = new PlayerChannel(this.link);
    this.arenaChannel = channel;
    this.link.send(m);
    return channel;
  }

  /** Into the arena's match screen (scenes/ArenaScene.ts), the casino's way in; others see you at the arena's door. */
  private enterArena(b: Building, channel: ArenaChannel, bet = 0): void {
    stopQueue();
    const member = this.me?.status === 'ok' ? this.me.me : null;
    const data: ArenaData = {
      M: this.M,
      me: { nickname: member?.nickname ?? 'Guest', title: member?.title ?? TOWNFOLK, outfit: this.outfit },
      channel,
      bet,
      zoom: ZOOMS[this.zoomIndex],
      leave: () => void this.leaveRoom(),
    };
    void this.enterRoom(b, {
      sound: enterArenaSound,
      open: () => this.scene.launch('arena', data),
      close: () => {
        this.scene.stop('arena');
        if (this.arenaChannel === channel) this.arenaChannel = null;
        if (channel instanceof BotChannel) channel.stop();
      },
    });
  }

  // ── The casino: walking in and out ──

  /** Into the casino: input locks, the camera stops following and pans to the casino's door (the tile in front of its
   *  canopy, from town.json) while it zooms in (2.5× the current zoom, Sine.easeInOut, 700 ms) and fades out (camera
   *  fade, navy); then the navy veil covers the page and the casino screen fades in from it, with its music. With
   *  reduced motion: a plain 250 ms fade. The player stays at the door, seen by everyone. */
  private enterCasino(b: Building): Promise<void> {
    return this.enterRoom(b, { sound: enterCasinoSound, open: () => openCasino(() => void this.leaveRoom()), close: closeCasino });
  }

  /** Into a building's own screen (the casino, the arena): the same walk in for both. */
  private room: { close: () => void } | null = null;
  private async enterRoom(b: Building, r: { sound: () => void; open: () => void; close: () => void }): Promise<void> {
    if (this.inside) return;
    this.room = { close: r.close };
    const cam = this.cameras.main;
    this.intro?.complete();
    this.inside = { zoom: cam.zoom };
    this.lockTown(true);
    const [col, row] = b.doors[0] ?? [this.player.tile.col, this.player.tile.row];
    const door = tileToScreen(col, row);
    r.sound();
    if (reducedMotion()) await fadeNavy(1, 250);
    else {
      cam.pan(door.x, door.y + 8 - 24, ENTER_MS, 'Sine.easeInOut', true); // the door, at body height
      cam.zoomTo(this.inside.zoom * 2.5, ENTER_MS, 'Sine.easeInOut', true);
      cam.fadeOut(ENTER_MS, 0x1e, 0x1b, 0x3a);
      await new Promise((r) => cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, r));
      await fadeNavy(1, 150); // the page too (the HUD that stays over the casino)
    }
    r.open();
    await fadeNavy(0, reducedMotion() ? 250 : 300);
  }

  /** Out of the casino: fade to navy, back to the town at the zoomed-in door, then zoom out to the player as they
   *  were (whole-number zoom again) while the navy lifts; input and the HUD come back. */
  private leaving = false;
  private async leaveRoom(): Promise<void> {
    if (!this.inside || this.leaving) return;
    this.leaving = true;
    const cam = this.cameras.main;
    const zoom = this.inside.zoom;
    const p = this.player.sprite;
    await fadeNavy(1, reducedMotion() ? 250 : 300);
    this.room?.close();
    this.room = null;
    leaveCasinoSound();
    if (reducedMotion()) {
      cam.resetFX();
      cam.setZoom(zoom);
      cam.centerOn(p.x, p.y - 24);
      await fadeNavy(0, 250);
    } else {
      // The page's veil lifts at once; the town itself fades back in as the camera zooms out to the player.
      await fadeNavy(0, 0);
      cam.pan(p.x, p.y - 24, ENTER_MS, 'Sine.easeInOut', true);
      cam.zoomTo(zoom, ENTER_MS, 'Sine.easeInOut', true);
      cam.fadeIn(ENTER_MS, 0x1e, 0x1b, 0x3a);
      await new Promise((r) => cam.once(Phaser.Cameras.Scene2D.Events.FADE_IN_COMPLETE, r));
      cam.setZoom(zoom); // land exactly on the whole-number zoom
    }
    cam.roundPixels = true;
    this.sizeForZoom(zoom);
    this.inside = null;
    this.leaving = false;
    this.lockTown(false);
  }

  /** Locks the town (no clicks, keys or wheel; the player stops) and hides the HUD, or undoes it. */
  private lockTown(on: boolean): void {
    this.input.enabled = !on;
    if (on) {
      this.pending = null;
      this.player.cancelPath();
    }
    document.body.classList.toggle('town-locked', on);
  }

  /** fx-alert over a building while the player stands at its door. */
  private setBuildingAlert(b: Building | null): void {
    this.buildingAlert?.destroy();
    this.buildingAlert = null;
    this.alertFor = null;
    const fx = this.M.fx.alert;
    if (!b || !fx?.file) return this.showBuildingName();
    const key = `anim:${fx.file}`;
    if (!this.anims.exists(key)) {
      this.anims.create({ key, frames: this.anims.generateFrameNumbers(fx.file, { start: 0, end: (fx.frames ?? 1) - 1 }), frameRate: fx.fps ?? 4, repeat: -1 });
    }
    this.buildingAlert = this.add.sprite(Math.round(b.top.x), Math.round(b.top.y - 2), fx.file).setOrigin(0.5, 1).setDepth(LABEL_DEPTH);
    this.buildingAlert.play(key);
    this.alertFor = b;
    this.showBuildingName();
  }

  /** A building's name shows over its roof while it's hovered or the player is at its door (above the alert). */
  private showBuildingName(): void {
    for (const [id, label] of this.buildingLabels) {
      const atDoor = this.alertFor?.id === id ? this.alertFor : null;
      const b = atDoor ?? (this.hovered?.id === id ? this.hovered : null);
      const alert = atDoor ? this.buildingAlert : null;
      label.show(!b ? null : alert ? alert.y - alert.height - 1 : b.top.y - 2);
    }
    // A gate sign over a building whose name is showing would cover it: hidden till the name goes.
    const named = [this.alertFor?.id, this.hovered?.id];
    for (const g of this.gateSpots) g.sign.show(named.some((id) => id && g.over.has(id)) ? null : g.y);
  }

  // ── Day / night ──

  private updateSky(force: boolean): void {
    const sky = skyAt(minutesNow());
    this.lampsOn = sky.lampsOn;
    this.objects.setLamps(sky.lampsOn);
    if (!force && sky.tint === this.tint) return;
    this.tint = sky.tint;
    const all = [...this.ground.sprites, ...this.objects.sprites, ...this.player.tintables, ...this.others.tintables, ...(this.npcs?.tintables ?? []), ...(this.bridge ? [this.bridge] : [])];
    for (const s of all) s.setTint(sky.tint);
  }

  // ── For debugging and the headless check ──

  get debugNpcs() {
    return this.npcs;
  }

  debugTalk(id: string): void {
    this.talkTo(id);
  }

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
    return loadOutfit(this, this.M.characters, o).then(() => {
      this.outfit = o;
      this.player.setOutfit(o);
      if (this.tint >= 0) this.player.sprite.setTint(this.tint);
    });
  }

  get debugPlayer(): Character {
    return this.player;
  }

  get debugWorld() {
    return { objects: this.objects, grid: this.grid, map: this.map, tileToScreen };
  }
}

/** True while the user is typing into a page input (or the settings box is open), so movement keys stay with the page. */
function typing(): boolean {
  if (document.getElementById('settings') || document.getElementById('creator') || document.body.classList.contains('town-locked')) return true;
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

/** A title that's new to you, in the reward pop-up (once: the bot is told when it's been seen). One you're already
 *  wearing (given with /gift title) says so; one you've won (the richest) points to the Parlor. */
function showNewTitle(id: string, title: TitleData, wearing: TitleData): void {
  const worn = wearing.name === title.name && wearing.color === title.color;
  const message = worn ? `Congratulations! You are now known as <${title.name}>.` : `Congratulations! <${title.name}> is yours. Show it under your name at the Parlor.`;
  void showReward({ title: 'New title!', graphic: { kind: 'title', title }, message }).then(() =>
    fakeLogin() ? null : fetch('/title/seen', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => null),
  );
}

/** A small "Reconnecting…" at the top while the town's connection is down (shown after a moment, so a blip passes
 *  unseen); everything on screen stays meanwhile. */
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
function reconnecting(on: boolean): void {
  clearTimeout(reconnectTimer);
  const note = document.getElementById('reconnecting');
  if (!on) return void note?.remove();
  reconnectTimer = setTimeout(() => {
    if (document.getElementById('reconnecting')) return;
    const el = document.createElement('div');
    el.id = 'reconnecting';
    el.setAttribute('role', 'status');
    el.textContent = 'Reconnecting…';
    document.body.append(el);
  }, RECONNECT_NOTE_MS);
}
const RECONNECT_NOTE_MS = 2_000;

/** The welcome gift, in the reward pop-up (once: the bot is told when it's been seen). */
function showWelcomeGift(amount: number): void {
  window.dispatchEvent(new Event('mk-wallet')); // the HUD's Kowens (given before this page asked)
  void showReward({ title: 'Welcome gift!', graphic: { kind: 'kowens', amount }, message: `Welcome to Mikazuki town! Every player gets ${amount} Kowens to start with. Enjoy!` }).then(() =>
    fakeLogin() ? null : fetch('/welcome/seen', { method: 'POST', credentials: 'same-origin' }).catch(() => null),
  );
}

/** The same look, whatever order its fields are in. */
const sameOutfit = (a: Outfit, b: Outfit) => (Object.keys({ ...a, ...b }) as (keyof Outfit)[]).every((k) => a[k] === b[k]);

/** Whole-number zoom that shows a comfortable slice of town for the window size. */
function defaultZoomIndex(w: number, h: number): number {
  // The middle step (3×) when at least ~320×200 world pixels still fit; 2× on phones and small windows.
  return ZOOMS.indexOf(w >= 960 && h >= 600 ? 3 : 2);
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
    reward: (r: Reward) => scene.debugReward(r),
    /** The NPCs' tiles, or talk to one (walking over if needed). */
    npcs: () => scene.debugNpcs?.positions,
    talk: (id: string) => scene.debugTalk(id),
    /** The Mosang race as this page has it, and the bot's clock. */
    race: () => ({ race: currentRace(), now: raceNow() }),
    /** Fixed view for screenshots: zoom and centre on a world point (follow off), or follow again. */
    view: (zoom?: number, x?: number, y?: number) => {
      const cam = scene.cameras.main;
      if (zoom) cam.setZoom(zoom);
      scene.follow = x === undefined;
      if (x !== undefined && y !== undefined) cam.centerOn(x, y);
    },
  };
}
