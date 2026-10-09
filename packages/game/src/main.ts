import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { CreateScene, TownPreloadScene } from './scenes/CreateScene';
import { TownScene } from './scenes/TownScene';
import { WardrobeScene } from './scenes/WardrobeScene';
import { ArenaScene } from './scenes/ArenaScene';
import { HouseScene } from './scenes/HouseScene';
import { startHud } from './hud';
import { showVersion } from './ui/version';
import { setTextSize, textSize } from './ui/text-size';

setTextSize(textSize(), false); // Settings → Text size, before anything is drawn

// The town, open to every member of the Mikazuki server (the bot checks; ?preview from before is simply ignored).
document.getElementById('boot-msg')?.remove(); // shown by the page itself until this script arrives
// Right-click is the game's (walking): never the browser's menu, wherever it lands (the HUD, chat,
// pop-ups, labels), except in a text field, where copy and paste stay.
document.addEventListener('contextmenu', (e) => {
  const t = e.target as HTMLElement | null;
  if (!t?.closest('input, textarea, [contenteditable="true"]')) e.preventDefault();
});
// Tab never moves the focus round the page's buttons, and a button clicked with the mouse lets go of it at once: a
// focused button would go off again on Space or Enter, which are the game's keys.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') e.preventDefault();
}, true);
// Pictures and links never drag out as a ghost image (the game's own drags are on [draggable] elements, which still
// work), and no text gets selected outside a typing field.
document.addEventListener('dragstart', (e) => {
  const t = e.target as Element | null;
  if (t instanceof Element && (t.tagName === 'IMG' || t.tagName === 'A') && !t.closest('[draggable="true"]')) e.preventDefault();
});
document.addEventListener('selectstart', (e) => {
  const t = e.target as Element | null;
  const el = t instanceof Element ? t : (t as Node | null)?.parentElement;
  if (!el?.closest('input, textarea, [contenteditable="true"]')) e.preventDefault();
});
document.addEventListener('click', (e) => {
  const b = (e.target as Element | null)?.closest?.('button, [role="button"], a, [tabindex]');
  if (e.detail > 0 && b instanceof HTMLElement) b.blur();
});
// A press or drag that ends without a click (a slot dragged to rearrange the hotbar, a drag off a button) leaves the
// focus where it began or landed: let go of it too, so Enter or Space don't fire that slot afterwards. (Pop-ups that
// focus their own button do it after this, as they open.)
const strayFocus = () => {
  const a = document.activeElement;
  if (a instanceof HTMLElement && a !== document.body && !a.closest('input, textarea, select, [contenteditable="true"]')) a.blur();
};
for (const type of ['pointerup', 'dragend', 'drop']) document.addEventListener(type, strayFocus, true);
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
    // Images straight into <img> (the browser decodes them off the main thread), not fetched into blobs first: the
    // blob step ran on the main thread for every file, a stutter when someone arrives with a new look.
    loader: { imageLoadType: 'HTMLImageElement' },
    scene: [BootScene, TownScene, WardrobeScene, CreateScene, TownPreloadScene, HouseScene, ArenaScene], // the arena last: drawn over the town
  });
}
