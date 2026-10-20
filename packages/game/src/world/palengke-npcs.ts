import Phaser from 'phaser';
import type { Tile } from './grid';
import { CHARACTER_BIAS, HEIGHT_DEPTH } from './depth';
import { type WorldObjects, characterDepth } from './objects';
import { NameTag, QuestMarker } from '../ui/labels';
import { closeNpcDialog, openNpcDialog, talkingTo } from '../ui/npc-dialog';

// 🏮 The Lumang Palengke's quest NPCs (maps/palengke.json `npcs`: Aling Conching, Mang Pido, Tisay, Kuya Jun) until their
// sprites come: a plain stand-in at each one's tile (a little figure in their colour, drawn here, on a shadow) with their
// name over it, clicked like a town NPC (the scene walks you over and asks `talk`), the quest "!" over the name, and a
// portrait for the dialog box drawn the same way. They never move. An NPC with `moves` stands at the tile of the last
// one whose quest (`after`, "q7" = palengke-07) is done.

export interface PalengkeNpc {
  id: string;
  name: string;
  tile: [number, number];
  role?: string;
  moves?: { after: string; tile: [number, number] }[];
}

/** What the dialog box says under each one's name (the map's `role` is a note for us). */
const TITLES: Record<string, string> = { 'aling-conching': 'Karinderya cook', 'mang-pido': 'Palengke guard', tisay: "Tuyo't Tindahan", 'kuya-jun': 'Karnehan butcher' };
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
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
  tag: NameTag;
  marker: QuestMarker | null;
  tile: Tile;
  portrait: string;
}

export class PalengkeNpcs {
  private readonly list: Standee[] = [];
  private zoom = 1;
  /** A quest's lines for an NPC (the scene's questScript), or null for their own. */
  script: ((id: string) => { lines: string[]; onDone?: () => void } | null) | null = null;
  /** A button on someone's dialog box (Aling Conching's menu), or none. */
  action: ((id: string) => { label: string; run: () => void } | undefined) | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly objects: WorldObjects,
    npcs: PalengkeNpc[],
    /** The quests done (an NPC who `moves` after one). */
    done: () => string[],
  ) {
    for (const def of npcs) {
      const colour = COLOURS[def.id] ?? '#6B7280';
      const key = `palengke-npc:${def.id}`;
      if (!scene.textures.exists(key)) {
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        figure(c.getContext('2d')!, colour, 0, 0, 1);
        scene.textures.addCanvas(key, c);
      }
      const moved = [...(def.moves ?? [])].reverse().find((m) => done().includes(m.after.replace(/^q(\d+)$/, (_, n: string) => `palengke-${n.padStart(2, '0')}`)));
      const [col, row] = moved?.tile ?? def.tile;
      const shadow = scene.add.ellipse(0, 0, 16, 6, 0x0b0a18, 0.45);
      const sprite = scene.add.image(0, 0, key).setOrigin(0.5, 1).setScale(SCALE);
      sprite.setInteractive({ cursor: 'pointer' });
      const tag = new NameTag(scene, def.name, { name: '', color: '#FFFFFF' }, { nameOnly: true });
      const s: Standee = { def, sprite, shadow, tag, marker: null, tile: { col, row }, portrait: portraitOf(colour) };
      this.place(s);
      this.list.push(s);
    }
  }

  /** On the tile's ground point, sorted among characters; the name (and any marker) over the head. */
  private place(s: Standee): void {
    const { col, row } = s.tile;
    const ground = this.objects.heights.lift(col + 0.5, row + 0.5);
    const x = Math.round((col - row) * 16);
    const y = Math.round((col + row + 1) * 8 - ground);
    s.sprite.setPosition(x, y);
    s.shadow.setPosition(x, y).setDepth(0);
    const feet = (col + row + 1) * 8 + CHARACTER_BIAS + ground * HEIGHT_DEPTH;
    s.sprite.setDepth(characterDepth(this.objects, col, row, feet, s.sprite.getBounds()));
    s.shadow.setDepth(s.sprite.depth - 0.2);
    this.label(s);
  }

  private label(s: Standee): void {
    const top = s.sprite.y - H * SCALE - 2;
    s.tag.place(s.sprite.x, top);
    s.marker?.place(s.sprite.x, top - s.tag.height - 1);
  }

  update(): void {
    // (They never move: nothing to do each frame.)
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
    s.marker?.destroy();
    s.marker = mark ? new QuestMarker(this.scene, mark.symbol, mark.color) : null;
    s.marker?.setZoom(this.zoom);
    this.label(s);
  }

  /** Talk to them (you're close enough: the scene checks): a quest's lines (`script`), `say`, or their own word. */
  talk(id: string, _me: Tile, say?: { lines: string[]; after?: () => void }): void {
    const s = this.list.find((x) => x.def.id === id);
    if (!s) return;
    const script = say ? null : (this.script?.(id) ?? null);
    openNpcDialog({
      id,
      name: s.def.name,
      title: TITLES[id] ?? '',
      portrait: s.portrait,
      lines: say?.lines ?? script?.lines,
      action: this.action?.(id),
      onDone: script?.onDone,
      next: () => 'Magandang araw, anak. Ingat sa palengke.',
      voice: 1,
      mirror: false,
      onClose: () => say?.after?.(),
    });
  }

  get talkingTo(): string | null {
    const id = talkingTo();
    return id && this.list.some((s) => s.def.id === id) ? id : null;
  }

  setZoom(zoom: number): void {
    this.zoom = zoom;
    for (const s of this.list) {
      s.tag.setZoom(zoom);
      s.marker?.setZoom(zoom);
      this.label(s);
    }
  }

  set cursor(css: string) {
    for (const s of this.list) if (s.sprite.input) s.sprite.input.cursor = css;
  }

  get tintables(): Phaser.GameObjects.Components.Tint[] {
    return this.list.map((s) => s.sprite);
  }

  get positions(): Record<string, Tile> {
    return Object.fromEntries(this.list.map((s) => [s.def.id, s.tile]));
  }

  destroy(): void {
    closeNpcDialog();
    for (const s of this.list) {
      s.sprite.destroy();
      s.shadow.destroy();
      s.tag.destroy();
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
