// 🔠 Text size (Settings → Display): every text in the page's UI (the HUD, chat, feeds, windows, tooltips) is sized
// `calc(Npx * var(--text))` in index.html, so one number on :root scales it all; the world's own text (name tags,
// bubbles, damage numbers) and pixel-art boxes keep theirs. Saved per browser (localStorage `mk_text`).

export const TEXT_SIZES = [
  { id: 'small', label: 'Small', scale: 0.9 },
  { id: 'normal', label: 'Normal', scale: 1 },
  { id: 'large', label: 'Large', scale: 1.15 },
  { id: 'larger', label: 'Larger', scale: 1.3 },
] as const;
export type TextSize = (typeof TEXT_SIZES)[number]['id'];

const KEY = 'mk_text';

export function textSize(): TextSize {
  try {
    const v = localStorage.getItem(KEY);
    if (TEXT_SIZES.some((t) => t.id === v)) return v as TextSize;
  } catch {
    // (no storage: the default)
  }
  return 'normal';
}

/** Puts a size on the page (and saves it when `save`). */
export function setTextSize(id: TextSize, save = true): void {
  const t = TEXT_SIZES.find((x) => x.id === id) ?? TEXT_SIZES[1];
  document.documentElement.style.setProperty('--text', String(t.scale));
  if (save) {
    try {
      if (t.id === 'normal') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, t.id);
    } catch {
      // (not saved: this visit only)
    }
  }
  dispatchEvent(new Event('mk-text-size')); // (anything placed by its size can place itself again)
}
