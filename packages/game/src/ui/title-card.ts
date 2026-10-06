// 🎬 The opening title card (logging in, and each time you arrive in an area): a black screen with the area's name cut
// out of it in Marcellus SC capitals, made bold (the font has no bold cut: each letter is thickened with its own
// outline) and condensed to stand the full height of the screen, so the world shows through the letters (with a
// little grit in them, like old film) while the camera pulls back behind them. Then the black fades away, opening
// onto the whole world. A canvas over the page (clicks go through it); the HUD waits under it.
// Reduced motion: the name in place for a moment, then a plain fade.

const FONT = "'Marcellus SC', Georgia, serif";
const IN_MS = 450; // the letters open from black
const HOLD_MS = 1900; // the world pulls back inside them
const OUT_MS = 800; // the black fades away
const STILL_MS = 1200; // reduced motion: shown this long, then faded
const STILL_FADE_MS = 300;
/** The letters stand up to this share of the screen's height (capitals, top to bottom) and span at most this share of
 *  its width: squeezed sideways (condensed) to fit, but never narrower than MIN_SQUEEZE of their own width (a long
 *  name gets shorter instead), so they stay easy to read. */
const HEIGHT_SHARE = 0.9;
const WIDTH_SHARE = 0.94;
const MIN_SQUEEZE = 0.5;
/** The gap between lines ("THE" over "NEIGHBOURHOOD"), as a share of the letter height. */
const LINE_GAP = 0.12;
/** How much each letter is thickened (its outline's width, as a share of the letter size): Marcellus SC, bold. */
const BOLD = 0.05;

/** How long the card plays (the scene stretches its zoom-out to it). */
export const titleCardMs = () => (still() ? STILL_MS + STILL_FADE_MS : IN_MS + HOLD_MS + OUT_MS);
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Plays the card over the page; resolves once it's gone. */
export async function playTitleCard(text: string): Promise<void> {
  // The HUD and any pop-ups wait out of sight while the letters are up (index.html: body.title-on).
  document.body.classList.remove('title-fading');
  document.body.classList.add('title-on');
  const canvas = document.createElement('canvas');
  canvas.id = 'title-card';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  const ctx = canvas.getContext('2d')!;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const size = () => {
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
  };
  size();
  // Black until the letters can be drawn (the font may still be loading).
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await Promise.race([document.fonts.load(`100px ${FONT}`), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
  const card = cutOut(text.toUpperCase(), canvas.width, canvas.height); // capitals: the letters all one height

  return new Promise((done) => {
    const start = performance.now();
    const total = titleCardMs();
    const fadeAt = still() ? STILL_MS : IN_MS + HOLD_MS;
    let uiBack = false;
    const frame = (now: number) => {
      const t = now - start;
      // The black starts fading: the HUD fades back in with it.
      if (!uiBack && t >= fadeAt) {
        uiBack = true;
        document.body.classList.replace('title-on', 'title-fading');
        setTimeout(() => document.body.classList.remove('title-fading'), (still() ? STILL_FADE_MS : OUT_MS) + 50);
      }
      if (canvas.width !== Math.round(innerWidth * dpr) || canvas.height !== Math.round(innerHeight * dpr)) size();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let open: number; // how far the letters have opened (0: all black)
      let alpha: number; // the whole card
      if (still()) {
        open = 1;
        alpha = t < STILL_MS ? 1 : 1 - (t - STILL_MS) / STILL_FADE_MS;
      } else {
        open = Math.min(1, t / IN_MS);
        const out = Math.max(0, (t - IN_MS - HOLD_MS) / OUT_MS);
        alpha = 1 - out * out * (3 - 2 * out); // eased: the black thins out, then goes
      }
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.fillStyle = '#000';
      ctx.drawImage(card, 0, 0, canvas.width, canvas.height);
      // Opening from black: a black veil over the letters, thinning out.
      if (open < 1) {
        ctx.globalAlpha = Math.max(0, alpha) * (1 - open);
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      if (t < total) requestAnimationFrame(frame);
      else {
        canvas.remove();
        document.body.classList.remove('title-on');
        done();
      }
    };
    requestAnimationFrame(frame);
  });
}

/** The card: black with `text` cut out of it (a line per "\n"), and specks of grit inside the letters. */
function cutOut(text: string, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  // Every line's capitals the same height, together HEIGHT_SHARE of the screen (with a gap between lines), each line
  // squeezed sideways (sx) only as much as it needs to fit WIDTH_SHARE of the width; if one would get thinner than
  // MIN_SQUEEZE, all the letters get shorter instead.
  const lines = text.split('\n');
  ctx.font = `100px ${FONT}`;
  const ms = lines.map((t) => ctx.measureText(t));
  const capH = Math.max(1, ...ms.map((m) => m.actualBoundingBoxAscent + m.actualBoundingBoxDescent));
  const wide = (m: TextMetrics, size: number) => m.width * (size / 100) * (1 + BOLD); // a line's natural width at a size
  const gap = LINE_GAP; // between lines, as a share of the letter height
  let px = (h * HEIGHT_SHARE * 100) / (capH * (lines.length + gap * (lines.length - 1)));
  const squeeze = (size: number) => ms.map((m) => Math.min(1, (w * WIDTH_SHARE) / Math.max(1, wide(m, size))));
  const tightest = Math.min(...squeeze(px));
  if (tightest < MIN_SQUEEZE) px *= tightest / MIN_SQUEEZE; // too thin to read: shorter letters
  const sxs = squeeze(px).map((s) => Math.max(s, MIN_SQUEEZE));
  // Each line's baseline, the block of lines centred top to bottom.
  const lineH = (capH * px) / 100;
  const blockH = lineH * (lines.length + gap * (lines.length - 1));
  const draw = (c: CanvasRenderingContext2D, how: 'fill' | 'both') => {
    lines.forEach((line, i) => {
      const top = (h - blockH) / 2 + i * lineH * (1 + gap);
      const baseline = top + (ms[i].actualBoundingBoxAscent * px) / 100;
      c.save();
      c.translate(w / 2, baseline);
      c.scale(sxs[i], 1);
      c.font = `${Math.round(px)}px ${FONT}`;
      c.textAlign = 'center';
      c.textBaseline = 'alphabetic';
      c.lineWidth = px * BOLD;
      c.lineJoin = 'round';
      c.fillText(line, 0, 0);
      if (how === 'both') c.strokeText(line, 0, 0);
      c.restore();
    });
  };

  // The letters with grit: drawn white, then dark specks kept only where the letters are.
  const letters = document.createElement('canvas');
  letters.width = w;
  letters.height = h;
  const l = letters.getContext('2d')!;
  l.fillStyle = l.strokeStyle = '#fff';
  draw(l, 'both');
  const grit = document.createElement('canvas');
  grit.width = w;
  grit.height = h;
  const g = grit.getContext('2d')!;
  const specks = Math.round((w * h) / 350);
  for (let i = 0; i < specks; i++) {
    const r = Math.random() * Math.max(1.5, w / 500) + 0.6;
    g.fillStyle = `rgba(0,0,0,${0.3 + Math.random() * 0.5})`;
    g.beginPath();
    g.arc(Math.random() * w, Math.random() * h, r, 0, Math.PI * 2);
    g.fill();
  }
  l.globalCompositeOperation = 'source-in'; // the specks, only where the letters are
  l.drawImage(grit, 0, 0);

  // Black, the letters cut out, then their grit laid back in.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = ctx.strokeStyle = '#fff';
  draw(ctx, 'both');
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(letters, 0, 0);
  return c;
}
