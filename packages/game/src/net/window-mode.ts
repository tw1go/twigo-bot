import { LogicalSize, currentMonitor, getCurrentWindow, type Monitor } from '@tauri-apps/api/window';

// 🪟 The desktop app's window (Settings → Display → Window; only ever loaded inside the app, net/desktop.ts and
// ui/window-settings.ts): Full screen (the system's), Borderless (no title bar, at a chosen size; the screen's own size
// covers it all, on a Mac without a new Space) or Windowed (title bar, resizable, at a chosen size; a size dragged to is
// kept too). Sizes are logical pixels, the size the system says the screen "looks like". Saved in the app's storage
// (mk_window) and applied as it opens; F11 / Ctrl+Cmd+F swaps Full screen and the last other mode.

export type WindowMode = 'fullscreen' | 'borderless' | 'windowed';
export interface WindowSetting {
  mode: WindowMode;
  /** The mode Full screen goes back to. */
  back: Exclude<WindowMode, 'fullscreen'>;
  width: number;
  height: number;
}
export interface WindowSize {
  width: number;
  height: number;
  /** The screen's own size (Borderless). */
  screen?: boolean;
}

const KEY = 'mk_window';
/** The window the app opens with (tauri.conf.json). */
const DEFAULT: WindowSetting = { mode: 'windowed', back: 'windowed', width: 1280, height: 720 };
/** The game is 16:9 at heart; every one at least the window's least (800 × 480). */
const SIZES: [number, number][] = [[1024, 576], [1280, 720], [1366, 768], [1600, 900], [1920, 1080], [2560, 1440], [3200, 1800], [3840, 2160]];
/** Room a title bar takes (Windowed). */
const TITLE_BAR = 40;
const isMac = () => /Mac/.test(navigator.platform);

export function windowSetting(): WindowSetting {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<WindowSetting> | null;
    const mode = s?.mode === 'fullscreen' || s?.mode === 'borderless' || s?.mode === 'windowed' ? s.mode : DEFAULT.mode;
    const back = s?.back === 'borderless' ? 'borderless' : 'windowed';
    const n = (v: unknown, min: number, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min ? Math.round(v) : d);
    return { mode, back, width: n(s?.width, 800, DEFAULT.width), height: n(s?.height, 480, DEFAULT.height) };
  } catch {
    return { ...DEFAULT };
  }
}

function save(s: WindowSetting): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* (nothing to keep it in) */
  }
}

/** The screen the window is on, in logical pixels: all of it, and what's left beside the taskbar or dock. */
async function screen(): Promise<{ whole: WindowSize; work: WindowSize } | null> {
  const m: Monitor | null = await currentMonitor().catch(() => null);
  if (!m) return null;
  const whole = m.size.toLogical(m.scaleFactor);
  const work = m.workArea.size.toLogical(m.scaleFactor);
  return { whole: { width: Math.round(whole.width), height: Math.round(whole.height) }, work: { width: Math.round(work.width), height: Math.round(work.height) } };
}

/** The most a mode's window can be on this screen (Windowed: beside the taskbar or dock, with its title bar). */
const roomOf = (mode: Exclude<WindowMode, 'fullscreen'>, s: { whole: WindowSize; work: WindowSize }): WindowSize =>
  mode === 'windowed' ? { width: s.work.width, height: s.work.height - TITLE_BAR } : s.whole;

/** The sizes a mode can take on this screen, smallest first: those that fit, and for Borderless the screen's own size
 *  last. */
export async function sizesFor(mode: Exclude<WindowMode, 'fullscreen'>): Promise<WindowSize[]> {
  const s = await screen();
  if (!s) return SIZES.map(([width, height]) => ({ width, height }));
  const room = roomOf(mode, s);
  const fits = SIZES.filter(([w, h]) => w <= room.width && h <= room.height).map(([width, height]) => ({ width, height }));
  if (mode === 'borderless') return [...fits.filter((f) => f.width !== s.whole.width || f.height !== s.whole.height), { ...s.whole, screen: true }];
  return fits.length ? fits : [{ width: Math.max(800, room.width), height: Math.max(480, room.height) }];
}

let applying = false;
/** A Mac's full screen without a new Space (Borderless at the screen's size). */
let simple = false;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Puts the window in a setting (and keeps it). A size that no longer fits (another screen) shrinks to the largest
 *  that does. */
export async function applyWindow(next: WindowSetting): Promise<void> {
  const w = getCurrentWindow();
  applying = true;
  try {
    if (next.mode !== 'fullscreen') next.back = next.mode;
    save(next);
    if (simple) {
      await w.setSimpleFullscreen(false);
      simple = false;
    }
    if (next.mode === 'fullscreen') {
      await w.setDecorations(true); // (a Mac's full screen Space wants a window with a title bar; it's hidden there)
      return void (await w.setFullscreen(true));
    }
    if (await w.isFullscreen()) {
      await w.setFullscreen(false);
      // (A Mac animates out of its full screen Space: sizes set meanwhile are lost.)
      for (let i = 0; i < 20 && (await w.isFullscreen()); i++) await wait(100);
      if (isMac()) await wait(600);
    }
    const windowed = next.mode === 'windowed';
    await w.setDecorations(windowed);
    await w.setResizable(windowed);
    await w.setMaximizable(windowed);
    // Windowed: its size, kept within the screen. Borderless: one of its sizes, else the largest under the one saved.
    const s = await screen();
    const room = s ? roomOf(next.mode, s) : null;
    const sizes = await sizesFor(next.mode);
    const size: WindowSize = windowed
      ? { width: Math.max(800, Math.min(next.width, room?.width ?? next.width)), height: Math.max(480, Math.min(next.height, room?.height ?? next.height)) }
      : (sizes.find((f) => f.width === next.width && f.height === next.height) ?? [...sizes].reverse().find((f) => f.width <= next.width && f.height <= next.height) ?? sizes[0]);
    if (isMac() && size.screen) {
      await w.setSimpleFullscreen(true);
      simple = true;
      return;
    }
    await w.setSize(new LogicalSize(size.width, size.height));
    await w.center();
  } finally {
    // (The resizes it set off arrive a moment later: not the player's.)
    setTimeout(() => (applying = false), 400);
  }
}

/** F11 / Ctrl+Cmd+F: Full screen, or back to the last other mode. */
export async function toggleFullscreen(): Promise<void> {
  const s = windowSetting();
  const full = s.mode === 'fullscreen' || (await getCurrentWindow().isFullscreen());
  await applyWindow({ ...s, mode: full ? s.back : 'fullscreen' });
}

/** As the app opens: the saved setting (none saved: the window as it opened), and from then on the player's own
 *  changes kept: a Windowed size dragged to, and full screen entered or left by the system's own button or keys. */
export function startWindow(): void {
  let saved = false;
  try {
    saved = localStorage.getItem(KEY) !== null;
  } catch {
    /* (nothing kept) */
  }
  if (saved) void applyWindow(windowSetting()).catch(() => null);
  let timer = 0;
  void getCurrentWindow()
    .onResized(() => {
      clearTimeout(timer);
      timer = window.setTimeout(() => void noticeResize(), 500);
    })
    .catch(() => null);
}

async function noticeResize(): Promise<void> {
  if (applying || simple) return;
  const w = getCurrentWindow();
  const s = windowSetting();
  const full = await w.isFullscreen();
  if (full !== (s.mode === 'fullscreen')) return save({ ...s, mode: full ? 'fullscreen' : s.back });
  if (s.mode !== 'windowed') return;
  const size = (await w.innerSize()).toLogical(await w.scaleFactor());
  save({ ...s, width: Math.round(size.width), height: Math.round(size.height) });
}
