import Phaser from 'phaser';
import type { Dir, Manifest } from '../assets/types';
import type { Cutscene, CutsceneAt, CutsceneGhost, CutsceneStep } from '../assets/cutscenes';
import { loadNamedSounds, playNamed, playSound } from '../audio/sound';
import { type Character, dirForStep } from '../characters/character';
import { type Outfit, drawStill, randomOutfit, stillFiles } from '../characters/doll';
import { loadImages } from '../characters/loading';
import { closeNpcDialog, openNpcDialog } from '../ui/npc-dialog';
import type { BubbleArt } from '../ui/labels';
import { CHARACTER_BIAS, LABEL_DEPTH } from './depth';
import type { FxLayers } from './fx-layers';
import type { Tile, WalkGrid } from './grid';
import type { CutsceneCast } from './npc-life';
import { type WorldObjects, characterDepth } from './objects';

// 🎬 A cutscene (CONTEXT.md Cutscene; quests/cutscenes.json, its steps doc): its steps played in order on the map you're
// on, each a promise (a `walk` with `wait: false` doesn't hold the next). Black bars slide in and the HUD fades; the
// camera stops following you and goes where the scene says; the scene's NPCs leave their routines (CutsceneCast) and
// you can't move, attack or be hit (the scene sends the town `cutscene` on). Esc or the Skip button ends it at once
// with its end state: every quest line it stands for counted as heard, the lights it turns on on. Every scene ends
// the same way: bars off, the camera on you at your zoom, the HUD back, the NPCs let go.

/** What a cutscene needs from the scene it plays in. */
export interface CutsceneHost {
  scene: Phaser.Scene;
  M: Manifest;
  player: Character;
  grid: WalkGrid;
  objects: WorldObjects;
  fx: FxLayers;
  cast: CutsceneCast | null;
  bubbles: BubbleArt | null;
  /** An NPC's dialog box: name, title, portrait (its URL), voice and whether it's mirrored. */
  talker(id: string): { name: string; title: string; portrait: string; voice: number; mirror: boolean } | null;
  /** A quest's lines (`dialogue[part]`: a string or a list). */
  questLines(quest: string, part: string): string[];
  /** Your zoom (the camera goes back to it at the end). */
  zoom(): number;
  /** The camera following you (false: the scene moves it). */
  follow(on: boolean): void;
  /** Walks you to a tile, as a click would (the steps go to the server). */
  walkTo(t: Tile): void;
  /** A pose of yours played once ('idle-ready': your class's ready stance), done when it ends. */
  pose(anim: string): Promise<void>;
  /** The town treats you as away (no target, nothing lands, no attacks), and back. */
  away(on: boolean): void;
  /** The Old Market's sections by how near they are to the entrance plaza (the string lights' order). */
  sections(): string[];
  /** Tiles in front of stalls (walkable, next to a stall prop) within `radius` of a tile. */
  stallFronts(around: Tile, radius: number): Tile[];
}

export interface CutsceneRun {
  /** Watch again: nothing it stands for happens (no quest lines counted, no lights kept). */
  replay?: boolean;
  /** A quest's lines it says, heard (or skipped past): the quest step they stand for. */
  heard?: (quest: string, part: string) => void;
  /** It ended (`skipped`: by Esc or Skip). */
  done?: (skipped: boolean) => void;
}

/** The black bars: each a share of the screen's height (12%: a cinema's widescreen on a 16:9 screen), 48 px at least. */
const BAR_SHARE = 0.12;
const BAR_MIN_PX = 48;
/** How tall each bar is now (px). */
export const cutsceneBarPx = () => Math.max(BAR_MIN_PX, Math.round(innerHeight * BAR_SHARE));
const BAR_MS = 250;
const BANNER_FADE_MS = 400;
const EMOTE_MS = 800; // an NPC's wave, cheer or whistle: 8 frames at 10 fps
const GHOST = { tint: 0xbfd4ff, alpha: 0.35, inMs: 600, outMs: 900, bob: 1 };
/** Body height: the camera looks at a tile this far above its ground (px). */
const BODY_PX = 16;
/** The night navy fades go to (#111827). */
const NAVY: [number, number, number] = [17, 24, 39];
/** The HUD that fades out while a scene plays. */
const HUD = ['#town-hud', '#hotbar', '#skill-book', '#chat', '#chat-button', '#chat-toggle', '#bag-button', '#quest-tracker', '#party', '#stay', '#system-feed', '#target'];

/** The scene playing, if any (one at a time). */
let playing: Player | null = null;
export const cutscenePlaying = (): boolean => !!playing;
/** Skips the scene playing (Esc, the Skip button). */
export const skipCutscene = (): void => playing?.skip();
/** The map is going (its scene shutting down): the scene stops where it is, its bars and hold gone, nothing more of it
 *  played (the town's own end of it: its away flag ends as the link does, or after its 60 s). */
export const dropCutscene = (): void => playing?.drop();

export function playCutscene(host: CutsceneHost, id: string, scene: Cutscene, run: CutsceneRun = {}): void {
  if (playing) return;
  playing = new Player(host, id, scene, run);
  void playing.start();
}

class Player {
  private skipped = false;
  private over = false;
  private onSkip: (() => void)[] = [];
  private readonly held = new Set<string>();
  private readonly icons = new Map<string, Phaser.GameObjects.Image>();
  private readonly ghosts: Phaser.GameObjects.GameObject[] = [];
  private readonly heardParts = new Set<string>();
  private root: HTMLElement | null = null;
  private faded = false;
  /** Random looks for the old vendors, loaded as the scene starts. */
  private looks: Outfit[] = [];

  constructor(
    private readonly h: CutsceneHost,
    private readonly id: string,
    private readonly cs: Cutscene,
    private readonly run: CutsceneRun,
  ) {}

  async start(): Promise<void> {
    const h = this.h;
    // What it'll need: its sounds' sets, and the old vendors' random looks.
    loadNamedSounds(this.cs.steps.flatMap((s) => (s.sound ? [s.sound] : [])));
    const ghosts = this.cs.steps.reduce((n, s) => n + (s.ghosts ? s.ghosts.length + (s.count ?? 0) : 0), 0);
    if (ghosts) {
      this.looks = Array.from({ length: ghosts }, () => randomOutfit(h.M.characters, Math.random));
      void loadImages(h.scene, this.looks.flatMap((o) => stillFiles(h.M.characters, o, 'idle', 'se').concat(stillFiles(h.M.characters, o, 'idle', 'sw'))));
    }
    h.away(true);
    h.follow(false);
    document.addEventListener('keydown', this.keys, true);
    // A scene with no camera of its own plays where its moment is (beside the NPC you talked to); watched again from
    // elsewhere, it looks at its first NPC instead.
    if (!this.cs.steps.some((s) => s.camera !== undefined)) {
      const first = this.cs.steps.map((s) => s.say ?? s.face ?? s.anim ?? s.bubble ?? s.walk ?? s.hop ?? s.nod).find((x) => x && x !== 'player' && x !== 'narrator');
      const c = first ? this.actor(first) : null;
      const me = h.player.tile;
      if (c && Math.max(Math.abs(c.tile.col - me.col), Math.abs(c.tile.row - me.row)) > 6) h.scene.cameras.main.centerOn(c.sprite.x, c.sprite.y - BODY_PX);
    }
    try {
      for (const step of this.cs.steps) {
        if (this.skipped) break;
        await this.step(step);
      }
    } catch (e) {
      console.warn(`[cutscene] ${this.id}:`, e);
    }
    document.removeEventListener('keydown', this.keys, true);
    this.finish();
  }

  /** Esc or Skip: what's under way stops, the rest of the scene is skipped to its end state. */
  skip(): void {
    if (this.skipped || this.over) return;
    this.skipped = true;
    closeNpcDialog();
    for (const f of this.onSkip.splice(0)) f();
  }

  drop(): void {
    if (this.over) return;
    this.skipped = true;
    this.over = true;
    closeNpcDialog();
    for (const f of this.onSkip.splice(0)) f();
    document.removeEventListener('keydown', this.keys, true);
    document.body.classList.remove('cutscene-on');
    for (const sel of HUD) document.querySelector<HTMLElement>(sel)?.removeAttribute('data-cutscene-hidden');
    this.root?.remove();
    this.h.away(false);
    playing = null;
  }

  /** Esc skips. */
  private readonly keys = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    this.skip();
  };

  /** A promise that ends early on Skip. */
  private until<T>(p: Promise<T>): Promise<T | void> {
    if (this.skipped) return Promise.resolve();
    return Promise.race([p, new Promise<void>((ok) => this.onSkip.push(ok))]);
  }

  private wait(ms: number): Promise<void> {
    return this.until(new Promise<void>((ok) => this.h.scene.time.delayedCall(ms, ok))).then(() => undefined);
  }

  private async step(s: CutsceneStep): Promise<void> {
    const h = this.h;
    const cam = h.scene.cameras.main;
    if (s.bars !== undefined) return this.bars(s.bars);
    if (s.camera !== undefined) {
      const to = this.point(s.camera, true);
      if (!to) return;
      const ms = s.ms ?? 0;
      const zoom = s.zoom ?? null;
      if (!ms) {
        cam.centerOn(to.x, to.y);
        if (zoom) cam.setZoom(zoom);
      } else {
        await this.until(
          Promise.all([
            new Promise<void>((ok) => cam.pan(to.x, to.y, ms, 'Sine.easeInOut', true, (_c, p) => p >= 1 && ok())),
            zoom ? new Promise<void>((ok) => cam.zoomTo(zoom, ms, 'Sine.easeInOut', true, (_c, p) => p >= 1 && ok())) : Promise.resolve(),
          ]),
        );
      }
      if (s.hold) await this.wait(s.hold);
      return;
    }
    if (s.fade) {
      const ms = s.ms ?? 300;
      this.faded = s.fade === 'out';
      await this.until(
        new Promise<void>((ok) => {
          if (s.fade === 'out') {
            cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => ok());
            cam.fadeOut(ms, ...NAVY);
          } else {
            cam.once(Phaser.Cameras.Scene2D.Events.FADE_IN_COMPLETE, () => ok());
            cam.fadeIn(ms, ...NAVY);
          }
        }),
      );
      return;
    }
    if (typeof s.wait === 'number') return this.wait(s.wait);
    if (s.say) return this.say(s);
    if (s.bubble) {
      const c = this.actor(s.bubble);
      if (c && h.bubbles) c.say(s.text ?? '', h.bubbles);
      return this.wait(s.ms ?? 1800);
    }
    if (s.walk) return this.walk(s);
    if (s.place) {
      const c = this.actor(s.place);
      const at = this.tileOf(s.at ?? 'home', s.place);
      if (c && at) c.place(at, (s.face as Dir | undefined) ?? c.facing);
      return;
    }
    if (s.face) {
      const c = this.actor(s.face);
      const dir = s.dir && this.dirTo(c, s.dir);
      if (c && dir) c.face(dir);
      return;
    }
    if (s.anim) {
      if (s.anim === 'player') return void (await this.until(h.pose(s.play ?? 'idle-ready')));
      const c = this.actor(s.anim);
      if (c && (s.play === 'wave' || s.play === 'cheer' || s.play === 'whistle')) c.emote(s.play);
      return this.wait(EMOTE_MS);
    }
    if (s.hop) return this.bounce(s.hop, [-(s.px ?? 6), 0], 140);
    if (s.nod) return this.bounce(s.nod, [2, 0, 2, 0], 120);
    if (s.fx) {
      const at = this.point(s.at ?? 'player', false);
      const def = h.M.fx[s.fx];
      if (at && def) h.fx.play(def, { x: at.x + (s.dx ?? 0), y: at.y - (s.dy ?? 0) }, { layer: s.layer ?? 'front' });
      else if (!def) console.warn(`[cutscene] ${this.id}: no fx ${s.fx}`);
      return;
    }
    if (s.icon) return this.icon(s);
    if (s.sound) return void playNamed(s.sound);
    if (s.shake) return void cam.shake(s.shake, s.power ?? 0.004);
    if (s.banner) return this.banner(s.banner, s.sub ?? '', s.ms ?? 2500);
    if (s.lights) return this.lights(s.lights, s.ms ?? 350);
    if (s.ghosts) return void this.showGhosts(s);
  }

  // ── The bars, the HUD and the Skip button ──

  private bars(on: boolean): Promise<void> {
    if (on && !this.root) {
      const root = document.createElement('div');
      root.id = 'cutscene';
      const top = document.createElement('div');
      top.className = 'cs-bar cs-top';
      const bottom = document.createElement('div');
      bottom.className = 'cs-bar cs-bottom';
      const skip = document.createElement('button');
      skip.type = 'button';
      skip.className = 'cs-skip';
      skip.dataset.dialogPass = '';
      skip.textContent = 'Skip ▸▸';
      skip.addEventListener('click', (e) => {
        e.stopPropagation();
        this.skip();
      });
      bottom.append(skip);
      root.append(top, bottom);
      root.style.setProperty('--bar', `max(${BAR_MIN_PX}px, ${BAR_SHARE * 100}vh)`);
      root.style.setProperty('--bar-ms', `${BAR_MS}ms`);
      document.body.append(root);
      this.root = root;
      requestAnimationFrame(() => root.classList.add('cs-on'));
    }
    document.body.classList.toggle('cutscene-on', on);
    for (const sel of HUD) document.querySelector<HTMLElement>(sel)?.toggleAttribute('data-cutscene-hidden', on);
    if (!on) this.root?.classList.remove('cs-on');
    return this.wait(BAR_MS);
  }

  private async banner(text: string, sub: string, ms: number): Promise<void> {
    const b = document.createElement('div');
    b.className = 'cs-banner';
    const t = document.createElement('div');
    t.className = 'cs-banner-title';
    t.textContent = text;
    b.append(t);
    if (sub) {
      const s = document.createElement('div');
      s.className = 'cs-banner-sub';
      s.textContent = sub;
      b.append(s);
    }
    b.style.setProperty('--fade', `${BANNER_FADE_MS}ms`);
    (this.root ?? document.body).append(b);
    requestAnimationFrame(() => b.classList.add('cs-shown'));
    await this.wait(Math.max(0, ms - BANNER_FADE_MS));
    b.classList.remove('cs-shown');
    setTimeout(() => b.remove(), BANNER_FADE_MS);
    if (!this.skipped) await this.wait(BANNER_FADE_MS);
  }

  // ── Who and where ──

  /** Someone in the scene: you, or an NPC (held from its routine from now until the scene ends). */
  private actor(id: string): Character | null {
    if (id === 'player') return this.h.player;
    const c = this.h.cast?.actor(id) ?? null;
    if (c && !this.held.has(id)) {
      this.held.add(id);
      this.h.cast!.hold(id, true);
    }
    return c;
  }

  /** A tile: [col, row], someone's tile, or 'home' (`who`'s own spot). */
  private tileOf(at: CutsceneAt, who?: string): Tile | null {
    if (Array.isArray(at)) return { col: at[0], row: at[1] };
    if (at === 'home') return who ? (this.h.cast?.home(who) ?? null) : null;
    return this.actor(at)?.tile ?? null;
  }

  /** A world point: someone (their feet, or at body height for the camera), or a tile's middle (its ground, or at body
   *  height). */
  private point(at: CutsceneAt, body: boolean): { x: number; y: number } | null {
    if (!Array.isArray(at) && at !== 'home') {
      const c = this.actor(at);
      return c ? { x: c.sprite.x, y: c.sprite.y - (body ? BODY_PX : 0) } : null;
    }
    const t = this.tileOf(at);
    if (!t) return null;
    const ground = this.h.objects.heights.lift(t.col + 0.5, t.row + 0.5);
    return { x: (t.col - t.row) * 16, y: (t.col + t.row + 1) * 8 - ground - (body ? BODY_PX : 0) };
  }

  /** The way to face: a direction, or toward someone. */
  private dirTo(c: Character | null, dir: string): Dir | null {
    if (!c) return null;
    if (['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].includes(dir)) return dir as Dir;
    const t = this.tileOf(dir);
    if (!t) return null;
    const dc = t.col - c.tile.col;
    const dr = t.row - c.tile.row;
    if (!dc && !dr) return null;
    return dirForStep(Math.abs(dc) < Math.abs(dr) / 2 ? 0 : dc, Math.abs(dr) < Math.abs(dc) / 2 ? 0 : dr);
  }

  // ── Steps ──

  private async say(s: CutsceneStep): Promise<void> {
    const lines = s.quest ? this.h.questLines(s.quest, s.part ?? 'give') : (s.lines ?? []);
    if (!lines.length) return;
    const narrator = s.say === 'narrator';
    const who = narrator ? null : s.say === 'player' ? null : this.h.talker(s.say!);
    if (!narrator && !who && s.say !== 'player') console.warn(`[cutscene] ${this.id}: nobody called ${s.say}`);
    // (Said through to its last line, or skipped: either way the quest's lines count as heard.)
    const heard = () => {
      if (!s.quest || this.run.replay) return;
      const k = `${s.quest}:${s.part ?? 'give'}`;
      if (this.heardParts.has(k)) return;
      this.heardParts.add(k);
      this.run.heard?.(s.quest, s.part ?? 'give');
    };
    if (s.quest) this.onSkip.push(heard);
    await this.until(
      new Promise<void>((ok) =>
        openNpcDialog({
          id: `cutscene:${this.id}`,
          name: who?.name ?? '',
          title: who?.title ?? '',
          portrait: who?.portrait ?? '',
          voice: who?.voice ?? 1,
          mirror: who?.mirror ?? false,
          narrator: narrator || !who,
          lines,
          next: () => lines[0],
          onDone: heard,
          onClose: () => ok(),
        }),
      ),
    );
  }

  private async walk(s: CutsceneStep): Promise<void> {
    const h = this.h;
    const c = this.actor(s.walk!);
    if (!c) return;
    let to = this.tileOf(s.to ?? 'home', s.walk);
    if (!to) return;
    const from = c.isIdle ? c.tile : c.heading;
    if (s.to === 'player' && s.stopAt) {
      const path = h.grid.findPath(from, to);
      if (!path) return;
      to = path[Math.max(0, path.length - 1 - s.stopAt)];
    }
    if (s.walk === 'player') h.walkTo(to);
    else {
      const path = h.grid.findPath(from, to) ?? (h.grid.nearestReachable(from, to) ? h.grid.findPath(from, h.grid.nearestReachable(from, to)!) : null);
      if (!path) return void c.place(to);
      c.walk(path);
    }
    if (s.wait === false) return;
    await this.until(new Promise<void>((ok) => {
      const check = () => (c.isIdle || this.skipped ? ok() : h.scene.time.delayedCall(100, check));
      h.scene.time.delayedCall(100, check);
    }));
  }

  /** A quick tween of someone's height (a hop up, a nod down), through `ys` and back to 0. */
  private async bounce(id: string, ys: number[], ms: number): Promise<void> {
    const c = this.actor(id);
    if (!c) return;
    for (const y of ys) {
      const from = { y: 0 };
      await this.until(new Promise<void>((ok) => this.h.scene.tweens.add({ targets: from, y: { from: 0, to: y }, duration: ms / 2, yoyo: y !== 0, ease: 'Sine.easeOut', onUpdate: () => c.setNudge(0, from.y), onComplete: () => ok() })));
      c.setNudge(0, 0);
    }
  }

  /** An item's icon over everything at a spot: held, or rising (falling if negative), a soft white glint at its end. */
  private async icon(s: CutsceneStep): Promise<void> {
    const h = this.h;
    const key = s.icon!;
    if (s.hide) {
      this.icons.get(key)?.destroy();
      this.icons.delete(key);
      return;
    }
    const at = this.point(s.at ?? 'player', false);
    if (!at) return;
    if (!h.scene.textures.exists(key)) await this.until(loadImages(h.scene, [key]));
    if (!h.scene.textures.exists(key)) return void console.warn(`[cutscene] ${this.id}: no icon ${key}`);
    this.icons.get(key)?.destroy();
    const img = h.scene.add.image(at.x + (s.dx ?? 0), at.y - (s.dy ?? 0), key).setDepth(LABEL_DEPTH + 10);
    // (A 64 px icon is drawn at 32: the world's scale, sharp at every zoom.)
    if (img.width > 32) img.setScale(32 / img.width);
    this.icons.set(key, img);
    const ms = s.ms ?? 1200;
    if (s.rise) await this.until(new Promise<void>((ok) => h.scene.tweens.add({ targets: img, y: img.y - s.rise!, duration: ms, ease: 'Sine.easeOut', onComplete: () => ok() })));
    else await this.wait(ms);
    if (s.glint && img.scene) {
      img.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      await this.wait(120);
      if (img.scene) img.setTintMode(Phaser.TintModes.MULTIPLY).clearTint();
    }
  }

  /** The Old Market's string lights on for you: one section, or all from the plaza out, a soft chime each. */
  private async lights(which: string, ms: number): Promise<void> {
    const list = which === 'all' ? this.h.sections() : [which];
    for (const [i, id] of list.entries()) {
      this.h.objects.lightSection(id);
      if (this.skipped) continue;
      playSound('emote', 0.1, Math.min(600, i * 100)); // (a step higher each, like chimes)
      if (i < list.length - 1) await this.wait(ms);
    }
  }

  /** The old vendors: see-through pale figures, fading in, bobbing, fading out; each given one, and `count` more in
   *  front of stalls round `around` (on screen). Doesn't hold the next step. */
  private showGhosts(s: CutsceneStep): void {
    const h = this.h;
    const view = h.scene.cameras.main.worldView;
    const list: CutsceneGhost[] = [...(s.ghosts ?? [])];
    if (s.around && s.count) {
      const taken = new Set(list.map((g) => `${g.at[0]},${g.at[1]}`));
      const bar = cutsceneBarPx() / h.scene.cameras.main.zoom; // (never under a bar)
      const free = h.stallFronts({ col: s.around[0], row: s.around[1] }, s.radius ?? 8).filter((t) => {
        const x = (t.col - t.row) * 16;
        const y = (t.col + t.row + 1) * 8;
        return !taken.has(`${t.col},${t.row}`) && x > view.x + 16 && x < view.right - 16 && y > view.y + bar + 32 && y < view.bottom - bar;
      });
      Phaser.Utils.Array.Shuffle(free);
      for (const t of free.slice(0, s.count)) list.push({ at: [t.col, t.row], look: 'random', face: Math.random() < 0.5 ? 'se' : 'sw', do: Math.random() < 0.3 ? 'wave' : null });
    }
    for (const g of list) this.ghost(g, s.ms ?? 4000);
  }

  private ghost(g: CutsceneGhost, ms: number): void {
    const h = this.h;
    const [col, row] = g.at;
    const ground = h.objects.heights.lift(col + 0.5, row + 0.5);
    const x = (col - row) * 16;
    const y = (col + row + 1) * 8 - ground;
    const dir: Dir = g.face ?? 'se';
    let sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image | null = null;
    const N = h.M.npcs;
    if (g.look !== 'random' && N) {
      // An NPC's look: its own sheet (Aling Rosa in Tisay's, Mang Ramon in Kuya Jun's), waving if asked.
      const file = N.file.replace('{id}', g.look).replace('{anim}', 'idle').replace('{dir}', dir);
      if (h.scene.textures.exists(file)) {
        const sp = h.scene.add.sprite(x, y, file, 0).setOrigin(N.anchor[0] / N.cell[0], N.anchor[1] / N.cell[1]);
        const wave = `npc:${g.look}:wave:${dir}`;
        if (g.do === 'wave' && h.scene.anims.exists(wave)) h.scene.time.delayedCall(GHOST.inMs, () => sp.scene && sp.play(wave));
        sprite = sp;
      }
    }
    if (!sprite) {
      // A doll with a random look (the player's own if none is loaded yet), drawn once as a still.
      const C = h.M.characters;
      const look = this.looks.pop() ?? null;
      const key = `cutscene-ghost:${Math.random().toString(36).slice(2)}`;
      const canvas = document.createElement('canvas');
      [canvas.width, canvas.height] = C.cell;
      if (look) drawStill(canvas.getContext('2d')!, h.scene, C, look, 'idle', dir, 0, 0, 0);
      h.scene.textures.addCanvas(key, canvas);
      sprite = h.scene.add.image(x, y, key).setOrigin(C.anchor[0] / C.cell[0], C.anchor[1] / C.cell[1]);
      sprite.once(Phaser.GameObjects.Events.DESTROY, () => h.scene.textures.exists(key) && h.scene.textures.remove(key));
    }
    const feet = (col + row + 1) * 8 + CHARACTER_BIAS;
    sprite.setDepth(characterDepth(h.objects, col, row, feet, sprite.getBounds())).setTint(GHOST.tint).setTintMode(Phaser.TintModes.FILL).setAlpha(0);
    this.ghosts.push(sprite);
    const sp = sprite;
    h.scene.tweens.add({ targets: sp, alpha: GHOST.alpha, duration: GHOST.inMs });
    h.scene.tweens.add({ targets: sp, y: y - GHOST.bob, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    if (g.do === 'nod') h.scene.time.delayedCall(GHOST.inMs, () => sp.scene && h.scene.tweens.add({ targets: sp, y: y + 2, duration: 120, yoyo: true, repeat: 1 }));
    h.scene.time.delayedCall(GHOST.inMs + ms, () => sp.scene && h.scene.tweens.add({ targets: sp, alpha: 0, duration: GHOST.outMs, onComplete: () => sp.destroy() }));
  }

  // ── The end ──

  /** Bars off, the camera on you at your zoom, the HUD back, the NPCs let go; skipped: every quest line it stands for
   *  heard and every light it turns on on. */
  private finish(): void {
    if (this.over) return;
    const h = this.h;
    if (this.skipped) {
      for (const s of this.cs.steps) {
        if (s.lights) for (const id of s.lights === 'all' ? h.sections() : [s.lights]) h.objects.lightSection(id);
        if (s.say && s.quest && !this.run.replay && !this.heardParts.has(`${s.quest}:${s.part ?? 'give'}`)) {
          this.heardParts.add(`${s.quest}:${s.part ?? 'give'}`);
          this.run.heard?.(s.quest, s.part ?? 'give');
        }
      }
    }
    this.over = true;
    const cam = h.scene.cameras.main;
    if (this.faded || this.skipped) cam.resetFX();
    cam.panEffect.reset();
    cam.zoomEffect.reset();
    cam.setZoom(h.zoom());
    h.follow(true);
    for (const id of this.held) h.cast?.hold(id, false);
    for (const img of this.icons.values()) img.destroy();
    for (const g of this.ghosts) g.destroy();
    h.player.setNudge(0, 0);
    document.body.classList.remove('cutscene-on');
    for (const sel of HUD) document.querySelector<HTMLElement>(sel)?.removeAttribute('data-cutscene-hidden');
    const root = this.root;
    root?.classList.remove('cs-on');
    setTimeout(() => root?.remove(), BAR_MS);
    h.away(false);
    playing = null;
    this.run.done?.(this.skipped);
  }
}
