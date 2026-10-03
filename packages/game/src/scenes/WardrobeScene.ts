import Phaser from 'phaser';
import { queueImage } from '../assets/queue';
import type { Dir, Manifest } from '../assets/types';
import { type Outfit, assetProblems, buildOutfit, dirsFor, hairDrawn, outfitFiles, sheetKey } from '../characters/doll';

// ?debug=wardrobe — every hairstyle with every hat (and none), to check hat clipping and the buns→crop fallback.
// Keys: 1–8 or ←/→ change direction · A cycles the animation · G toggles glasses.

const BASE: Outfit = {
  skin: 'tan',
  hair: 'fluffy',
  hairColour: 'brown',
  top: 'tshirt',
  topColour: 'blue',
  topTrim: 'cream',
  bottom: 'pants',
  bottomColour: 'stone',
  bottomTrim: 'cream',
  shoes: 'sneakers',
  shoesColour: 'gold',
  hatColour: 'violet',
  glassesColour: 'stone',
};

export class WardrobeScene extends Phaser.Scene {
  private M!: Manifest;
  private outfits: Outfit[] = [];
  private sprites: { sprite: Phaser.GameObjects.Sprite; outfit: Outfit }[] = [];
  private dirIndex = 0;
  private animList = ['idle', 'walk', 'rot', 'sit', 'wave', 'cheer'];
  private animIndex = 0;
  private glasses = false;
  private label!: Phaser.GameObjects.Text;

  constructor() {
    super('wardrobe');
  }

  init(data: { manifest: Manifest }): void {
    this.M = data.manifest;
    const W = this.M.characters.wardrobe;
    this.outfits = [];
    for (const hat of [undefined, ...W.hats]) for (const hair of W.hair) for (const glasses of [undefined, W.glasses[0]]) this.outfits.push({ ...BASE, hair, hat, glasses });
  }

  preload(): void {
    this.load.setPath(`${import.meta.env.BASE_URL}assets/`);
    const files = new Set<string>();
    for (const o of this.outfits) for (const f of outfitFiles(this.M.characters, o)) files.add(f);
    for (const f of files) queueImage(this.load, this.textures, f);
  }

  create(): void {
    const C = this.M.characters;
    for (const o of this.outfits) buildOutfit(this, C, o);
    const W = C.wardrobe;
    const hats = [undefined, ...W.hats];
    const zoom = 3;
    this.cameras.main.setZoom(zoom).setBackgroundColor('#2a2d3e');
    const cellW = 40;
    const cellH = 64;
    hats.forEach((hat, hi) => {
      this.add.text(4, 20 + hi * cellH + 4, hat ?? 'no hat', { fontFamily: 'monospace', fontSize: '8px', color: '#a9b1d6' }).setResolution(zoom);
      W.hair.forEach((hair, i) => {
        if (hi === 0) this.add.text(60 + i * cellW, 4, hair, { fontFamily: 'monospace', fontSize: '8px', color: '#a9b1d6' }).setOrigin(0.5, 0).setResolution(zoom);
        for (const glasses of [false, true]) {
          const o = this.outfits.find((x) => x.hair === hair && x.hat === hat && !!x.glasses === glasses)!;
          const s = this.add.sprite(60 + i * cellW, 20 + (hi + 1) * cellH - 8, sheetKey(o, 'idle', 's')).setOrigin(C.anchor[0] / C.cell[0], C.anchor[1] / C.cell[1]);
          s.setVisible(!glasses);
          this.sprites.push({ sprite: s, outfit: o });
        }
        const drawn = hairDrawn(C, { ...BASE, hair, hat });
        if (drawn !== hair) this.add.text(60 + i * cellW, 20 + (hi + 1) * cellH - 6, `→ ${drawn}`, { fontFamily: 'monospace', fontSize: '6px', color: '#f7768e' }).setOrigin(0.5, 0).setResolution(zoom);
      });
    });
    this.cameras.main.centerOn((60 + W.hair.length * cellW) / 2, (20 + (hats.length + 1) * cellH) / 2);
    this.label = this.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '12px', color: '#e6e9f2' }).setScrollFactor(0).setResolution(zoom);

    const kb = this.input.keyboard!;
    kb.on('keydown', (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= 8) this.dirIndex = n - 1;
      else if (e.key === 'ArrowRight') this.dirIndex = (this.dirIndex + 1) % 8;
      else if (e.key === 'ArrowLeft') this.dirIndex = (this.dirIndex + 7) % 8;
      else if (e.key.toLowerCase() === 'a') this.animIndex = (this.animIndex + 1) % this.animList.length;
      else if (e.key.toLowerCase() === 'g') this.glasses = !this.glasses;
      this.refresh();
    });
    this.refresh();
    (window as unknown as { __wardrobe: unknown }).__wardrobe = {
      set: (anim: string, dir: Dir, glasses = false) => {
        this.animIndex = Math.max(0, this.animList.indexOf(anim));
        this.dirIndex = Math.max(0, C.directions.indexOf(dir));
        this.glasses = glasses;
        this.refresh();
      },
      problems: () => [...assetProblems],
    };
  }

  private refresh(): void {
    const C = this.M.characters;
    const anim = this.animList[this.animIndex];
    const dirs = dirsFor(C, anim);
    const want = C.directions[this.dirIndex];
    const dir = dirs.includes(want) ? want : dirs[0];
    for (const { sprite, outfit } of this.sprites) {
      sprite.setVisible(!!outfit.glasses === this.glasses);
      sprite.play(sheetKey(outfit, anim, dir));
    }
    this.label.setText(`${anim} · ${dir}${dir !== want ? ` (${anim} has no ${want})` : ''} · glasses ${this.glasses ? 'on' : 'off'}   [1-8/←→ dir · A anim · G glasses]`);
  }
}
