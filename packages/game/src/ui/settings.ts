import { playSound, setSound, soundSettings } from '../audio/sound';
import { ACTIONS, bindings, comboOf, keyName, resetKeybinds, setBinding } from './keybinds';
import { el, popupFrame } from './reward';
import { toast } from './toast';

// ⚙️ The settings box (from the Settings button under your profile): centred over the dimmed town, white in the
// game's pixel frame like the reward pop-up. Audio (music and sound-effect volumes, mute), for members logging
// out, a Keybinds page (every game key, two per action: ui/keybinds.ts) and a Credits page for the music, sounds and font. Closes with ×, Escape or a click outside. Its buttons make the soft button click (audio/sound.ts),
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
  // Pages: Settings, and from its buttons Keybinds and Credits (each with Back).
  const pageOf = (body: HTMLElement, ...extra: HTMLElement[]) => {
    const page = el('div');
    page.hidden = true;
    const back = el('button', 'st-button', 'Back');
    back.addEventListener('click', () => show(null));
    const row = el('div', 'st-buttons');
    row.append(back, ...extra);
    page.append(body, row);
    return { page, back };
  };
  const keybinds = keybindsPage();
  const keysPage = pageOf(keybinds.body, keybinds.reset);
  const creditsPage = pageOf(credits());
  const more = el('section', 'st-section st-more');
  const openKeys = el('button', 'st-button', 'Keybinds');
  const open = el('button', 'st-button', 'Credits');
  more.append(openKeys, open);
  main.append(more);
  const show = (which: 'keys' | 'credits' | null) => {
    main.hidden = which !== null;
    keysPage.page.hidden = which !== 'keys';
    creditsPage.page.hidden = which !== 'credits';
    card.classList.toggle('st-wide', which === 'keys');
    title.textContent = which === 'keys' ? 'Keybinds' : which === 'credits' ? 'Credits' : 'Settings';
    (which === 'keys' ? keysPage.back : which === 'credits' ? creditsPage.back : which === null ? openKeys : open).focus();
  };
  openKeys.addEventListener('click', () => show('keys'));
  open.addEventListener('click', () => show('credits'));
  card.append(x, title, main, keysPage.page, creditsPage.page);
  root.append(card);
  document.body.append(root);
  x.focus();

  const close = () => {
    document.removeEventListener('keydown', keys);
    root.remove();
    o.onClose?.();
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
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

  // The Alings' gossip murmur, on its own (their voices in the dialog box still play).
  const folk = el('label', 'st-row st-check');
  const folkBox = el('input');
  folkBox.type = 'checkbox';
  folkBox.checked = s.npcsMuted;
  folkBox.addEventListener('change', () => {
    setSound({ npcsMuted: folkBox.checked });
    playSound('click');
  });
  folk.append(folkBox, el('span', undefined, 'Mute gossip murmur'));

  section.append(el('h3', 'st-heading', 'Audio'), music.row, sfx.row, mute, folk);
  return section;
}

/** Every action's two keys: click one, press the new key (Escape: never mind; Backspace or Delete: none). A key
 *  another action had is taken from it (a toast says which). Reset puts every key back. */
function keybindsPage(): { body: HTMLElement; reset: HTMLElement } {
  const box = el('div', 'st-keys');
  const list = el('div', 'st-key-list');
  let waiting: { b: HTMLButtonElement; id: string; place: 0 | 1 } | null = null;
  const buttons: { b: HTMLButtonElement; id: string; place: 0 | 1 }[] = [];
  const draw = () => {
    for (const k of buttons) {
      const key = bindings(k.id)[k.place];
      k.b.textContent = key ? keyName(key) : '–';
      k.b.classList.toggle('st-key-none', !key);
      k.b.classList.remove('st-key-wait');
    }
  };
  const stop = () => {
    waiting = null;
    document.removeEventListener('keydown', capture, true);
    document.removeEventListener('pointerdown', cancel, true);
    draw();
  };
  const cancel = (e: Event) => {
    if (waiting && e.target !== waiting.b) stop();
  };
  // Caught before anything else (the town's keys, the box's own Escape).
  const capture = (e: KeyboardEvent) => {
    if (!waiting) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === 'Escape') return stop();
    const { id, place } = waiting;
    if (e.code === 'Backspace' || e.code === 'Delete') {
      setBinding(id, place, null);
      playSound('click');
      return stop();
    }
    const combo = comboOf(e);
    if (!combo) return; // a modifier on its own: wait for the key
    const took = setBinding(id, place, combo);
    playSound('click');
    if (took) toast(`${keyName(combo)} moved here from “${took}”.`, 3200);
    stop();
  };
  let group = '';
  for (const a of ACTIONS) {
    if (a.group !== group) {
      group = a.group;
      list.append(el('h3', 'st-heading st-key-group', group));
    }
    const row = el('div', 'st-key-row');
    row.append(el('span', 'st-key-label', a.label));
    for (const place of [0, 1] as const) {
      const b = el('button', 'st-key');
      b.setAttribute('aria-label', `${a.label}, ${place ? 'second' : 'first'} key`);
      b.addEventListener('click', () => {
        if (waiting) stop();
        waiting = { b, id: a.id, place };
        b.textContent = 'Press a key…';
        b.classList.add('st-key-wait');
        document.addEventListener('keydown', capture, true);
        document.addEventListener('pointerdown', cancel, true);
      });
      buttons.push({ b, id: a.id, place });
      row.append(b);
    }
    list.append(row);
  }
  const reset = el('button', 'st-button', 'Reset all');
  reset.addEventListener('click', () => {
    resetKeybinds();
    draw();
    toast('Every key is back to the default.', 2200);
  });
  const note = el('p', 'st-key-note', 'Click a key, then press the new one. Esc: never mind. Backspace: no key. Enter (chat) and Esc stay as they are.');
  box.append(note, list);
  draw();
  return { body: box, reset };
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
      ['Interface, RPG, Casino and Impact sounds by Kenney (and the combat, skill and golem sounds made from them)', 'CC0', 'https://kenney.nl'],
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
      ['Marcellus SC by Brian J. Bonislawsky (Astigmatic)', 'SIL OFL 1.1', 'https://fonts.google.com/specimen/Marcellus+SC'],
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
