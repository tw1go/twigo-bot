import { playSound, setSound, soundSettings } from '../audio/sound';
import { el, popupFrame } from './reward';

// ⚙️ The settings box (from the Settings button under your profile): centred over the dimmed town, white in the
// game's pixel frame like the reward pop-up. Audio (master volume, mute, music and its credit) and, for members,
// logging out. Closes with ×, Escape or a click outside. Its buttons make the soft button click (audio/sound.ts),
// like every other button. DOM text only.

export function showSettings(o: { loggedIn: boolean; onClose?: () => void }): void {
  if (document.getElementById('settings')) return;
  const root = el('div');
  root.id = 'settings';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Settings');
  const card = el('div', 'st-card');
  const frame = popupFrame();
  if (frame) {
    card.classList.add('st-framed');
    card.style.setProperty('--frame', `url("${frame.url}")`);
    card.style.setProperty('--slice', String(frame.slice));
  }
  const x = el('button', 'st-close', '×');
  x.setAttribute('aria-label', 'Close');
  card.append(x, el('h2', 'st-title', 'Settings'), audio());
  if (o.loggedIn) card.append(account());
  root.append(card);
  document.body.append(root);
  x.focus();

  const close = () => {
    document.removeEventListener('keydown', keys);
    root.remove();
    o.onClose?.();
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    close();
  };
  x.addEventListener('click', close);
  root.addEventListener('click', (e) => e.target === root && close());
  document.addEventListener('keydown', keys);
}

/** Master volume, mute and music (saved in this browser), and the music's credit. */
function audio(): HTMLElement {
  const section = el('section', 'st-section');
  const s = soundSettings();
  const volume = el('input', 'st-volume');
  volume.type = 'range';
  volume.min = '0';
  volume.max = '100';
  volume.value = String(Math.round(s.volume * 100));
  volume.setAttribute('aria-label', 'Volume');
  volume.addEventListener('input', () => setSound({ volume: Number(volume.value) / 100 }));
  volume.addEventListener('change', () => playSound('click')); // once let go, at the new volume
  const row = el('label', 'st-row');
  row.append(el('span', 'st-label', 'Volume'), volume);

  const check = (label: string, on: boolean, change: (on: boolean) => void) => {
    const line = el('label', 'st-row st-check');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = on;
    box.addEventListener('change', () => {
      change(box.checked);
      playSound('click');
    });
    line.append(box, el('span', undefined, label));
    return line;
  };

  const credit = el('p', 'st-note');
  const link = el('a', undefined, '"happy tune" by syncopika');
  link.href = 'https://opengameart.org/content/happy-tune';
  link.target = '_blank';
  link.rel = 'noopener';
  credit.append('Music: ', link, ' (CC-BY 3.0). Sounds: Kenney, Wolfgang_ and rubberduck (CC0).');

  section.append(
    el('h3', 'st-heading', 'Audio'),
    row,
    check('Mute', s.muted, (muted) => setSound({ muted })),
    check('Music', s.music, (music) => setSound({ music })),
    credit,
  );
  return section;
}

function account(): HTMLElement {
  const section = el('section', 'st-section');
  const out = el('button', 'st-logout', 'Log out');
  out.addEventListener('click', async () => {
    out.disabled = true;
    await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => null);
    location.reload();
  });
  section.append(el('h3', 'st-heading', 'Account'), out);
  return section;
}
