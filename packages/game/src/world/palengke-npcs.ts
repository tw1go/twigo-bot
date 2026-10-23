import Phaser from 'phaser';
import type { Tile } from './grid';
import { CHARACTER_BIAS, HEIGHT_DEPTH } from './depth';
import { type WorldObjects, characterDepth } from './objects';
import { NameTag, QuestMarker } from '../ui/labels';
import { closeNpcDialog, openNpcDialog, talkingTo } from '../ui/npc-dialog';
import type { Manifest } from '../assets/types';
import { Character, dirForStep } from '../characters/character';
import type { Outfit } from '../characters/doll';
import { flatNpcSheets } from './npc-life';

// 🏮 The Lumang Palengke's quest NPCs (maps/palengke.json `npcs`: Aling Conching, Mang Pido, Tisay, Kuya Jun): each a
// Character on its own flat sheets (the art folder's npcs/palengke, manifest npcs.palengkeIds, loaded with the Palengke:
// assets/queue.ts queueNpcs 'palengke'), idling at its tile and turning to the nearest player, its name over it, clicked
// like a town NPC (the scene walks you over and asks `talk`), the quest "!" over the name, its portrait in the dialog box
// and its own lines (npcs/palengke-npc-dialogue.json) when there's no quest to talk about. One without its sheets: a plain
// stand-in (a little figure in their colour, drawn here). They never walk. An NPC with `moves` stands at the tile of the
// last one whose quest (`after`, "q7" = palengke-07) is done.

export interface PalengkeNpc {
  id: string;
  name: string;
  tile: [number, number];
  role?: string;
  moves?: { after: string; tile: [number, number] }[];
}

/** What the dialog box says under each one's name (the map's `role` is a note for us). */
const TITLES: Record<string, string> = { 'aling-conching': 'Eatery cook', 'mang-pido': 'Market guard', tisay: "Dry Goods", 'kuya-jun': 'Butcher' };
/** Each stand-in's colour (their clothes); grey for one not listed. */
const COLOURS: Record<string, string> = { 'aling-conching': '#C2410C', 'mang-pido': '#6B7F3A', tisay: '#DB2777', 'kuya-jun': '#2563EB' };
const SKIN = '#E8B98A';
const INK = '#1E1B3A';
/** The figure's size (art px), drawn at SCALE: about a character's height. */
const W = 12;
const H = 22;
const SCALE = 2;

/** The stand-in figure, drawn at `k` art px a pixel with its top-left at (x, y): a head over a body in their colour. */
function figure(ctx: CanvasRenderingContext2D, colour: string, x: number, y: number, k: number): void {
  const px = (c: string, cx: number, cy: number, w: number, h: number) => {
    ctx.fillStyle = c;
    ctx.fillRect(x + cx * k, y + cy * k, w * k, h * k);
  };
  // Outline first, then the fill one pixel in.
  px(INK, 3, 0, 6, 8);
  px(INK, 1, 7, 10, 15);
  px(SKIN, 4, 1, 4, 6);
  px(INK, 5, 3, 1, 1);
  px(INK, 7, 3, 1, 1);
  px(colour, 2, 8, 8, 13);
  px(SKIN, 2, 12, 1, 4);
  px(SKIN, 9, 12, 1, 4);
}

interface Standee {
  def: PalengkeNpc;
  tile: Tile;
  portrait: string;
  /** Their own sprite (the art folder's sheets: a Character on flat sheets), or null: the stand-in. */
  char: Character | null;
  /** What a click hits: the Character's sprite, or the stand-in's image. */
  sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;
  /** The stand-in's shadow and tags (a Character has its own). */
  shadow: Phaser.GameObjects.Ellipse | null;
  tag: NameTag | null;
  marker: QuestMarker | null;
  /** The dialog box's line under the name, and their own lines (palengke-npc-dialogue.json), the last said. */
  title: string;
  lines: string[];
  last: number;
}

/** The dialogue file's entry for one of them. */
interface NpcText {
  name: string;
  title: string;
  lines: string[];
}

/** How near (tiles) a player must be for an idle NPC to turn to them. */
const FACE_TILES = 5;

export class PalengkeNpcs {
  private readonly list: Standee[] = [];
  private zoom = 1;
  /** A quest's lines for an NPC (the scene's questScript), or null for their own. */
  script: ((id: string) => { lines: string[]; onDone?: () => void } | null) | null = null;
  /** A button on someone's dialog box (Aling Conching's menu), or none. */
  action: ((id: string) => { label: string; run: () => void } | undefined) | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    M: Manifest,
    private readonly objects: WorldObjects,
    npcs: PalengkeNpc[],
    /** The quests done (an NPC who `moves` after one). */
    done: () => string[],
    /** Each new sprite (the scene's night tint). */
    onSpawn: (obj: Phaser.GameObjects.Sprite) => void = () => {},
  ) {
    const texts = (scene.cache.json.get('palengke-npc-dialogue') as { npcs?: Record<string, NpcText> } | undefined)?.npcs ?? {};
    const N = M.npcs;
    for (const def of npcs) {
      const moved = [...(def.moves ?? [])].reverse().find((m) => done().includes(m.after.replace(/^q(\d+)$/, (_, n: string) => `palengke-${n.padStart(2, '0')}`)));
      const [col, row] = moved?.tile ?? def.tile;
      const text = texts[def.id];
      const title = text?.title ?? TITLES[def.id] ?? '';
      const base = { def, tile: { col, row }, title, lines: text?.lines ?? [], last: -1, marker: null };
      // Their own sheets (manifest npcs.palengkeIds): drawn as the town's NPCs are.
      const sheets = N?.palengkeIds?.includes(def.id) ? flatNpcSheets(scene, N, def.id) : null;
      if (N && sheets) {
        const char = new Character(scene, M, {} as Outfit, { col, row }, sheets);
        char.depthFn = (c, r, d, b) => characterDepth(objects, c, r, d, b);
        char.onSpawn = onSpawn;
        for (const t of char.tintables) onSpawn(t as Phaser.GameObjects.Sprite);
        char.place({ col, row }, 's');
        char.setNameTag(def.name, { name: title, color: '#FFFFFF' }, { nameOnly: true });
        char.sprite.setInteractive({ pixelPerfect: true, cursor: 'pointer' });
        const portrait = `${import.meta.env.BASE_URL}assets/${N.portrait.file.replace('{id}', def.id)}`;
        this.list.push({ ...base, char, sprite: char.sprite, shadow: null, tag: null, portrait });
        continue;
      }
      // Else the stand-in: a little figure in their colour.
      const colour = COLOURS[def.id] ?? '#6B7280';
      const key = `palengke-npc:${def.id}`;
      if (!scene.textures.exists(key)) {
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        figure(c.getContext('2d')!, colour, 0, 0, 1);
        scene.textures.addCanvas(key, c);
      }
      const shadow = scene.add.ellipse(0, 0, 16, 6, 0x0b0a18, 0.45);
      const sprite = scene.add.image(0, 0, key).setOrigin(0.5, 1).setScale(SCALE);
      sprite.setInteractive({ cursor: 'pointer' });
      const tag = new NameTag(scene, def.name, { name: '', color: '#FFFFFF' }, { nameOnly: true });
      const s: Standee = { ...base, char: null, sprite, shadow, tag, portrait: portraitOf(colour) };
      this.place(s);
      this.list.push(s);
    }
  }

  /** A stand-in on the tile's ground point, sorted among characters; the name (and any marker) over the head. */
  private place(s: Standee): void {
    const { col, row } = s.tile;
    const ground = this.objects.heights.lift(col + 0.5, row + 0.5);
    const x = Math.round((col - row) * 16);
    const y = Math.round((col + row + 1) * 8 - ground);
    s.sprite.setPosition(x, y);
    s.shadow?.setPosition(x, y).setDepth(0);
    const feet = (col + row + 1) * 8 + CHARACTER_BIAS + ground * HEIGHT_DEPTH;
    s.sprite.setDepth(characterDepth(this.objects, col, row, feet, s.sprite.getBounds()));
    s.shadow?.setDepth(s.sprite.depth - 0.2);
    this.label(s);
  }

  private label(s: Standee): void {
    const top = s.sprite.y - H * SCALE - 2;
    s.tag?.place(s.sprite.x, top);
    s.marker?.place(s.sprite.x, top - (s.tag?.height ?? 0) - 1);
  }

  /** Each frame: their animations, and each idle one turned to the nearest player within FACE_TILES (never mid-talk). */
  update(deltaMs = 0, players: Tile[] = []): void {
    const talking = talkingTo();
    for (const s of this.list) {
      if (!s.char) continue;
      s.char.update(deltaMs);
      if (talking === s.def.id || !s.char.isIdle) continue;
      let near: Tile | null = null;
      let best = FACE_TILES + 1;
      for (const p of players) {
        const d = Math.max(Math.abs(p.col - s.tile.col), Math.abs(p.row - s.tile.row));
        if (d > 0 && d < best) [near, best] = [p, d];
      }
      if (near) s.char.face(dirForStep(near.col - s.tile.col, near.row - s.tile.row));
    }
  }

  pick(over: Phaser.GameObjects.GameObject[]): string | null {
    return this.list.find((s) => over.includes(s.sprite))?.def.id ?? null;
  }

  tileOf(id: string): Tile | null {
    return this.list.find((s) => s.def.id === id)?.tile ?? null;
  }

  setMarker(id: string, mark: { symbol: string; color: string } | null): void {
    const s = this.list.find((x) => x.def.id === id);
    if (!s) return;
    if (s.char) return s.char.setQuestMarker(mark);
    s.marker?.destroy();
    s.marker = mark ? new QuestMarker(this.scene, mark.symbol, mark.color) : null;
    s.marker?.setZoom(this.zoom);
    this.label(s);
  }

  /** Talk to them (you're close enough: the scene checks): a quest's lines (`script`), `say`, or one of their own lines
   *  (never the same twice running). */
  talk(id: string, _me: Tile, say?: { lines: string[]; after?: () => void }): void {
    const s = this.list.find((x) => x.def.id === id);
    if (!s) return;
    const script = say ? null : (this.script?.(id) ?? null);
    openNpcDialog({
      id,
      name: s.def.name,
      title: s.title,
      portrait: s.portrait,
      lines: say?.lines ?? script?.lines,
      action: this.action?.(id),
      onDone: script?.onDone,
      next: () => this.ownLine(s),
      voice: 1,
      mirror: false,
      onClose: () => say?.after?.(),
    });
  }

  /** One of their own lines, at random, never the same twice running. */
  private ownLine(s: Standee): string {
    if (!s.lines.length) return 'Good day. Take care in the market.';
    let i = Math.floor(Math.random() * s.lines.length);
    if (s.lines.length > 1 && i === s.last) i = (i + 1) % s.lines.length;
    s.last = i;
    return s.lines[i];
  }

  get talkingTo(): string | null {
    const id = talkingTo();
    return id && this.list.some((s) => s.def.id === id) ? id : null;
  }

  setZoom(zoom: number): void {
    this.zoom = zoom;
    for (const s of this.list) {
      if (s.char) {
        s.char.setZoom(zoom);
        continue;
      }
      s.tag?.setZoom(zoom);
      s.marker?.setZoom(zoom);
      this.label(s);
    }
  }

  set cursor(css: string) {
    for (const s of this.list) if (s.sprite.input) s.sprite.input.cursor = css;
  }

  get tintables(): Phaser.GameObjects.Components.Tint[] {
    return this.list.flatMap((s) => (s.char ? s.char.tintables : [s.sprite]));
  }

  get positions(): Record<string, Tile> {
    return Object.fromEntries(this.list.map((s) => [s.def.id, s.tile]));
  }

  destroy(): void {
    closeNpcDialog();
    for (const s of this.list) {
      if (s.char) {
        s.char.destroy();
        continue;
      }
      s.sprite.destroy();
      s.shadow?.destroy();
      s.tag?.destroy();
      s.marker?.destroy();
    }
  }
}

/** The dialog box's portrait: two 32 × 32 frames (eyes open, blinking) of the figure's head and shoulders. */
function portraitOf(colour: string): string {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  for (const f of [0, 1]) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(f * 32, 0, 32, 32);
    ctx.clip();
    figure(ctx, colour, f * 32 + 4, 2, 2);
    if (f === 1) {
      ctx.fillStyle = SKIN;
      ctx.fillRect(f * 32 + 4 + 5 * 2, 2 + 3 * 2, 2, 2);
      ctx.fillRect(f * 32 + 4 + 7 * 2, 2 + 3 * 2, 2, 2);
    }
    ctx.restore();
  }
  return c.toDataURL();
}

/** One of them's face for a toast (Mang Pido on his radio): the portrait's first frame, 32 × 32 (`portrait`: its file,
 *  else the stand-in's). */
export function npcFace(id: string, portrait?: string): HTMLElement {
  if (portrait) {
    const d = document.createElement('div');
    d.className = 'npc-face';
    Object.assign(d.style, { width: '32px', height: '32px', backgroundImage: `url("${portrait}")`, backgroundSize: '64px 32px', backgroundPosition: '0 0', imageRendering: 'pixelated' });
    return d;
  }
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  c.className = 'npc-face';
  c.style.imageRendering = 'pixelated';
  figure(c.getContext('2d')!, COLOURS[id] ?? '#6B7280', 4, 2, 2);
  return c;
}
