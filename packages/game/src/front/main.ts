import './front.css';
import type { CharacterDefs, ClassArt, ClassesDefs, Manifest, MobDef, PropDef } from '../assets/types';
import { mobCell, mobSheet } from '../assets/mob-art';
import type { ImageHost, Outfit } from '../characters/doll';
import { CELL, drawPose, lookImages } from '../characters/kit-art';
import { Splash } from '../ui/splash';

// 🌙 The front page's moving parts (its markup is built with the page: render.ts). The hero's town (the title screen's
// own background, ui/splash.ts), every sprite (each <canvas class="sprite"> from its manifest sheet, frame by frame at
// its fps; the classes dressed with the game's own paper doll and combat-pose drawing; Barong-Barong and the golem
// loaded only as their section comes near; nothing animates off screen or under reduced motion), and the close beta
// dialog (POST /api/beta/apply). No Phaser: it loads fast.

const M = JSON.parse(document.getElementById('front-data')!.textContent!) as Manifest;
const TEXT = JSON.parse(document.getElementById('front-text')!.textContent!) as { sending: string; send: string; offline: string; doneText: string; doneUpdated: string };
const base = import.meta.env.BASE_URL;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const NEAR = '800px'; // big sheets start loading this far before their section scrolls in

// ── Images, by their path under assets/ (the same paths the game uses) ──

const images = new Map<string, HTMLImageElement>();
const loading = new Map<string, Promise<HTMLImageElement | null>>();
function load(file: string): Promise<HTMLImageElement | null> {
  let p = loading.get(file);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        images.set(file, img);
        resolve(img);
      };
      img.onerror = () => resolve(null);
      img.src = `${base}assets/${file}`;
    });
    loading.set(file, p);
  }
  return p;
}
/** The game's drawing reads images through this (as it reads a Phaser scene's textures). */
const host: ImageHost = { textures: { exists: (k) => images.has(k), get: (k) => ({ getSourceImage: () => images.get(k) }) } };

// ── The hero: the title screen's town, at the smallest whole-number scale that covers it ──

const sky = document.querySelector<HTMLElement>('.hero .sky');
if (sky) {
  const splash = new Splash(M);
  sky.append(splash.canvas);
  const fit = () => splash.fit(sky.clientWidth, sky.clientHeight, 0.35);
  fit();
  addEventListener('resize', fit);
  // Its clock only while it's on screen.
  new IntersectionObserver(([e]) => (e.isIntersecting ? splash.start() : splash.stop())).observe(sky);
}

// ── Sprites ──

/** A sprite: how to draw its frame `f` (null until its art is in), how many frames and how fast. */
interface Sprite {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  frames: number;
  fps: number;
  draw: ((f: number) => void) | null;
  shown: number;
  visible: boolean;
}
const sprites: Sprite[] = [];

/** Frame `f` of a sheet whose cells are `w`×`h`, row by row (a strip, or Barong-Barong's 5-a-row grid). */
function cellOf(img: HTMLImageElement, w: number, h: number, f: number): [number, number] {
  const cols = Math.max(1, Math.floor(img.width / w));
  return [(f % cols) * w, Math.floor(f / cols) * h];
}

/** A mob's (or the golem's, or Barong-Barong's) idle: its sheet for the variant and facing, cropped if asked. */
async function mobSprite(s: Sprite): Promise<void> {
  const d = s.canvas.dataset;
  const def = M.mobs?.[d.mob!] as MobDef | undefined;
  if (!def || typeof def !== 'object') return;
  const img = await load(mobSheet(def, d.variant ?? '', 'idle', d.dir ?? 'se'));
  if (!img) return;
  const [w, h] = mobCell(def, d.variant ?? '').size;
  const [cx, cy, cw, ch] = d.crop ? d.crop.split(',').map(Number) : [0, 0, w, h];
  s.draw = (f) => {
    const [x, y] = cellOf(img, w, h, f);
    s.ctx.clearRect(0, 0, cw, ch);
    s.ctx.drawImage(img, x + cx, y + cy, cw, ch, 0, 0, cw, ch);
  };
}

/** The Warren Gate: its pipe, and its portal strip on top (cycling, its glow pulsing softly). */
async function gateSprite(s: Sprite): Promise<void> {
  const def = M.props?.[s.canvas.dataset.prop!] as PropDef | undefined;
  const portal = def?.portal;
  if (!def?.file) return;
  const [pipe, glow] = await Promise.all([load(def.file), portal ? load(portal.file) : Promise.resolve(null)]);
  if (!pipe) return;
  s.frames = portal?.frames ?? 1;
  s.fps = portal?.fps ?? 1;
  const [w, h] = def.size ?? [pipe.width, pipe.height];
  s.draw = (f) => {
    s.ctx.clearRect(0, 0, w, h);
    s.ctx.drawImage(pipe, 0, 0);
    if (!glow || !portal) return;
    const [lo, hi, ms] = portal.pulse ?? [1, 1, 1000];
    s.ctx.globalAlpha = reduced ? hi : lo + (hi - lo) * (0.5 + 0.5 * Math.cos((performance.now() / ms) * Math.PI * 2));
    s.ctx.drawImage(glow, f * portal.frameSize[0], 0, portal.frameSize[0], portal.frameSize[1], 0, 0, portal.frameSize[0], portal.frameSize[1]);
    s.ctx.globalAlpha = 1;
  };
}

/** A class in its look: the idle-ready pose facing SE, dressed by the game's own drawing (kit-art drawPose: the body
 *  and face in the look's skin, its clothes and hair laid on, then the weapon), every frame drawn once into a strip. */
async function classSprite(s: Sprite): Promise<void> {
  const d = s.canvas.dataset;
  const C = M.characters as CharacterDefs;
  const K = M.classes as ClassesDefs;
  const art = (K.list as Record<string, ClassArt>)[d.class!];
  const pose = art?.anims['idle-ready'];
  const dirs = pose?.dirs.se;
  if (!art || !pose || !dirs) return;
  const look = JSON.parse(d.look!) as Outfit;
  const files = [dirs.body, ...(dirs.face ? [dirs.face] : []), ...dirs.back.map((l) => l.file), ...dirs.front.map((l) => l.file), ...lookImages(C, look, ['se'])];
  await Promise.all(files.map(load));
  const strip = document.createElement('canvas');
  strip.width = CELL * pose.frames;
  strip.height = CELL;
  const g = strip.getContext('2d')!;
  for (let f = 0; f < pose.frames; f++) drawPose(g, host, C, K, look, art, 'idle-ready', 'se', f, f * CELL, 0);
  s.draw = (f) => {
    s.ctx.clearRect(0, 0, CELL, CELL);
    s.ctx.drawImage(strip, f * CELL, 0, CELL, CELL, 0, 0, CELL, CELL);
  };
}

function setUp(canvas: HTMLCanvasElement): Sprite {
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const s: Sprite = { canvas, ctx, frames: Number(canvas.dataset.frames ?? 1), fps: Number(canvas.dataset.fps ?? 1), draw: null, shown: -1, visible: false };
  sprites.push(s);
  return s;
}

const start = (s: Sprite) => {
  const d = s.canvas.dataset;
  void (d.class ? classSprite(s) : d.prop ? gateSprite(s) : mobSprite(s)).then(() => tick(performance.now(), s));
};

// The visible ones animate; the big ones (data-lazy) start loading as they come near.
const seen = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const s = sprites.find((x) => x.canvas === e.target);
    if (s) s.visible = e.isIntersecting;
  }
});
const near = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      near.unobserve(e.target);
      const s = sprites.find((x) => x.canvas === e.target);
      if (s) start(s);
    }
  },
  { rootMargin: NEAR },
);
for (const canvas of document.querySelectorAll<HTMLCanvasElement>('canvas.sprite')) {
  const s = setUp(canvas);
  seen.observe(canvas);
  if (canvas.dataset.lazy) near.observe(canvas);
  else start(s);
}

/** Draws a sprite's frame for time `t` (frame 0 under reduced motion), if it changed (the gate's glow always moves). */
function tick(t: number, s: Sprite): void {
  if (!s.draw) return;
  const f = reduced ? 0 : Math.floor((t / 1000) * s.fps) % s.frames;
  if (f === s.shown && !s.canvas.dataset.prop) return;
  s.shown = f;
  s.draw(f);
}
if (!reduced) {
  const loop = (t: number) => {
    for (const s of sprites) if (s.visible) tick(t, s);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// ── Apply to close beta ──

const modal = document.getElementById('apply')!;
const form = document.getElementById('apply-form') as HTMLFormElement;
const done = document.getElementById('apply-done')!;
const error = document.getElementById('apply-error')!;
const username = document.getElementById('f-discord') as HTMLInputElement;
const send = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
let opener: HTMLElement | null = null;
let askedMe = false;

/** Logged in with Discord here: their username in the form (their id goes with it on the server, from the session). */
async function prefill(): Promise<void> {
  if (askedMe) return;
  askedMe = true;
  const me = await fetch('/me', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { username?: string } | null;
  if (me?.username && !username.value) username.value = me.username;
}

const focusables = () => [...modal.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')].filter((el) => !el.closest('[hidden]') && !(el as HTMLButtonElement).disabled && el.tabIndex >= 0);

function open(from: HTMLElement): void {
  opener = from;
  form.hidden = false;
  done.hidden = true;
  error.hidden = true;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  username.focus();
  void prefill();
}

function close(): void {
  if (modal.hidden) return;
  modal.hidden = true;
  document.body.style.overflow = '';
  opener?.focus();
}

for (const b of document.querySelectorAll<HTMLElement>('[data-apply]')) b.addEventListener('click', () => open(b));
modal.addEventListener('click', (e) => {
  if (e.target === modal || (e.target as HTMLElement).closest('[data-close]')) close();
});
modal.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return close();
  if (e.key !== 'Tab') return;
  // Focus stays in the dialog while it's open.
  const all = focusables();
  if (!all.length) return;
  const [first, last] = [all[0], all[all.length - 1]];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});

function fail(text: string): void {
  error.textContent = text;
  error.hidden = false;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.hidden = true;
  const data = new FormData(form);
  const body = { discord: String(data.get('discord') ?? '').trim(), class: String(data.get('class') ?? ''), note: String(data.get('note') ?? '').trim() };
  if (body.discord.replace(/^@/, '').length < 2) {
    username.focus();
    return fail('Type your Discord username (2 to 32 characters).');
  }
  send.disabled = true;
  send.firstElementChild!.textContent = TEXT.sending;
  try {
    const res = await fetch('/api/beta/apply', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const answer = (await res.json().catch(() => ({}))) as { ok?: boolean; updated?: boolean; error?: string };
    if (!res.ok || !answer.ok) return fail(answer.error ?? `Something went wrong (HTTP ${res.status}). Try again in a moment.`);
    document.getElementById('apply-done-text')!.textContent = answer.updated ? TEXT.doneUpdated : TEXT.doneText;
    form.hidden = true;
    done.hidden = false;
    done.querySelector<HTMLElement>('h2')!.focus();
  } catch {
    fail(TEXT.offline);
  } finally {
    send.disabled = false;
    send.firstElementChild!.textContent = TEXT.send;
  }
});
