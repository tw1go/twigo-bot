import Phaser from 'phaser';
import { queueImage, queueNpcs, queueTown } from '../assets/queue';
import type { Area, Dir, Gate, Manifest, TownMap } from '../assets/types';
import { Character, SPEED, dirForStep, dirToward } from '../characters/character';
import { type Outfit, assetProblems, buildOutfit, headPortrait, headTop, loadOutfit, outfitFiles, randomOutfit, sheetKey } from '../characters/doll';
import { sanitize, startingOutfit } from '../characters/looks';
import type { MeResult } from '../session';
import { cursor } from '../ui/cursor';
import { BuildingLabel, UI_FONT } from '../ui/labels';
import { LOADING_LINES } from '../ui/loading-lines';
import { TownLink } from '../net/town';
import { showElsewhere, showKicked } from '../ui/elsewhere';
import { hideRevive, showRevive } from '../ui/revive';
import { mountTownHud, setHudAvatar, setHudClass, setHudLevel, setHudName, setHudVitals } from '../ui/townhud';
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
import { actionOf, held, keyLabel, matches } from '../ui/keybinds';
import type { ArenaServerMessage, ClassInfo, HoodHouse, OutfitData, TitleData, TownClientMessage, TownEmote, TownHoodResponse, TownServerMessage } from '@mikazuki/shared';
import { type BubbleArt, lightBubble } from '../ui/labels';
import { type Reward, setRewardArt, showReward } from '../ui/reward';
import { showMovementTutorial } from '../ui/tutorial';
import { type Figure, showLeaderboard } from '../ui/leaderboard';
import { showJackpot } from '../ui/jackpot';
import { showBank } from '../ui/bank';
import { showOutpost } from '../ui/outpost';
import { showBoard } from '../ui/board';
import { showShop } from '../ui/shop';
import { InspectWindow } from '../ui/inspect';
import { TargetBox } from '../ui/target';
import { TradeWindow, trading } from '../ui/trade';
import { RARITY_TEXT, addItemArt, isRarity, setItemArt, setRarityColours } from '../ui/item-art';
import { setForgeArt } from '../ui/forge';
import { LOOT_LAND_MS, LootLayer } from '../world/loot';
import { setKusingArt } from '../ui/reward';
import { itemTipFor, nameOf, pickupOf } from '../ui/item-tip';
import { SkillTip } from '../ui/skill-tip';
import { playDig, setDigPanelArt } from '../ui/dig-panel';
import { showMine } from '../ui/mine';
import { Inventory } from '../ui/inventory';
import { EquipmentPanel, gearPicture } from '../ui/equipment';
import { closeCasino, openCasino, setCasinoArt } from '../ui/casino';
import { fadeNavy } from '../ui/fade';
import { OtherPlayers } from '../world/others';
import { fakeLogin, fakeName, loadMe } from '../session';
import { screenToTile, tileToScreen } from '../iso';
import { toast } from '../ui/toast';
import { confirmDrop } from '../ui/drop';
import { PartyPanel, showPartyInvite } from '../ui/party';
import { answer as partyAnswer, inParty, onParty, party, refusal as partyRefusal, setMemberHp, setParty, setPartyLink } from '../net/party';
import { GROUND_SHADOW_DEPTH, LABEL_DEPTH, frontDepth } from '../world/depth';
import { minutesNow, setTimeSource, skyAt } from '../world/daynight';
import { Culler } from '../world/cull';
import { rng } from '../world/rng';
import { type Tile, WalkGrid } from '../world/grid';
import { Ground } from '../world/ground';
import { SlumsOutskirts, outskirts } from '../world/outskirts';
import { Terrain } from '../world/terrain';
import { Mobs, TONE, showSlowed } from '../world/mobs';
import { GOLEM_SOUNDS, GolemView } from '../world/golem';
import { loadBoss } from '../assets/queue';
import { WarrensView } from '../world/warrens';
import { WarrensTracker, showKickCountdown, showWarrensGate, showWarrensInvite } from '../ui/warrens';
import { FxLayers } from '../world/fx-layers';
import { SKILL_POSE, battleSheets } from '../characters/battle-art';
import { cooldownOf, mpCostOf } from '../combat/cooldowns';
import { WorldSkills } from '../combat/world-skills';
import { SKILL_PREVIEWS } from '../combat/skill-previews';
import { skillSlots } from '../combat/skill-slots';
import { MobTargetBox } from '../ui/mob-target';
import { LEVEL_PX } from '../world/heights';
import { NightLife } from '../world/night-life';
import { type ArenaChannel, BotChannel, PlayerChannel } from '../arena/channel';
import { showArenaMenu } from '../arena/menu';
import { stopQueue } from '../arena/queue';
import type { ArenaData } from './ArenaScene';
import { Minimap } from '../ui/minimap';
import { type ActiveBuff, BuffTray } from '../ui/buff-tray';
import { buffStatLines } from '../ui/buff-text';
import { myBuffStats, myBuffs, setMyBuffs } from '../net/buffs';
import { type Bench, type Building, WorldObjects, characterDepth } from '../world/objects';
import { type SoundTapped, enterArenaSound, enterCasinoSound, hearFrom, leaveCasinoSound, loadSoundSets, loadWarrensSounds, playFrom, playSet, playSound, playWarrens, skillSet, soundSets, startTownSound, tapSounds } from '../audio/sound';
import type { AdventureData } from '../net/adventure';
import { Hotbar } from '../ui/hotbar';
import { mountClassSwitch } from '../ui/class-switch';
import { MOVES, type MoveKind, isMoveKind, moveTiles, playMove } from '../world/mobility';
import { changeClass, devItemsReady, devQuestKill, questReport, setQuestCounts, devSwitchClass, adventure, adventureData, anyDef, chooseClass, classInfo, initAdventure, itemData, itemDef, loadAdventureData, onAdventure, questDef, questFor, questTalk, setItems, setProgress, skillView, skillViews, buffViews } from '../net/adventure';
import { type StatsData, potionCooldownGroup, dropRefusal, nameColour, type Item, type QuestReward, type TownItems, LOOT_REACH, auraFor, classBuffs, classSkills, countOf, isGearDef, itemAura, itemStats, newItem, tradeRules } from '@mikazuki/shared';
import type { ClassArt } from '../assets/types';
import { drawRested, loadImages, poseFiles, restFiles } from '../characters/kit-art';
import { holdQuestBanners, mountQuests } from '../ui/quests';
import { openClassChoice } from '../ui/class-choice';
import { mountSkillPreview } from '../ui/skill-preview';
import { STAGE_H, STAGE_W, SkillStage } from '../combat/skill-stage';
import { NPC_PLACES } from '../world/npcs';
import { pick, tileRandom } from '../world/rng';

const MOVE_ACTIONS = ['up', 'left', 'down', 'right'];
const EMOTE_ACTIONS = EMOTE_KEYS.map((_, i) => `emote${i + 1}`);

// The playable town: ground, buildings, props and the player, all placed from manifest.json + maps/town.json.
// Right click to walk; left click a building to walk to its door, or a bench to sit (a tap does all of these).

/** Through the Warren Gate: the page changes this long after the warp starts (its sound, warrens-gate-warp, is 1 s), and
 *  after a ticket's sound the warp starts this long later. */
const WARP_MS = 1000;
const TICKET_MS = 300;
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
/** Battle: the classes that fight from afar (5 tiles; the rest from the next tile). A skill's cooldown: combat/cooldowns.ts. */
const RANGED_CLASSES = new Set(['slingshot', 'broom']);
const CAST_GAP_MS = 1000;
/** The golem's art loads once you're this near its pit's middle (tiles). */
const BOSS_NEAR = 45;
/** The Scrap Warrens' shade (a navy multiply of about a quarter: a little darker than the Slums). */
const WARRENS_TINT = 0xbcbbc8;
/** Only each class's first 7 skills have sounds (audio/sfx skill-<class>-<skill>-1…3); later ones play none yet. */
const SKILL_SOUNDS = 7;
const DIR_FOR_KEYS: Record<string, Dir> = {
  '0,-1': 'n', '0,1': 's', '1,0': 'e', '-1,0': 'w', '1,-1': 'ne', '-1,-1': 'nw', '1,1': 'se', '-1,1': 'sw',
};

/** The tile a player stands on to sit on a bench facing `faces`. */
const benchApproach = (b: Bench): Tile =>
  ({ se: { col: b.col + 1, row: b.row }, sw: { col: b.col, row: b.row + 1 }, ne: { col: b.col, row: b.row - 1 }, nw: { col: b.col - 1, row: b.row } })[
    b.faces as 'se' | 'sw' | 'ne' | 'nw'
  ] ?? { col: b.col, row: b.row + 1 };

/** The hotbar's cooldown key for an HP or MP Potion: its kind's, or the one they share (stats.json potions). */
const potionKeyOf = (S: StatsData, heals: 'hp' | 'mp') => `potion-${potionCooldownGroup(S, heals)}`;

export class TownScene extends Phaser.Scene {
  private M!: Manifest;
  private map!: TownMap;
  private outfit!: Outfit;
  private ground!: Ground | Terrain;
  private mobs: Mobs | null = null;
  /** Loot on the ground (battle maps). */
  private loot: LootLayer | null = null;
  get debugLoot(): LootLayer | null {
    return this.loot;
  }
  get debugMobs(): Mobs | null {
    return this.mobs;
  }
  /** The Slums' field boss (world/golem.ts), drawn as one of the mobs. */
  private golem: GolemView | null = null;
  /** Which area this page is: the town, the neighbourhood or the Slums. */
  private area: Area = 'town';
  private objects!: WorldObjects;
  private grid!: WalkGrid;
  private player!: Character;
  private doorAt = new Map<string, Building>();
  private pending: { sit?: Bench; npc?: string; loot?: string } | null = null;
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
  /** The buffs on you (ui/buff-tray.ts), under the HUD's buttons. */
  buffTray: BuffTray | null = null;
  private nextMinimap = 0;
  private lampsOn = false;
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
  /** The direction held last frame, to turn mid-step as soon as it changes. */
  private lastHeld: Dir | null = null;
  /** Plays an emote and tells the server (set once connected). */
  private emoteKeys: ((e: TownEmote) => void) | null = null;
  private others!: OtherPlayers;
  /** The town's ambient NPCs (not in the neighbourhood). */
  private npcs: NpcLife | null = null;
  private link: TownLink | null = null;
  /** The player menu's Info window (members with the bag). */
  private inspect: InspectWindow | null = null;
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
  private gateAt = new Map<string, Gate>();
  private bridges: (Phaser.GameObjects.Image | null)[] = [];
  /** The gates' signs (always shown, unlike the buildings' names). */
  private readonly gateLabels: BuildingLabel[] = [];
  /** Each gate sign, where it sits, and the buildings it was lifted over: while one of them shows its name (in the same
   *  spot), the sign steps aside. */
  private readonly gateSpots: { sign: BuildingLabel; y: number; over: Set<string> }[] = [];
  /** Each house's texture, redrawn after a new look (the key changes so the sprite picks it up). */
  private houseKeys = 0;
  /** Straight from building your house: it rises on its lot as you arrive. */
  private justBuilt = false;

  init(data: { manifest: Manifest; town: TownMap; me: MeResult | null; firstVisit?: boolean; hood?: TownHoodResponse; art?: HouseArt; built?: boolean; area?: Area }): void {
    this.firstVisit = !!data.firstVisit;
    this.justBuilt = !!data.built;
    this.M = data.manifest;
    this.map = data.town;
    this.me = data.me;
    this.hood = data.hood ?? null;
    this.area = data.area ?? (this.hood ? 'hood' : 'town');
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
    if (this.area === 'town') queueNpcs(this.load, this.textures, this.M);
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
    this.fxLayers = new FxLayers(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.fxLayers.clear());
    buildOutfit(this, this.M.characters, this.outfit);
    if (this.hood) this.addHouses();
    // A big map (the Slums) is streamed round the camera: its objects, ground and outskirts (world/terrain.ts).
    const big = !!this.map.height;
    this.objects = new WorldObjects(this, this.M, this.map, big);
    this.objects.castShadows = big; // the Slums' props came with no shadows
    const junk = big ? new SlumsOutskirts(this.M, this.map) : null;
    if (junk) this.objects.extra = (c0, r0, c1, r1) => junk.objectsIn(c0, r0, c1, r1);
    this.objects.onSpawn = (o) => this.tint >= 0 && o.setTint(this.tint);
    if (this.map.bridge) this.bridges.push(drawBridge(this, this.map.bridge));
    this.map.bridges?.forEach((b, i) => this.bridges.push(drawBridge(this, b.tiles, b.along, `bridge-${i}`)));
    for (const [to, tiles] of Object.entries(this.map.gates ?? {}) as [Gate, [number, number][]][]) for (const [c, r] of tiles) this.gateAt.set(`${c},${r}`, to);
    // The forest around the town fills what the camera can see past the map, without widening that view.
    const bounds = this.townBounds();
    // (The Slums: their junk and shanties instead, streamed, and raised ground: world/terrain.ts.)
    if (big) {
      const terrain = new Terrain(this, this.M, this.map, this.objects.heights, junk);
      terrain.onSpawn = (o) => this.tint >= 0 && o.setTint(this.tint);
      this.ground = terrain;
    } else {
      const forest = outskirts(this.M, this.map, bounds);
      this.ground = new Ground(this, this.M, this.map, forest.tiles);
      this.objects.addOutskirts(forest.objects);
    }
    this.nightLife = new NightLife(this, this.M, this.map, this.objects.lamps);
    this.grid = new WalkGrid(this.map);
    for (const b of this.objects.buildings) for (const [c, r] of b.doors) this.doorAt.set(`${c},${r}`, b);

    const [sc, sr] = this.map.spawn;
    this.player = new Character(this, this.M, this.outfit, { col: sc, row: sr });
    this.player.mine = true;
    this.player.depthFn = (c, r, d, b) => characterDepth(this.objects, c, r, d, b);
    this.player.elevation = (c, r) => this.objects.heights.lift(c, r);
    this.player.onArrive = (tile) => this.arrived(tile);
    this.player.nextStep = () => this.keyStep();
    this.player.onSpawn = (obj) => this.tint >= 0 && obj.setTint(this.tint);
    // Back through a gate: at its way in (town.json `arrive`), facing into the area, not the spawn point.
    const from = cameFrom();
    const arrive = from ? this.map.arrive?.[from] : undefined;
    this.gateAsked = from === 'warrens'; // (back out of the Warrens by the gate: its panel waits till you walk up to it again)
    if (arrive) this.player.place({ col: arrive[0], row: arrive[1] }, 'nw');
    // A fresh visit to the neighbourhood with a house there: at your door, facing the street.
    const mine = !from && this.hood?.houses.find((h) => h.mine);
    const door = mine && this.map.doors[`house-${mine.lot}`];
    if (door && !Array.isArray(door[0])) this.player.place({ col: door[0] as number, row: door[1] as number }, 'se');
    this.others = new OtherPlayers(this, this.M, this.objects, (obj) => this.tint >= 0 && obj.setTint(this.tint));
    this.others.restFor = (weapon, cls) => this.restArt(weapon, cls);
    this.others.auraFor = (plus) => {
      const D = itemData();
      return D && plus ? auraFor(D.stats, plus, { weapon: true }) : null;
    };
    // A battle map (one with mobs: the Slums): characters with a class in its battle poses.
    this.battleMap = !!this.map.mobZones?.length && !!this.M.classes;
    if (this.battleMap) this.others.battleFor = (cls, look) => battleSheets(this, this.M.characters, this.M.classes!, cls, look);
    // Each skill's reach (classes/skill-hits.json `range`, the same table the bot uses).
    if (this.battleMap)
      void fetch(`${import.meta.env.BASE_URL}assets/classes/skill-hits.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { range?: Record<string, number[]>; fxScale?: Record<string, number[]> } | null) => {
          this.skillRange = j?.range ?? {};
          this.fxScale = j?.fxScale ?? {};
        })
        .catch(() => null);
    if (this.area === 'town') this.npcs = this.makeNpcs();
    // The Slums' mobs (the zones that are on), sorted and tinted like everyone else.
    if (this.map.mobZones?.length) {
      const mobs = new Mobs(this, this.M, this.map, this.grid, this.objects, (obj) => this.tint >= 0 && obj.setTint(this.tint), this.fxLayers);
      mobs.myLevel = () => adventure()?.progress.level ?? 1; // name colours by the level gap
      const box = new MobTargetBox();
      mobs.onTarget = (m) => {
        box.show(m && { name: m.def.name, level: m.level, colour: TONE[mobs.tone(m)], zone: m.zone.name, hp: m.hp / m.maxHp, boss: m.radius > 0 });
        if (m) this.target?.clear(); // one target at a time
      };
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => box.destroy());
      this.mobs = mobs;
      // Its field boss, once its art is in (loaded in the background: it never holds up arriving).
      const boss = this.map.boss;
      if (boss && this.M.mobs?.[boss.id]) {
        const golem = new GolemView(this, this.map, mobs, this.fxLayers, { at: () => null, me: () => this.player.tile });
        this.golem = golem;
        // Its art once you come near its pit (BOSS_NEAR tiles); its messages before that keep its state.
        this.bossNear = (at) => {
          if (Math.max(Math.abs(at.col - boss.tile[0]), Math.abs(at.row - boss.tile[1])) > BOSS_NEAR) return;
          this.bossNear = null;
          void loadBoss(this, this.M, boss.id).then(() => this.golem === golem && golem.loaded());
        };
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
          golem.destroy();
          this.golem = null;
        });
      }
    }
    // A Scrap Warrens run: its shutters, seal, areas, boss moves and effects (world/warrens.ts).
    if (this.map.dungeon && this.mobs) {
      const view = new WarrensView(this, this.M, this.map, this.mobs, this.fxLayers, this.grid, this.ground instanceof Terrain ? this.ground : null, {
        me: () => this.player.tile,
        myBox: () => this.player.sprite.getBounds(),
        body: (id) => {
          const c = id === this.myId ? this.player : this.others.charOf(id);
          return c ? { x: c.sprite.x, y: c.sprite.y - 14 } : null;
        },
        onHit: (boss, target, hit, slow) => this.mobs?.hooks.onHit?.(boss as never, target, slow, hit),
      });
      this.warrens = view;
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        view.destroy();
        this.warrensTracker?.destroy();
        this.warrensTracker = null;
        this.warrens = null;
      });
    }
    // Loot on the ground (mobs' drops, and items players drop on any map): a click walks you to it and picks it up.
    const sil = this.M.ui.equipSlots;
    const loot = new LootLayer(this, this.objects, itemData, { kusing: this.M.ui.kusingIcon?.file ?? null, silhouettes: sil ? { file: sil.file, frames: sil.frames } : null });
    this.loot = loot;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => loot.destroy());
    // The race box's bet pop-up shows the runners' portraits wherever you are (the neighbourhood too, which has no NPCs).
    const P = this.M.npcs?.portrait;
    if (P) setRacePortraits((id) => `${import.meta.env.BASE_URL}assets/${P.file.replace('{id}', id)}`);

    this.setupCamera(bounds);
    this.streamWorld(true); // (a streamed map: what the first frame shows)
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
    this.warrenGateLabel();
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
    void this.setupQuests();
    // A Rename Card (the bag): your new name on your tag and in the HUD (everyone else hears it from the server).
    const renamed = (e: Event) => {
      const name = (e as CustomEvent<string>).detail;
      const me = this.me?.status === 'ok' ? this.me.me : null;
      if (me) me.nickname = name;
      this.player.setNameTag(name, me?.title ?? TOWNFOLK);
      setHudName(name);
    };
    addEventListener('mk-renamed', renamed);
    // A Bagong Buhay Ticket's Use in the bag: the class choice.
    const ticket = () => this.openClassTicket();
    addEventListener('mk-class-ticket', ticket);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => removeEventListener('mk-class-ticket', ticket));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => removeEventListener('mk-renamed', renamed));
    this.minimap = new Minimap(this.map); // in the HUD's corner, above its buttons
    const tray = new BuffTray({
      icon: (cls, name) => this.skillIcon(cls, name),
      effect: (cls, name) => classInfo(cls)?.buffs?.find((b) => b.name === name)?.effect ?? null,
      // Right-click: off you (the server sends your buffs again).
      remove: (name) => {
        if (!this.link?.send({ t: 'buff-off', buff: name })) return;
        playSound('click');
        toast(`${name} removed.`, 1600);
      },
    });
    this.buffTray = tray;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => tray.destroy());
    startTownSound(this, this.fountainTile(), this.area === 'slums' || this.area === 'warrens' ? 'slums' : 'town'); // (the Slums and the Warrens: the Slums' music, no crickets)
    if (this.area === 'slums' || this.area === 'warrens') loadWarrensSounds(); // (the gate's in the Slums)
    // A battle map's sounds: each mob kind's hurt and death, the golem's attacks (the classes' skills once their data is in).
    if (this.battleMap) {
      const kinds = new Set([...(this.map.mobZones ?? []).filter((z) => z.active && this.M.mobs?.[z.mob]).map((z) => z.mob), ...(this.map.boss ? [this.map.boss.id] : [])]);
      if (this.map.dungeon) kinds.add('scrapheap-golem'); // (the Scraplings)
      loadSoundSets([...[...kinds].flatMap((k) => [`combat-mob-hurt-${k}`, `combat-mob-death-${k}`]), ...(this.map.boss || this.map.dungeon ? GOLEM_SOUNDS.map((a) => `golem-${a}`) : [])]);
    }
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
    this.streamWorld();
    this.keyTurn();
    // Walking's groundwork, a few ms a frame until done (each tile's steps, where you can get to): no first-click hitch.
    this.grid.warmUp(this.player.heading, 3); // (done: returns at once; a fence or a new house starts it over)
    // Right-clicks since the last frame: only the latest is walked to (clicking fast never runs a search per click).
    if (this.clickTo) {
      const to = this.clickTo;
      this.clickTo = null;
      this.moveTo(to);
    }
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
    this.mobs?.update(delta);
    this.mobs?.check(this.player.tile);
    // Mob art (and the golem's) loads zone by zone as you come near (a quick look twice a second).
    if (this.mobs && time >= this.nearAt) {
      this.nearAt = time + 500;
      this.mobs.near(this.player.tile);
      this.bossNear?.(this.player.tile);
    }
    this.loot?.update();
    this.golem?.update();
    this.warrens?.update();
    if (this.area === 'slums' && time >= this.gateCheckAt) {
      this.gateCheckAt = time + 250;
      this.nearWarrenGate();
    }
    this.fightTick();
    this.fxLayers.update();
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
      this.minimap.draw({ me: this.player.tile, others: this.others.players.map((o) => ({ col: o.col, row: o.row, party: inParty(o.id) })), camera: { x: v.x, y: v.y, width: v.width, height: v.height } });
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
    this.mobs?.setZoom(zoom);
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
    // The forge popup's effects (fx/progress).
    setForgeArt({ success: strip(this.M.fx['fx-enhance-success']), fail: strip(this.M.fx['fx-enhance-fail']), break: strip(this.M.fx['fx-enhance-break']), embed: strip(this.M.fx['fx-agimat-embed']), disassemble: strip(this.M.fx['fx-disassemble']) });
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
      quest: this.M.ui.questIcon?.file ? asset(this.M.ui.questIcon.file) : null,
    });
  }

  /** A streamed map: makes the ground and objects near the camera, drops those far away. */
  /** A streamed map's ground and props near the view: a little each frame (`all`: everything the first frame shows). */
  private streamWorld(all = false): void {
    if (!(this.ground instanceof Terrain)) return;
    const view = this.cameras.main.worldView;
    this.ground.stream(view, all ? Infinity : 4);
    this.objects.stream(view, all ? Infinity : 4);
  }

  /** The tile drawn under a world point: on raised ground the highest one whose raised diamond is there. */
  private pickTile(x: number, y: number): Tile {
    const H = this.objects.heights;
    if (!H.flat) {
      for (let level = 2; level >= 0; level--) {
        const t = screenToTile(x, y + level * LEVEL_PX);
        if (this.grid.inBounds(t.col, t.row) && H.at(t.col, t.row) === level) return t;
      }
    }
    return screenToTile(x, y);
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
      // ?buffs=demo: your class's lasting buffs on you (their effect in words, as from classes.json), and a party member's
      // Battle Roar with pretend numbers running out in 40 s.
      if (new URLSearchParams(location.search).get('buffs') === 'demo') {
        this.buffDemo = true;
        this.demoBuffs();
      }
    }
  }

  /** Dev (?buffs=demo): the tray shows pretend buffs, not the server's. */
  private buffDemo = false;

  /** Dev: pretend buffs in the buff tray (?buffs=demo). */
  demoBuffs(): void {
    const c = classInfo(adventure()?.cls) ?? classInfo('slingshot');
    const now = Date.now();
    this.buffTray?.set([
      ...(c?.buffs ?? []).filter((b) => b.minutes || b.permanent).map((b): ActiveBuff => ({ cls: c!.id, name: b.name, endsAt: b.minutes ? now + b.minutes * 60_000 - 1000 : null, stats: [] })),
      { cls: 'greatstick', name: 'Battle Roar', endsAt: now + 40_000, stats: ['+8% Damage amp'] },
    ]);
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

  // ── Quests, classes and equipment ──

  private adventureReady: Promise<AdventureData | null> | null = null;

  /** The quest, class and equipment data; then (for members) your quests in the tracker and log, the marker over the
   *  quest giver, their lines, and your class badge and resting weapon. */
  private setupQuests(): Promise<void> {
    const Q = this.M.quests;
    const K = this.M.classes;
    const E = this.M.equipment;
    if (!Q || !K || !E) return Promise.resolve();
    const asset = (f: string) => `${import.meta.env.BASE_URL}assets/${f}`;
    this.adventureReady ??= loadAdventureData(asset, { quests: Q.file, classes: K.data, equipment: E.file, items: this.M.combatItems?.file }, this.cache.json.get('stats'), this.cache.json.get('leveling'));
    return this.adventureReady.then((data) => {
      if (!data) return void console.warn('[quests] the quests, classes, equipment or stats data is missing');
      // Each class's first 7 skills' sounds (heard from others too), on a battle map.
      if (this.battleMap) loadSoundSets(data.classes.flatMap((c) => c.skills.slice(0, SKILL_SOUNDS).map((k) => skillSet(c.id, k.name))));
      // Every item kind's art (gear and the rest), and the rarity colours every item name uses (stats.json).
      addItemArt(Object.fromEntries([...data.defs.values()].map((i) => [i.id, { icon: i.icon, showcase: i.showcase }])));
      setRarityColours(Object.fromEntries(Object.entries(itemStats(data.stats).rarity.nameColour).map(([r, c]) => [r, c.colour])));
      const kusing = this.M.ui.kusingIcon;
      setKusingArt(kusing ? asset(kusing.file) : null);
      const member = this.me?.status === 'ok' ? this.me.me : null;
      if (!member) return; // guests have no quests
      const { armor, rewards, pieces } = initAdventure(member.adventure, member.trainingGear, member.questRewards, member.questPieces);
      // Quest rewards given on this visit (a quest finished before it had any, a mini boss quest's piece): said after the
      // title card.
      if (rewards.length || pieces.length) this.time.delayedCall(titleCardMs() + 600, () => this.questRewards(rewards, pieces));
      // A class from before training armor: the Tanod's set, said once (after the title card).
      const body = armor.map(itemDef).find((i) => i?.slot === 'body') ?? itemDef(armor[0]);
      if (body) this.time.delayedCall(titleCardMs() + 600, () => toast('The Tanod left you a set of training gear.', 4500, 'good', gearPicture(body, asset)));
      const frame = this.M.ui.inventory?.itemFrame;
      mountQuests({ colours: Q.colours, frame: frame ? { url: asset(frame.file), slice: frame.nineSlice } : null, giver: (id) => this.giverOf(id), report: (id) => this.reportQuest(id) });
      // The Tanod's line as each quest of his is given (his leveling chain; also one given while you were away), once.
      this.time.delayedCall(titleCardMs() + 900, () => {
        this.giveReady = true;
        this.giveLines();
      });
      onAdventure(() => this.giveLines());
      if (this.npcs) this.npcs.script = (id) => this.questScript(id);
      const icons = this.M.ui.classIcons;
      const inv = this.M.ui.inventory;
      const url = (file: string) => `${import.meta.env.BASE_URL}assets/${file}`;
      const hotbar = new Hotbar({
        // HP and MP Potions: each kind's own cooldown (or the one they share: stats.json potions.separateCooldowns).
        potionKey: (id) => {
          const def = anyDef(id);
          const S = adventureData()?.stats;
          return S && !isGearDef(def) && def?.kind === 'potion' && def.heals ? potionKeyOf(S, def.heals) : null;
        },
        slot: inv?.slot && inv.selected && inv.nineSlice ? { url: url(inv.slot), picked: url(inv.selected), slice: inv.nineSlice } : null,
        badge: (cls) => (icons ? url(icons.file.replace('{class}', cls)) : ''),
        onSkill: (name) => this.mobility(name) ?? this.castBuff(name) ?? this.fight(name),
        // HP and MP Potions: the server heals and starts their shared cooldown (the town's `potion` message).
        onItem: (id) => {
          const def = anyDef(id);
          if (isGearDef(def) || def?.kind !== 'potion') return false;
          if (!countOf(adventure()?.bag ?? [], id)) {
            playSound('error');
            toast(`No ${def.name}s left. Get more at the sari-sari store.`, 2200, 'bad');
            return true;
          }
          this.link?.send({ t: 'potion', item: id });
          return true;
        },
        countOf: (id) => {
          const def = anyDef(id);
          return !isGearDef(def) && def?.kind === 'potion' ? countOf(adventure()?.bag ?? [], id) : undefined;
        },
        usable: (name) => this.battleMap || !!classInfo(adventure()?.cls)?.mobility?.some((m) => m.name === name),
        stage: (c) => this.skillStage(c.id, c.fx),
        icon: (cls, skill) => this.skillIcon(cls, skill),
      });
      this.hotbar = hotbar;
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => hotbar.root.remove());
      hotbar.setClass(classInfo(adventure()?.cls) ?? null);
      void this.applyBattle(adventure()?.cls ?? null);
      // Dev: ?switch shows a row of class badges to become any class at once (pretend login only).
      if (new URLSearchParams(location.search).has('switch') && fakeLogin() && icons) {
        const off = mountClassSwitch({ classes: data.classes, badge: (cls) => url(icons.file.replace('{class}', cls)), current: () => adventure()?.cls ?? null, pick: devSwitchClass });
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, off);
      }
      onAdventure((s) => {
        hotbar.setClass(classInfo(s.cls) ?? null);
        void this.applyBattle(s.cls);
        this.questMarkers();
        void this.wearWeapon(s.equipped.weapon?.defId, s.cls);
        this.player.setAura(s.equipped.weapon ? itemAura(data, s.equipped.weapon) : null); // +15 and up glows
        const c = classInfo(s.cls);
        setHudClass(c && icons ? { name: c.name, badge: asset(icons.small.replace('{class}', c.id)) } : null);
        setHudLevel(s.progress);
      });
    });
  }

  /** Dev: ?xp= / ?level= asked for once this visit (not again on a reconnect). */
  private devLevelled = false;
  /** Your HP and MP as the server last said (debug). */
  private vitalsNow: { hp: number; maxHp: number; mp: number; maxMp: number } | null = null;
  /** Dev: ?kusing= / ?whetstones= / ?give= asked for once this visit. */
  private devGiven = false;

  /** When to look again which zones' mob art to load (scene ms), and the golem's art's own look (null once asked). */
  private nearAt = 0;
  private bossNear: ((at: Tile) => void) | null = null;

  /** A map with mobs (the Slums): battle poses, and the damage skills hit mobs. */
  private battleMap = false;
  private skillRange: Record<string, number[]> = {};
  /** How big each skill's effects are drawn (skill-hits.json fxScale; 1 by default). */
  private fxScale: Record<string, number[]> = {};

  /** How far (tiles) a class's skill reaches (skill-hits.json; else the class's own reach). */
  private reachOf(cls: string, idx: number): number {
    return this.skillRange[cls]?.[idx] ?? (RANGED_CLASSES.has(cls) ? 5 : 1);
  }

  /** Your class's battle poses on a battle map (the doll without a class, or elsewhere). */
  private async applyBattle(cls: string | null): Promise<void> {
    if (!this.battleMap) return;
    const b = cls ? await battleSheets(this, this.M.characters, this.M.classes!, cls, this.outfit) : null;
    if ((adventure()?.cls ?? null) === cls) this.player.setBattle(b);
  }

  /**
   * A damage skill on a battle map: it auto-casts on your target (Z; else the nearest mob) whenever it's ready, walking
   * you into reach first (melee classes: next to it; the Slingshot, Broom and Hilot: within 5) and after it if it moves,
   * until it dies; moving yourself, Escape or the same skill again stop it, another damage skill takes over (its slot
   * glows meanwhile). Each cast faces it, plays the skill's attack pose and sends `attack` (the server decides the hit:
   * bot web/town-mobs.ts). Returns 'no' (the casts show their own cooldown), or undefined off a battle map.
   */
  private fight(name: string): number | 'no' | undefined {
    if (!this.battleMap || !this.mobs) return undefined;
    const c = classInfo(adventure()?.cls);
    const idx = c?.skills.findIndex((k) => k.name === name) ?? -1;
    if (!c || idx < 0) return undefined;
    if (this.knockedOut) return 'no';
    if (this.engage?.name === name) return this.stopFight(), 'no';
    if (skillView(name)?.locked) return 'no'; // (the bar says when it unlocks)
    let m = this.mobs.current;
    if (!m || m.dead) m = this.mobs.targetNext(this.player.tile);
    if (!m) {
      toast('No mob nearby. Walk up to one (Z picks the nearest).', 2200);
      return 'no';
    }
    this.engage = { name, idx, reach: this.reachOf(c.id, idx), goal: null };
    this.hotbar?.setAuto(name);
    this.fightTick();
    return 'no';
  }

  /** The auto-cast under way: which skill, its reach, and where we're walking to get in reach. */
  private hotbar: Hotbar | null = null;
  private engage: { name: string; idx: number; reach: number; goal: Tile | null } | null = null;
  /** When each damage skill can be cast again (scene time, ms). */
  private castReady = new Map<string, number>();
  /** No two casts closer than CAST_GAP_MS, whichever skills. */
  private nextCast = 0;

  /** A skill's effects (the preview's script, combat/world-skills.ts) from a character at a mob. */
  private castFx(cls: string, idx: number, who: Character, dir: Dir, hit: string[], land: (id: string) => void, landAll: () => void): void {
    const skill = SKILL_PREVIEWS[cls]?.[idx];
    const art = this.M.classes?.list[cls];
    const mobs = hit.map((id) => this.mobs?.list.find((x) => x.id === id)).filter((x) => !!x);
    if (!skill || !art || !mobs.length) return landAll();
    this.worldSkills ??= new WorldSkills(this.fxLayers, this.M.fx, (f) => `${import.meta.env.BASE_URL}assets/${f}`);
    // The script's slots in order get the hit mobs (the target first); the rest, the target.
    const slots = skillSlots(skill);
    const bySlot = (n: number) => mobs[Math.max(0, slots.indexOf(n))] ?? mobs[0];
    const feet = () => ({ x: who.sprite.x, y: who.sprite.y });
    // A hit on slot n lands its mob; the first also lands the mobs no slot shows (around a melee skill).
    const shown = new Set(slots.map((n) => bySlot(n).id));
    let first = true;
    const onHit = (n: number) => {
      land(bySlot(n).id);
      if (first) for (const m of mobs) if (!shown.has(m.id)) land(m.id);
      first = false;
    };
    void this.worldSkills.play(skill, art, { feet, dir, depth: () => who.sprite.depth, nudge: (x, y) => who.setNudge(x, y) }, (n) => {
      const m = bySlot(n);
      return { x: m.sprite.x, y: m.sprite.y };
    }, onHit, this.fxScale[cls]?.[idx] ?? 1);
  }
  private worldSkills: WorldSkills | null = null;

  /** A level up's effect (manifest fx-level-up-ring flat under their feet, fx-level-up-sparks rising off them), with
   *  "Level up!" over the head; both follow them for the moment it plays. */
  private levelUpFx(who: Character): void {
    const feet = () => ({ x: who.sprite.x, y: who.sprite.y });
    for (const id of ['fx-level-up-ring', 'fx-level-up-sparks']) this.fxLayers.play(this.M.fx[id], feet(), { follow: feet });
  }
  /** The world's effects: ground (under every player and mob) and front (over them): world/fx-layers.ts. */
  private fxLayers!: FxLayers;

  /** Toasts one after another (the Tanod's lines, a report's rewards), each for its time. */
  private say(text: string, ms: number, tone: 'good' | 'bad' | null, icon: HTMLElement | null): void {
    const at = Math.max(this.time.now, this.sayFree);
    this.sayFree = at + ms + 250;
    this.time.delayedCall(at - this.time.now, () => toast(text, ms, tone, icon));
  }
  private sayFree = 0;

  /** The Tanod's bust (manifest ui.tanodBust, its last frame: risen all the way) for his radio lines. */
  private tanodBust(): HTMLElement | null {
    const B = this.M.ui.tanodBust;
    if (!B) return null;
    const pic = document.createElement('span');
    const k = 40 / B.size[1];
    Object.assign(pic.style, {
      display: 'inline-block', flex: 'none', width: `${B.size[0] * k}px`, height: `${B.size[1] * k}px`, imageRendering: 'pixelated',
      background: `url("${import.meta.env.BASE_URL}assets/${B.file}") ${-(B.frames - 1) * B.size[0] * k}px 0 / ${B.size[0] * B.frames * k}px ${B.size[1] * k}px no-repeat`,
    });
    return pic;
  }

  /** A line from the Tanod over his radio. */
  private tanodSays(line: string): void {
    this.say(`Tanod: “${line}”`, Math.min(6000, 2600 + line.length * 40), null, this.tanodBust());
  }

  /** Each active quest's give line (dialogue.give), once per quest in this browser (localStorage mk_quests_given), held
   *  while a report is under way (its own lines come first). */
  private giveLines(): void {
    if (this.reporting || !this.giveReady) return;
    let given: string[] = [];
    try {
      given = JSON.parse(localStorage.getItem('mk_quests_given') ?? '[]');
    } catch {
      // none yet
    }
    const fresh = (adventure()?.quests.active ?? []).filter((p) => !given.includes(p.id) && questDef(p.id)?.dialogue?.give?.length);
    if (!fresh.length) return;
    for (const p of fresh) for (const line of questDef(p.id)!.dialogue!.give!) this.tanodSays(line);
    try {
      localStorage.setItem('mk_quests_given', JSON.stringify([...given, ...fresh.map((p) => p.id)].slice(-50)));
    } catch {
      // said again next time
    }
  }
  private reporting = false;
  /** (Not under the title card.) */
  private giveReady = false;

  /** The tracker's Report: over the Tanod's radio, his report line, then the rewards (+XP, +Kusing; the potions as
   *  "Gained" lines, the level-up from the town), then the next quest's line. False if it didn't go through. */
  private async reportQuest(id: string): Promise<boolean> {
    this.reporting = true;
    const r = await questReport(id);
    this.reporting = false;
    if (!r?.ok) {
      toast(r?.message ?? "Couldn't reach the Tanod's radio. Try again in a moment.", 2500, 'bad');
      return false;
    }
    for (const line of questDef(id)?.dialogue?.report ?? []) this.tanodSays(line);
    const parts = [r.xp ? `+${r.xp.toLocaleString('en-US')} XP` : '', r.kusing ? `+${r.kusing.toLocaleString('en-US')} Kusing` : ''].filter(Boolean);
    const coin = this.M.ui.kusingIcon;
    if (parts.length) this.say(parts.join(', '), 3500, 'good', coin ? Object.assign(document.createElement('img'), { src: `${import.meta.env.BASE_URL}assets/${coin.file}`, alt: '' }) : null);
    if (r.kusing) playSound('combat-coins');
    this.giveLines(); // the next one's
    return true;
  }

  /** A skill's icon (manifest ui.skillIcons: the class's, or the one every class shares, Dash), if there is one. */
  private skillIcon(cls: string, skill: string): string | null {
    const I = this.M.ui.skillIcons;
    const url = (file: string) => `${import.meta.env.BASE_URL}assets/${file}`;
    const slug = skill.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (I?.have[cls]?.includes(slug)) return url(I.file.replaceAll('{class}', cls).replace('{skill}', slug));
    return I?.shared?.skills.includes(slug) ? url(I.shared.file.replace('{skill}', slug)) : null; // one for every class (Dash)
  }

  /** Skills a level-up unlocked (from Lv `from` to `to`): a toast each with its icon, one after another, and a dot on
   *  the Skills button until it's opened. */
  private newSkills(from: number, to: number): void {
    const c = classInfo(adventure()?.cls);
    if (!c || to <= from) return;
    const fresh = [...classSkills(c), ...classBuffs(c)].filter((k) => k.unlock > from && k.unlock <= to);
    if (!fresh.length) return;
    this.hotbar?.markNew();
    fresh.forEach((k, i) =>
      this.time.delayedCall(1200 + i * 3400, () => {
        const file = this.skillIcon(c.id, k.name);
        const pic = file ? Object.assign(document.createElement('img'), { src: file, alt: '' }) : null;
        toast(`New skill unlocked: ${k.name}! Open Skills (${keyLabel('skills') || 'K'}) to put it on your hotbar.`, 3200, 'good', pic);
      }),
    );
  }

  /** A skill's MP at its level (stats.json skills.mpCost); 0 off battle maps, where skills are free. */
  private mpOf(name: string): number {
    const sk = skillView(name);
    const S = adventureData()?.stats;
    return this.battleMap && sk && S ? mpCostOf(S, adventure()?.cls, sk, sk.level) : 0;
  }

  /** Whether you have the MP for a skill now (as last heard; the server decides). */
  private canPay(name: string): boolean {
    const need = this.mpOf(name);
    return need <= 0 || !this.vitalsNow || this.vitalsNow.mp >= need;
  }

  /**
   * MP running low (under `need` for a skill, or a quarter of your most): an MP Potion from the combat bag drinks itself
   * when the potions' shared cooldown is ready (battle maps; the server heals and starts the cooldown as for a click).
   * `say`: tell them when there's none to drink.
   */
  private lowMp(need: number, say = false): void {
    const v = this.vitalsNow;
    if (!this.battleMap || !v || this.knockedOut) return;
    if (v.mp >= need && v.mp >= v.maxMp / 4) return;
    const now = this.time.now;
    const potion = (adventure()?.bag ?? []).find((i) => {
      const d = anyDef(i.defId);
      return !isGearDef(d) && d?.kind === 'potion' && d.heals === 'mp' && i.count > 0;
    });
    const S = adventureData()?.stats;
    const ready = S ? (this.potionReady.get(potionKeyOf(S, 'mp')) ?? 0) : 0;
    if (potion && v.mp < v.maxMp && now >= ready && now >= this.autoPotionAt) {
      this.autoPotionAt = now + 1000; // (once a second at most, while the server answers)
      this.link?.send({ t: 'potion', item: potion.defId });
      return;
    }
    if (v.mp < need && (say || now >= this.noMpToldAt)) {
      this.noMpToldAt = now + 4000;
      toast(potion ? 'Not enough MP. Your MP Potions are cooling down.' : 'Not enough MP.', 1600, 'bad');
    }
  }
  /** When each potion cooldown is over (scene time, by potionKeyOf), as the server last said. */
  private readonly potionReady = new Map<string, number>();
  private autoPotionAt = 0;
  private noMpToldAt = 0;

  private stopFight(): void {
    if (!this.engage) return;
    this.engage = null;
    this.hotbar?.setAuto(null);
  }

  /** Every frame while auto-casting: in reach, cast when ready; out of it, walk to a spot in reach (again if it moved). */
  private fightTick(): void {
    const e = this.engage;
    if (!e) return;
    if (this.knockedOut) return this.stopFight();
    const m = this.mobs?.current;
    if (!m || m.dead) return this.stopFight(); // dead (or let go): done
    if (this.player.busy || this.player.isSitting || this.inside) return;
    const me = this.player.tile;
    const at = { col: Math.floor(m.col), row: Math.floor(m.row) };
    // (To the golem: to its body's edge, as the server measures it.)
    const dist = (t: Tile) => (m.radius ? Math.max(0, Math.hypot(t.col - at.col, t.row - at.row) - m.radius) : Math.max(Math.abs(t.col - at.col), Math.abs(t.row - at.row)));
    // In reach of the chosen skill, or (while it cools down) of another that's ready.
    const c0 = classInfo(adventure()?.cls);
    const open = (n: string) => !skillView(n)?.locked; // (locked skills never cast: the server refuses them)
    const readyNow = (n: string) => this.time.now >= (this.castReady.get(n) ?? 0) && open(n);
    const reachable = c0 ? c0.skills.filter((k, i) => readyNow(k.name) && this.reachOf(c0.id, i) >= dist(me)).length : 0;
    if (dist(me) <= e.reach || (!readyNow(e.name) && reachable)) {
      if (this.player.isIdle === false) this.player.cancelPath(); // stop on this tile
      e.goal = null;
      const now = this.time.now;
      if (!this.player.isIdle || now < this.nextCast) return;
      // The chosen skill, or while it's cooling down the first damage skill that's ready (the bar's order, then the class's).
      const c = classInfo(adventure()?.cls);
      if (!c) return this.stopFight();
      const inReach = (n: string) => now >= (this.castReady.get(n) ?? 0) && open(n) && this.reachOf(c.id, c.skills.findIndex((k) => k.name === n)) >= dist(me);
      const ready = (n: string) => inReach(n) && this.canPay(n);
      const damage = new Set(c.skills.map((k) => k.name));
      const order = [...(this.hotbar?.skillOrder() ?? []).filter((n) => damage.has(n)), ...c.skills.map((k) => k.name)];
      // Not enough MP for the chosen one: an MP Potion if there's one (auto), meanwhile whatever else is ready.
      if (inReach(e.name) && !this.canPay(e.name)) this.lowMp(this.mpOf(e.name));
      const name = ready(e.name) ? e.name : order.find(ready);
      if (!name) return;
      const idx = c.skills.findIndex((k) => k.name === name);
      // Its cooldown at its skill level (1% less a level; the server holds it to the same).
      const sk = skillView(name);
      const S = adventureData()?.stats;
      const cd = (sk && S ? cooldownOf(S, sk, sk.level) : 1) * (1 - (myBuffStats().cooldownPct ?? 0)); // (Calm Mind)
      this.castReady.set(name, now + cd * 1000);
      this.nextCast = now + CAST_GAP_MS;
      const dir = dirToward(m.sprite.x - this.player.sprite.x, m.sprite.y - this.player.sprite.y);
      this.player.strike(SKILL_POSE[idx] ?? 'attack-quick', dir); // (its effects come with the server's answer)
      if (idx < SKILL_SOUNDS) playSet(skillSet(c.id, name)); // your skill fires (its hits: combat-hit as they land)
      this.link?.send({ t: 'attack', mob: m.id, skill: idx });
      this.hotbar?.cooldown(name, cd);
      return;
    }
    // Out of reach: to the nearest open tile in reach of it (again if it has moved off our goal's reach).
    if (e.goal && dist(e.goal) <= e.reach && !this.player.isIdle) return;
    const spots: Tile[] = [];
    const span = e.reach + Math.ceil(m.radius);
    for (let dr = -span; dr <= span; dr++) for (let dc = -span; dc <= span; dc++) {
      const t = { col: at.col + dc, row: at.row + dr };
      if ((dc || dr) && dist(t) <= e.reach && this.grid.walkable(t.col, t.row) && this.objects.heights.at(t.col, t.row) === this.objects.heights.at(at.col, at.row)) spots.push(t);
    }
    spots.sort((a, b) => Math.hypot(a.col - me.col, a.row - me.row) - Math.hypot(b.col - me.col, b.row - me.row));
    for (const t of spots.slice(0, 6)) {
      if (this.walkTo(t)) {
        e.goal = t;
        return;
      }
    }
    toast("Can't reach it from here.", 1800);
    this.stopFight();
  }

  /** When each buff can be cast again (scene time, ms; the server's word wins). */
  private buffReady = new Map<string, number>();

  /**
   * A hotbar buff (stats.json skills.buffs): the server decides (bot web/town-buffs.ts). On a battle map you play your
   * class's buff-cast facing where you face as it goes; a one-ally buff goes to the selected player if they're in your
   * party (the server takes the nearest otherwise). Off a battle map it's sent all the same, so the server says why not.
   * Returns its cooldown in seconds, 'no', or undefined for a skill that isn't one of your buffs.
   */
  private castBuff(name: string): number | 'no' | undefined {
    const c = classInfo(adventure()?.cls);
    if (!c?.buffs?.some((b) => b.name === name)) return undefined;
    const sk = skillView(name);
    if (!sk || sk.locked || this.knockedOut) return 'no'; // (the bar says when it unlocks)
    const now = this.time.now;
    if (now < (this.buffReady.get(name) ?? 0)) return 'no';
    const picked = this.target?.selectedId;
    const target = picked ?? undefined; // whoever you've clicked, in your party or not
    if (!this.battleMap) {
      this.link?.send({ t: 'buff', buff: name });
      return 'no';
    }
    if (!this.canPay(name)) {
      this.lowMp(this.mpOf(name), true);
      return 'no';
    }
    const S = adventureData()?.stats;
    const cd = S ? cooldownOf(S, sk, sk.level) : 1;
    this.buffReady.set(name, now + cd * 1000);
    this.player.strike('buff-cast', this.player.facing);
    this.link?.send({ t: 'buff', buff: name, ...(target ? { target } : {}) });
    return cd;
  }

  /** When each mobility move can be used again (scene time, ms). */
  private moveReady = new Map<MoveKind, number>();

  /**
   * A hotbar skill: your class's Dash or Lv 8 move (world/mobility.ts) along the way you face. Its tiles go to the
   * server as steps (no more than the step budget allows) after a `move` message for the others. Returns the cooldown
   * in seconds, 'no' if it can't go now, or undefined for a skill that has no use in town yet.
   */
  private mobility(name: string): number | 'no' | undefined {
    const c = classInfo(adventure()?.cls);
    const kind = c?.mobility?.find((m) => m.name === name)?.id;
    if (!kind || !isMoveKind(kind)) return undefined;
    const sk = skillView(name);
    if (!sk || sk.locked) return 'no'; // (from its unlock level: the bar says when; the town ignores it before)
    const now = this.time.now;
    if (now < (this.moveReady.get(kind) ?? 0) || this.player.busy || this.player.isSitting || this.inside || this.knockedOut) return 'no';
    if (!this.canPay(name)) {
      this.lowMp(this.mpOf(name), true);
      return 'no';
    }
    const dir = this.player.facing;
    const tiles = moveTiles(this.grid, this.player.heading, dir, kind, Math.floor(this.stepBudget()) - 1);
    const end = tiles[tiles.length - 1];
    if (!end) {
      toast("Something's in the way.", 1600);
      return 'no';
    }
    this.pending = null;
    this.byKeys = true; // landing on a door waits for E
    this.setBuildingAlert(null);
    this.link?.send({ t: 'move', move: kind, col: end.col, row: end.row });
    for (const t of tiles) this.player.onStep?.(t);
    void playMove(this, this.M, this.player, kind, end, tiles.length, dir, (o) => this.tint >= 0 && o.setTint(this.tint), (set) => playSet(set)).then(() => this.arrivedQuietly());
    // Its cooldown at its skill level (1% less a level).
    const S = adventureData()?.stats;
    const cd = S ? cooldownOf(S, sk, sk.level) : MOVES[kind].cooldown;
    this.moveReady.set(kind, now + cd * 1000);
    return cd;
  }

  /** After a move: a door or gate you landed on is noticed like after walking there with the keys. */
  private arrivedQuietly(): void {
    const t = this.player.tile;
    const building = this.doorAt.get(`${t.col},${t.row}`);
    this.setBuildingAlert(building ?? null);
    const gate = this.gateAt.get(`${t.col},${t.row}`);
    if (gate) this.travel(gate);
  }

  /** A quest giver's name and portrait (for the quest log). */
  private giverOf(id: string): { name: string; portrait: string; mirror: boolean } | null {
    const P = this.M.npcs?.portrait;
    if (!P) return null;
    const text = (this.cache.json.get('npc-dialogue') as { npcs?: Record<string, { name: string }> } | undefined)?.npcs?.[id];
    return { name: text?.name ?? id, portrait: `${import.meta.env.BASE_URL}assets/${P.file.replace('{id}', id)}`, mirror: NPC_PLACES.find((p) => p.id === id)?.portrait === 'sw' };
  }

  /** A "!" over an NPC you're to talk to for a quest, a "…" over one waiting on you, in the quest's colour. */
  private questMarkers(): void {
    if (!this.npcs || !this.M.quests) return;
    for (const id of Object.keys(this.npcs.positions)) {
      const q = questFor(id);
      const o = q && q.quest.objectives[q.step];
      this.npcs.setMarker(id, q && o ? { symbol: o.type === 'talk' ? '!' : '…', color: this.M.quests.colours[q.quest.type] } : null);
    }
  }

  /** An NPC's lines while a quest of theirs is on: the talk (then the next objective), or a reminder. */
  private questScript(id: string): { lines: string[]; onDone?: () => void } | null {
    const q = questFor(id);
    if (!q) return null;
    const { quest, step } = q;
    const o = quest.objectives[step];
    const d = quest.dialogue ?? {};
    const chooseNext = () => quest.objectives[step + 1]?.type === 'chooseClass' && this.openClasses(quest.id, id);
    if (o.type === 'talk' && d.talk?.length) {
      return {
        lines: d.talk,
        onDone: () =>
          void questTalk(quest.id, id).then((r) => {
            if (!r?.ok) return toast(r?.message ?? "Couldn't reach the bot. Try again in a moment.", 3000, 'bad');
            chooseNext();
          }),
      };
    }
    if (o.type === 'chooseClass') return { lines: d.remind?.length ? d.remind : ['…'], onDone: () => void this.openClasses(quest.id, id) };
    return null;
  }

  /** The class choice window, with `onChoose` deciding what a choice does (true once it's done). */
  private async showClassChoice(onChoose: (c: ClassInfo) => Promise<boolean>): Promise<void> {
    const data = adventureData();
    const K = this.M.classes;
    const icons = this.M.ui.classIcons;
    if (!data || !K || !icons) return;
    const asset = (f: string) => `${import.meta.env.BASE_URL}assets/${f}`;
    const C = this.M.characters;
    await loadImages(this, data.classes.flatMap((c) => (K.list[c.id] ? restFiles(K.list[c.id]) : [])));
    const frame = this.M.ui.inventory?.itemFrame;
    openClassChoice({
      classes: data.classes,
      badge: (cls, size) => asset((size === 16 ? icons.small : size === 64 ? icons.large : icons.file).replace('{class}', cls)),
      frame: frame ? { url: asset(frame.file), slice: frame.nineSlice } : null,
      drawResting: (ctx, cls, anim, dir, f, t) => drawRested(ctx, this, C, K, this.outfit, K.list[cls] ?? null, anim, dir, f, t),
      idle: { frames: C.animations.idle.frames, fps: C.animations.idle.fps },
      walk: { frames: C.animations.walk.frames, fps: C.animations.walk.fps },
      // (Each skill's level and cap at your level: "Lv 1 / 10"; your own class's as raised.)
      preview: (c, host, back, choose) => mountSkillPreview({ stage: (cls) => this.skillStage(cls.id, cls.fx), levels: skillViews, buffs: buffViews, icon: (cls, skill) => this.skillIcon(cls, skill) }, c, host, back, choose),
      onChoose,
      onClose: () => {},
    });
  }

  /** A Bagong Buhay Ticket used from the bag: the class choice, and the pick becomes your class (the bot spends the ticket). */
  private openClassTicket(): void {
    const asset = (f: string) => `${import.meta.env.BASE_URL}assets/${f}`;
    void this.showClassChoice(async (c) => {
      if (c.id === adventure()?.cls) {
        toast("That's already your class. Pick another one.", 2400, 'bad');
        return false;
      }
      const r = await changeClass(c.id);
      if (!r?.ok) {
        toast(r?.error ?? "Couldn't reach the bot. Try again in a moment.", 3000, 'bad');
        return false;
      }
      const item = itemDef(r.adventure.equipped.weapon?.defId);
      toast(`A fresh start: you're a ${c.name} now!`, 3500, 'good', item ? gearPicture(item, asset) : null);
      dispatchEvent(new Event('mk-bag-changed')); // the bag shows one ticket fewer
      return true;
    });
  }

  /** Quest rewards just given: a "Gained Low HP Potion ×20" line each in your own system feed (as loot's), and the
   *  pickup sound. */
  private questRewards(rewards: QuestReward[], pieces: Item[] = []): void {
    const D = itemData();
    if (!D) return;
    for (const r of rewards) {
      const def = D.defs.get(r.item);
      const line = def && pickupOf({ item: newItem(D.stats, def, 'reward', r.count) });
      if (line) this.feed?.mine(line.parts);
    }
    // A mini boss quest's piece: "Gained Hemp Robe +5 (2 slots)", and a toast so it's not missed.
    for (const p of pieces) {
      const line = pickupOf({ item: p });
      if (line) this.feed?.mine(line.parts);
      toast(`Quest reward: ${nameOf(p)}. It's in your bag (Combat tab).`, 3500, 'good');
    }
    playSound('combat-loot-pickup');
  }
  private feed: SystemFeed | null = null;

  /** The class choice (for a quest's chooseClass objective, given by `giver`). */
  private async openClasses(questId: string, giver: string): Promise<void> {
    const asset = (f: string) => `${import.meta.env.BASE_URL}assets/${f}`;
    await this.showClassChoice(async (c) => {
        holdQuestBanners(true); // the giver has a last line first
        const r = await chooseClass(questId, c.id);
        if (!r?.ok) {
          holdQuestBanners(false);
          toast(r?.message ?? "Couldn't reach the bot. Try again in a moment.", 3000, 'bad');
          return false;
        }
        // "Received": the training weapon, then the armor (one toast, with the body piece).
        const item = itemDef(r.given);
        if (item) toast(`Received: ${item.name}`, 3000, 'good', gearPicture(item, asset));
        const body = r.gear?.map(itemDef).find((i) => i?.slot === 'body') ?? itemDef(r.gear?.[0]);
        if (body) this.time.delayedCall(item ? 3200 : 0, () => toast('Received: Training gear', 3500, 'good', gearPicture(body, asset)));
        const lines = (questDef(questId)?.dialogue?.complete ?? []).map((l) => l.replaceAll('{class}', c.name));
        if (this.npcs && lines.length) this.npcs.talk(giver, this.player.tile, { lines, after: () => holdQuestBanners(false) });
        else holdQuestBanners(false);
        return true;
    });
  }

  /** The skill preview's stage for a class, once its poses and fx have loaded. */
  private async skillStage(cls: string, fxFolder: string): Promise<SkillStage | null> {
    const K = this.M.classes;
    const art = K?.list[cls];
    if (!K || !art) return null;
    const asset = (f: string) => `${import.meta.env.BASE_URL}assets/${f}`;
    // The class's fx, and the mobility moves' (shared by every class).
    const fx = Object.values(this.M.fx).filter((f) => f.file?.startsWith(`${fxFolder}/`) || f.file?.startsWith('fx/mobility/')).map((f) => f.file!);
    await loadImages(this, [...poseFiles(art), ...fx, ...this.M.tiles.grass.files]);
    const launch = art.launch
      ? await fetch(asset(art.launch)).then((r) => (r.ok ? r.json() : null)).then((j) => j?.points ?? null).catch(() => null)
      : null;
    return new SkillStage({ scene: this, C: this.M.characters, K, outfit: this.outfit, art, fx: this.M.fx, launch, ground: this.previewGround() });
  }

  /** The skill preview's ground: the town's grass in the night's tint. */
  private previewGround(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = STAGE_W;
    c.height = STAGE_H;
    const ctx = c.getContext('2d')!;
    const G = this.M.tiles.grass;
    const [ax, ay] = G.anchor;
    for (let r = -12; r < 24; r++) {
      for (let col = -12; col < 24; col++) {
        const x = (col - r) * 16 + STAGE_W / 2;
        const y = (col + r) * 8 - 40;
        if (x < -40 || x > STAGE_W + 40 || y < -40 || y > STAGE_H + 40) continue;
        const file = pick(G.files, tileRandom(col, r, 3));
        if (!this.textures.exists(file)) continue;
        ctx.drawImage(this.textures.get(file).getSourceImage() as CanvasImageSource, Math.round(x - ax), Math.round(y + 8 - ay));
      }
    }
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `#${skyAt(0).tint.toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    return c;
  }

  /** A worn weapon's resting art (its sheets loaded): the weapon's class, else the wearer's. */
  private async restArt(weapon: string | null | undefined, cls: string | null | undefined): Promise<ClassArt | null> {
    if (!weapon) return null;
    await this.adventureReady;
    const id = itemDef(weapon)?.class ?? cls;
    const art = id ? this.M.classes?.list[id] : undefined;
    if (!art) return null;
    await loadImages(this, restFiles(art));
    return art;
  }

  private worn: string | null = null;
  /** Your resting weapon's art (the equipment panel draws it too). */
  private wornArt: ClassArt | null = null;

  /** Your resting weapon in town (others see it through the server's kit message). */
  private async wearWeapon(weapon: string | undefined, cls: string | null): Promise<void> {
    const key = weapon ?? null;
    if (this.worn === key) return;
    this.worn = key;
    const art = await this.restArt(key, cls);
    if (this.worn !== key) return;
    this.wornArt = art;
    this.player.setRestingWeapon(art, this.M.classes?.bodyOffset);
  }

  // ── Other players ──

  /** Joins the live town: others appear, the player's steps, turns and seats are passed on, and the chat opens. */
  private connect(): void {
    const link = new TownLink(this.outfit, this.area);
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
    // The picked player's buffs under their box: asked now and every 2 s while they're picked.
    if (this.target) {
      const target = this.target;
      let ask = 0;
      target.onPick = (id) => {
        clearInterval(ask);
        if (!id) return;
        const send = () => this.link?.send({ t: 'buffs-of', id });
        send();
        ask = window.setInterval(send, 2000);
      };
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => clearInterval(ask));
    }
    this.others.onChange = () => {
      online.update([me, ...this.others.players.map((p) => ({ name: p.nickname, title: p.title }))]);
      this.target?.check((id) => this.others.has(id));
      this.inspect?.check((id) => this.others.has(id));
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
    // The equipment panel, on the bag's left (it opens and closes with it).
    const K = this.M.classes;
    const icons = this.M.ui.classIcons;
    const sil = this.M.ui.equipSlots;
    if (bag && K) {
      const C = this.M.characters;
      bag.attachEquipment(
        new EquipmentPanel({
          frame: inv?.itemFrame ? { url: url(inv.itemFrame.file), slice: inv.itemFrame.nineSlice } : null,
          slot: inv?.slot && inv.selected && inv.nineSlice ? { url: url(inv.slot), picked: url(inv.selected), slice: inv.nineSlice } : null,
          silhouettes: sil ? { url: url(sil.file), frames: sil.frames } : null,
          badge: (cls) => (icons ? url(icons.small.replace('{class}', cls)) : ''),
          drawDoll: (ctx, dir, f, t) => drawRested(ctx, this, C, K, this.outfit, this.wornArt, 'idle', dir, f, t),
          idle: { frames: C.animations.idle.frames, fps: C.animations.idle.fps },
          freeSlots: () => bag.free,
        }),
      );
      // The player menu's Info: someone's character, gear and stats (ui/inspect.ts; the server answers `inspect`).
      const inspect = new InspectWindow({
        frame: inv?.itemFrame ? { url: url(inv.itemFrame.file), slice: inv.itemFrame.nineSlice } : null,
        slot: inv?.slot && inv.selected && inv.nineSlice ? { url: url(inv.slot), picked: url(inv.selected), slice: inv.nineSlice } : null,
        badge: (cls) => (icons ? url(icons.small.replace('{class}', cls)) : ''),
        drawDoll: (id, ctx, dir, f, t) => {
          const d = this.others.dollOf(id);
          if (d) drawRested(ctx, this, C, K, d.look, d.rest, 'idle', dir, f, t);
          return !!d;
        },
        idle: { frames: C.animations.idle.frames, fps: C.animations.idle.fps },
        ask: (id) => !!this.link?.send({ t: 'inspect', id }),
      });
      this.inspect = inspect;
      if (this.target) this.target.onInfo = (p) => inspect.show(p);
    }
    tools.append(online.el, emotePicker(sheet, emote));
    if (bag) document.body.append(bag.button); // its own button, just right of the chat box
    // Trading (ui/trade.ts): the player menu's Trade within range (stats.json trading), the window beside the bag.
    const tradeWin = bag
      ? new TradeWindow(
          inv?.itemFrame ? { url: url(inv.itemFrame.file), slice: inv.itemFrame.nineSlice } : null,
          inv?.slot && inv.selected && inv.nineSlice ? { url: url(inv.slot), picked: url(inv.selected), slice: inv.nineSlice } : null,
          link,
          () => bag.openForTrade(),
        )
      : null;
    if (this.target && tradeWin) {
      this.target.trade = {
        get range() {
          const data = itemData();
          return data ? tradeRules(data.stats).range : 0;
        },
        distance: (id) => {
          const o = this.others.players.find((x) => x.id === id);
          const me = this.player.tile;
          return o ? Math.max(Math.abs(o.col - me.col), Math.abs(o.row - me.row)) : null;
        },
        busy: trading,
        ask: (p) => tradeWin.ask(p.id, p.nickname),
      };
    }
    const chat = new ChatBox((text, channel, links) => link.send({ t: 'say', text, ...(channel === 'megaphone' ? { megaphone: true } : channel === 'party' ? { party: true } : channel === 'gm' ? { gm: true } : {}), ...(links.length ? { links } : {}) }), tools);
    // Items shown in chat lines: their name in their rarity's colour; a click opens their tooltip beside it (any click
    // elsewhere, or Escape, closes it).
    const itemTip = new SkillTip();
    chat.itemColour = (item) => {
      const D = itemData();
      return D ? nameColour(D, item) : '#fff';
    };
    chat.showItem = (item, anchor) => itemTip.show(itemTipFor(item), anchor);
    document.addEventListener('pointerdown', (e) => !(e.target as Element | null)?.closest?.('.ch-item') && itemTip.hide(), true);
    addEventListener('keydown', (e) => e.key === 'Escape' && itemTip.hide());
    // Parties (net/party.ts): the panel on the left for members, pink names for your party (on your screen only).
    setPartyLink(link);
    this.others.inParty = inParty;
    if (member) {
      const C = this.M.characters;
      new PartyPanel({
        portrait: async (o) => {
          const look = sanitize(C, o, this.outfit);
          await loadOutfit(this, C, look);
          return headPortrait(this, C, look, 20);
        },
        badge: (cls) => {
          const c = classInfo(cls);
          const icons = this.M.ui.classIcons;
          return c && icons ? { url: `${import.meta.env.BASE_URL}assets/${icons.small.replace('{class}', c.id)}`, name: c.name } : null;
        },
      });
    }
    onParty(() => {
      this.others.refreshParty();
      this.player.setParty(!!party());
    });
    // A player's class badge before their name in the chat (yours from your quests, others' from the town).
    chat.badgeFor = (from, id) => {
      const icons = this.M.ui.classIcons;
      const c = classInfo(from === 'me' ? adventure()?.cls : id ? this.others.classOf(id) : null);
      return c && icons ? { url: `${import.meta.env.BASE_URL}assets/${icons.small.replace('{class}', c.id)}`, name: c.name } : null;
    };
    // Megaphone messages run across the screen (with the megaphone's art, if it's there).
    const megaphone = this.banner();
    // Members can click someone's name in the chat: the player menu opens beside it (if they're still in town).
    const target = this.target;
    if (target) {
      chat.onName = ({ id, name }, anchor) => {
        // By the line's town id, else by name: ids change with every reload or gate, so an older line's may be stale.
        const p = (id ? this.others.players.find((o) => o.id === id) : undefined) ?? this.others.players.find((o) => o.nickname === name);
        if (p) {
          this.mobs?.setTarget(null);
          target.selectAt(p, anchor);
        }
        else chat.notice(`${name} isn't here right now.`); // (gone, or in another area: chat reaches every area)
      };
    }
    const feed = new SystemFeed();
    this.feed = feed;
    // A quest's rewards as it's completed: "Gained" lines, like loot.
    onAdventure((_s, change) => {
      if (change.rewards?.length || change.pieces?.length) this.questRewards(change.rewards ?? [], change.pieces ?? []);
    });
    // Members earn a Kowen for every 15 minutes in town (claimed from a pop-up above the feed).
    const stay = member ? new StayReward() : null;
    let myId = '';
    let arrived = false;
    // A mob's (or the golem's) attack on someone as it lands: the server's roll over them (red on you; "Miss"), a red
    // flash on a hit, and the Bag's slow (half your walking speed for its ms; the server holds your steps to it).
    const charOf = (id: string) => (id === myId ? this.player : this.others.charOf(id));
    if (this.mobs) {
      this.mobs.playerAt = (id) => {
        const c = charOf(id);
        return c ? { x: c.sprite.x, y: c.sprite.y } : null;
      };
      if (this.golem) {
        this.golem.players.at = (id) => {
          const c = charOf(id);
          return c ? { feet: { x: c.sprite.x, y: c.sprite.y }, head: { x: c.sprite.x, y: c.headY } } : null;
        };
      }
      this.mobs.hooks.onHit = (_m, target, slow, hit) => {
        const who = charOf(target);
        if (!who || who.knockedOut) return;
        const mine = target === myId;
        if (hit?.miss) return who.hitNumber('Miss', mine);
        who.hurt();
        if (hit) who.hitNumber(String(hit.damage), mine);
        if (mine && hit) playSet('combat-player-hurt');
        if (!slow) return;
        showSlowed(this.fxLayers, () => ({ x: who.sprite.x, y: who.headY }), () => ({ x: who.sprite.x, y: who.sprite.y }), slow);
        if (mine) this.slowMe(slow);
      };
    }
    /** Someone (maybe you) says a diss, praise or judge line: a speech bubble and a tagged line in the chat. */
    const verdict = (id: string, kind: 'roast' | 'praise', judged: boolean, text: string) => {
      const mine = id === myId;
      const char = mine ? this.player : this.others.charOf(id);
      if (char && bubbles) char.say(text, bubbles);
      chat.verdict(mine ? (member?.nickname ?? 'You') : (this.others.nameOf(id) ?? 'Someone'), kind, judged, text, mine ? undefined : id);
      if (!mine) playSound('chat');
    };
    this.player.onStep = (to) => {
      this.stepBudget(1);
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
        if (m.reason === 'party') return chat.notice("You're not in a party. Invite someone from their menu, or /g for general chat.");
        if (m.reason === 'gm') return chat.notice('Only Game Masters can use the GM channel.');
        return chat.notice(m.reason === 'slow' ? "You're chatting a bit fast. Wait a moment." : "That message can't be sent.");
      }
      if (m.t === 'say') {
        // Your own words come back from the server like everyone else's, so you see what they see.
        const name = m.id === myId ? (member?.nickname ?? 'You') : (this.others.nameOf(m.id) ?? m.name ?? 'Someone');
        if (m.megaphone || m.gm) megaphone.show(name, m.text, !!m.gm);
        const kind = m.gm ? 'gm' : m.megaphone;
        if (m.id === myId) {
          if (bubbles) this.player.say(m.text, bubbles);
          if (m.megaphone) window.dispatchEvent(new Event('mk-wallet')); // one megaphone fewer in the bag
          return chat.add(name, m.text, 'me', undefined, kind, m.links); // (your own words make no sound)
        }
        chat.add(name, m.text, 'town', m.id, kind, m.links);
        playSound('chat');
      }
      if (m.t === 'party-say') {
        const mine = m.id === myId;
        const char = mine ? this.player : this.others.charOf(m.id);
        if (char && bubbles) char.say(m.text, bubbles);
        chat.add(mine ? (member?.nickname ?? 'You') : m.name, m.text, mine ? 'me' : 'town', mine ? undefined : m.id, 'party', m.links);
        if (!mine) playSound('chat');
        return;
      }
      if (m.t === 'party') {
        setParty(m.party);
        if (m.note) toast(m.note, 3000);
        return;
      }
      if (tradeWin?.handle(m)) return;
      if (m.t === 'party-invited') return showPartyInvite({ invite: m.invite, name: m.name, members: m.members, answer: (yes) => partyAnswer(m.invite, yes) });
      if (m.t === 'party-refused') return toast(partyRefusal(m.reason, m.name), 2600, 'bad');
      if (m.t === 'party-declined') return toast(`${m.name} didn't join the party.`, 2600);
      // The Scrap Warrens: the gate's panel, an invite, going in and out, the run's tracker, its bosses' moves.
      if (m.t === 'warrens-gate') return showWarrensGate(m.gate, (what) => link.send(what === 'open' ? { t: 'warrens-open' } : { t: 'warrens-join' }));
      if (m.t === 'warrens-invite') return showWarrensInvite(m.from, m.ms, (join) => link.send(join ? { t: 'warrens-join', run: m.run } : { t: 'warrens-decline', run: m.run }));
      if (m.t === 'warrens-refused') {
        playSound('error');
        return toast(m.message, 2800, 'bad');
      }
      if (m.t === 'warrens-go') {
        // Your ticket used (opening a run: only you hear it), then through the gate.
        if (m.ticket) playWarrens('warrens-ticket-use');
        if (!m.ticket) return this.travel('warrens');
        return void this.time.delayedCall(TICKET_MS, () => this.travel('warrens'));
      }
      if (m.t === 'warrens-out') {
        if (m.reason === 'closed') toast('The Scrap Warrens closed.', 2600);
        if (m.reason === 'party') toast('You left the party: back to the Slums.', 2600);
        return this.travel('slums');
      }
      if (m.t === 'warrens-kick') return showKickCountdown(m.ms);
      if (m.t === 'warrens') {
        this.warrensTracker ??= new WarrensTracker({ start: () => link.send({ t: 'warrens-start' }), leave: () => link.send({ t: 'warrens-leave' }) });
        this.warrensTracker.set(m.run);
        return this.warrens?.run(m.run);
      }
      if (m.t === 'boss-move') return this.warrens?.move(m);
      if (m.t === 'boss-hit') return this.warrens?.hit(m);
      if (m.t === 'boss-cancel') return this.warrens?.cancel(m.id);
      if (m.t === 'mob-scale') return this.mobs?.scale(m.mobs);
      if (m.t === 'mob-flag') return this.mobs?.flag(m.id, m.untargetable, m.blockAll);
      if (m.t === 'stunned') {
        const ch = charOf(m.id);
        if (ch) this.fxLayers.drawFx('front', (g, t) => stunStars(g, ch.sprite.x, ch.headY - 4, t), m.ms, 150);
        if (m.id === myId) {
          this.stunUntil = performance.now() + m.ms;
          this.player.walk([this.player.heading]); // (stops after the step under way)
          this.stopFight();
        }
        return;
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
      if (m.t === 'mobs') {
        this.mobs?.applySnapshot(m.mobs);
        return this.golem?.snapshot(m.golem ?? null);
      }
      if (m.t === 'mob-move') return this.mobs?.hop(m.id, m.path, m.speed);
      if (m.t === 'mob-add') return this.mobs?.add(m.mobs);
      if (m.t === 'mob-remove') return this.mobs?.remove(m.ids);
      if (m.t === 'mob-face') return this.mobs?.face(m.id, m.dir);
      if (m.t === 'golem') return this.golem?.change(m.change, m.golem, m.spots);
      if (m.t === 'golem-attack') return this.golem?.attack(m);
      if (m.t === 'mob-hit') {
        const ids = m.hits.map((h) => h.id);
        const at = ids[0] ? this.mobs?.tileOf(ids[0]) : null;
        const mine = m.by === myId;
        const ch = mine ? this.player : this.others.charOf(m.by);
        const cls = mine ? (adventure()?.cls ?? null) : this.others.classOf(m.by);
        // Each mob's number and HP land when the effect's hit does (the rest with the first; all after 1.5 s at most).
        const pending = new Map(m.hits.map((h) => [h.id, h]));
        const land = (id: string) => {
          const h = pending.get(id);
          if (!h) return;
          pending.delete(id);
          this.mobs?.hit(h.id, h.damage, h.crit, h.hp, h.dead, h.slow, h.blocked, h.miss);
          if (mine && h.damage > 0) playSound(h.crit ? 'combat-hit-crit' : 'combat-hit'); // your hit landing
        };
        const landAll = () => [...pending.keys()].forEach(land);
        this.time.delayedCall(1500, landAll);
        if (ch && at && cls) {
          const mob = this.mobs?.list.find((x) => x.id === ids[0]);
          const dir = mob ? dirToward(mob.sprite.x - ch.sprite.x, mob.sprite.y - ch.sprite.y) : dirForStep(at.col - ch.tile.col, at.row - ch.tile.row);
          if (!mine) {
            ch.strike(SKILL_POSE[m.skill] ?? 'attack-quick', dir); // (yours played as you cast)
            const name = classInfo(cls)?.skills[m.skill]?.name;
            if (name && m.skill < SKILL_SOUNDS) playSet(skillSet(cls, name), { at: ch.tile, others: true });
          }
          this.castFx(cls, m.skill, ch, dir, ids, land, landAll);
        } else landAll();
        return;
      }
      // A burning puddle's tick (Boiling Splash): each mob in it, an orange number.
      if (m.t === 'mob-burn') {
        for (const h of m.hits) this.mobs?.hit(h.id, h.damage, h.crit, h.hp, h.dead, undefined, h.blocked, h.miss, true);
        return;
      }
      if (m.t === 'mob-attack') return this.mobs?.strike(m.id, m.target, m.dir, m.slow, m.hit);
      // HP (and yours with MP): the HUD's bars, the bar over your head and a hurt party member's, the party panel.
      if (m.t === 'vitals') {
        setMemberHp(m.id, m.hp, m.maxHp);
        if (m.id !== myId) return this.others.handle(m);
        setHudVitals({ hp: m.hp, maxHp: m.maxHp, mp: m.mp ?? 0, maxMp: m.maxMp ?? 0 });
        this.vitalsNow = { hp: m.hp, maxHp: m.maxHp, mp: m.mp ?? 0, maxMp: m.maxMp ?? 0 };
        this.lowMp(0); // under a quarter: an MP Potion drinks itself
        // (The bar over your head: battle maps only; in town HP never changes.)
        return this.battleMap ? this.player.setHp(m.hp, m.maxHp) : this.player.setHp(0, 0);
      }
      // Knocked out (0 HP): you fade out where you stand and can't act. The unconscious pop-up counts down the server's
      // `reviveIn` (300 s), after which it puts you back at the way in; "Revive now" asks for that straight away.
      if (m.t === 'knocked-out' && m.id === myId) {
        this.knockedOut = true;
        this.stopFight();
        this.pending = null;
        this.player.setKnockedOut(true);
        playSound('casino-lose', 0.1);
        return showRevive(m.reviveIn ?? 0, () => this.link?.send({ t: 'revive' }));
      }
      if (m.t === 'respawn' && m.id === myId) {
        hideRevive();
        this.knockedOut = false;
        this.player.place({ col: m.col, row: m.row });
        this.cameras.main.centerOn(this.player.sprite.x, this.player.sprite.y - 24);
        this.sent = { dir: this.player.facing, sit: false };
        return this.player.setKnockedOut(false);
      }
      if (m.t === 'mob-spawn') return this.mobs?.respawn(m.id, m.col, m.row, m.hp);
      if (m.t === 'mob-heal') return this.mobs?.heal(m.id, m.hp);
      // Loot on the ground: what you can see of it (faint while it's someone else's).
      if (m.t === 'loot') return this.loot?.set(m.loot);
      if (m.t === 'loot-drop') {
        // Bouncing out of the mob (the golem's from higher up); the drop sound as the first lands.
        const boss = !!m.from && !!this.golem && this.mobs?.list.some((x) => x.radius && Math.floor(x.col) === m.from![0] && Math.floor(x.row) === m.from![1]);
        this.loot?.add(m.loot, m.from, boss);
        if (m.loot.some((l) => l.mine)) this.time.delayedCall(m.from ? LOOT_LAND_MS : 0, () => playSound('combat-loot-drop'));
        return;
      }
      if (m.t === 'loot-gone') return this.loot?.remove(m.ids);
      if (m.t === 'drop-refused') {
        playSound('error');
        return toast(m.message, 2400, 'bad');
      }
      if (m.t === 'loot-full') {
        playSound('error');
        return toast('Inventory full', 1800, 'bad');
      }
      // Your items and Kusing changed on the server (loot picked up, a potion, the shop, dev's ?give=).
      if (m.t === 'items') {
        setItems(m.items, m.got);
        if (m.got?.kusing) playSound('combat-coins');
        if (m.got?.item) playSound('combat-loot-pickup');
        // What you picked up: a line in your own system feed, added here only (never the server's feed, which goes to
        // everyone and to Discord), in its name's colour.
        const line = m.got && pickupOf(m.got);
        if (line) feed.mine(line.parts);
        return;
      }
      // A party member's pickup: "Mara looted Sturdy Slingshot +1" in your feed (their name in party pink).
      if (m.t === 'inspect') return this.inspect?.answer(m);
      if (m.t === 'party-loot') {
        const line = pickupOf(m.got);
        if (!line) return;
        const rest = m.got.item ? line.parts.slice(1) : [{ text: `${m.got.kusing?.toLocaleString('en-US')} Kusing${m.share ? ` (${m.share.toLocaleString('en-US')} each)` : ''}`, colour: line.parts[0].colour }];
        feed.mine([{ text: m.name, colour: '#F9A8D4' }, { text: ' looted ', colour: line.parts[0].colour }, ...rest]);
        return;
      }
      // An HP or MP Potion (maybe yours): the heal over them in green or blue; yours starts the potions' cooldown.
      if (m.t === 'potion') {
        const ch = charOf(m.id);
        ch?.hitNumber(`+${m.amount}`, m.id === myId, m.heals === 'hp' ? '#4ADE80' : '#60A5FA');
        if (m.id === myId) {
          playSound('combat-potion');
          const S = adventureData()?.stats;
          if (m.cooldown && S) {
            const key = potionKeyOf(S, m.heals);
            this.hotbar?.cooldown(key, m.cooldown / 1000);
            this.potionReady.set(key, this.time.now + m.cooldown);
          }
        }
        return;
      }
      // Buffs: the ones on you (the tray, the stats box), someone's cast (their buff-cast; yours with the server's
      // cooldown), a heal's green numbers, and a refused cast (why, like a refused attack).
      if (m.t === 'buffs-of') {
        const now = Date.now();
        return this.target?.setBuffs(m.id, m.buffs.map((b) => ({
          name: b.name,
          icon: this.skillIcon(b.cls, b.name),
          lines: buffStatLines(b.stats).length ? buffStatLines(b.stats) : [classInfo(b.cls)?.buffs?.find((x) => x.name === b.name)?.effect ?? ''].filter(Boolean),
          endsAt: b.ms === null ? null : now + b.ms,
        })));
      }
      if (m.t === 'buffs') {
        setMyBuffs(m.buffs);
        if (!this.buffDemo) {
          // (Each stat counts only from its strongest buff: one outdone on every stat it gives is faded, naming who wins.)
          const on = myBuffs();
          const best = myBuffStats();
          const winner = (k: string) => on.find((x) => x.stats[k] === best[k])?.name;
          this.buffTray?.set(on.map((b) => {
            const keys = Object.keys(b.stats);
            const out = keys.length > 0 && keys.every((k) => b.stats[k] < best[k]);
            return { cls: b.cls, name: b.name, endsAt: b.endsAt, stats: buffStatLines(b.stats), ...(out ? { weaker: winner(keys[0]) } : {}) };
          }));
        }
        return;
      }
      if (m.t === 'buff-cast') {
        if (m.id !== myId) charOf(m.id)?.strike('buff-cast', m.dir);
        else if (m.cooldown) {
          this.buffReady.set(m.buff, this.time.now + m.cooldown);
          this.hotbar?.cooldown(m.buff, m.cooldown / 1000);
          if (m.off) toast(`${m.buff} off.`, 1500);
        }
        return;
      }
      if (m.t === 'buff-heal') {
        for (const h of m.heals) if (h.amount > 0) charOf(h.id)?.hitNumber(`+${h.amount}`, h.id === myId, '#4ADE80');
        return;
      }
      if (m.t === 'buff-refused') {
        this.buffReady.set(m.buff, this.time.now + (m.ms ?? 0));
        this.hotbar?.cooldown(m.buff, (m.ms ?? 0) / 1000);
        if (m.reason === 'mp') return this.lowMp(Infinity, true);
        playSound('error');
        const why = { here: 'Only on battle maps.', skill: "That isn't one of your buffs.", locked: "You can't use that skill yet.", out: "You're knocked out.", slow: 'Not ready.' }[m.reason];
        toast(why, 1600, 'bad');
        return;
      }
      if (m.t === 'potion-refused') {
        playSound('error');
        const S = adventureData()?.stats;
        if (m.reason === 'cooldown' && m.ms && S && m.heals) {
          const key = potionKeyOf(S, m.heals);
          this.hotbar?.cooldown(key, m.ms / 1000);
          this.potionReady.set(key, this.time.now + m.ms);
        }
        const why = { cooldown: m.heals ? `Your ${m.heals.toUpperCase()} Potions are cooling down.` : 'Your potions are cooling down.', none: 'None left.', full: "You're already full.", here: 'HP and MP Potions work in the Slums.' }[m.reason];
        return toast(why, 1800, 'bad');
      }
      // Your level, XP and points (a kill's XP, dev's ?xp=): the HUD and everything that shows them follow.
      // Your quests' counts (a kill counted: yours or your party's nearby); the dev town only says the kill.
      if (m.t === 'quests') return setQuestCounts(m.active);
      if (m.t === 'quest-kill') return devQuestKill(m);
      if (m.t === 'progress') {
        const before = adventure()?.progress.level ?? m.progress.level;
        setProgress(m.progress);
        return this.newSkills(before, m.progress.level);
      }
      // Someone went up a level (maybe you): "Level up!" over them with its ring and sparks, and its sound (others' near
      // you, quieter).
      if (m.t === 'level-up') {
        const mine = m.id === myId;
        if (!mine) this.others.setLevel(m.id, m.level);
        this.target?.levelChanged(m.id, m.level);
        const ch = charOf(m.id);
        if (!ch) return;
        ch.levelUp();
        this.levelUpFx(ch);
        playFrom('combat-level-up', mine ? {} : { at: ch.tile, others: true });
        return;
      }
      if (m.t === 'attack-refused') {
        if (m.reason === 'range') toast('Too far to hit it.', 1500);
        if (m.reason === 'locked') toast("You can't use that skill yet.", 1500);
        if (m.reason === 'mp') this.lowMp(Infinity, true);
        return;
      }
      if (m.t === 'welcome') {
        myId = m.you;
        this.myId = m.you;
        // (Knocked out when the link dropped: the server has you up again, full.)
        if (this.knockedOut) {
          this.knockedOut = false;
          this.player.setKnockedOut(false);
          hideRevive();
        }
        setParty(null); // the server sends your party (if you're still in one) right after
        // A reconnect (the bot restarted, a blip): what's on screen stays; only what's new is added.
        chat.history(m.recent ?? [], member?.nickname ?? null, arrived);
        chat.setGm(!!m.gm); // a Game Master: the GM channel
        // Jailed or not, as the server has it now (a sentence that ran out while the link was down clears here).
        if (!!m.jailed !== this.player.jailed) {
          this.player.setJailed(!!m.jailed);
          if (this.hood) this.hood.me.jailed = !!m.jailed;
          window.dispatchEvent(new Event('mk-wallet')); // the HUD's status dot
        }
        feed.history(m.system ?? [], arrived);
        if (m.notice && !arrived) announce(m.notice); // a notice still current when you arrive
        // Arriving: go to the free tile the server picked (so people don't land on each other), unless you've
        // already walked off or this is a reconnect, in which case you stay where you are ('here' below).
        // Dev, in the Slums: ?golem=now raises its golem now, ?golemdemo=1 plays its whole fight on the nearest player
        // (the dev server's /__golem); either way you arrive by the Golem Pit to watch.
        const q = new URLSearchParams(location.search);
        const golemDev = import.meta.env.DEV && !arrived && !!this.golem && (q.get('golem') === 'now' || q.has('golemdemo'));
        if (golemDev) this.byThePit();
        // Dev: ?warrens=solo opens a Scrap Warrens run for you (free) and goes in; ?warrensboss=crab-tain too, with every
        // area before that boss cleared, arriving at its arena (the dev server's /__warrens). Read once, then tidied away.
        if (import.meta.env.DEV && fakeLogin() && !arrived && this.area !== 'warrens' && (q.has('warrens') || q.has('warrensboss'))) {
          const boss = q.get('warrensboss');
          const url = new URL(location.href);
          url.searchParams.delete('warrens');
          url.searchParams.delete('warrensboss');
          history.replaceState(null, '', url.pathname + url.search);
          void fetch(`/__warrens?${new URLSearchParams({ as: fakeName(), ...(boss ? { boss } : {}) })}`)
            .then((r) => r.json() as Promise<{ ok: boolean; message?: string }>)
            .then((r) => (r.ok ? this.travel('warrens') : toast(r.message ?? "Couldn't open a run.", 2600, 'bad')))
            .catch(() => null);
        }
        // Dev, in the Slums: ?minibosses=now brings every mini boss that's down back at once (the dev server's /__minibosses).
        if (import.meta.env.DEV && !arrived && this.battleMap && q.get('minibosses') === 'now') void fetch('/__minibosses').catch(() => null);
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
        if (golemDev) void fetch(q.has('golemdemo') ? `/__golem?${new URLSearchParams({ demo: '1', as: fakeName() })}` : '/__golem?now=1').catch(() => null);
        // Dev: ?kusing=5000, ?whetstones=200, ?give=<defId>:<rarity>:<plus> (the dev server's /__give: rolled there as
        // drops are; your items come back as an `items` message). Once a visit. ?give= may come more than once; for a
        // stack the third part is how many (?give=low-repair-kit::3), an agimat's fourth its level
        // (?give=agimat-critdmg::2:20).
        if (import.meta.env.DEV && fakeLogin() && !this.devGiven && (q.has('kusing') || q.has('whetstones') || q.has('give'))) {
          this.devGiven = true;
          const asks: URLSearchParams[] = [];
          const first = new URLSearchParams({ as: fakeName() });
          if (q.has('kusing')) first.set('kusing', q.get('kusing')!);
          if (q.has('whetstones')) first.set('whetstones', q.get('whetstones')!);
          asks.push(first);
          for (const g of q.getAll('give')) {
            const [def, rarity, plus, level] = g.split(':');
            if (!def) continue;
            const isGear = isGearDef(anyDef(def));
            asks.push(new URLSearchParams({ as: fakeName(), def, rarity: rarity ?? '', ...(isGear ? { plus: plus || '0' } : { count: plus || '1' }), ...(level ? { level } : {}) }));
          }
          void devItemsReady
            .then(async () => {
              for (const ask of asks) {
                const r = await fetch(`/__give?${ask}`).then((x) => (x.ok ? (x.json() as Promise<{ items?: TownItems }>) : null));
                if (r?.items) setItems(r.items);
              }
            })
            .catch(() => null);
        }
        // Dev: ?xp=500 gives you XP, ?level=10 sets your level (the dev server's /__xp: its level-ups as from kills).
        if (import.meta.env.DEV && fakeLogin() && (q.has('xp') || q.has('level')) && !this.devLevelled) {
          this.devLevelled = true;
          const ask: [string, string] = q.has('level') ? ['level', q.get('level')!] : ['xp', q.get('xp')!];
          void fetch(`/__xp?${new URLSearchParams([['as', fakeName()], ask])}`).catch(() => null);
        }
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
    void playTitleCard(this.area === 'hood' ? 'Neighbourhood' : this.area === 'slums' ? 'Slums' : this.area === 'warrens' ? 'Scrap Warrens' : 'Mikazuki');
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

  /** A combat bag item dragged onto the map: dropped on the ground at your feet, after a confirm box (how many of a
   *  stack; your party's or anyone's). Never bound items or training gear (the server checks too). */
  private setupItemDrop(): void {
    const canvas = this.game.canvas;
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('application/x-mk-item') || !this.link) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    };
    const drop = (e: DragEvent) => {
      const uid = e.dataTransfer?.getData('application/x-mk-item');
      if (!uid) return;
      e.preventDefault();
      void this.dropItem(uid);
    };
    canvas.addEventListener('dragover', over);
    canvas.addEventListener('drop', drop);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      canvas.removeEventListener('dragover', over);
      canvas.removeEventListener('drop', drop);
    });
  }

  private async dropItem(uid: string): Promise<void> {
    const it = adventure()?.bag.find((b) => b.uid === uid);
    const D = itemData();
    if (!it || !D || this.knockedOut || this.inside) return;
    const why = dropRefusal(D, it);
    if (why) {
      playSound('error');
      return toast(why, 2400, 'bad');
    }
    const count = await confirmDrop(it, (party()?.members.length ?? 0) > 1);
    if (!count) return;
    if (!this.link?.send({ t: 'drop', item: uid, count })) toast("Couldn't reach the town.", 2400, 'bad');
  }

  private setupInput(): void {
    this.setupItemDrop();
    // Benches are left-clickable too (sit), so they get the hand cursor.
    for (const b of this.objects.benches) b.sprite.setInteractive({ pixelPerfect: true, cursor: cursor('hand', this.cameras.main.zoom) });
    for (const b of this.objects.buildings) this.wireBuilding(b);

    // Left click uses things (a building's door, a bench); right click only walks. A tap on a touch screen does
    // both, as there's no right button.
    this.input.mouse?.disableContextMenu();
    this.setupPeek();
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      this.pressAt = { x: p.x, y: p.y };
      // The middle button: as Z (the nearest mob, again: the next). Never the browser's autoscroll.
      if (p.middleButtonDown()) {
        p.event.preventDefault();
        if (this.mobs && !this.intro && !this.inside) this.mobs.targetNext(this.player.tile);
      }
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (p.button === 1) return; // the middle button only targets
      // A drag, not a click. (Measured from our own press: p.getDistance() only follows the left button, so after a
      // left drag every right click looked like a drag.)
      if (Math.hypot(p.x - this.pressAt.x, p.y - this.pressAt.y) > 8) return;
      // Loot: left click (or a tap) goes and picks it up.
      const lootHit = this.loot?.pick(over);
      if (lootHit && (p.wasTouch || p.leftButtonReleased())) return this.goToLoot(lootHit.id, { col: lootHit.col, row: lootHit.row });
      // Someone else's character: left click (or a tap) picks them for the player menu.
      const other = this.others.pick(over);
      if (other && this.target && (p.wasTouch || p.leftButtonReleased())) {
        this.mobs?.setTarget(null); // one target at a time
        return this.target.select(other);
      }
      // An NPC: left click (or a tap) talks to them (walking over first if they're far).
      const npc = this.npcs?.pick(over);
      if (npc && (p.wasTouch || p.leftButtonReleased())) return this.talkTo(npc);
      const building = this.objects.buildings.find((b) => b.parts.some((part) => over.includes(part)));
      const world = this.cameras.main.getWorldPoint(p.x, p.y);
      const { col, row } = this.pickTile(world.x, world.y);
      const bench = this.seatOn(over, { col, row }) ?? this.benchAt({ col, row });
      if (p.wasTouch) {
        if (building) return this.goToBuilding(building);
        return this.goToTile({ col, row });
      }
      if (p.rightButtonReleased()) return void (this.clickTo = { col, row }); // (walked to in the next update: one search a frame)
      if (building) return this.goToBuilding(building);
      if (bench) return this.goToBench(bench);
    });

    // The walking keys (WASD / arrows by default) walk in screen directions; the interact keys (E or Space) enter a
    // door or sit on a bench. Every key is a keybind (ui/keybinds.ts). No key capture, so typing in page inputs (chat)
    // is never swallowed.
    const kb = this.input.keyboard!;
    kb.on('keydown', (e: KeyboardEvent) => {
      if (typing()) return;
      if (actionOf(e, MOVE_ACTIONS)) {
        this.pending = null;
        this.player.cancelPath(); // the keys take over from a click path
      }
      // Pick up (F) and Space: the nearest loot in reach; Space otherwise enters, sits or talks as ever.
      if (matches('pickup', e) && !e.repeat) this.pickUpNearest();
      else if (matches('interact', e) && !(e.code === 'Space' && !e.repeat && this.pickUpNearest())) this.interact();
      // Target (Z, or the middle button): the nearest mob (again: the next nearest); Escape lets it go.
      if (this.mobs && matches('target', e) && !e.repeat) this.mobs.targetNext(this.player.tile);
      if (this.mobs && e.key === 'Escape') {
        this.stopFight();
        this.mobs.setTarget(null);
      }
      // Emotes (F1–F8; the picker beside the chat shows which is which).
      const emote = actionOf(e, EMOTE_ACTIONS);
      if (emote) {
        e.preventDefault(); // F5 would reload, F1 open help
        this.emoteKeys?.(EMOTE_KEYS[EMOTE_ACTIONS.indexOf(emote)]);
      }
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
    const h = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
    const v = (held('down') ? 1 : 0) - (held('up') ? 1 : 0);
    return DIR_FOR_KEYS[`${h},${v}`] ?? null;
  }

  /**
   * Next tile for keyboard walking. Up/down/left/right are diagonal grid steps: when one is blocked, slide along
   * the wall through either of its two halves. Pressing into a wall just turns the player.
   */
  private keyStep(): Tile | null {
    const dir = this.knockedOut || this.stunned ? null : this.heldDir();
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
    this.stopFight(); // the keys take over from an auto-cast
    const to = this.stepToward(this.player.tile, dir);
    if (!to) {
      this.player.face(dir);
      return null;
    }
    if (!this.byKeys) this.setBuildingAlert(null);
    this.byKeys = true;
    this.keyWalking = true;
    this.pending = null;
    return to;
  }

  /** The tile one step from `from` toward a screen direction, sliding along a wall through either half; null if blocked. */
  private stepToward(from: Tile, dir: Dir): Tile | null {
    const [dc, dr] = DIR_STEP[dir];
    const tries: [number, number][] = [[dc, dr]];
    if (dc && dr) tries.push([dc, 0], [0, dr]);
    for (const [c, r] of tries) {
      const to = { col: from.col + c, row: from.row + r };
      if (this.grid.canStep(from, to)) return to;
    }
    return null;
  }

  /** Walking on the keys and the held direction just changed (another key pressed or let go): turn mid-step. */
  private keyTurn(): void {
    const held = this.heldDir();
    // A turn is an extra step message: only with room to spare in the server's budget (else it waits for the tile).
    if (held && this.lastHeld && held !== this.lastHeld && this.keyWalking && this.stepBudget() >= 3) this.player.turnMidStep((from) => this.stepToward(from, held));
    this.lastHeld = held;
  }

  /** The server's step budget as it stands for us (bot web/town.ts: 6 a second, up to 6 saved; slowed, half of both), so
   *  turns and moves never go over it. */
  private stepTokens = 6;
  private stepRefilled = 0;
  private stepBudget(spend = 0): number {
    const now = performance.now();
    const k = now < this.slowUntil ? 0.5 : 1;
    this.stepTokens = Math.min(6 * k, this.stepTokens + ((now - this.stepRefilled) / 1000) * 6 * k) - spend;
    this.stepRefilled = now;
    return this.stepTokens;
  }

  /** Knocked out (0 HP): faded out, no walking, moves or skills until the server respawns you. */
  private knockedOut = false;
  /** Stunned (Wire Wolf's Live Floor) until then (performance.now()): no walking. */
  private stunUntil = 0;
  private get stunned(): boolean {
    return performance.now() < this.stunUntil;
  }
  /** Your town id (from the server's welcome). */
  private myId = '';
  /** The Scrap Warrens: the run's view and tracker (in a run), and the Warren Gate's panel asked for (the Slums). */
  private warrens: WarrensView | null = null;
  private warrensTracker: WarrensTracker | null = null;
  private gateCheckAt = 0;
  private gateAsked = false;

  /** The Warren Gate (the Slums): walking up to it (within its use range) asks for its panel, once each time. */
  private nearWarrenGate(): void {
    const g = this.warrenGate();
    if (!g) return;
    const t = this.player.tile;
    const d = Math.max(Math.abs(t.col - g.centre[0]), Math.abs(t.row - g.centre[1]));
    if (d > g.range + 2) this.gateAsked = false;
    else if (d <= g.range && !this.gateAsked && (this.me?.status === 'ok' || fakeLogin())) this.gateAsked = !!this.link?.send({ t: 'warrens-gate' }); // (asked again if the link wasn't up yet)
  }

  /** The Warren Gate's centre tile and use range (classes/dungeons.json), if this map has it. */
  private warrenGate(): { centre: [number, number]; range: number } | null {
    const W = (this.cache.json.get('dungeons') as { warrens?: { entry: { warp: { tile: [number, number]; useRangeTiles: number } } } } | undefined)?.warrens;
    const o = this.map.objects.find((x) => x.id === 'slums-warren-gate');
    if (!o) return null;
    return { centre: W?.entry.warp.tile ?? [o.col + 1, o.row + 1], range: W?.entry.warp.useRangeTiles ?? 3 };
  }
  /** Slowed by the Bag until then (performance.now(), as the step budget): half walking speed, half the budget. */
  private slowUntil = 0;
  private slowTimer: Phaser.Time.TimerEvent | null = null;

  /** The Bag's slow on you: half walking speed for `ms` (the server holds your steps to it too). */
  private slowMe(ms: number): void {
    this.slowUntil = Math.max(this.slowUntil, performance.now() + ms);
    this.player.speed = SPEED / 2;
    this.slowTimer?.remove();
    this.slowTimer = this.time.delayedCall(Math.max(0, this.slowUntil - performance.now()), () => {
      this.player.speed = SPEED;
      this.slowTimer = null;
    });
  }

  /** E / Space: enter the door you're standing at, or sit on the bench you're in front of. */
  private interact(): void {
    if (this.knockedOut) return;
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
    const path = this.grid.findPath(this.player.heading, at) ?? this.grid.findPath(this.player.heading, this.grid.nearestReachable(this.player.heading, at) ?? this.player.heading);
    if (!path || path.length < 2) return;
    this.setBuildingAlert(null);
    this.player.walk(path.slice(0, -1));
    this.pending = { npc: id };
  }

  /** Loot clicked: within LOOT_REACH, picked up at once; else walk onto it and pick it up there (nothing is picked up
   *  just by walking over it). */
  private goToLoot(id: string, at: Tile): void {
    const me = this.player.tile;
    if (Math.max(Math.abs(at.col - me.col), Math.abs(at.row - me.row)) <= LOOT_REACH) return void this.link?.send({ t: 'pick', id });
    this.moveTo(at);
    this.pending = { loot: id };
  }

  /** F (the Pick up key) or Space: the nearest loot you may take within LOOT_REACH, if any (the server picks it up). */
  private pickUpNearest(): boolean {
    if (this.knockedOut || !this.loot) return false;
    const l = this.loot.nearest(this.player.tile);
    if (!l) return false;
    this.link?.send({ t: 'pick', id: l.id });
    return true;
  }

  /** Walk to a tile; a bench means sit on it; a blocked tile means the nearest reachable one. */
  goToTile(target: Tile): void {
    const bench = this.benchAt(target);
    if (bench) return this.goToBench(bench);
    this.moveTo(target);
  }

  /** The bench under the pointer: on a long bench, the free seat nearest the clicked tile. */
  private seatOn(over: Phaser.GameObjects.GameObject[], at: Tile): Bench | undefined {
    const seats = this.objects.benches.filter((b) => over.includes(b.sprite));
    const far = (b: Bench) => Math.abs(b.col - at.col) + Math.abs(b.row - at.row) + (this.others.seatTaken(b.col, b.row) ? 100 : 0);
    return seats.sort((a, z) => far(a) - far(z))[0];
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

  /** The latest right-click's tile, walked to in the next update. */
  private clickTo: Tile | null = null;

  /** Just walk there (a tile you can't get to: the nearest one you can), with the click marker on where you're going. */
  private moveTo(target: Tile): void {
    this.stopFight(); // walking yourself stops an auto-cast
    this.pending = null;
    this.byKeys = false;
    const from = this.player.heading;
    const to = this.grid.reachable(from, target) ? target : this.grid.nearestReachable(from, target);
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
    const from = this.player.heading;
    const paths = b.doors.map(([col, row]) => this.grid.findPath(from, { col, row })).filter((p): p is Tile[] => !!p);
    paths.sort((a, z) => a.length - z.length);
    if (!paths[0]) return;
    this.setBuildingAlert(null); // leaving the door we were at
    this.player.walk(paths[0]);
  }

  private walkTo(target: Tile): boolean {
    if (this.knockedOut || this.stunned) return false;
    const path = this.grid.findPath(this.player.heading, target);
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
    if (this.pending?.loot) {
      const id = this.pending.loot;
      this.pending = null;
      return void this.link?.send({ t: 'pick', id }); // the loot you clicked (the server checks it's in reach)
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

  /** A clickable sign over each gate: "Neighbourhood" at the bridge, "Slums" at the west road's end, "Back to town" at
   *  the other areas' exits. */
  private gateSigns(): void {
    for (const to of ['hood', 'town', 'slums'] as const) {
      const tiles = this.map.gates?.[to];
      if (!tiles?.length) continue;
      const [c, r] = tiles[Math.floor(tiles.length / 2)];
      const t = tileToScreen(c, r);
      const at = { x: t.x, y: t.y - this.objects.heights.at(c, r) * LEVEL_PX };
      const sign = new BuildingLabel(this, to === 'hood' ? 'Neighbourhood →' : to === 'slums' ? (this.area === 'warrens' ? 'Exit to the Slums' : '← Slums') : this.area === 'slums' ? 'Back to town →' : '← Back to town', at.x);
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

  /** The Warren Gate (the Slums): "Warren Gate" over it on hover; a click walks up to it (its panel opens there). */
  private warrenGateLabel(): void {
    const o = this.map.objects.find((x) => x.id === 'slums-warren-gate');
    const def = o && this.M.props[o.id];
    if (!o || !def) return;
    const top = tileToScreen(o.col, o.row);
    const lift = this.objects.heights.at(o.col, o.row) * LEVEL_PX;
    const [w, h] = def.size;
    const box = this.add.zone(top.x - def.anchor[0] + w / 2, top.y - lift - def.anchor[1] + h / 2, w, h).setDepth(LABEL_DEPTH - 2);
    const label = new BuildingLabel(this, 'Warren Gate', top.x);
    label.setZoom(this.cameras.main.zoom);
    this.gateLabels.push(label);
    box.setInteractive({ cursor: 'pointer' });
    box.on('pointerover', () => label.show(top.y - lift - def.anchor[1] - 2));
    box.on('pointerout', () => label.show(null));
    box.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!p.leftButtonReleased() && !p.wasTouch) return;
      const at = this.map.arrive?.warrens;
      if (!at) return;
      this.gateAsked = false; // (asked again when you get there, or now if you're there)
      this.goToTile({ col: at[0], row: at[1] });
    });
  }

  /** Off to the other area: a fade, then that page (the town's art is cached, so it's quick). The Slums need a login. */
  private travel(to: Gate): void {
    if ((to === 'slums' || to === 'warrens') && this.me?.status !== 'ok' && !fakeLogin()) return void toast('Log in to go into the Slums.', 2800);
    if (this.travelling) return;
    this.travelling = true;
    // Through the Warren Gate (in or out): its warp with the fade, which waits for it (the page changes after); else a door.
    const warp = to === 'warrens' || this.area === 'warrens';
    if (warp) playWarrens('warrens-gate-warp');
    else playSound('door');
    toast(to === 'hood' ? 'To the neighbourhood…' : to === 'warrens' ? 'Into the Scrap Warrens…' : to === 'slums' ? (this.area === 'warrens' ? 'Back to the Slums…' : 'Into the Slums…') : 'Back to town…');
    this.cameras.main.fadeOut(warp ? WARP_MS - 200 : 400, 0, 0, 0);
    this.time.delayedCall(warp ? WARP_MS : 420, () => location.assign(areaUrl(to)));
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
    // (Under the Slums it's always dusk: a navy shade over everything, every lamp lit.)
    const sky = this.area === 'warrens' ? { lampsOn: true, tint: WARRENS_TINT } : skyAt(minutesNow());
    this.lampsOn = sky.lampsOn;
    this.objects.setLamps(sky.lampsOn);
    if (!force && sky.tint === this.tint) return;
    this.tint = sky.tint;
    const all = [...this.ground.sprites, ...this.objects.sprites, ...this.player.tintables, ...this.others.tintables, ...(this.npcs?.tintables ?? []), ...(this.mobs?.tintables ?? []), ...this.bridges.filter((b) => !!b)];
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
      vitals: this.vitalsNow,
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

  /** Dev (?golem=now, ?golemdemo=1): on its pit floor 6–7 tiles from its middle on the way in's side, facing it (without
   *  the pit's tiles: at or past its box's front corner). */
  private byThePit(): void {
    const boss = this.map.boss;
    if (boss?.pit) {
      const [hc, hr] = boss.tile;
      const [gc, gr] = boss.pit.gap.reduce(([a, b], [c, r]) => [a + c / boss.pit!.gap.length, b + r / boss.pit!.gap.length], [0, 0]);
      const spot = boss.pit.floor
        .filter(([dc, dr]) => Math.hypot(dc, dr) >= 6 && Math.hypot(dc, dr) <= 7)
        .reduce((a, b) => (Math.hypot(b[0] - gc, b[1] - gr) < Math.hypot(a[0] - gc, a[1] - gr) ? b : a));
      return this.debugTeleport(hc + spot[0], hr + spot[1], 'nw');
    }
    const [, , c1, r1] = boss?.arena ?? [0, 0, -1, -1];
    for (let d = 0; d < 8; d++) if (this.grid.walkable(c1 + d, r1 + d)) return this.debugTeleport(c1 + d, r1 + d, 'nw');
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

/** Debug: the sounds asked for (__town.sounds()). */
const soundLog: (SoundTapped & { at: number })[] = [];

function exposeDebug(scene: TownScene): void {
  if (!import.meta.env.DEV && !new URLSearchParams(location.search).has('debug')) return;
  tapSounds((e) => soundLog.push({ ...e, at: Math.round(performance.now()) }));
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
    /** Shows these buffs in the buff tray (none: the dev demo's). */
    buffs: (list?: ActiveBuff[]) => (list ? scene.buffTray?.set(list) : scene.demoBuffs()),
    /** The Slums' mobs: id, look, tile, facing, and where each is on the screen (for clicking one in tests). */
    mobs: () =>
      scene.debugMobs?.list.map((m) => {
        const cam = scene.cameras.main;
        return { id: m.id, variant: m.variant, anim: m.sprite.anims.currentAnim?.key, bar: !!m.bar, tile: [Math.floor(m.col), Math.floor(m.row)], dir: m.dir, walking: m.path.length > 0, hp: m.hp, maxHp: m.maxHp, level: m.level, dead: m.dead, asleep: m.asleep, pose: m.pose?.anim ?? null, x: (m.sprite.x - cam.worldView.x) * cam.zoom, y: (m.sprite.y - 12 - cam.worldView.y) * cam.zoom };
      }),
    /** Every sound asked to play since the last call (debug tap in audio/sound.ts), and the sets loaded. */
    sounds: () => {
      const got = soundLog.splice(0);
      return { got, sets: soundSets() };
    },
    /** The golem as the page has it (null: not made yet) and where it is on the screen. */
    golem: () => {
      const m = scene.debugMobs?.get('scrapheap-golem');
      const cam = scene.cameras.main;
      return m ? { tile: [Math.floor(m.col), Math.floor(m.row)], dir: m.dir, hp: m.hp, maxHp: m.maxHp, dead: m.dead, asleep: m.asleep, enraged: m.enraged, untouchable: m.untouchable, anim: m.sprite.anims.currentAnim?.key, frame: m.sprite.anims.currentFrame?.index, x: (m.sprite.x - cam.worldView.x) * cam.zoom, y: (m.sprite.y - cam.worldView.y) * cam.zoom } : null;
    },
    /** Your items and Kusing as the page has them (names as shown). */
    items: () => {
      const s = adventure();
      const view = (i: Item) => ({ uid: i.uid, defId: i.defId, name: nameOf(i), rarity: i.rarity, plus: i.plus, luck: i.luck, broken: i.broken, count: i.count, bound: i.bound, level: i.level, lock: i.lock, lines: i.lines, agimats: i.agimats });
      return s && { kusing: s.kusing, bag: s.bag.map(view), equipped: Object.fromEntries(Object.entries(s.equipped).map(([p, i]) => [p, view(i!)])) };
    },
    /** Loot on the ground as shown, with where each is on the screen. */
    loot: () => {
      const cam = scene.cameras.main;
      return scene.debugLoot?.list().map((l) => ({ ...l, sx: (l.x - cam.worldView.x) * cam.zoom, sy: (l.y - cam.worldView.y) * cam.zoom }));
    },
    /** Fixed view for screenshots: zoom and centre on a world point (follow off), or follow again. */
    view: (zoom?: number, x?: number, y?: number) => {
      const cam = scene.cameras.main;
      if (zoom) cam.setZoom(zoom);
      scene.follow = x === undefined;
      if (x !== undefined && y !== undefined) cam.centerOn(x, y);
    },
  };
}

/** Stunned: three small yellow stars circling over a head (`t` ms in). */
function stunStars(g: Phaser.GameObjects.Graphics, x: number, y: number, t: number): void {
  for (let i = 0; i < 3; i++) {
    const a = t / 180 + (i * Math.PI * 2) / 3;
    const sx = Math.round(x + Math.cos(a) * 7);
    const sy = Math.round(y + Math.sin(a) * 2.5);
    g.fillStyle(0x1e1b3a, 0.9).fillRect(sx - 2, sy - 2, 5, 5);
    g.fillStyle(0xfacc15, 1).fillRect(sx - 1, sy, 3, 1).fillRect(sx, sy - 1, 1, 3);
  }
}
