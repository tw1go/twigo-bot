// Small pixel-art tiles drawn in code for page panels that have no art of their own (the notice board's wood, posts,
// cork and pins; the Mine's stone). Each is a few dozen pixels, repeated as a CSS background and scaled up with crisp pixels, so it
// matches the town's art. Seeded, so they look the same every time.

/** A tiny seeded random (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tile(w: number, h: number, draw: (px: (x: number, y: number, c: string) => void, rnd: () => number) => void, seed: number): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const px = (x: number, y: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(((x % w) + w) % w, ((y % h) + h) % h, 1, 1);
  };
  draw(px, seeded(seed));
  return c.toDataURL();
}

/** Two planks (12 px each, a dark seam under each), with grain streaks and a knot; 64 × 26. */
export const woodTile = () =>
  tile(64, 26, (px, rnd) => {
    const planks = [
      { y: 0, base: '#8E5A2C', light: '#A06A36', dark: '#74471F' },
      { y: 13, base: '#86542A', light: '#985F31', dark: '#6C421D' },
    ];
    for (const p of planks) {
      for (let y = 0; y < 12; y++) for (let x = 0; x < 64; x++) px(x, p.y + y, p.base);
      for (let x = 0; x < 64; x++) {
        px(x, p.y, p.light); // the plank's lit top edge
        px(x, p.y + 12, '#3B2310'); // the seam
      }
      // Grain: short streaks along the plank.
      for (let i = 0; i < 14; i++) {
        const y = p.y + 2 + Math.floor(rnd() * 9);
        const x = Math.floor(rnd() * 64);
        const len = 4 + Math.floor(rnd() * 10);
        const color = rnd() < 0.7 ? p.dark : p.light;
        for (let k = 0; k < len; k++) px(x + k, y, color);
      }
      // A knot.
      const kx = Math.floor(rnd() * 56) + 4;
      const ky = p.y + 4 + Math.floor(rnd() * 4);
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) px(kx + dx, ky + dy, '#5C3A1E');
      px(kx, ky, '#3B2310');
    }
  }, 7);

/** A post's grain, light from the left; 8 × 16 (repeats down). */
export const postTile = () =>
  tile(8, 16, (px, rnd) => {
    const cols = ['#3B2310', '#6B4423', '#9A6534', '#A87140', '#8B5A2B', '#7E5028', '#5C3A1E', '#3B2310'];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) px(x, y, cols[x]);
    for (let i = 0; i < 5; i++) {
      const x = 2 + Math.floor(rnd() * 4);
      const y = Math.floor(rnd() * 16);
      for (let k = 0; k < 3; k++) px(x, y + k, '#6B4423');
    }
  }, 11);

/** Cork: speckles on tan; 16 × 16. */
export const corkTile = () =>
  tile(16, 16, (px, rnd) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = rnd();
      px(x, y, r < 0.18 ? '#8A5A30' : r < 0.3 ? '#C99567' : r < 0.36 ? '#6E4421' : '#B07C4F');
    }
  }, 3);

/** A push pin, 5 × 5, in a colour (base, light, dark). */
export const pinTile = (base: string, light: string, dark: string) =>
  tile(5, 5, (px) => {
    const rows = ['.ddd.', 'dlbbd', 'dbbbd', 'dbbbd', '.ddd.'];
    rows.forEach((row, y) => [...row].forEach((ch, x) => ch !== '.' && px(x, y, ch === 'l' ? light : ch === 'b' ? base : dark)));
  }, 1);

/** Stone blocks: two staggered rows of blocks with dark mortar, lit top-left edges, speckles and a crack; 48 × 32. */
export const stoneTile = () =>
  tile(48, 32, (px, rnd) => {
    const shades = ['#6B6F80', '#636778', '#727689', '#5E6273'];
    const rows = [
      { y: 0, xs: [0, 20, 36] },
      { y: 16, xs: [10, 28, 44] },
    ];
    for (const r of rows) {
      const xs = r.xs;
      for (let b = 0; b < xs.length; b++) {
        const x0 = xs[b];
        const x1 = (b + 1 < xs.length ? xs[b + 1] : xs[0] + 48) - 1; // wraps around the tile
        const base = shades[Math.floor(rnd() * shades.length)];
        for (let y = r.y; y < r.y + 16; y++) {
          for (let x = x0; x <= x1; x++) {
            const mortar = y === r.y + 15 || x === x1;
            const lit = y === r.y || x === x0;
            const n = rnd();
            px(x, y, mortar ? '#2E3040' : lit ? '#8A8EA0' : n < 0.08 ? '#555869' : n < 0.14 ? '#7C8093' : base);
          }
        }
        // A crack in some blocks.
        if (rnd() < 0.5) {
          let cx = x0 + 3 + Math.floor(rnd() * Math.max(1, x1 - x0 - 6));
          for (let y = r.y + 3; y < r.y + 10; y++) {
            px(cx, y, '#3F4253');
            cx += rnd() < 0.5 ? 1 : 0;
          }
        }
      }
    }
  }, 5);

/** A locked slot's X, 10 × 10. */
export const lockTile = () =>
  tile(10, 10, (px) => {
    for (let i = 1; i < 9; i++) {
      px(i, i, '#5A5F78');
      px(9 - i, i, '#5A5F78');
      px(i + 1 > 8 ? i : i + 1, i, '#3D4256'); // a darker edge, so it reads as carved
    }
  }, 2);

/** Green casino felt with a fine weave; 16 × 16. */
export const feltTile = () =>
  tile(16, 16, (px, rnd) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const n = rnd();
      px(x, y, (x + y) % 4 === 0 ? '#1D6B45' : n < 0.12 ? '#1A6040' : n < 0.2 ? '#24804F' : '#1F7349');
    }
  }, 9);

/** A peso coin, 16 × 16, face up: 'kara' (a profile head) or 'krus' (a cross) in relief — the stand-in until the
 *  coin art arrives. */
export const coinTile = (face: 'kara' | 'krus') =>
  tile(16, 16, (px) => {
    const mid = 7.5;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - mid, y - mid);
      if (d > 7.6) continue;
      const lit = x + y < 12;
      px(x, y, d > 6.6 ? '#1E1B3A' : d > 5.6 ? (lit ? '#FDE68A' : '#BA7F05') : lit ? '#FCDA4A' : '#F8BF27');
    }
    const relief = '#BA7F05';
    const shape = face === 'krus'
      ? ['....##....', '....##....', '##########', '##########', '....##....', '....##....', '....##....', '....##....']
      : ['...###....', '..#####...', '..######..', '..#####...', '...####...', '....##....', '...####...', '..######..'];
    shape.forEach((row, y) => [...row].forEach((c, x) => c === '#' && px(x + 3, y + 4, relief)));
  }, 1);

let made = false;
/** Puts the tiles on the page as CSS variables (--px-wood, --px-post, --px-cork, --px-stone, --px-pin-red/green/blue),
 *  once. */
export function installPixelTiles(): void {
  if (made) return;
  made = true;
  const root = document.documentElement.style;
  root.setProperty('--px-wood', `url("${woodTile()}")`);
  root.setProperty('--px-post', `url("${postTile()}")`);
  root.setProperty('--px-cork', `url("${corkTile()}")`);
  root.setProperty('--px-stone', `url("${stoneTile()}")`);
  root.setProperty('--px-lock', `url("${lockTile()}")`);
  root.setProperty('--px-felt', `url("${feltTile()}")`);
  root.setProperty('--px-coin-kara', `url("${coinTile('kara')}")`);
  root.setProperty('--px-coin-krus', `url("${coinTile('krus')}")`);
  root.setProperty('--px-pin-red', `url("${pinTile('#DC2626', '#FCA5A5', '#7F1D1D')}")`);
  root.setProperty('--px-pin-green', `url("${pinTile('#16A34A', '#BBF7D0', '#14532D')}")`);
  root.setProperty('--px-pin-blue', `url("${pinTile('#0284C7', '#BAE6FD', '#0C4A6E')}")`);
}
