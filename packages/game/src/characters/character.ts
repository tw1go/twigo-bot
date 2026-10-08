import Phaser from 'phaser';
import type { CharacterDefs, ClassArt, ClassLayer, Dir, Manifest } from '../assets/types';
import { slice } from '../assets/packs';
import { restLayers } from './kit-art';
import type { BattleSheets } from './battle-art';
import { CHARACTER_BIAS, HEIGHT_DEPTH, LABEL_DEPTH } from '../world/depth';
import type { Tile } from '../world/grid';
import { type Outfit, headTop, sheetKey } from './doll';
import type { AuraTier, TitleData } from '@mikazuki/shared';
import { type AuraTrace, WeaponAura, traceAura } from '../fx/weaponAura';
import { type BubbleArt, EmotePop, LevelUpPop, NameTag, QuestMarker, SpeechBubble } from '../ui/labels';

// A walking paper doll (or a flat pre-baked sheet set: the town's NPCs, world/npcs.ts). Position is in tile space
// (tile centre = col + 0.5); the sprite's feet anchor sits on it. Depth is the front corner of the tile the feet are
// on, refreshed every frame.

export const SPEED = 4; // tiles per second (players; NPCs walk slower: `speed`)
const HP_BAR_W = 20; // the HP bar over a hurt player (a mob's is as wide)
const KO_FADE_MS = 600; // a knocked-out player fades out this long (back in half as long)

/** A character drawn from flat sheets instead of a paper doll: the animation key per animation and direction (made
 *  by the caller), how many empty rows sit above the head in the cell, and the directions drawn. */
export interface FlatSheets {
  key: (anim: string, dir: Dir) => string;
  head: number;
  directions: Dir[];
}

/** Facing for one grid step: col runs screen right-down, row runs screen left-down. */
export function dirForStep(dc: number, dr: number): Dir {
  const key = `${Math.sign(dc)},${Math.sign(dr)}`;
  const table: Record<string, Dir> = {
    '1,0': 'se', '0,1': 'sw', '1,1': 's', '-1,-1': 'n',
    '1,-1': 'e', '-1,1': 'w', '-1,0': 'nw', '0,-1': 'ne',
  };
  return table[key] ?? 's';
}

/** The facing nearest a screen direction (dx, dy px): for turning toward something more than a step away (a mob a skill is
 *  cast at), where dirForStep's signs would round (3, 1) and (1, 3) alike to S. The art's eight ways, by their angle on
 *  screen (SE is along +col: 16 px across, 8 down). */
export function dirToward(dx: number, dy: number): Dir {
  if (!dx && !dy) return 's';
  const a = Math.atan2(dy, dx);
  let best: Dir = 's';
  let gap = Infinity;
  for (const [d, [x, y]] of Object.entries(SCREEN) as [Dir, [number, number]][]) {
    const g = Math.abs(Math.atan2(Math.sin(a - Math.atan2(y, x)), Math.cos(a - Math.atan2(y, x))));
    if (g < gap) [best, gap] = [d, g];
  }
  return best;
}
const SCREEN: Record<Dir, [number, number]> = { e: [32, 0], se: [16, 8], s: [0, 16], sw: [-16, 8], w: [-32, 0], nw: [-16, -8], n: [0, -16], ne: [16, -8] };

export class Character {
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly shadow: Phaser.GameObjects.Image | null;
  private alert: Phaser.GameObjects.Sprite | null = null;
  /** A one-off effect over the head (a big win's coin burst, a bust's siren), drawn over the world. */
  private overhead: Phaser.GameObjects.Sprite | null = null;
  /** fx jailBars over the character while they're in jail. */
  private bars: Phaser.GameObjects.Sprite | null = null;
  private tag: NameTag | null = null;
  private bubble: SpeechBubble | null = null;
  private bubbleTimer: Phaser.Time.TimerEvent | null = null;
  private pop: EmotePop | null = null;
  private levelPop: LevelUpPop | null = null;
  private marker: QuestMarker | null = null;
  /** A thin HP bar over the name while hurt (players in battle maps; everyone sees it). */
  private hpBar: Phaser.GameObjects.Graphics | null = null;
  /** How much of the character shows: 1, or fading to 0 while knocked out (and back as they respawn). */
  private seen = 1;
  private seenTween: Phaser.Tweens.Tween | null = null;
  /** Knocked out (0 HP): faded out where they fell until they respawn. */
  knockedOut = false;
  /** The class's resting weapon (behind and in front of the body), drawn over idle and walk. */
  private rest: { art: ClassArt; offset: [number, number]; back: Phaser.GameObjects.Sprite[]; front: Phaser.GameObjects.Sprite[] } | null = null;
  /** The worn weapon's aura (+15 and up, fx/weaponAura.ts): round the resting weapon in town, the weapon in hand in battle. */
  private aura: WeaponAura | null = null;
  private zoom = 1;
  private head = 0; // rows of empty cell above the head (headTop)
  private col: number; // tile-space position of the feet (tile centre = integer + 0.5)
  private row: number;
  private path: Tile[] = [];
  /** The tile the current step started from: facing comes from the whole step, not the distance left. */
  private stepFrom: Tile = { col: 0, row: 0 };
  /** The step in progress already turned mid-way (keyboard walking; once per step). */
  private turned = false;
  private dir: Dir = 's';
  private anim = 'idle';
  private sittingAt: { depth: number } | null = null;
  private lastWalkFrame = -1;
  private readonly boundsCache = new Phaser.Geom.Rectangle();
  /** Corrects the feet depth against big objects (set by the scene; see WorldObjects.sortAgainstBig). */
  depthFn: ((col: number, row: number, depth: number, bounds: Phaser.Geom.Rectangle) => number) | null = null;
  /** Called once the character stops on its destination tile. */
  onArrive: ((tile: Tile) => void) | null = null;
  /** Supplies the next tile while a movement key is held (keyboard walking), or null to stop. */
  nextStep: (() => Tile | null) | null = null;
  /** Called as each step to a neighbouring tile begins (the town tells the server). */
  onStep: ((to: Tile) => void) | null = null;
  private announced: Tile | null = null;
  /** Walking speed, tiles per second. */
  speed = SPEED;
  /** A mobility move (world/mobility.ts) is moving this character: walking and steps wait. */
  busy = false;
  /** Pixels the body is lifted off the ground (a hop); the shadow stays down. */
  lift = 0;
  /** Drawn this far (px) off its tile for now, its shadow too: a skill's dash (combat/world-skills.ts), back to 0 after. */
  private nudge = { x: 0, y: 0 };

  setNudge(x: number, y: number): void {
    this.nudge = { x, y };
    this.sync();
  }
  /** How high the ground is at a point (raised ground: world/heights.ts), in px; everything of the character stands on it. */
  elevation: ((col: number, row: number) => number) | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly M: Manifest,
    private outfit: Outfit,
    start: Tile,
    /** Flat sheets instead of the paper doll (`outfit` is then unused). */
    private readonly flat: FlatSheets | null = null,
  ) {
    const C: CharacterDefs = M.characters;
    this.col = start.col + 0.5;
    this.row = start.row + 0.5;
    this.sprite = scene.add.sprite(0, 0, this.keyFor('idle', 's'), 0).setOrigin(C.anchor[0] / C.cell[0], C.anchor[1] / C.cell[1]);
    const sh = M.fx.shadow;
    this.shadow = sh?.file ? scene.add.image(0, 0, sh.file).setOrigin((sh.anchor?.[0] ?? 0) / (sh.size?.[0] ?? 1), (sh.anchor?.[1] ?? 0) / (sh.size?.[1] ?? 1)) : null;
    this.head = flat ? flat.head : headTop(scene, outfit);
    this.play('idle');
    this.sync();
  }

  /** Name and <Title> over the head (null removes them); `nameOnly`: no title line (an NPC's). */
  setNameTag(nickname: string | null, title: TitleData, opts: { nameOnly?: boolean } = {}): void {
    this.tag?.destroy();
    this.tag = nickname ? new NameTag(this.scene, nickname, title, opts) : null;
    this.tag?.setZoom(this.zoom);
    this.tag?.setParty(this.inParty);
    this.sync();
  }

  /** In your party: the name turns pink (on your screen only). */
  setParty(on: boolean): void {
    this.inParty = on;
    this.tag?.setParty(on);
  }
  private inParty = false;

  /** Jail bars over the character (manifest fx jailBars, in the same cell, on top of their layers), or off. */
  setJailed(on: boolean): void {
    if (!on) {
      this.bars?.destroy();
      this.bars = null;
      return;
    }
    const fx = this.M.fx.jailBars;
    if (this.bars || !fx?.file || !this.scene.textures.exists(fx.file)) return;
    const [w, h] = fx.size ?? this.M.characters.cell;
    const [ax, ay] = fx.anchor ?? this.M.characters.anchor;
    this.bars = this.scene.add.sprite(0, 0, fx.file).setOrigin(ax / w, ay / h);
    this.onSpawn?.(this.bars); // tinted with the world at night
    this.sync();
  }

  /** Carries a class's resting weapon (its sheets must be loaded: kit-art restFiles), or none. `offset`: where the
   *  doll's cell sits in the weapon's 64x64 cell (manifest classes.bodyOffset). */
  setRestingWeapon(art: ClassArt | null, offset: [number, number] = [16, 10]): void {
    for (const sp of [...(this.rest?.back ?? []), ...(this.rest?.front ?? [])]) sp.destroy();
    this.rest = null;
    if (!art) return;
    const make = (n: number) => Array.from({ length: n }, () => {
      const sp = this.scene.add.sprite(0, 0, '__DEFAULT').setVisible(false);
      this.onSpawn?.(sp);
      return sp;
    });
    const most = (k: 'back' | 'front') => Math.max(0, ...this.M.characters.directions.flatMap((d) => ['idle', 'walk'].map((a) => restLayers(art, a as 'idle', d)?.[k].length ?? 0)));
    this.rest = { art, offset, back: make(most('back')), front: make(most('front')) };
    this.sync();
  }

  /** The worn weapon's aura (null: none), on whatever weapon shows: the resting weapon in town, the weapon in hand in
   *  battle poses. */
  setAura(tier: AuraTier | null): void {
    if (!tier && !this.aura) return;
    this.aura ??= new WeaponAura(this.scene, [64, 64]);
    this.aura.set(tier);
    this.sync();
  }

  /** A quest marker over the name (a "!" or "…" in the quest's colour), or none. */
  setQuestMarker(mark: { symbol: string; color: string } | null): void {
    this.marker?.destroy();
    this.marker = mark ? new QuestMarker(this.scene, mark.symbol, mark.color) : null;
    this.marker?.setZoom(this.zoom);
    this.sync();
  }

  /** Sizes the name tag (and any speech bubble) for the camera zoom. */
  setZoom(zoom: number): void {
    this.zoom = zoom;
    this.tag?.setZoom(zoom);
    this.marker?.setZoom(zoom);
    this.bubble?.setZoom(zoom);
    this.pop?.setZoom(zoom);
    this.levelPop?.setZoom(zoom);
    this.sync();
  }

  /** "Level up!" over the head (above any bubble or emote) for about 2 s. */
  levelUp(): void {
    this.levelPop?.destroy();
    const pop = new LevelUpPop(this.scene, () => {
      if (this.levelPop === pop) this.levelPop = null;
    });
    pop.setZoom(this.zoom);
    this.levelPop = pop;
    this.sync();
  }

  /** An emote icon over the head (above any speech bubble) for about 2 s; a new one replaces it. */
  showEmote(sheet: string, frame: number): void {
    this.pop?.destroy();
    const pop = new EmotePop(this.scene, sheet, frame, () => {
      if (this.pop === pop) this.pop = null;
    });
    pop.setZoom(this.zoom);
    this.pop = pop;
    this.sync();
  }

  /** Says something: a bubble over the name for a few seconds (longer for longer messages). A new one replaces it. */
  say(text: string, art: BubbleArt): void {
    this.bubbleTimer?.remove();
    this.bubble?.destroy();
    const bubble = new SpeechBubble(this.scene, art, text);
    bubble.setZoom(this.zoom);
    this.bubble = bubble;
    this.sync();
    this.bubbleTimer = this.scene.time.delayedCall(4000 + text.length * 60, () => {
      bubble.fade(this.scene, () => {
        if (this.bubble === bubble) this.bubble = null;
      });
    });
  }

  get tile(): Tile {
    return { col: Math.floor(this.col), row: Math.floor(this.row) };
  }

  /** Standing still (no steps left to walk). */
  get isIdle(): boolean {
    return !this.path.length;
  }

  get isSitting(): boolean {
    return !!this.sittingAt;
  }

  get facing(): Dir {
    return this.dir;
  }

  /** Where a new path should start: the tile the step in progress is heading for, else the tile you're on. */
  get heading(): Tile {
    const step = this.path[0];
    return step ? { col: step.col, row: step.row } : this.tile;
  }

  /** Follow a path (from `heading`, or the current tile). Mid-step, the step in progress is finished first, so a
   *  new click never stops you between two tiles. */
  walk(path: Tile[]): void {
    this.standUp();
    const step = this.path[0];
    const same = (a: Tile | undefined, b: Tile | undefined) => !!a && !!b && a.col === b.col && a.row === b.row;
    if (step && same(path[0], step)) {
      this.path = [step, ...path.slice(1)]; // carry on with the step in progress (stepFrom stays)
      return;
    }
    this.path = path.slice(same(path[0], this.tile) ? 1 : 0);
    this.stepFrom = this.tile;
    // Clicked the tile you're crossing: walk on to its centre rather than stopping off it.
    if (!this.path.length && (this.col % 1 !== 0.5 || this.row % 1 !== 0.5)) this.path = [this.tile];
    if (!this.path.length) this.arrive();
  }

  /** Snap onto a bench and sit facing the way it faces. */
  sit(tile: Tile, faces: Dir, benchDepth: number): void {
    this.path = [];
    this.col = tile.col + 0.5;
    this.row = tile.row + 0.5;
    this.dir = faces;
    // Facing the camera (se/sw), the sitter is in front of the bench. Facing away (ne/nw), the backrest is
    // nearer the camera than the sitter, so the bench draws over them.
    const away = faces === 'ne' || faces === 'nw';
    this.sittingAt = { depth: benchDepth + (away ? -CHARACTER_BIAS : CHARACTER_BIAS) };
    this.play('sit');
    this.sync();
  }

  standUp(): void {
    if (!this.sittingAt) return;
    this.sittingAt = null;
    this.play('idle');
  }

  /** Another player's step, from the server: walked after any still queued. Too far behind, it jumps there. */
  queueStep(tile: Tile): void {
    if (this.busy) return; // a move is taking them there; it ends on the tile the server has them on
    this.standUp();
    if (this.path.length >= 4) return this.place(tile);
    if (!this.path.length) this.stepFrom = this.tile;
    this.path.push(tile);
  }

  /** Teleport (spawn, debug). */
  place(tile: Tile, dir: Dir = this.dir): void {
    this.standUp();
    this.path = [];
    this.col = tile.col + 0.5;
    this.row = tile.row + 0.5;
    this.dir = dir;
    this.play('idle');
    this.sync();
  }

  /** Where the feet are, in tiles (a tile's centre is col + 0.5). */
  get spot(): { col: number; row: number } {
    return { col: this.col, row: this.row };
  }

  /** Puts the feet at a tile-space point (a scripted move: an NPC racing), facing `dir`, walking or standing. */
  pose(col: number, row: number, dir: Dir, walking: boolean): void {
    this.standUp();
    this.path = [];
    this.col = col;
    this.row = row;
    this.dir = dir;
    if (walking) {
      this.play('walk');
      this.stepDust();
    } else if (this.anim === 'walk') this.play('idle');
    this.sync();
  }

  /** Plays an animation and stays in it (a loop, or the last frame of a one-off) until she walks or is set to idle
   *  (an NPC racer sitting down, falling, getting up). False if there's no such animation for her. */
  hold(anim: string): boolean {
    const key = this.keyFor(anim, this.dir);
    if (!this.scene.anims.exists(key)) return false;
    this.path = [];
    this.play(anim);
    return true;
  }

  /** Tipped over on the ground (a fall: there's no fall art, so the sprite lies on its side), or back up. */
  tip(on: boolean): void {
    this.sprite.setAngle(on ? (this.dir === 'w' || this.dir === 'sw' || this.dir === 'nw' ? 90 : -90) : 0);
    if (on) this.play('idle');
  }

  /** Play wave or cheer (an NPC's whistle) once, then go back to idle. */
  emote(anim: 'wave' | 'cheer' | 'whistle'): void {
    if (this.path.length || this.sittingAt) return;
    this.play(anim);
    this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => this.play('idle'));
  }

  /** fx-alert above the head while `on`. */
  setAlert(on: boolean): void {
    const fx = this.M.fx.alert;
    if (!on || !fx?.file) {
      this.alert?.destroy();
      this.alert = null;
      return;
    }
    if (this.alert) return;
    const key = `anim:${fx.file}`;
    if (!this.scene.anims.exists(key)) {
      this.scene.anims.create({ key, frames: this.scene.anims.generateFrameNumbers(fx.file, { start: 0, end: (fx.frames ?? 1) - 1 }), frameRate: fx.fps ?? 4, repeat: -1 });
    }
    this.alert = this.scene.add.sprite(0, 0, fx.file).setOrigin(0.5, 1);
    this.alert.play(key);
    this.sync();
  }

  /** Plays an fx over the head `times` times (the manifest's `name`, else `fallback`), then removes it; a new one
   *  replaces it. Not tinted at night: these are light. */
  flash(name: string, fallback: string, times: number): void {
    const fx = this.M.fx[name]?.file ? this.M.fx[name] : this.M.fx[fallback];
    if (!fx?.file || !this.scene.textures.exists(fx.file)) return;
    const key = `anim:${fx.file}:x${times}`;
    if (!this.scene.anims.exists(key)) {
      this.scene.anims.create({ key, frames: this.scene.anims.generateFrameNumbers(fx.file, { start: 0, end: (fx.frames ?? 1) - 1 }), frameRate: fx.fps ?? 8, repeat: times - 1 });
    }
    this.overhead?.destroy();
    const sprite = this.scene.add.sprite(0, 0, fx.file).setOrigin(0.5, 1).setDepth(LABEL_DEPTH - 1);
    sprite.play(key).once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      sprite.destroy();
      if (this.overhead === sprite) this.overhead = null;
    });
    this.overhead = sprite;
    this.sync();
  }

  update(deltaMs: number): void {
    if (this.busy) return;
    if (!this.path.length) this.takeNextStep();
    if (this.path.length) {
      let budget = (this.speed * deltaMs) / 1000;
      while (budget > 0 && (this.path.length || this.takeNextStep())) {
        const next = this.path[0];
        const tx = next.col + 0.5;
        const ty = next.row + 0.5;
        const dx = tx - this.col;
        const dy = ty - this.row;
        const dist = Math.hypot(dx, dy);
        if (next.col !== this.stepFrom.col || next.row !== this.stepFrom.row) this.dir = dirForStep(next.col - this.stepFrom.col, next.row - this.stepFrom.row);
        if (next !== this.announced) {
          this.announced = next;
          this.onStep?.(next);
        }
        if (dist <= budget) {
          this.col = tx;
          this.row = ty;
          budget -= dist;
          this.stepFrom = next;
          this.path.shift();
          this.turned = false;
        } else {
          this.col += (dx / dist) * budget;
          this.row += (dy / dist) * budget;
          budget = 0;
        }
      }
      this.play('walk');
      this.stepDust();
      if (!this.path.length) this.arrive();
    }
    this.sync();
  }

  /** Footstep dust on the first frame of each walk cycle: one puff every other step. (Polled, because a looping
   *  animation doesn't emit a frame update when it wraps back to its first frame.) */
  private stepDust(): void {
    const anims = this.sprite.anims;
    const frame = anims.currentFrame;
    const first = anims.currentAnim?.frames[0];
    if (!frame || !first) return;
    if (frame.index !== this.lastWalkFrame && frame === first) this.dust();
    this.lastWalkFrame = frame.index;
  }

  /** Keyboard walking: queue the next tile from the held direction (at a tile centre, so steps chain smoothly). */
  private takeNextStep(): boolean {
    const next = this.nextStep?.();
    if (!next) return false;
    this.standUp();
    this.stepFrom = this.tile;
    this.path.push(next);
    return true;
  }

  /** Switch to another (already built) look, keeping position, facing and animation. */
  setOutfit(o: Outfit): void {
    this.outfit = o;
    this.head = headTop(this.scene, o);
    const anim = this.anim;
    this.sprite.anims.stop();
    this.play(anim);
  }

  /**
   * Keyboard walking, a new direction mid-step: turn now instead of at the next tile's centre. From the nearer of
   * the tile being left and the one being walked to, `pick` gives the next tile (null: can't go that way), and the
   * walk goes straight there. Once per step, and only to a tile next to the one walked to (where the server has you),
   * so it's one step message like any other.
   */
  turnMidStep(pick: (from: Tile) => Tile | null): boolean {
    const next = this.path[0];
    if (this.path.length !== 1 || this.sittingAt || this.turned) return false;
    const done = Math.hypot(this.col - (this.stepFrom.col + 0.5), this.row - (this.stepFrom.row + 0.5));
    const near = (t: Tile) => Math.abs(t.col - next.col) <= 1 && Math.abs(t.row - next.row) <= 1;
    let base = done < 0.5 ? this.stepFrom : next;
    let to = pick(base);
    if (base !== next && (!to || !near(to))) to = pick((base = next));
    if (!to || (to.col === next.col && to.row === next.row)) return false;
    this.stepFrom = base;
    this.path = [to];
    this.turned = true;
    return true;
  }

  /** Drops the rest of a click path, keeping only the step in progress (a movement key takes over). */
  cancelPath(): void {
    this.path = this.path.slice(0, 1);
  }

  /** Turn on the spot (a movement key pressed against a wall). */
  face(dir: Dir): void {
    if (this.path.length || this.sittingAt || this.dir === dir) return;
    this.dir = dir;
    this.play('idle');
  }

  private arrive(): void {
    this.lastWalkFrame = -1;
    this.play('idle');
    this.onArrive?.(this.tile);
  }

  /** The animation key for an animation facing a direction (the doll's, or the flat sheets'). */
  private keyFor(anim: string, dir: Dir): string {
    if (this.battle) return this.battle.key(anim, dir);
    return this.flat ? this.flat.key(anim, dir) : sheetKey(this.outfit, anim, dir);
  }

  private play(anim: string): void {
    if (this.striking) return; // an attack pose plays out first
    const C = this.M.characters;
    const dirs = this.battle?.directions ?? this.flat?.directions ?? C.animations[anim]?.directions ?? C.directions;
    const dir = dirs.includes(this.dir) ? this.dir : dirs[0];
    const key = this.keyFor(anim, dir);
    this.anim = anim;
    if (this.sprite.anims.currentAnim?.key === key && this.sprite.anims.isPlaying) return;
    // Keep the walk cycle's phase when only the direction changes (keys are "doll:<outfit>:<anim>:<dir>", or
    // "npc:<id>:<anim>:<dir>").
    const current = this.sprite.anims.currentAnim?.key.split(':')[2];
    const progress = current === anim && anim === 'walk' ? this.sprite.anims.getProgress() : 0;
    this.sprite.play(key);
    if (progress) this.sprite.anims.setProgress(progress);
  }

  // ── Battle (maps with mobs): the class's combat poses instead of the doll ──

  private battle: BattleSheets | null = null;
  private striking = false;

  get inBattle(): boolean {
    return !!this.battle;
  }

  /** Battle poses from now on (null: the doll again). The resting weapon is part of them, so it's hidden meanwhile. */
  setBattle(b: BattleSheets | null): void {
    if (b === this.battle) return;
    this.battle = b;
    this.striking = false;
    const C = this.M.characters;
    const [ax, ay] = b?.anchor ?? C.anchor;
    const [w, h] = b?.cell ?? C.cell;
    this.sprite.setOrigin(ax / w, ay / h);
    this.sprite.anims.stop();
    this.play(this.anim);
    this.sync();
  }

  /** An attack pose, once, facing `dir` (battle only); then standing or walking again. */
  strike(pose: string, dir: Dir): void {
    if (!this.battle || this.sittingAt) return;
    this.dir = dir;
    this.striking = false;
    const key = this.battle.key(pose, dir);
    if (!this.scene.anims.exists(key)) return;
    this.striking = true;
    this.sprite.play(key);
    this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.striking = false;
      this.play(this.path.length ? 'walk' : 'idle');
    });
  }

  /** HP now and at most: a thin red bar over the name while it's under the most (gone when full or knocked out). */
  setHp(hp: number, max: number): void {
    if (hp >= max || max <= 0 || this.knockedOut) {
      this.hpBar?.destroy();
      this.hpBar = null;
      return this.sync();
    }
    this.hpBar ??= this.scene.add.graphics();
    const w = HP_BAR_W;
    this.hpBar.clear().fillStyle(0x0b0a1a, 0.85).fillRect(-w / 2 - 1, -1, w + 2, 4).fillStyle(0xdc2626, 1).fillRect(-w / 2, 0, Math.max(1, Math.round((w * hp) / max)), 2);
    this.hpBar.setAlpha(this.seen);
    this.sync();
  }

  /** A number rising over the head: damage taken (red for you, `mine`; pale for others) or "Miss". */
  hitNumber(text: string, mine: boolean, colour?: string): void {
    const word = !/^\d+$/.test(text) && !colour;
    const zoom = Math.max(1, this.zoom);
    const t = this.scene.add
      .text(Math.round(this.sprite.x), Math.round(this.headY - 6), text, {
        fontFamily: '"Mk Numbers", "Pixelify Sans", monospace',
        fontSize: `${word ? 10 : mine ? 13 : 11}px`,
        color: colour ?? (word ? '#CBD5E1' : mine ? '#F87171' : '#FECACA'),
        stroke: '#1E1B3A',
        strokeThickness: 3,
        resolution: Math.max(2, zoom * 2),
      })
      .setOrigin(0.5, 1)
      .setDepth(LABEL_DEPTH);
    this.scene.tweens.add({ targets: t, y: t.y - 14, alpha: { from: 1, to: 0 }, duration: 800, ease: 'Quad.easeOut', onComplete: () => t.destroy() });
  }

  /** Knocked out (0 HP): fades out where they stand, name and all (no death pose: players are never "dead"); `false`:
   *  fades back in (respawned, placed first). */
  setKnockedOut(on: boolean): void {
    if (this.knockedOut === on) return;
    this.knockedOut = on;
    if (on) {
      this.cancelPath();
      this.hpBar?.destroy();
      this.hpBar = null;
    }
    this.seenTween?.stop();
    this.seenTween = this.scene.tweens.addCounter({
      from: this.seen,
      to: on ? 0 : 1,
      duration: on ? KO_FADE_MS : KO_FADE_MS / 2,
      onUpdate: (tw) => this.setSeen(tw.getValue() ?? (on ? 0 : 1)),
    });
  }

  private setSeen(seen: number): void {
    this.seen = seen;
    this.sprite.setAlpha(seen);
    this.shadow?.setAlpha(seen);
    this.bars?.setAlpha(seen);
    this.tag?.setAlpha(seen);
    this.hpBar?.setAlpha(seen);
  }

  /** Hit: a red flash (then the world's tint again, via onSpawn). */
  hurt(): void {
    this.sprite.setTint(0xff6b6b);
    this.scene.time.delayedCall(160, () => {
      this.sprite.clearTint();
      this.onSpawn?.(this.sprite);
    });
  }

  /** Screen position and depth from the tile-space position. */
  private sync(): void {
    const ground = this.elevation?.(this.col, this.row) ?? 0;
    const x = (this.col - this.row) * 16 + this.nudge.x;
    const y = (this.col + this.row) * 8 - ground + this.nudge.y;
    const t = this.tile;
    this.sprite.setPosition(Math.round(x), Math.round(y - this.lift));
    // Higher ground sorts a hair in front (over the wall below it).
    const feet = (this.col + this.row + 1) * 8 + CHARACTER_BIAS + ground * HEIGHT_DEPTH;
    const depth = this.sittingAt?.depth ?? (this.depthFn ? this.depthFn(t.col, t.row, feet, this.sprite.getBounds(this.boundsCache)) : feet);
    this.sprite.setDepth(depth);
    this.shadow?.setPosition(Math.round(x), Math.round(y)).setDepth(depth - 0.2);
    this.bars?.setPosition(Math.round(x), Math.round(y)).setDepth(depth + 0.05);
    if (this.rest && !this.battle) this.syncRest(Math.round(x), Math.round(y - this.lift), depth);
    else if (this.rest) for (const sp of [...this.rest.back, ...this.rest.front]) sp.setVisible(false);
    if (this.aura?.on) this.syncAura(depth);
    // The name sits just over the head (2 px above its first visible row); an alert goes above it.
    const plateBottom = Math.round(y) - this.M.characters.anchor[1] + this.head - 2;
    this.tag?.place(Math.round(x), plateBottom);
    let alertY = this.tag ? plateBottom - this.tag.height - 1 : Math.round(y) - this.M.characters.cell[1] - 2;
    if (this.hpBar) {
      this.hpBar.setPosition(Math.round(x), alertY - 3).setDepth(LABEL_DEPTH - 1);
      alertY -= 5;
    }
    if (this.marker) {
      this.marker.place(Math.round(x), alertY);
      alertY -= this.marker.height;
    }
    this.bubble?.place(Math.round(x), alertY);
    this.pop?.place(Math.round(x), alertY - (this.bubble ? this.bubble.height + 1 : 0));
    this.levelPop?.place(Math.round(x), alertY - (this.bubble ? this.bubble.height + 1 : 0) - (this.pop ? this.pop.height + 1 : 0));
    this.alert?.setPosition(Math.round(x), alertY).setDepth(depth + 0.1);
    this.overhead?.setPosition(Math.round(x), alertY - (this.bubble ? this.bubble.height + 1 : 0));
  }

  /** The resting weapon's sprites on this frame of the body (idle and walk only; hidden otherwise, e.g. sitting). */
  private syncRest(x: number, y: number, depth: number): void {
    const r = this.rest!;
    const anim = this.anim === 'walk' || this.anim === 'idle' ? this.anim : null;
    const layers = anim && !this.sprite.angle ? restLayers(r.art, anim, this.dir) : null;
    const own = r.art.rest.own;
    const frame = own ? Math.floor((this.scene.time.now / 1000) * own.fps) % own.frames : Number(this.sprite.frame.name) || 0;
    const C = this.M.characters;
    const place = (sp: Phaser.GameObjects.Sprite, l: ClassLayer | undefined, d: number) => {
      if (!l || !this.scene.textures.exists(l.file)) return void sp.setVisible(false);
      slice(this.scene.textures, l.file, l.size[0], l.size[1]);
      // A 64x64 weapon cell holds the doll's cell at `offset`; a body-sized one lines up with it.
      const at = l.size[0] === C.cell[0] && l.size[1] === C.cell[1] ? [0, 0] : r.offset;
      sp.setTexture(l.file, frame).setOrigin((at[0] + C.anchor[0]) / l.size[0], (at[1] + C.anchor[1]) / l.size[1]);
      sp.setPosition(x, y).setDepth(d).setVisible(this.sprite.visible).setAlpha(this.sprite.alpha);
    };
    r.back.forEach((sp, i) => place(sp, layers?.back[i], depth - 0.01));
    r.front.forEach((sp, i) => place(sp, layers?.front[i], depth + 0.01));
  }

  /** The aura on this frame's weapon: the battle pose's weapon layers (in hand), or the resting weapon's (town idle and
   *  walk); hidden otherwise. Each frame's outline is traced once (fx/weaponAura.ts caches it). */
  private syncAura(depth: number): void {
    const aura = this.aura!;
    const trace = this.battle ? this.battleTrace() : this.restTrace();
    if (!trace || !this.sprite.visible) return aura.hide();
    aura.place(trace.trace, trace.x, trace.y, depth - 0.03, depth + 0.03, this.sprite.alpha);
  }

  /** A weapon layer's frame `f` (a strip of `size` cells) drawn at (x, y). */
  private drawLayer(ctx: CanvasRenderingContext2D, l: ClassLayer, f: number, x: number, y: number): void {
    if (!this.scene.textures.exists(l.file)) return;
    const img = this.scene.textures.get(l.file).getSourceImage() as CanvasImageSource;
    ctx.drawImage(img, f * l.size[0], 0, l.size[0], l.size[1], x, y, l.size[0], l.size[1]);
  }

  /** The sprite's current frame drawn at (x, y). */
  private drawShown(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const fr = this.sprite.frame;
    ctx.drawImage(fr.source.image as CanvasImageSource, fr.cutX, fr.cutY, fr.cutWidth, fr.cutHeight, x, y, fr.cutWidth, fr.cutHeight);
  }

  /** In battle: the pose's weapon layers on this frame (standing = walk-ready's first), against the frame as shown. */
  private battleTrace(): { trace: AuraTrace; x: number; y: number } | null {
    const b = this.battle!;
    const art = this.M.classes?.list[b.cls] as ClassArt | undefined;
    const key = this.sprite.anims.currentAnim?.key;
    if (!art || !key) return null;
    const parts = key.split(':');
    const dir = parts[parts.length - 1] as Dir;
    let anim = parts[parts.length - 2];
    let f = Number(this.sprite.frame.name) || 0;
    if (anim === 'idle') [anim, f] = ['walk-ready', 0];
    const d = art.anims[anim]?.dirs[dir];
    if (!d) return null;
    const K = this.M.classes!;
    const at = (l: ClassLayer) => (l.size[0] === 64 ? [0, 0] : K.bodyOffset);
    const trace = traceAura(`pose:${this.sprite.texture.key}:${anim}:${dir}:${f}`, {
      w: 64,
      h: 64,
      back: (ctx) => d.back.forEach((l) => this.drawLayer(ctx, l, f, at(l)[0], at(l)[1])),
      front: (ctx) => d.front.forEach((l) => this.drawLayer(ctx, l, f, at(l)[0], at(l)[1])),
      cover: { mode: 'composite', draw: (ctx) => this.drawShown(ctx, 0, 0) },
    });
    return { trace, x: this.sprite.x - b.anchor[0], y: this.sprite.y - b.anchor[1] };
  }

  /** In town: the resting weapon's layers on this frame of idle or walk, behind and in front of the doll. */
  private restTrace(): { trace: AuraTrace; x: number; y: number } | null {
    const r = this.rest;
    const anim = this.anim === 'walk' || this.anim === 'idle' ? this.anim : null;
    if (!r || !anim || this.sprite.angle || this.sittingAt || this.flat) return null;
    const layers = restLayers(r.art, anim, this.dir);
    if (!layers) return null;
    const own = r.art.rest.own;
    const f = own ? Math.floor((this.scene.time.now / 1000) * own.fps) % own.frames : Number(this.sprite.frame.name) || 0;
    const C = this.M.characters;
    const at = (l: ClassLayer) => (l.size[0] === C.cell[0] && l.size[1] === C.cell[1] ? r.offset : l.size[0] === 64 ? [0, 0] : r.offset);
    const files = (ls: ClassLayer[]) => ls.map((l) => l.file).join(',');
    const trace = traceAura(`rest:${files(layers.back)}|${files(layers.front)}:${f}:${this.sprite.texture.key}:${this.sprite.frame.name}`, {
      w: 64,
      h: 64,
      back: (ctx) => layers.back.forEach((l) => this.drawLayer(ctx, l, f, at(l)[0], at(l)[1])),
      front: (ctx) => layers.front.forEach((l) => this.drawLayer(ctx, l, f, at(l)[0], at(l)[1])),
      cover: {
        mode: 'alpha',
        draw: (ctx) => {
          this.drawShown(ctx, r.offset[0], r.offset[1]);
          layers.front.forEach((l) => this.drawLayer(ctx, l, f, at(l)[0], at(l)[1]));
        },
      },
    });
    return { trace, x: this.sprite.x - (r.offset[0] + C.anchor[0]), y: this.sprite.y - (r.offset[1] + C.anchor[1]) };
  }

  /** A puff of dust at the feet (each step's; a fall's). */
  dust(): void {
    const fx = this.M.fx['footstep-dust'];
    if (!fx?.file) return;
    const key = `anim:${fx.file}`;
    if (!this.scene.anims.exists(key)) {
      this.scene.anims.create({ key, frames: this.scene.anims.generateFrameNumbers(fx.file, { start: 0, end: (fx.frames ?? 1) - 1 }), frameRate: fx.fps ?? 12, repeat: 0 });
    }
    const puff = this.scene.add.sprite(this.sprite.x, this.sprite.y, fx.file).setOrigin(0.5, 1).setDepth(this.sprite.depth - 0.1);
    puff.play(key);
    puff.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => puff.destroy());
    this.onSpawn?.(puff);
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow?.destroy();
    this.alert?.destroy();
    this.bars?.destroy();
    this.overhead?.destroy();
    this.hpBar?.destroy();
    this.seenTween?.stop();
    this.tag?.destroy();
    this.bubbleTimer?.remove();
    this.bubble?.destroy();
    this.pop?.destroy();
    this.levelPop?.destroy();
    this.marker?.destroy();
    for (const sp of [...(this.rest?.back ?? []), ...(this.rest?.front ?? [])]) sp.destroy();
    this.aura?.destroy();
  }

  /** The world y of the top of the head (its first visible row), for things shown over it. */
  get headY(): number {
    return this.sprite.y - this.M.characters.anchor[1] + this.head;
  }

  /** Lets the scene tint effects spawned later (night). */
  onSpawn: ((obj: Phaser.GameObjects.Sprite) => void) | null = null;

  /** Sprites to tint with the world. */
  get tintables(): Phaser.GameObjects.Components.Tint[] {
    return [this.sprite, ...(this.shadow ? [this.shadow] : []), ...(this.bars ? [this.bars] : []), ...(this.rest ? [...this.rest.back, ...this.rest.front] : [])];
  }
}
