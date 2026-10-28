import type Phaser from 'phaser';

// 🖱️ Whether a release is a click on the map. Phaser hears releases on the whole window (so a drag let go off the
// canvas still ends), and hit-tests them at the pointer, so a press on a page panel over the map (the player box, the
// bag, a dialog) released there would otherwise reach whatever is under it: the Warren Gate behind the player box
// walked you to it. Every click handler on the map asks `onMap` first: pressed and released on the canvas itself.
// Phaser's own record of the press is used (`downElement`, set on every mousedown whatever the button). A document
// pointerdown listener kept the flag before (28 Oct 2026): the browser fires no pointerdown for a button pressed while
// another is held (only pointermove), so the flag kept an earlier press on the HUD, and every map click was ignored
// until a plain press landed on the canvas: right clicks that stayed dead until a left click.

/** Pressed and released on the game's canvas (not on a panel over it). */
export function onMap(p: Phaser.Input.Pointer, canvas: HTMLCanvasElement): boolean {
  return p.downElement === canvas && p.upElement === canvas;
}

/** The button this very release is (Phaser's `isDown` bookkeeping can go stale when a release is never delivered: the
 *  window switched mid-press, a native menu): 0 the left, 2 the right. */
export const releasedLeft = (p: Phaser.Input.Pointer): boolean => p.button === 0;
export const releasedRight = (p: Phaser.Input.Pointer): boolean => p.button === 2;
