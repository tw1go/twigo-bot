import type Phaser from 'phaser';
import type { CharacterDefs, ClassArt, ClassesDefs, Dir, Manifest, Vec2 } from '../assets/types';
import { type Outfit, drawStill, outfitKey } from './doll';
import { artFor, drawPose } from './kit-art';
import { loadImages } from './loading';
import { lagMark } from '../net/lag';

// 😵 The faint (CONTEXT.md Faint): a knocked-out character buckles, kneels and falls forwards the way they face, then lies
// on the ground with dizzy eyes until they respawn. No art of its own: it's the look's own standing frame (the town
// doll's idle frame 0, or on a battle map the class's idle-ready frame 0 as battle-art draws it) moved and turned, so
// every layer (clothes, hair, hats big or lit, cosmetic tops with their wings, weapons) falls together. A port of the art
// folder's scripts/faint/build_faint_preview.py (its sheets in characters/faint/sheets to compare against).
//
// Frames (FAINT_MS, then frame 6 held): 0 buckle (2 leg rows out), 1 kneel (4; the dizzy face from here on), 2 slump
// (5), 3 and 4 the slump turned 35° and 70° about the knee (RotSprite), dropped back onto the ground row, 5 lands (the
// body with 3 leg rows out, turned a quarter), 6 down (the full-length body, turned a quarter). Battle: frames 5 and 6
// are the body without its weapon, the weapon dropped behind it. Every measurement (the feet, the knee, the ground row,
// where the head lands, the lying body's box) comes from the bare body layer alone: the rest just rides along.

/** A faint frame's cell, and the feet in it. */
export const FAINT_CELL: Vec2 = [128, 72];
export const FAINT_ANCHOR: Vec2 = [64, 68];
/** Each frame's time (ms), frames 0 to 5; frame 6 is held while knocked out. */
export const FAINT_MS = [90, 110, 380, 90, 80, 90];
/** From the knock-out to lying down (frame 6). */
export const FAINT_DOWN_MS = FAINT_MS.reduce((a, b) => a + b, 0);
/** The shadow's width per frame (null: as standing): wider as they tip, under the lying body's middle from frame 5. */
export const FAINT_SHADOW: (number | null)[] = [null, null, null, 22, 30, 36, 36];

/** One direction's faint: its animation (and texture) key, which way the head went, the stars' spot over the head and
 *  the lying body's box (frame 6, bare body; cell px: x0, y0, x1, y1). */
export interface FaintPose {
  key: string;
  headLeft: boolean;
  stars: Vec2;
  body: [number, number, number, number];
}

export type Faint = Partial<Record<Dir, FaintPose>>;

/** The way the head falls: forwards, the way they face (sw, w, nw and n: to screen-left). */
const HEAD_LEFT = new Set<Dir>(['sw', 'w', 'nw', 'n']);
const KNEEL = [2, 4, 5]; // leg rows out: buckle, kneel, slump

// The working canvas: N × N, the feet at (WAX, WAY).
const N = 112;
const WAX = 56;
const WAY = 80;

// ── Pixels: an image is N × N RGBA as one Uint32 each (0: see-through) ──

type Img = Uint32Array;
type Box = [number, number, number, number];
const blank = (): Img => new Uint32Array(N * N);
const alphaOf = (v: number) => v >>> 24; // (little-endian RGBA)

/** A canvas's pixels as an image, anything fully see-through as 0. */
function imgOf(ctx: CanvasRenderingContext2D): Img {
  const d = new Uint32Array(ctx.getImageData(0, 0, N, N).data.buffer);
  for (let i = 0; i < d.length; i++) if (!alphaOf(d[i])) d[i] = 0;
  return d;
}

/** The box round everything drawn (x1, y1 past the end); [0, 0, 1, 1] when there's nothing (as PIL's getbbox, or). */
function bbox(a: Img): Box {
  let [x0, y0, x1, y1] = [N, N, -1, -1];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++)
      if (a[y * N + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
  return x1 < 0 ? [0, 0, 1, 1] : [x0, y0, x1 + 1, y1 + 1];
}
const empty = (a: Img) => !a.some((v) => v);

/** Moved by (dx, dy); what goes off the canvas is lost. */
function shift(a: Img, dx: number, dy: number): Img {
  const out = blank();
  for (let y = 0; y < N; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= N) continue;
    for (let x = 0; x < N; x++) {
      const tx = x + dx;
      if (tx >= 0 && tx < N && a[y * N + x]) out[ty * N + tx] = a[y * N + x];
    }
  }
  return out;
}

/** `src` laid over `dst` (alpha compositing, in place). */
function over(dst: Img, src: Img): void {
  for (let i = 0; i < dst.length; i++) {
    const s = src[i];
    const sa = alphaOf(s);
    if (!sa) continue;
    const d = dst[i];
    const da = alphaOf(d);
    if (sa === 255 || !da) {
      dst[i] = s;
      continue;
    }
    const a = sa + (da * (255 - sa)) / 255;
    const ch = (sh: number) => Math.round((((s >>> sh) & 255) * sa + (((d >>> sh) & 255) * da * (255 - sa)) / 255) / a);
    dst[i] = ((Math.round(a) << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0;
  }
}

/** `rows` rows taken out of the legs just above the feet (the bare body's bottom 3 rows, `ref`): everything above drops
 *  that many px, the feet stay. */
function buckle(a: Img, rows: number, ref: Img): Img {
  const cut = bbox(ref)[3] - 3;
  const out = blank();
  out.set(a.subarray(cut * N), cut * N);
  if (cut - rows > 0) out.set(a.subarray(0, (cut - rows) * N), rows * N);
  return out;
}

/** `k` lossless quarter turns counter-clockwise about `pivot` (np.rot90: (x, y) → (y, N − 1 − x)). */
function turn(a: Img, k: number, pivot: Vec2): Img {
  k = ((k % 4) + 4) % 4;
  const rot = (x: number, y: number): Vec2 => {
    for (let i = 0; i < k; i++) [x, y] = [y, N - 1 - x];
    return [x, y];
  };
  const [qx, qy] = rot(pivot[0], pivot[1]);
  const out = blank();
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const v = a[y * N + x];
      if (!v) continue;
      const [rx, ry] = rot(x, y);
      const tx = rx + pivot[0] - qx;
      const ty = ry + pivot[1] - qy;
      if (tx >= 0 && tx < N && ty >= 0 && ty < N) out[ty * N + tx] = v;
    }
  return out;
}

/** Scale2x (EPX): twice the size, edges kept sharp. */
function scale2x(a: Uint32Array, w: number, h: number): Uint32Array {
  const out = new Uint32Array(w * h * 4);
  const W = w * 2;
  for (let y = 0; y < h; y++) {
    const up = Math.max(0, y - 1) * w;
    const dn = Math.min(h - 1, y + 1) * w;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const E = a[row + x];
      const B = a[up + x];
      const H = a[dn + x];
      const D = a[row + Math.max(0, x - 1)];
      const F = a[row + Math.min(w - 1, x + 1)];
      const c = B !== H && D !== F;
      const o = y * 2 * W + x * 2;
      out[o] = c && D === B ? D : E;
      out[o + 1] = c && B === F ? F : E;
      out[o + W] = c && D === H ? D : E;
      out[o + W + 1] = c && H === F ? F : E;
    }
  }
  return out;
}

/** An image at 8× (Scale2x three times), for RotSprite. */
const big8 = (a: Img) => scale2x(scale2x(scale2x(a, N, N), N * 2, N * 2), N * 4, N * 4);

/** RotSprite: `deg` counter-clockwise about `pivot`, from the 8× image (nearest neighbour, as PIL's rotate does it),
 *  sampled back every 8th px from 4 in. */
function rotsprite(big: Uint32Array, deg: number, pivot: Vec2): Img {
  const B = N * 8;
  const r15 = (v: number) => Math.round(v * 1e15) / 1e15;
  const t = -((((deg % 360) + 360) % 360) * Math.PI) / 180;
  const [a0, a1, a3, a4] = [r15(Math.cos(t)), r15(Math.sin(t)), r15(-Math.sin(t)), r15(Math.cos(t))];
  const [cx, cy] = [pivot[0] * 8 + 4, pivot[1] * 8 + 4];
  const a2 = a0 * -cx + a1 * -cy + cx;
  const a5 = a3 * -cx + a4 * -cy + cy;
  const out = blank();
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const X = i * 8 + 4.5;
      const Y = j * 8 + 4.5;
      const xi = Math.floor(a0 * X + a1 * Y + a2);
      const yi = Math.floor(a3 * X + a4 * Y + a5);
      if (xi >= 0 && xi < B && yi >= 0 && yi < B) out[j * N + i] = big[yi * B + xi];
    }
  return out;
}

/** The dropped weapon: turned a quarter the way the body fell only if that makes it longer than tall, under the lying
 *  body's middle (`under`: its box), its lowest pixel 1 px below the ground row. */
function layFlat(weapon: Img | null, headLeft: boolean, under: Box, ground: number): Img | null {
  if (!weapon || empty(weapon)) return null;
  let [x0, y0, x1, y1] = bbox(weapon);
  if (y1 - y0 > x1 - x0) weapon = turn(weapon, headLeft ? 1 : 3, [WAX, WAY]);
  [x0, y0, x1, y1] = bbox(weapon);
  return shift(weapon, Math.floor((under[0] + under[2]) / 2) - Math.floor((x0 + x1) / 2), ground + 1 - (y1 - 1));
}

/** The 128 × 72 cell, the feet at FAINT_ANCHOR. */
function crop(a: Img): Uint32Array {
  const [W, H] = FAINT_CELL;
  const [ox, oy] = [WAX - FAINT_ANCHOR[0], WAY - FAINT_ANCHOR[1]];
  const out = new Uint32Array(W * H);
  for (let y = 0; y < H; y++) {
    const sy = y + oy;
    if (sy < 0 || sy >= N) continue;
    for (let x = 0; x < W; x++) {
      const sx = x + ox;
      if (sx >= 0 && sx < N) out[y * W + x] = a[sy * N + sx];
    }
  }
  return out;
}

/** The box round a cell's pixels (cell px). */
function cellBox(a: Uint32Array): Box {
  const [W, H] = FAINT_CELL;
  let [x0, y0, x1, y1] = [W, H, -1, -1];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (a[y * W + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
  return x1 < 0 ? [0, 0, 1, 1] : [x0, y0, x1 + 1, y1 + 1];
}

/**
 * The fall from a standing frame (frames 1-6: `stand` with the dizzy face; frame 0 is the caller's): buckle, kneel, slump,
 * the slump tipping about its knee on the head side (35°, 70°: each dropped so the bare body's lowest pixel stays on the
 * ground row, never a hop), then lying flat, its head where the slump's quarter turn put it, the legs stretching back out.
 * `body`: the look without its weapon (battle; else `stand`), `weapon` the weapon alone, `bare` the bare body.
 * A generator: it yields after each costly step, so the caller can spread it over frames.
 */
function* fall(stand: Img, headLeft: boolean, body: Img, weapon: Img | null, bare: Img): Generator<void, { frames: Uint32Array[]; bare: Uint32Array }> {
  const s = headLeft ? 1 : -1;
  const ref = bare;
  const kneelFull = buckle(stand, KNEEL[2], ref);
  const kneelBare = buckle(bare, KNEEL[2], ref);
  const [x0, , x1, y1] = bbox(kneelBare);
  const knee: Vec2 = [headLeft ? x0 : x1 - 1, y1 - 1];
  const ground = y1 - 1; // (the bare feet's bottom row: every frame keeps the body on it)
  const k = headLeft ? 1 : 3;
  const headEnd = bbox(turn(kneelBare, k, knee))[headLeft ? 0 : 2];
  const lying = (rows: number): [Img, Img] => {
    const tb = turn(buckle(bare, rows, ref), k, knee);
    const b = bbox(tb);
    const dx = headEnd - b[headLeft ? 0 : 2];
    const dy = ground - (b[3] - 1);
    return [shift(turn(buckle(body, rows, ref), k, knee), dx, dy), shift(tb, dx, dy)];
  };
  const [, flatBare] = lying(0); // (legs back to full length once fully down)
  const dropped = layFlat(weapon, headLeft, bbox(flatBare), ground);
  const frames = KNEEL.map((r) => buckle(stand, r, ref));
  yield;
  const bigBare = big8(kneelBare);
  yield;
  const bigFull = big8(kneelFull);
  yield;
  for (const deg of [35, 70]) {
    const low = bbox(rotsprite(bigBare, s * deg, knee))[3] - 1;
    frames.push(shift(rotsprite(bigFull, s * deg, knee), 0, ground - low));
  }
  yield;
  for (const rows of [3, 0]) {
    const f = blank();
    if (dropped) over(f, dropped);
    over(f, lying(rows)[0]);
    frames.push(f);
  }
  return { frames: frames.map(crop), bare: crop(flatBare) };
}

// ── The look's standing frames ──

let work: CanvasRenderingContext2D | null = null;
/** The working canvas, cleared. */
function canvas(): CanvasRenderingContext2D {
  if (!work) {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    work = c.getContext('2d', { willReadFrequently: true })!;
  }
  work.clearRect(0, 0, N, N);
  work.imageSmoothingEnabled = false;
  return work;
}

/** A layer sheet's first frame (`w` × `h`) at (x, y) in the working canvas, as an image (the bare body). */
function frameAt(scene: Phaser.Scene, file: string, w: number, h: number, x: number, y: number): Img {
  const g = canvas();
  if (scene.textures.exists(file)) g.drawImage(scene.textures.get(file).getSourceImage() as CanvasImageSource, 0, 0, w, h, x, y, w, h);
  return imgOf(g);
}

interface Sources {
  /** Standing with the normal face (frame 0), with the dizzy one (the rest); without the weapon; the weapon alone. */
  stand: Img;
  dizzy: Img;
  body: Img;
  weapon: Img | null;
  bare: Img;
}

/** The town doll's idle frame 0 facing `dir` (with its big hat and topover whole), the feet at the working canvas's. */
function townSources(scene: Phaser.Scene, C: CharacterDefs, o: Outfit, dir: Dir): Sources {
  const [ax, ay] = C.anchor;
  const [x, y] = [WAX - ax, WAY - ay];
  const face = C.layers.face;
  const dizzyFace = face.dizzy && face.directions.includes(dir) ? face.dizzy.replaceAll('{dir}', dir) : undefined;
  const look = (f?: string) => {
    const g = canvas();
    drawStill(g, scene, C, o, 'idle', dir, 0, x, y, f);
    return imgOf(g);
  };
  const stand = look();
  const dizzy = dizzyFace && scene.textures.exists(dizzyFace) ? look(dizzyFace) : stand;
  const bare = frameAt(scene, C.layers.body.replaceAll('{anim}', 'idle').replaceAll('{dir}', dir), C.cell[0], C.cell[1], x, y);
  return { stand, dizzy, body: dizzy, weapon: null, bare };
}

/** The class's standing pose (idle-ready frame 0, as battle-art draws it) facing `dir`, the feet at the working canvas's:
 *  whole, without its weapon, and the weapon alone. */
function battleSources(scene: Phaser.Scene, C: CharacterDefs, K: ClassesDefs, o: Outfit, art: ClassArt, anim: string, dir: Dir): Sources | null {
  const d = art.anims[anim]?.dirs[dir];
  if (!d) return null;
  const [bx, by] = K.bodyOffset;
  const [ax, ay] = C.anchor;
  const [x, y] = [WAX - (bx + ax), WAY - (by + ay)];
  const face = d.dizzyFace && scene.textures.exists(d.dizzyFace) ? d.dizzyFace : undefined;
  const pose = (opts: { weapons?: 'none' | 'only'; face?: string }) => {
    const g = canvas();
    drawPose(g, scene, C, K, o, art, anim, dir, 0, x, y, [], opts);
    return imgOf(g);
  };
  return {
    stand: pose({}),
    dizzy: pose({ face }),
    body: pose({ weapons: 'none', face }),
    weapon: pose({ weapons: 'only' }),
    bare: frameAt(scene, d.body, C.cell[0], C.cell[1], x + bx, y + by),
  };
}

// ── Building and keeping them ──

const built = new Map<string, Faint>();
const wanted = new Map<string, { run: () => Generator<void, Faint | null>; done: Promise<Faint | null>; resolve: (f: Faint | null) => void; urgent: boolean }>();
const order: string[] = [];
let running = false;

/** A look's id for its faint: its class (on a battle map) and its look. */
export const faintId = (o: Outfit, cls: string | null) => `faint:${cls ?? '-'}:${o.weaponCosmetic ?? '-'}:${outfitKey(o)}`; // (a weapon skin too: kit-art.ts artFor)

/** A look's faint if it's built (else null). */
export function faintOf(o: Outfit, cls: string | null): Faint | null {
  return built.get(faintId(o, cls)) ?? null;
}

/**
 * Asks for a look's faint (`cls`: its class's pose on a battle map; null: the town doll), built once, in idle time: a
 * few ms a frame (BUDGET_MS), one look after another, `urgent` ones (a knock-out that just landed) first. The doll's
 * sheets (or the class's battle sheets) must be built already: their images are loaded then.
 */
export function wantFaint(scene: Phaser.Scene, M: Manifest, o: Outfit, cls: string | null, urgent = false): Promise<Faint | null> {
  const id = faintId(o, cls);
  const have = built.get(id);
  if (have) return Promise.resolve(have);
  const w = wanted.get(id);
  if (w) {
    if (urgent && !w.urgent) {
      w.urgent = true;
      order.splice(order.indexOf(id), 1);
      order.unshift(id);
    }
    return w.done;
  }
  let resolve!: (f: Faint | null) => void;
  const done = new Promise<Faint | null>((r) => (resolve = r));
  wanted.set(id, { run: () => buildFaint(scene, M, o, cls, id), done, resolve, urgent });
  if (urgent) order.unshift(id);
  else order.push(id);
  void drain(scene, M);
  return done;
}

/** At most this much work a frame (ms). */
const BUDGET_MS = 4;
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

/** Builds the faints asked for, one at a time, between frames. */
async function drain(scene: Phaser.Scene, M: Manifest): Promise<void> {
  if (running) return;
  running = true;
  try {
    // (Their dizzy faces load first: once, every class's and the doll's.)
    await loadImages(scene, dizzyFiles(M));
    while (order.length) {
      const id = order.shift()!;
      const w = wanted.get(id)!;
      const steps = w.run();
      let start = performance.now();
      let r = steps.next();
      while (!r.done) {
        if (performance.now() - start > BUDGET_MS) {
          lagMark('a faint', performance.now() - start); // (the lag report: net/lag.ts)
          await nextFrame();
          if (!scene.sys.textures) return; // (the scene went away)
          start = performance.now();
        }
        r = steps.next();
      }
      lagMark('a faint', performance.now() - start);
      wanted.delete(id);
      if (r.value) built.set(id, r.value);
      w.resolve(r.value);
    }
  } finally {
    running = false;
  }
}

/** Every dizzy face (the doll's and each class's), to load. */
function dizzyFiles(M: Manifest): string[] {
  const C = M.characters;
  const out = C.layers.face.dizzy ? C.layers.face.directions.map((d) => C.layers.face.dizzy!.replaceAll('{dir}', d)) : [];
  for (const art of Object.values(M.classes?.list ?? {}) as ClassArt[]) for (const d of Object.values(art.anims['idle-ready']?.dirs ?? {})) if (d?.dizzyFace) out.push(d.dizzyFace);
  return out;
}

/** One look's faint, every direction: its sheets and animations made (a generator: steps between frames). */
function* buildFaint(scene: Phaser.Scene, M: Manifest, o: Outfit, cls: string | null, id: string): Generator<void, Faint | null> {
  const C = M.characters;
  const K = M.classes;
  const art = cls && K ? artFor(C, K, cls, o) : undefined; // (in a worn weapon cosmetic's skin)
  if (cls && (!art || !K)) return null;
  const anim = art ? (art.anims['idle-ready'] ? 'idle-ready' : 'walk-ready') : 'idle';
  const dirs = art ? (Object.keys(art.anims[anim]?.dirs ?? {}) as Dir[]) : (C.animations.idle?.directions ?? C.directions);
  const faint: Faint = {};
  const [W, H] = FAINT_CELL;
  for (const dir of dirs) {
    const src = art && K ? battleSources(scene, C, K, o, art, anim, dir) : townSources(scene, C, o, dir);
    if (!src) continue;
    yield;
    const headLeft = HEAD_LEFT.has(dir);
    const first = crop(buckle(src.stand, KNEEL[0], src.bare)); // (frame 0: still the normal face)
    const steps = fall(src.dizzy, headLeft, src.body, src.weapon, src.bare);
    let r = steps.next();
    while (!r.done) {
      yield;
      r = steps.next();
    }
    const { frames, bare } = r.value;
    frames[0] = first;
    const key = `${id}:${dir}`;
    if (!scene.textures.exists(key)) {
      const c = document.createElement('canvas');
      c.width = W * frames.length;
      c.height = H;
      const g = c.getContext('2d')!;
      frames.forEach((f, i) => g.putImageData(new ImageData(new Uint8ClampedArray(f.buffer as ArrayBuffer), W, H), i * W, 0));
      const tex = scene.textures.addCanvas(key, c)!;
      frames.forEach((_, i) => tex.add(i, 0, i * W, 0, W, H));
      scene.anims.create({ key, frames: frames.map((_, i) => ({ key, frame: i, duration: FAINT_MS[i] ?? 0 })), frameRate: 10, repeat: 0 });
    }
    const box = cellBox(bare);
    faint[dir] = { key, headLeft, stars: [headLeft ? box[0] + 8 : box[2] - 9, box[1] - 3], body: box };
    yield;
  }
  return faint;
}
