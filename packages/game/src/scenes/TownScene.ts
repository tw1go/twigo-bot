import Phaser from 'phaser';
import { queueImage, queueTown } from '../assets/queue';
import type { Dir, Manifest, TownMap } from '../assets/types';
import { Character } from '../characters/character';
import { type Outfit, assetProblems, buildOutfit, headPortrait, loadOutfit, outfitFiles } from '../characters/doll';
import { startingOutfit } from '../characters/looks';
import type { MeResult } from '../session';
import { cursor } from '../ui/cursor';
import { BuildingLabel, UI_FONT } from '../ui/labels';
import { LOADING_LINES } from '../ui/loading-lines';
import { TownLink } from '../net/town';
import { showElsewhere, showKicked } from '../ui/elsewhere';
import { mountTownHud } from '../ui/townhud';
import { ChatBox } from '../ui/chat';
import { SystemFeed } from '../ui/system-feed';
import { announce } from '../ui/announce';
import { OnlineList } from '../ui/online';
import { EMOTE_KEYS, emotePicker } from '../ui/emotes';
import type { TownEmote } from '@mikazuki/shared';
import { type BubbleArt, lightBubble } from '../ui/labels';
import { type Reward, setRewardArt, showReward } from '../ui/reward';
import { showMovementTutorial } from '../ui/tutorial';
import { OtherPlayers } from '../world/others';
import { fakeLogin } from '../session';
import { screenToTile, tileToScreen } from '../iso';
import { toast } from '../ui/toast';
import { GROUND_SHADOW_DEPTH, LABEL_DEPTH } from '../world/depth';
import { minutesNow, setTimeSource, skyAt } from '../world/daynight';
import { Culler } from '../world/cull';
import { type Tile, WalkGrid } from '../world/grid';
import { Ground } from '../world/ground';
import { type Bench, type Building, WorldObjects, characterDepth } from '../world/objects';
import { hearFrom, playSound, startTownSound } from '../audio/sound';

// The playable town: ground, buildings, props and the player, all placed from manifest.json + maps/town.json.
// Right click to walk; left click a building to walk to its door, or a bench to sit (a tap does all of these).

const ZOOMS = [2, 3, 4];
/** Arriving in town, the camera fades in from black, starting this close on the player and easing out to the
 *  middle zoom. */
const INTRO_ZOOM = 8;
const INTRO_MS = 1600;
/** From a standstill, a direction key held shorter than this only turns the player. */
const TURN_HOLD_MS = 150;
const FADE_MS = 1100;

/** Everyone's title until they're given another (the bot's web/titles.ts has the list). */
const TOWNFOLK = { name: 'Townfolk', color: '#B794F6' }; // whole steps only; 1× showed too much of the town at once
const TWIGO_ROOM_URL = 'https://tw1go.github.io';

/** Each building's name (shown over it and in door messages). twigo's house leads back to twigo's room; the other
 *  doors are hooks to fill in later. */
const BUILDINGS: Record<string, string> = {
  'rewards-shop': 'Rewards shop',
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
  private pending: { sit: Bench } | null = null;
  private buildingAlert: Phaser.GameObjects.Sprite | null = null;
  private zoomIndex = 1;
  /** The arrival zoom-out while it runs (follow and label sizing wait for it). */
  private intro: Phaser.Tweens.Tween | null = null;
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
  private link: TownLink | null = null;
  /** What the server last heard about the player (face / sit / stand are sent when these change). */
  private sent = { dir: '' as string, sit: false };
  private alertFor: Building | null = null;
  private labelZoom = 0;

  /** Straight from the character creator: a member's first time in town (the movement tutorial shows). */
  private firstVisit = false;

  init(data: { manifest: Manifest; town: TownMap; me: MeResult | null; firstVisit?: boolean }): void {
    this.firstVisit = !!data.firstVisit;
    this.M = data.manifest;
    this.map = data.town;
    this.me = data.me;
    this.outfit = startingOutfit(this.M.characters, data.me);
  }

  preload(): void {
    // (The page's login corner is hidden: the loading screen is just the moon and the bar; the town's HUD follows.)
    document.getElementById('hud')?.setAttribute('hidden', '');
    this.load.setPath(`${import.meta.env.BASE_URL}assets/`);
    queueTown(this.load, this.textures, this.M, this.map);
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
    this.others = new OtherPlayers(this, this.M, this.objects, (obj) => this.tint >= 0 && obj.setTint(this.tint));

    this.setupCamera();
    // Only what the camera can see is drawn and animated.
    this.culler = new Culler([...this.ground.cullable, ...this.objects.cullable]);
    this.culler.onShow = (img) => this.ground.refresh(img);
    this.culler.update(this.cameras.main.worldView);
    this.setupInput();
    this.updateSky(true);
    for (const b of this.objects.buildings) {
      const name = BUILDINGS[b.id];
      if (name) this.buildingLabels.set(b.id, new BuildingLabel(this, name, b.top.x));
    }
    // Members show their nickname and title; without a login (login off, or the dev server) it's "Guest".
    const member = this.me?.status === 'ok' ? this.me.me : null;
    this.player.setNameTag(member?.nickname ?? 'Guest', member?.title ?? TOWNFOLK);
    this.mountHud();
    startTownSound(this, this.fountainTile());
    if (member || fakeLogin()) this.connect();
    this.zoomIntro(); // last, once the names, labels and building cursors exist
    this.time.delayedCall(1800, () => this.announceRewards()); // once the arrival has settled
    exposeDebug(this);
    if (assetProblems.size) console.warn('[town] asset problems:\n' + [...assetProblems].join('\n'));
  }

  update(time: number, delta: number): void {
    const zoom = this.cameras.main.zoom;
    if (zoom !== this.labelZoom && !this.intro) this.sizeForZoom(zoom);
    this.ground.tick(time);
    this.player.update(delta);
    this.others.update(delta);
    hearFrom(this.player.tile);
    this.tellServer();
    if (this.follow && !this.intro) this.followPlayer();
    this.culler.update(this.cameras.main.worldView);
    this.objects.setLamps(this.lampsOn); // glows follow their lamp's visibility
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
    for (const l of this.buildingLabels.values()) l.setZoom(zoom);
    this.input.setDefaultCursor(cursor('pointer', zoom));
    for (const b of [...this.objects.buildings, ...this.objects.benches]) if (b.sprite.input) b.sprite.input.cursor = cursor('hand', zoom);
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
    mountTownHud({
      me: member,
      name: member?.nickname ?? 'Guest',
      avatar: headPortrait(this, this.M.characters, this.outfit),
      frame: frame ? { url: asset(frame.file), slice: frame.nineSlice } : null,
      coin,
      dots: dots?.file && Array.isArray(dots.frames) ? { url: asset(dots.file), frame: 0, size: dots.size?.[0] ?? 5, frames: dots.frames.length, names: dots.frames } : null,
      gear: this.M.ui.settingsIcon?.file ? asset(this.M.ui.settingsIcon.file) : null,
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
    if (member?.newTitle) {
      void showReward({ title: 'New title!', graphic: { kind: 'title', title: member.title }, message: `Congratulations! You are now known as <${member.title.name}>.` }).then(() =>
        fetch('/title/seen', { method: 'POST', credentials: 'same-origin' }).catch(() => null),
      );
    }
    if (import.meta.env.DEV) {
      const demo = new URLSearchParams(location.search).get('reward');
      if (demo === 'kowens') void showReward({ title: 'Reward', graphic: { kind: 'kowens', amount: 50 }, message: 'Congratulations! 50 Kowens are yours.' });
      if (demo === 'title') void showReward({ title: 'New title!', graphic: { kind: 'title', title: { name: 'Game Master', color: 'prismatic' } }, message: 'Congratulations! You are now known as <Game Master>.' });
    }
  }

  /** Debug: show a reward pop-up. */
  debugReward(r: Reward): Promise<void> {
    return showReward(r);
  }

  // ── Other players ──

  /** Joins the live town: others appear, the player's steps, turns and seats are passed on, and the chat opens. */
  private connect(): void {
    const link = new TownLink(this.outfit);
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
    this.others.onChange = () => online.update([me, ...this.others.players.map((p) => ({ name: p.nickname, title: p.title }))]);
    this.others.onChange();
    const tools = document.createElement('div');
    tools.className = 'ch-tools';
    tools.append(online.el, emotePicker(sheet, emote));
    const chat = new ChatBox((text) => link.send({ t: 'say', text }), tools);
    const feed = new SystemFeed();
    let myId = '';
    let arrived = false;
    this.player.onStep = (to) => {
      link.send({ t: 'step', col: to.col, row: to.row });
      this.sent = { dir: this.player.facing, sit: false };
    };
    link.onMessage = (m) => {
      if (m.t === 'snap') return this.player.place({ col: m.col, row: m.row });
      if (m.t === 'seat-taken') return this.seatTaken();
      if (m.t === 'say-refused') {
        if (m.reason === 'muted') {
          const left = Math.max(1, Math.ceil(((m.until ?? Date.now()) - Date.now()) / 60_000));
          return chat.notice(`You're muted in town chat for about ${left} more minute${left === 1 ? '' : 's'}.`);
        }
        return chat.notice(m.reason === 'slow' ? "You're chatting a bit fast. Wait a moment." : "That message can't be sent.");
      }
      if (m.t === 'say') {
        // Your own words come back from the server like everyone else's, so you see what they see.
        if (m.id === myId) {
          if (bubbles) this.player.say(m.text, bubbles);
          return chat.add(member?.nickname ?? 'You', m.text, 'me'); // (your own words make no sound)
        }
        chat.add(this.others.nameOf(m.id) ?? 'Someone', m.text);
        playSound('chat');
      }
      if (m.t === 'say-discord') {
        playSound('chat');
        return chat.add(m.name, m.text, 'discord');
      }
      if (m.t === 'system') {
        if (m.line.kind === 'gamble') playSound('chip');
        return feed.add(m.line);
      }
      if (m.t === 'announce') return announce(m.announcement);
      if (m.t === 'emote') {
        const char = this.others.charOf(m.id);
        if (char) this.playEmote(char, m.emote);
        return;
      }
      if (m.t === 'welcome') {
        myId = m.you;
        chat.history(m.recent ?? [], member?.nickname ?? null);
        feed.history(m.system ?? []);
        if (m.notice && !arrived) announce(m.notice); // a notice still current when you arrive
        // Arriving: go to the free tile the server picked (so people don't land on each other), unless you've
        // already walked off or this is a reconnect, in which case you stay where you are ('here' below).
        const [sc, sr] = this.map.spawn;
        const at = this.player.tile;
        if (!arrived && m.spawn && at.col === sc && at.row === sr && this.player.isIdle) {
          this.player.place({ col: m.spawn[0], row: m.spawn[1] });
          this.cameras.main.centerOn(this.player.sprite.x, this.player.sprite.y - 24);
        }
        arrived = true;
        chat.system(`Welcome to Mikazuki town${member ? `, ${member.nickname}` : ''}! Be kind and respectful in chat: everyone here is a neighbour.`);
        // After a reconnect, stay where you are rather than back at the spawn point.
        const t = this.player.tile;
        link.send({ t: 'here', col: t.col, row: t.row, dir: this.player.facing });
        this.sent = { dir: this.player.facing, sit: false };
      }
      this.others.handle(m);
    };
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

  /** Arriving: fade in from black, starting close on the player and easing out to the chosen zoom (skipped with
   *  reduced motion). */
  private zoomIntro(): void {
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
      duration: INTRO_MS,
      ease: 'Cubic.easeInOut',
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

  private setupInput(): void {
    // Benches are left-clickable too (sit), so they get the hand cursor.
    for (const b of this.objects.benches) b.sprite.setInteractive({ pixelPerfect: true, cursor: cursor('hand', this.cameras.main.zoom) });
    for (const b of this.objects.buildings) {
      b.sprite.setInteractive({ pixelPerfect: true, cursor: cursor('hand', this.cameras.main.zoom) });
      // The name shows while the building is hovered.
      b.sprite.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => {
        this.hovered = b;
        this.showBuildingName();
      });
      b.sprite.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => {
        if (this.hovered === b) this.hovered = null;
        this.showBuildingName();
      });
    }

    // Left click uses things (a building's door, a bench); right click only walks. A tap on a touch screen does
    // both, as there's no right button.
    this.input.mouse?.disableContextMenu();
    this.input.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (p.getDistance() > 8) return; // a drag, not a click
      const building = this.objects.buildings.find((b) => over.includes(b.sprite));
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
    toast(`${doorLabel(b.id)}: coming soon`);
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
  }

  // ── Day / night ──

  private updateSky(force: boolean): void {
    const sky = skyAt(minutesNow());
    this.lampsOn = sky.lampsOn;
    this.objects.setLamps(sky.lampsOn);
    if (!force && sky.tint === this.tint) return;
    this.tint = sky.tint;
    const all = [...this.ground.sprites, ...this.objects.sprites, ...this.player.tintables, ...this.others.tintables];
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
  if (document.getElementById('settings')) return true;
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

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
    /** Fixed view for screenshots: zoom and centre on a world point (follow off), or follow again. */
    view: (zoom?: number, x?: number, y?: number) => {
      const cam = scene.cameras.main;
      if (zoom) cam.setZoom(zoom);
      scene.follow = x === undefined;
      if (x !== undefined && y !== undefined) cam.centerOn(x, y);
    },
  };
}
