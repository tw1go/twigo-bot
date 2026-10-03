import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { TownScene } from './scenes/TownScene';
import { WardrobeScene } from './scenes/WardrobeScene';
import { startHud } from './hud';
import { previewEnabled, showComingSoon } from './preview';

// The town is held behind ?preview until launch (see preview.ts); everyone else gets the coming-soon page.
// (?debug tools only work together with preview.)
document.getElementById('boot-msg')?.remove(); // shown by the page itself until this script arrives
if (previewEnabled()) startGame();
else showComingSoon(document.getElementById('game')!);

void startHud(document.getElementById('hud')!);

function startGame(): void {
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#1a1b26',
    pixelArt: true, // nearest-neighbour scaling, no smoothing
    roundPixels: true, // snap to whole pixels so sprites never blur between pixels
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene: [BootScene, TownScene, WardrobeScene],
  });
}
