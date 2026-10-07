import type { TownEmote } from '@mikazuki/shared';

// The emote picker, beside the chat input: a button that opens a row of the art's emote icons plus a wave, each
// with its key (F1–F8 also work in town when you're not typing). DOM only.

export const EMOTE_KEYS: TownEmote[] = ['heart', 'laugh', 'exclaim', 'question', 'kowen', 'sleep', 'angry', 'wave'];
const NAMES: Record<TownEmote, string> = {
  heart: 'Love', laugh: 'Laugh', exclaim: 'Surprised', question: 'Confused', kowen: 'Kowens!', sleep: 'Sleepy', angry: 'Angry', wave: 'Wave',
};

/** The emote sheet as a CSS sprite (12 × 12 frames, shown at 2×). */
export interface EmoteSheet {
  url: string;
  size: number;
  names: string[];
}

export function emotePicker(sheet: EmoteSheet | null, pick: (e: TownEmote) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'em-wrap';
  const open = document.createElement('button');
  open.className = 'em-open';
  open.setAttribute('aria-label', 'Emotes');
  open.setAttribute('aria-expanded', 'false');
  open.title = 'Emotes (F1–F8)';
  const face = icon(sheet, 'laugh');
  open.append(face ?? document.createTextNode(':)'));
  const palette = document.createElement('div');
  palette.className = 'em-palette';
  palette.hidden = true;
  EMOTE_KEYS.forEach((e, i) => {
    const b = document.createElement('button');
    b.className = 'em-item';
    b.title = `${NAMES[e]} (F${i + 1})`;
    b.setAttribute('aria-label', NAMES[e]);
    const pic = icon(sheet, e);
    if (pic) b.append(pic);
    else b.textContent = NAMES[e];
    const key = document.createElement('span');
    key.className = 'em-key';
    key.textContent = `F${i + 1}`;
    b.append(key);
    b.addEventListener('click', () => {
      pick(e);
      toggle(false);
    });
    palette.append(b);
  });
  const toggle = (show = palette.hidden) => {
    palette.hidden = !show;
    open.setAttribute('aria-expanded', String(show));
  };
  open.addEventListener('click', () => toggle());
  document.addEventListener('click', (ev) => {
    if (!wrap.contains(ev.target as Node)) toggle(false);
  });
  wrap.append(palette, open);
  return wrap;
}

/** An emote icon from the sheet, or the wave (a hand drawn from the laugh frame's row isn't in the art: text). */
function icon(sheet: EmoteSheet | null, e: TownEmote): HTMLElement | null {
  const frame = sheet?.names.indexOf(e) ?? -1;
  if (!sheet || frame < 0) {
    if (e !== 'wave') return null;
    const w = document.createElement('span');
    w.className = 'em-wave';
    w.textContent = 'Wave';
    return w;
  }
  const z = 2;
  const s = document.createElement('span');
  s.className = 'em-icon';
  s.style.backgroundImage = `url("${sheet.url}")`;
  s.style.backgroundSize = `${sheet.size * sheet.names.length * z}px ${sheet.size * z}px`;
  s.style.backgroundPosition = `-${frame * sheet.size * z}px 0`;
  s.style.width = s.style.height = `${sheet.size * z}px`;
  return s;
}
