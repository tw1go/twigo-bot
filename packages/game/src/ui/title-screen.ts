import type { Manifest } from '../assets/types';
import { Splash } from './splash';
import { canInstall, install, onInstallable } from '../net/pwa';
import { isDesktopApp, isHomeScreenApp, isIos } from '../net/platform';
import { loginWaits, waitingLogin } from '../net/login';

// 🌙 The boot sequence's two page layers (BootScene runs them while it loads):
// - The intro card: "a game made by" and the twigo logo, small and centred on ink. Fades in, holds, fades out (reduced
//   motion: shown a moment, no fades); any click or key skips it. Once per browser tab (sessionStorage), so reloads and
//   coming back from the Discord login go straight to the title screen; ?intro=1 always plays it.
// - The title screen: the pixel-art town (manifest ui.splashAnim, 24 frames at 8 fps drawn on a canvas; the still,
//   ui.splashBg, until the sheet is in, and only the still under reduced motion), at the smallest whole-number scale that
//   covers the screen, centred and cropped; "MIKAZUKI" in Pixelify Sans, Kowen gold with a navy drop shadow and glow, at
//   screen resolution in the sky; a dark band at the bottom with the button (ui.titleButton as a 9-slice at the same
//   whole-number scale: normal, hover, pressed) and a hint. Logged in (or login off): Start, "or click anywhere"; click
//   anywhere, Enter or Space starts. Logged out: Log in with Discord (/auth/login) and "Members of the Mikazuki server
//   only" (or the login's problem in red); only the button logs in. No button until /me has answered. A speaker in the
//   top-right corner mutes (the same setting as Settings → Mute; never counts as a click to start).

const GOLD = '#FCDA4A';
const NAVY = '#1E1B3A';
const FONT = "'Pixelify Sans', monospace";
const INTRO_KEY = 'mk_intro';
const INTRO = { in: 500, hold: 1600, out: 500, still: 1200 };
const CLOSE_MS = 400;
/** The button's height and the hint's size (art px, at the scale; the CSS draws them: index.html #title-screen). */
const BUTTON_H = 14;
const HINT = 4.5;

const asset = (f: string) => `${import.meta.env.BASE_URL}assets/${f}`;
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Whether the intro card plays now: once per tab, or always with ?intro=1. */
export function introDue(): boolean {
  if (new URLSearchParams(location.search).get('intro') === '1') return true;
  try {
    return !sessionStorage.getItem(INTRO_KEY);
  } catch {
    return true;
  }
}

/** The intro card; resolves once it's gone (played out, or skipped by a click or key). */
export function playIntro(M: Manifest): Promise<void> {
  try {
    sessionStorage.setItem(INTRO_KEY, '1');
  } catch {
    // private mode: it plays each time
  }
  const root = document.createElement('div');
  root.id = 'intro-card';
  const by = document.createElement('p');
  by.textContent = 'a game made by';
  root.append(by);
  const logo = M.ui.logoTwigo;
  if (logo) {
    const img = document.createElement('img');
    img.src = asset(logo.file);
    img.alt = 'twigo';
    img.draggable = false;
    root.append(img);
  }
  document.body.append(root);
  return new Promise((done) => {
    const timers: number[] = [];
    let over = false;
    const end = () => {
      if (over) return;
      over = true;
      timers.forEach(clearTimeout);
      removeEventListener('keydown', end);
      root.remove();
      done();
    };
    // (A click or key skips it; it bubbles on, so the same click lets sound start.)
    root.addEventListener('pointerdown', end);
    addEventListener('keydown', end);
    if (still()) {
      root.classList.add('ic-on');
      timers.push(window.setTimeout(end, INTRO.still));
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('ic-on')));
    timers.push(window.setTimeout(() => root.classList.remove('ic-on'), INTRO.in + INTRO.hold));
    timers.push(window.setTimeout(end, INTRO.in + INTRO.hold + INTRO.out));
  });
}

/** What the title screen offers: Start (logged in, or login off), or the Discord login (logged out; `problem`: why the
 *  last try didn't work). */
export type TitleOffer = { kind: 'start' } | { kind: 'guest'; problem: string | null };

export class TitleScreen {
  private readonly root = document.createElement('div');
  /** The town behind it (ui/splash.ts). */
  private readonly splash: Splash;
  private readonly bg: HTMLCanvasElement;
  private readonly title = document.createElement('canvas');
  private readonly band = document.createElement('div');
  private readonly sound = document.createElement('button');
  /** Top left: "Install Mikazuki" (the browser offers it), or on iPhone Safari a one-time Add to Home Screen hint. */
  private readonly extra = document.createElement('div');
  private readonly unwatch: () => void;
  private offer: TitleOffer | null = null;
  private closing = false;
  /** Start (the button, a click anywhere, Enter or Space). */
  onStart: () => void = () => {};
  /** The Discord login was pressed (the page goes there). */
  onLogin: () => void = () => {};

  constructor(
    private readonly M: Manifest,
    private readonly mute: { on: boolean; set(on: boolean): void },
    fadeIn = true,
  ) {
    this.root.id = 'title-screen';
    this.splash = new Splash(M);
    this.bg = this.splash.canvas;
    this.bg.className = 'ts-bg';
    this.title.className = 'ts-title';
    this.title.setAttribute('role', 'img');
    this.title.setAttribute('aria-label', 'Mikazuki');
    this.band.className = 'ts-band';
    this.sound.className = 'ts-sound';
    this.sound.type = 'button';
    this.drawSpeaker();
    this.sound.addEventListener('click', (e) => {
      e.stopPropagation(); // (never a click to start: its icon is redrawn under the pointer, so it can't be looked up later)
      this.mute.set(!this.mute.on);
      this.mute.on = !this.mute.on;
      this.drawSpeaker();
    });
    this.extra.className = 'ts-extra';
    this.extra.addEventListener('click', (e) => e.stopPropagation()); // (never a click to start)
    this.unwatch = onInstallable(() => this.renderExtra());
    this.renderExtra();
    this.root.append(this.bg, this.title, this.band, this.sound, this.extra);
    this.root.addEventListener('click', this.clicked);
    addEventListener('keydown', this.keyed);
    addEventListener('resize', this.layout);
    document.body.append(this.root);
    if (fadeIn && !still()) requestAnimationFrame(() => requestAnimationFrame(() => this.root.classList.add('ts-on')));
    else this.root.classList.add('ts-on', 'ts-now');
    this.layout();
    void document.fonts.load(`700 40px ${FONT}`).then(() => this.drawTitle()).catch(() => {});
  }

  /** What it offers, once /me has answered: the button and the hint under it. */
  setOffer(offer: TitleOffer): void {
    this.offer = offer;
    this.band.replaceChildren();
    const button = offer.kind === 'start' ? document.createElement('button') : document.createElement('a');
    button.className = 'ts-button';
    const label = document.createElement('span');
    label.textContent = offer.kind === 'start' ? 'Start' : 'Log in with Discord';
    button.append(label);
    if (button instanceof HTMLAnchorElement) {
      button.href = '/auth/login';
      button.addEventListener('click', (e) => {
        this.onLogin();
        if (!loginWaits()) return; // (the website: the link goes to Discord)
        // The iPhone home screen app: Discord in a browser sheet while this waits for it (net/login.ts).
        e.preventDefault();
        waitingLogin((text, problem) => {
          hint.textContent = text;
          hint.classList.toggle('ts-problem', !!problem);
        });
      });
    } else {
      button.type = 'button';
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        this.start();
      });
    }
    // Pressed: the pressed cell, the label down a pixel (kept while the pointer is down on it).
    button.addEventListener('pointerdown', () => button.classList.add('ts-pressed'));
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) button.addEventListener(ev, () => button.classList.remove('ts-pressed'));
    const hint = document.createElement('p');
    hint.className = offer.kind === 'guest' && offer.problem ? 'ts-hint ts-problem' : 'ts-hint';
    hint.textContent = offer.kind === 'start' ? 'or click anywhere' : (offer.problem ?? 'Members of the Mikazuki server only');
    this.band.append(button, hint);
    this.layout();
    if (offer.kind === 'guest') button.focus({ preventScroll: true });
  }

  /** The install button or the iPhone hint (neither once installed, nor in the desktop app). */
  private renderExtra(): void {
    this.extra.replaceChildren();
    if (canInstall()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ts-install';
      b.textContent = 'Install Mikazuki';
      b.title = 'Play it full screen from your home screen or desktop';
      b.addEventListener('click', () => void install());
      this.extra.append(b);
    } else if (isIos() && !isHomeScreenApp() && !isDesktopApp() && !iosHintClosed()) {
      const hint = document.createElement('p');
      hint.className = 'ts-ios';
      hint.textContent = 'Tap Share, then Add to Home Screen to play full screen';
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'ts-ios-x';
      x.textContent = '×';
      x.setAttribute('aria-label', 'Close');
      x.addEventListener('click', () => {
        closeIosHint();
        this.renderExtra();
      });
      hint.append(x);
      this.extra.append(hint);
    }
  }

  /** Fades out (CLOSE_MS; at once with reduced motion) and goes; resolves when it's gone. */
  close(): Promise<void> {
    this.closing = true;
    this.splash.destroy();
    this.unwatch();
    removeEventListener('keydown', this.keyed);
    removeEventListener('resize', this.layout);
    this.root.classList.remove('ts-on');
    const ms = still() ? 0 : CLOSE_MS;
    return new Promise((done) =>
      setTimeout(() => {
        this.root.remove();
        done();
      }, ms),
    );
  }

  private start(): void {
    if (this.closing || this.offer?.kind !== 'start') return;
    this.closing = true;
    this.onStart();
  }

  private readonly clicked = (e: MouseEvent) => {
    if (e.composedPath().some((n) => n === this.sound || (n instanceof Element && n.classList.contains('ts-button')))) return;
    this.start(); // (a guest's click anywhere does nothing: only the button logs in)
  };

  private readonly keyed = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if ((e.target as Element | null)?.closest?.('.ts-sound, a.ts-button')) return; // (the speaker; a link has its own Enter)
    e.preventDefault();
    this.start();
  };

  /** The whole-number scale that covers the screen: the background at it, centred and cropped; the title and the band. */
  private readonly layout = () => {
    const W = innerWidth;
    const H = innerHeight;
    const k = this.splash.fit(W, H);
    // The button and hint at the same scale, a step smaller if the button wouldn't fit the screen's width or the band.
    let s = k;
    this.root.style.setProperty('--s', String(s));
    this.buttonArt();
    const button = this.band.querySelector<HTMLElement>('.ts-button');
    while (s > 1 && ((button && button.offsetWidth > W * 0.92) || (BUTTON_H + HINT * 2) * s > H * 0.17)) {
      s--;
      this.root.style.setProperty('--s', String(s));
    }
    this.drawTitle();
  };

  /** The button's three cells as 9-slice images (once the sprite is in). */
  private buttonDone = false;
  private buttonArt(): void {
    const B = this.M.ui.titleButton;
    if (!B || this.buttonDone) return;
    this.buttonDone = true;
    const img = new Image();
    img.onload = () => {
      const [cw, ch] = B.size;
      ['normal', 'hover', 'pressed'].forEach((state, i) => {
        const c = document.createElement('canvas');
        [c.width, c.height] = [cw, ch];
        c.getContext('2d')!.drawImage(img, i * cw, 0, cw, ch, 0, 0, cw, ch);
        this.root.style.setProperty(`--btn-${state}`, `url(${c.toDataURL()})`);
      });
      this.root.style.setProperty('--btn-slice', String(B.slice));
    };
    img.src = asset(B.file);
  }

  /** "MIKAZUKI": Pixelify Sans, gold, a navy drop shadow and a soft navy glow; about 40% of the screen's width (80% on
   *  a tall screen), its top at 7% of the height; drawn at the screen's resolution. */
  private drawTitle(): void {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = innerWidth;
    const H = innerHeight;
    const c = this.title;
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const text = 'MIKAZUKI';
    ctx.font = `700 100px ${FONT}`;
    const m = ctx.measureText(text);
    const share = W < H ? 0.8 : 0.4;
    const capH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    // As wide as its share, but never taller than a quarter of the screen.
    const px = Math.min((W * share * 100) / m.width, (H * 0.25 * 100) / capH);
    ctx.font = `700 ${px}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const baseline = H * 0.07 + (m.actualBoundingBoxAscent * px) / 100;
    const drop = Math.max(2, px * 0.06);
    // The glow, the drop shadow, then the letters.
    ctx.save();
    ctx.shadowColor = 'rgba(30, 27, 58, 0.85)';
    ctx.shadowBlur = px * 0.35;
    ctx.fillStyle = 'rgba(30, 27, 58, 0.55)';
    ctx.fillText(text, W / 2, baseline);
    ctx.restore();
    ctx.fillStyle = NAVY;
    ctx.fillText(text, W / 2, baseline + drop);
    ctx.fillStyle = GOLD;
    ctx.fillText(text, W / 2, baseline);
  }

  /** The speaker: sound on (waves) or muted (a cross), white on navy. */
  private drawSpeaker(): void {
    const on = !this.mute.on;
    this.sound.setAttribute('aria-label', on ? 'Mute' : 'Unmute');
    this.sound.title = on ? 'Mute' : 'Unmute';
    this.sound.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges"><path fill="#E6E9F2" d="M2 6h3l4-3v10l-4-3H2z"/>${
      on ? '<path fill="none" stroke="#E6E9F2" stroke-width="1.5" d="M11 5.5q1.6 2.5 0 5M12.8 3.8q3 4.2 0 8.4"/>' : '<path stroke="#f7768e" stroke-width="1.5" d="M11 6l4 4M15 6l-4 4"/>'
    }</svg>`;
  }
}

/** The iPhone's Add to Home Screen hint, closed once and for all (this browser: localStorage `mk_ios_hint`). */
const IOS_HINT = 'mk_ios_hint';
function iosHintClosed(): boolean {
  try {
    return localStorage.getItem(IOS_HINT) === 'closed';
  } catch {
    return false;
  }
}
function closeIosHint(): void {
  try {
    localStorage.setItem(IOS_HINT, 'closed');
  } catch {
    /* private mode: it shows again next time */
  }
}
