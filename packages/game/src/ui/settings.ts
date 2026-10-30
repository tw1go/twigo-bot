import { comboOn, setComboOn } from './combo-counter';
import { onHotbarLock, setHotbarLocked } from './hotbar-lock';
import { fakeLogin } from '../session';
import { setTrailOn, trailOn } from '../world/quest-trail';
import { playSound, setSound, soundSettings } from '../audio/sound';
import { api, setAppToken } from '../net/endpoints';
import { ACTIONS, bindings, comboOf, keyName, resetKeybinds, setBinding } from './keybinds';
import { el, popupFrame } from './reward';
import { toast } from './toast';
import { TEXT_SIZES, setTextSize, textSize } from './text-size';
import { isDesktopApp } from '../net/platform';
import { changePrivacy, privacy } from '../net/privacy';
import { changeTesting, testing } from '../net/testing';
import { lagCount, lagReport } from '../net/lag';

// ⚙️ The settings box (from the Settings button under your profile): centred over the dimmed town, white in the
// game's pixel frame like the reward pop-up. Audio (music and sound-effect volumes, mute), for members logging
// out, Privacy (in town: friends-only whispers, saved for you by the town's server), a Keybinds page (every game key, two per action: ui/keybinds.ts) and a Credits page for the music, sounds and font. Closes with ×, Escape or a click outside. Its buttons make the soft button click (audio/sound.ts),
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
  // Two columns (one on a phone): Audio and Display; Game, Privacy and Account; Keybinds and Credits across the bottom.
  const main = el('div', 'st-main');
  const left = el('div', 'st-col');
  const right = el('div', 'st-col');
  left.append(audio(), display());
  right.append(leave());
  if (o.loggedIn && privacy()) right.append(privacySection());
  if (o.loggedIn && testing()) right.append(testingSection()); // (Game Masters only: the town tells nobody else)
  if (o.loggedIn) right.append(account());
  main.append(left, right);
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
  // Dev: the GM tools (ui/gm-tools.ts), on the dev server with a pretend login.
  if (import.meta.env.DEV && fakeLogin()) {
    const gm = el('button', 'st-button', 'GM tools');
    gm.addEventListener('click', () => {
      close();
      dispatchEvent(new Event('mk-gm-open'));
    });
    more.append(gm);
  }
  main.append(more); // (across both columns)
  const show = (which: 'keys' | 'credits' | null) => {
    main.hidden = which !== null;
    keysPage.page.hidden = which !== 'keys';
    creditsPage.page.hidden = which !== 'credits';
    card.classList.toggle('st-wide', which === 'keys');
    title.textContent = which === 'keys' ? 'Keybinds' : which === 'credits' ? 'Credits' : 'Settings';
  };
  openKeys.addEventListener('click', () => show('keys'));
  open.addEventListener('click', () => show('credits'));
  card.append(x, title, main, keysPage.page, creditsPage.page);
  root.append(card);
  document.body.append(root);
  // (No button takes the focus: Space and Enter are the game's keys, and a focused Close would go off on them.)

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

/** Testing (Game Masters only; CONTEXT.md Unkillable): can't be knocked out, and skills that cost no MP, kept by the
 *  town's server (net/testing.ts) until turned off. */
function testingSection(): HTMLElement {
  const section = el('section', 'st-section');
  // One switch: drawn as the town last said (the server answers a change with the switches now).
  const toggle = (label: string, key: 'unkillable' | 'freeMp', on: string, off: string) => {
    const row = el('label', 'st-row st-check');
    const box = el('input');
    box.type = 'checkbox';
    const draw = () => (box.checked = !!testing()?.[key]);
    draw();
    box.addEventListener('change', () => {
      playSound('click');
      if (!changeTesting({ [key]: box.checked })) {
        toast('Can’t reach the town right now.', 2600, 'bad');
        return draw();
      }
      toast(box.checked ? on : off, 2400);
    });
    row.append(box, el('span', undefined, label));
    return row;
  };
  section.append(
    el('h3', 'st-heading', 'Testing'),
    toggle('Can’t be knocked out', 'unkillable', 'Unkillable: your HP stops at 1.', 'You can be knocked out again.'),
    toggle('Skills cost no MP', 'freeMp', 'Skills, moves and buffs cost no MP.', 'Skills cost MP again.'),
    el('p', 'st-note', 'Game Masters only. Hits still land, but your HP stops at 1, so you can fight on through quests and levels; with free MP every skill, move and buff goes without spending any. Each stays on until you turn it off.'),
  );
  return section;
}

/** Privacy (CONTEXT.md Friends-only whispers, Who can see): who may whisper you, and who can see your Balance and
 *  your Status, kept by the town's server (net/privacy.ts). */
function privacySection(): HTMLElement {
  const section = el('section', 'st-section');
  const row = el('label', 'st-row st-check');
  const box = el('input');
  box.type = 'checkbox';
  const draw = () => (box.checked = privacy()?.whispers === 'friends');
  draw();
  // (The box is drawn as the town last said: the server answers a change with the settings now, net/privacy.ts.)
  box.addEventListener('change', () => {
    playSound('click');
    if (!changePrivacy({ whispers: box.checked ? 'friends' : 'everyone' })) {
      toast('Can’t reach the town right now.', 2600, 'bad');
      draw();
    }
  });
  row.append(box, el('span', undefined, 'Only friends can whisper me'));
  section.append(el('h3', 'st-heading', 'Privacy'), row, el('p', 'st-note', 'Game Masters can always whisper you.'));
  // Who can see your Balance and your Status (CONTEXT.md Who can see), each Everyone / Friends / Only me.
  for (const [what, label] of [['balance', 'Who can see my Balance'], ['status', 'Who can see my Status']] as const) {
    const choices = el('div', 'st-sizes st-seen');
    choices.setAttribute('role', 'radiogroup');
    choices.setAttribute('aria-label', label);
    const draw = () => {
      for (const b of choices.children) b.setAttribute('aria-checked', String((b as HTMLElement).dataset.v === privacy()?.[what]));
    };
    for (const [v, text] of [['everyone', 'Everyone'], ['friends', 'Friends'], ['me', 'Only me']] as const) {
      const b = el('button', 'st-size', text);
      b.dataset.v = v;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => {
        playSound('click');
        if (!changePrivacy({ [what]: v })) return toast('Can’t reach the town right now.', 2600, 'bad');
        // (Drawn at once; the server's answer, the settings now, follows.)
        for (const o of choices.children) o.setAttribute('aria-checked', String(o === b));
      });
      choices.append(b);
    }
    draw();
    const head = el('div', 'st-row');
    head.append(el('span', 'st-label', label));
    section.append(head, choices);
  }
  section.append(el('p', 'st-note', 'In town, in Discord’s /balance and /status, and on the leaderboards (as “Hidden”). Jail, your Bakod and your rogue mark still show in town; Game Masters always see both.'));
  return section;
}

/** Text size for the whole UI (ui/text-size.ts), one of four, applied at once; in the desktop app, the window too
 *  (ui/window-settings.ts, its own chunk). */
function display(): HTMLElement {
  const section = el('section', 'st-section');
  const row = el('div', 'st-sizes');
  row.setAttribute('role', 'radiogroup');
  row.setAttribute('aria-label', 'Text size');
  const draw = () => {
    for (const b of row.children) b.setAttribute('aria-checked', String((b as HTMLElement).dataset.size === textSize()));
  };
  for (const t of TEXT_SIZES) {
    const b = el('button', 'st-size', t.label);
    b.dataset.size = t.id;
    b.setAttribute('role', 'radio');
    b.style.fontSize = `${Math.round(14 * t.scale)}px`; // each button in its own size
    b.addEventListener('click', () => {
      setTextSize(t.id);
      playSound('click');
      draw();
    });
    row.append(b);
  }
  draw();
  const label = el('div', 'st-row');
  label.append(el('span', 'st-label', 'Text size'));
  section.append(el('h3', 'st-heading', 'Display'), label, row);
  if (isDesktopApp()) void import('./window-settings').then((w) => section.append(w.windowRows()));
  return section;
}

/** Exit game: the desktop app quits (net/desktop.ts); the website (and the home screen app) goes back to the front page. */
function leave(): HTMLElement {
  const section = el('section', 'st-section');
  const out = el('button', 'st-logout st-exit', 'Exit game');
  out.addEventListener('click', () => {
    out.disabled = true;
    playSound('click');
    if (isDesktopApp()) void import('../net/desktop').then((d) => d.exitApp());
    else location.href = '/';
  });
  // The quest trail on the ground (world/quest-trail.ts); the guide arrows always show.
  const trail = el('label', 'st-row st-check');
  const trailBox = el('input');
  trailBox.type = 'checkbox';
  trailBox.checked = trailOn();
  trailBox.addEventListener('change', () => {
    setTrailOn(trailBox.checked);
    playSound('click');
  });
  trail.append(trailBox, el('span', undefined, 'Show quest trails'));
  // The hotbar lock (ui/hotbar-lock.ts): the same switch as the padlock on the bar.
  const lock = el('label', 'st-row st-check');
  const lockBox = el('input');
  lockBox.type = 'checkbox';
  onHotbarLock((on) => (lockBox.checked = on));
  lockBox.addEventListener('change', () => {
    setHotbarLocked(lockBox.checked);
    playSound('click');
  });
  lock.append(lockBox, el('span', undefined, 'Lock hotbar'));
  // The combo counter on battle maps (ui/combo-counter.ts).
  const combo = el('label', 'st-row st-check');
  const comboBox = el('input');
  comboBox.type = 'checkbox';
  comboBox.checked = comboOn();
  comboBox.addEventListener('change', () => {
    setComboOn(comboBox.checked);
    playSound('click');
  });
  combo.append(comboBox, el('span', undefined, 'Combo counter'));
  const lockNote = el('p', 'st-note', "Skills and potions can't be dragged off or moved. You can still fill empty slots.");
  // The lag report (net/lag.ts): what ran in each slow frame, to paste to the developers.
  const lag = el('button', 'st-button', `Copy lag report (${lagCount()} slow frame${lagCount() === 1 ? '' : 's'})`);
  lag.addEventListener('click', () => {
    playSound('click');
    const text = lagReport();
    void navigator.clipboard.writeText(text).then(
      () => toast('Lag report copied: paste it to the developers.', 2600, 'good'),
      () => {
        console.log(text);
        toast("Couldn't copy it here: it's in the browser's console.", 3000, 'bad');
      },
    );
  });
  section.append(el('h3', 'st-heading', 'Game'), trail, combo, lock, lockNote, lag, el('p', 'st-note', 'Lag or stutter? Copy this right after it happens and send it to the developers.'), out);
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
  // (A left or right click elsewhere: never mind. The middle, back and forward buttons bind: they come as keys.)
  const cancel = (e: PointerEvent) => {
    if (waiting && (e.button === 0 || e.button === 2) && e.target !== waiting.b) stop();
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
        b.textContent = 'Press a key or mouse button…';
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
  const note = el('p', 'st-key-note', 'Click a key, then press a key or mouse button (middle, back, forward). Esc: never mind. Backspace: none. Left and right click, Enter and Esc stay as they are.');
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
      ['"Old Radio" (the Slums), an original loop for Mikazuki', 'Original'],
      ['"Drip Tunnels" (the Scrap Warrens), an original loop for Mikazuki', 'Original'],
      ['"Closing Time" (the Old Market), an original loop for Mikazuki', 'Original'],
      ['"Cold Room" (the Cellar), an original loop for Mikazuki', 'Original'],
    ],
  },
  {
    heading: 'Sounds',
    lines: [
      ['Interface, RPG, Casino and Impact sounds by Kenney (and the combat, skill, mob and boss sounds made from them)', 'CC0', 'https://kenney.nl'],
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
    await api('/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => null);
    setAppToken(null); // (the desktop app's token: forgotten too)
    location.reload();
  });
  section.append(el('h3', 'st-heading', 'Account'), out);
  return section;
}
