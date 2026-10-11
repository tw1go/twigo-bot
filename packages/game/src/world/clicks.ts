import type Phaser from 'phaser';

// 🖱️ Whether a release is a click on the map. Phaser hears releases on the whole window (so a drag let go off the
// canvas still ends), and hit-tests them at the pointer, so a press on a page panel over the map (the player box, the
// bag, a dialog) released there would otherwise reach whatever is under it: the Warren Gate behind the player box
// walked you to it. Every click handler on the map asks `onMap` first: pressed and released on the canvas itself.

let pressedOnCanvas = false;
let watching = false;

/** Notes where each press lands (before anything else hears it). Once per page. */
function watch(canvas: HTMLCanvasElement): void {
  if (watching) return;
  watching = true;
  document.addEventListener('pointerdown', (e) => (pressedOnCanvas = e.target === canvas), true);
}

/** Pressed and released on the game's canvas (not on a panel over it). */
export function onMap(p: Phaser.Input.Pointer, canvas: HTMLCanvasElement): boolean {
  watch(canvas);
  return pressedOnCanvas && p.upElement === canvas;
}

/** Starts noting presses as soon as the scene is up (so the first click is known too). */
export const watchClicks = (canvas: HTMLCanvasElement): void => watch(canvas);
