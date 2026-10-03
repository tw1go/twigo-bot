import Phaser from 'phaser';
import type { Manifest, TownMap } from '../assets/types';

// Loads the two source-of-truth files, then hands over to the town, which queues every image they name.
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    this.load.setPath(`${import.meta.env.BASE_URL}assets/`);
    this.load.json('manifest', 'manifest.json');
    this.load.json('town', 'maps/town.json');
  }

  create(): void {
    const manifest = this.cache.json.get('manifest') as Manifest;
    const town = this.cache.json.get('town') as TownMap;
    const debug = new URLSearchParams(location.search).get('debug');
    this.scene.start(debug === 'wardrobe' ? 'wardrobe' : 'town', { manifest, town });
  }
}
