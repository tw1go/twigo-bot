import { playSound } from '../audio/sound';
import { applyWindow, sizesFor, windowSetting, type WindowMode, type WindowSize } from '../net/window-mode';
import { el } from './reward';

// 🪟 Settings → Display in the desktop app only (ui/settings.ts loads it there): Window (Full screen / Borderless /
// Windowed, like Text size's buttons) and, for Borderless and Windowed, Resolution (the sizes that fit this screen:
// net/window-mode.ts). Applied at once and kept.

const MODES: { id: WindowMode; label: string }[] = [
  { id: 'fullscreen', label: 'Full screen' },
  { id: 'borderless', label: 'Borderless' },
  { id: 'windowed', label: 'Windowed' },
];

const sizeName = (s: WindowSize) => `${s.width} × ${s.height}${s.screen ? ' (screen)' : ''}`;

/** The Window and Resolution rows, to go under Text size. */
export function windowRows(): HTMLElement {
  const box = el('div', 'st-window');
  const modes = el('div', 'st-sizes');
  modes.setAttribute('role', 'radiogroup');
  modes.setAttribute('aria-label', 'Window');
  const resRow = el('label', 'st-row');
  const res = el('select', 'st-select');
  resRow.append(el('span', 'st-label', 'Resolution'), res);
  let busy = false;

  const draw = async () => {
    const s = windowSetting();
    for (const b of modes.children) b.setAttribute('aria-checked', String((b as HTMLElement).dataset.mode === s.mode));
    resRow.hidden = s.mode === 'fullscreen';
    if (s.mode === 'fullscreen') return;
    const sizes = await sizesFor(s.mode);
    const options = [...sizes];
    // A Windowed size dragged to (or one kept from another screen) is listed as it is.
    if (!options.some((o) => o.width === s.width && o.height === s.height)) options.push({ width: s.width, height: s.height });
    options.sort((a, b) => a.width * a.height - b.width * b.height);
    res.replaceChildren(
      ...options.map((o) => {
        const opt = el('option', '', sizeName(o));
        opt.value = `${o.width}x${o.height}`;
        opt.selected = o.width === s.width && o.height === s.height;
        return opt;
      }),
    );
  };
  const apply = async (change: Partial<{ mode: WindowMode; width: number; height: number }>) => {
    if (busy) return;
    busy = true;
    modes.classList.add('st-busy');
    try {
      await applyWindow({ ...windowSetting(), ...change });
    } catch {
      /* (the window keeps what it had) */
    }
    busy = false;
    modes.classList.remove('st-busy');
    await draw();
  };

  for (const m of MODES) {
    const b = el('button', 'st-size', m.label);
    b.dataset.mode = m.id;
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => {
      playSound('click');
      // Coming from another mode: Borderless at the screen's own size, Windowed at the largest of its sizes no bigger
      // than the window was.
      const s = windowSetting();
      if (m.id === 'fullscreen' || m.id === s.mode) return void apply({ mode: m.id });
      void sizesFor(m.id).then((sizes) => {
        const pick = m.id === 'borderless' ? sizes.at(-1)! : ([...sizes].reverse().find((f) => f.width <= s.width && f.height <= s.height) ?? sizes[0]);
        return apply({ mode: m.id, width: pick.width, height: pick.height });
      });
    });
    modes.append(b);
  }
  res.addEventListener('change', () => {
    const [width, height] = res.value.split('x').map(Number);
    playSound('click');
    void apply({ width, height });
  });

  const label = el('div', 'st-row');
  label.append(el('span', 'st-label', 'Window'));
  box.append(label, modes, resRow);
  void draw();
  return box;
}
