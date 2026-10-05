import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { CreateScene, TownPreloadScene } from './scenes/CreateScene';
import { TownScene } from './scenes/TownScene';
import { WardrobeScene } from './scenes/WardrobeScene';
import { startHud } from './hud';
import { showVersion } from './ui/version';

// The town, open to every member of the Mikazuki server (the bot checks; ?preview from before is simply ignored).
document.getElementById('boot-msg')?.remove(); // shown by the page itself until this script arrives
startGame();

void startHud(document.getElementById('hud')!);
showVersion();

function startGame(): void {
  // The login corner stays out of the way while the game starts (the creator shows it; the town has its own HUD).
  document.getElementById('hud')?.setAttribute('hidden', '');
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#1a1b26',
    pixelArt: true, // nearest-neighbour scaling, no smoothing
    roundPixels: true, // snap to whole pixels so sprites never blur between pixels
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene: [BootScene, TownScene, WardrobeScene, CreateScene, TownPreloadScene],
  });
}
