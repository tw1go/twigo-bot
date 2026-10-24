import type Phaser from 'phaser';

// 🐢 The lag report: what was going on when the game stuttered, so a hitch seen with friends in the Slums can be told
// apart (the graphics card, building someone's look, the server) instead of guessed at. Always on and cheap: every
// frame's gap is measured, and only a slow one (over HITCH_MS) is kept, with what ran in it: the timed jobs (`lagSpan`
// / `lagMark`: unpacking an art sheet, a look, combat poses, a faint), the server's messages handled (how many, which,
// how long), the textures made (each one a GPU upload), and in Chromium the browser's own breakdown of the frame (the
// Long Animation Frames API: its scripts and its render time). Events say what happened round it (someone arrived or
// left, a map loaded, the server going quiet then sending a burst: a pause on its side). Settings → Game → Copy lag
// report puts it all in the clipboard as text; `__town.lag()` gives it in the console.

const HITCH_MS = 50; // a frame this long is kept (60 fps is 17 ms a frame)
const KEEP_HITCHES = 60;
const KEEP_EVENTS = 60;
const SERVER_QUIET_MS = 1200; // no message for this long on a battle map, then a burst: the server paused
const BURST_GAP_MS = 150; // messages this close together are one burst
const BURST_MIN = 5;

interface Hitch {
  at: number; // ms since the page opened
  ms: number;
  jobs: string[];
  messages: string;
  textures: string;
  browser?: string; // the Long Animation Frames API's breakdown
}

const hitches: Hitch[] = [];
const events: { at: number; text: string }[] = [];
let jobs: { label: string; ms: number }[] = [];
let messages = { count: 0, ms: 0, types: new Map<string, number>() };
let textures = { count: 0, px: 0 };
let lastFrame = 0;
let context = { area: '', players: 0, battle: false };
let renderer = '';
let started = false;

/** Times `fn` as one job of this frame. */
export function lagSpan<T>(label: string, fn: () => T): T {
  const t = performance.now();
  try {
    return fn();
  } finally {
    lagMark(label, performance.now() - t);
  }
}

/** A job of `ms` that just ran in this frame. */
export function lagMark(label: string, ms: number): void {
  if (ms >= 1) jobs.push({ label, ms });
}

/** Something that happened (kept with its time): someone arriving, a map loading. */
export function lagEvent(text: string): void {
  events.push({ at: Math.round(performance.now()), text });
  if (events.length > KEEP_EVENTS) events.shift();
}

/** Where you are now: the area, how many others are there, whether it's a battle map (the server sends all the time). */
export function lagContext(c: Partial<typeof context>): void {
  context = { ...context, ...c };
}

// The server's messages: counted per frame, and its quiet spells noted.
let lastMessage = 0;
let quiet: { from: number; ms: number; burst: number } | null = null;
/** A server message of type `t` was handled in `ms`. */
export function lagMessage(t: string, ms: number): void {
  const now = performance.now();
  messages.count++;
  messages.ms += ms;
  messages.types.set(t, (messages.types.get(t) ?? 0) + 1);
  if (quiet && now - lastMessage > BURST_GAP_MS) endQuiet();
  if (quiet) quiet.burst++;
  else if (context.battle && lastMessage && now - lastMessage > SERVER_QUIET_MS) quiet = { from: lastMessage, ms: now - lastMessage, burst: 1 };
  lastMessage = now;
}
function endQuiet(): void {
  if (quiet && quiet.burst >= BURST_MIN) lagEvent(`server quiet for ${Math.round(quiet.ms)} ms, then a burst of ${quiet.burst} messages (a pause on the server's side, or the connection)`);
  quiet = null;
}

/** Starts watching the frames (main.ts, once the game exists). */
export function startLag(game: Phaser.Game): void {
  if (started) return;
  started = true;
  game.textures.on('addtexture', (key: string) => {
    const src = game.textures.get(key)?.getSourceImage() as { width?: number; height?: number } | undefined;
    textures.count++;
    textures.px += (src?.width ?? 0) * (src?.height ?? 0);
  });
  game.events.once('ready', () => {
    try {
      const gl = (game.renderer as { gl?: WebGLRenderingContext }).gl;
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      renderer = gl ? String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'canvas';
    } catch {
      renderer = '?';
    }
  });
  // Chromium's own breakdown of each long frame (Edge, Chrome, the Windows app; not Safari or the Mac app).
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as LongFrame[]) {
        const end = e.startTime + e.duration;
        const h = hitches.findLast((x) => Math.abs(x.at - end) < 120);
        if (h) h.browser = describe(e);
      }
    }).observe({ type: 'long-animation-frame', buffered: false });
  } catch {
    // (not in this browser)
  }
  const frame = (t: number) => {
    const gap = lastFrame ? t - lastFrame : 0;
    lastFrame = t;
    if (quiet && performance.now() - lastMessage > BURST_GAP_MS) endQuiet();
    if (gap > HITCH_MS && !document.hidden) {
      hitches.push({
        at: Math.round(t),
        ms: Math.round(gap),
        jobs: summarise(jobs),
        messages: messages.count ? `${messages.count} (${Math.round(messages.ms)} ms: ${[...messages.types].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k}×${n}`).join(', ')})` : 'none',
        textures: textures.count ? `${textures.count} new (${Math.round(textures.px / 1000)}k px)` : 'none',
      });
      if (hitches.length > KEEP_HITCHES) hitches.shift();
    }
    jobs = [];
    messages = { count: 0, ms: 0, types: new Map() };
    textures = { count: 0, px: 0 };
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** The same job many times in a frame (sheets of one look): one line with how many and how long in all. */
function summarise(list: { label: string; ms: number }[]): string[] {
  const by = new Map<string, { n: number; ms: number }>();
  for (const j of list) {
    const b = by.get(j.label) ?? { n: 0, ms: 0 };
    b.n++;
    b.ms += j.ms;
    by.set(j.label, b);
  }
  return [...by].sort((a, b) => b[1].ms - a[1].ms).map(([label, b]) => `${label}${b.n > 1 ? ` ×${b.n}` : ''} ${Math.round(b.ms)} ms`);
}

interface LongFrame {
  startTime: number;
  duration: number;
  renderStart: number;
  styleAndLayoutStart: number;
  blockingDuration?: number;
  scripts?: { invoker: string; sourceFunctionName?: string; sourceURL?: string; duration: number }[];
}
/** "game frame 112 ms, layout and paint 3 ms; scripts: …": Phaser's whole frame runs in the browser's frame callback (from
 *  renderStart), then the browser lays out and paints (from styleAndLayoutStart); scripts before it ran outside frames. */
function describe(e: LongFrame): string {
  const end = e.startTime + e.duration;
  const paint = e.styleAndLayoutStart ? Math.round(end - e.styleAndLayoutStart) : 0;
  const game = e.renderStart ? Math.round((e.styleAndLayoutStart || end) - e.renderStart) : 0;
  const scripts = [...(e.scripts ?? [])] // (the browser's list is read-only: sorted as a copy)
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 4)
    .map((s) => `${s.sourceFunctionName || s.invoker} (${(s.sourceURL ?? '').split('/').pop()?.replace(/\?.*/, '') || '?'}) ${Math.round(s.duration)} ms`);
  return `game frame ${game} ms, layout and paint ${paint} ms${scripts.length ? `; scripts: ${scripts.join('; ')}` : ''}`;
}

/** The report as text: this device, then what happened and every slow frame, in order. */
export function lagReport(): string {
  const head = [
    `Mikazuki lag report · ${new Date().toISOString()}`,
    `build ${version()} · ${navigator.userAgent}`,
    `screen ${innerWidth}×${innerHeight} @${devicePixelRatio}x · ${navigator.hardwareConcurrency ?? '?'} cores · GPU ${renderer || '?'}`,
    `now: ${context.area || '?'}${context.battle ? ' (battle map)' : ''}, ${context.players} others here · open ${Math.round(performance.now() / 1000)} s`,
    `${hitches.length} slow frames (over ${HITCH_MS} ms) kept, the last ${KEEP_HITCHES} at most`,
    '',
  ];
  const lines = [
    ...events.map((e) => ({ at: e.at, text: `   ${e.text}` })),
    ...hitches.map((h) => ({ at: h.at, text: `!! ${h.ms} ms frame · jobs: ${h.jobs.length ? h.jobs.join(', ') : 'none timed'} · server messages: ${h.messages} · textures: ${h.textures}${h.browser ? ` · browser: ${h.browser}` : ''}` })),
  ].sort((a, b) => a.at - b.at);
  return [...head, ...lines.map((l) => `${(l.at / 1000).toFixed(1).padStart(7)} s ${l.text}`)].join('\n');
}

/** How many slow frames are kept. */
export const lagCount = (): number => hitches.length;

declare const __BUILD__: { version: string }; // (vite.config.ts)
const version = (): string => {
  try {
    return __BUILD__.version;
  } catch {
    return '?'; // (not defined: a test page)
  }
};
