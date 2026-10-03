import Phaser from 'phaser';
import { TownScene } from './scenes/TownScene';
import { startHud } from './hud';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1a1b26',
  pixelArt: true, // nearest-neighbour scaling, no smoothing
  roundPixels: true, // snap to whole pixels so sprites never blur between pixels
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  scene: [TownScene],
});

void startHud(document.getElementById('hud')!);
