import type Phaser from 'phaser';
import type { HoodHouse } from '@mikazuki/shared';
import type { Manifest } from '../assets/types';
import { type HouseArt, doorBox } from '../houses/art';
import type { Building } from './objects';

// 🎭 A house's rogue state, on the house (CONTEXT.md "Rogues and stealing"): a Protected house has a small moon charm
// hung just over its door (manifest ui.houseProtected), a Marked one a rogue's mask in the same spot (ui.rogueMask), an
// Open one nothing. 16 px art at the world's own scale, sorted just over the house, tinted with the night like it; set
// again whenever the house's state changes (the town's `house` news, change 'state').

export class RogueSigns {
  private signs = new Map<number, Phaser.GameObjects.Image>();

  constructor(
    private scene: Phaser.Scene,
    private M: Manifest,
    private art: HouseArt,
    private onSpawn: (o: Phaser.GameObjects.Image) => void,
  ) {}

  /** The sign `house` should show now, on its building `b` (gone when it's open). */
  set(house: HoodHouse, b: Building): void {
    const file = house.state === 'protected' ? this.M.ui.houseProtected?.file : house.state === 'marked' ? this.M.ui.rogueMask?.file : undefined;
    const old = this.signs.get(house.lot);
    if (!file || !this.scene.textures.exists(file)) {
      old?.destroy();
      this.signs.delete(house.lot);
      return;
    }
    const box = doorBox(this.scene, this.art, house.style);
    const left = b.sprite.getTopLeft();
    // Over the door's middle, its foot a pixel above the door's top (no door art: over the house's middle).
    const x = Math.round(left.x! + (box ? (box[0] + box[2] + 1) / 2 : b.sprite.width / 2));
    const y = Math.round(left.y! + (box ? box[1] - 1 : b.sprite.height / 2));
    const sign = old ?? this.scene.add.image(x, y, file);
    sign.setTexture(file).setPosition(x, y).setOrigin(0.5, 1).setDepth(b.depth + 0.01);
    this.onSpawn(sign);
    this.signs.set(house.lot, sign);
  }

  /** What the night tints. */
  get tintables(): Phaser.GameObjects.Image[] {
    return [...this.signs.values()];
  }

  /** For the headless check: each lot's sign. */
  debug(): { lot: number; file: string; x: number; y: number }[] {
    return [...this.signs].map(([lot, s]) => ({ lot, file: s.texture.key, x: s.x, y: s.y }));
  }
}
