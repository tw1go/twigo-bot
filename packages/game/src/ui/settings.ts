import { playSound, setSound, soundSettings } from '../audio/sound';
import { el, popupFrame } from './reward';

// ⚙️ The settings box (from the Settings button under your profile): centred over the dimmed town, white in the
// game's pixel frame like the reward pop-up. Audio (music and sound-effect volumes, mute), for members logging
// out, and a Credits page for the music, sounds and font. Closes with ×, Escape or a click outside. Its buttons make the soft button click (audio/sound.ts),
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
  const title = el('h2', 'st-title', 'Settings');
  const main = el('div');
  main.append(audio());
  if (o.loggedIn) main.append(account());
  const back = el('button', 'st-button', 'Back');
  const creditsPage = el('div');
  creditsPage.hidden = true;
  creditsPage.append(credits(), back);
  const more = el('section', 'st-section');
  const open = el('button', 'st-button', 'Credits');
  more.append(open);
  main.append(more);
  const page = (showCredits: boolean) => {
    main.hidden = showCredits;
    creditsPage.hidden = !showCredits;
    title.textContent = showCredits ? 'Credits' : 'Settings';
    (showCredits ? back : open).focus();
  };
  open.addEventListener('click', () => page(true));
  back.addEventListener('click', () => page(false));
  card.append(x, title, main, creditsPage);
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

/** Music and sound-effect volumes and mute (saved in this browser). */
function audio(): HTMLElement {
  const section = el('section', 'st-section');
  const s = soundSettings();
  const slider = (label: string, value: number, change: (value: number) => void) => {
    const input = el('input', 'st-volume');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.value = String(Math.round(value * 100));
    input.setAttribute('aria-label', label);
    input.addEventListener('input', () => change(Number(input.value) / 100));
    const row = el('label', 'st-row');
    row.append(el('span', 'st-label', label), input);
    return { row, input };
  };
  const music = slider('Music', s.music, (music) => setSound({ music }));
  const sfx = slider('Sounds', s.sfx, (sfx) => setSound({ sfx }));
  sfx.input.addEventListener('change', () => playSound('click')); // once let go, at the new volume

  const mute = el('label', 'st-row st-check');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = s.muted;
  box.addEventListener('change', () => {
    setSound({ muted: box.checked });
    playSound('click');
  });
  mute.append(box, el('span', undefined, 'Mute all'));

  section.append(el('h3', 'st-heading', 'Audio'), music.row, sfx.row, mute);
  return section;
}

/** Who made the music, sounds and font (assets/audio/CREDITS.md and the font's licence have the details). */
const CREDITS: { heading: string; lines: [string, string, string?][] }[] = [
  {
    heading: 'Music',
    lines: [
      ['"happy tune" by syncopika', 'CC-BY 3.0', 'https://opengameart.org/content/happy-tune'],
      ['"Buy Something!" (casino) by Cleyton Kauffman', 'CC0', 'https://opengameart.org/content/shop-theme'],
    ],
  },
  {
    heading: 'Sounds',
    lines: [
      ['Interface, RPG, Casino and Impact sounds by Kenney', 'CC0', 'https://kenney.nl'],
      ['Crickets by Wolfgang_ (notice: Ted Kerr)', 'CC0'],
      ['Fountain by rubberduck, "30 CC0 SFX Loops"', 'CC0'],
      ['Tanod\'s whistle: "Whistles" by dklon', 'CC-BY 3.0', 'https://opengameart.org/node/121038'],
      ['"Coin Drop" by Vinrax', 'CC0', 'https://opengameart.org/content/coin-drop'],
    ],
  },
  {
    heading: 'Font',
    lines: [
      ['Pixelify Sans by The Pixelify Sans Project Authors', 'SIL OFL 1.1', 'https://github.com/eifetx/Pixelify-Sans'],
      ['Jersey 10 by The Soft Type Project Authors', 'SIL OFL 1.1', 'https://github.com/scfried/soft-type-jersey'],
    ],
  },
];

function credits(): HTMLElement {
  const box = el('div');
  for (const { heading, lines } of CREDITS) {
    const section = el('section', 'st-section');
    section.append(el('h3', 'st-heading', heading));
    for (const [what, licence, url] of lines) {
      const line = el('p', 'st-credit');
      if (url) {
        const link = el('a', undefined, what);
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener';
        line.append(link);
      } else line.append(what);
      line.append(el('span', 'st-licence', ` · ${licence}`));
      section.append(line);
    }
    box.append(section);
  }
  return box;
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
