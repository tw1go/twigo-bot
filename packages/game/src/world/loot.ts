import Phaser from 'phaser';
import { type ItemData, type TownLoot, isGearDef, itemAura, itemName, rarityColour } from '@mikazuki/shared';
import { type AuraTrace, WeaponAura, traceAura } from '../fx/weaponAura';
import { loadImages } from '../characters/kit-art';
import { CHARACTER_BIAS, HEIGHT_DEPTH, LABEL_DEPTH } from './depth';
import { type WorldObjects, characterDepth } from './objects';

// 🪙 Loot on the ground in the Slums (the server's: bot web/town-loot.ts; the town's `loot`, `loot-drop` and `loot-gone`
// messages). Each drop is its own 16x16 icon (the item's inventory icon, Kusing's coin) on a small dark oval shadow,
// bobbing 1 px, slowly; Kusing has its amount over it in Jersey 10. Hovering one (or holding Alt) shows its name in its
// rarity's colour; a +18 or +20 weapon glows on the ground too (fx/weaponAura.ts). Someone else's loot (the first 10 s of their kill) is drawn at half strength until it opens to you;
// the golem's loot only ever reaches its owner. An icon not drawn yet: its slot's silhouette (gear) or a square in its
// rarity's colour. Clicking one walks you onto it (the server picks it up as you arrive).

const BOB_MS = 1800;
const FAINT = 0.5;

interface Drop {
  loot: TownLoot;
  icon: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
  amount: Phaser.GameObjects.Text | null;
  name: Phaser.GameObjects.Text;
  /** Faint until then (performance.now ms; Infinity: someone else's for good). */
  opensAt: number;
  phase: number;
  /** A +18 or +20 weapon's aura round its icon. */
  aura: { fx: WeaponAura; trace: AuraTrace } | null;
  x: number;
  y: number;
  hovered: boolean;
}

export interface LootArt {
  /** Kusing's 16x16 coin (manifest ui.kusingIcon). */
  kusing: string | null;
  /** The empty-slot silhouettes (16x16 frames, in `frames` order), for gear without an icon yet. */
  silhouettes: { file: string; frames: string[] } | null;
}

export class LootLayer {
  private readonly all = new Map<string, Drop>();
  private alt = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly objects: WorldObjects,
    private readonly data: () => ItemData | null,
    private readonly art: LootArt,
  ) {
    const kb = scene.input.keyboard;
    const alt = (on: boolean) => (e: KeyboardEvent) => {
      if (e.key !== 'Alt' || this.alt === on) return;
      this.alt = on;
      for (const d of this.all.values()) this.syncName(d);
    };
    kb?.on('keydown', alt(true));
    kb?.on('keyup', alt(false));
    window.addEventListener('blur', () => alt(false)({ key: 'Alt' } as KeyboardEvent));
  }

  /** Everything on the ground you can see (on arrival). */
  set(list: TownLoot[]): void {
    for (const id of [...this.all.keys()]) this.drop(id);
    this.add(list);
  }

  /** New loot (a kill). */
  add(list: TownLoot[]): void {
    const files = [this.art.kusing, ...list.map((l) => this.iconFile(l)), this.art.silhouettes?.file].filter((f): f is string => !!f);
    void loadImages(this.scene, files).then(() => {
      for (const l of list) if (!this.all.has(l.id)) this.make(l);
    });
  }

  /** Gone (picked up, or lain too long). */
  remove(ids: string[]): void {
    for (const id of ids) this.drop(id);
  }

  /** The loot under the pointer, if any. */
  pick(over: Phaser.GameObjects.GameObject[]): TownLoot | null {
    for (const d of this.all.values()) if (over.includes(d.icon)) return d.loot;
    return null;
  }

  get size(): number {
    return this.all.size;
  }

  /** Debug: each drop as it's shown (world position, faint or not). */
  list(): { id: string; col: number; row: number; kusing?: number; item?: string; mine: boolean; x: number; y: number; alpha: number }[] {
    return [...this.all.values()].map((d) => ({ id: d.loot.id, col: d.loot.col, row: d.loot.row, kusing: d.loot.kusing, item: d.loot.item?.defId, mine: d.loot.mine, x: d.icon.x, y: d.icon.y, alpha: d.icon.alpha }));
  }

  /** The bob, and loot opening to you. */
  update(now = performance.now()): void {
    for (const d of this.all.values()) {
      const bob = Math.round(Math.sin(((now + d.phase) / BOB_MS) * Math.PI * 2) * 0.5 - 0.5); // 0 or −1
      d.icon.setY(d.y - 6 + bob);
      d.amount?.setY(d.y - 14 + bob);
      d.aura?.fx.place(d.aura.trace, d.icon.x - 8, d.icon.y - 8, d.icon.depth - 0.005, d.icon.depth + 0.005, d.icon.alpha);
      if (!d.loot.mine && now >= d.opensAt) {
        d.loot = { ...d.loot, mine: true };
        this.fade(d);
      }
    }
  }

  private iconFile(l: TownLoot): string | null {
    if (l.kusing !== undefined) return this.art.kusing;
    const def = l.item ? this.data()?.defs.get(l.item.defId) : undefined;
    return def?.icon ?? null;
  }

  /** A placeholder: a square in the rarity's colour (made once per colour). */
  private placeholder(colour: string): string {
    const key = `loot-ph:${colour}`;
    if (!this.scene.textures.exists(key)) {
      const c = this.scene.textures.createCanvas(key, 16, 16)!;
      const ctx = c.getContext();
      ctx.fillStyle = '#1E1B3A';
      ctx.fillRect(2, 2, 12, 12);
      ctx.fillStyle = colour;
      ctx.fillRect(3, 3, 10, 10);
      c.refresh();
    }
    return key;
  }

  private make(l: TownLoot): void {
    const D = this.data();
    const ground = this.objects.heights.lift(l.col + 0.5, l.row + 0.5);
    const x = (l.col - l.row) * 16;
    const y = (l.col + l.row + 1) * 8 - ground;
    const def = l.item ? D?.defs.get(l.item.defId) : undefined;
    const colour = l.item && D ? rarityColour(D.stats, l.item.rarity) : '#FCDA4A';
    let key = this.iconFile(l);
    let frame: number | undefined;
    if (!key || !this.scene.textures.exists(key)) {
      const sil = this.art.silhouettes;
      if (isGearDef(def) && sil && this.scene.textures.exists(sil.file)) {
        key = sil.file;
        frame = Math.max(0, sil.frames.indexOf(def.slot));
        if (!this.scene.textures.get(key).has(String(frame))) this.scene.textures.get(key).add(String(frame), 0, frame * 16, 0, 16, 16);
      } else key = this.placeholder(colour);
    }
    const feet = (l.col + l.row + 1) * 8 + CHARACTER_BIAS + ground * HEIGHT_DEPTH - 0.4; // on the ground: under whoever stands there
    const shadow = this.scene.add.ellipse(x, y, 12, 4, 0x0b0a1a, 0.45);
    const icon = this.scene.add.image(x, y - 6, key, frame === undefined ? undefined : String(frame)).setOrigin(0.5, 0.5);
    const depth = characterDepth(this.objects, l.col, l.row, feet, icon.getBounds());
    shadow.setDepth(depth - 0.01);
    icon.setDepth(depth);
    icon.setInteractive({ cursor: 'pointer' });
    let amount: Phaser.GameObjects.Text | null = null;
    if (l.kusing !== undefined) {
      amount = this.scene.add
        .text(x, y - 14, l.kusing.toLocaleString(), { fontFamily: '"Mk Numbers", "Pixelify Sans", monospace', fontSize: '10px', color: '#FCDA4A', stroke: '#1E1B3A', strokeThickness: 3, resolution: 4 })
        .setOrigin(0.5, 1)
        .setDepth(depth + 0.01);
    }
    const label = l.kusing !== undefined ? `${l.kusing.toLocaleString()} Kusing` : l.item && D ? itemName(D, l.item) : 'Loot';
    const name = this.scene.add
      .text(x, y - 18, label, { fontFamily: '"Mk Numbers", "Pixelify Sans", monospace', fontSize: '9px', color: colour, stroke: '#1E1B3A', strokeThickness: 3, resolution: 4 })
      .setOrigin(0.5, 1)
      .setDepth(LABEL_DEPTH)
      .setVisible(false);
    const d: Drop = { loot: l, icon, shadow, amount, name, opensAt: l.mine ? 0 : l.opensIn === undefined ? Infinity : performance.now() + l.opensIn, phase: Math.random() * BOB_MS, aura: null, x, y, hovered: false };
    // +18 and +20 weapons glow on the ground (the guide; +15–17 only once picked up).
    const tier = l.item && D ? itemAura(D, l.item) : null;
    if (tier && tier.aura !== 'blue' && icon.width === 16) {
      const fr = icon.frame;
      const trace = traceAura(`loot:${key}:${fr.name}`, { w: 16, h: 16, front: (ctx) => ctx.drawImage(fr.source.image as CanvasImageSource, fr.cutX, fr.cutY, fr.cutWidth, fr.cutHeight, 0, 0, 16, 16) });
      const fx = new WeaponAura(this.scene, [16, 16]);
      fx.set(tier);
      d.aura = { fx, trace };
    }
    icon.on('pointerover', () => ((d.hovered = true), this.syncName(d)));
    icon.on('pointerout', () => ((d.hovered = false), this.syncName(d)));
    this.all.set(l.id, d);
    this.fade(d);
    this.syncName(d);
  }

  private fade(d: Drop): void {
    const a = d.loot.mine ? 1 : FAINT;
    for (const o of [d.icon, d.amount]) o?.setAlpha(a);
    d.shadow.setAlpha(a);
    d.name.setAlpha(a);
  }

  private syncName(d: Drop): void {
    const on = d.hovered || this.alt;
    d.name.setVisible(on).setY(d.y - (d.amount ? 24 : 16));
  }

  private drop(id: string): void {
    const d = this.all.get(id);
    if (!d) return;
    for (const o of [d.icon, d.shadow, d.amount, d.name]) o?.destroy();
    d.aura?.fx.destroy();
    this.all.delete(id);
  }

  destroy(): void {
    for (const id of [...this.all.keys()]) this.drop(id);
  }
}
