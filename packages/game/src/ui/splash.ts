import type { Manifest } from '../assets/types';

// 🌃 The title background (manifest ui.splashAnim: 24 frames of 384x216 in a 6x4 grid at 8 fps; ui.splashBg, the still,
// until the sheet is in, and the still alone under reduced motion), drawn on a canvas at the art's own size with no
// smoothing; the page scales it up by a whole number (`fit`). The title screen (ui/title-screen.ts) and the front page's
// hero (src/front) both use it: the hero stops its clock while it's off screen (`stop`, `start`).

const asset = (f: string) => `${import.meta.env.BASE_URL}assets/${f}`;
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Splash {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private sheet: HTMLImageElement | null = null;
  private timer = 0;
  private frame = 0;
  private wanted = true;
  private gone = false;

  constructor(private readonly M: Manifest) {
    const S = M.ui.splashBg;
    const A = M.ui.splashAnim;
    [this.canvas.width, this.canvas.height] = this.size;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    if (S) {
      const img = new Image();
      img.onload = () => {
        if (!this.timer && !this.sheet) this.ctx.drawImage(img, 0, 0);
      };
      img.src = asset(S.file);
    }
    if (!A || still()) return;
    const sheet = new Image();
    sheet.onload = () => {
      if (this.gone) return;
      this.sheet = sheet;
      this.draw();
      if (this.wanted) this.start();
    };
    sheet.src = asset(A.file);
  }

  /** The art's size (the cell): [w, h]. */
  get size(): [number, number] {
    return this.M.ui.splashAnim?.size ?? this.M.ui.splashBg?.size ?? [384, 216];
  }

  /** Its frames move on at the sheet's fps (once the sheet's in; never under reduced motion). */
  start(): void {
    this.wanted = true;
    const A = this.M.ui.splashAnim;
    if (this.timer || !this.sheet || !A || this.gone) return;
    this.timer = window.setInterval(() => this.draw(), 1000 / A.fps);
  }

  /** The frames hold still (it's off screen, or going). */
  stop(): void {
    this.wanted = false;
    clearInterval(this.timer);
    this.timer = 0;
  }

  /** Stopped for good. */
  destroy(): void {
    this.stop();
    this.gone = true;
  }

  /** The smallest whole-number scale covering `W`×`H`: the canvas's CSS size and place in it (centred across; `anchorY`
   *  of the height it overflows by goes above, 0.5 = centred). Returns the scale. */
  fit(W: number, H: number, anchorY = 0.5): number {
    const [w, h] = this.size;
    const k = Math.max(1, Math.ceil(Math.max(W / w, H / h)));
    Object.assign(this.canvas.style, { width: `${w * k}px`, height: `${h * k}px`, left: `${Math.round((W - w * k) / 2)}px`, top: `${Math.round((H - h * k) * anchorY)}px` });
    return k;
  }

  private draw(): void {
    const A = this.M.ui.splashAnim;
    if (!A || !this.sheet) return;
    const [w, h] = A.size;
    const f = this.frame;
    this.ctx.clearRect(0, 0, w, h);
    this.ctx.drawImage(this.sheet, (f % A.columns) * w, Math.floor(f / A.columns) * h, w, h, 0, 0, w, h);
    this.frame = (f + 1) % A.frames;
  }
}
